'use strict';
/* Leitor de .xlsx em fluxo, para planilhas muito grandes (centenas de MB / milhões de células).
   Não carrega o arquivo na memória: lê o zip pelo diretório central, descompacta só a aba pedida, em pedaços,
   e entrega uma linha por vez. Entende texto embutido (inlineStr), textos compartilhados, números e datas.
   Limites: zip64 (arquivos acima de 4 GB) não é suportado. */
const fs = require('fs');
const zlib = require('zlib');
const { StringDecoder } = require('string_decoder');

const ASSINATURAS = { EOCD: 0x06054b50, CENTRAL: 0x02014b50, LOCAL: 0x04034b50 };

function lerDiretorio(fd, tamanho) {
  const n = Math.min(tamanho, 65557), buf = Buffer.alloc(n);
  fs.readSync(fd, buf, 0, n, tamanho - n);
  const i = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (i < 0) throw new Error('O arquivo não é um .xlsx válido (zip não encontrado).');
  const total = buf.readUInt16LE(i + 10), tamCD = buf.readUInt32LE(i + 12), offCD = buf.readUInt32LE(i + 16);
  if (total === 0xFFFF || tamCD === 0xFFFFFFFF || offCD === 0xFFFFFFFF) throw new Error('Arquivo zip64 (acima de 4 GB) não é suportado.');
  const cd = Buffer.alloc(tamCD);
  fs.readSync(fd, cd, 0, tamCD, offCD);
  const entradas = new Map();
  let p = 0;
  for (let k = 0; k < total; k++) {
    if (cd.readUInt32LE(p) !== ASSINATURAS.CENTRAL) throw new Error('Diretório do zip corrompido.');
    const metodo = cd.readUInt16LE(p + 10), comp = cd.readUInt32LE(p + 20), desc = cd.readUInt32LE(p + 24);
    const nl = cd.readUInt16LE(p + 28), el = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32), off = cd.readUInt32LE(p + 42);
    entradas.set(cd.toString('utf8', p + 46, p + 46 + nl), { metodo, comp, desc, off });
    p += 46 + nl + el + cl;
  }
  return entradas;
}

