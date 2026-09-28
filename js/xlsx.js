/* BowlBoard spreadsheet reader — just enough of .xlsx to import league exports.
 * No library: an .xlsx file is a zip of XML parts. This reads the zip directory,
 * inflates entries with the built-in DecompressionStream, and pulls cell values
 * out of the first sheet (shared strings, inline strings, numbers, booleans).
 * Runs in modern browsers and Node 18+.
 *
 *   BBXlsx.read(arrayBuffer) -> Promise<{ sheets: [{ name, rows: [[cell, ...], ...] }] }>
 */
(function (global) {
  'use strict';

  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const utf8 = bytes => new TextDecoder('utf-8').decode(bytes);
  // Errors meant for the person importing: plain sentences. Anything else becomes "damaged".
  const fail = msg => Object.assign(new Error(msg), { friendly: true });

  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
    return new Uint8Array(await out.arrayBuffer());
  }

  // Map of entry name -> () => Promise<Uint8Array>
  function unzip(buf) {
    const b = new Uint8Array(buf);
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
      if (u32(b, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw fail('This isn’t an Excel (.xlsx) file.');
    const count = u16(b, eocd + 10);
    let p = u32(b, eocd + 16);
    const files = {};
    for (let n = 0; n < count; n++) {
      if (u32(b, p) !== 0x02014b50) throw fail('The spreadsheet file looks damaged. Try exporting it again.');
      const method = u16(b, p + 10), csize = u32(b, p + 20), nlen = u16(b, p + 28), xlen = u16(b, p + 30), clen = u16(b, p + 32);
      const local = u32(b, p + 42);
      const name = utf8(b.subarray(p + 46, p + 46 + nlen));
      files[name] = () => {
        const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
        const data = b.subarray(start, start + csize);
        if (method === 0) return Promise.resolve(data);
        if (method === 8) return inflateRaw(data);
        return Promise.reject(fail('This spreadsheet uses compression BowlBoard can’t read. Save it again from Excel, or as CSV.'));
      };
      p += 46 + nlen + xlen + clen;
    }
    return files;
  }

  const unescape = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&amp;/g, '&');
  const textOf = xml => { let t = ''; xml.replace(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, (_, v) => { t += v; return ''; }); return unescape(t); };

  function colIndex(ref) {
    const letters = (ref.match(/^[A-Z]+/) || ['A'])[0];
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  function parseSheet(xml, shared) {
    const rows = [];
    xml.replace(/<row\b[^>]*>([\s\S]*?)<\/row>/g, (_, inner) => {
      const row = [];
      inner.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (m, attrs, body) => {
        const ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1];
        const type = (attrs.match(/\bt="(\w+)"/) || [])[1];
        const v = body ? (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1] : undefined;
        let val = null;
        if (type === 's') val = v == null ? null : shared[+v];
        else if (type === 'inlineStr') val = textOf(body || '');
        else if (type === 'str') val = v == null ? null : unescape(v);
        else if (type === 'b') val = v === '1';
        else if (v != null) { const n = Number(v); val = Number.isFinite(n) ? n : unescape(v); }
        row[ref ? colIndex(ref) : row.length] = val;
        return '';
      });
      for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = null;
      rows.push(row);
      return '';
    });
    return rows;
  }

  function read(buf) {
    return readFile(buf).catch(e => {
      throw e && e.friendly ? e : fail('The spreadsheet file looks damaged. Try exporting it again.');
    });
  }
  async function readFile(buf) {
    const files = unzip(buf);
    const get = async name => (files[name] ? utf8(await files[name]()) : null);
    const wbXml = await get('xl/workbook.xml');
    if (!wbXml) throw fail('This isn’t an Excel (.xlsx) file.');
    const sharedXml = await get('xl/sharedStrings.xml');
    const shared = [];
    if (sharedXml) sharedXml.replace(/<si>([\s\S]*?)<\/si>/g, (_, si) => { shared.push(textOf(si)); return ''; });
    const relsXml = (await get('xl/_rels/workbook.xml.rels')) || '';
    const rels = {};
    relsXml.replace(/<Relationship\b([^>]*)\/?>/g, (_, a) => {
      const id = (a.match(/\bId="([^"]+)"/) || [])[1], target = (a.match(/\bTarget="([^"]+)"/) || [])[1];
      if (id && target) rels[id] = target.replace(/^\/?(xl\/)?/, 'xl/');
      return '';
    });
    const sheets = [];
    const defs = [];
    wbXml.replace(/<sheet\b([^>]*)\/?>/g, (_, a) => {
      defs.push({ name: unescape((a.match(/\bname="([^"]*)"/) || [])[1] || 'Sheet'), rid: (a.match(/\br:id="([^"]+)"/) || [])[1] });
      return '';
    });
    for (let i = 0; i < defs.length; i++) {
      const path = rels[defs[i].rid] || 'xl/worksheets/sheet' + (i + 1) + '.xml';
      const xml = await get(path);
      if (xml) sheets.push({ name: defs[i].name, rows: parseSheet(xml, shared) });
    }
    return { sheets };
  }

  // Excel stores dates as days since 1899-12-30.
  function serialToISO(n) {
    const d = new Date(Math.round((n - 25569) * 864e5));
    return d.toISOString().slice(0, 10);
  }

  const X = { read, serialToISO };
  if (typeof module !== 'undefined' && module.exports) module.exports = X;
  else global.BBXlsx = X;
})(typeof window !== 'undefined' ? window : globalThis);
