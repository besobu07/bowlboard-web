// Node tests for the lane-screen scan draft and the tap-a-frame keypad. Run: node test_scan.js
const S = require('../js/score.js');
const T = require('../js/scan.js');

let pass = 0, fail = 0;
function eq(actual, expected, name) {
  const ok = typeof expected === 'object' ? JSON.stringify(actual) === JSON.stringify(expected) : actual === expected;
  if (ok) pass++; else { fail++; console.log('FAIL', name, '- expected', JSON.stringify(expected), 'got', JSON.stringify(actual)); }
}
const draft = text => T.draftFromSyms(T.parseText(text).syms);
// fake Tesseract output: words of symbols with confidences
const ocr = words => ({ lines: [{ words: words.map(w => ({ text: w.map(s => s[0]).join(''), symbols: w.map(s => ({ text: s[0], confidence: s[1] })) })) }] });

// ---------- a clean read ----------
{
  const d = draft('9 / X 9 / X 9 / X 9 / X 9 / X 9 /');
  eq(d.balls, [[9, 1], [10], [9, 1], [10], [9, 1], [10], [9, 1], [10], [9, 1], [10, 9, 1]], 'Dutch 200 read box by box');
  const r = T.check(d);
  eq([r.ok, r.complete, r.total], [true, true, 200], 'Dutch 200 checks out at 200');
  eq(d.flags.every(f => f === 'low'), true, 'text-only reads (no confidence) are all marked to check');
  const p = T.parseText('X 9/ X 9/ X 9/ X 9/ X 9/X\n20 40 60 80 100 120 140 160 180 200');
  eq(p.totals, [20, 40, 60, 80, 100, 120, 140, 160, 180, 200], 'running-total row recognised, not read as pins');
  eq(T.check(T.draftFromSyms(p.syms)).total, 200, 'marks row still reads to 200');
}

// ---------- 10th frame shapes ----------
{
  const pre = '- - - - - - - - - - - - - - - - - - ';
  eq(draft(pre + 'X 8 /').balls[9], [10, 8, 2], '10th X 8 /');
  eq(draft(pre + '8 / X').balls[9], [8, 2, 10], '10th 8 / X');
  eq(draft(pre + 'X X X').balls[9], [10, 10, 10], '10th X X X');
  eq(draft(pre + '7 2 9').balls[9], [7, 2], 'open 10th stops at two balls');
  eq(T.marks(draft(pre + 'X 8 /'), 9), ['X', '8', '/'], 'marks shown as the sheet shows them');
}

// ---------- fouls stay fouls ----------
{
  const d = draft('F / X X X X X X X X X 8 /');
  eq([d.balls[0], d.fouls[0]], [[0, 10], [true, false]], 'F/ is a foul then a spare');
  const r = T.check(d);
  eq(S.computeScore(r.game).marks[0].join(''), 'F/', 'F/ not promoted to a strike');
  eq(S.pinStats([r.game]).strikes, 9, 'the foul frame adds no strike (nine strikes: frames 2 to 9 and the first ball of the tenth)');
  eq(T.marks(d, 0), ['F', '/'], 'editor shows F and /');
}

// ---------- impossible and unclear marks ----------
{
  const d = draft('7 5 X 9 / X');
  eq(d.balls.slice(0, 4), [[7, ''], [10], [9, 1], [10]], 'a 5 after a 7 is blanked, and later frames stay in place');
  eq(d.flags[0], 'bad', 'the frame with the impossible ball is flagged');
  const r = T.check(d);
  eq([r.ok, r.frame, r.error], [false, 0, 'Frame 1: fill in ball 2.'], 'the draft cannot be saved until it is fixed');
  eq(draft('/ X X X').flags[0], 'bad', 'a spare mark on a fresh rack is flagged');
  eq(draft('- - - - - - - - - - - - - - - - - - 7 2 3').balls[9], [7, 2], 'extra marks after an open 10th are ignored');

  const lines = T.linesFromOCR(ocr([[['9', 96], ['/', 95]], [['X', 70]], [['8', 40], ['1', 97]]]));
  const d2 = T.draftFromSyms(T.parseLines(lines).syms);
  eq(d2.balls.slice(0, 3), [[9, 1], [10], ['', 1]], 'very low confidence box left blank (the next mark keeps its box)');
  eq(d2.flags.slice(0, 3), ['good', 'low', 'low'], 'clear = green, unsure = amber');
  eq(T.check(d2).ok, false, 'blank box blocks saving');
}

