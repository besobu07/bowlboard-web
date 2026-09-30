/* BowlBoard — photo of the lane screen. The scan only ever drafts the game:
 *   1. snap the overhead/console screen when the game is done
 *   2. optionally drag a box around your row
 *   3. the crop is cleaned up (grey, contrast, dark screens flipped to dark-on-light,
 *      black and white) and read for marks only: X / - F and single digits
 *   4. marks are placed by bowling rules (js/scan.js); anything impossible or unclear
 *      is flagged, and you check every frame on the tap-a-frame keypad before saving.
 * When a scan won't do, you can type the running totals from the photo instead (frames are filled in only when
 * the totals fit exactly one game), and "Copy scan details" gives a plain-text account of what the reader saw.
 * Scoring from paper sheets isn't a goal; screens are. */
(function () {
'use strict';
const BB = window.BB;
const S = window.BBScore, Store = window.BBStore, Scan = window.BBScan;
const { RENDER, EMBED, esc, icon, on, el, toast, screenRoot, frameEditor } = BB;

const photo = { setup: null, img: null, thumb: null, crop: null, zoom: null, zoomImg: null, cropping: false, proc: null, draft: null, note: '', scanning: false, totals: [], scanned: false, checked: false, scan: null, view: '', rt: null };
function resetPhoto(setup) {
  photo.setup = setup || photo.setup;
  Object.assign(photo, { img: null, thumb: null, crop: null, zoom: null, zoomImg: null, cropping: false, proc: null, draft: null, note: '', scanning: false, totals: [], scanned: false, checked: false, scan: null, view: '', rt: null });
}
function loadImage(src) {
  return new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = reject; im.src = src; });
}
async function downscale(dataURL, maxDim, quality) {
  const img = await loadImage(dataURL);
  const r = Math.min(1, maxDim / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * r));
  c.height = Math.max(1, Math.round(img.height * r));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

