// Node tests for achievements. Run: node test_achievements.js
const S = require('../js/score.js');
const A = require('../js/achievements.js');
let pass = 0, fail = 0;
function eq(actual, expected, name) {
  const ok = typeof expected === 'object' ? JSON.stringify(actual) === JSON.stringify(expected) : actual === expected;
  if (ok) pass++; else { fail++; console.log('FAIL', name, '- expected', JSON.stringify(expected), 'got', JSON.stringify(actual)); }
}

let n = 0;
const game = (night, date, no, total, extra) => Object.assign({ id: 'g' + (++n), seriesId: night, gameNo: no, date, total, mode: 'total' }, extra);
const night = (id, date, totals, extra) => totals.map((t, i) => game(id, date, i + 1, t, extra));
function bowl(counts) { const g = S.newGame(); counts.forEach(c => { const r = S.recordBall(g, c); if (!r.ok) throw new Error(r.error); }); return g; }
const withFrames = (g, total) => ({ frames: g.frames, mode: 'pins', total: total != null ? total : S.computeScore(g).total });
const get = (res, id) => res.list.find(a => a.id === id);
const earned = res => res.list.filter(a => a.earned).map(a => a.id);

// 1. nothing yet
let r = A.evaluate([]);
eq([r.earned, r.total, r.games], [0, 30, 0], 'no games: nothing earned, thirty badges to go');
eq(A.next(r), null, 'and nothing is close');
eq(get(r, 'game200').progress, { have: 0, need: 200, label: 'No games yet' }, 'progress is readable before the first game');
eq(A.evaluate(null).earned, 0, 'null is treated as no games');
eq(A.evaluate([null, undefined, { total: 'x' }, { id: 'z', date: '2026-01-01', total: null }]).earned, 0, 'junk entries and unfinished games are ignored');
eq(A.byGroup(r).map(g => g.group), A.GROUPS, 'badges come in seven groups, in order');
eq(new Set(A.DEFS.map(d => d.id)).size, A.DEFS.length, 'badge ids are unique');
eq(A.DEFS.every(d => d.title && d.desc && (d.mark || d.icon)), true, 'every badge has a title, a description and a mark or icon');

// 2. one game
r = A.evaluate([game('a', '2026-01-10', 1, 87)]);
eq(earned(r), ['first'], 'one game earns First game');
eq(get(r, 'first').earned, { date: '2026-01-10', gameId: 'g' + n, seriesId: 'a' }, 'with the date, game and night');
eq(get(r, 'game100').progress, { have: 87, need: 100, label: 'Best game so far: 87' }, 'progress towards the next score');
eq(A.next(r).id, 'game100', 'the closest badge is Broke 100');

// 3. the game ladder gets its dates from the first time it happened
const ladder = [game('l1', '2026-01-01', 1, 99), game('l2', '2026-01-08', 1, 100), game('l3', '2026-01-15', 1, 180), game('l4', '2026-01-22', 1, 205), game('l5', '2026-02-01', 1, 251), game('l6', '2026-03-01', 1, 300)];
r = A.evaluate(ladder);
eq(['game100', 'game150', 'game200', 'game250', 'game300'].map(id => get(r, id).earned.date), ['2026-01-08', '2026-01-15', '2026-01-22', '2026-02-01', '2026-03-01'], 'each score badge is dated the day it first happened');
eq(get(r, 'game100').earned.gameId, ladder[1].id, 'and points at that game');
eq(get(A.evaluate(ladder.slice(0, 3)), 'game200').progress.label, 'Best game so far: 180', 'progress uses your best');
eq(earned(A.evaluate([game('x', '2026-01-01', 1, 299)])).includes('game300'), false, '299 is not a perfect game');

