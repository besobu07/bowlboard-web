/* BowlBoard — photo of the lane screen. The scan only ever drafts the game:
 *   1. snap the overhead/console screen when the game is done
 *   2. optionally drag a box around your row
 *   3. the crop is cleaned up (grey, contrast, dark screens flipped to dark-on-light,
 *      black and white) and read for marks only: X / - F and single digits
 *   4. marks are placed by bowling rules (js/scan.js); anything impossible or unclear
 *      is flagged, and you check every frame on the tap-a-frame keypad before saving.
 * Scoring from paper sheets isn't a goal; screens are. */
(function () {
'use strict';
const BB = window.BB;
const S = window.BBScore, Store = window.BBStore, Scan = window.BBScan;
const { RENDER, EMBED, esc, icon, on, el, toast, screenRoot, frameEditor } = BB;

const photo = { setup: null, img: null, thumb: null, crop: null, cropping: false, proc: null, draft: null, note: '', scanning: false, totals: [], scanned: false, checked: false };
function resetPhoto(setup) {
  photo.setup = setup || photo.setup;
  Object.assign(photo, { img: null, thumb: null, crop: null, cropping: false, proc: null, draft: null, note: '', scanning: false, totals: [], scanned: false, checked: false });
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
async function prepare(src, crop) {
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
  const erase = gridLines(ink, W, H, Math.max(3, Math.round(4 * scale)));
  const id = ctx.getImageData(0, 0, W, H), px = id.data;
  for (let k = 0, p = 0; k < W * H; k++, p += 4) { const v = ink[k] && !erase[k] ? 0 : 255; px[p] = px[p + 1] = px[p + 2] = v; px[p + 3] = 255; }
  ctx.putImageData(id, 0, 0);
  return c.toDataURL('image/png');
}

RENDER.photo = function () {
  const root = screenRoot();
  if (!photo.setup) { BB.show('new'); return; }
  const su = photo.setup;
  let h = BB.entryHeader(su, 'photo');
  h += '<div class="card">';
  if (!photo.img && photo.draft) {
    h += '<div class="row"><span class="small muted grow">' + icon('screen') + ' No photo — typing it in from the screen.</span><label class="btn secondary small-btn" for="photoFile">' + icon('camera') + 'Add a photo</label></div>' +
      '<input type="file" id="photoFile" accept="image/*" capture="environment" hidden>';
  } else if (!photo.img) {
    h += '<p class="mt0">' + icon('screen') + ' <b>Photo of the lane screen</b></p>' +
      '<ul class="tips"><li>Take it when your game is finished.</li><li>Fill the photo with your row — your name and all 10 frames.</li><li>Tilt a little to dodge glare, and hold still for a second.</li></ul>' +
      (EMBED ? '<p class="small muted">Here you can keep the photo with the game and type the frames in; reading the screen works in the installed app.</p>' : '<p class="small muted">BowlBoard drafts the frames from the photo. You check every one before it’s saved.</p>');
    h += '<label class="btn" for="photoFile">' + icon('camera') + 'Take or choose a photo</label>';
    h += '<input type="file" id="photoFile" accept="image/*" capture="environment" hidden>';
    h += '<button class="btn secondary mt8" id="manualBtn">Skip the photo — type it in</button>';
  } else {
    h += '<div class="crop-wrap' + (photo.cropping ? ' cropping' : '') + '" id="cropWrap"><img class="photo-preview" src="' + Store.safeImage(photo.img) + '" alt="lane screen photo">' +
      (photo.crop ? '<div class="crop-box" style="left:' + photo.crop.x * 100 + '%;top:' + photo.crop.y * 100 + '%;width:' + photo.crop.w * 100 + '%;height:' + photo.crop.h * 100 + '%"></div>' : '') + '</div>';
    h += '<div class="small muted">' + (photo.cropping ? 'Drag a box around your row, then tap Done.' : photo.crop ? 'Reading only the boxed area.' : 'Tip: box in just your row for a cleaner read.') + '</div>';
    if (!EMBED) h += '<button class="btn mt8" id="scanBtn"' + (photo.scanning || photo.cropping ? ' disabled' : '') + '>' + icon('sparkle') + (photo.scanning ? 'Reading…' : photo.scanned ? 'Read it again' : 'Read the screen') + '</button>';
    h += '<div class="row wrap mt8 photo-tools">' +
      '<button class="btn secondary small-btn" id="cropBtn" aria-pressed="' + photo.cropping + '">' + icon('crop') + (photo.cropping ? 'Done' : photo.crop ? 'Re-box' : 'Box my row') + '</button>' +
      (photo.crop && !photo.cropping ? '<button class="btn secondary small-btn" id="cropClear">Whole photo</button>' : '') +
      (photo.draft ? '' : '<button class="btn secondary small-btn" id="manualBtn">Type it in</button>') +
      '<button class="btn secondary small-btn" id="clearPhotoBtn">Retake</button></div>';
    if (photo.proc) h += '<details class="proc"><summary>What the scanner read</summary><img src="' + Store.safeImage(photo.proc) + '" alt="cleaned-up crop used for reading"><p class="small muted">If this looks like mush, retake the photo rather than fixing every frame.</p></details>';
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

  on('photoFile', 'change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    const raw = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
    try {
      photo.img = await downscale(raw, 2000, 0.9);
      photo.thumb = await downscale(raw, 1000, 0.72); // kept in IndexedDB, not in the main save file
    } catch (err) { toast('Could not read that image'); return; }
    RENDER.photo();
  });
  on('scanBtn', 'click', autoScan);
  on('cropBtn', 'click', () => { photo.cropping = !photo.cropping; RENDER.photo(); });
  on('cropClear', 'click', () => { photo.crop = null; RENDER.photo(); });
  on('manualBtn', 'click', () => { photo.draft = photo.draft || Scan.emptyDraft(); photo.note = ''; RENDER.photo(); });
  on('clearPhotoBtn', 'click', () => { resetPhoto(); RENDER.photo(); });
  if (photo.cropping) bindCrop(el('cropWrap'));
  if (photo.draft) bindReview(root, su);
};

function bindCrop(wrap) {
  if (!wrap) return;
  let start = null, box = null;
  const pt = e => { const r = wrap.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }; };
  wrap.addEventListener('pointerdown', e => {
    e.preventDefault();
    start = pt(e);
    wrap.setPointerCapture && wrap.setPointerCapture(e.pointerId);
    box = wrap.querySelector('.crop-box') || wrap.appendChild(Object.assign(document.createElement('div'), { className: 'crop-box' }));
  });
  wrap.addEventListener('pointermove', e => {
    if (!start) return;
    const q = pt(e);
    const c = { x: Math.min(start.x, q.x), y: Math.min(start.y, q.y), w: Math.abs(q.x - start.x), h: Math.abs(q.y - start.y) };
    Object.assign(box.style, { left: c.x * 100 + '%', top: c.y * 100 + '%', width: c.w * 100 + '%', height: c.h * 100 + '%' });
    photo.crop = c.w > 0.04 && c.h > 0.02 ? c : null;
  });
  const end = () => { start = null; };
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
    if (thumb) {
      Store.photos.put(g.id, thumb).then(ok => {
        if (ok) Store.updateGame(g.id, { photoId: g.id });
        else toast('The photo couldn’t be kept on this device — the score is saved.', 3500);
      });
    }
    BB.saveGame(g);
  });
  return ed;
}