// Clean-up before reading (all on the phone, no library):
//   crop and scale so marks are big enough -> grey -> flip dark screens to dark-on-light
//   -> black and white with a threshold that follows the local brightness (glare and a
//   dark half don't swallow the marks) -> straighten a tilted photo using the screen's
//   long grid lines -> rub those grid lines out, since they run marks together.
// Returns a PNG data URL.
function greyOf(ctx, W, H) {
  const px = ctx.getImageData(0, 0, W, H).data, n = W * H;
  const g = new Float32Array(n);
  for (let k = 0, p = 0; k < n; k++, p += 4) g[k] = (px[p] * 299 + px[p + 1] * 587 + px[p + 2] * 114) / 1000;
  return g;
}
function medianOf(g) {
  const hist = new Uint32Array(256);
  for (let k = 0; k < g.length; k++) hist[g[k] | 0]++;
  let acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= g.length / 2) return v; }
  return 255;
}
// Bradley threshold: ink if 15% darker than the average of the neighbourhood.
function inkOf(g, W, H, flip) {
  const n = W * H;
  if (flip) for (let k = 0; k < n; k++) g[k] = 255 - g[k];
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) { row += g[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; }
  }
  const r = Math.max(8, Math.round(Math.min(W, H) / 8));
  const ink = new Uint8Array(n);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = I[(y1 + 1) * (W + 1) + x1 + 1] - I[y0 * (W + 1) + x1 + 1] - I[(y1 + 1) * (W + 1) + x0] + I[y0 * (W + 1) + x0];
      ink[y * W + x] = g[y * W + x] * area < sum * 0.85 ? 1 : 0;
    }
  }
  return ink;
}
// Tilt (degrees) that lines the ink up best in rows — the screen's grid lines dominate.
function skewOf(ink, W, H) {
  let best = 0, bestScore = -1;
  const pad = Math.ceil(W * Math.tan(5 * Math.PI / 180)) + 2;
  for (let a = -5; a <= 5.001; a += 0.25) {
    const t = Math.tan(a * Math.PI / 180);
    const rows = new Float64Array(H + 2 * pad);
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (ink[y * W + x]) rows[Math.round(y + x * t) + pad]++;
    let score = 0;
    for (let i = 0; i < rows.length; i++) score += rows[i] * rows[i];
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return best;
}
// Long runs of ink that are only a few pixels thick are grid lines.
function gridLines(ink, W, H, thin) {
  const erase = new Uint8Array(W * H);
  const minH = Math.round(W * 0.2), minV = Math.round(H * 0.3);
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      if (!ink[y * W + x]) { x++; continue; }
      let e = x; while (e < W && ink[y * W + e]) e++;
      if (e - x >= minH) {
        const mid = (x + e) >> 1;
        let t = 0; for (let yy = Math.max(0, y - thin * 2); yy <= Math.min(H - 1, y + thin * 2); yy++) t += ink[yy * W + mid];
        if (t <= thin) for (let k = x; k < e; k++) erase[y * W + k] = 1;
      }
      x = e;
    }
  }
  for (let x = 0; x < W; x++) {
    let y = 0;
    while (y < H) {
      if (!ink[y * W + x]) { y++; continue; }
      let e = y; while (e < H && ink[e * W + x]) e++;
      if (e - y >= minV) {
        const mid = (y + e) >> 1;
        let t = 0; for (let xx = Math.max(0, x - thin * 2); xx <= Math.min(W - 1, x + thin * 2); xx++) t += ink[mid * W + xx];
        if (t <= thin) for (let k = y; k < e; k++) erase[k * W + x] = 1;
      }
      y = e;
    }
  }
  return erase;
}
// Screens drawn as a table have thick borders in a photo, as thick as the digits, so they can't be told from writing by
// thickness. They are found from where the ink piles up instead: a row that is ink across much of the width, with a long
// unbroken stretch, is a horizontal border; between those, a column that is ink for most of the band's height is a vertical
// one. Whole stripes are rubbed out, so a border broken by glare goes too. Only done when several vertical borders are
// found in a band, so plain text is never touched.
function stripeRuns(n, ok, gap) {
  const out = [];
  let i = 0;
  while (i < n) {
    if (!ok(i)) { i++; continue; }
    let last = i, j = i;
    while (j < n && (ok(j) || j - last <= gap)) { if (ok(j)) last = j; j++; }
    out.push([i, last + 1]); i = last + 1;
  }
  return out;
}
function gridStripes(ink, W, H, erase) {
  const rowSum = new Uint32Array(H), rowRun = new Uint32Array(H);
  for (let y = 0; y < H; y++) {
    let s = 0, run = 0, best = 0;
    for (let x = 0, o = y * W; x < W; x++) { if (ink[o + x]) { s++; run++; if (run > best) best = run; } else run = 0; }
    rowSum[y] = s; rowRun[y] = best;
  }
  const hl = stripeRuns(H, y => rowSum[y] >= W * 0.45 && rowRun[y] >= W * 0.08, 2).filter(r => r[1] - r[0] >= 2 && r[1] - r[0] <= Math.max(6, H * 0.2));
  const m = 2;
  hl.forEach(r => { for (let y = Math.max(0, r[0] - m); y < Math.min(H, r[1] + m); y++) erase.fill(1, y * W, (y + 1) * W); });
  const edges = [0]; hl.forEach(r => edges.push(r[0], r[1])); edges.push(H);
  let vertical = 0;
  const bands = [];   // the stretches between borders: { y0, y1, cells } where cells = vertical borders found in it
  for (let b = 0; b < edges.length; b += 2) {
    const y0 = edges[b], y1 = edges[b + 1], h = y1 - y0;
    if (h < Math.max(24, H * 0.08)) continue;
    const colSum = new Uint32Array(W), colRun = new Uint32Array(W);
    for (let x = 0; x < W; x++) {
      let s = 0, run = 0, best = 0;
      for (let y = y0; y < y1; y++) { if (ink[y * W + x]) { s++; run++; if (run > best) best = run; } else run = 0; }
      colSum[x] = s; colRun[x] = best;
    }
    const vl = stripeRuns(W, x => colSum[x] >= h * 0.6 && colRun[x] >= h * 0.55, 2).filter(r => r[1] - r[0] >= 2 && r[1] - r[0] <= Math.max(6, W * 0.06));
    bands.push({ y0, y1, cells: vl.length });
    if (vl.length < 3) continue;
    vertical += vl.length;
    vl.forEach(r => { for (let y = y0; y < y1; y++) erase.fill(1, y * W + Math.max(0, r[0] - m), y * W + Math.min(W, r[1] + m)); });
  }
  // A box that took in one row of a table and pieces of the rows above and below it: keep the row. That is when one
  // table row (wide, with its cell borders) is clearly the tallest stretch between borders, at least 1.6 times the next.
  const tall = bands.slice().sort((a, b) => (b.y1 - b.y0) - (a.y1 - a.y0));
  if (tall.length > 1) {
    const main = tall[0], mh = main.y1 - main.y0;
    if (main.cells >= 3 && W / mh >= 3 && mh >= 1.6 * (tall[1].y1 - tall[1].y0)) {
      erase.fill(1, 0, main.y0 * W);
      erase.fill(1, main.y1 * W, W * H);
    }
  }
  return { horizontal: hl.length, vertical };
}
// What is left of the borders after they are rubbed out (slivers along the old edges) and specks of dust are not writing:
// remove ink pieces that are only a few pixels wide however tall, or a few pixels tall however wide, or tiny. Pieces much
// taller than the writing (the row's name and the big total at the side of a screen) go too, when there are only a few of
// them: they throw the reader's idea of where the lines of text are, and they are not marks or running totals.
function despeckle(ink, erase, W, H) {
  const n = W * H, label = new Int32Array(n), stack = new Int32Array(n);
  const thin = Math.max(3, Math.round(W / 400));
  const comps = [];   // { x0, x1, y0, y1, count }
  for (let k0 = 0; k0 < n; k0++) {
    if (!ink[k0] || erase[k0] || label[k0]) continue;
    const id = comps.length + 1;
    let sp = 0, count = 0, x0 = W, x1 = 0, y0 = H, y1 = 0;
    stack[sp++] = k0; label[k0] = id;
    while (sp) {
      const k = stack[--sp];
      count++;
      const x = k % W, y = (k - x) / W;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= W) continue;
          const j = yy * W + xx;
          if (ink[j] && !erase[j] && !label[j]) { label[j] = id; stack[sp++] = j; }
        }
      }
    }
    comps.push({ x0, x1, y0, y1, count });
  }
  const drop = new Uint8Array(comps.length + 1);
  comps.forEach((c, i) => {
    const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
    if ((w <= thin && h >= 10) || (h <= thin && w >= 10) || c.count < 14) drop[i + 1] = 1;
  });
  const left = comps.map((c, i) => ({ h: c.y1 - c.y0 + 1, i })).filter(c => !drop[c.i + 1] && c.h >= 10);
  if (left.length >= 12) {
    const hs = left.map(c => c.h).sort((a, b) => a - b), med = hs[Math.floor(hs.length / 2)];
    const tall = left.filter(c => c.h > med * 1.7);
    if (tall.length && tall.length <= left.length * 0.15) tall.forEach(c => { drop[c.i + 1] = 1; });
  }
  for (let k = 0; k < n; k++) if (label[k] && drop[label[k]]) erase[k] = 1;
}
async function prepareMask(src, crop) {
  const img = await loadImage(src);
  const c0 = crop || { x: 0, y: 0, w: 1, h: 1 };
  const sx = Math.round(c0.x * img.width), sy = Math.round(c0.y * img.height);
  const sw = Math.max(8, Math.round(c0.w * img.width)), sh = Math.max(8, Math.round(c0.h * img.height));
  const scale = Math.max(0.5, Math.min(3, 1600 / sw));
  const c = document.createElement('canvas');
  const W = c.width = Math.round(sw * scale), H = c.height = Math.round(sh * scale);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
  let g = greyOf(ctx, W, H);
  const med = medianOf(g);
  const flip = med < 128; // lane screens are usually light marks on a dark background
  let ink = inkOf(g, W, H, flip);
  const angle = skewOf(ink, W, H);
  if (Math.abs(angle) >= 0.25) {
    // straighten: redraw rotated, filling the corners with the background shade
    const src2 = document.createElement('canvas');
    src2.width = W; src2.height = H;
    src2.getContext('2d').drawImage(c, 0, 0);
    ctx.save();
    ctx.fillStyle = 'rgb(' + med + ',' + med + ',' + med + ')';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    ctx.rotate(angle * Math.PI / 180);
    ctx.drawImage(src2, -W / 2, -H / 2);
    ctx.restore();
    g = greyOf(ctx, W, H);
    ink = inkOf(g, W, H, flip);
  }
  // borders first (whole stripes), then what they leave behind (thin slivers along the old edges), then specks
  const erase = new Uint8Array(W * H);
  gridStripes(ink, W, H, erase);
  const rest = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) rest[k] = ink[k] && !erase[k] ? 1 : 0;
  const thinLines = gridLines(rest, W, H, Math.max(3, Math.round(4 * scale)));
  for (let k = 0; k < W * H; k++) if (thinLines[k]) erase[k] = 1;
  despeckle(ink, erase, W, H);
  const mask = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) mask[k] = ink[k] && !erase[k] ? 1 : 0;
  return { mask, W, H };
}
function maskToPNG(mask, W, H) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d'), id = ctx.createImageData(W, H), px = id.data;
  for (let k = 0, p = 0; k < W * H; k++, p += 4) { const v = mask[k] ? 0 : 255; px[p] = px[p + 1] = px[p + 2] = v; px[p + 3] = 255; }
  ctx.putImageData(id, 0, 0);
  return c.toDataURL('image/png');
}
async function prepare(src, crop) {
  const m = await prepareMask(src, crop);
  return maskToPNG(m.mask, m.W, m.H);
}

