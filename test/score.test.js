// Node unit tests for BowlBoard scoring engine. Run: node test_score.js
const S = require('../js/score.js');

let pass = 0, fail = 0;
function eq(actual, expected, name) {
  if (actual === expected) { pass++; }
  else { fail++; console.log('FAIL', name, '- expected', expected, 'got', actual); }
}
function play(ballsPerFrame) {
  // ballsPerFrame: array of 10 arrays
  const g = S.newGame();
  ballsPerFrame.forEach((balls, i) => balls.forEach(p => {
    const r = S.recordBall(g, p);
    if (!r.ok) throw new Error('frame ' + (i + 1) + ': ' + r.error);
  }));
  return g;
}
const total = g => S.computeScore(g).total;

// 1. Perfect game
eq(total(play([[10],[10],[10],[10],[10],[10],[10],[10],[10],[10,10,10]])), 300, 'perfect game');
// 2. All gutters
eq(total(play(Array(10).fill([0,0]))), 0, 'all gutters');
// 3. All 9-miss opens
eq(total(play(Array(10).fill([9,0]))), 90, 'all 9-');
// 4. All spares (5/ + 5 in 10th)
eq(total(play(Array(9).fill([5,5]).concat([[5,5,5]]))), 150, 'all spares');
// 5. Dutch 200: spare/strike alternating, 10th = X 9 /
eq(total(play([[9,1],[10],[9,1],[10],[9,1],[10],[9,1],[10],[9,1],[10,9,1]])), 200, 'dutch 200');
// 6. Hand-computed mixed game = 187
eq(total(play([[10],[7,2],[9,1],[10],[10],[10],[2,3],[6,4],[7,3],[10,10,10]])), 187, 'mixed 187');
// 7. 10th-frame spare with strike fill
eq(total(play(Array(9).fill([8,1]).concat([[9,1,10]]))), 101, '10th spare+strike fill');
// 8. 10th frame: strike, gutter-spare
eq(total(play(Array(9).fill([0,0]).concat([[10,0,10]]))), 20, '10th X - /');
// 9. Turkey then open
eq(total(play([[10],[10],[10],[9,0]].concat(Array(5).fill([0,0])).concat([[0,0]]))), 87, 'turkey then 9-');
//    f1: 10+10+10=30, f2: 10+10+9=29, f3: 10+9+0=19, f4: 9 -> 87

// partial-game behavior
{
  const g = play([[10],[7]]);
  const s = S.computeScore(g);
  eq(s.total, null, 'partial total null');
  eq(s.cumulative[1], null, 'frame2 unresolved (spare? no: 7, waiting ball2)');
  eq(s.cumulative[0], null, 'frame1 strike unresolved');
  eq(s.runningTotal, 0, 'running total 0');
}
{
  const g = play([[10],[10],[7,2]]);
  const s = S.computeScore(g);
  eq(s.cumulative[0], 27, 'strike bonus resolves (10+10+7)');
  eq(s.cumulative[1], 46, 'second strike resolves too (10+7+2)');
}

// legalPins / validation
{
  const g = S.newGame();
  eq(S.legalPins(g), 10, 'fresh rack 10');
  S.recordBall(g, 7);
  eq(S.legalPins(g), 3, '3 remain');
  eq(S.recordBall(g, 4).ok, false, 'cannot knock 4 of 3');
  S.recordBall(g, 3); // spare
  eq(S.currentFrame(g), 1, 'spare advances frame');
}
{
  const g = play([[10],[10],[10],[10],[10],[10],[10],[10],[10],[10,10]]);
  eq(S.legalPins(g), 10, '10th: XX -> fresh rack');
  eq(S.isComplete(g), false, 'not complete yet');
  S.recordBall(g, 10);
  eq(S.isComplete(g), true, 'XXX completes');
}
{
  const g = play(Array(9).fill([0,0]).concat([[3,7]]));
  eq(S.isComplete(g), false, '10th spare needs fill');
  eq(S.legalPins(g), 10, 'fill ball fresh rack');
}

// undo
{
  const g = play([[10]]);
  eq(S.undo(g), true, 'undo strike');
  eq(g.frames[0].balls.length, 0, 'frame empty after undo');
  eq(S.undo(g), false, 'undo empty game false');
}

