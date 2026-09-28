/* BowlBoard scoring engine — pure 10-pin bowling logic, no DOM.
 *
 * Game shape: { frames: [ {balls:[n,...], pins:[[pin,...]|null,...], fouls:[bool,...]} x10 ] }
 *   balls[j] — pins counted for delivery j (0 on a foul)
 *   pins[j]  — which pins (1-10) fell on delivery j, or null when only the count is known
 *   fouls[j] — true when delivery j was a foul (counts 0, pins are respotted)
 * Frames 0-8: up to 2 balls (1 if strike). Frame 9 (10th): up to 3 balls.
 * Older saved games only have `balls`; every function here tolerates missing pins/fouls.
 */
(function (global) {
  'use strict';

  const ALL_PINS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  // Pin deck coordinates (x across, row from the headpin) — used for split detection.
  const PIN_POS = {
    1: [0, 0], 2: [-1, 1], 3: [1, 1], 4: [-2, 2], 5: [0, 2], 6: [2, 2],
    7: [-3, 3], 8: [-1, 3], 9: [1, 3], 10: [3, 3],
  };

  function blankFrame() { return { balls: [], pins: [], fouls: [] }; }

  function newGame() {
    return { frames: Array.from({ length: 10 }, blankFrame) };
  }

  function normFrame(f) {
    f = f || {};
    const balls = (f.balls || []).slice();
    return {
      balls,
      pins: balls.map((_, j) => (f.pins && Array.isArray(f.pins[j])) ? f.pins[j].slice() : null),
      fouls: balls.map((_, j) => !!(f.fouls && f.fouls[j])),
    };
  }

  function clone(game) {
    return { frames: game.frames.map(normFrame) };
  }

  // Is the 10th frame finished given its balls?
  function tenthDone(b) {
    if (b.length < 2) return false;
    if (b.length >= 3) return true;
    return !(b[0] === 10 || b[0] + b[1] === 10);
  }

  function frameDone(game, i) {
    const b = game.frames[i].balls;
    if (i < 9) return b.length === 2 || b[0] === 10;
    return tenthDone(b);
  }

  // Index of the frame awaiting input, or 10 when the game is complete.
  function currentFrame(game) {
    for (let i = 0; i < 10; i++) if (!frameDone(game, i)) return i;
    return 10;
  }

  function isComplete(game) {
    return currentFrame(game) === 10;
  }

  // Index of the delivery that set the rack for delivery n in this frame.
  // In frames 1-9 that is always 0; in the 10th the rack resets after a strike or spare.
  function rackStart(frameIdx, balls, n) {
    if (frameIdx < 9) return 0;
    let start = 0, sum = 0;
    for (let j = 0; j < n; j++) {
      sum += balls[j];
      if (sum === 10) { start = j + 1; sum = 0; }
    }
    return start;
  }

  // Max pins the next ball may legally knock down.
  function legalPins(game) {
    const i = currentFrame(game);
    if (i === 10) return 0;
    const b = game.frames[i].balls;
    const start = rackStart(i, b, b.length);
    let down = 0;
    for (let j = start; j < b.length; j++) down += b[j];
    return 10 - down;
  }

  // Pins standing for the next delivery, or null if an earlier ball in this rack
  // was entered as a count only (we know how many, not which).
  function standingPins(game) {
    const i = currentFrame(game);
    if (i === 10) return [];
    const f = game.frames[i];
    const n = f.balls.length;
    const start = rackStart(i, f.balls, n);
    const down = new Set();
    for (let j = start; j < n; j++) {
      const p = f.pins && f.pins[j];
      if (!Array.isArray(p)) return null;
      p.forEach(x => down.add(x));
    }
    return ALL_PINS.filter(p => !down.has(p));
  }

  // Is the next delivery on a full rack?
  function freshRack(game) {
    const i = currentFrame(game);
    if (i === 10) return false;
    const b = game.frames[i].balls;
    return rackStart(i, b, b.length) === b.length;
  }

  function ensureArrays(f) {
    if (!f.pins) f.pins = f.balls.map(() => null);
    if (!f.fouls) f.fouls = f.balls.map(() => false);
  }

  // Record a ball by count. detail (optional): {pins:[...], foul:bool}.
  // Returns {ok:true} or {ok:false, error}.
  function recordBall(game, count, detail) {
    detail = detail || {};
    if (currentFrame(game) === 10) return { ok: false, error: 'Game is complete.' };
    if (detail.foul) count = 0;
    if (!Number.isInteger(count) || count < 0) {
      return { ok: false, error: 'Pins must be a whole number from 0 to 10.' };
    }
    const max = legalPins(game);
    if (count > max) {
      return { ok: false, error: 'Only ' + max + ' pin' + (max === 1 ? '' : 's') + ' standing.' };
    }
    let pins = null;
    if (detail.foul) pins = [];
    else if (Array.isArray(detail.pins)) {
      const standing = standingPins(game);
      const uniq = Array.from(new Set(detail.pins)).sort((a, b) => a - b);
      if (uniq.length !== count) return { ok: false, error: 'Pin list does not match the count.' };
      if (standing && uniq.some(p => standing.indexOf(p) < 0)) {
        return { ok: false, error: 'That pin is already down.' };
      }
      pins = uniq;
    }
    const f = game.frames[currentFrame(game)];
    ensureArrays(f);
    f.balls.push(count);
    f.pins.push(pins);
    f.fouls.push(!!detail.foul);
    return { ok: true };
  }

  // Record a ball from the pins that fell (array of pin numbers).
  function recordThrow(game, downPins, opts) {
    opts = opts || {};
    if (opts.foul) return recordBall(game, 0, { foul: true });
    return recordBall(game, downPins.length, { pins: downPins });
  }

  // One-tap strike / spare: knock everything standing.
  function recordClear(game) {
    const standing = standingPins(game);
    if (standing) return recordBall(game, standing.length, { pins: standing });
    return recordBall(game, legalPins(game));
  }

  function undo(game) {
    for (let i = 9; i >= 0; i--) {
      const f = game.frames[i];
      if (f.balls.length > 0) {
        f.balls.pop();
        if (f.pins) f.pins.length = f.balls.length;
        if (f.fouls) f.fouls.length = f.balls.length;
        return true;
      }
    }
    return false;
  }

  // Replay a frames structure through the rules; used to validate imports and edits.
  // Pin detail and fouls are kept when present and consistent.
  function validateFrames(frames) {
    if (!Array.isArray(frames) || frames.length !== 10) {
      return { ok: false, error: 'Need exactly 10 frames.' };
    }
    const g = newGame();
    for (let i = 0; i < 10; i++) {
      const src = frames[i];
      const balls = src && src.balls;
      if (!Array.isArray(balls)) return { ok: false, error: 'Frame ' + (i + 1) + ' is malformed.' };
      for (let j = 0; j < balls.length; j++) {
        const p = balls[j];
        const cf = currentFrame(g);
        if (cf < i) return { ok: false, error: 'Frame ' + (cf + 1) + ' is incomplete.' };
        if (cf > i) return { ok: false, error: 'Frame ' + (i + 1) + ' has too many balls.' };
        const foul = !!(src.fouls && src.fouls[j]) && p === 0;
        const pins = src.pins && Array.isArray(src.pins[j]) && src.pins[j].length === p ? src.pins[j] : null;
        let r = recordBall(g, p, { foul, pins });
        if (!r.ok && pins) r = recordBall(g, p, { foul }); // drop inconsistent pin detail, keep the count
        if (!r.ok) return { ok: false, error: 'Frame ' + (i + 1) + ': ' + r.error };
      }
    }
    return { ok: true, game: g };
  }

  // Split (USBC Playing Rules): headpin down and at least one pin down
  //   1. between two or more standing pins (7-9, 3-10), or
  //   2. immediately ahead of two or more standing pins (5-6).
  // Modelled as: the standing pins fall into 2+ groups, where two pins stay in the
  // same group only if one sits diagonally right behind the other (they touch), or
  // one is a "sleeper" directly behind the other (2-8, 3-9). Side-by-side pins in a
  // row (8-9, 5-6, 2-3) are split by rule 2 because the pin in front of them is down.
  // Fixtures in test_score.js lock this behaviour.
  function isSplit(standing) {
    if (!standing || standing.length < 2 || standing.indexOf(1) >= 0) return false;
    const together = (a, b) => {
      const pa = PIN_POS[a], pb = PIN_POS[b];
      const dx = Math.abs(pa[0] - pb[0]), dy = Math.abs(pa[1] - pb[1]);
      return (dy === 1 && dx === 1) || (dy === 2 && dx === 0);
    };
    const seen = new Set([standing[0]]);
    const stack = [standing[0]];
    while (stack.length) {
      const p = stack.pop();
      standing.forEach(q => { if (!seen.has(q) && together(p, q)) { seen.add(q); stack.push(q); } });
    }
    return seen.size < standing.length;
  }

  // Pins left standing after delivery j of frame f (only for the first ball of a rack).
  function leaveAfter(frameIdx, f, j) {
    const p = f.pins && f.pins[j];
    if (!Array.isArray(p)) return null;
    if (rackStart(frameIdx, f.balls, j) !== j) return null; // not first ball of a rack
    if (f.balls[j] === 10) return [];
    const down = new Set(p);
    return ALL_PINS.filter(x => !down.has(x));
  }

  // Display mark for one ball.
  function markFor(frameIdx, idx, balls, fouls) {
    const p = balls[idx];
    if (p == null) return '';
    if (fouls && fouls[idx]) return 'F';
    const start = rackStart(frameIdx, balls, idx);
    if (start === idx) {
      if (p === 10) return 'X';
      return p === 0 ? '-' : String(p);
    }
    // later ball in a rack
    let before = 0;
    for (let k = start; k < idx; k++) before += balls[k];
    if (before + p === 10) return '/';
    return p === 0 ? '-' : String(p);
  }

  // Full score computation. cumulative[i] is null until the frame's score resolves.
  function computeScore(game) {
    const flat = [];
    game.frames.forEach(f => f.balls.forEach(p => flat.push(p)));
    const marks = [];
    const splits = [];
    for (let i = 0; i < 10; i++) {
      const f = game.frames[i];
      const b = f.balls;
      marks.push((i < 9 ? [0, 1] : [0, 1, 2]).map(j => markFor(i, j, b, f.fouls)));
      splits.push((i < 9 ? [0, 1] : [0, 1, 2]).map(j => j < b.length && isSplit(leaveAfter(i, f, j))));
    }
    const cumulative = new Array(10).fill(null);
    const pending = new Array(10).fill(false); // frame thrown but waiting on bonus balls
    let total = 0;
    let complete = true;
    let bi = 0;

    for (let i = 0; i < 9; i++) {
      const b = game.frames[i].balls;
      if (b.length === 0) { complete = false; break; }
      if (b[0] === 10) {
        if (flat.length < bi + 3) { complete = false; pending[i] = true; markRestPending(i); break; }
        total += 10 + flat[bi + 1] + flat[bi + 2];
        bi += 1;
      } else {
        if (b.length < 2) { complete = false; break; }
        if (b[0] + b[1] === 10) {
          if (flat.length < bi + 3) { complete = false; pending[i] = true; markRestPending(i); break; }
          total += 10 + flat[bi + 2];
        } else {
          total += b[0] + b[1];
        }
        bi += 2;
      }
      cumulative[i] = total;
    }
    function markRestPending(from) {
      for (let k = from + 1; k < 9; k++) if (frameDone(game, k)) pending[k] = true;
    }

    if (complete) {
      const b = game.frames[9].balls;
      if (!tenthDone(b)) {
        complete = false;
        if (b.length >= 2) pending[9] = true;
      } else {
        total += b.reduce((a, x) => a + x, 0);
        cumulative[9] = total;
      }
    }

    return {
      marks,               // per frame: array of mark strings
      splits,              // per frame: per ball, true if that ball left a split
      cumulative,          // per frame: cumulative total or null
      pending,             // per frame: thrown, waiting on bonus balls
      total: complete ? total : null,
      runningTotal: total, // sum of resolved frames so far
      complete,
    };
  }

  // Highest final score still achievable from this state (all strikes).
  function maxPossible(game) {
    const g = clone(game);
    let guard = 0;
    while (!isComplete(g) && guard++ < 30) recordBall(g, legalPins(g));
    return computeScore(g).total;
  }

  /* ---------- running totals -> frames ---------- */
  // Works out which ball-by-ball games produce these running totals (the cumulative
  // score under each frame). Returns {count, frames}: count 0 = no real game gives
  // these totals, 1 = exactly one game does (frames holds it), 2 = more than one
  // (frames holds one example; the true balls can't be known).
  function framesFromRunningTotals(cum) {
    if (!Array.isArray(cum) || cum.length !== 10) return { count: 0, frames: null };
    const f = cum.map((c, i) => c - (i ? cum[i - 1] : 0));
    if (f.some(x => !Number.isInteger(x) || x < 0 || x > 30)) return { count: 0, frames: null };
    // constraints: [{need, sum}] = the next `need` balls must add up to `sum` (strike/spare bonus)
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
            const b = 10 - a, c = f[i] - 10;
            if (c >= 0 && c <= 10) out.push({ balls: [a, b, c] }); // spare + fill
            const ob = f[i] - a;
            if (f[i] < 10 && ob >= 0 && a + ob < 10) out.push({ balls: [a, ob] });
          }
        }
      }
      return out;
    };
    const memo = new Map();
    const count = (i, C) => {
      if (i === 10) return C.length ? 0 : 1;
      const key = i + '|' + C.map(c => c.need + ':' + c.sum).join(',');
      if (memo.has(key)) return memo.get(key);
      let n = 0;
      for (const o of options(i)) {
        const next = applyAll(C, o.balls);
        if (!next) continue;
        if (o.add) next.push(Object.assign({}, o.add));
        n += count(i + 1, next);
        if (n >= 2) { n = 2; break; }
      }
      memo.set(key, n);
      return n;
    };
    const total = count(0, []);
    if (!total) return { count: 0, frames: null };
    // rebuild one solution by following branches that lead somewhere
    const frames = [];
    let C = [];
    for (let i = 0; i < 10; i++) {
      for (const o of options(i)) {
        const next = applyAll(C, o.balls);
        if (!next) continue;
        if (o.add) next.push(Object.assign({}, o.add));
        if (count(i + 1, next) > 0) { frames.push({ balls: o.balls.slice() }); C = next; break; }
      }
    }
    return { count: total, frames };
  }

  /* ---------- stats across games ---------- */
  // Definitions (match a house sheet):
  //   racks / strike chances = every delivery thrown at a full rack, including 10th-frame
  //     fill balls after a strike or spare (a 300 game = 12 chances, 12 strikes)
  //   spare chances = a rack left standing after its first ball, when a second ball follows
  //   single-pin = first ball of a rack counted 9; splits need pin-by-pin entry
  // games: array of {frames}. Works with count-only games; pin-only stats
  // (leaves, split conversion) use the balls where pins were recorded.
  function pinStats(games) {
    const s = {
      games: 0, racks: 0, strikes: 0, firstBallPins: 0,
      spareOpps: 0, spares: 0, singleOpps: 0, singles: 0,
      splitOpps: 0, splitsMade: 0, frames: 0, openFrames: 0, cleanGames: 0,
      fouls: 0, leaves: {}, pinLeaves: 0,
    };
    games.forEach(g => {
      if (!g || !g.frames) return;
      s.games++;
      let open = 0;
      g.frames.forEach((f0, i) => {
        const f = normFrame(f0);
        const b = f.balls;
        if (!b.length) return;
        s.frames++;
        // frame-level open (first two deliveries)
        if (b[0] !== 10 && b.length >= 2 && b[0] + b[1] < 10) open++;
        f.fouls.forEach(x => { if (x) s.fouls++; });
        for (let j = 0; j < b.length; j++) {
          if (rackStart(i, b, j) !== j) continue; // only look at first ball of each rack
          if (i === 9 && j === 2 && !(b[1] === 10 || b[0] + b[1] === 10) && b[0] !== 10) continue;
          s.racks++;
          s.firstBallPins += b[j];
          if (b[j] === 10) { s.strikes++; continue; }
          if (j + 1 >= b.length) continue; // no follow-up ball (e.g. last fill ball)
          const made = b[j] + b[j + 1] === 10;
          s.spareOpps++; if (made) s.spares++;
          if (b[j] === 9) { s.singleOpps++; if (made) s.singles++; }
          const leave = leaveAfter(i, f, j);
          if (leave) {
            s.pinLeaves++;
            if (isSplit(leave)) { s.splitOpps++; if (made) s.splitsMade++; }
            const key = leave.join('-');
            const L = s.leaves[key] || (s.leaves[key] = { leave: key, count: 0, made: 0 });
            L.count++; if (made) L.made++;
          }
        }
      });
      s.openFrames += open;
      if (open === 0 && g.frames[9].balls.length) s.cleanGames++;
    });
    s.topLeaves = Object.values(s.leaves).sort((a, b) => b.count - a.count || a.leave.localeCompare(b.leave)).slice(0, 6);
    return s;
  }

  const Score = {
    ALL_PINS, newGame, clone, normFrame, recordBall, recordThrow, recordClear, undo,
    legalPins, standingPins, freshRack, rackStart,
    currentFrame, frameDone, isComplete,
    validateFrames, computeScore, maxPossible, markFor, isSplit, leaveAfter, pinStats, framesFromRunningTotals,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Score;
  else global.BBScore = Score;
})(typeof window !== 'undefined' ? window : globalThis);