// The cleaned copy at a fraction of its size. The reader does better on digits about 30-40 px tall than on the big
// 1600 px-wide copy, and it's faster too. The shrinking is done here (Lanczos, all in numbers) rather than by the
// browser's canvas, whose smoothing differs between browsers and read noticeably worse. Returns a PNG data URL.
function lanczosTaps(n, m) {
  const r = n / m, sc = Math.max(1, r), a = 3 * sc, out = [];
  const lz = x => { x = Math.abs(x); return x < 1e-9 ? 1 : x >= 3 ? 0 : 3 * Math.sin(Math.PI * x) * Math.sin(Math.PI * x / 3) / (Math.PI * Math.PI * x * x); };
  for (let o = 0; o < m; o++) {
    const c = (o + 0.5) * r - 0.5, i0 = Math.max(0, Math.ceil(c - a)), i1 = Math.min(n - 1, Math.floor(c + a)), w = [];
    let sum = 0;
    for (let i = i0; i <= i1; i++) { const v = lz((i - c) / sc); w.push(v); sum += v; }
    for (let k = 0; k < w.length; k++) w[k] /= sum || 1;
    out.push({ i0, w });
  }
  return out;
}
function shrinkGrey(g, W, H, w2, h2) {
  const tx = lanczosTaps(W, w2), ty = lanczosTaps(H, h2);
  const mid = new Float32Array(w2 * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < w2; x++) {
    const t = tx[x]; let v = 0;
    for (let k = 0; k < t.w.length; k++) v += g[y * W + t.i0 + k] * t.w[k];
    mid[y * w2 + x] = v;
  }
  const out = new Uint8ClampedArray(w2 * h2);
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
    const t = ty[y]; let v = 0;
    for (let k = 0; k < t.w.length; k++) v += mid[(t.i0 + k) * w2 + x] * t.w[k];
    out[y * w2 + x] = v;
  }
  return out;
}
async function scaled(dataURL, f) {
  if (f === 1) return dataURL;
  const im = await loadImage(dataURL);
  const W = im.width, H = im.height, w2 = Math.max(8, Math.round(W * f)), h2 = Math.max(8, Math.round(H * f));
  const c0 = document.createElement('canvas');
  c0.width = W; c0.height = H;
  const x0 = c0.getContext('2d');
  x0.drawImage(im, 0, 0);
  const px0 = x0.getImageData(0, 0, W, H).data, g = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) g[k] = px0[k * 4];
  const small = shrinkGrey(g, W, H, w2, h2);
  const c = document.createElement('canvas');
  c.width = w2; c.height = h2;
  const ctx = c.getContext('2d'), id = ctx.createImageData(w2, h2);
  for (let k = 0, p = 0; k < w2 * h2; k++, p += 4) { id.data[p] = id.data[p + 1] = id.data[p + 2] = small[k]; id.data[p + 3] = 255; }
  ctx.putImageData(id, 0, 0);
  return c.toDataURL('image/png');
}
// Reading passes, in order: the same cleaned copy at three sizes, since the reader's luck with a screen changes with
// the size (measured on mock screens and a real one: about 11% more frames right than any single size). Each pass after
// the first only runs when the marks and the running totals didn't already agree.
const PASSES = [{ psm: '6', f: 0.6 }, { psm: '6', f: 0.5 }, { psm: '6', f: 0.4 }];
const passLabel = p => 'layout ' + p.psm + ' at ' + Math.round(p.f * 100) + '%';