// validateFrames
{
  const v = S.validateFrames(Array(9).fill({ balls: [7, 2] }).concat([{ balls: [10, 10, 10] }]));
  eq(v.ok, true, 'validate good game');
  const bad = S.validateFrames(Array(9).fill({ balls: [7, 2] }).concat([{ balls: [10, 7, 7] }]));
  eq(bad.ok, false, 'validate rejects 10th ball over rack');
  const bad2 = S.validateFrames([ { balls: [7, 7] } ].concat(Array(9).fill({ balls: [0, 0] })));
  eq(bad2.ok, false, 'validate rejects 7+7 frame');
}

// marks
{
  const g = play([[10],[7,3],[9,0]]);
  const m = S.computeScore(g).marks;
  eq(m[0].join(''), 'X', 'strike mark');
  eq(m[1].join(''), '7/', 'spare mark');
  eq(m[2].join(''), '9-', 'miss mark');
}
{
  const g = play(Array(9).fill([0, 0]).concat([[10, 5, 5]]));
  eq(S.computeScore(g).marks[9].join(''), 'X5/', '10th X 5 /');
}

// maxPossible
{
  eq(S.maxPossible(S.newGame()), 300, 'max fresh = 300');
  const g = play([[9, 0]]);
  eq(S.maxPossible(g), 279, 'max after 9- = 279');
  const g2 = play([[10],[10]]);
  eq(S.maxPossible(g2), 300, 'max after XX = 300');
}

// ---------- pin tracking ----------
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
{
  const g = S.newGame();
  eq(same(S.standingPins(g), [1,2,3,4,5,6,7,8,9,10]), true, 'fresh rack: all pins standing');
  eq(S.recordThrow(g, [1, 2, 3, 4, 5, 6, 7]).ok, true, 'throw 7 named pins');
  eq(same(S.standingPins(g), [8, 9, 10]), true, 'second ball: only 8-9-10 standing');
  eq(S.recordThrow(g, [1, 8, 9]).ok, false, 'cannot knock a pin that is already down');
  eq(S.recordClear(g).ok, true, 'one-tap spare');
  eq(S.computeScore(g).marks[0].join(''), '7/', 'spare mark after clear');
  eq(same(g.frames[0].pins[1], [8, 9, 10]), true, 'spare pins recorded');
}
{
  // count-only entry: standing pins unknown, but count still validated
  const g = S.newGame();
  S.recordBall(g, 6);
  eq(S.standingPins(g), null, 'count-only ball -> standing unknown');
  eq(S.legalPins(g), 4, 'legal pins still known');
}
{
  // one-tap strike
  const g = S.newGame();
  S.recordClear(g);
  eq(S.computeScore(g).marks[0].join(''), 'X', 'one-tap strike');
  eq(S.currentFrame(g), 1, 'strike advances');
}
{
  // 10th frame racks: strike then partial then spare
  const g = play(Array(9).fill([0, 0]));
  S.recordClear(g); // X
  eq(same(S.standingPins(g), [1,2,3,4,5,6,7,8,9,10]), true, '10th after strike: fresh rack');
  S.recordThrow(g, [1, 2, 4, 7]);
  eq(same(S.standingPins(g), [3, 5, 6, 8, 9, 10]), true, '10th ball 3 uses remaining pins');
  S.recordClear(g);
  eq(S.computeScore(g).marks[9].join(''), 'X4/', '10th X 4 /');
  eq(S.computeScore(g).total, 20, '10th X4/ = 20');
}

// ---------- fouls ----------
{
  const g = S.newGame();
  eq(S.recordThrow(g, [], { foul: true }).ok, true, 'foul recorded');
  eq(same(S.standingPins(g), [1,2,3,4,5,6,7,8,9,10]), true, 'foul: pins respotted');
  S.recordClear(g);
  const sc = S.computeScore(g);
  eq(sc.marks[0].join(''), 'F/', 'foul then all ten = spare');
  eq(g.frames[0].balls[0], 0, 'foul counts zero');
}