async function autoScan() {
  if (!photo.img) { toast('Add a photo first'); return; }
  if (typeof Tesseract === 'undefined' || !Tesseract.createWorker) {
    photo.note = 'Reading the screen needs a connection the first time — type the frames in instead.';
    photo.draft = photo.draft || Scan.emptyDraft();
    RENDER.photo(); return;
  }
  photo.scanning = true; photo.note = 'Reading the screen…'; RENDER.photo();
  let worker;
  try {
    photo.proc = await prepare(photo.img, photo.crop);
    worker = await Tesseract.createWorker('eng');
    await worker.setParameters({ tessedit_char_whitelist: 'Xx/-0123456789F ', tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    const res = await worker.recognize(photo.proc);
    const r = Scan.read(Scan.linesFromOCR(res.data));
    photo.draft = r.draft;
    photo.totals = r.totals.length === 10 ? r.totals : [];
    photo.scanned = true;
    photo.checked = false;
    const filled = r.draft.balls.filter(b => b.length).length;
    photo.note = !filled ? 'Couldn\u2019t find the frames. Try boxing just your row, or type it in.'
      : r.confirmed ? 'Read the marks and the running totals, and they agree frame by frame.'
      : r.fitted ? 'Read the running totals and fitted the frames to them. Check the amber frames against the screen.'
      : 'Read ' + r.marks + ' marks. The running totals weren\u2019t readable, so check every frame.';
  } catch (e) {
    photo.note = 'Couldn’t read it — type the frames in instead.';
    photo.draft = photo.draft || Scan.emptyDraft();
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
Object.assign(BB, { resetPhoto, preparePhoto: prepare });
})();