// Boxing is two steps, because one row of a scoreboard across the room is a few millimetres tall on a phone: first a
// rough box around the whole scoreboard zooms in on it, then a box around your row on the enlarged view. photo.crop
// always stays in the original photo's terms (0 to 1 across and down), wherever on screen it was drawn.
const UNIT = { x: 0, y: 0, w: 1, h: 1 };
const viewOf = () => (photo.zoom && photo.zoomImg ? { img: photo.zoomImg, r: photo.zoom } : { img: photo.img, r: UNIT });
const inView = (c, r) => ({ x: (c.x - r.x) / r.w, y: (c.y - r.y) / r.h, w: c.w / r.w, h: c.h / r.h });
async function makeZoom() {
  const im = await loadImage(photo.img), z = photo.zoom;
  const sx = Math.round(z.x * im.width), sy = Math.round(z.y * im.height);
  const sw = Math.max(8, Math.round(z.w * im.width)), sh = Math.max(8, Math.round(z.h * im.height));
  const k = Math.min(1, 1400 / sw);
  const c = document.createElement('canvas');
  c.width = Math.max(8, Math.round(sw * k)); c.height = Math.max(8, Math.round(sh * k));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(im, sx, sy, sw, sh, 0, 0, c.width, c.height);
  photo.zoomImg = c.toDataURL('image/jpeg', 0.88);
}

