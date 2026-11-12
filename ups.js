/* Cálculo da UPS — réplica do Power BI "Produção UPS" */
(function (root) {
  const U = s => (s == null ? '' : String(s)).toUpperCase();
  const STATUS_OK = ['concluído', 'não concluído'];
  const LIMPAR = ['📡', ' ', '🚎', '🏍', '🛵'];
  const CAMPO = { K: 'Servico', R: 'Executada', U: 'NaoExecutada', T: 'TipoConclusao', BJ: 'LocalReligacao', BK: 'GrupoCode', C: 'Status', M: 'Abrangencia', AV: 'Code' };
  const pad = n => String(n).padStart(2, '0');
  const iso = d => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  const addDias = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const difDias = (a, b) => Math.round((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 86400000);

  function chave(cfg, a) {
    for (const [, ta, qt, qo, qr, fmt, lit] of cfg.regras) {
      if (U(ta) === U(a.Servico) && (qt == null || U(qt) === U(a.TipoConclusao)) && (qo == null || U(qo) === U(a.Causa)) && (qr == null || U(qr) === U(a.Executada)))
        return lit != null ? lit : fmt.split('+').map(c => a[CAMPO[c.trim()]]).join('');
    }
    return null;
  }
  function classificar(cfg, a) {
    const k = chave(cfg, a);
    const dp = k != null ? cfg.depara[U(k)] : null;
    if (U(a.Servico + a.Executada) === U('MISTEC - Miscelanea TécnicaEXECUTADO') && (!dp || dp.p !== 1)) return { k, cl: 'MISC TÉCNICA' };
    if (!dp) return { k, cl: null };
    if (dp.c == null) return { k, cl: '(SEM CLASSIFICAÇÃO NO DE_PARA)' };
    return { k, cl: dp.c };
  }

  /* rows: matriz com cabeçalho (relatório COI do SIGA ou "Relatório de Produção") */
  function agregarArquivo(cfg, rows, parseData) {
    const h = rows[0].map(x => (x == null ? '' : String(x).trim()));
    const ix = n => h.indexOf(n);
    const tipos = h.map((x, i) => (x === 'Tipo de Atividade' ? i : -1)).filter(i => i >= 0);
    const iServ = ix('Tipo de Atividade2') >= 0 ? ix('Tipo de Atividade2') : (tipos.length > 1 ? tipos[1] : -1);
    const M = { Recurso: ix('Recurso'), Data: ix('Data'), Status: ix('Status da Atividade'), Servico: iServ, Abrangencia: ix('Abrangência'), Causa: ix('Tipo de Causa - Text'), Executada: ix('Tipo de Conclusão Executada'), TipoConclusao: ix('Tipo de Conclusão'), NaoExecutada: ix('Tipo de Conclusão Não Executada'), Code: ix('Code'), LocalReligacao: ix('Local Religação'), GrupoCode: ix('Grupo Code') };
    const falta = Object.entries(M).filter(([, v]) => v < 0).map(([k]) => k);
    if (falta.length) throw new Error('Colunas da UPS não encontradas: ' + falta.join(', '));
    const dias = {}, sc = {}; let linhas = 0;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]; if (!row || row[M.Recurso] == null) continue;
      const a = {}; for (const k in M) a[k] = row[M[k]] == null ? '' : String(row[M[k]]);
      if (!STATUS_OK.includes(a.Status)) continue;
      const data = parseData(row[M.Data]); if (!data) continue;
      let rec = a.Recurso; for (const c of LIMPAR) rec = rec.split(c).join('');
      const { k, cl } = classificar(cfg, a);
      const dd = dias[data] || (dias[data] = {});
      const c = dd[rec] || (dd[rec] = {});
      c._n = (c._n || 0) + 1;
      if (cl != null) c[cl] = (c[cl] || 0) + 1;
      else if (k == null) c._semregra = (c._semregra || 0) + 1;
      else c._foradp = (c._foradp || 0) + 1;
      const cat = cl == null ? (k == null ? 'semregra' : 'foradp') : (cl === '(SEM CLASSIFICAÇÃO NO DE_PARA)' ? 'semclass' : null);
      if (cat) {
        const id = cat === 'semregra' ? [a.Servico, a.Status === 'não concluído' ? 'NÃO CONCLUÍDO' : '', a.Causa, a.Executada].join(' | ') : k;
        const sd = sc[data] || (sc[data] = {});
        const o = sd[id] || (sd[id] = { cat, id, serv: a.Servico, tc: a.TipoConclusao, causa: a.Causa, ex: a.Executada, nex: a.NaoExecutada, st: a.Status, n: 0, recs: {} });
        o.n++; o.recs[rec] = (o.recs[rec] || 0) + 1;
      }
      linhas++;
    }
    return { dias, linhas, sc };
  }

  /* Escala: lista de cadastros {cod, rec, bc, tipo, sub, ger, d:'0101..'} a partir de cfg.escalaInicio */
  function indexarEscala(cfg, escala) {
    const idx = {};
    for (const c of escala) {
      const est = cfg.processo[U(c.tipo).trim()] || null;
      const bcN = U(c.bc).trim();
      const info = { cod: c.cod, rec: c.rec, tipo: c.tipo, est, bcN, base: cfg.base[bcN] || null, sigla: bcN === 'BDC' ? 'PDT' : bcN, sub: c.sub, ger: c.ger, sup: c.sup, coord: c.coord, d: c.d || '' };
      (idx[c.rec] = idx[c.rec] || []).push(info);
    }
    return idx;
  }
  const escalado = (cfg, cad, data) => { const i = difDias(data, cfg.escalaInicio); return i >= 0 && cad.d[i] === '1'; };

  /* Linhas no grão cadastro × dia (como fAtividades + fMeta). feriados: {iso: nome}. */
  function calcular(cfg, escala, diasAgg, feriados, ferEquipe) {
    ferEquipe = ferEquipe || {};
    const idx = indexarEscala(cfg, escala);
    const datas = Object.keys(diasAgg).sort();
    if (!datas.length) return { linhas: [], ultima: null, cadastros: [] };
    const ultima = datas[datas.length - 1];
    const pontos = (base, est, cl) => { const v = cfg.tabups[U((base || '') + (est || '') + cl)]; return v == null ? 0 : v; };
    const out = new Map();
    const chaveL = (cod, rec, data) => (cod || '-') + '|' + rec + '|' + data;
    const nova = (cad, rec, data) => ({ rec, data, mes: data.slice(0, 7), cod: cad ? cad.cod : null, tipo: cad ? cad.tipo : null, est: cad ? cad.est : null, base: cad ? cad.base : null, sigla: cad ? cad.sigla : null, coord: cad ? cad.coord : null, ups: 0, temUps: false, n: 0, meta: 0, pend: null });
    // produção
    for (const data of datas) {
      const dd = diasAgg[data];
      for (const rec in dd) {
        const c = dd[rec];
        const cads = (idx[rec] || []).filter(x => escalado(cfg, x, data));
        const lista = cads.length ? cads : [null];
        for (const cad of lista) {
          const k = chaveL(cad && cad.cod, rec, data);
          const l = out.get(k) || nova(cad, rec, data);
          for (const cl in c) {
            if (cl[0] === '_') continue;
            l.temUps = true;
            l.ups += c[cl] * (cad ? pontos(cad.base, cad.est, cl) : 0);
          }
          l.n += c._n || 0;
          l.semRegra = (l.semRegra || 0) + (c._semregra || 0);
          l.foraDp = (l.foraDp || 0) + (c._foradp || 0);
          out.set(k, l);
        }
      }
    }
    // meta: escala com estrutura UPS, até a última data com produção
    const metaMes = {};
    for (const rec in idx) for (const cad of idx[rec]) {
      if (!cad.est) continue;
      for (let i = 0; i < cad.d.length; i++) {
        if (cad.d[i] !== '1') continue;
        const data = addDias(cfg.escalaInicio, i);
        const wd = (new Date(data + 'T00:00:00Z').getUTCDay() + 6) % 7;
        const fer = !!(feriados[data] || ferEquipe[data + '|' + U(cad.tipo).trim() + '|' + cad.bcN]);
        const meta = cfg.metaDia * fatorMeta(cad.est === 'AE116' && !/MOTO/.test(U(cad.sub)), wd, fer);
        const mk = data.slice(0, 7) + '|' + cad.rec + '|' + (cad.sigla || '') + '|' + (cad.tipo || '');
        metaMes[mk] = (metaMes[mk] || 0) + meta;
        if (data > ultima || !diasAgg[data]) continue; // meta só nos dias com produção carregada
        const k = chaveL(cad.cod, rec, data);
        const l = out.get(k) || nova(cad, rec, data);
        l.meta += meta;
        out.set(k, l);
      }
    }
    const cadastros = [];
    for (const rec in idx) for (const cad of idx[rec]) if (cad.est) cadastros.push(cad);
    return { linhas: [...out.values()], ultima, metaMes, cadastros };
  }

  function classe(p) {
    if (p == null || isNaN(p)) return null;
    if (p >= 0.9095) return 'A';
    if (p >= 0.75) return 'B';
    if (p >= 0.4095) return 'C';
    return 'D';
  }
  function faixaBase(p) {
    if (p == null || isNaN(p)) return { txt: 'Sem dados', cls: 'nd' };
    if (p >= 0.90) return { txt: 'Supera esperado', cls: 'sup' };
    if (p >= 0.80) return { txt: 'Atende esperado', cls: 'ate' };
    if (p >= 0.70) return { txt: 'Atende parcial', cls: 'par' };
    return { txt: 'Não atende', cls: 'nao' };
  }
  function corDia(v) {
    if (v == null) return null;
    if (v >= 38.3) return 'verde';
    if (v > 31.5) return 'amarelo';
    if (v >= 17.2) return 'laranja';
    return 'vermelho';
  }
  /* Por equipe (grão Recurso) num conjunto de linhas */
  function porEquipe(linhas) {
    const g = {};
    for (const l of linhas) {
      const a = g[l.rec] || (g[l.rec] = { rec: l.rec, ups: 0, temUps: false, meta: 0, siglas: new Set(), tipos: new Set(), dias: new Set() });
      a.ups += l.ups; a.temUps = a.temUps || l.temUps; a.meta += l.meta;
      if (l.sigla) a.siglas.add(l.sigla); if (l.tipo) a.tipos.add(l.tipo);
      if (l.n > 0) a.dias.add(l.data);
    }
    return Object.values(g).map(a => {
      const pct = a.meta ? (a.temUps ? a.ups / a.meta : null) : null;
      return Object.assign(a, { pct, classe: classe(pct), sigla: [...a.siglas].sort().join('/'), tipo: [...a.tipos].sort().join(' / '), equipeDias: a.dias.size });
    });
  }

  /* Regra de meta do dia (vale para UPS e Produção): fator sobre a meta diária.
     Plantão (16h e 8h trio): igual todos os dias, inclusive fim de semana e feriado.
     LGN, SDM, Plantão Moto e Corte: segunda a sexta 1 · sábado 0,5 · domingo 0 · feriado 0.
     wd: 0 = segunda ... 6 = domingo. */
  function fatorMeta(plantao, wd, feriado) {
    if (plantao) return 1;
    if (feriado || wd === 6) return 0;
    return wd === 5 ? 0.5 : 1;
  }
  const api = { chave, classificar, agregarArquivo, indexarEscala, calcular, classe, faixaBase, corDia, porEquipe, addDias, fatorMeta };
  if (typeof module !== 'undefined') module.exports = api; else root.UPSCalc = api;
})(this);
