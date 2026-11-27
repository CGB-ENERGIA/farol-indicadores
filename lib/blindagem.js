'use strict';
/* Reincidentes · cadastro de blindagem dos trafos.
   Tabelas: blindagem (uma linha por intervenção) e blindagem_acao (uma linha por ação executada nela).
   Quem cadastrou e quando vem da sessão (nunca do navegador). */
const pg = require('./pg');

const ACOES = ['QT DE ESPAÇADOR', 'QTD DE VÃO', 'CHECK DE ELO', 'RETIRADA OBJETO REDE', 'PODAS DE BT', 'PODAS DE MT', 'RETIRADA GAMBIARRA', 'ALTERAR TAP', 'BALANCEAMENTO', 'PARA RAIO BT'];
const STATUS = ['CONCLUIDO', 'PARCIAL'];
const MAX_QTD = 100000;

const txt = (v, max) => { const s = v == null ? '' : String(v).trim().replace(/\s+/g, ' '); return s.length > max ? null : s; };
const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });

/* confere e normaliza o que veio do formulário; devolve {campos, acoes} ou lança erro com a mensagem para o usuário */
function validar(b) {
  const p = [];
  const seccional = txt(b.seccional, 60), municipio = txt(b.municipio, 80), componente = txt(b.componente, 40);
  if (!seccional) p.push('Escolha a seccional.');
  if (!municipio) p.push(b.municipio_outro ? 'Digite o nome do município.' : 'Escolha o município.');
  if (!componente) p.push('Informe o componente.');
  const al = txt(b.al, 40), tipo_equip = txt(b.tipo_equip, 60), conjunto = txt(b.conjunto, 80);
  if (al === null || tipo_equip === null || conjunto === null) p.push('Algum campo de texto passou do tamanho máximo.');
  let chi = null;
  if (b.chi !== '' && b.chi != null) { chi = Number(String(b.chi).replace(',', '.')); if (!Number.isFinite(chi) || chi < 0) p.push('O CHI deve ser um número igual ou maior que zero.'); }
  let qtd_clientes = null;
  if (b.qtd_clientes !== '' && b.qtd_clientes != null) { qtd_clientes = Number(b.qtd_clientes); if (!Number.isInteger(qtd_clientes) || qtd_clientes < 0) p.push('A quantidade de clientes deve ser um número inteiro igual ou maior que zero.'); }
  if (b.inspecionado !== true && b.inspecionado !== false) p.push('Marque se o trafo foi inspecionado (Sim ou Não).');
  const dia = String(b.dia_execucao || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || isNaN(Date.parse(dia + 'T00:00:00Z'))) p.push('Informe o dia da execução.');
  else if (dia > hojeSP()) p.push('O dia da execução não pode ser depois de hoje.');
  else if (dia < '2020-01-01') p.push('Confira o dia da execução (ano muito antigo).');
  if (!STATUS.includes(b.status)) p.push('Escolha o status (Concluído ou Parcial).');
  const acoes = [], vistos = new Set();
  for (const a of Array.isArray(b.acoes) ? b.acoes : []) {
    const tipo = String((a && a.tipo) || '');
    if (!ACOES.includes(tipo)) { p.push('Ação inválida: ' + (tipo || '(sem tipo)') + '.'); continue; }
    if (vistos.has(tipo)) { p.push('A ação ' + tipo + ' aparece duas vezes. Ajuste a quantidade em uma linha só.'); continue; }
    vistos.add(tipo);
    const q = Number(a.qtd);
    if (a.qtd === '' || a.qtd == null || !Number.isInteger(q) || q < 0 || q > MAX_QTD) { p.push('A quantidade de ' + tipo + ' deve ser um número inteiro de 0 a ' + MAX_QTD + '.'); continue; }
    acoes.push({ tipo, qtd: q });
  }
  if (!acoes.length && !p.some(x => x.startsWith('Ação') || x.startsWith('A ação') || x.startsWith('A quantidade de'))) p.push('Adicione pelo menos uma ação executada.');
  if (p.length) throw Object.assign(erro('Confira o cadastro:'), { problemas: p });
  return {
    campos: { seccional: seccional.toUpperCase(), municipio, municipio_outro: !!b.municipio_outro, componente: componente.toUpperCase(), chi, al: al ? al.toUpperCase() : null, tipo_equip: tipo_equip || null, conjunto: conjunto ? conjunto.toUpperCase() : null, qtd_clientes, inspecionado: b.inspecionado, dia_execucao: dia, status: b.status },
    acoes
  };
}