RENDER.photo = function () {
  const root = screenRoot();
  if (!photo.setup) { BB.show('new'); return; }
  const su = photo.setup;
  if (photo.view === 'totals') { renderTotals(root, su); return; }
  let h = BB.entryHeader(su, 'photo');
  h += '<div class="card">';
  if (!photo.img && photo.draft) {
    h += '<div class="row"><span class="small muted grow">' + icon('screen') + ' No photo — typing it in from the screen.</span><label class="btn secondary small-btn" for="photoPick">' + icon('camera') + 'Add a photo</label></div>' +
      '<input type="file" id="photoPick" accept="image/*" hidden>';
  } else if (!photo.img) {
    h += '<p class="mt0">' + icon('screen') + ' <b>Photo of the lane screen</b></p>' +
      '<ul class="tips"><li>Take it when your game is finished.</li><li>Fill the photo with your row — your name and all 10 frames.</li><li>Tilt a little to dodge glare, and hold still for a second.</li></ul>' +
      (EMBED ? '<p class="small muted">Here you can keep the photo with the game and type the frames in; reading the screen works in the installed app.</p>' : '<p class="small muted">BowlBoard drafts the frames from the photo. You check every one before it’s saved.</p>');
    // Two pickers: "capture" opens the camera straight away (and on an iPhone leaves no way to pick from the library),
    // so choosing an existing photo is its own button, without it.
    h += '<label class="btn" for="photoFile">' + icon('camera') + 'Take a photo</label>' +
      '<label class="btn secondary mt8" for="photoPick">' + icon('image') + 'Choose from your photos</label>';
    h += '<input type="file" id="photoFile" accept="image/*" capture="environment" hidden><input type="file" id="photoPick" accept="image/*" hidden>';
    h += '<button class="btn secondary mt8" id="manualBtn">Skip the photo — type it in</button>';
  } else {
    const v = viewOf(), step1 = photo.cropping && !photo.zoom, bx = photo.crop && !step1 ? inView(photo.crop, v.r) : null;
    h += '<div class="crop-wrap' + (photo.cropping ? ' cropping' : '') + '" id="cropWrap"><img class="photo-preview" src="' + Store.safeImage(v.img) + '" alt="lane screen photo">' +
      (bx ? '<div class="crop-box" style="left:' + bx.x * 100 + '%;top:' + bx.y * 100 + '%;width:' + bx.w * 100 + '%;height:' + bx.h * 100 + '%"></div>' : '') + '</div>';
    h += '<div class="small muted" id="cropHint">' + (step1 ? '<b>Step 1 of 2.</b> Drag a box around the whole scoreboard to zoom in.' : photo.cropping ? '<b>Step 2 of 2.</b> Now drag a box around your row' + (photo.crop ? ', then tap Done.' : '.')
      : photo.crop ? 'Reading only the boxed area.' : 'Tip: box in just your row for a cleaner read.') + '</div>';
    if (!EMBED) h += '<button class="btn mt8" id="scanBtn"' + (photo.scanning || (photo.cropping && !photo.crop) ? ' disabled' : '') + '>' + icon('sparkle') + (photo.scanning ? 'Reading…' : photo.scanned ? 'Read it again' : 'Read the screen') + '</button>';
    h += '<div class="row wrap mt8 photo-tools">' +
      (step1 ? '<button class="btn secondary small-btn" id="cropSkip">My row fills the photo</button>'
        : '<button class="btn secondary small-btn" id="cropBtn" aria-pressed="' + photo.cropping + '">' + icon('crop') + (photo.cropping ? 'Done' : photo.crop ? 'Re-box' : 'Box my row') + '</button>') +
      (photo.cropping && photo.zoom ? '<button class="btn secondary small-btn" id="zoomOut">Zoom out</button><button class="btn secondary small-btn" id="cropAll">Use this whole view</button>' : '') +
      ((photo.crop || photo.zoom) && !photo.cropping ? '<button class="btn secondary small-btn" id="cropClear">Whole photo</button>' : '') +
      (photo.draft ? '' : '<button class="btn secondary small-btn" id="manualBtn">Type it in</button>') +
      '<button class="btn secondary small-btn" id="totalsBtn">Type the totals</button>' +
      '<button class="btn secondary small-btn" id="clearPhotoBtn">Retake</button></div>';
    if (photo.proc) h += '<details class="proc"><summary>What the scanner read</summary><img src="' + Store.safeImage(photo.proc) + '" alt="cleaned-up crop used for reading"><p class="small muted">If this looks like mush, retake the photo rather than fixing every frame.</p></details>';
    if (photo.scan) h += '<div class="scan-tools"><button class="link-btn" id="copyScanBtn">' + icon('copy') + 'Copy scan details</button><span class="small muted">Email it to us if a scan goes wrong. It’s words only, no photo.</span></div>';
  }
  h += '<div class="scan-status" id="scanNote" aria-live="polite">' + esc(photo.note) + '</div>';
  if (photo.draft) {
    if (photo.scanned) {
      const n = photo.draft.flags.filter(f => f === 'low' || f === 'bad').length;
      h += '<div class="notice draft-note"><b>Draft — check every frame against the screen.</b> ' + (n ? n + ' frame' + (n === 1 ? ' is' : 's are') + ' marked to look at. ' : '') + 'Tap a frame to change it; nothing is saved until you confirm.' +
        '<div class="legend"><span class="lg good">read clearly</span><span class="lg low">check this</span><span class="lg bad">couldn’t be right</span></div></div>';
    } else h += '<div class="small muted">Tap a frame, then its marks on the keypad.</div>';
    h += '<div id="phEditor"></div><div class="scan-status" id="reviewStatus" aria-live="polite"></div>';
    if (photo.scanned) h += '<label class="check"><input type="checkbox" id="phChecked"' + (photo.checked ? ' checked' : '') + '> I checked every frame against the screen</label>';
    h += '<button class="btn" id="savePhotoBtn" disabled>Save</button>';
  }
  h += '</div>';
  root.innerHTML = h;
  BB.bindEntryBall(su);

  const gotFile = async e => {
    const f = e.target.files[0];
    if (!f) return;
    const raw = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
    try {
      photo.img = await downscale(raw, 3000, 0.9);   // a scoreboard across the room is a small part of the picture, so keep the detail
      photo.thumb = await downscale(raw, 1000, 0.72); // kept in IndexedDB, not in the main save file
    } catch (err) { toast('Could not read that image'); return; }
    Object.assign(photo, { crop: null, zoom: null, zoomImg: null, cropping: true, proc: null, scan: null, scanned: false, note: '' });   // straight into boxing your row
    RENDER.photo();
  };
  on('photoFile', 'change', gotFile);
  on('photoPick', 'change', gotFile);
  on('scanBtn', 'click', autoScan);
  on('cropBtn', 'click', () => {
    if (photo.cropping && photo.zoom && !photo.crop) photo.crop = Object.assign({}, photo.zoom);   // zoomed in but no row boxed: read what is zoomed in on
    photo.cropping = !photo.cropping; RENDER.photo();
  });
  on('cropSkip', 'click', () => { photo.cropping = false; photo.crop = null; RENDER.photo(); });
  on('cropAll', 'click', () => { photo.crop = Object.assign({}, photo.zoom); photo.cropping = false; RENDER.photo(); });
  on('zoomOut', 'click', () => { photo.zoom = null; photo.zoomImg = null; photo.crop = null; RENDER.photo(); });
  on('cropClear', 'click', () => { photo.crop = null; photo.zoom = null; photo.zoomImg = null; RENDER.photo(); });
  on('manualBtn', 'click', () => { photo.draft = photo.draft || Scan.emptyDraft(); photo.note = ''; RENDER.photo(); });
  on('totalsBtn', 'click', () => { photo.view = 'totals'; RENDER.photo(); });
  on('copyScanBtn', 'click', copyScan);
  on('clearPhotoBtn', 'click', () => { resetPhoto(); RENDER.photo(); });
  if (photo.cropping) bindCrop(el('cropWrap'));
  if (photo.draft) bindReview(root, su);
};