// ---------- keypad ----------
{
  const d = T.emptyDraft();
  eq(T.keysFor(d, 0, 0).X, true, 'fresh rack: strike allowed');
  eq(T.keysFor(d, 0, 0).spare, false, 'fresh rack: no spare');
  let r = T.enter(d, 0, 0, '7');
  eq(r.next, { i: 0, j: 1 }, 'after a 7, still in frame 1');
  const k = T.keysFor(d, 0, 1);
  eq([k.X, k.spare, k.digits], [false, true, [1, 2]], 'after a 7 only 1, 2, a miss, a foul or a spare');
  eq(T.enter(d, 0, 1, '5').ok, false, 'a 5 after a 7 is refused');
  r = T.enter(d, 0, 1, '/');
  eq([d.balls[0], r.next], [[7, 3], { i: 1, j: 0 }], 'spare fills in 3 and moves on');
  r = T.enter(d, 1, 0, 'X');
  eq(r.next, { i: 2, j: 0 }, 'a strike moves straight to the next frame');
  // retype a finished frame: later balls in that frame are cleared
  T.enter(d, 0, 0, '9');
  eq(d.balls[0], [9], 'retyping ball 1 clears ball 2');
  // 10th frame
  const t = T.fromFrames(Array(9).fill({ balls: [0, 0] }).concat([{ balls: [] }]));
  T.enter(t, 9, 0, 'X');
  eq(T.keysFor(t, 9, 1).X, true, '10th after a strike: fresh rack');
  T.enter(t, 9, 1, '8');
  eq([T.keysFor(t, 9, 2).digits, T.keysFor(t, 9, 2).spare], [[1], true], '10th X 8: only 1, a miss or a spare');
  r = T.enter(t, 9, 2, '/');
  eq([t.balls[9], r.next, T.check(t).total], [[10, 8, 2], null, 20], '10th X 8 / finishes the game');
  const o = T.fromFrames(Array(9).fill({ balls: [0, 0] }).concat([{ balls: [7, 2] }]));
  eq(T.keysFor(o, 9, 2), null, 'no fill ball after an open 10th');
  eq(T.enter(o, 9, 2, '5').ok, false, 'fill ball refused after an open 10th');
  // blanks are found first
  const b = T.fromFrames(Array(10).fill({ balls: [0, 0] }));
  b.balls[4] = ['', 3];
  eq(T.nextBox(b, 0), { i: 4, j: 0 }, 'the keypad goes to the first blank box');
  // foul key
  const f = T.emptyDraft();
  T.enter(f, 0, 0, 'F');
  eq([f.balls[0], f.fouls[0], T.keysFor(f, 0, 1).spare], [[0], [true], true], 'foul counts 0; a spare is still possible');
}

// ---------- marks that explain most of the totals are kept ----------
{
  const marks = 'X 9 / 7 2 X X 5 3 X 7 2 X 8 1';
  let r = T.read([{ text: marks, confs: null }, { text: '20 37 46 71 89 97 6 125 144 153', confs: null }]);
  eq([r.mostly, r.confirmed, r.fitted, r.agree, T.check(r.draft).total], [true, false, false, 9, 153], 'one total misread: the marks are kept (9 of 10 match)');
  eq(r.draft.flags.filter(f => f === 'low').length, 1, 'mostly: only the frame whose total did not match is amber');
  r = T.read([{ text: marks, confs: null }, { text: '20 37 46 71 89 97 125 144 153 153', confs: null }]);
  eq([r.mostly, r.fitted, r.agree, T.check(r.draft).total], [true, false, 9, 153], 'one total dropped and the last repeated: still kept');
  r = T.read([{ text: marks + ' 258', confs: null }, { text: '20 37 46 71 89 97 116 125 144 153', confs: null }]);
  eq([r.confirmed, T.check(r.draft).total], [true, 153], 'exact agreement is still the best case');
  r = T.read([{ text: marks, confs: null }, { text: '20 37 46 99 89 97 120 130 144 163', confs: null }]);
  eq(r.mostly, false, 'fewer than 8 totals matching: marks are not trusted on that alone');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