const SELECT = `select b.id, b.seccional, b.municipio, b.municipio_outro, b.componente, b.chi::float8 as chi, b.al, b.tipo_equip, b.conjunto, b.qtd_clientes, b.inspecionado,
  to_char(b.dia_execucao, 'YYYY-MM-DD') as dia_execucao, b.status, b.criado_por, b.criado_nome, b.criado_em::text as criado_em, b.editado_por, b.editado_em::text as editado_em,
  coalesce((select json_agg(json_build_object('tipo', a.tipo, 'qtd', a.qtd) order by a.tipo) from blindagem_acao a where a.intervencao_id = b.id), '[]') as acoes
  from blindagem b`;

const duplicado = e => e && (e.code === '23505' || /ux_blindagem_trafo_dia|duplicate key/i.test(e.message || ''));
const MSG_DUP = 'Já existe uma intervenção cadastrada para esse componente nesse dia. Edite o cadastro existente em "Cadastros realizados".';

async function listar() { return pg.q(SELECT + ' order by b.dia_execucao desc, b.id desc'); }

async function criar(b, u) {
  const { campos: c, acoes } = validar(b);
  try {
    /* um comando só: grava a intervenção e as ações juntas (ou nada) */
    const r = await pg.q(`with i as (insert into blindagem (seccional, municipio, municipio_outro, componente, chi, al, tipo_equip, conjunto, qtd_clientes, inspecionado, dia_execucao, status, criado_por, criado_nome)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::date,$12,$13,$14) returning id),
      a as (insert into blindagem_acao (intervencao_id, tipo, qtd) select i.id, x.tipo, x.qtd from i cross join jsonb_to_recordset($15::jsonb) as x(tipo text, qtd int) returning 1)
      select id, (select count(*) from a)::int as n from i`,
    [c.seccional, c.municipio, c.municipio_outro, c.componente, c.chi, c.al, c.tipo_equip, c.conjunto, c.qtd_clientes, c.inspecionado, c.dia_execucao, c.status, u.usuario, u.nome, JSON.stringify(acoes)]);
    return r[0].id;
  } catch (e) { if (duplicado(e)) throw erro(MSG_DUP, 409); throw e; }
}

async function editar(id, b, u) {
  id = Number(id); if (!Number.isInteger(id)) throw erro('Cadastro inválido.');
  const { campos: c, acoes } = validar(b);
  try {
    /* atualiza a intervenção, apaga as ações que saíram e grava/ajusta as que ficaram, num comando só */
    const r = await pg.q(`with u as (update blindagem set seccional=$2, municipio=$3, municipio_outro=$4, componente=$5, chi=$6, al=$7, tipo_equip=$8, conjunto=$9, qtd_clientes=$10, inspecionado=$11, dia_execucao=$12::date, status=$13, editado_por=$14, editado_em=now() where id=$1 returning id),
      d as (delete from blindagem_acao where intervencao_id in (select id from u) and not (tipo = any($16::text[])) returning 1),
      a as (insert into blindagem_acao (intervencao_id, tipo, qtd) select u.id, x.tipo, x.qtd from u cross join jsonb_to_recordset($15::jsonb) as x(tipo text, qtd int)
            on conflict (intervencao_id, tipo) do update set qtd = excluded.qtd returning 1)
      select id from u`,
    [id, c.seccional, c.municipio, c.municipio_outro, c.componente, c.chi, c.al, c.tipo_equip, c.conjunto, c.qtd_clientes, c.inspecionado, c.dia_execucao, c.status, u.usuario, JSON.stringify(acoes), acoes.map(a => a.tipo)]);
    if (!r[0]) throw erro('Cadastro não encontrado.', 404);
    return id;
  } catch (e) { if (duplicado(e)) throw erro(MSG_DUP, 409); throw e; }
}

async function excluir(id) {
  id = Number(id); if (!Number.isInteger(id)) throw erro('Cadastro inválido.');
  const r = await pg.q('delete from blindagem where id = $1 returning id', [id]);
  if (!r[0]) throw erro('Cadastro não encontrado.', 404);
}

module.exports = { ACOES, STATUS, validar, listar, criar, editar, excluir };
