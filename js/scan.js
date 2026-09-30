/* BowlBoard lane-screen scan + frame editor logic — pure, no DOM, runs in Node.
 *
 * The photo scan only ever produces a DRAFT. This file turns OCR output into that
 * draft and keeps it honest:
 *   - every mark is placed by bowling rules: a ball that can't happen (a 5 after
 *     a 7) is left blank and its frame flagged, and it still uses up its box, so
 *     one misread never slides later balls into the wrong frames
 *   - low-confidence marks are flagged amber; very low ones are left blank
 *   - F (foul) stays a foul (0, pins respotted), so F/ is a spare, never a strike
 * The same draft shape backs the tap-a-frame keypad used for review and edits.
 *
 * Draft: { balls: [[n|'' ...] x10], fouls: [[bool ...] x10], flags: ['good'|'low'|'bad'|'' x10] }
 */
(function (global) {
  'use strict';
  const S = (typeof module !== 'undefined' && module.exports) ? require('./score.js') : global.BBScore;

  const CONF_LOW = 80;   // below this a mark is shown amber
  const CONF_DROP = 50;  // below this the box is left blank for the bowler to fill

  function emptyDraft() {
    return { balls: Array.from({ length: 10 }, () => []), fouls: Array.from({ length: 10 }, () => []), flags: new Array(10).fill('') };
  }
  function fromFrames(frames) {
    const d = emptyDraft();
    (frames || []).forEach((f, i) => {
      const n = S.normFrame(f);
      d.balls[i] = n.balls.slice();
      d.fouls[i] = n.fouls.slice();
    });
    return d;
  }

  /* ---------- OCR output -> lines of {text, confs} ---------- */
  // Tesseract gives lines -> words -> symbols with a confidence each. Older builds may
  // give only text; then confidences are unknown (null) and every mark is shown amber.
  function linesFromOCR(data) {
    data = data || {};
    if (Array.isArray(data.lines) && data.lines.length && data.lines.some(l => Array.isArray(l.words))) {
      return data.lines.map(l => {
        let text = '';
        const confs = [];
        (l.words || []).forEach((w, wi) => {
          if (wi) { text += ' '; confs.push(null); }
          const syms = Array.isArray(w.symbols) && w.symbols.length ? w.symbols : null;
          if (syms) syms.forEach(s => { const t = String(s.text || ''); for (const ch of t) { text += ch; confs.push(typeof s.confidence === 'number' ? s.confidence : null); } });
          else { const t = String(w.text || ''); for (const ch of t) { text += ch; confs.push(typeof w.confidence === 'number' ? w.confidence : null); } }
        });
        return { text, confs };
      });
    }
    return String(data.text || '').split(/\r?\n/).map(text => ({ text, confs: null }));
  }

  // One line -> ball marks. On a marks line, neighbouring boxes often read as one run
  // ("72" for a 7 and a 2), so digit runs are split into single balls; running totals
  // and frame numbers are separate lines (see parseLines).
  function tokens(line) {
    const text = typeof line === 'string' ? line : line.text;
    const confs = typeof line === 'string' ? null : line.confs;
    const out = [];
    const re = /\d|[Xx]|-|F|\//g;
    let m;
    while ((m = re.exec(text))) {
      const t = m[0];
      const conf = confs && confs[m.index] != null ? confs[m.index] : null;
      if (/^\d$/.test(t)) out.push({ t: 'd', v: +t, conf });
      else out.push({ t: t === 'x' ? 'X' : t, conf });
    }
    return out;
  }

  // Running totals read as runs of digits; neighbours sometimes merge ("4060"). Split
  // long runs so the row keeps counting up. Returns the numbers, or null.
  function repairTotals(runs) {
    const out = [];
    const ok = (n, prev) => n <= 300 && n >= prev;
    for (const r of runs) {
      const prev = out.length ? out[out.length - 1] : 0;
      if (r.length <= 3 && ok(+r, prev)) { out.push(+r); continue; }
      // try splitting into 2 or 3 parts of 1-3 digits that keep counting up
      let best = null;
      const tryParts = (rest, acc, last) => {
        if (best) return;
        if (!rest.length) { if (acc.length >= 2) best = acc; return; }
        if (acc.length >= 3) return;
        for (let L = Math.min(3, rest.length); L >= 1; L--) {
          const n = +rest.slice(0, L);
          if ((L > 1 && rest[0] === '0') || !ok(n, last)) continue;
          tryParts(rest.slice(L), acc.concat([n]), n);
        }
      };
      tryParts(r, [], prev);
      if (best) best.forEach(n => out.push(n));
      // an unreadable number is dropped; the row then won't have 10 and isn't used to check the game
    }
    return out.length >= 3 ? out : null;
  }
  const upShare = nums => { let up = 0; for (let i = 1; i < nums.length; i++) if (nums[i] >= nums[i - 1]) up++; return nums.length > 1 ? up / (nums.length - 1) : 0; };

  // What a line of the screen is: the running totals, the frame numbers, a row of marks, or other.
  function classify(line) {
    const text = typeof line === 'string' ? line : line.text;
    const runs = text.match(/\d+/g) || [];
    const xf = (text.match(/[XxF]/g) || []).length;
    const multi = runs.filter(r => r.length >= 2).length;
    if (multi >= 4 && xf <= 1) {
      let nums = repairTotals(runs);
      // a screen shows the final total again beside the frames ("134  134"): the running totals are the first ten
      if (nums && nums.length > 10 && nums.slice(10).every(v => v >= nums[9])) nums = nums.slice(0, 10);
      if (nums && upShare(nums) >= 0.8) return { kind: 'totals', nums };
    }
    const nums = runs.map(Number);
    const marks = (text.match(/[XxF/-]/g) || []).length;
    if (!marks && nums.length >= 3 && nums.every(n => n >= 1 && n <= 10) && upShare(nums) >= 0.6) return { kind: 'frameNumbers' };
    const t = tokens(line);
    return t.length >= 4 ? { kind: 'marks', syms: t } : { kind: 'other' };
  }

  // Pick the row of marks that reads best (a photo may catch other bowlers' rows or the
  // frame numbers), with the running totals printed under it.
  function parseLines(lines) {
    const cls = (lines || []).map(classify);
    const totalsNear = k => {
      for (let d = 1; d <= 2; d++) { const t = cls[k + d]; if (t && t.kind === 'totals') return t.nums; }
      for (let d = 1; d <= 2; d++) { const t = cls[k - d]; if (t && t.kind === 'totals') return t.nums; }
      return null;
    };
    let best = null;
    cls.forEach((c, k) => {
      if (c.kind !== 'marks') return;
      const D = draftFromSyms(c.syms);
      const T = totalsNear(k);
      const fit = T && T.length === 10 ? fitToTotals(D, T) : null;
      const filled = D.balls.reduce((a, b) => a + b.filter(v => v !== '').length, 0);
      const bad = D.flags.filter(f => f === 'bad').length;
      // A row whose marks fit the totals scores by how many frames the two agree on, less how far the fit had to move:
      // counting only the disagreement would favour a row where hardly any marks were read.
      const agree = fit ? fit.draft.balls.filter((b, i) => D.balls[i].length && JSON.stringify(b) === JSON.stringify(D.balls[i])).length : 0;
      const score = fit && fit.cost <= FIT_MAX ? 50 + agree * 6 - fit.cost * 3 : filled - 2 * bad;
      if (!best || score > best.score) best = { score, syms: c.syms, totals: T || [], k };
    });
    const kinds = cls.map(c => c.kind);
    if (!best) {
      const t = cls.find(c => c.kind === 'totals');
      return { syms: [], totals: t ? t.nums : [], kinds, chosen: -1 };
    }
    return { syms: best.syms, totals: best.totals, kinds, chosen: best.k };
  }

  // Running totals are usually read more reliably than X and / marks. When all ten are
  // there, find the game that fits them and agrees best with the marks that were read.
  // How many of the totals read line up, in order, with a game's own running totals (a longest common subsequence,
  // so one total that was dropped or misread doesn't throw off the ones after it). at[i]: cum[i] was matched.
  function matchTotals(cum, read) {
    const n = cum.length, m = read.length, L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = cum[i] === read[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const at = new Array(n).fill(false);
    let i = 0, j = 0;
    while (i < n && j < m) { if (cum[i] === read[j]) { at[i] = true; i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++; }
    return { count: L[0][0], at };
  }
  const MOSTLY = 8;   // this many of the ten totals matching a complete game's own running total is enough to trust its marks
  const FIT_MAX = 8; // more disagreement than this between the marks and the totals and a row isn't chosen for its fit
  function fitToTotals(D, cum) {
    if (!Array.isArray(cum) || cum.length !== 10) return null;
    const f = cum.map((c, i) => c - (i ? cum[i - 1] : 0));
    if (f.some(x => !Number.isInteger(x) || x < 0 || x > 30)) return null;
    // same frame shapes and bonus bookkeeping as S.framesFromRunningTotals
    const apply = (C, v) => {
      const out = [];
      for (const c of C) {
        const need = c.need - 1, sum = c.sum - v;
        if (sum < 0 || sum > need * 10) return null;
        if (need === 0) { if (sum !== 0) return null; } else out.push({ need, sum });
      }
      return out;
    };
    const applyAll = (C, balls) => { let c = C; for (const v of balls) { c = apply(c, v); if (!c) return null; } return c; };
    const options = i => {
      const out = [];
      if (i < 9) {
        if (f[i] >= 10) out.push({ balls: [10], add: { need: 2, sum: f[i] - 10 } });
        for (let a = 0; a <= 9; a++) {
          if (f[i] >= 10 && f[i] <= 20) out.push({ balls: [a, 10 - a], add: { need: 1, sum: f[i] - 10 } });
          const b = f[i] - a;
          if (f[i] < 10 && b >= 0 && a + b < 10) out.push({ balls: [a, b] });
        }
      } else {
        for (let a = 0; a <= 10; a++) {
          if (a === 10) {
            for (let b = 0; b <= 10; b++) {
              const c = f[i] - 10 - b;
              if (b === 10 ? (c >= 0 && c <= 10) : (c >= 0 && b + c <= 10)) out.push({ balls: [10, b, c] });
            }
          } else {
            const c = f[i] - 10;
            if (c >= 0 && c <= 10) out.push({ balls: [a, 10 - a, c] });
            const ob = f[i] - a;
            if (f[i] < 10 && ob >= 0 && a + ob < 10) out.push({ balls: [a, ob] });
          }
        }
      }
      return out;
    };
    const frameCost = (i, balls) => {
      const d = D.balls[i] || [];
      let c = 0;
      for (let j = 0; j < Math.max(balls.length, d.length); j++) {
        const o = balls[j], v = d[j];
        if (o === undefined) c += (v === '' || v == null) ? 0.2 : 1;
        else if (v === undefined) c += 0.6;
        else if (v === '') c += 0.3;
        else if (v !== o) c += 1;
      }
      return c;
    };
    const memo = new Map();
    const best = (i, C) => {
      if (i === 10) return C.length ? null : { cost: 0, path: [] };
      const key = i + '|' + C.map(c => c.need + ':' + c.sum).join(',');
      if (memo.has(key)) return memo.get(key);
      let b = null;
      for (const o of options(i)) {
        const next = applyAll(C, o.balls);
        if (!next) continue;
        if (o.add) next.push(Object.assign({}, o.add));
        const rest = best(i + 1, next);
        if (!rest) continue;
        const c = frameCost(i, o.balls) + rest.cost;
        if (!b || c < b.cost) b = { cost: c, path: [o.balls].concat(rest.path) };
      }
      memo.set(key, b);
      return b;
    };
    const r = best(0, []);
    if (!r) return null;
    const unique = S.framesFromRunningTotals(cum).count === 1;
    const out = emptyDraft();
    r.path.forEach((balls, i) => {
      out.balls[i] = balls.slice();
      out.fouls[i] = balls.map((v, j) => !!(v === 0 && D.balls[i] && D.balls[i][j] === 0 && D.fouls[i] && D.fouls[i][j]));
      out.flags[i] = frameCost(i, balls) === 0 ? 'good' : 'low';
    });
    return { cost: r.cost, unique, draft: out };
  }

  // OCR lines -> the draft to review. When the running totals were read, they decide:
  // if the marks already add up frame by frame, every frame is confirmed; if not, the
  // game that fits the totals and agrees best with the marks is used instead, with the
  // frames that changed marked to check.
  function read(lines) {
    const p = parseLines(lines);
    let draft = draftFromSyms(p.syms), fitted = false, confirmed = false, fit = null, agree = null, mostly = false;
    const marksRead = draft.balls.map((b, i) => marks(draft, i));   // what the marks alone said, before the totals decided
    const ballsRead = draft.balls.map(b => b.slice());
    if (p.totals.length >= MOSTLY) {
      const c = check(draft);
      const cum = c.ok && c.complete ? S.computeScore(c.game).cumulative : null;
      if (cum && p.totals.length === 10 && cum.every((v, i) => v === p.totals[i])) {
        draft.flags = draft.flags.map(() => 'good');
        confirmed = true; agree = 10;
      } else if (cum) {
        // A wrong mark shifts every running total after it, so marks that explain most of the totals are right and the
        // few that disagree are misread totals (or one that was dropped). Keep the marks; frames whose total didn't
        // match are shown amber.
        const m = matchTotals(cum, p.totals);
        agree = m.count;
        if (m.count >= MOSTLY) { draft.flags = draft.flags.map((f, i) => (m.at[i] ? 'good' : 'low')); mostly = true; }
      }
    }
    if (!confirmed && !mostly && p.totals.length === 10) {
      fit = fitToTotals(draft, p.totals);
      if (fit) { draft = fit.draft; fitted = true; }
    }
    const changed = fitted ? draft.balls.map((b, i) => (JSON.stringify(b) === JSON.stringify(ballsRead[i]) ? -1 : i)).filter(i => i >= 0) : [];
    return { draft, totals: p.totals, fitted, confirmed, mostly, agree, marks: p.syms.length,
      detail: { kinds: p.kinds, chosen: p.chosen, marksRead, changed, cost: fit ? fit.cost : null, unique: fit ? fit.unique : null } };
  }
  const parseText = text => parseLines(String(text || '').split(/\r?\n/));

  /* ---------- rack state for one box ---------- */
  // What's standing when ball j of frame i is thrown, given the balls before it.
  // playable=false: this box can't be bowled (ball 2 after a strike, an unearned 10th fill).
  // known=false: an earlier box in the rack is blank, so the count is unknown.
  function rackInfo(balls, i, j) {
    const b = balls.slice(0, j);
    if (b.some(v => v === '' || v == null)) {
      if (i < 9 && j === 1 && b[0] === '') return { playable: true, known: false, fresh: false, rem: 10 };
      return { playable: true, known: false, fresh: j === 0, rem: 10 };
    }
    if (i < 9) {
      if (j === 0) return { playable: true, known: true, fresh: true, rem: 10 };
      if (j === 1) return b[0] === 10 ? { playable: false } : { playable: true, known: true, fresh: false, rem: 10 - b[0] };
      return { playable: false };
    }
    if (j === 0) return { playable: true, known: true, fresh: true, rem: 10 };
    if (j === 1) return b[0] === 10 ? { playable: true, known: true, fresh: true, rem: 10 } : { playable: true, known: true, fresh: false, rem: 10 - b[0] };
    if (j === 2) {
      if (b[0] === 10) return b[1] === 10 ? { playable: true, known: true, fresh: true, rem: 10 } : { playable: true, known: true, fresh: false, rem: 10 - b[1] };
      if (b[0] + b[1] === 10) return { playable: true, known: true, fresh: true, rem: 10 };
      return { playable: false };
    }
    return { playable: false };
  }
  function frameDone(balls, i) {
    if (balls.some(v => v === '' || v == null)) return i < 9 ? balls.length >= 2 || balls[0] === 10 : balls.length >= 3 || (balls.length === 2 && rackInfo(balls, 9, 2).playable === false);
    if (i < 9) return balls[0] === 10 || balls.length >= 2;
    if (balls.length >= 3) return true;
    return balls.length === 2 && !(balls[0] === 10 || balls[0] + balls[1] === 10);
  }

  // Value of a mark in a box, or {illegal}. X where a spare belongs reads as a spare (flagged).
  function valueFor(sym, info) {
    if (sym.t === 'F') return { v: 0, foul: true };
    if (sym.t === '-') return { v: 0 };
    if (!info.known) {
      if (sym.t === 'X' && info.fresh) return { v: 10 };
      if (sym.t === 'd') return { v: sym.v, unsure: true };
      if (sym.t === '/') return { blank: true };
      return { illegal: true };
    }
    if (sym.t === 'X') return info.fresh ? { v: 10 } : { v: info.rem, unsure: true };
    if (sym.t === '/') return info.fresh ? { illegal: true } : { v: info.rem };
    if (sym.t === 'd') {
      if (sym.v < info.rem) return { v: sym.v };
      if (!info.fresh && sym.v === info.rem) return { v: sym.v, unsure: true }; // a spare written as a number
      return { illegal: true };
    }
    return { illegal: true };
  }

  const RANK = { '': 0, good: 1, low: 2, bad: 3 };
  const worse = (a, b) => (RANK[b] > RANK[a] ? b : a);

  // Place OCR marks box by box.
  function draftFromSyms(syms) {
    const d = emptyDraft();
    let i = 0;
    for (const sym of syms || []) {
      while (i < 10 && frameDone(d.balls[i], i)) i++;
      if (i >= 10) break;
      const j = d.balls[i].length;
      const info = rackInfo(d.balls[i], i, j);
      if (!info.playable) { i++; continue; }
      const r = valueFor(sym, info);
      let flag;
      if (r.illegal || r.blank || (sym.conf != null && sym.conf < CONF_DROP)) {
        d.balls[i].push(''); d.fouls[i].push(false);
        flag = r.illegal ? 'bad' : 'low';
      } else {
        d.balls[i].push(r.v); d.fouls[i].push(!!r.foul);
        flag = (r.unsure || sym.conf == null || sym.conf < CONF_LOW) ? 'low' : 'good';
      }
      d.flags[i] = worse(d.flags[i], flag);
    }
    return d;
  }

  /* ---------- draft -> checked game ---------- */
  function check(d) {
    for (let i = 0; i < 10; i++) {
      const b = d.balls[i];
      const gap = b.findIndex(v => v === '' || v == null);
      if (gap >= 0) return { ok: false, blank: true, frame: i, error: 'Frame ' + (i + 1) + ': fill in ball ' + (gap + 1) + '.', partial: partial(d, i) };
    }
    const frames = d.balls.map((b, i) => ({ balls: b.slice(), fouls: (d.fouls[i] || []).slice(0, b.length).map(Boolean) }));
    const v = S.validateFrames(frames);
    if (!v.ok) return { ok: false, error: v.error, partial: partial(d, 10) };
    const complete = S.isComplete(v.game);
    const sc = S.computeScore(v.game);
    return { ok: true, complete, game: v.game, running: complete ? sc.total : sc.runningTotal, total: sc.total, max: S.maxPossible(v.game) };
  }
  // Score of the legal frames before the first problem, for the running strip.
  function partial(d, upto) {
    const frames = d.balls.map((b, i) => ({ balls: i < upto ? b.slice() : [], fouls: i < upto ? (d.fouls[i] || []).slice(0, b.length) : [] }));
    const v = S.validateFrames(frames);
    if (!v.ok) return null;
    return { running: S.computeScore(v.game).runningTotal, max: S.maxPossible(v.game) };
  }

  /* ---------- keypad ---------- */
  // Keys allowed in box (i, j): X, /, -, F and digits.
  function keysFor(d, i, j) {
    const info = rackInfo(d.balls[i].slice(0, j), i, j);
    if (!info.playable) return null;
    const rem = info.known ? info.rem : 10;
    const digits = [];
    for (let n = 1; n <= 9; n++) if (n < rem) digits.push(n);
    return { X: info.fresh || !info.known, spare: !info.fresh && info.known && rem > 0, digits, miss: true, foul: true, rem, fresh: info.fresh };
  }
  // Put a key in box (i, j). Later boxes in the same frame are cleared (they may no
  // longer be legal). Returns the next box to fill, or null when the game is done.
  function enter(d, i, j, key) {
    const k = keysFor(d, i, j);
    if (!k) return { ok: false };
    let v, foul = false;
    if (key === 'X') { if (!k.X) return { ok: false }; v = 10; }
    else if (key === '/') { if (!k.spare) return { ok: false }; v = k.rem; }
    else if (key === '-') v = 0;
    else if (key === 'F') { v = 0; foul = true; }
    else { v = +key; if (!(k.digits.indexOf(v) >= 0)) return { ok: false }; }
    d.balls[i] = d.balls[i].slice(0, j).concat([v]);
    d.fouls[i] = (d.fouls[i] || []).slice(0, j).concat([foul]);
    return { ok: true, next: nextBox(d, i) };
  }
  function nextBox(d, i) {
    for (let f = i; f < 10; f++) {
      const b = d.balls[f];
      const gap = b.findIndex(v => v === '' || v == null);
      if (gap >= 0) return { i: f, j: gap };
      if (!frameDone(b, f)) return { i: f, j: b.length };
    }
    for (let f = 0; f < i; f++) {
      const b = d.balls[f];
      const gap = b.findIndex(v => v === '' || v == null);
      if (gap >= 0) return { i: f, j: gap };
      if (!frameDone(b, f)) return { i: f, j: b.length };
    }
    return null;
  }
  // One-tap frame outcomes from the keypad.
  function strike(d, i) { return enter(d, i, 0, 'X'); }
  function clearFrame(d, i) { d.balls[i] = []; d.fouls[i] = []; }
  function erase(d, i, j) { d.balls[i] = d.balls[i].slice(0, j); d.fouls[i] = (d.fouls[i] || []).slice(0, j); }

  // Marks for display (same as the scoring engine, blanks shown as '').
  function marks(d, i) {
    const b = d.balls[i], f = d.fouls[i] || [];
    return b.map((v, j) => {
      if (v === '' || v == null) return '';
      if (f[j]) return 'F';
      const info = rackInfo(b.slice(0, j), i, j);
      if (info.known && info.fresh && v === 10) return 'X';
      if (info.known && !info.fresh && v === info.rem) return '/';
      return v === 0 ? '-' : String(v);
    });
  }

  /* ---------- an account of one scan, to paste into an email when a reading goes wrong ---------- */
  // o: { version, when, photo: { w, h, crop, procW, procH, ms }, raw, lines: [text], detail (from read), totals,
  //      fitted, confirmed, draft (as it is now), checked, error }. Words only: no photo goes in it.
  // Several reading passes over one photo (different image sizes or layout modes): their lines are read together, with
  // blank lines between the passes so a row is never stitched across two of them. `first` is where each pass starts.
  function combinePasses(passes) {
    const lines = [], first = [];
    passes.forEach((ls, i) => { if (i) lines.push({ text: '', confs: null }, { text: '', confs: null }); first.push(lines.length); lines.push(...ls); });
    return { lines, first };
  }

  function report(o) {
    o = o || {};
    const pct = v => Math.round(v * 100) + '%';
    const frameText = (d, i) => { const m = marks(d, i); return m.length ? m.map(x => (x === '' ? '?' : x)).join('') : '·'; };
    const row = d => Array.from({ length: 10 }, (_, i) => frameText(d, i)).join(' | ');
    const L = ['BowlBoard scan details', [o.version ? 'Version ' + o.version : '', o.when || ''].filter(Boolean).join(' · ')];
    const ph = o.photo;
    if (ph) L.push('Photo: ' + [ph.w && ph.h ? ph.w + '×' + ph.h : '', ph.crop ? 'box x ' + pct(ph.crop.x) + ', y ' + pct(ph.crop.y) + ', w ' + pct(ph.crop.w) + ', h ' + pct(ph.crop.h) : 'whole photo',
      ph.procW ? 'cleaned crop ' + ph.procW + '×' + ph.procH : '', ph.ms != null ? 'read in ' + (ph.ms / 1000).toFixed(1) + ' s' : ''].filter(Boolean).join(' · '));
    if (o.error) L.push('Problem: ' + o.error);
    if (o.note) L.push('Note: ' + o.note);
    const d = o.detail;
    if (d) {
      const n = (o.totals || []).length;
      L.push('Result: ' + (o.mostly ? o.agree + ' of the running totals agree with the marks, so the marks were kept' : o.confirmed ? 'the marks and the running totals agree frame by frame'
        : o.fitted ? 'frames fitted to the running totals' + (d.changed.length ? ' (changed: ' + d.changed.map(i => i + 1).join(', ') + ')' : '') + (d.unique ? '; only one game fits these totals' : '; more than one game fits, the closest to the marks was used')
        : n === 10 ? 'the ten running totals it read fit no game, so they were probably misread; marks only'
        : 'marks only (running totals ' + (n ? 'partly read: ' + n + ' of 10' : 'not read') + ')'));
      if (o.lines && o.lines.length) {
        const multi = (o.passes || []).length > 1, at = {}, real = multi ? o.lines.filter(t => t !== '').length : o.lines.length;
        (o.passes || []).forEach(p => { at[p.first] = p.label; });
        L.push('Lines it saw (' + real + (multi ? ', in ' + o.passes.length + ' reading passes' : '') + '):');
        let num = 0;
        o.lines.forEach((t, i) => {
          if (at[i] != null) L.push('  — ' + at[i] + ' —');
          if (t === '' && multi) return;   // the blank lines that keep the passes apart
          L.push('  ' + String(++num).padStart(String(real).length) + '  ' + String(d.kinds[i] || 'other').padEnd(12) + (i === d.chosen ? '← used  ' : '        ') + JSON.stringify(t));
        });
      }
      L.push('Marks it read: ' + (d.marksRead ? Array.from({ length: 10 }, (_, i) => { const m = d.marksRead[i] || []; return m.length ? m.map(x => (x === '' ? '?' : x)).join('') : '·'; }).join(' | ') : 'none'));
      L.push('Running totals it read: ' + ((o.totals || []).length ? o.totals.join(' ') : 'none'));
    }
    if (o.draft) L.push('On screen now: ' + row(o.draft) + (o.total != null ? ' = ' + o.total : '') + (o.checked != null ? '; frames checked: ' + (o.checked ? 'yes' : 'no') : ''));
    if (o.raw != null) L.push('', 'Raw text:', String(o.raw).replace(/\s+$/, ''));
    L.push('', 'No photo is included in this report.');
    return L.join('\n');
  }

  const Scan = { report, CONF_LOW, CONF_DROP, emptyDraft, fromFrames, linesFromOCR, combinePasses, tokens, classify, repairTotals, parseLines, parseText, fitToTotals, read, readText: text => read(String(text || '').split(/\r?\n/)), rackInfo, frameDone, draftFromSyms, check, keysFor, enter, nextBox, strike, clearFrame, erase, marks };
  if (typeof module !== 'undefined' && module.exports) module.exports = Scan;
  else global.BBScan = Scan;
})(typeof window !== 'undefined' ? window : globalThis);