function decodifica(s) {
  if (s.indexOf('&') < 0 && s.indexOf('_x') < 0) return s;
  return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (m, e) => {
    if (e === 'amp') return '&'; if (e === 'lt') return '<'; if (e === 'gt') return '>'; if (e === 'quot') return '"'; if (e === 'apos') return "'";
    return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  }).replace(/_x([0-9A-Fa-f]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
}

const atributos = tag => { const o = {}; tag.replace(/([\w:]+)="([^"]*)"/g, (m, k, v) => { o[k] = decodifica(v); return m; }); return o; };
const colunaParaIndice = letras => { let n = 0; for (let i = 0; i < letras.length; i++) n = n * 26 + (letras.charCodeAt(i) - 64); return n - 1; };
const dois = n => String(n).padStart(2, '0');

/* número serial do Excel -> "dd/mm/aaaa" (ou "dd/mm/aaaa hh:mm" quando há hora) */
function serialParaTexto(v) {
  const dias = Math.floor(v), frac = v - dias;
  const d = new Date(Math.round((dias - 25569) * 86400000));
  let s = dois(d.getUTCDate()) + '/' + dois(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
  if (frac > 1e-9) { const min = Math.round(frac * 1440); s += ' ' + dois(Math.floor(min / 60) % 24) + ':' + dois(min % 60); }
  return s;
}

function abrirXlsx(caminho) {
  const tamanho = fs.statSync(caminho).size;
  const fd = fs.openSync(caminho, 'r');
  const entradas = lerDiretorio(fd, tamanho);

  function fluxo(nome) {
    const e = entradas.get(nome);
    if (!e) throw new Error('Parte "' + nome + '" não existe no arquivo.');
    const cab = Buffer.alloc(30);
    fs.readSync(fd, cab, 0, 30, e.off);
    if (cab.readUInt32LE(0) !== ASSINATURAS.LOCAL) throw new Error('Cabeçalho do zip corrompido em ' + nome);
    const ini = e.off + 30 + cab.readUInt16LE(26) + cab.readUInt16LE(28);
    const bruto = fs.createReadStream(caminho, { start: ini, end: ini + e.comp - 1, highWaterMark: 1 << 20 });
    if (e.metodo === 0) return bruto;
    if (e.metodo !== 8) throw new Error('Compressão não suportada em ' + nome);
    const inf = zlib.createInflateRaw();
    bruto.on('error', er => inf.destroy(er));
    return bruto.pipe(inf);
  }
  async function texto(nome) {
    const dec = new StringDecoder('utf8'); let s = '';
    for await (const c of fluxo(nome)) s += dec.write(c);
    return s + dec.end();
  }

  let meta = null;
  async function carregaMeta() {
    if (meta) return meta;
    const wb = await texto('xl/workbook.xml');
    const rels = await texto('xl/_rels/workbook.xml.rels');
    const alvo = {};
    for (const m of rels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) { const a = atributos(m[1]); if (a.Id) alvo[a.Id] = a.Target; }
    const abas = [];
    for (const m of wb.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
      const a = atributos(m[1]); let t = alvo[a['r:id']] || '';
      t = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.?\/?/, '');
      abas.push({ nome: a.name, parte: t });
    }
    // estilos: quais formatos de célula são datas
    const datas = new Set();
    if (entradas.has('xl/styles.xml')) {
      const st = await texto('xl/styles.xml'), fmt = {};
      for (const m of st.matchAll(/<numFmt\b([^>]*?)\/?>/g)) { const a = atributos(m[1]); fmt[a.numFmtId] = a.formatCode || ''; }
      const xfs = (st.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/) || [])[1] || '';
      let i = 0;
      for (const m of xfs.matchAll(/<xf\b([^>]*?)\/?>/g)) {
        const id = Number(atributos(m[1]).numFmtId || 0);
        const embutido = (id >= 14 && id <= 22) || (id >= 45 && id <= 47);
        const custom = fmt[id] && /[dmyhs]/i.test(fmt[id].replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')) && !/general/i.test(fmt[id]);
        if (embutido || custom) datas.add(i);
        i++;
      }
    }
    // textos compartilhados (quando existirem)
    let compartilhados = null;
    if (entradas.has('xl/sharedStrings.xml')) {
      const ss = await texto('xl/sharedStrings.xml'); compartilhados = [];
      for (const m of ss.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) { let t = ''; for (const x of m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) t += x[1]; compartilhados.push(decodifica(t)); }
    }
    return (meta = { abas, datas, compartilhados });
  }

  /* Lê a aba linha por linha. aoLinha(valores, numeroDaLinha) recebe um array por coluna (undefined = vazia).
     Se aoLinha devolver false, a leitura para. */
  async function lerAba(nomeAba, aoLinha) {
    const { abas, datas, compartilhados } = await carregaMeta();
    const aba = abas.find(a => a.nome === nomeAba);
    if (!aba) throw new Error('Aba "' + nomeAba + '" não encontrada. Abas: ' + abas.map(a => a.nome).join(', '));
    const dec = new StringDecoder('utf8');
    const reCel = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let resto = '', n = 0, parar = false;

    const valorCelula = (attrs, corpo) => {
      if (!corpo) return undefined;
      const t = /\bt="(\w+)"/.exec(attrs);
      const tipo = t ? t[1] : 'n';
      if (tipo === 'inlineStr') { let s = ''; for (const x of corpo.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) s += x[1]; return decodifica(s); }
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(corpo);
      if (!v) return undefined;
      if (tipo === 's') return compartilhados ? compartilhados[Number(v[1])] : undefined;
      if (tipo === 'str' || tipo === 'e') return decodifica(v[1]);
      if (tipo === 'b') return v[1] === '1';
      const num = Number(v[1]);
      if (Number.isNaN(num)) return decodifica(v[1]);
      const s = /\bs="(\d+)"/.exec(attrs);
      return s && datas.has(Number(s[1])) ? serialParaTexto(num) : num;
    };
    const processa = fragmento => { // uma <row>…</row>
      const linha = [];
      reCel.lastIndex = 0;
      let m;
      while ((m = reCel.exec(fragmento))) {
        const r = /\br="([A-Z]+)\d+"/.exec(m[1]);
        if (!r) continue;
        const v = valorCelula(m[1], m[2]);
        if (v !== undefined) linha[colunaParaIndice(r[1])] = v;
      }
      n++;
      return aoLinha(linha, n);
    };

    for await (const pedaco of fluxo(aba.parte)) {
      resto += dec.write(pedaco);
      for (;;) {
        const i = resto.indexOf('<row', 0);
        if (i < 0) { resto = resto.slice(Math.max(0, resto.length - 8)); break; }
        const fimTag = resto.indexOf('>', i);
        if (fimTag < 0) { resto = resto.slice(i); break; }
        if (resto.charCodeAt(fimTag - 1) === 47) { resto = resto.slice(fimTag + 1); continue; } // <row …/> vazia
        const j = resto.indexOf('</row>', fimTag);
        if (j < 0) { resto = resto.slice(i); break; }
        const r = await processa(resto.slice(fimTag + 1, j));
        resto = resto.slice(j + 6);
        if (r === false) { parar = true; break; }
      }
      if (parar) break;
    }
    return n;
  }

  return { abas: async () => (await carregaMeta()).abas.map(a => a.nome), lerAba, fechar: () => { try { fs.closeSync(fd); } catch (e) { /* já fechado */ } } };
}

module.exports = { abrirXlsx, serialParaTexto, colunaParaIndice, decodifica };
