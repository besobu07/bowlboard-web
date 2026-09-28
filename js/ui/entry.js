/* BowlBoard — scoring a game: pin by pin (the deck), running totals, or total only.
 * The pin deck is built to feel like bowling: pins knock down as you tap them, the
 * frame you're on is lit on the paper scorecard, the score counts up, and strikes
 * and spares get a tick on phones that vibrate. */
(function () {
'use strict';
const BB = window.BB;
const S = window.BBScore, Store = window.BBStore;
const { RENDER, ACT, esc, fmtDate, icon, el, on, show, toast, screenRoot, haptic, countUp, reduceMotion, ballOptions, scorecardHTML, pendingNote } = BB;

function entryHeader(setup, extra) {
  return '<h2 class="screen-title">Game ' + setup.gameNo + ' <span class="muted small">· ' + fmtDate(setup.date) + ' · ' + esc(Store.centerName(setup.centerId)) + (extra ? ' · ' + extra : '') + '</span></h2>' +
    '<label class="ball-line">' + icon('ball') + '<span>Ball</span><select id="entryBall" aria-label="Ball for this game">' + ballOptions(setup.ballId) + '</select></label>';
}
function bindEntryBall(setup) { on('entryBall', 'change', e => { setup.ballId = e.target.value; toast('Ball for game ' + setup.gameNo + ': ' + Store.ballLabel(setup.ballId)); }); }

RENDER.entry = function () {
  const entry = BB.entry;
  if (!entry) { show('new'); return; }
  const root = screenRoot();
  if (entry.setup.mode === 'frames') return renderRunningTotals(root);
  if (entry.setup.mode === 'total') return renderTotalPanel(root);
  root.innerHTML = entryHeader(entry.setup) + '<div id="scoreWrap"></div><div id="deckWrap"></div>';
  bindEntryBall(entry.setup);
  renderPinEntry();
  if (entry._shown == null) entry._shown = S.computeScore(entry.game).runningTotal;
};
// Only the score strip and the deck redraw after a throw; the header (ball picker) stays put.
function renderPinEntry(prevTotal, pop) {
  const entry = BB.entry, game = entry.game, sc = S.computeScore(game);
  const done = S.isComplete(game);
  const cur = done ? -1 : S.currentFrame(game);
  const now = done ? sc.total : sc.runningTotal;
  el('scoreWrap').innerHTML = scorecardHTML(game, cur, { curBall: done ? -1 : game.frames[cur].balls.length }) +
    '<div class="score-line" aria-live="polite"><div class="now">Score <b id="scoreNow">' + now + '</b> ' + (done ? '' : pendingNote(game)) + '</div>' +
    '<div class="max">' + (done ? 'Final' : 'Max ' + S.maxPossible(game)) + '</div></div>';
  if (prevTotal != null && prevTotal !== now) countUp(el('scoreNow'), prevTotal, now);
  if (pop && !reduceMotion()) {
    const f = el('frameGrid').querySelectorAll('.frame')[pop.i];
    const span = f && f.querySelectorAll('.balls span')[pop.j];
    if (span) span.classList.add('pop');
  }
  el('deckWrap').innerHTML = done
    ? '<div class="finish-bar"><button class="btn secondary small-btn" data-act="undo" aria-label="Undo">' + icon('undo') + '</button><button class="btn grow" data-act="save">Save game — ' + sc.total + '</button></div>'
    : deckHTML(game);
}
// Where the last ball landed, and what it was (X, /, or a count).
function lastBall(game) {
  for (let i = 9; i >= 0; i--) {
    const b = game.frames[i].balls;
    if (b.length) { const m = S.computeScore(game).marks[i][b.length - 1]; return { i, j: b.length - 1, mark: m }; }
  }
  return null;
}
function recordAndRedraw(r) {
  const entry = BB.entry;
  if (!r.ok) { toast(r.error); return; }
  const before = entry._shown;
  entry.sel = new Set();
  const lb = lastBall(entry.game);
  haptic(lb && lb.mark === 'X' ? 'strike' : lb && lb.mark === '/' ? 'spare' : 'throw');
  renderPinEntry(before, lb && (lb.mark === 'X' || lb.mark === '/') ? lb : null);
  entry._shown = S.isComplete(entry.game) ? S.computeScore(entry.game).total : S.computeScore(entry.game).runningTotal;
}
function updateThrowButton() {
  const entry = BB.entry;
  const n = entry.sel.size, b = el('throwBtn');
  if (!b) return;
  b.disabled = !n;
  b.textContent = 'Throw · ' + n + ' pin' + (n === 1 ? '' : 's');
}
ACT.entry = {
  pin: a => { // toggle in place — no redraw
    const entry = BB.entry;
    const n = +a.dataset.pin;
    if (entry.sel.has(n)) entry.sel.delete(n); else entry.sel.add(n);
    const down = entry.sel.has(n);
    a.classList.toggle('down', down);
    a.classList.remove('knock');
    if (down && !reduceMotion()) { void a.offsetWidth; a.classList.add('knock'); }
    a.setAttribute('aria-pressed', String(down));
    haptic('tap');
    updateThrowButton();
  },
  clear: () => recordAndRedraw(S.recordClear(BB.entry.game)),
  miss: () => recordAndRedraw(S.recordThrow(BB.entry.game, [])),
  foul: () => recordAndRedraw(S.recordThrow(BB.entry.game, [], { foul: true })),
  throw: () => { const e = BB.entry; recordAndRedraw(S.standingPins(e.game) ? S.recordThrow(e.game, Array.from(e.sel)) : S.recordBall(e.game, e.sel.size)); },
  undo: () => {
    const e = BB.entry;
    if (!S.undo(e.game)) toast('Nothing to undo');
    e.sel = new Set();
    renderPinEntry();
    e._shown = S.computeScore(e.game).runningTotal;
  },
  save: () => { const e = BB.entry; BB.saveGame(Object.assign(BB.gameBase(e.setup), { frames: S.clone(e.game).frames, total: S.computeScore(e.game).total })); },
};

const PIN_ROWS = [[7, 8, 9, 10], [4, 5, 6], [2, 3], [1]];
function deckHTML(game) {
  const entry = BB.entry;
  const standing = S.standingPins(game) || S.ALL_PINS;
  const fresh = S.freshRack(game);
  const n = entry.sel.size;
  let h = '<div class="pindeck">';
  if (!fresh) {
    const split = S.isSplit(standing);
    h += '<div class="leave-line"><span class="leave-chip' + (split ? ' split' : '') + '">Leave ' + standing.join('-') + (split ? ' · split' : '') + '</span></div>';
  }
  h += '<div class="small muted deck-hint" id="deckHint">Tap the pins that fell, then Throw</div><div role="group" aria-labelledby="deckHint" class="deck">';
  PIN_ROWS.forEach(row => {
    h += '<div class="pinrow">';
    row.forEach(p => {
      if (standing.indexOf(p) < 0) h += '<span class="pin gone" role="img" aria-label="pin ' + p + ' already down">' + p + '</span>';
      else h += '<button class="pin' + (entry.sel.has(p) ? ' down' : '') + '" data-act="pin" data-pin="' + p + '" aria-label="pin ' + p + '" aria-pressed="' + entry.sel.has(p) + '"><span>' + p + '</span></button>';
    });
    h += '</div>';
  });
  h += '</div><div class="quick-row">' +
    '<button class="btn quick strong" data-act="clear" id="clearBtn">' + (fresh ? 'X Strike' : '/ Spare') + '</button>' +
    '<button class="btn quick" data-act="miss" id="missBtn">– Miss</button>' +
    '<button class="btn quick" data-act="foul" id="foulBtn">F Foul</button>' +
    '<button class="btn quick undo" data-act="undo" id="undoBtn" aria-label="Undo">' + icon('undo') + '</button></div>';
  h += '<button class="btn mt8" data-act="throw" id="throwBtn"' + (n ? '' : ' disabled') + '>Throw · ' + n + ' pin' + (n === 1 ? '' : 's') + '</button>';
  return h + '</div>';
}

/* running-total entry: copy the cumulative score printed under each frame */
function checkRunning(vals) {
  const nums = vals.map(v => (v === '' || v == null ? null : parseInt(v, 10)));
  let prev = 0;
  for (let i = 0; i < 10; i++) {
    const n = nums[i];
    if (n == null || isNaN(n)) return { ok: false, msg: 'Enter the running total for frame ' + (i + 1) + '.', filled: i };
    if (n < prev) return { ok: false, msg: 'Frame ' + (i + 1) + ' (' + n + ') can’t be lower than frame ' + i + ' (' + prev + ').', bad: i };
    if (n - prev > 30) return { ok: false, msg: 'Frame ' + (i + 1) + ' jumps ' + (n - prev) + ' pins — a frame is worth 30 at most.', bad: i };
    prev = n;
  }
  // Is there a real ball-by-ball game behind these totals? (e.g. 30 then 40 can't happen)
  const recon = S.framesFromRunningTotals(nums);
  if (!recon.count) return { ok: false, msg: 'No real game gives these totals — a strike or spare needs enough pins in the frames after it. Check the screen.' };
  return { ok: true, total: prev, nums, recon };
}
function renderRunningTotals(root, opts) {
  opts = opts || {};
  const entry = BB.entry;
  const p = opts.prefix || 'rt';
  const target = opts.target || entry;
  if (!target.cum) target.cum = new Array(10).fill('');
  let h = opts.title || entryHeader(entry.setup, 'running totals');
  h += '<div class="card"><p class="small muted mt0">Type the running score shown under each frame (e.g. 9, 28, 47…).</p><div class="review-grid">';
  target.cum.forEach((v, i) => {
    h += '<label class="review-frame"><div class="fn">F' + (i + 1) + '</div><div class="ballinputs">' +
      '<input type="number" inputmode="numeric" min="0" max="300" data-cum="' + i + '" aria-label="Running total after frame ' + (i + 1) + '" value="' + esc(v) + '" placeholder="–"></div></label>';
  });
  h += '</div><div class="scan-status" id="' + p + 'Status" aria-live="polite"></div>';
  h += '<button class="btn" id="' + p + 'Save">Save game</button></div>';
  root.innerHTML = h;
  if (!opts.title) bindEntryBall(entry.setup);
  const status = () => {
    const r = checkRunning(target.cum);
    const st = root.querySelector('#' + p + 'Status');
    st.textContent = r.ok ? 'Total: ' + r.total + (r.recon.count === 1 ? ' · frames worked out, so strike and spare stats count too' : ' · more than one game fits these totals, so this counts toward your average only') : r.msg;
    st.className = 'scan-status ' + (r.ok ? 'good' : '');
    root.querySelectorAll('[data-cum]').forEach(inp => inp.classList.toggle('bad', r.bad === +inp.dataset.cum));
    const b = root.querySelector('#' + p + 'Save');
    b.disabled = !r.ok; b.textContent = r.ok ? 'Save game — ' + r.total : 'Save game';
    return r;
  };
  root.querySelectorAll('[data-cum]').forEach(inp => inp.addEventListener('input', () => { target.cum[+inp.dataset.cum] = inp.value; status(); }));
  status();
  root.querySelector('#' + p + 'Save').addEventListener('click', () => {
    const r = status();
    if (!r.ok) { toast(r.msg); return; }
    const data = { cumulative: r.nums, total: r.total, frames: undefined, framesDerived: undefined };
    if (r.recon.count === 1) { data.frames = S.validateFrames(r.recon.frames).game.frames; data.framesDerived = true; }
    if (opts.onSave) return opts.onSave(data);
    BB.saveGame(Object.assign(BB.gameBase(entry.setup), data));
  });
}

function renderTotalPanel(root) {
  const entry = BB.entry;
  let h = entryHeader(entry.setup, 'total only') + '<div class="card">';
  h += '<label class="field">Final score<input type="number" inputmode="numeric" id="totalInput" min="0" max="300" placeholder="e.g. 184" value="' + esc(entry.totalVal || '') + '"></label>';
  h += '<button class="btn" id="saveTotalBtn">Save game</button></div>';
  root.innerHTML = h;
  bindEntryBall(entry.setup);
  on('totalInput', 'input', e => { entry.totalVal = e.target.value; });
  on('saveTotalBtn', 'click', () => {
    const t = parseInt(entry.totalVal, 10);
    if (isNaN(t) || t < 0 || t > 300) { toast('Enter a score from 0 to 300'); return; }
    BB.saveGame(Object.assign(BB.gameBase(entry.setup), { total: t }));
  });
}

Object.assign(BB, { entryHeader, bindEntryBall, renderRunningTotals, checkRunning });
})();