function bindCrop(wrap) {
  if (!wrap) return;
  const r = viewOf().r;
  let start = null, box = null, cur = null;
  const pt = e => { const b = wrap.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)), y: Math.max(0, Math.min(1, (e.clientY - b.top) / b.height)) }; };
  wrap.addEventListener('pointerdown', e => {
    e.preventDefault();
    start = pt(e); cur = null;
    wrap.setPointerCapture && wrap.setPointerCapture(e.pointerId);
    box = wrap.querySelector('.crop-box') || wrap.appendChild(Object.assign(document.createElement('div'), { className: 'crop-box' }));
  });
  wrap.addEventListener('pointermove', e => {
    if (!start) return;
    const q = pt(e);
    cur = { x: Math.min(start.x, q.x), y: Math.min(start.y, q.y), w: Math.abs(q.x - start.x), h: Math.abs(q.y - start.y) };
    Object.assign(box.style, { left: cur.x * 100 + '%', top: cur.y * 100 + '%', width: cur.w * 100 + '%', height: cur.h * 100 + '%' });
  });
  const end = () => {
    if (!start) return;
    start = null;
    const c = cur; cur = null;
    if (!c || c.w <= 0.08 || c.h <= 0.04) { if (box && !photo.crop) box.remove(); return; }   // a tap, or too small to be a box
    const orig = { x: r.x + c.x * r.w, y: r.y + c.y * r.h, w: c.w * r.w, h: c.h * r.h };   // in the original photo's terms
    if (!photo.zoom) {   // step 1: zoom in on the scoreboard
      photo.zoom = orig; photo.zoomImg = null; photo.crop = null;
      makeZoom().then(() => RENDER.photo()).catch(() => { photo.zoom = null; photo.crop = orig; RENDER.photo(); });   // can't zoom: take it as the row
    } else { photo.crop = orig; RENDER.photo(); }   // step 2: your row
  };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);
}

function bindReview(root, su) {
  const D = photo.draft;
  const sheetTotal = () => photo.totals[photo.totals.length - 1];
  let last = null;
  const btn = root.querySelector('#savePhotoBtn'), st = root.querySelector('#reviewStatus');
  const status = r => {
    last = r;
    let ok = r.ok && r.complete, msg;
    if (!r.ok) msg = r.error;
    else if (!r.complete) msg = 'Keep going — fill every frame.';
    else {
      const t = sheetTotal();
      msg = 'Total: ' + r.total + (t ? (r.total === t ? ' ✓ matches the total on the screen' : ' — the screen shows ' + t + ', double-check') : '');
    }
    const gated = ok && photo.scanned && !photo.checked;
    st.textContent = msg; st.className = 'scan-status' + (ok ? ' good' : '');
    btn.disabled = !ok || gated;
    btn.textContent = ok ? 'Save — ' + r.total : 'Save';
    return { ok: ok && !gated, msg: gated ? 'Tick the box once you’ve checked every frame.' : msg };
  };
  const ed = frameEditor(root.querySelector('#phEditor'), D, { prefix: 'ph', status });
  on('phChecked', 'change', e => { photo.checked = e.target.checked; status(last || Scan.check(D)); });
  btn.addEventListener('click', () => {
    const res = status(Scan.check(D));
    if (!res.ok) { toast(res.msg); return; }
    const r = last;
    const g = Object.assign(BB.gameBase(su), { mode: 'photo', frames: r.game.frames, total: r.total });
    const thumb = photo.thumb;
    resetPhoto();
    attachPhoto(g, thumb);
    BB.saveGame(g);
  });
  return ed;
}
function attachPhoto(g, thumb) {
  if (!thumb) return;
  Store.photos.put(g.id, thumb).then(ok => {
    if (ok) Store.updateGame(g.id, { photoId: g.id });
    else toast('The photo couldn’t be kept on this device — the score is saved.', 3500);
  });
}

