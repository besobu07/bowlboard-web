/* BowlBoard — share cards: a picture of a game, a night, your season or an achievement, drawn
 * on this device in the brand's look and ready to post. Nothing is uploaded. The name and the
 * center can be left off before sharing.
 *
 *   BB.shareCard(kind, params)   kind: 'game' {id} | 'night' {seriesId, gameId?} | 'season' {preset, type} | 'ach' {id}
 *   BB.share.spec / .render      the picture's contents, and the canvas it draws (used by the tests) */
(function () {
'use strict';
const BB = window.BB;
const Store = window.BBStore, S = window.BBScore, I = window.BBInsights, A = window.BBAchievements;
const { esc, fmtDate, icon, toast, openSheet, closeSheet, plural, todayISO, avgFloor, EMBED } = BB;

const W = 1080, H = 1350;                                   // 4:5, the portrait size social feeds show in full
const C = { bg: '#0E0E0E', card2: '#232323', line: '#3a3226', cream: '#F8EED7', text: '#FFF7E6', muted: '#b0a898', gold: '#F6A623', amber: '#F6B042', red: '#E02A24', ink: '#121416', paperInk: '#6b5e40' };
const HEAD = "Poppins, Inter, 'Helvetica Neue', Arial, sans-serif", BODY = "Inter, 'Helvetica Neue', Arial, sans-serif";
const font = (w, px, fam) => w + ' ' + px + 'px ' + fam;
const LONG = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
const TAGLINE = 'Built for Bowlers · bowlboard.app';

/* ---------- what goes on the card ---------- */
const nightOf = g => BB.myGames().filter(x => x.seriesId === g.seriesId && x.total != null).sort((a, b) => (a.gameNo || 1) - (b.gameNo || 1));
const sum = a => a.reduce((x, y) => x + y, 0);

function placeLines(games, opts) {
  const g = games[0], lines = [];
  if (opts.center) {
    const where = [g.centerId ? Store.centerName(g.centerId) : '', BB.laneLabel(g)].filter(Boolean).join(' · ');
    if (where) lines.push(where);
  }
  const balls = Array.from(new Set(games.map(x => (x.ballId && Store.state.balls.some(b => b.id === x.ballId) ? Store.ballLabel(x.ballId).replace(/ \([\d.]+ lb\)$/, '') : '')).filter(Boolean)));
  const extra = [balls.join(', '), g.pattern || ''].filter(Boolean).join(' · ');
  if (extra) lines.push(extra);
  return lines;
}
function cardOf(g) {
  if (!Array.isArray(g.frames) || g.frames.length !== 10) return null;
  try { const sc = S.computeScore({ frames: g.frames.map(S.normFrame) }); return { marks: sc.marks, cum: sc.cumulative, splits: sc.splits }; } catch (e) { return null; }
}

function gameSpec(p, opts) {
  const g = BB.getAnyGame(p.id);
  if (!g || g.total == null) return null;
  const night = nightOf(g), all = BB.gamePool().games;
  const best = all.reduce((m, x) => Math.max(m, x.total), 0);
  return {
    kind: 'game', title: 'Share this game', file: 'game-' + g.date,
    kicker: night.length > 1 ? 'GAME ' + (g.gameNo || 1) + ' OF ' + night.length : 'GAME ' + (g.gameNo || 1),
    date: fmtDate(g.date, LONG), score: g.total,
    tag: g.total === 300 ? 'PERFECT GAME' : all.length >= 5 && g.total >= best ? 'PERSONAL BEST' : g.total >= 200 ? '200+ GAME' : '',
    card: cardOf(g),
    tiles: night.length > 1 ? night.map(x => ({ label: 'G' + (x.gameNo || 1), value: x.total, hl: x.id === g.id })) : null,
    note: night.length > 1 ? 'Series ' + sum(night.map(x => x.total)) + ' · Avg ' + avgFloor(night.map(x => x.total)) : '',
    lines: placeLines(night.length ? night : [g], opts), name: opts.name ? BB.firstName() : '',
    text: 'I bowled a ' + g.total + '!',
  };
}

function nightSpec(p, opts) {
  const first = p.gameId ? BB.getAnyGame(p.gameId) : null;
  const seriesId = p.seriesId || (first && first.seriesId);
  const night = BB.myGames().filter(x => x.seriesId === seriesId && x.total != null).sort((a, b) => (a.gameNo || 1) - (b.gameNo || 1));
  if (!night.length) return null;
  const t = night.map(x => x.total), total = sum(t), avg = avgFloor(t);
  const others = BB.gamePool().games.filter(x => x.seriesId !== seriesId).map(x => x.total);
  const vs = others.length >= 9 ? avg - avgFloor(others) : null;
  const framed = night.every(x => Array.isArray(x.frames) && x.frames.length === 10);
  const strikes = framed ? S.pinStats(night.map(x => ({ frames: x.frames }))).strikes : null;
  return {
    kind: 'night', title: 'Share tonight’s series', file: 'series-' + night[0].date,
    kicker: night.length + '-GAME SERIES', date: fmtDate(night[0].date, LONG), score: total,
    tiles: night.map(x => ({ label: 'GAME ' + (x.gameNo || 1), value: x.total, hl: x.total === Math.max.apply(null, t) && night.length > 1 })),
    stats: [{ label: 'AVERAGE', value: avg }, { label: 'HIGH GAME', value: Math.max.apply(null, t) },
      vs != null ? { label: 'VS YOUR AVG', value: (vs > 0 ? '+' : vs < 0 ? '−' : '') + Math.abs(vs) } : strikes != null ? { label: 'STRIKES', value: strikes } : { label: 'GAMES', value: night.length }],
    lines: placeLines(night, opts), name: opts.name ? BB.firstName() : '',
    text: night.length + '-game series: ' + total + '.',
  };
}

function seasonSpec(p, opts) {
  const preset = p.preset || 'all';
  const games = I.chrono(BB.gamePool().games.filter(g => BB.inRange(g.date, preset) && BB.typeMatch(g, p.type || '')));
  if (!games.length) return null;
  const t = games.map(g => g.total);
  const label = preset === 'season' ? I.seasonLabel(I.seasonOf(todayISO())) + ' SEASON' : (BB.RANGES.find(r => r[0] === preset) || ['', 'All time'])[1].toUpperCase();
  const series = BB.highSeries(Store.allSeries(games));
  const typeName = p.type === '__practice' ? 'Practice' : p.type === '__league' ? 'League nights' : p.type ? ((Store.getLeague(p.type) || {}).name || '') : '';
  return {
    kind: 'season', title: 'Share your stats', file: 'stats-' + todayISO(),
    kicker: label, date: typeName, score: avgFloor(t), scoreLabel: 'AVERAGE',
    stats: [{ label: 'HIGH GAME', value: Math.max.apply(null, t) }, { label: 'HIGH SERIES', value: series || '-' }, { label: 'GAMES', value: t.length }],
    trend: t.slice(-40), lines: [], name: opts.name ? BB.firstName() : '',
    text: 'My average: ' + avgFloor(t) + '.',
  };
}

function achSpec(p, opts) {
  const res = A.evaluate(BB.gamePool().games);
  const a = res.list.find(x => x.id === p.id);
  if (!a || !a.earned) return null;
  return { kind: 'ach', title: 'Share this achievement', file: 'achievement-' + a.id, kicker: 'ACHIEVEMENT UNLOCKED', date: 'Earned ' + fmtDate(a.earned.date, { month: 'long', day: 'numeric', year: 'numeric' }),
    coin: { mark: a.mark, sub: a.sub, icon: a.icon }, heading: a.title, desc: a.desc, lines: [], name: opts.name ? BB.firstName() : '', text: a.title + ': ' + a.desc + '.' };
}

const SPECS = { game: gameSpec, night: nightSpec, season: seasonSpec, ach: achSpec };
const spec = (kind, params, opts) => (SPECS[kind] ? SPECS[kind](params || {}, Object.assign({ name: true, center: true }, opts)) : null);

/* ---------- drawing ---------- */
function rrPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
// Text with optional letter spacing, shrink-to-fit width and a shadow. Returns the size used.
function txt(ctx, s, x, y, o) {
  o = o || {};
  let px = o.size || 32;
  const fam = o.family || BODY, wt = o.weight || 500;
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = o.color || C.text;
  ctx.font = font(wt, px, fam);
  const width = () => (o.spacing ? Array.from(s).reduce((a, ch) => a + ctx.measureText(ch).width + o.spacing, -o.spacing) : ctx.measureText(s).width);
  if (o.maxW) while (px > 14 && width() > o.maxW) { px -= 2; ctx.font = font(wt, px, fam); }
  if (o.shadow) { ctx.shadowColor = o.shadow.c; ctx.shadowBlur = o.shadow.b; ctx.shadowOffsetY = o.shadow.y || 0; }
  if (o.spacing) {
    const chars = Array.from(s), total = width();
    let cx = o.align === 'center' ? x - total / 2 : o.align === 'right' ? x - total : x;
    ctx.textAlign = 'left';
    chars.forEach(ch => { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + o.spacing; });
  } else { ctx.textAlign = o.align || 'left'; ctx.fillText(s, x, y); }
  ctx.restore();
  return px;
}
function wrap(ctx, s, maxW, wt, px, fam) {
  ctx.save(); ctx.font = font(wt, px, fam);
  const out = []; let line = '';
  String(s).split(/\s+/).forEach(w => { const t = line ? line + ' ' + w : w; if (line && ctx.measureText(t).width > maxW) { out.push(line); line = w; } else line = t; });
  if (line) out.push(line);
  ctx.restore();
  return out;
}

function background(ctx) {
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  let g = ctx.createRadialGradient(W / 2, -60, 40, W / 2, -60, 980);
  g.addColorStop(0, 'rgba(246,166,35,.34)'); g.addColorStop(0.55, 'rgba(246,166,35,.08)'); g.addColorStop(1, 'rgba(246,166,35,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // lane boards running away to a point, very faint
  ctx.save(); rrPath(ctx, 30, 30, W - 60, H - 60, 44); ctx.clip();
  ctx.strokeStyle = 'rgba(246,166,35,.06)'; ctx.lineWidth = 2;
  for (let i = -14; i <= 14; i++) { ctx.beginPath(); ctx.moveTo(W / 2 + i * 6, 700); ctx.lineTo(W / 2 + i * 84, H); ctx.stroke(); }
  ctx.restore();
  rrPath(ctx, 30, 30, W - 60, H - 60, 44); ctx.strokeStyle = 'rgba(246,166,35,.4)'; ctx.lineWidth = 3; ctx.stroke();
}
function footer(ctx, logo) {
  if (logo) { const w = 400, h = Math.round(logo.naturalHeight * w / logo.naturalWidth); ctx.drawImage(logo, (W - w) / 2, H - 62 - h, w, h); }
  else txt(ctx, 'BowlBoard', W / 2, H - 100, { size: 64, weight: 700, family: HEAD, color: C.cream, align: 'center' });
}
function header(ctx, s) {
  txt(ctx, s.kicker, 84, 118, { size: 34, weight: 700, family: HEAD, color: C.gold, spacing: 5, maxW: 640 });
  if (s.name) txt(ctx, s.name.toUpperCase(), W - 84, 118, { size: 34, weight: 700, family: HEAD, color: C.cream, spacing: 3, align: 'right', maxW: 300 });
  if (s.date) txt(ctx, s.date, 84, 168, { size: 34, weight: 500, color: 'rgba(255,247,230,.86)', maxW: W - 168 });
}
function bigNumber(ctx, value, size, baseline, glow) {
  txt(ctx, String(value), W / 2, baseline, { size, weight: 700, family: HEAD, color: C.cream, align: 'center', maxW: W - 200, shadow: glow ? { c: 'rgba(246,166,35,.55)', b: 60, y: 0 } : { c: 'rgba(0,0,0,.5)', b: 24, y: 10 } });
}
function pill(ctx, label, y) {
  ctx.save(); ctx.font = font(700, 30, HEAD);
  const tw = Array.from(label).reduce((a, ch) => a + ctx.measureText(ch).width + 4, -4), w = tw + 64, x = (W - w) / 2;
  ctx.restore();
  rrPath(ctx, x, y, w, 60, 30); ctx.fillStyle = C.gold; ctx.fill();
  txt(ctx, label, W / 2, y + 40, { size: 30, weight: 700, family: HEAD, color: C.ink, align: 'center', spacing: 4 });
}
function lines(ctx, list, y) {
  list.slice(0, 2).forEach((l, i) => txt(ctx, l, W / 2, y + i * 46, { size: i ? 32 : 36, weight: i ? 500 : 600, color: i ? C.muted : 'rgba(255,247,230,.92)', align: 'center', maxW: W - 200 }));
  return y + Math.min(list.length, 2) * 46;
}
function tiles(ctx, items, y, o) {
  o = o || {};
  const x0 = 80, wAll = W - 160, gap = 14, n = items.length;
  const tw = Math.min(o.max || 250, (wAll - gap * (n - 1)) / n), th = o.h || 124;
  let tx = x0 + (wAll - (tw * n + gap * (n - 1))) / 2;
  items.forEach(it => {
    rrPath(ctx, tx, y, tw, th, 24);
    ctx.fillStyle = it.hl ? C.gold : C.card2; ctx.fill();
    ctx.strokeStyle = it.hl ? C.gold : C.line; ctx.lineWidth = 2; ctx.stroke();
    txt(ctx, it.label, tx + tw / 2, y + 36, { size: n > 4 ? 18 : 22, weight: 700, family: BODY, color: it.hl ? '#3a2503' : C.muted, align: 'center', spacing: 2, maxW: tw - 16 });
    txt(ctx, String(it.value), tx + tw / 2, y + th - 24, { size: o.vs || 64, weight: 700, family: HEAD, color: it.hl ? C.ink : C.text, align: 'center', maxW: tw - 24 });
    tx += tw + gap;
  });
  return y + th;
}

// The scorecard: ten frames, the balls thrown, splits ringed in red, and the running score.
function scorecard(ctx, sc, y) {
  const x = 80, w = W - 160, pad = 18, f = (w - pad * 2) / 10.5, nh = 30, mh = 48, th = 64, h = pad * 2 + nh + mh + th;
  rrPath(ctx, x, y, w, h, 26); ctx.fillStyle = C.cream; ctx.fill();
  const gx = x + pad, gy = y + pad;
  ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
  for (let i = 0; i < 10; i++) {
    const fx = gx + i * f, fw = i < 9 ? f : f * 1.5, n = i < 9 ? 2 : 3, bw = fw / n;
    ctx.strokeRect(fx, gy, fw, nh + mh + th);
    ctx.beginPath(); ctx.moveTo(fx, gy + nh); ctx.lineTo(fx + fw, gy + nh); ctx.moveTo(fx, gy + nh + mh); ctx.lineTo(fx + fw, gy + nh + mh); ctx.stroke();
    txt(ctx, String(i + 1), fx + fw / 2, gy + 22, { size: 19, weight: 700, color: C.paperInk, align: 'center' });
    for (let j = 0; j < n; j++) {
      const bx = fx + j * bw;
      if (j) { ctx.beginPath(); ctx.moveTo(bx, gy + nh); ctx.lineTo(bx, gy + nh + mh); ctx.stroke(); }
      const m = (sc.marks[i] || [])[j] || '';
      if (m) txt(ctx, m, bx + bw / 2, gy + nh + 36, { size: m === 'X' || m === '/' ? 34 : 32, weight: 700, family: HEAD, color: m === 'X' ? C.red : C.ink, align: 'center' });
      if (m && sc.splits[i] && sc.splits[i][j]) { ctx.save(); ctx.strokeStyle = C.red; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(bx + bw / 2, gy + nh + mh / 2 + 1, 19, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
    }
    if (sc.cum[i] != null) txt(ctx, String(sc.cum[i]), fx + fw / 2, gy + nh + mh + 46, { size: sc.cum[i] > 99 ? 31 : 36, weight: 700, family: HEAD, color: C.ink, align: 'center', maxW: fw - 12 });
  }
  return y + h;
}

function drawIcon(ctx, name, cx, cy, size, color, lw) {
  const box = document.createElement('div');
  box.innerHTML = icon(name);
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2); ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color; ctx.lineWidth = lw || 1.8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  box.querySelectorAll('path').forEach(p => ctx.stroke(new Path2D(p.getAttribute('d'))));
  box.querySelectorAll('circle').forEach(c => { ctx.beginPath(); ctx.arc(+c.getAttribute('cx'), +c.getAttribute('cy'), +c.getAttribute('r'), 0, Math.PI * 2); ctx.stroke(); });
  ctx.restore();
}
function coin(ctx, c, cx, cy, r) {
  ctx.save();
  ctx.shadowColor = 'rgba(246,166,35,.6)'; ctx.shadowBlur = 90;
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  g.addColorStop(0, '#ffe7ad'); g.addColorStop(0.45, '#f6b042'); g.addColorStop(1, '#c97d0d');
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
  ctx.restore();
  ctx.beginPath(); ctx.arc(cx, cy, r - 14, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(90,50,0,.35)'; ctx.lineWidth = 6; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r - 2, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,240,200,.7)'; ctx.lineWidth = 4; ctx.stroke();
  if (c.mark) {
    txt(ctx, c.mark, cx, cy + (c.sub ? 26 : 40), { size: c.mark.length > 3 ? 116 : 170, weight: 700, family: HEAD, color: '#2a1a03', align: 'center', maxW: r * 1.5 });
    if (c.sub) txt(ctx, c.sub, cx, cy + 96, { size: 34, weight: 700, family: HEAD, color: '#5a3606', align: 'center', spacing: 5 });
  } else drawIcon(ctx, c.icon || 'medal', cx, cy, r * 1.05, '#2a1a03', 1.6);
}

function trendChart(ctx, t, y, h) {
  const x = 80, w = W - 160;
  rrPath(ctx, x, y, w, h, 26); ctx.fillStyle = 'rgba(35,35,35,.85)'; ctx.fill(); ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.stroke();
  txt(ctx, 'LAST ' + t.length + (t.length === 1 ? ' GAME' : ' GAMES'), x + 32, y + 50, { size: 22, weight: 700, color: C.muted, spacing: 3 });
  if (t.length < 2) return y + h;
  const px = x + 40, pw = w - 80, py = y + 84, ph = h - 84 - 36;
  const lo = Math.max(0, Math.min.apply(null, t) - 12), hi = Math.min(300, Math.max.apply(null, t) + 12);
  const X = i => px + pw * i / (t.length - 1), Y = v => py + ph * (1 - (v - lo) / Math.max(1, hi - lo));
  const avg = t.reduce((a, b) => a + b, 0) / t.length;
  ctx.save(); ctx.setLineDash([10, 10]); ctx.strokeStyle = 'rgba(255,247,230,.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px, Y(avg)); ctx.lineTo(px + pw, Y(avg)); ctx.stroke(); ctx.restore();
  ctx.beginPath(); t.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
  ctx.strokeStyle = C.gold; ctx.lineWidth = 7; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
  ctx.beginPath(); ctx.arc(X(t.length - 1), Y(t[t.length - 1]), 11, 0, Math.PI * 2); ctx.fillStyle = C.cream; ctx.fill(); ctx.strokeStyle = C.gold; ctx.lineWidth = 5; ctx.stroke();
  return y + h;
}

// The content sits between the header and the logo, a little above the middle of the space.
const TOP = 205, BOTTOM = 1128;
const startY = total => TOP + Math.max(0, Math.round((BOTTOM - TOP - total) * 0.42));
const capH = size => Math.round(size * 0.74);   // height of Poppins numerals

const DRAW = {
  game(ctx, s) {
    header(ctx, s);
    const size = s.card ? 330 : s.tiles ? 390 : 450, digits = capH(size), th = s.card ? 112 : 132, nLines = Math.min(2, s.lines.length);
    let y = startY(digits + 34 + (s.tag ? 94 : 0) + (s.card ? 178 + 34 : 0) + (s.tiles ? th + 82 : 0) + (nLines ? 44 + 46 * nLines : 0));
    bigNumber(ctx, s.score, size, y + digits, s.score === 300);
    y += digits + 34;
    if (s.tag) { pill(ctx, s.tag, y); y += 94; }
    if (s.card) y = scorecard(ctx, s.card, y) + 34;
    if (s.tiles) { y = tiles(ctx, s.tiles, y, { h: th, vs: s.card ? 58 : 68, max: 200 }); txt(ctx, s.note, W / 2, y + 48, { size: 32, weight: 600, color: 'rgba(255,247,230,.92)', align: 'center' }); y += 82; }
    if (nLines) lines(ctx, s.lines, y + 44);
  },
  night(ctx, s) {
    header(ctx, s);
    const size = 380, digits = capH(size), nLines = Math.min(2, s.lines.length);
    let y = startY(digits + 36 + 150 + 22 + 116 + (nLines ? 40 + 46 * nLines : 0));
    bigNumber(ctx, s.score, size, y + digits, true);
    y += digits + 36;
    y = tiles(ctx, s.tiles, y, { h: 150, vs: 76, max: 260 }) + 22;
    y = tiles(ctx, s.stats, y, { h: 116, vs: 54, max: 300 });
    if (nLines) lines(ctx, s.lines, y + 74);
  },
  season(ctx, s) {
    header(ctx, s);
    const size = 380, digits = capH(size);
    let y = startY(digits + 100 + 124 + 26 + 250);
    bigNumber(ctx, s.score, size, y + digits, true);
    txt(ctx, s.scoreLabel, W / 2, y + digits + 62, { size: 32, weight: 700, family: HEAD, color: C.gold, align: 'center', spacing: 8 });
    y += digits + 100;
    y = tiles(ctx, s.stats, y, { h: 124, vs: 58, max: 300 }) + 26;
    trendChart(ctx, s.trend, y, 250);
  },
  ach(ctx, s) {
    header(ctx, s);
    const r = 240, descLines = wrap(ctx, s.desc, W - 240, 500, 40, BODY).slice(0, 3);
    let y = startY(r * 2 + 70 + capH(92) + 34 + 54 * descLines.length);
    coin(ctx, s.coin, W / 2, y + r, r);
    y += r * 2 + 70 + capH(92);
    txt(ctx, s.heading, W / 2, y, { size: 92, weight: 700, family: HEAD, color: C.cream, align: 'center', maxW: W - 200 });
    descLines.forEach((l, i) => txt(ctx, l, W / 2, y + 62 + i * 54, { size: 40, weight: 500, color: 'rgba(255,247,230,.9)', align: 'center' }));
  },
};

let fontsP = null;
const fontsReady = () => fontsP || (fontsP = Promise.all(['700 64px Poppins', '500 32px Poppins', '400 32px Inter', '600 32px Inter', '700 32px Inter'].map(f => (document.fonts ? document.fonts.load(f).catch(() => null) : null))));
async function logoImage() {
  const el = document.getElementById('scLogo');
  if (!el) return null;
  try { if (el.decode) await el.decode(); } catch (e) { /* not decodable: draw the plain name */ }
  return el.naturalWidth ? el : null;
}

async function render(s) {
  await fontsReady();
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  background(ctx);
  DRAW[s.kind](ctx, s);
  footer(ctx, await logoImage());
  return cv;
}
const toBlob = cv => new Promise((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error('The picture couldn’t be saved from the canvas'))), 'image/png'));

/* ---------- the sheet ---------- */
function shareCard(kind, params) {
  const opts = { name: true, center: true };
  const first = spec(kind, params, opts);
  if (!first) { toast('Nothing to share yet'); return; }
  const who = BB.firstName();
  const hasPlace = kind === 'game' || kind === 'night';
  const canFiles = (() => { try { return !!(navigator.canShare && navigator.canShare({ files: [new File([new Blob(['x'])], 'a.png', { type: 'image/png' })] })); } catch (e) { return false; } })();
  let url = null, blob = null, token = 0;

  openSheet('<h3>' + esc(first.title) + '</h3>' +
    '<div class="share-preview" id="scBox" aria-live="polite"><div class="small muted">Making your picture…</div></div>' +
    ((who || hasPlace) ? '<div class="field-label">Show on the picture</div><div class="chips share-opts" role="group" aria-label="What to show">' +
      (who ? '<button type="button" class="chip sel" id="scName" aria-pressed="true">Name</button>' : '') +
      (hasPlace ? '<button type="button" class="chip sel" id="scCenter" aria-pressed="true">Center</button>' : '') + '</div>' : '') +
    (canFiles ? '<button class="btn" id="scShare" disabled>' + icon('share') + 'Share…</button>' : '') +
    (EMBED ? '<p class="small muted mt8">Saving files isn’t available in this preview. Press and hold the picture to save or copy it.</p>' :
      '<button class="btn' + (canFiles ? ' secondary mt8' : '') + '" id="scSave" disabled>' + icon('download') + 'Save picture</button>'), sh => {
    const box = sh.querySelector('#scBox'), shareBtn = sh.querySelector('#scShare'), saveBtn = sh.querySelector('#scSave');
    const enable = on => { if (shareBtn) shareBtn.disabled = !on; if (saveBtn) saveBtn.disabled = !on; };
    const fileName = () => 'bowlboard-' + spec(kind, params, opts).file + '.png';

    async function draw() {
      const my = ++token;
      enable(false);
      try {
        const s = spec(kind, params, opts);
        const b = await toBlob(await render(s));
        if (my !== token) return;
        if (url) URL.revokeObjectURL(url);
        blob = b; url = URL.createObjectURL(b);
        box.innerHTML = '<img id="scImg" alt="Preview of the picture you can share" src="' + url + '">';
        enable(true);
      } catch (e) {
        if (my !== token) return;
        box.innerHTML = '<div class="warn small">Couldn’t make the picture on this device.</div>';
      }
    }
    [['#scName', 'name'], ['#scCenter', 'center']].forEach(([sel, key]) => {
      const b = sh.querySelector(sel);
      if (b) b.addEventListener('click', () => { opts[key] = !opts[key]; b.classList.toggle('sel', opts[key]); b.setAttribute('aria-pressed', String(opts[key])); draw(); });
    });
    if (saveBtn) saveBtn.addEventListener('click', () => { if (blob && BB.saveFile(fileName(), blob, 'image/png')) toast('Saved ' + fileName(), 3500); });
    if (shareBtn) shareBtn.addEventListener('click', async () => {
      if (!blob) return;
      const s = spec(kind, params, opts);
      try { await navigator.share({ files: [new File([blob], fileName(), { type: 'image/png' })], title: 'BowlBoard', text: s.text + ' ' + TAGLINE }); }
      catch (e) { if (e && e.name !== 'AbortError') { toast('Couldn’t open sharing. Try Save picture.', 4000); } }
    });
    draw();
  }, () => { token++; if (url) URL.revokeObjectURL(url); url = null; blob = null; });
}

Object.assign(BB, { shareCard, share: { spec, render, toBlob, W, H } });
})();
