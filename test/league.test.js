// Node unit tests for the BowlBoard league engine. Run: node test_league.js
const L = require('../js/league.js');

let pass = 0, fail = 0;
function eq(actual, expected, name) {
  const ok = typeof expected === 'object' ? JSON.stringify(actual) === JSON.stringify(expected) : actual === expected;
  if (ok) pass++;
  else { fail++; console.log('FAIL', name, '- expected', JSON.stringify(expected), 'got', JSON.stringify(actual)); }
}

function tiny() {
  // 2 teams x 2 bowlers, 3 games, 90% of 220, 1 pt/game + 1 series
  const lg = L.createLeague({ name: 'Test', startDate: '2026-09-01', seasonWeeks: 4, teamSize: 2, points: { perGame: 1, perSeries: 1 }, establishGames: 3 });
  lg.teams = [{ id: 'A', name: 'Aces' }, { id: 'B', name: 'Bees' }];
  lg.bowlers = [
    { id: 'a1', name: 'Ann', teamId: 'A', enteringAvg: 180, active: true },
    { id: 'a2', name: 'Al', teamId: 'A', enteringAvg: 150, active: true },
    { id: 'b1', name: 'Bo', teamId: 'B', enteringAvg: 200, active: true },
    { id: 'b2', name: 'Bea', teamId: 'B', enteringAvg: 120, active: true },
    { id: 's1', name: 'Sub Sue', teamId: '', enteringAvg: 170, active: true },
  ];
  lg.schedule = L.generateSchedule(lg);
  return lg;
}
const line = (teamId, bowlerId, games, absent) => ({ teamId, bowlerId, games, absent: !!absent });

// ---------- handicap & averages ----------
{
  const lg = tiny();
  eq(L.handicapFor(lg, 180), 36, '90% of (220-180) = 36');
  eq(L.handicapFor(lg, 185), 31, '90% of 35 = 31.5 -> truncated to 31');
  eq(L.handicapFor(lg, 230), 0, 'no negative handicap');
  lg.handicap.enabled = false;
  eq(L.handicapFor(lg, 150), 0, 'scratch league: no handicap');
}
{
  const lg = tiny();
  eq(L.averageBefore(lg, 'a1', 1).avg, 180, 'week 1 uses entering average');
  eq(L.averageBefore(lg, 'a1', 1).source, 'entering', 'source entering');
  lg.results[1] = { lines: [line('A', 'a1', [190, 191, 190])] };
  const a = L.averageBefore(lg, 'a1', 2);
  eq(a.avg, 190, 'running average truncated: 571/3 = 190.33 -> 190');
  eq(a.source, 'league', 'established after 3 games');
  lg.results[2] = { lines: [line('A', 'a1', [199, 200, 200])] };
  eq(L.averageBefore(lg, 'a1', 3).avg, 195, '1170/6 = 195');
  lg.results[2].lines[0].games = [200, 200, 199]; // 1170 still
  lg.results[2].lines[0].games = [200, 200, 200]; // 1171/6 = 195.17
  eq(L.averageBefore(lg, 'a1', 3).avg, 195, 'truncate, never round up');
}
{
  // 189.9 must be 189
  const lg = tiny();
  lg.establishGames = 1;
  lg.results[1] = { lines: [line('A', 'a1', [190, 190, 190]), line('A', 'a1', [190, 190, 190]), line('A', 'a1', [190, 190, 190]), line('A', 'a1', [189])] };
  // 10 games, 1899 pins -> 189.9
  eq(L.averageBefore(lg, 'a1', 2).avg, 189, '189.9 average is 189');
}
{
  // absent games don't count toward average
  const lg = tiny();
  lg.results[1] = { lines: [line('A', 'a1', [null, null, null], true)] };
  eq(L.averageBefore(lg, 'a1', 2).avg, 180, 'absent week keeps entering average');
  eq(L.gamesBefore(lg, 'a1', 2).length, 0, 'absent games not counted');
}
{
  // no entering average -> default until they bowl, then league avg immediately
  const lg = tiny();
  lg.bowlers.push({ id: 'n1', name: 'Newbie', teamId: 'A', enteringAvg: null, active: true });
  eq(L.averageBefore(lg, 'n1', 1).avg, 150, 'default average for new bowler');
  lg.results[1] = { lines: [line('A', 'n1', [120, 130, 141])] };
  eq(L.averageBefore(lg, 'n1', 2).avg, 130, 'new bowler uses own average after first night');
}