/* ---------- type the running totals from the photo ---------- */
// The same panel as the Running totals way of scoring, with the photo above it to read from. Frames are only worked
// out when the totals fit exactly one game; otherwise the game counts toward your average. If the scan managed to
// read all ten totals they're filled in to check.
function renderTotals(root, su) {
  const prefilled = !photo.rt && photo.totals.length === 10;
  if (!photo.rt) photo.rt = { cum: prefilled ? photo.totals.map(String) : new Array(10).fill('') };
  const title = BB.entryHeader(su, 'photo') + '<div class="card"><button class="link-btn" id="ptBack">‹ Back to the photo</button>' +
    (photo.img ? '<img class="photo-preview" src="' + Store.safeImage(photo.img) + '" alt="lane screen photo">' : '') +
    (prefilled ? '<p class="small muted mb0">The scanner read these totals. Check each one against the screen.</p>' : '') + '</div>';
  BB.renderRunningTotals(root, {
    title, prefix: 'pt', target: photo.rt,
    onSave: data => {
      const g = Object.assign(BB.gameBase(su), data, { mode: 'frames' });
      const thumb = photo.thumb;
      resetPhoto();
      attachPhoto(g, thumb);
      BB.saveGame(g);
    },
  });
  BB.bindEntryBall(su);
  on('ptBack', 'click', () => { photo.view = ''; RENDER.photo(); });
}

/* ---------- copy scan details ---------- */
function copyScan() {
  const sc = photo.scan;
  if (!sc) return;
  const chk = photo.draft ? Scan.check(photo.draft) : null;
  const text = Scan.report({ version: BB.VERSION, when: new Date().toISOString(), photo: sc.photo, raw: sc.raw, lines: sc.lines, passes: sc.passes, detail: sc.detail, totals: sc.totals, fitted: sc.fitted, confirmed: sc.confirmed, mostly: sc.mostly, agree: sc.agree, error: sc.error, note: sc.note,
    draft: photo.draft, total: chk && chk.ok && chk.complete ? chk.total : null, checked: photo.draft && photo.scanned ? photo.checked : null });
  BB.copyText(text).then(ok => {
    if (ok) toast('Copied. Paste it into an email to hello@bowlboard.app', 4500);
    else BB.textSheet('scan-details.txt', text);
  });
}