// ---------- splits ----------
eq(S.isSplit([7, 10]), true, '7-10 is a split');
eq(S.isSplit([3, 10]), true, '3-10 is a split');
eq(S.isSplit([5, 6]), true, '5-6 is a split (USBC example)');
eq(S.isSplit([4, 7, 10]), true, '4-7-10 is a split');
eq(S.isSplit([6, 10]), false, '6-10 is not a split');
eq(S.isSplit([2, 4, 5, 8]), false, 'bucket is not a split');
eq(S.isSplit([1, 7]), false, 'headpin standing: not a split');
eq(S.isSplit([10]), false, 'single pin: not a split');
{
  const g = S.newGame();
  S.recordThrow(g, [1, 2, 3, 4, 5, 6, 8, 9]); // leaves 7-10
  const sc = S.computeScore(g);
  eq(sc.splits[0][0], true, 'split flagged on first ball');
}

// ---------- pending ----------
{
  const g = play([[7, 3]]);
  const sc = S.computeScore(g);
  eq(sc.pending[0], true, 'spare waiting on next ball is pending');
  eq(sc.runningTotal, 0, 'running total excludes pending');
  S.recordBall(g, 5);
  eq(S.computeScore(g).cumulative[0], 15, 'spare resolves after next ball');
}

// ---------- validateFrames keeps detail / rejects gaps ----------
{
  const frames = [{ balls: [7, 3], pins: [[1,2,3,4,5,6,7],[8,9,10]], fouls: [false,false] }]
    .concat(Array(8).fill({ balls: [0, 0] })).concat([{ balls: [0, 0] }]);
  const v = S.validateFrames(frames);
  eq(v.ok, true, 'validate with pins');
  eq(same(v.game.frames[0].pins[1], [8, 9, 10]), true, 'pins preserved through validation');
  const gap = S.validateFrames([{ balls: [7] }, { balls: [3, 4] }].concat(Array(8).fill({ balls: [0, 0] })));
  eq(gap.ok, false, 'incomplete frame rejected');
}

// ---------- pinStats ----------
{
  const g = S.newGame();
  S.recordThrow(g, [1,2,3,4,5,6,7,8,9]); S.recordClear(g);       // 9/ single pin made (10 left)
  S.recordThrow(g, [1,2,3,4,5,6,8,9]); S.recordThrow(g, []);     // 7-10 split, missed
  S.recordClear(g);                                              // X
  for (let i = 3; i < 9; i++) { S.recordBall(g, 0); S.recordBall(g, 0); }
  S.recordBall(g, 0); S.recordBall(g, 0);
  const st = S.pinStats([{ frames: g.frames }]);
  eq(st.strikes, 1, 'pinStats strikes');
  eq(st.singleOpps, 1, 'pinStats single-pin opportunities');
  eq(st.singles, 1, 'pinStats single-pin made');
  eq(st.splitOpps, 1, 'pinStats split opportunities');
  eq(st.splitsMade, 0, 'pinStats splits made');
  eq(st.leaves['7-10'].count, 1, 'pinStats leave tracked');
  eq(st.cleanGames, 0, 'not a clean game');
}
{
  // backwards compat: old saved games have only balls
  const st = S.pinStats([{ frames: Array(9).fill({ balls: [10] }).concat([{ balls: [10, 10, 10] }]) }]);
  eq(st.strikes, 12, 'old-format perfect game: 12 strikes');
  eq(st.cleanGames, 1, 'perfect game is clean');
}

// ---------- review minimum set ----------
eq(total(play(Array(9).fill([9, 1]).concat([[9, 1, 9]]))), 190, 'all 9-spares = 190');
eq(total(play(Array(10).fill([9, 0]).map((f, i) => (i % 2 ? [0, 9] : [9, 0])))), 90, '9-gutter / gutter-9 alternating = 90');
{
  const tenth = balls => play(Array(9).fill([0, 0]).concat([balls]));
  eq(S.computeScore(tenth([10, 10, 10])).marks[9].join(''), 'XXX', '10th X-X-X marks');
  eq(total(tenth([10, 10, 10])), 30, '10th X-X-X = 30');
  eq(S.computeScore(tenth([10, 8, 2])).marks[9].join(''), 'X8/', '10th X-8-/ marks');
  eq(total(tenth([10, 8, 2])), 20, '10th X-8-/ = 20');
  eq(S.computeScore(tenth([8, 2, 10])).marks[9].join(''), '8/X', '10th 8-/-X marks');
  eq(total(tenth([8, 2, 10])), 20, '10th 8-/-X = 20');
}
{
  // foul, then all ten on the same rack = spare (F/), never a strike
  const g = S.newGame();
  S.recordThrow(g, [], { foul: true });
  S.recordThrow(g, S.ALL_PINS.slice());
  eq(S.computeScore(g).marks[0].join(''), 'F/', 'foul then ten = F/');
  eq(S.currentFrame(g), 1, 'foul + ten ends the frame');
  eq(S.pinStats([{ frames: g.frames }]).strikes, 0, 'foul + ten is not a strike');
}
{
  const g = S.newGame();
  S.recordBall(g, 6);
  eq(S.recordBall(g, 5).ok, false, 'illegal count (6 then 5) rejected');
  eq(S.recordBall(g, 11 - 6).ok, false, 'still rejected');
  const v = S.validateFrames([{ balls: [7, 2], pins: [[1, 2, 3], [4, 5]] }].concat(Array(9).fill({ balls: [0, 0] })));
  eq(v.ok, true, 'inconsistent pin list accepted');
  eq(v.game.frames[0].pins[0], null, '...as count only (pins dropped, not repaired)');
  eq(v.game.frames[0].balls.join(), '7,2', '...count kept');
}