// ---------- scoring a week ----------
{
  const lg = tiny();
  lg.results[1] = { lines: [
    line('A', 'a1', [180, 180, 180]), line('A', 'a2', [150, 150, 150]),
    line('B', 'b1', [200, 200, 200]), line('B', 'b2', [120, 120, 150]),
  ] };
  // hcp: a1 36, a2 63, b1 18, b2 90
  const A = L.teamWeek(lg, 1, 'A'), B = L.teamWeek(lg, 1, 'B');
  eq(A.total, [429, 429, 429], 'team A hcp game totals');
  eq(B.total, [428, 428, 458], 'team B hcp game totals');
  eq(A.series, 990, 'team A scratch series');
  const m = lg.schedule[0].matchups[0];
  const r = L.matchupResult(lg, 1, m);
  const ptsA = m.a === 'A' ? r.ptsA : r.ptsB, ptsB = m.a === 'A' ? r.ptsB : r.ptsA;
  eq(ptsA, 2, 'A wins games 1 and 2');
  eq(ptsB, 2, 'B wins game 3 and total pins (1287 vs 1314)');
  const st = L.standings(lg, 1);
  eq(st.map(s => s.won), [2, 2], 'standings points');
  eq(st[0].name, 'Bees', 'tie on points broken by handicap pins');
  eq(st[0].lost, 2, 'points lost');
}
{
  // absent bowler: avg - 10 plus handicap
  const lg = tiny();
  const s = L.scoreLine(lg, 1, line('A', 'a1', [], true));
  eq(s.games, [170, 170, 170], 'absent = average - 10');
  eq(s.hcp, 36, 'absent still gets handicap');
  const v = L.scoreLine(lg, 1, line('A', L.VACANT, []));
  eq(v.games, [120, 120, 120], 'vacancy score');
  eq(v.hcp, 0, 'vacancy has no handicap');
}
{
  // incomplete team -> game points only where both sides are complete
  const lg = tiny();
  lg.results[1] = { lines: [
    line('A', 'a1', [180, 180, null]), line('A', 'a2', [150, 150, null]),
    line('B', 'b1', [100, 100, 100]), line('B', 'b2', [100, 100, 100]),
  ] };
  const m = lg.schedule[0].matchups[0];
  const r = L.matchupResult(lg, 1, m);
  eq(r.decided, false, 'series not decided while scores missing');
  eq(r.ptsA + r.ptsB, 2, 'only two games awarded');
}

{
  // half-entered matchup must not move standings (points or pins)
  const lg = tiny();
  lg.results[1] = { lines: [line('A', 'a1', [180, 180, 180]), line('A', 'a2', [150, 150, 150])] };
  const st = L.standings(lg, 1);
  eq(st.every(s => s.won === 0 && s.hcpPins === 0), true, 'partial matchup ignored in standings');
  const txt = L.recapText(lg, 1);
  eq(/scores incomplete/.test(txt), true, 'recap flags incomplete matchup');
}

// ---------- schedule ----------
{
  const lg = L.createLeague({ startDate: '2026-09-01', seasonWeeks: 10 });
  lg.teams = ['t1', 't2', 't3', 't4', 't5', 't6'].map(id => ({ id, name: id }));
  const sch = L.generateSchedule(lg);
  eq(sch.length, 10, 'schedule has seasonWeeks weeks');
  eq(sch[0].matchups.length, 3, '6 teams -> 3 matchups');
  eq(sch[1].date, '2026-09-08', 'weekly dates');
  // each pair meets exactly once in the first 5 weeks
  const seen = new Set();
  let dup = false;
  sch.slice(0, 5).forEach(w => w.matchups.forEach(m => { const k = [m.a, m.b].sort().join(); if (seen.has(k)) dup = true; seen.add(k); }));
  eq(dup, false, 'no repeat matchups within a round');
  eq(seen.size, 15, 'all 15 pairings in 5 weeks');
  // everybody bowls every week
  eq(sch.every(w => new Set(w.matchups.flatMap(m => [m.a, m.b])).size === 6), true, 'every team bowls weekly');
  eq(sch[0].matchups.map(m => m.lanes), ['1-2', '3-4', '5-6'], 'lane pairs');
}
{
  const lg = L.createLeague({ startDate: '2026-09-01', seasonWeeks: 5 });
  lg.teams = ['t1', 't2', 't3', 't4', 't5'].map(id => ({ id, name: id }));
  const sch = L.generateSchedule(lg);
  eq(sch[0].matchups.length, 2, '5 teams -> 2 matchups');
  eq(!!sch[0].bye, true, 'odd count -> bye');
  eq(new Set(sch.map(w => w.bye)).size, 5, 'each team gets one bye per round');
}

