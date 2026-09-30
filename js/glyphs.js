/* BowlBoard glyph reader — pure, no DOM, runs in Node.
 *
 * A second, offline way to read a lane screen. The photo is already a black-and-white
 * mask (see prepare() in ui/photo.js). Here we
 *   1. erase the long horizontal and vertical bars (frame borders, bands) that touch
 *      the digits,
 *   2. cut the mask into connected blobs, split the ones that are two glyphs stuck
 *      together, and group blobs into text lines,
 *   3. name each blob with a tiny neural net (js/glyph-model.js): 0-9 X / - F or junk.
 * Tall, condensed scoreboard fonts that a general text reader can't handle come out
 * fine because every glyph is classified on its own shape.
 * Output lines are { text, confs, y, h } — the same shape Scan.linesFromOCR makes.
 */
(function (global) {
  'use strict';
  const MODEL = (typeof module !== 'undefined' && module.exports) ? require('./glyph-model.js') : global.BBGlyphModel;

  /* ---------- connected components (8-neighbour) ---------- */
  function label(mask, W, H) {
    const lab = new Int32Array(W * H), parent = [0];
    const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    let n = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!mask[i]) continue;
      let m = 0;
      const nb = [x > 0 ? lab[i - 1] : 0, y > 0 && x > 0 ? lab[i - W - 1] : 0, y > 0 ? lab[i - W] : 0, y > 0 && x < W - 1 ? lab[i - W + 1] : 0];
      for (const v of nb) if (v) { const r = find(v); if (!m) m = r; else if (r !== m) { if (r < m) { parent[m] = r; m = r; } else parent[r] = m; } }
      if (!m) { n++; parent.push(n); lab[i] = n; } else lab[i] = m;
    }
    const map = new Int32Array(n + 1); let k = 0;
    for (let v = 1; v <= n; v++) if (find(v) === v) map[v] = ++k;
    for (let v = 1; v <= n; v++) map[v] = map[find(v)];
    const boxes = Array.from({ length: k + 1 }, () => ({ x0: 1e9, y0: 1e9, x1: -1, y1: -1, area: 0 }));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, v = lab[i]; if (!v) continue;
      const id = map[v]; lab[i] = id; const b = boxes[id];
      if (x < b.x0) b.x0 = x; if (x >= b.x1) b.x1 = x + 1; if (y < b.y0) b.y0 = y; if (y >= b.y1) b.y1 = y + 1; b.area++;
    }
    boxes.forEach((b, i) => { b.id = i; b.w = b.x1 - b.x0; b.h = b.y1 - b.y0; });
    return { lab, n: k, boxes };
  }
  function median(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; }
  const scaleOf = W => W / 1600;

  /* ---------- bar removal ---------- */
  function glyphStats(mask, W, H) {
    const s = scaleOf(W), L = label(mask, W, H);
    const g = L.boxes.filter((b, i) => i && b.area >= 150 * s * s && b.h >= 25 * s && b.h <= 160 * s && b.w <= b.h * 1.4);
    return { mw: g.length ? median(g.map(b => b.w)) : 30 * s, mh: g.length ? median(g.map(b => b.h)) : 66 * s, n: g.length };
  }
  function removeBars(mask, W, H) {
    const s = scaleOf(W), st = glyphStats(mask, W, H);
    const L = Math.round(Math.min(130 * s, Math.max(60 * s, 2.3 * st.mw))), Lv = Math.round(3.2 * st.mh);
    const kill = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) { // horizontal runs
      let x = 0;
      while (x < W) {
        if (!mask[y * W + x]) { x++; continue; }
        let e = x; while (e < W && mask[y * W + e]) e++;
        if (e - x >= L) for (let k = x; k < e; k++) kill[y * W + k] = 1;
        x = e;
      }
    }
    for (let x = 0; x < W; x++) { // vertical runs
      let y = 0;
      while (y < H) {
        if (!mask[y * W + x]) { y++; continue; }
        let e = y; while (e < H && mask[e * W + x]) e++;
        if (e - y >= Lv) for (let k = y; k < e; k++) kill[k * W + x] = 1;
        y = e;
      }
    }
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!mask[i]) continue;
      let hit = false;
      for (let dy = -1; dy <= 1 && !hit; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx >= 0 && xx < W && kill[yy * W + xx]) { hit = true; break; } } }
      if (!hit) out[i] = 1;
    }
    return out;
  }

  /* ---------- classifier ---------- */
  // bits: Uint8Array h*w (1 = ink), tight crop. Must match tools/train_glyphs.py features().
  function features(bits, w, h, relh) {
    const GW = MODEL.gw, GH = MODEL.gh, out = new Float64Array(GW * GH + 2);
    const I = new Float64Array((h + 1) * (w + 1));
    for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += bits[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
    const S = (y, x) => {
      const y0 = Math.floor(y), x0 = Math.floor(x), fy = y - y0, fx = x - x0, y1 = Math.min(y0 + 1, h), x1 = Math.min(x0 + 1, w), q = w + 1;
      return I[y0 * q + x0] * (1 - fy) * (1 - fx) + I[y1 * q + x0] * fy * (1 - fx) + I[y0 * q + x1] * (1 - fy) * fx + I[y1 * q + x1] * fy * fx;
    };
    for (let i = 0; i < GH; i++) for (let j = 0; j < GW; j++) {
      const ya = i * h / GH, yb = (i + 1) * h / GH, xa = j * w / GW, xb = (j + 1) * w / GW;
      out[i * GW + j] = (S(yb, xb) - S(ya, xb) - S(yb, xa) + S(ya, xa)) / ((yb - ya) * (xb - xa));
    }
    out[GW * GH] = Math.min(relh, 2.5) / 2.5;
    out[GW * GH + 1] = Math.min(w / h, 3) / 3;
    return out;
  }
  function classify(bits, w, h, relh) {
    const f = features(bits, w, h, relh), nin = MODEL.nin, nh = MODEL.nh, nc = MODEL.classes.length;
    const hid = new Float64Array(nh);
    for (let j = 0; j < nh; j++) hid[j] = MODEL.b1[j];
    for (let i = 0; i < nin; i++) { const v = f[i]; if (!v) continue; const o = i * nh; for (let j = 0; j < nh; j++) hid[j] += v * MODEL.w1[o + j]; }
    const z = new Float64Array(nc);
    for (let k = 0; k < nc; k++) z[k] = MODEL.b2[k];
    for (let j = 0; j < nh; j++) { const v = hid[j]; if (v <= 0) continue; const o = j * nc; for (let k = 0; k < nc; k++) z[k] += v * MODEL.w2[o + k]; }
    let mx = -1e9; for (let k = 0; k < nc; k++) if (z[k] > mx) mx = z[k];
    let sum = 0; for (let k = 0; k < nc; k++) { z[k] = Math.exp(z[k] - mx); sum += z[k]; }
    let best = 0; for (let k = 0; k < nc; k++) { z[k] /= sum; if (z[k] > z[best]) best = k; }
    return { ch: MODEL.classes[best], p: z[best], probs: z };
  }

  /* ---------- blobs -> glyphs ---------- */
  function cut(lab, id, b, x0, x1) { // tight bitmap of component `id` between columns x0..x1 (box-relative)
    let ya = 1e9, yb = -1, xa = 1e9, xb = -1; const w0 = b.w;
    for (let y = 0; y < b.h; y++) for (let x = x0; x < x1; x++) if (lab.lab[(b.y0 + y) * lab.W + b.x0 + x] === id) { if (y < ya) ya = y; if (y > yb) yb = y; if (x < xa) xa = x; if (x > xb) xb = x; }
    if (yb < 0) return null;
    const w = xb - xa + 1, h = yb - ya + 1, bits = new Uint8Array(w * h); let area = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (lab.lab[(b.y0 + ya + y) * lab.W + b.x0 + xa + x] === id) { bits[y * w + x] = 1; area++; }
    return { bits, w, h, area, x0: b.x0 + xa, x1: b.x0 + xb + 1, y0: b.y0 + ya, y1: b.y0 + yb + 1 };
  }
  // columns of ink inside one component, for valley search
  function colInk(lab, id, b) {
    const c = new Float64Array(b.w);
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (lab.lab[(b.y0 + y) * lab.W + b.x0 + x] === id) c[x]++;
    return c;
  }

  // group items ({y0,y1}) into text lines by vertical centre; returns [{g, yc, h}]
  function cluster(items) {
    const a = items.slice().sort((p, q) => (p.y0 + p.y1) - (q.y0 + q.y1)), lines = [];
    a.forEach(g => {
      const yc = (g.y0 + g.y1) / 2, h = g.y1 - g.y0;
      for (const L of lines) {
        if (Math.abs(yc - L.yc) <= 0.55 * Math.max(h, L.h)) {
          L.g.push(g); L.yc = L.g.reduce((t, q) => t + (q.y0 + q.y1) / 2, 0) / L.g.length; L.h = median(L.g.map(q => q.y1 - q.y0)); return;
        }
      }
      lines.push({ g: [g], yc, h });
    });
    return lines;
  }

  function find(maskIn, W, H, opts) {
    opts = opts || {};
    const s = scaleOf(W), mask = opts.keepBars ? maskIn : removeBars(maskIn, W, H);
    const lab = label(mask, W, H); lab.W = W;
    const cand = [], dashes = [];
    for (let i = 1; i <= lab.n; i++) {
      const b = lab.boxes[i];
      if (b.area < 100 * s * s && !(b.w >= 8 * s && b.h >= 3 * s && b.area >= 30 * s * s)) continue;
      if (b.h >= 22 * s && b.h <= 175 * s && b.w <= 3.4 * b.h && b.w >= 0.15 * b.h) cand.push(b);
      else if (b.h < 22 * s && b.h >= 4 * s && b.w >= 1.15 * b.h && b.w >= 8 * s && b.w <= 70 * s) dashes.push(b);
    }
    // typical single-glyph shape: width as a fraction of height (condensed fonts are ~0.5)
    const asp = cand.filter(b => b.w <= 0.75 * b.h && b.h >= 30 * s).map(b => b.w / b.h);
    const medAsp = asp.length ? median(asp) : 0.55;
    const medw = median(cand.filter(b => b.w <= 0.95 * b.h).map(b => b.w)) || 30 * s;
    const pre = cluster(cand), lineH = new Map();
    pre.forEach(L => L.g.forEach(b => lineH.set(b, L.g.length >= 3 ? L.h : median(cand.map(q => q.h)) || 60 * s)));
    const glyphs = [];
    const keepBits = true;
    const push = (bm, relh) => { const c = classify(bm.bits, bm.w, bm.h, relh); glyphs.push({ x0: bm.x0, x1: bm.x1, y0: bm.y0, y1: bm.y1, ch: c.ch, p: c.p, probs: c.probs, bm, relh }); };
    cand.forEach(b => {
      const whole = cut(lab, b.id, b, 0, b.w); if (!whole) return;
      const LH = lineH.get(b), unit = Math.max(6 * s, medAsp * b.h);
      const cw = classify(whole.bits, whole.w, whole.h, whole.h / LH);
      if (b.w > 1.3 * unit && !('X/F'.indexOf(cw.ch) >= 0 && cw.p > 0.9)) {
        const col = colInk(lab, b.id, b), mx = Math.max.apply(null, col);
        const cache = new Map(), step = Math.max(2, Math.round(b.w / 60));
        const part = (x0, x1) => { // classified part between columns; null if nothing there
          const key = x0 + ':' + x1; if (cache.has(key)) return cache.get(key);
          const bm = cut(lab, b.id, b, x0, x1); let r = null;
          if (bm && bm.area >= 80 * s * s && bm.w >= 0.15 * bm.h) { const c = classify(bm.bits, bm.w, bm.h, bm.h / LH); r = { bm, c }; }
          cache.set(key, r); return r;
        };
        let best = null;
        const k0 = Math.max(2, Math.min(4, Math.round(b.w / unit))), k1 = Math.min(4, k0 + 1);
        for (let k = k0; k <= k1; k++) {
          let bestK = null;
          const walk = (start, j, edges) => { // choose cut j (1..k-1) near its ideal place
            if (j === k) {
              const e = edges.concat([b.w]); let sum = 0, ok = true, ink = 0; const ps = [];
              for (let i = 0; i + 1 < e.length; i++) { const r = part(e[i], e[i + 1]); if (!r || r.c.ch === '?') { ok = false; break; } ps.push(r); sum += r.c.p; }
              for (let i = 1; i + 1 < e.length; i++) ink += 1 - col[e[i]] / mx;
              if (!ok) return;
              const score = sum / ps.length + 0.1 * ink / (k - 1);
              if (!bestK || score > bestK.score) bestK = { score, mean: sum / ps.length, ps };
              return;
            }
            const ideal = b.w * j / k, lo = Math.max(start + Math.round(0.25 * unit), Math.floor(ideal - 0.45 * unit)), hi = Math.min(b.w - Math.round(0.25 * unit) * (k - j), Math.ceil(ideal + 0.45 * unit));
            for (let x = lo; x <= hi; x += step) walk(x, j + 1, edges.concat([x]));
          };
          walk(0, 1, [0]);
          if (bestK && (!best || bestK.score > best.score + 0.08)) best = bestK;
        }
        if (best && best.mean >= 0.65 && (best.mean > cw.p - 0.05 || cw.ch === '?')) { best.ps.forEach(r => glyphs.push({ x0: r.bm.x0, x1: r.bm.x1, y0: r.bm.y0, y1: r.bm.y1, ch: r.c.ch, p: r.c.p, probs: r.c.probs, bm: r.bm, relh: r.bm.h / LH })); return; }
      }
      push(whole, whole.h / LH);
    });
    // group by y into lines
    // a '/' must lean and a foul F must be F-shaped and sure: straight slivers (borders) read as those otherwise
    const lean = g => { // how far the ink's top half sits right of its bottom half, as a fraction of the width
      const bm = g.bm; if (!bm) return 1;
      let st = 0, sn = 0, bt = 0, bn = 0;
      for (let y = 0; y < bm.h; y++) for (let x = 0; x < bm.w; x++) if (bm.bits[y * bm.w + x]) { if (y < bm.h / 2) { st += x; sn++; } else { bt += x; bn++; } }
      return sn && bn ? (st / sn - bt / bn) / bm.w : 0;
    };
    const real = glyphs.filter(g => g.ch !== '?' && g.p >= 0.45 && !(g.ch === '/' && lean(g) < 0.2) && !(g.ch === 'F' && (g.p < 0.9 || (g.x1 - g.x0) < 0.3 * (g.y1 - g.y0))));
    // a sliver hugging a bigger glyph is a leftover of a border or of a frame number above it
    const real2 = real.filter(g => !((g.x1 - g.x0) < 0.22 * (g.y1 - g.y0) || g.p < 0.8) || !real.some(q => q !== g && q.x1 - q.x0 > 1.6 * (g.x1 - g.x0) && Math.min(g.x1, q.x1) - Math.max(g.x0, q.x0) >= 0.35 * (g.x1 - g.x0) && Math.min(g.y1, q.y1) - Math.max(g.y0, q.y0) > 0.3 * (g.y1 - g.y0)));
    const lines = cluster(real2);
    // fragments (tails of frame numbers, bar stubs) are much shorter than the line's own glyphs
    lines.forEach(L => { L.g = L.g.filter(q => q.y1 - q.y0 >= 0.6 * L.h); if (L.g.length) L.h = median(L.g.map(q => q.y1 - q.y0)); });
    // dashes join a line when they sit in its middle band and among its glyphs
    dashes.forEach(d => {
      const dy = (d.y0 + d.y1) / 2;
      for (const L of lines) {
        if (L.g.length < 3 || Math.abs(dy - L.yc) > 0.3 * L.h || d.h < 0.15 * L.h || d.w > 3 * d.h) continue;
        const xs = L.g.map(q => q.x0), xe = L.g.map(q => q.x1);
        if (d.x0 < Math.min.apply(null, xs) - 3 * L.h || d.x1 > Math.max.apply(null, xe) + 1.2 * L.h) continue;
        // not sitting on top of another glyph
        if (L.g.some(q => d.x0 < q.x1 - 0.4 * (d.x1 - d.x0) && d.x1 > q.x0 + 0.4 * (d.x1 - d.x0))) continue;
        L.g.push({ x0: d.x0, x1: d.x1, y0: d.y0, y1: d.y1, ch: '-', p: 0.6 }); return;
      }
    });
    // clutter: rows much smaller than the biggest text (frame-number header, '17.3 MPH') or mostly unsure reads
    const tall = Math.max.apply(null, [0].concat(lines.filter(L => L.g.length >= 4).map(L => L.h)));
    const min = opts.minGlyphs || 4, out = [];
    lines.filter(L => L.g.length >= min && L.h >= 0.55 * tall && L.g.reduce((a, q) => a + q.p, 0) / L.g.length >= 0.7).sort((a, b) => a.yc - b.yc).forEach(L => {
      const g = L.g.slice().sort((a, b) => a.x0 - b.x0), mw = median(g.filter(q => q.ch !== '-').map(q => q.x1 - q.x0)) || medw;
      // a lone glyph far out on the left is the bowler's initial / lane label, not a mark
      for (let cutAt = 1; cutAt <= 3 && g.length > cutAt + 3; cutAt++) {
        if (g[cutAt].x0 - g[cutAt - 1].x1 > 4 * mw) { g.splice(0, cutAt); break; }
      }
      let text = '', confs = [], prev = null;
      g.forEach(q => {
        if (prev !== null && q.x0 - prev > 0.6 * mw) { text += ' '; confs.push(null); }
        text += q.ch; confs.push(Math.round(q.p * 100)); prev = q.x1;
      });
      out.push({ text, confs, y: Math.round(L.yc), h: Math.round(L.h), glyphs: g.length });
    });
    return { lines: out, medw, glyphs: glyphs.length, all: opts.debug ? glyphs : undefined };
  }

  const Glyphs = { label, removeBars, features, classify, find };
  if (typeof module !== 'undefined' && module.exports) module.exports = Glyphs;
  else global.BBGlyphs = Glyphs;
})(typeof window !== 'undefined' ? window : globalThis);
