/* Cálculo de disponibilidade — réplica da planilha "Disponiblidade - v.01" */
(function (root) {
  const DIAS = ['segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado','domingo'];
  const COI_REMOVER = ['📡', ' ', '🚎', '🏍', '🛵'];
  const STATUS_OK = ['concluído', 'não concluído'];

  function pad(n) { return String(n).padStart(2, '0'); }
  function isoDate(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function weekdayIdx(iso) { const d = new Date(iso + 'T00:00:00Z'); return (d.getUTCDay() + 6) % 7; }
  function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return isoDate(d); }

  // "05/11/26", "05/11/2026", número serial do Excel ou Date
  function parseData(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isoDate(new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())));
    if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 86400000)); return isoDate(d); }
    const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (!m) return null;
    let y = +m[3]; if (y < 100) y += 2000;
    return y + '-' + pad(+m[2]) + '-' + pad(+m[1]);
  }
  // "07:44 AM", "19:05", "7:44:00 PM", fração de dia do Excel → minutos
  function parseHora(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') { const f = v - Math.floor(v); return Math.floor(Math.round(f * 86400) / 60); }
    if (v instanceof Date) return v.getHours() * 60 + v.getMinutes();
    const m = String(v).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp])?/);
    if (!m) return null;
    let h = +m[1]; const mi = +m[2]; const ap = m[3] ? m[3].toUpperCase() : null;
    if (ap === 'A' && h === 12) h = 0;
    if (ap === 'P' && h < 12) h += 12;
    return h * 60 + mi;
  }

  function fonteDoArquivo(nome) {
    const n = nome.toUpperCase();
    if (n.includes('CONSOLIDADO')) return null;
    if (n.includes('COI')) return 'COI';
    const m = n.match(/MA-(MAN|OBRAS|FIS)[_\s-]/);
    if (m) return m[1];
    if (n.includes('-MAN')) return 'MAN';
    if (n.includes('OBRAS')) return 'OBRAS';
    if (n.includes('FIS')) return 'FIS';
    return 'OUTRO';
  }

  /* rows: matriz (1ª linha = cabeçalho). Retorna {dias:{iso:{recurso:[ini,fimMax,retMax,alm,ind]}}, linhas} */
  function agregarArquivo(rows, fonte) {
    const h = rows[0].map(x => (x == null ? '' : String(x).trim()));
    const idx = n => h.indexOf(n);
    const iRec = idx('Recurso'), iData = idx('Data'), iSt = idx('Status da Atividade'), iIni = idx('Início'), iFim = idx('Fim');
    const tipos = h.map((x, i) => (x === 'Tipo de Atividade' ? i : -1)).filter(i => i >= 0);
    const iTipo = tipos.length > 1 ? tipos[1] : tipos[0];
    if (iRec < 0 || iData < 0 || iSt < 0 || iIni < 0 || iFim < 0) throw new Error('Colunas Recurso/Data/Status/Início/Fim não encontradas');
    const dias = {}; let linhas = 0; const iv = {};
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]; if (!row) continue;
      const st = row[iSt]; if (!STATUS_OK.includes(st)) continue;
      const data = parseData(row[iData]); if (!data || data <= '2026-05-31') continue;
      let rec = row[iRec]; if (rec == null) continue; rec = String(rec);
      if (fonte === 'COI') {
        for (const c of COI_REMOVER) rec = rec.split(c).join('');
        if (rec.includes('X')) continue;
      }
      // Igual à planilha: no relatório FIS o tipo de atividade chega vazio na base
      const tipo = fonte === 'FIS' ? null : (iTipo != null && iTipo >= 0 ? row[iTipo] : null);
      const ini = parseHora(row[iIni]), fim = parseHora(row[iFim]);
      let tt = 0;
      if (ini != null && fim != null) tt = fim < ini ? fim - ini + 1440 : fim - ini;
      const dd = dias[data] || (dias[data] = {});
      const a = dd[rec] || (dd[rec] = [null, null, null, 0, 0, null]);
      if (ini != null) a[0] = a[0] == null ? ini : Math.min(a[0], ini);
      if (fim != null) a[1] = a[1] == null ? fim : Math.max(a[1], fim);
      /* [5] = 1º checklist de início de turno do dia: é a âncora do início da disponibilidade */
      const tipoCk = iTipo != null && iTipo >= 0 ? row[iTipo] : null;
      if (tipoCk != null && String(tipoCk).trim() === 'Checklist Início do Turno' && ini != null) a[5] = a[5] == null ? ini : Math.min(a[5], ini);
      if (tipo === 'Retorno à base' && ini != null) a[2] = a[2] == null ? ini : Math.max(a[2], ini);
      /* almoço e indisponibilidade: apontamento real do SIGA, em todas as fontes (inclusive FIS). Ficam guardados como intervalos para não contar em dobro (apontamentos repetidos ou indisponibilidade sobreposta ao almoço) */
      const tAl = tipoCk != null ? String(tipoCk).trim() : null;
      if (ini != null && tt > 0 && (tAl === 'Intervalo para almoço' || tAl === 'Indisponibilidade')) { const k2 = data + '|' + rec, o = iv[k2] || (iv[k2] = { d: data, r: rec, a: [], i: [] }); (tAl === 'Indisponibilidade' ? o.i : o.a).push([ini, ini + tt]); }
      linhas++;
    }
    const uni = l => { const s = l.slice().sort((x, y) => x[0] - y[0]), o = []; for (const q of s) { const u = o[o.length - 1]; if (u && q[0] <= u[1]) u[1] = Math.max(u[1], q[1]); else o.push([q[0], q[1]]); } return o; };
    const soma = l => l.reduce((t, q) => t + (q[1] - q[0]), 0);
    const inter = (A, B) => { let t = 0; for (const x of A) for (const y of B) t += Math.max(0, Math.min(x[1], y[1]) - Math.max(x[0], y[0])); return t; };
    for (const k in iv) { const o = iv[k], A = uni(o.a), I = uni(o.i), a = dias[o.d][o.r]; a[3] = soma(A); a[4] = Math.max(0, soma(I) - inter(A, I)); }
    return { dias, linhas };
  }

  function juntar(a, b) {
    if (!a) return b.slice();
    const mn = (x, y) => (x == null ? y : y == null ? x : Math.min(x, y));
    const mx = (x, y) => (x == null ? y : y == null ? x : Math.max(x, y));
    return [mn(a[0], b[0]), mx(a[1], b[1]), mx(a[2], b[2]), a[3] + b[3], a[4] + b[4], mn(a[5], b[5])];
  }

  /* diasAgg: {iso:{recurso:agg}}; recursos: lista de todos os recursos vistos na base */
  function calcularResumo(cfg, diasAgg, recursos) {
    const datas = Object.keys(diasAgg).sort();
    if (!datas.length) return [];
    const fim = datas[datas.length - 1];
    const lista = []; for (let d = cfg.inicio; d <= fim; d = addDays(d, 1)) lista.push(d);
    const out = [];
    for (const rec of recursos) {
      const p = cfg.prefixos[rec];
      if (!p || !p.b) continue;
      for (const data of lista) {
        const a = (diasAgg[data] && diasAgg[data][rec]) || null;
        const wd = weekdayIdx(data);
        /* Início = 1º checklist do dia; sem checklist (dados antigos ou equipe que não abriu), vale a regra anterior: menor início de qualquer atividade */
        const ini = a ? (a[5] != null ? a[5] : (a[0] != null ? a[0] : 0)) : 0;
        const fimT = a ? (a[2] != null ? a[2] : (a[1] != null ? a[1] : 0)) : 0;
        const disp = fimT < ini ? 0 : fimT - ini;
        let alm = a ? a[3] : 0;
        if (alm === 0 && wd < 5 && p.g === 'GOMAN') alm = 120;
        const ind = a ? a[4] : 0;
        const real = disp < 0 ? 0 : (alm + ind > disp ? 0 : disp - alm - ind);
        const feriado = cfg.folgas[p.b + '|' + p.e + '|' + data] || cfg.feriados[data] || '';
        const jor = p.j[wd];
        const prev = feriado === '' ? jor : (p.e.includes('PLANTÃO') ? jor : 0);
        out.push({ rec, data, mes: data.slice(0, 7), dia: DIAS[wd], base: p.b, ger: p.g, est: p.e, ini: a ? ini : null, fim: a ? fimT : null, disp, alm, ind, real, prev: prev == null ? 0 : prev, feriado, ativo: !!a });
      }
    }
    return out;
  }

  function classificar(p) {
    if (p == null || isNaN(p)) return { txt: 'Sem dados', cls: 'nd' };
    if (p >= 0.98) return { txt: 'Supera esperado', cls: 'sup' };
    if (p > 0.93) return { txt: 'Atende esperado', cls: 'ate' };
    if (p > 0.85) return { txt: 'Atende parcial', cls: 'par' };
    return { txt: 'Não atende', cls: 'nao' };
  }

  const api = { DIAS, parseData, parseHora, fonteDoArquivo, agregarArquivo, juntar, calcularResumo, classificar, addDays };
  if (typeof module !== 'undefined') module.exports = api; else root.Disp = api;
})(this);