// ---------- highlights & recap ----------
{
  const lg = tiny();
  lg.results[1] = { lines: [
    line('A', 'a1', [210, 180, 215]), line('A', 'a2', [150, 150, 150]),
    line('B', 'b1', [300, 200, 205]), line('B', 'b2', [120, 120, 150]),
  ] };
  const h = L.weekHighlights(lg, 1);
  eq(h.scratchGame[0].name, 'Bo', 'high scratch game');
  eq(h.scratchGame[0].score, 300, 'high game score');
  eq(h.scratchSeries[0].score, 705, 'high series');
  eq(h.milestones.some(m => m.kind === 'perfect'), true, '300 milestone');
  eq(h.milestones.some(m => m.kind === 's700'), true, '700 series milestone');
  eq(h.milestones.filter(m => m.kind === 'first200' && m.name === 'Ann').length, 1, 'first 200 flagged once');
  lg.results[2] = { lines: [line('A', 'a1', [201, 100, 100])] };
  eq(L.weekHighlights(lg, 2).milestones.some(m => m.kind === 'first200'), false, 'second 200 is not a first');

  lg.bowlers[0].email = 'ann@example.com';
  lg.ccEmails = 'sec@example.com, bad-address';
  eq(L.recipients(lg), ['ann@example.com', 'sec@example.com'], 'recipients from roster + cc, invalid dropped');
  const txt = L.recapText(lg, 1, 'Test Lanes');
  eq(/WEEK 1 RECAP/.test(txt), true, 'text recap header');
  eq(/Bo bowled a 300/.test(txt), true, 'text recap milestone');
  const html = L.recapHTML(lg, 1, 'Test Lanes');
  eq(/<table/.test(html) && /Standings/.test(html), true, 'html recap has tables');
  eq(/<script/i.test(html), false, 'html recap has no script');
}
{
  // names are escaped in HTML recap
  const lg = tiny();
  lg.teams[0].name = '<b>Aces</b>';
  lg.results[1] = { lines: [line('A', 'a1', [150, 150, 150])] };
  eq(L.recapHTML(lg, 1).includes('<b>Aces</b>'), false, 'team names escaped');
}

// ---------- CSV ----------
{
  const r = L.rosterFromCSV('Team,Bowler,Email,Average\nAces,"Smith, Jo",jo@x.com,172\nSub,Pat,,160\n');
  eq(r.ok, true, 'roster CSV parses');
  eq(r.rows[0].name, 'Smith, Jo', 'quoted comma kept');
  eq(r.rows[0].avg, 172, 'average parsed');
  const lg = tiny();
  const res = L.applyRoster(lg, r.rows);
  eq(res.bowlers, 2, 'two bowlers added');
  eq(lg.bowlers.find(b => b.name === 'Pat').teamId, '', 'Sub team -> sub list');
  eq(lg.bowlers.find(b => b.name === 'Smith, Jo').teamId, 'A', 'matched existing team by name');
  eq(L.applyRoster(lg, r.rows).skipped, 2, 'duplicates skipped');
  const noHead = L.rosterFromCSV('Kings,Ed,,190');
  eq(noHead.rows[0].team + '|' + noHead.rows[0].name + '|' + noHead.rows[0].avg, 'Kings|Ed|190', 'headerless CSV');
  eq(L.parseCSV('a,b\n"x ""y""",z')[1][0], 'x "y"', 'escaped quotes');
}
{
  const lg = tiny();
  lg.results[1] = { lines: [line('A', 'a1', [150, 160, 170])] };
  const csv = L.weekScoresCSV(lg, 1);
  eq(csv.split('\n')[0].startsWith('Week,Date,Team,Bowler'), true, 'week CSV header');
  eq(/Ann,bowled,180,36,150,160,170,480,588/.test(csv), true, 'week CSV row');
}