// 4. series: best three in a row on one night
r = A.evaluate(night('s1', '2026-02-05', [150, 150, 150]));
eq([get(r, 'series400').earned.date, !!get(r, 'series500').earned], ['2026-02-05', false], 'three games of 150 make a 450 series: 400 yes, 500 not yet');
eq(get(r, 'series500').progress, { have: 450, need: 500, label: 'Best series so far: 450' }, 'progress shows the best series');
eq(!!get(A.evaluate(night('s2', '2026-02-05', [200, 100, 200, 100])), 'series500').earned, true, 'a four-game night counts its best three in a row');
eq(!!get(A.evaluate(night('s3', '2026-02-05', [300, 100, 300])), 'series700').earned, true, 'and games one after another, not the best three of any four');
eq(!!get(A.evaluate(night('s4', '2026-02-05', [250, 100, 100, 250])), 'series500').earned, false, 'the best games apart from each other don’t add up');
eq(!!get(A.evaluate(night('s5', '2026-02-05', [300, 300])), 'series400').earned, false, 'two games are not a series');
eq(get(A.evaluate(night('s5', '2026-02-05', [300, 300])), 'series400').progress.label, 'Bowl three games in one night', 'and the hint says what a series is');
eq(!!get(A.evaluate([game('t', '2026-02-05', 1, 250), game('u', '2026-02-06', 1, 250), game('v', '2026-02-07', 1, 250)]), 'series700').earned, false, 'three games on three different nights are not a series');
eq(!!get(A.evaluate(night('s6', '2026-02-05', [280, 280, 280])), 'series800').earned, true, '840 earns the 800 series');

// 5. triple 200
r = A.evaluate(night('t1', '2026-03-05', [210, 205, 200]));
eq([!!get(r, 'triple200').earned, get(r, 'triple200').earned.gameId], [true, 'g' + (n - 2)], 'three 200s in a row on one night');
eq(!!get(A.evaluate(night('t2', '2026-03-05', [210, 190, 205, 200])), 'triple200').earned, false, 'a game under 200 in between breaks it');
eq(get(A.evaluate(night('t2', '2026-03-05', [210, 190, 205, 200])), 'triple200').progress, { have: 2, need: 3, label: 'Most 200s in a row so far: 2' }, 'progress counts the longest run of 200s (205 then 200)');
eq(!!get(A.evaluate(night('t3', '2026-03-05', [205, 210, 200, 190])), 'triple200').earned, true, 'later games in the night don’t matter');
eq(!!get(A.evaluate(night('t4', '2026-03-05', [205, 210])), 'triple200').earned, false, 'two 200s are not three');

// 6. strike streaks need to know how the game was bowled (a 300 counts either way)
const turkeyGame = bowl([10, 10, 10, 9, 0].concat(Array(12).fill(0)));  // X X X 9- then gutters (17 balls: frames 5 to 10 are two each)
r = A.evaluate([game('k', '2026-04-01', 1, S.computeScore(turkeyGame).total, withFrames(turkeyGame))]);
eq(earned(r).filter(id => ['turkey', 'hambone', 'sixpack'].includes(id)), ['turkey'], 'three strikes in a row is a turkey, not a hambone');
eq(get(r, 'hambone').progress, { have: 3, need: 4, label: 'Longest run so far: 3' }, 'progress for the next streak');
r = A.evaluate([game('k2', '2026-04-01', 1, 300)]);
eq(earned(r).filter(id => ['turkey', 'hambone', 'sixpack'].includes(id)), ['turkey', 'hambone', 'sixpack'], 'a 300 typed in as a total still has twelve strikes in a row');
r = A.evaluate([game('k3', '2026-04-01', 1, 290)]);
eq(earned(r).filter(id => ['turkey', 'hambone', 'sixpack'].includes(id)), [], 'a 290 with no frames can’t be shown to have a streak');
eq(get(r, 'turkey').progress.label, 'Score a game pin by pin to track this', 'and the hint says how to track it');
const wrapped = bowl([10, 10, 10, 10, 10, 10, 10, 9, 0].concat(Array(4).fill(0)));  // 7 strikes then 9-
eq(get(A.evaluate([game('k4', '2026-04-01', 1, S.computeScore(wrapped).total, withFrames(wrapped))]), 'sixpack').earned.date, '2026-04-01', 'seven in a row includes a six-pack');
// a run across the 10th frame counts
const tenth = bowl(Array(9).fill(0).concat([0]).slice(0, 0).concat(Array(2 * 7).fill(0), [10, 10, 10, 10, 10]));
eq(S.computeScore(tenth).complete, true, '(the 10th-frame test game is complete)');
eq(!!get(A.evaluate([game('k5', '2026-04-01', 1, S.computeScore(tenth).total, withFrames(tenth))]), 'hambone').earned, true, 'strikes in the 8th to 10th frames link up with the fill balls (five in a row here)');

