/* BowlBoard spreadsheet writer — just enough of .xlsx to export games.
 * An .xlsx file is a zip of XML parts; this writes the zip itself (stored, not compressed,
 * which every reader accepts) so no library is needed. Runs in browsers and in Node.
 *
 *   BBXlsxWrite.build({ sheets: [{ name, header: ['Date', ...], rows: [[cell, ...]], widths: [12, ...] }] })  -> Uint8Array
 *
 * A cell is a string, a number, null, or { date: 'YYYY-MM-DD' } (stored as a real date).
 */
(function (global) {
  'use strict';

  const enc = new TextEncoder();

  /* ---------- zip (store only) ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  const u16 = n => [n & 255, (n >>> 8) & 255];
  const u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

  function zip(files, when) {
    const d = when || new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const chunks = [], central = [];
    let offset = 0;
    files.forEach(f => {
      const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const local = Uint8Array.from([].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(time), u16(date), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0)));
      chunks.push(local, name, data);
      central.push(Uint8Array.from([].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(time), u16(date), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset))), name);
      offset += local.length + name.length + data.length;
    });
    const cdSize = central.reduce((a, c) => a + c.length, 0);
    const end = Uint8Array.from([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cdSize), u32(offset), u16(0)));
    const all = chunks.concat(central, [end]);
    const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
    let p = 0;
    all.forEach(c => { out.set(c, p); p += c.length; });
    return out;
  }

  /* ---------- sheet xml ---------- */
  const esc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const colName = i => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
  const serial = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 + 25569 : null; };
  const STYLE = { none: 0, header: 1, date: 2 };

  function cellXML(ref, v, style) {
    const s = style ? ' s="' + style + '"' : '';
    if (v == null || v === '') return style ? '<c r="' + ref + '"' + s + '/>' : '';
    if (typeof v === 'number') return Number.isFinite(v) ? '<c r="' + ref + '"' + s + '><v>' + v + '</v></c>' : '';
    if (typeof v === 'object' && v.date) { const n = serial(v.date); return n == null ? '' : '<c r="' + ref + '" s="' + STYLE.date + '"><v>' + n + '</v></c>'; }
    const t = String(v);
    return '<c r="' + ref + '" t="inlineStr"' + s + '><is><t xml:space="preserve">' + esc(t) + '</t></is></c>';
  }
  function sheetXML(sh) {
    const width = Math.max((sh.header || []).length, ...sh.rows.map(r => r.length), 1);
    const last = colName(width - 1) + (sh.rows.length + 1);
    let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<dimension ref="A1:' + last + '"/>' +
      '<sheetViews><sheetView workbookViewId="0">' + (sh.header ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : '') + '</sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/>';
    if (sh.widths) x += '<cols>' + sh.widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>';
    x += '<sheetData>';
    let r = 1;
    if (sh.header) { x += '<row r="1">' + sh.header.map((h, i) => cellXML(colName(i) + 1, h, STYLE.header)).join('') + '</row>'; r = 2; }
    sh.rows.forEach(row => {
      x += '<row r="' + r + '">' + row.map((v, i) => cellXML(colName(i) + r, v, 0)).join('') + '</row>';
      r++;
    });
    x += '</sheetData>' + (sh.header && sh.rows.length ? '<autoFilter ref="A1:' + last + '"/>' : '') + '</worksheet>';
    return x;
  }

  const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF6A623"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  // Excel sheet names: up to 31 characters, none of  \ / ? * [ ] :  and each one different
  function sheetNames(sheets) {
    const seen = new Set();
    return sheets.map((s, i) => {
      let n = String(s.name || 'Sheet' + (i + 1)).replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet' + (i + 1);
      while (seen.has(n.toLowerCase())) n = (n.slice(0, 28) + ' ' + (i + 1)).slice(0, 31);
      seen.add(n.toLowerCase());
      return n;
    });
  }

  function build(book, when) {
    const sheets = book.sheets;
    const names = sheetNames(sheets);
    const files = [
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        sheets.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        names.map((n, i) => '<sheet name="' + esc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
        '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', data: STYLES },
    ].concat(sheets.map((s, i) => ({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sheetXML(s) })));
    return zip(files, when);
  }

  const XlsxWrite = { build, zip, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = XlsxWrite;
  else global.BBXlsxWrite = XlsxWrite;
})(typeof window !== 'undefined' ? window : globalThis);