// ---------- split fixtures (USBC Playing Rules: split definition) ----------
// Rule 1: a pin down between standing pins (e.g. 7-9, 3-10).
// Rule 2: a pin down immediately ahead of two or more standing pins (e.g. 5-6).
// Sleepers (a pin directly behind another: 2-8, 3-9) are not splits.
const SPLITS = ['7-10', '7-9', '8-10', '4-6', '2-7', '3-10', '4-10', '6-7', '5-7', '5-10', '4-9', '6-8', '2-10', '3-7',
  '4-7-10', '6-7-10', '4-6-7-10', '4-6-7-9-10', '2-4-10', '3-4-6-7-10',
  '5-6', '4-5', '2-3', '7-8', '8-9', '9-10'];   // side-by-side "fit" splits: rule 2 (pin ahead is down)
const NOT_SPLITS = ['6-10', '3-6-10', '2-4-5-8', '2-4-7', '1-2-4-7', '1-3-6-10', '2-8', '3-9', '2-5', '5-8-9', '2-4-5',
  '4-7', '3-6', '5-9', '1-7-10', '10', '7', '1', '4-5-8', '4-7-8', '2-8-10'.slice(0, 3)];
SPLITS.forEach(k => eq(S.isSplit(k.split('-').map(Number)), true, 'split: ' + k));
NOT_SPLITS.forEach(k => eq(S.isSplit(k.split('-').map(Number)), false, 'not a split: ' + k));
eq(S.isSplit([2, 8, 10]), true, '2-8-10: sleeper pair plus a separate 10 is a split');

// ---------- running totals -> frames ----------
{
  const perfect = S.framesFromRunningTotals([30, 60, 90, 120, 150, 180, 210, 240, 270, 300]);
  eq(perfect.count, 1, '300 running totals: exactly one game');
  eq(total(S.validateFrames(perfect.frames).game), 300, 'rebuilt 300');
  eq(S.framesFromRunningTotals([30, 40, 50, 60, 70, 80, 90, 100, 110, 120]).count, 0, '30 then +10 is impossible (strike needs 20+ next)');
  eq(S.framesFromRunningTotals([9, 18, 27, 36, 45, 54, 63, 72, 81, 90]).count, 2, 'all 9s: many possible games');
  const dutch = S.framesFromRunningTotals([20, 40, 60, 80, 100, 120, 140, 160, 180, 200]);
  eq(dutch.count >= 1, true, '200 in 20s is possible');
  eq(total(S.validateFrames(dutch.frames).game), 200, 'rebuilt example totals 200');
  const gutters = S.framesFromRunningTotals(Array(10).fill(0));
  eq(gutters.count, 1, 'all gutters: one game');
}

// ---------- strike % definition ----------
{
  // 12 chances in a 300; 10th-frame double + fill counts 3 chances
  const st = S.pinStats([{ frames: play(Array(9).fill([10]).concat([[10, 10, 10]])).frames }]);
  eq(st.racks + '/' + st.strikes, '12/12', '300 = 12 strike chances, 12 strikes');
  const st2 = S.pinStats([{ frames: play(Array(9).fill([0, 0]).concat([[10, 8, 2]])).frames }]);
  eq(st2.racks, 11, '9 opens + 10th X then 8/: 11 full racks');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
