// Node tests for season numbers, consistency, insights and the ball page. Run: node test_insights.js
const S = require('../js/score.js');
const I = require('../js/insights.js');

let pass = 0, fail = 0;
function eq(actual, expected, name) {
  const ok = typeof expected === 'object' ? JSON.stringify(actual) === JSON.stringify(expected) : actual === expected;
  if (ok) pass++; else { fail++; console.log('FAIL', name, '- expected', JSON.stringify(expected), 'got', JSON.stringify(actual)); }
}
function frames(ballsPerFrame) {
  const g = S.newGame();
  ballsPerFrame.forEach(b => b.forEach(p => S.recordBall(g, p)));
  return g.frames;
}
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
// three-game nights, one a week
function nights(start, list, extra) {
  const out = [];
  list.forEach((t3, w) => t3.forEach((t, i) => out.push(Object.assign({ id: start + '-' + w + '-' + i, seriesId: start + '-' + w, gameNo: i + 1, date: addDays(start, 7 * w), total: t }, extra || {}))));
  return out;
}

// ---------- seasons ----------
eq(I.seasonOf('2026-07-31'), 2025, 'July belongs to the season that started last August');
eq(I.seasonOf('2026-08-01'), 2026, 'August 1 starts a new season');
eq(I.seasonLabel(2025), '2025–26', 'season label');

// ---------- consistency ----------
eq(Math.round(I.stdev([180, 200, 220])), 16, 'standard deviation');
eq(I.consistency([180, 200, 220, 180, 220]), { sd: 18, avg: 200, lo: 182, hi: 218 }, 'most games fall within one SD of the average');
eq(I.consistency([200, 210]), null, 'too few games for a consistency number');

// ---------- season summary ----------
{
  const last = nights('2025-09-01', [[170, 170, 170], [170, 170, 170], [170, 170, 170]]);
  const now = nights('2026-09-07', [[180, 190, 200], [185, 195, 205]]);
  const sum = I.seasonSummary(last.concat(now), '2026-09-28');
  eq([sum.label, sum.games, sum.avg, sum.high, sum.highSeries, sum.vsLast], ['2026–27 season', 6, 192, 205, 585, 22], 'this season, with the change on last season');
  eq(I.seasonSummary(last, '2026-09-28').label, 'All time', 'no games this season yet: all time');
}

// ---------- insights ----------
{
  // 10 steady games, then 10 better ones
  const older = nights('2026-08-03', [[170, 172, 168], [171, 169, 170], [170, 171, 169], [170]]);
  const newer = nights('2026-09-07', [[185, 190, 180], [188, 182, 186], [201, 184, 190], [210]]);
  const ins = I.insights(older.concat(newer), { today: '2026-09-28', max: 8 });
  const byId = Object.fromEntries(ins.map(x => [x.id, x.text]));
  eq(byId.trend, 'Your average is up 19 pins over your last 10 games (189, was 170).', 'trend over the last 10 games');
  eq(byId.twoHundreds, 'You’ve bowled 2 games of 200 or better this season.', '200 games this season');
  eq(byId.bestSeries, 'Your best 3-game series is 575 (Sep 21).', 'best series with its date');
  eq(byId.seasonHigh, '210 on Sep 28 is your best game this season.', 'new season high on the latest night');
  eq(I.insights([], {}).length, 0, 'no games, nothing to say');
}
{
  // corner pins and strike runs need frames
  const tenOpen = frames([[9, 0], [9, 1], [9, 0], [9, 0], [9, 1], [9, 0], [9, 0], [9, 1], [9, 0], [9, 0]]); // 10-pin leaves: 3 made of 10
  const run = frames([[10], [10], [10], [10], [10], [9, 1], [8, 1], [9, 0], [9, 0], [9, 0]]);
  const games = [
    { id: 'a', seriesId: 's1', gameNo: 1, date: '2026-09-01', total: S.computeScore({ frames: tenOpen }).total, frames: tenOpen },
    { id: 'b', seriesId: 's1', gameNo: 2, date: '2026-09-01', total: S.computeScore({ frames: run }).total, frames: run },
  ];
  // leaveAfter needs the pins, so give the 9-counts a 10-pin leave
  games[0].frames.forEach(f => { if (f.balls[0] === 9) f.pins[0] = [1, 2, 3, 4, 5, 6, 7, 8, 9]; });
  const att = I.pinAttempts(games, 10);
  eq([att.length, att.filter(x => x.made).length], [10, 3], '10-pin attempts counted from pin detail');
  const ins = I.insights(games, { today: '2026-09-28', max: 8 });
  eq(ins.find(x => x.id === 'pin10').text, 'You’ve converted 3 of your last 10 10-pin attempts.', 'corner-pin conversions');
  eq(ins.find(x => x.id === 'strikeRun').text, 'Longest strike run: 5 in a row (Sep 1).', 'longest strike run');
  eq(I.longestStrikeRun({ frames: frames(Array(9).fill([10]).concat([[10, 10, 10]])) }), 12, 'a 300 is 12 in a row');
}
{
  const lg = nights('2026-08-10', [[200, 205, 210], [200, 205, 210]], { leagueId: 'L' });
  const pr = nights('2026-08-11', [[180, 185, 190], [180, 185, 190]]);
  const ins = I.insights(lg.concat(pr), { today: '2026-09-28', max: 8 });
  eq(ins.find(x => x.id === 'leaguePractice').text, 'You average 20 more on league nights than in practice.', 'league nights vs practice');
}

// ---------- groups and the ball page ----------
{
  const g = [
    { id: '1', seriesId: 'a', gameNo: 1, date: '2026-09-01', total: 200, ballId: 'B', pattern: 'House shot', centerId: 'C1' },
    { id: '2', seriesId: 'a', gameNo: 2, date: '2026-09-01', total: 210, ballId: 'B', pattern: 'House shot', centerId: 'C1', leagueId: 'L' },
    { id: '3', seriesId: 'a', gameNo: 3, date: '2026-09-01', total: 190, ballId: 'B', pattern: 'House shot', centerId: 'C1', leagueId: 'L' },
    { id: '4', seriesId: 'b', gameNo: 1, date: '2026-09-08', total: 150, ballId: 'B', pattern: 'Sport shot', centerId: 'C2', leagueId: 'L' },
    { id: '5', seriesId: 'b', gameNo: 2, date: '2026-09-08', total: 160, ballId: 'B', pattern: 'Sport shot', centerId: 'C2', leagueId: 'L' },
    { id: '6', seriesId: 'b', gameNo: 3, date: '2026-09-08', total: 170, ballId: 'B', pattern: 'Sport shot', centerId: 'C2', leagueId: 'L' },
    { id: '7', seriesId: 'c', gameNo: 1, date: '2026-09-09', total: 250, ballId: 'Z' },
  ];
  const r = I.ballReport(g, 'B');
  eq([r.games, r.avg, r.high], [6, 180, 210], 'ball numbers use only that ball');
  eq([r.bestPattern.key, r.bestPattern.avg], ['House shot', 200], 'best oil pattern for the ball');
  eq([r.mostUsed.key, r.mostUsed.games], ['league:L', 5], 'where the ball is thrown most');
  eq(r.recent.map(x => x.id), ['6', '5', '4', '3', '2'], 'recent games newest first');
  eq(I.groupRows(g, x => x.pattern || null).map(x => [x.key, x.games, x.avg]), [['House shot', 3, 200], ['Sport shot', 3, 160]], 'by-pattern rows');
  eq(I.ballReport(g, 'nope').games, 0, 'unused ball');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