async function autoScan() {
  if (!photo.img) { toast('Add a photo first'); return; }
  const t0 = Date.now();
  const cropNow = () => (photo.crop ? Object.assign({}, photo.crop) : null);
  const size = async () => { try { const im = await loadImage(photo.img); return { w: im.width, h: im.height, crop: cropNow() }; } catch (e) { return { crop: cropNow() }; } };
  const haveOCR = typeof Tesseract !== 'undefined' && !!Tesseract.createWorker, haveGlyphs = !!(window.BBGlyphs && window.BBGlyphModel);
  if (!haveOCR && !haveGlyphs) {
    // no reader: straight to typing it in, at once (the photo's size only matters for the copied details, so it follows)
    photo.note = 'Reading the screen needs a connection the first time — type the frames or the totals in instead.';
    photo.draft = photo.draft || Scan.emptyDraft();
    const sc = photo.scan = { photo: { crop: cropNow() }, error: 'The reading library isn’t loaded (no connection?), so nothing was read.' };
    RENDER.photo();
    size().then(info => { sc.photo = info; });
    return;
  }
  photo.scanning = true; photo.cropping = false; photo.note = 'Reading the screen…'; photo.scan = null; RENDER.photo();
  let worker;
  try {
    const pm = await prepareMask(photo.img, photo.crop);
    photo.proc = maskToPNG(pm.mask, pm.W, pm.H);
    const info = await size();
    info.procW = pm.W; info.procH = pm.H;
    photo.scan = { photo: info };
    const passes = [], raws = [], labels = [];
    let r = null, all = null;
    const take = (ls, raw, label) => { passes.push(ls); raws.push(raw); labels.push(label); all = Scan.combinePasses(passes); r = Scan.read(all.lines); };
    if (haveGlyphs) {
      // first the built-in glyph-by-glyph reader: instant, and it needs no connection
      let gl = [];
      try { gl = BBGlyphs.find(pm.mask, pm.W, pm.H).lines; } catch (e) { gl = []; }
      if (gl.length) take(gl.map(l => ({ text: l.text, confs: l.confs })), gl.map(l => l.text).join('\n'), 'glyph reader');
    }
    if (!(r && (r.confirmed || r.mostly)) && haveOCR) {
      worker = await Tesseract.createWorker('eng');
      for (let i = 0; i < PASSES.length; i++) {
        const p = PASSES[i];
        if (i || passes.length) { photo.note = 'Checking the reading…'; RENDER.photo(); }
        await worker.setParameters({ tessedit_char_whitelist: 'Xx/-0123456789F ', tessedit_pageseg_mode: p.psm, preserve_interword_spaces: '1' });
        const res = await worker.recognize(await scaled(photo.proc, p.f));
        take(Scan.linesFromOCR(res.data), String((res.data && res.data.text) || ''), passLabel(p));
        if (r.confirmed || r.mostly) break;   // marks and totals agree: no need to read it again
      }
    }
    if (!r) { all = Scan.combinePasses([[]]); r = Scan.read(all.lines); }
    const lines = all.lines;
    info.ms = Date.now() - t0;
    photo.scan = { photo: info, raw: raws.map((t, i) => (raws.length > 1 ? '— ' + labels[i] + ' —\n' : '') + t.replace(/\s+$/, '')).join('\n\n'), lines: lines.map(l => l.text),
      passes: all.first.map((first, i) => ({ label: labels[i], first })), detail: r.detail, totals: r.totals, fitted: r.fitted, confirmed: r.confirmed, mostly: r.mostly, agree: r.agree };
    // A whole-screen photo shows several bowlers' rows, and what comes back is a mix of them that looks like a game but
    // isn't yours. Unless the marks and totals agree (or the totals fit exactly), don't fill in a draft from it: ask for a box.
    const mixed = !photo.crop && !r.confirmed && !r.mostly && !r.fitted;
    if (mixed) {
      photo.scan.note = 'Nothing was filled in: a whole-screen photo with no box, and the marks and totals did not agree.';
      photo.draft = null; photo.totals = []; photo.scanned = false; photo.checked = false; photo.cropping = true; photo.zoom = null; photo.zoomImg = null;
      photo.note = 'Couldn’t pick your row out of the whole screen. Drag a box around the scoreboard to zoom in, then one around your row. Or tap Type it in.';
      photo.scanning = false;
      RENDER.photo();
      return;
    }
    photo.draft = r.draft;
    photo.totals = r.totals.length === 10 ? r.totals : [];
    if (photo.rt && photo.rt.cum.every(v => v === '')) photo.rt = null;   // nothing typed yet: let the totals it read fill the boxes
    photo.scanned = true;
    photo.checked = false;
    const filled = r.draft.balls.filter(b => b.length).length;
    const online = haveOCR ? '' : ' (Online, a second reader also has a go.)';
    const wide = !photo.crop && !r.confirmed && !r.mostly ? ' The whole screen is in the photo, so boxing just your row usually reads better.' : '';
    photo.note = !filled ? 'Couldn\u2019t find the frames. Try boxing just your row, or type the frames or the totals in.' + online
      : r.mostly ? 'Read the marks and the running totals: ' + r.agree + ' of the totals match the marks, so the marks look right. Frames whose total didn\u2019t match are amber.'
      : r.confirmed ? 'Read the marks and the running totals, and they agree frame by frame.'
      : r.fitted ? 'Read the running totals and fitted the frames to them' + (r.detail.unique ? ' (only one game fits them)' : '') + '. Check the amber frames against the screen.' + wide
      : r.totals.length === 10 ? 'Read ' + r.marks + ' marks. The running totals it read don\u2019t fit any game, so they were probably misread. Check every frame, or type the totals in.' + wide + online
      : 'Read ' + r.marks + ' marks. The running totals weren\u2019t readable, so check every frame.' + wide + online;
  } catch (e) {
    photo.note = 'Couldn’t read it — type the frames or the totals in instead.';
    photo.draft = photo.draft || Scan.emptyDraft();
    photo.scan = Object.assign(photo.scan || { photo: await size() }, { error: 'Reading stopped with: ' + String((e && e.message) || e) });
  } finally {
    if (worker) worker.terminate().catch(() => {});
  }
  photo.scanning = false;
  RENDER.photo();
}

// Test hook: load a draft as if it had been scanned (balls per frame, optional flags).
photo.setDraft = (balls, opts) => {
  const d = Scan.emptyDraft();
  balls.forEach((b, i) => { d.balls[i] = b.slice(); d.fouls[i] = b.map(() => false); });
  if (opts && opts.flags) d.flags = opts.flags.slice();
  photo.draft = d; photo.scanned = !(opts && opts.typed); photo.checked = false;
};

window.BBPhoto = photo;
Object.assign(BB, { resetPhoto, preparePhoto: prepare, prepareMask, maskToPNG, scalePhoto: scaled });
})();