// ---------- demo league ----------
{
  const lg = L.buildDemoLeague({ today: '2026-09-27' });
  eq(lg.teams.length, 6, 'demo teams');
  eq(L.lastScoredWeek(lg), 4, 'demo has 4 weeks bowled');
  eq(L.currentWeek(lg), 5, 'current week is next one');
  const st = L.standings(lg, 4);
  const total = st.reduce((a, s) => a + s.won + s.lost, 0);
  eq(total, 6 * 4 * L.pointsPerNight(lg), 'every point accounted for');
  eq(st.reduce((a, s) => a + s.won, 0), 3 * 4 * L.pointsPerNight(lg), 'points won = points available');
}

// ---------- review minimum set ----------
{
  const lg = tiny();
  lg.results[1] = { lines: [line('A', 'a1', [200, 189, 190])] };
  eq(L.averageBefore(lg, 'a1', 2).avg, 193, '200+189+190 = 579 / 3 = 193');
  lg.results[1] = { lines: [line('A', 'a1', [200, 189, 191])] };
  eq(L.averageBefore(lg, 'a1', 2).avg, 193, '580 / 3 = 193.33 -> 193, not 194');
  lg.establishGames = 6;
  eq(L.averageBefore(lg, 'a1', 2).avg, 180, 'entering average holds until establishGames');
}
{
  // 2 pts per game + 2 for series, ties split in half
  const lg = tiny();
  lg.handicap.enabled = false;
  lg.points = { perGame: 2, perSeries: 2 };
  lg.results[1] = { lines: [
    line('A', 'a1', [200, 150, 180]), line('A', 'a2', [100, 150, 120]),
    line('B', 'b1', [150, 150, 150]), line('B', 'b2', [140, 150, 160]),
  ] };
  const m = lg.schedule[0].matchups[0];
  const r = L.matchupResult(lg, 1, m);
  const [pa, pb] = m.a === 'A' ? [r.ptsA, r.ptsB] : [r.ptsB, r.ptsA];
  // G1 300-290 A, G2 300-300 tie, G3 300-310 B, series 900-900 tie
  eq(pa, 2 + 1 + 0 + 1, 'A: win + half + loss + half series = 4');
  eq(pb, 0 + 1 + 2 + 1, 'B: 4');
  eq(L.pointsPerNight(lg), 8, '2+2 league = 8 points a night');
  eq(/8 a night/.test(L.pointsLine(lg)), true, 'points line explains the system');
}
{
  // 5 teams: one bye a week, every team gets one per round; lanes rotate
  const lg = L.createLeague({ startDate: '2026-09-01', seasonWeeks: 10 });
  lg.teams = ['t1', 't2', 't3', 't4', 't5'].map(id => ({ id, name: id }));
  const sch = L.generateSchedule(lg);
  eq(sch.every(w => !!w.bye && w.matchups.length === 2), true, 'every week: 2 matchups + 1 bye');
  eq(sch[0].matchups[0].lanes !== sch[1].matchups[0].lanes || sch[0].matchups[0].a !== sch[1].matchups[0].a, true, 'lane pairs shift week to week');
  const t1Lanes = new Set(sch.slice(0, 4).map(w => (w.matchups.find(m => m.a === 't1' || m.b === 't1') || {}).lanes).filter(Boolean));
  eq(t1Lanes.size > 1, true, 'a team doesn’t sit on the same pair all season');
}

// ---------- handicap rounding setting ----------
{
  const lg = tiny(); // 90% of 220
  eq(L.handicapFor(lg, 185), 31, 'floor: 31.5 -> 31');
  lg.handicap.rounding = 'round';
  eq(L.handicapFor(lg, 185), 32, 'round: 31.5 -> 32');
  eq(L.handicapFor(lg, 186), 31, 'rounds to the nearest: (220-186)*.9 = 30.6 -> 31');
  lg.handicap.rounding = 'even';
  eq(L.handicapFor(lg, 185), 32, 'even: 31.5 -> 32 (32 is even)');
  eq(L.handicapFor(lg, 175), 40, 'even: 40.5 -> 40');
  lg.handicap = { enabled: true, basis: 210, pct: 80, rounding: 'floor' };
  eq(L.handicapFor(lg, 150), 48, '80% of 210: (60)*.8 = 48');
}