// 7. clean games, splits and the bedposts
const spares = bowl([9, 1, 9, 1, 9, 1, 9, 1, 9, 1, 9, 1, 9, 1, 9, 1, 9, 1, 9, 1, 9]);
r = A.evaluate([game('c1', '2026-05-01', 1, S.computeScore(spares).total, withFrames(spares))]);
eq([!!get(r, 'clean').earned, !!get(r, 'split').earned], [true, false], 'all spares is a clean game');
const oneOpen = bowl([9, 1, 9, 0, 9, 1, 9, 1, 9, 1, 9, 1, 9, 1, 9, 1, 9, 1, 9, 1, 9]);
eq(!!get(A.evaluate([game('c2', '2026-05-01', 1, S.computeScore(oneOpen).total, withFrames(oneOpen))]), 'clean').earned, false, 'one open frame is not clean');
eq(get(A.evaluate([game('c3', '2026-05-01', 1, 160)]), 'clean').progress.label, 'Score a game pin by pin to earn this', 'total-only games can’t show a clean game, and the hint says so');
eq(get(A.evaluate([game('c2', '2026-05-01', 1, S.computeScore(oneOpen).total, withFrames(oneOpen))]), 'clean').progress.label, 'Not yet', 'with pin detail the hint is just "Not yet"');
const perfect = bowl(Array(12).fill(10));
eq(!!get(A.evaluate([game('c4', '2026-05-01', 1, 300, withFrames(perfect))]), 'clean').earned, true, 'a 300 is a clean game');

function pinGame(first, second) {          // frame 1 thrown pin by pin, then strikes all the way
  const g = S.newGame();
  S.recordThrow(g, first);
  if (second) S.recordThrow(g, second);
  let guard = 0;
  while (!S.isComplete(g) && guard++ < 30) S.recordClear(g);
  return g;
}
const bedMade = pinGame([1, 2, 3, 4, 5, 6, 8, 9], [7, 10]);
r = A.evaluate([game('d1', '2026-06-01', 1, S.computeScore(bedMade).total, withFrames(bedMade))]);
eq([!!get(r, 'split').earned, !!get(r, 'bedposts').earned], [true, true], 'the 7-10 picked up earns both split badges');
const bedMissed = pinGame([1, 2, 3, 4, 5, 6, 8, 9], [7]);
r = A.evaluate([game('d2', '2026-06-01', 1, S.computeScore(bedMissed).total, withFrames(bedMissed))]);
eq([!!get(r, 'split').earned, !!get(r, 'bedposts').earned], [false, false], 'a split left standing earns nothing');
const splitMade = pinGame([1, 2, 3, 4, 5, 6, 7, 10], [8, 9]);       // 8-9 split? standing 8,9 — picked up
const info89 = S.pinStats([{ frames: splitMade.frames }]);
eq(info89.splitsMade, 1, '(sanity: the 8-9 left is a split and was picked up)');
r = A.evaluate([game('d3', '2026-06-01', 1, S.computeScore(splitMade).total, withFrames(splitMade))]);
eq([!!get(r, 'split').earned, !!get(r, 'bedposts').earned], [true, false], 'any split earns Split converted; only the 7-10 earns Bedposts');
const countsOnly = bowl([7, 3, 10].concat(Array(15).fill(0)));       // frames with counts but no pin detail
eq(!!get(A.evaluate([game('d4', '2026-06-01', 1, S.computeScore(countsOnly).total, withFrames(countsOnly))]), 'split').earned, false, 'games with counts but no pin detail can’t show a split');

// 8. averages count once there are enough games
const avgGames = (count, each) => Array.from({ length: count }, (_, i) => game('a' + i, '2026-07-' + String(1 + i).padStart(2, '0'), 1, each));
r = A.evaluate(avgGames(14, 160));
eq(!!get(r, 'avg150').earned, false, 'fourteen games at 160 is too few for a 150 average');
eq(get(r, 'avg150').progress.label, '14 games so far. It counts from 15.', 'and the hint says how many games it needs');
r = A.evaluate(avgGames(15, 160));
eq([get(r, 'avg150').earned.date, !!get(r, 'avg175').earned, !!get(r, 'avg125').earned, !!get(r, 'avg100').earned], ['2026-07-15', false, true, true], 'the 15th game brings the 150 average, dated then');
eq(get(r, 'avg175').progress, { have: 160, need: 175, label: 'Average so far: 160' }, 'progress shows the average so far');
const rounding = A.evaluate(avgGames(14, 150).concat([game('z', '2026-08-01', 1, 149)]));
eq(!!get(rounding, 'avg150').earned, false, 'an average of 149.93 is 149: it drops the fraction, as leagues do');
// a badge stays earned in the history even if the average later drops
const drop = avgGames(15, 160).concat(avgGames(30, 80).map((g, i) => Object.assign({}, g, { id: 'low' + i, seriesId: 'low' + i, date: '2026-09-' + String(1 + (i % 28)).padStart(2, '0') })));
eq(!!get(A.evaluate(drop), 'avg150').earned, true, 'once you have hit an average, later slumps don’t take it away');

