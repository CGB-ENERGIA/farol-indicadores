'use strict';
/* Sincronização: lê a pasta do OneDrive, processa só os arquivos novos ou alterados e grava no banco. */
const { fonteDoNome, lerPlanilha, bancoDeLinhas, ehConsolidado, EXTENSOES } = require('./banco');
const { importarConsolidado } = require('./consolidado');

const LIMITE_LEITURA_COMUM = 50 * 1024 * 1024; // acima disso, só a leitura em fluxo dá conta

let emAndamento = false;

async function sincronizar({ origem, store, limiteMs = 50000, inicio = '2026-01-01', filtro = '', dry = false, agora = Date.now, log = () => {} }) {
  if (emAndamento) return { ocupado: true, mensagem: 'Já existe uma sincronização em andamento.' };
  emAndamento = true;
  const t0 = agora();
  const res = { inicio: new Date(t0).toISOString(), dry, listados: 0, candidatos: 0, jaProcessados: 0, processados: 0, ignorados: 0, dias: { novo: 0, atualizado: 0, ignorado: 0 }, linhas: 0, erros: [], restantes: 0, arquivos: [] };
  try {
    const todos = await origem.listar();
    res.listados = todos.length;
    const f = String(filtro || '').trim().toLowerCase();
    const cand = todos.filter(a => !/^~\$/.test(a.nome) && EXTENSOES.test(a.nome) && (!f || String(a.caminho || a.nome).toLowerCase().includes(f)))
      .sort((a, b) => String(a.modificado).localeCompare(String(b.modificado))); // os mais antigos primeiro: o mais novo prevalece
    res.candidatos = cand.length;

    for (let i = 0; i < cand.length; i++) {
      const a = cand[i];
      const reg = await store.arquivo(a.id);
      if (reg && reg.etag === a.etag && (reg.status === 'ok' || reg.status === 'ignorado')) { res.jaProcessados++; continue; }
      if (agora() - t0 > limiteMs) { res.restantes = cand.slice(i).length; log('Limite de tempo atingido: o restante fica para a próxima execução.'); break; }

      const consolidado = ehConsolidado(a.nome);
      const fonte = fonteDoNome(a.nome);
      const grande = (a.tamanho || 0) > LIMITE_LEITURA_COMUM;
      const base = { id: a.id, nome: a.nome, etag: a.etag, tamanho: a.tamanho, modificado: a.modificado };
      if (!fonte && !consolidado) { // nome que não é COI/MAN/FIS/OBRAS
        res.ignorados++; res.arquivos.push({ nome: a.nome, status: 'ignorado', motivo: 'nome não reconhecido' });
        if (!dry) await store.registrarArquivo({ ...base, status: 'ignorado', detalhe: { motivo: 'nome não reconhecido (esperado: COI, MAN, FIS ou OBRAS no nome)' } });
        continue;
      }
      if (dry) { res.arquivos.push({ nome: a.nome, status: 'pendente', fonte: consolidado ? 'CONSOLIDADO' : fonte }); continue; }

      if (consolidado || (grande && fonte)) { // planilha com várias abas ou muito grande: leitura em fluxo (só no modo local)
        try {
          if (!a._abs) throw new Error('Planilhas grandes (consolidado) só são lidas no modo local por enquanto. Use ONEDRIVE_MODO=local ou separe por dia.');
          log('Lendo ' + a.nome + ' em fluxo (pode levar alguns minutos)…');
          const c = await importarConsolidado({ caminho: a._abs, store, inicio, arquivo: a.nome, modificado: a.modificado, forcar: true, log });
          if (c.erros.length) throw new Error(c.erros.map(e => e.aba + ': ' + e.erro).join(' | '));
          const cont = c.dias;
          for (const k of Object.keys(cont)) res.dias[k] += cont[k];
          res.linhas += c.linhas; res.processados++;
          res.arquivos.push({ nome: a.nome, status: 'ok', fonte: 'CONSOLIDADO', abas: c.abas, dias: cont, linhas: c.linhas });
          await store.registrarArquivo({ ...base, status: 'ok', detalhe: { fonte: 'CONSOLIDADO', dias: cont, linhas: c.linhas } });
        } catch (e) {
          res.erros.push({ nome: a.nome, erro: e.message }); res.arquivos.push({ nome: a.nome, status: 'erro', erro: e.message });
          await store.registrarArquivo({ ...base, status: 'erro', detalhe: { erro: e.message } });
        }
        continue;
      }

      try {
        log('Lendo ' + a.nome + ' (' + fonte + ')…');
        const rows = lerPlanilha(await origem.baixar(a));
        const b = bancoDeLinhas(rows, fonte, inicio);
        if (!b) throw new Error('Não encontrei a coluna "Data" nas colunas esperadas do ' + fonte + '.');
        const cont = { novo: 0, atualizado: 0, ignorado: 0 }; let linhas = 0;
        for (const d of Object.keys(b.dias).sort()) {
          const r = await store.gravarDia({ fonte, data: d, cols: b.cols, linhas: b.dias[d], arquivo: a.nome, modificado: a.modificado });
          cont[r]++; res.dias[r]++; linhas += b.dias[d].length;
        }
        res.linhas += linhas; res.processados++;
        res.arquivos.push({ nome: a.nome, status: 'ok', fonte, dias: cont, linhas });
        await store.registrarArquivo({ ...base, status: 'ok', detalhe: { fonte, dias: cont, linhas } });
      } catch (e) {
        res.erros.push({ nome: a.nome, erro: e.message });
        res.arquivos.push({ nome: a.nome, status: 'erro', erro: e.message });
        await store.registrarArquivo({ ...base, status: 'erro', detalhe: { erro: e.message } }); // será tentado de novo na próxima execução
      }
    }
  } catch (e) {
    res.erros.push({ nome: null, erro: e.message });
  } finally {
    emAndamento = false;
    res.fim = new Date(agora()).toISOString();
    res.duracaoMs = agora() - t0;
    if (!dry) { try { await store.registrarExecucao(res); } catch (e) { /* o registro da execução não pode derrubar a sincronização */ } }
  }
  return res;
}

module.exports = { sincronizar };