// ---------- bye points setting ----------
{
  const lg = L.createLeague({ startDate: '2026-09-01', seasonWeeks: 3, teamSize: 1, points: { perGame: 1, perSeries: 1 }, handicap: { enabled: false, basis: 220, pct: 90 } });
  lg.teams = ['A', 'B', 'C'].map(id => ({ id, name: id }));
  lg.bowlers = ['A', 'B', 'C'].map(t => ({ id: 'b' + t, name: 'B' + t, teamId: t, enteringAvg: 150, active: true }));
  lg.schedule = L.generateSchedule(lg);
  const w1 = lg.schedule[0];
  lg.results[1] = { lines: w1.matchups.flatMap(m => [line(m.a, 'b' + m.a, [150, 150, 150]), line(m.b, 'b' + m.b, [140, 140, 140])]) };
  const byeTeam = w1.bye;
  const won = () => L.standings(lg, 1).find(s => s.teamId === byeTeam).won;
  eq(won(), 0, 'bye: none (default) -> 0 pts');
  lg.byePoints = 'half';
  eq(won(), 2, 'bye: half of 4 = 2');
  lg.byePoints = 'full';
  eq(won(), 4, 'bye: full = 4');
  eq(/Bye: .* \(\+4 pts\)/.test(L.recapText(lg, 1)), true, 'recap shows bye points');
}

// ---------- column labels ----------
{
  const lg = tiny();
  lg.results[1] = { lines: [line('A', 'a1', [150, 150, 150]), line('A', 'a2', [150, 150, 150]), line('B', 'b1', [150, 150, 150]), line('B', 'b2', [150, 150, 150])] };
  const html = L.recapHTML(lg, 1);
  eq(/Pts won/.test(html) && /Pts lost/.test(html) && !/>Won</.test(html), true, 'recap standings say points, not wins');
  eq(/ pts<\/td>/.test(html), true, 'matchup result labelled pts');
}

// ---------- personal <-> league link ----------
{
  const lg = tiny();
  eq(L.pushMyGames(lg, 1, [{ gameId: 'g1', total: 200 }]).ok, false, 'push without "me" fails with guidance');
  lg.bowlers.find(b => b.id === 'a2').isMe = true;
  eq(L.weekForDate(lg, '2026-09-08'), 2, 'week for a league-night date');
  eq(L.weekForDate(lg, '2026-09-10'), 2, 'within 3 days still matches');
  eq(L.weekForDate(lg, '2026-12-25'), null, 'far-off date: no week');
  const r = L.pushMyGames(lg, 1, [{ gameId: 'g1', total: 201 }, { gameId: 'g2', total: 178 }, { gameId: 'g3', total: 190 }]);
  eq(r.ok && r.teamId === 'A', true, 'pushed to my team');
  const myLine = lg.results[1].lines.find(l => l.bowlerId === 'a2');
  eq(myLine.games, [201, 178, 190], 'sheet has my games');
  eq(myLine.links, ['g1', 'g2', 'g3'], 'sheet slots linked to my log');
  eq(lg.results[1].lines.filter(l => l.teamId === 'A').length, 2, 'team lineup materialised once');
  // edit in my log -> sync to sheet
  const log = { g1: { total: 211 }, g2: { total: 178 } }; // g3 deleted
  eq(L.syncLinks(lg, log), true, 'sync reports a change');
  eq(myLine.games, [211, 178, 190], 'edited total flows to sheet; deleted game keeps the sheet score');
  eq(myLine.links, ['g1', 'g2', null], 'link to deleted game dropped');
  eq(L.findLink(lg, 'g2').week + '/' + L.findLink(lg, 'g2').game, '1/2', 'findLink locates game 2 of week 1');
  // secretary overrides -> unlink
  L.unlinkGame(myLine, 0);
  myLine.games[0] = 209;
  L.syncLinks(lg, log);
  eq(myLine.games[0], 209, 'secretary override stands after unlink');
  // sheet-only games show up for the personal log
  const sheet = L.sheetOnlyGames(lg);
  eq(sheet.map(g => g.total), [209, 190], 'unlinked league scores are exposed to the personal log');
  eq(sheet[0].date, '2026-09-01', 'with the league night date');
}
{
  const lg = tiny();
  lg.bowlers.find(b => b.id === 's1').isMe = true;
  eq(/sub/.test(L.pushMyGames(lg, 1, [{ gameId: 'x', total: 150 }]).error), true, 'sub gets told to ask the secretary');
  lg.bowlers.find(b => b.id === 's1').isMe = false;
  lg.bowlers.push({ id: 'a3', name: 'Extra', teamId: 'A', enteringAvg: 150, active: true, isMe: true });
  eq(/full/.test(L.pushMyGames(lg, 1, [{ gameId: 'x', total: 150 }]).error), true, 'full lineup: no silent overwrite');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
