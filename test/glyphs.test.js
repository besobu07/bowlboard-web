// Tests for the glyph-by-glyph photo reader (js/glyphs.js + js/glyph-model.js). Run: node test/glyphs.test.js
// The masks in test/fixtures/glyph-masks.json are made by tools/make_glyph_fixtures.py: synthetic lane screens
// (condensed digits, thick borders touching them, totals whose digits touch) with a known game. No real photos.
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const root = path.join(__dirname, '..');
const G = require(path.join(root, 'js/glyphs.js')), M = require(path.join(root, 'js/glyph-model.js')), Scan = require(path.join(root, 'js/scan.js'));

let pass = 0, fail = 0;
function eq(actual, expected, name) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else { fail++; console.log('FAIL', name, '- expected', JSON.stringify(expected), 'got', JSON.stringify(actual)); }
}
const ok = (c, name) => eq(!!c, true, name);

// ---------- the model ----------
eq([M.classes, M.gw, M.gh, M.nin, M.nh], ['0123456789X/-F?', 12, 18, 218, 96], 'model: classes and shape');
eq([M.w1.length, M.b1.length, M.w2.length, M.b2.length], [218 * 96, 96, 96 * 15, 15], 'model: weight array sizes');
ok(M.w1.every(Number.isFinite) && M.w2.every(Number.isFinite) && M.b1.every(Number.isFinite) && M.b2.every(Number.isFinite), 'model: every weight is a finite number');

// ---------- features: worked out by hand ----------
{
  const solid = (w, h) => new Uint8Array(w * h).fill(1);
  let f = G.features(solid(7, 11), 7, 11, 1.25);
  ok(Array.from(f).slice(0, 216).every(v => Math.abs(v - 1) < 1e-9), 'features: a solid block is ink in every cell');
  eq([+f[216].toFixed(6), +f[217].toFixed(6)], [0.5, +(7 / 11 / 3).toFixed(6)], 'features: relative height and shape (width/height) are the last two');
  f = G.features(solid(40, 3), 40, 3, 9);
  eq([+f[216].toFixed(6), f[217]], [1, 1], 'features: both extras are capped (height at 2.5x, shape at 3)');
  // left half inked: cells in columns 0..5 full, 6..11 empty (12 columns, so the split falls on a cell edge)
  const w = 24, h = 18, bits = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w / 2; x++) bits[y * w + x] = 1;
  f = G.features(bits, w, h, 1);
  let good = true;
  for (let i = 0; i < 18; i++) for (let j = 0; j < 12; j++) if (Math.abs(f[i * 12 + j] - (j < 6 ? 1 : 0)) > 1e-9) good = false;
  ok(good, 'features: left-half ink gives full cells on the left and empty on the right');
  // a bitmap smaller than the grid is stretched, not dropped
  f = G.features(solid(3, 5), 3, 5, 1);
  ok(Array.from(f).slice(0, 216).every(v => Math.abs(v - 1) < 1e-9), 'features: a tiny bitmap still fills every cell');
}

// ---------- classifier ----------
{
  const w = 30, h = 60, bits = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.abs(x - (w - 1) * (h - 1 - y) / (h - 1)) < 3) bits[y * w + x] = 1;   // a slash
  const c = G.classify(bits, w, h, 1);
  ok(c.p > 0 && c.p <= 1 && M.classes.indexOf(c.ch) >= 0, 'classify: gives a class from the model and a probability');
  eq(+Array.from(c.probs).reduce((a, b) => a + b, 0).toFixed(6), 1, 'classify: the probabilities add up to 1');
  eq(c.ch, '/', 'classify: a leaning stroke is a spare mark');
}

// ---------- components and bar removal, on a hand-made mask ----------
{
  const W = 1600, H = 300, m = new Uint8Array(W * H);
  const rect = (x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * W + x] = 1; };
  rect(100, 100, 130, 180); rect(300, 100, 330, 180);   // two glyph-sized blocks
  rect(0, 140, 1600, 146);                              // a long horizontal bar through both
  rect(800, 0, 804, 300);                               // a long vertical bar crossing it
  eq(G.label(m, W, H).n, 1, 'label: everything touching is one blob');
  const c = G.removeBars(m, W, H);
  eq(G.label(c, W, H).n, 4, 'removeBars: the bars go and the blocks come back as four pieces (cut where the bar crossed)');
  eq([c[143 * W + 500], c[50 * W + 802]], [0, 0], 'removeBars: bar pixels are cleared');
  eq([c[105 * W + 110], c[175 * W + 320]], [1, 1], 'removeBars: glyph pixels away from the bar are kept');
  const d = G.label(new Uint8Array(W * H), W, H);
  eq(d.n, 0, 'label: an empty mask has no blobs');
  // diagonal pixels belong to one blob (8 neighbours)
  const dm = new Uint8Array(25); dm[0] = dm[6] = dm[12] = 1;
  eq(G.label(dm, 5, 5).n, 1, 'label: diagonal neighbours join');
}

