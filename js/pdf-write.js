/* BowlBoard — a small PDF writer: pages of text, lines and rectangles in the standard
 * Helvetica fonts (nothing to embed, so files stay small). No DOM: runs in Node for the tests.
 *
 *   const doc = BBPdf.create({ title, author, size: 'letter' | 'a4' });
 *   const page = doc.addPage();                  // y is measured from the top of the page
 *   page.text(x, y, 'Hello', { size: 12, bold: true, color: '#121416', align: 'left' | 'right' | 'center' });
 *   page.rect(x, y, w, h, { fill: '#F6A623', stroke: '#000', width: 0.5 });
 *   page.line(x1, y1, x2, y2, { color, width });
 *   doc.measure('Hello', 12, true)               // width in points
 *   doc.build()                                  // -> Uint8Array
 */
(function (global) {
  'use strict';

  // Advance widths (1/1000 em) for characters 32..255 in Windows-1252, from the Helvetica metrics.
  const W_REG = [
    278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,
    1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,
    667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,
    333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,
    556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,761,
    556,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,
    0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,667,
    278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,
    400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,
    667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,
    722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,
    556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,
    556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500];
  const W_BOLD = [
    278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,
    975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,
    667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,
    333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,
    611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,761,
    556,0,278,556,500,1000,556,556,333,1000,667,333,1000,0,611,0,
    0,278,278,500,500,350,556,1000,333,1000,556,333,944,0,500,667,
    278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,
    400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,
    722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,
    722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,
    556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,
    611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556];

  // Windows-1252 code points that aren't in Latin-1
  const CP1252 = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
    0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
  // A character as a Windows-1252 byte; anything the fonts don't have becomes '?'.
  function code(ch) {
    const c = ch.codePointAt(0);
    if (c === 0x2212) return 0x2D;                // minus sign -> hyphen
    if (c === 0x2192) return 0x3E;                // arrow -> >
    if (c === 0x00A0 || c === 0x202F || c === 0x2009) return 0x20;
    if (c >= 32 && c < 127) return c;
    if (c >= 160 && c <= 255) return c;
    if (CP1252[c]) return CP1252[c];
    return 0x3F;
  }
  const bytesOf = str => Array.from(String(str == null ? '' : str)).filter(ch => ch >= ' ' || ch === '\t').map(code);

  const SIZES = { letter: [612, 792], a4: [595.28, 841.89] };
  const num = n => (Math.round(n * 100) / 100).toString();
  function rgb(c) {
    if (Array.isArray(c)) return c.map(num).join(' ');
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c || '');
    if (!m) return '0 0 0';
    return [1, 2, 3].map(i => num(parseInt(m[i], 16) / 255)).join(' ');
  }

  function create(opts) {
    opts = opts || {};
    const [W, H] = SIZES[opts.size] || SIZES.letter;
    const pages = [];

    function measure(str, size, bold) {
      const t = bold ? W_BOLD : W_REG;
      let w = 0;
      bytesOf(str).forEach(b => { w += t[b - 32] || 0; });
      return w * size / 1000;
    }
    // Shorten with an ellipsis until it fits.
    function fit(str, maxWidth, size, bold) {
      str = String(str == null ? '' : str);
      if (measure(str, size, bold) <= maxWidth) return str;
      let s = Array.from(str);
      while (s.length > 1 && measure(s.join('') + '…', size, bold) > maxWidth) s.pop();
      return s.join('').replace(/\s+$/, '') + '…';
    }

    function addPage() {
      const ops = [];
      const page = {
        width: W, height: H,
        text(x, y, str, o) {
          o = o || {};
          const size = o.size || 10, bold = !!o.bold;
          const w = measure(str, size, bold);
          const px = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
          const lit = bytesOf(str).map(b => (b === 0x5C || b === 0x28 || b === 0x29 ? '\\' + String.fromCharCode(b) : b < 32 || b > 126 ? '\\' + b.toString(8).padStart(3, '0') : String.fromCharCode(b))).join('');
          ops.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + num(size) + ' Tf ' + rgb(o.color || '#000000') + ' rg ' + num(px) + ' ' + num(H - y) + ' Td (' + lit + ') Tj ET');
        },
        rect(x, y, w, h, o) {
          o = o || {};
          if (o.fill) ops.push(rgb(o.fill) + ' rg ' + num(x) + ' ' + num(H - y - h) + ' ' + num(w) + ' ' + num(h) + ' re f');
          if (o.stroke) ops.push(rgb(o.stroke) + ' RG ' + num(o.width || 0.5) + ' w ' + num(x) + ' ' + num(H - y - h) + ' ' + num(w) + ' ' + num(h) + ' re S');
        },
        line(x1, y1, x2, y2, o) {
          o = o || {};
          ops.push(rgb(o.color || '#000000') + ' RG ' + num(o.width || 0.5) + ' w ' + num(x1) + ' ' + num(H - y1) + ' m ' + num(x2) + ' ' + num(H - y2) + ' l S');
        },
        ops,
      };
      pages.push(page);
      return page;
    }

    // Objects: 1 catalog, 2 page tree, 3 regular font, 4 bold font, 5 info, then a page + its content per page.
    function build() {
      const objs = [];
      const add = body => { objs.push(body); return objs.length; };
      add('<< /Type /Catalog /Pages 2 0 R >>');
      add('PAGES');
      add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
      add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
      const d = new Date();
      const stamp = 'D:' + d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0') + String(d.getUTCHours()).padStart(2, '0') + String(d.getUTCMinutes()).padStart(2, '0') + String(d.getUTCSeconds()).padStart(2, '0') + 'Z';
      const lit = s => '(' + bytesOf(s).map(b => (b === 0x5C || b === 0x28 || b === 0x29 ? '\\' + String.fromCharCode(b) : b < 32 || b > 126 ? '\\' + b.toString(8).padStart(3, '0') : String.fromCharCode(b))).join('') + ')';
      // Title and author are PDF "text strings": plain ASCII, or UTF-16 with a byte-order mark for anything else
      // (the page fonts' Windows-1252 codes would show as the wrong characters in a viewer's title bar).
      const info = s => {
        s = String(s == null ? '' : s).replace(/[\u0000-\u001F]/g, ' ');
        if (/^[\x20-\x7E]*$/.test(s)) return lit(s);
        let h = 'FEFF';
        for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
        return '<' + h + '>';
      };
      add('<< /Title ' + info(opts.title || 'BowlBoard') + ' /Author ' + info(opts.author || 'BowlBoard') + ' /Creator (BowlBoard) /Producer (BowlBoard) /CreationDate (' + stamp + ') >>');
      const kids = [];
      pages.forEach(pg => {
        const stream = pg.ops.join('\n');
        const pageNo = objs.length + 1;
        kids.push(pageNo + ' 0 R');
        add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + num(W) + ' ' + num(H) + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + (pageNo + 1) + ' 0 R >>');
        add('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
      });
      objs[1] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages.length + ' >>';
      let out = '%PDF-1.4\n%âãÏÓ\n';
      const offsets = [];
      objs.forEach((body, i) => { offsets.push(out.length); out += (i + 1) + ' 0 obj\n' + body + '\nendobj\n'; });
      const xref = out.length;
      out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
      out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R /Info 5 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
      const bytes = new Uint8Array(out.length);
      for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
      return bytes;
    }

    return { width: W, height: H, addPage, measure, fit, build, get pageCount() { return pages.length; } };
  }

  const Pdf = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = Pdf;
  else global.BBPdf = Pdf;
})(typeof window !== 'undefined' ? window : globalThis);
