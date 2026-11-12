'use strict';
const XLSX = require('xlsx');

/* Gera um .xlsx de COI com as colunas principais (inclui "Tipo de Atividade" duas vezes, como o SIGA) */
function planilhaCOI(linhas) {
  const cab = ['Recurso', 'Data', 'Status da Atividade', 'Cidade', 'Início', 'Fim', 'Data Limite', 'Duração', 'Tempo de Deslocamento', 'Tipo de Atividade', 'Tipo de Atividade', 'Ordem de Serviço'];
  const aoa = [cab, ...linhas.map(l => [l.rec, l.data, l.status || 'concluído', l.cidade || 'BACABAL', '08:00', '09:00', '', '01:00', '00:10', l.tipo || 'LIGANOVA', l.tipo2 || 'Ligação Nova', l.os || 'OS' + Math.random().toString(36).slice(2, 7)])];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Page 1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/* Origem falsa (no lugar do OneDrive): itens + conteúdo por id */
function origemFalsa(itens) {
  const arquivos = new Map(itens.map(i => [i.id, i]));
  return {
    chamadasListar: 0, chamadasBaixar: 0,
    async listar() { this.chamadasListar++; return [...arquivos.values()].map(({ buffer, ...resto }) => resto); },
    async baixar(item) { this.chamadasBaixar++; const a = arquivos.get(item.id); if (a.falha) throw new Error(a.falha); return a.buffer; },
    troca(id, parcial) { arquivos.set(id, { ...arquivos.get(id), ...parcial }); }
  };
}

const item = (id, nome, buffer, extra = {}) => ({ id, nome, buffer, tamanho: buffer ? buffer.length : 0, etag: 'e1', modificado: '2026-11-10T10:00:00Z', caminho: nome, ...extra });

module.exports = { planilhaCOI, origemFalsa, item };

/* ---------- gerador de .xlsx no formato do consolidado (texto embutido, células vazias omitidas, datas como número) ---------- */
const zlib = require('zlib');
const TABELA_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = buf => { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

function criarZip(arquivos) { // [{nome, conteudo(string|Buffer)}]
  const locais = [], centrais = []; let off = 0;
  for (const a of arquivos) {
    const nome = Buffer.from(a.nome), dados = Buffer.isBuffer(a.conteudo) ? a.conteudo : Buffer.from(a.conteudo, 'utf8');
    const comp = zlib.deflateRawSync(dados), crc = crc32(dados);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0, 6); h.writeUInt16LE(8, 8); h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(dados.length, 22); h.writeUInt16LE(nome.length, 26);
    locais.push(h, nome, comp);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(dados.length, 24); c.writeUInt16LE(nome.length, 28); c.writeUInt32LE(off, 42);
    centrais.push(c, nome); off += 30 + nome.length + comp.length;
  }
  const cd = Buffer.concat(centrais), fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10); fim.writeUInt32LE(cd.length, 12); fim.writeUInt32LE(off, 16);
  return Buffer.concat([...locais, cd, fim]);
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const letra = i => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

/* abas: { NOME: [ [valores…], … ] }  — valor: texto, número, {data: serialDoExcel} ou null/undefined (vazio, omitido).
   Uma linha totalmente nula vira <row/> vazia. */
function xlsxConsolidado(abas) {
  const nomes = Object.keys(abas);
  const linhaXml = (cels, r) => {
    const partes = cels.map((v, i) => {
      if (v == null || v === '') return '';
      const ref = letra(i) + r;
      if (typeof v === 'object' && v.data != null) return `<c r="${ref}" s="2"><v>${v.data}</v></c>`;
      if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
    }).join('');
    return partes ? `<row r="${r}">${partes}</row>` : `<row r="${r}"/>`;
  };
  const planilha = linhas => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:Z${linhas.length}"/><sheetData>${linhas.map((l, i) => linhaXml(l, i + 1)).join('')}</sheetData></worksheet>`;
  const arquivos = [
    { nome: '[Content_Types].xml', conteudo: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>' },
    { nome: 'xl/workbook.xml', conteudo: `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${nomes.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { nome: 'xl/_rels/workbook.xml.rels', conteudo: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${nomes.map((n, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml" Type="x"/>`).join('')}</Relationships>` },
    { nome: 'xl/styles.xml', conteudo: '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="0" applyFont="1"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>' },
    ...nomes.map((n, i) => ({ nome: `xl/worksheets/sheet${i + 1}.xml`, conteudo: planilha(abas[n]) }))
  ];
  return criarZip(arquivos);
}

/* serial do Excel de uma data ISO */
const serial = iso => Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000) + 25569;

module.exports.xlsxConsolidado = xlsxConsolidado;
module.exports.serial = serial;
module.exports.criarZip = criarZip;