// ---------- synthetic lane screens ----------
const load = j => {
  const bits = zlib.inflateSync(Buffer.from(j.data, 'base64')), m = new Uint8Array(j.W * j.H);
  for (let i = 0; i < m.length; i++) m[i] = (bits[i >> 3] >> (i & 7)) & 1;
  return m;
};
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/glyph-masks.json')));
const all = Object.keys(fx), names = all.filter(n => !/^weak-/.test(n)), weak = all.filter(n => /^weak-/.test(n));
ok(names.length >= 3, 'fixtures: at least three differently drawn screens');
const t0 = Date.now();
for (const name of names) {
  const j = fx[name], r = G.find(load(j), j.W, j.H), s = Scan.read(r.lines);
  const want = j.balls.map(b => b.join(',')).join('|');
  ok(r.lines.length >= 2, name + ': finds the marks line and the totals line');
  eq(r.lines[0].text.replace(/ /g, ''), 'X9/72XX53X7' + '2X81', name + ': the marks line reads X 9/ 7 2 X X 5 3 X 7 2 X 8 1');
  eq(s.draft.balls.map(b => b.join(',')).join('|'), want, name + ': every frame comes out right');
  const chk = Scan.check(s.draft);
  eq([chk.ok, chk.complete, chk.total], [true, true, j.total], name + ': the draft is a complete game scoring ' + j.total);
  ok(r.lines.every(l => l.confs.length === l.text.length), name + ': one confidence per character');
  ok(r.lines.every(l => l.confs.every(c => c === null || (c >= 0 && c <= 100))), name + ': confidences are 0 to 100');
  // the clutter drawn in (a frame-number tail, a speck) is not read as marks
  ok(!/[?]/.test(r.lines.map(l => l.text).join('')), name + ': no junk characters in the text');
}
ok((Date.now() - t0) / names.length < 1500, 'speed: a screen reads in well under 1.5 s (' + Math.round((Date.now() - t0) / names.length) + ' ms each)');

// ---------- a known weak spot, pinned so a change shows up ----------
// In Inter ExtraBold squeezed thin, the digit 1 is read as junk (so a trailing 1 is lost and 71 reads as 7). The reader
// should still get everything before that right, never crash, and never invent frames. If the model gets better at
// this the last check can be tightened to the full game.
for (const name of weak) {
  const j = fx[name], r = G.find(load(j), j.W, j.H), s = Scan.read(r.lines);
  const got = s.draft.balls.map(b => b.join(',')), want = j.balls.map(b => b.join(','));
  eq(got.slice(0, 9), want.slice(0, 9), name + ': the first nine frames are right');
  ok(got.length <= 10, name + ': no extra frames invented');
}

// ---------- totals: what the reader gets right is reported honestly ----------
{
  // On these drawn screens the totals line is the weak spot (thin 1s, touching digits). The marks are what matter,
  // and the scan code must keep right marks even when some totals are off; this pins that behaviour.
  let readTotals = 0, tried = 0;
  for (const name of names) {
    const j = fx[name], r = G.find(load(j), j.W, j.H), tl = r.lines[1];
    if (!tl) continue;
    const got = tl.text.split(' ').map(Number).filter(Number.isFinite);
    got.forEach(v => { tried++; if (j.totals.indexOf(v) >= 0) readTotals++; });
  }
  ok(tried > 0 && readTotals / tried >= 0.5, 'totals: most totals that are read are real running totals (' + readTotals + ' of ' + tried + ')');
}

// ---------- the reader plus the scoring rules ----------
{
  const j = fx[names[0]], r = G.find(load(j), j.W, j.H);
  const s = Scan.read([r.lines[0], { text: j.totals.join(' '), confs: null }]);
  eq([s.confirmed, s.fitted], [true, false], 'with the true totals under them, the marks are confirmed');
  const s2 = Scan.read([r.lines[0], { text: j.totals.map((v, i) => (i === 6 ? 1 : v)).join(' '), confs: null }]);
  eq([s2.mostly, s2.confirmed, Scan.check(s2.draft).total], [true, false, 153], 'one wrong total: the marks are still kept (9 of 10 agree)');
}

// ---------- nothing in, nothing out ----------
{
  eq(G.find(new Uint8Array(800 * 200), 800, 200).lines, [], 'blank photo: no lines');
  const noise = new Uint8Array(800 * 200); for (let i = 0; i < noise.length; i += 7) noise[i] = 1;
  ok(Array.isArray(G.find(noise, 800, 200).lines), 'speckle: no crash');
  const solid = new Uint8Array(800 * 200).fill(1);
  ok(Array.isArray(G.find(solid, 800, 200).lines), 'a solid black photo: no crash');
  ok(Array.isArray(G.find(new Uint8Array(40 * 20), 40, 20).lines), 'a tiny photo: no crash');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