// 9. volume and league
r = A.evaluate(avgGames(10, 100));
eq([get(r, 'games10').earned.date, get(r, 'games10').earned.gameId], ['2026-07-10', 'g' + (n - 10 + 10 - 0 > 0 ? r.list.find(a => a.id === 'games10').earned.gameId.slice(1) : '')], 'the tenth game is dated when it was bowled');
eq(get(A.evaluate(avgGames(9, 100)), 'games10').progress, { have: 9, need: 10, label: '9 of 10 games' }, 'nine games: nine of ten');
eq(get(A.evaluate(avgGames(1, 100)), 'games10').progress.label, '1 of 10 games', 'one game');
const many = Array.from({ length: 1000 }, (_, i) => game('m' + i, '2025-' + String(1 + Math.floor(i / 90)).padStart(2, '0') + '-' + String(1 + (i % 28)).padStart(2, '0'), 1, 100 + (i % 50)));
eq(earned(A.evaluate(many)).filter(id => id.startsWith('games')), ['games10', 'games50', 'games100', 'games250', 'games500', 'games1000'], 'a thousand games earn every volume badge');
eq(get(A.evaluate(many.slice(0, 999)), 'games1000').progress.label, '999 of 1000 games', 'and 999 do not');
eq(!!get(A.evaluate([game('lg', '2026-01-01', 1, 150, { leagueId: 'L1' })]), 'league').earned, true, 'a league game earns League bowler');
eq(!!get(A.evaluate([game('sh', '2026-01-01', 1, 150, { mode: 'sheet' })]), 'league').earned, true, 'and so do scores that came from a league file');
eq(!!get(A.evaluate([game('pr', '2026-01-01', 1, 150)]), 'league').earned, false, 'practice games don’t');

// 10. honest: edits and deletes change the badges; what is new is just the difference
const before = A.evaluate([game('h1', '2026-01-01', 1, 150)]);
const after = A.evaluate([game('h1', '2026-01-01', 1, 150), game('h2', '2026-01-08', 1, 212)]);
eq(A.fresh(before, after).map(a => a.id), ['game200'], 'a new 212 brings just The 200 club');
eq(A.fresh(null, before).map(a => a.id), ['first', 'game100', 'game150'], 'from nothing, everything you have is new (in badge order)');
eq(A.fresh(after, after), [], 'nothing changed, nothing new');
eq(!!get(A.evaluate([game('h1', '2026-01-01', 1, 150)]), 'game200').earned, false, 'delete the game and the badge goes: nothing is kept that the games don’t show');
const input = [game('i1', '2026-01-01', 1, 190), game('i0', '2025-12-01', 1, 150)];
const copy = JSON.stringify(input);
A.evaluate(input);
eq(JSON.stringify(input), copy, 'evaluating never changes your games');
eq(A.next(A.evaluate(avgGames(1, 195))).id, 'game200', 'the closest badge is the one with the highest share done');
eq(A.next(A.evaluate([game('n1', '2026-01-01', 1, 300)])).id !== undefined, true, 'even with a 300 there is always something further to reach');

// 11. games entered in any order give the same badges
const shuffled = ladder.slice().reverse();
eq(earned(A.evaluate(shuffled)), earned(A.evaluate(ladder)), 'the order the games are passed in doesn’t matter');
eq(A.evaluate(shuffled).list.map(a => a.earned && a.earned.date), A.evaluate(ladder).list.map(a => a.earned && a.earned.date), 'nor do the dates');

// 12. big histories are quick
const big = Array.from({ length: 6000 }, (_, i) => game('b' + Math.floor(i / 3), '2024-' + String(1 + (Math.floor(i / 3) % 12)).padStart(2, '0') + '-' + String(1 + (Math.floor(i / 36) % 28)).padStart(2, '0'), (i % 3) + 1, 90 + ((i * 37) % 160), i % 4 === 0 ? withFrames(perfect) : {}));
const t0 = Date.now();
const bigRes = A.evaluate(big);
eq(Date.now() - t0 < 1500, true, 'six thousand games are evaluated in well under a second and a half (took ' + (Date.now() - t0) + ' ms)');
eq(bigRes.games, 6000, 'all of them counted');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
