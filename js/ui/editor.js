/* BowlBoard — the tap-a-frame editor: a paper scorecard you tap, plus a keypad that
 * only offers marks that can happen (after a 7, only 1–2, a miss, a foul or a spare).
 * Used to review a lane-screen photo draft and to fix a pin-by-pin game. */
(function () {
'use strict';
const BB = window.BB;
const S = window.BBScore, Scan = window.BBScan;
const { esc, icon, cardHTML, haptic } = BB;

// Running totals for the frames that are complete and legal so far.
function cumulative(D) {
  let upto = 10;
  for (let i = 0; i < 10; i++) if (D.balls[i].some(v => v === '' || v == null)) { upto = i; break; }
  for (let k = upto; k >= 0; k--) {
    const frames = D.balls.map((b, i) => ({ balls: i < k ? b.slice() : [], fouls: i < k ? (D.fouls[i] || []).slice(0, b.length) : [] }));
    const v = S.validateFrames(frames);
    if (v.ok) { const sc = S.computeScore(v.game); return { cum: sc.cumulative, pending: sc.pending, splits: sc.splits }; }
  }
  return { cum: [], pending: [], splits: [] };
}

// root: element to draw into. opts: {prefix, status(result) -> {msg, ok}, onChange(result)}
function frameEditor(root, D, opts) {
  opts = opts || {};
  const p = opts.prefix || 'fe';
  let cur = Scan.nextBox(D, 0) || { i: 0, j: 0 };
  root.innerHTML = '<div class="editor" id="' + p + 'Ed" tabindex="-1"><div id="' + p + 'Card"></div>' +
    '<div class="running-strip" id="' + p + 'Run" aria-live="polite"></div>' +
    '<div class="keypad" id="' + p + 'Pad" role="group" aria-label="Keypad"></div></div>';
  const card = root.querySelector('#' + p + 'Card'), pad = root.querySelector('#' + p + 'Pad'), run = root.querySelector('#' + p + 'Run');

  function draw() {
    const c = cumulative(D);
    const frames = D.balls.map((b, i) => ({ marks: Scan.marks(D, i), cum: c.cum[i], pending: c.pending[i], split: c.splits[i], flag: D.flags[i] || '' }));
    card.innerHTML = cardHTML(frames, { tap: true, cur: cur ? cur.i : -1, curBall: cur ? cur.j : -1, id: p + 'Grid', label: 'Scorecard — tap a frame to change it' });
    const r = Scan.check(D);
    const running = r.ok ? r.running : (r.partial ? r.partial.running : null);
    const max = r.ok ? r.max : (r.partial ? r.partial.max : null);
    run.innerHTML = '<span>Score <b>' + (running == null ? '—' : running) + '</b></span><span class="muted">' + (r.ok && r.complete ? 'Final' : max != null ? 'Max ' + max : '') + '</span>';
    const k = cur ? Scan.keysFor(D, cur.i, cur.j) : null;
    const key = (label, v, on, cls, aria) => '<button type="button" class="key' + (cls ? ' ' + cls : '') + '" data-key="' + esc(v) + '"' + (on ? '' : ' disabled') + (aria ? ' aria-label="' + esc(aria) + '"' : '') + '>' + label + '</button>';
    let h = '<div class="pad-head">' + (cur ? 'Frame ' + (cur.i + 1) + ' · ball ' + (cur.j + 1) + (D.balls[cur.i][cur.j] !== '' && D.balls[cur.i][cur.j] != null ? ' <span class="muted">(retyping)</span>' : '') : 'All frames filled — tap one to change it') + '</div>';
    if (cur && k) {
      h += '<div class="keys">' + key('X<small>strike</small>', 'X', k.X, 'mark', 'Strike') + key('/<small>spare</small>', '/', k.spare, 'mark', 'Spare') +
        key('–<small>miss</small>', '-', k.miss, 'mark', 'Miss') + key('F<small>foul</small>', 'F', k.foul, 'mark', 'Foul') + key(icon('undo'), 'back', true, 'mark', 'Erase last ball');
      for (let n = 1; n <= 9; n++) h += key(String(n), String(n), k.digits.indexOf(n) >= 0);
      h += key('Clear', 'clear', D.balls[cur.i].length > 0, 'wide', 'Clear frame ' + (cur.i + 1)) + '</div>';
    }
    pad.innerHTML = h;
    const res = opts.status ? opts.status(r) : null;
    if (opts.onChange) opts.onChange(r, res);
    return r;
  }
  function press(v) {
    if (!cur && v !== 'back') return;
    if (v === 'back') {
      if (!cur) { cur = { i: 9, j: Math.max(0, D.balls[9].length - 1) }; Scan.erase(D, 9, cur.j); }
      else if (cur.j > 0) { cur = { i: cur.i, j: cur.j - 1 }; Scan.erase(D, cur.i, cur.j); }
      else if (D.balls[cur.i].length) Scan.clearFrame(D, cur.i);
      else if (cur.i > 0) { const i = cur.i - 1, j = Math.max(0, D.balls[i].length - 1); cur = { i, j }; Scan.erase(D, i, j); }
      D.flags[cur.i] = 'edited';
    } else if (v === 'clear') {
      Scan.clearFrame(D, cur.i); D.flags[cur.i] = 'edited'; cur = { i: cur.i, j: 0 };
    } else {
      const i = cur.i;
      const r = Scan.enter(D, cur.i, cur.j, v);
      if (!r.ok) return;
      D.flags[i] = 'edited';
      haptic(v === 'X' ? 'strike' : v === '/' ? 'spare' : 'tap');
      cur = r.next;
    }
    draw();
  }
  root.addEventListener('click', e => {
    const f = e.target.closest('[data-frame]');
    if (f && root.contains(f)) {
      const i = +f.dataset.frame;
      const gap = D.balls[i].findIndex(v => v === '' || v == null);
      cur = { i, j: gap >= 0 ? gap : (Scan.frameDone(D.balls[i], i) ? 0 : D.balls[i].length) };
      draw();
      return;
    }
    const k = e.target.closest('[data-key]');
    if (k && !k.disabled && root.contains(k)) press(k.dataset.key);
  });
  root.addEventListener('keydown', e => {
    if (e.target.matches('input, select, textarea')) return;
    const map = { x: 'X', X: 'X', '/': '/', '-': '-', f: 'F', F: 'F', Backspace: 'back' };
    const v = map[e.key] || (/^[0-9]$/.test(e.key) ? (e.key === '0' ? '-' : e.key) : null);
    if (!v) return;
    e.preventDefault();
    press(v);
  });
  const api = { draw, press, get cursor() { return cur; }, D };
  draw();
  return api;
}

Object.assign(BB, { frameEditor, editorCumulative: cumulative });
})();
