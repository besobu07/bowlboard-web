// Node tests for importing your own scores from a CSV / spreadsheet. Run: node test_games_import.js
const G = require('../js/games-import.js');
const LG = require('../js/league.js');
let pass = 0, fail = 0;
function eq(actual, expected, name) {
  const ok = typeof expected === 'object' ? JSON.stringify(actual) === JSON.stringify(expected) : actual === expected;
  if (ok) pass++; else { fail++; console.log('FAIL', name, '- expected', JSON.stringify(expected), 'got', JSON.stringify(actual)); }
}
const ctx = (extra) => Object.assign({ centers: [], balls: [], existing: [] }, extra || {});
const run = (table, extra, opts) => { const a = G.analyze(table, opts); return { a, p: G.plan(table, a.map, { hasHeader: a.hasHeader, order: a.order }, ctx(extra)) }; };

// 1. dates in the shapes spreadsheets and other apps use
eq(G.parseDate('2026-09-05'), '2026-09-05', 'ISO date');
eq(G.parseDate('2026-09-05T18:30:00'), '2026-09-05', 'ISO with a time');
eq(G.parseDate('9/5/2026', 'mdy'), '2026-09-05', 'US month/day/year');
eq(G.parseDate('9/5/2026', 'dmy'), '2026-05-09', 'day/month/year when asked');
eq(G.parseDate('13/5/2026', 'mdy'), '', 'month 13 is not a date');
eq(G.parseDate('9/5/26'), '2026-09-05', 'two-digit year');
eq(G.parseDate('9/5/85'), '1985-09-05', 'two-digit year 85 is 1985');
eq(G.parseDate('05.09.2026', 'dmy'), '2026-09-05', 'dotted day.month.year');
eq(G.parseDate('Sep 22, 2026'), '2026-09-22', 'month name, day, year');
eq(G.parseDate('September 22nd 2026'), '2026-09-22', 'long month with ordinal');
eq(G.parseDate('Tue, Sep 22, 2026'), '2026-09-22', 'weekday first');
eq(G.parseDate('22 Sep 2026'), '2026-09-22', 'day, month name, year');
eq(G.parseDate('22-Sep-26'), '2026-09-22', 'dashed day-month-year');
eq(G.parseDate('20260922'), '2026-09-22', 'compact');
eq(G.parseDate(46266), '2026-09-01', 'an Excel date number');
eq(G.parseDate(201), '', 'a small number is not an Excel date');
eq(G.parseDate('2026-02-31'), '', 'February 31st is not a date');
eq(G.parseDate('Foo 22, 2026'), '', 'not a month');
eq(G.parseDate(''), '', 'empty');
eq(G.detectOrder(['13/05/2026', '01/02/2026']), { order: 'dmy', ambiguous: false }, 'a 13 in the first place settles day-first');
eq(G.detectOrder(['05/13/2026', '01/02/2026']), { order: 'mdy', ambiguous: false }, 'a 13 in the second place settles month-first');
eq(G.detectOrder(['01/02/2026', '03/04/2026']), { order: 'mdy', ambiguous: true }, 'all-small dates are ambiguous, US by default');
eq(G.detectOrder(['2026-01-02']), { order: 'mdy', ambiguous: false }, 'ISO dates are never ambiguous');

// 2. scores
eq(G.parseScore(201), { n: 201 }, 'number');
eq(G.parseScore(' 201 '), { n: 201 }, 'padded text');
eq(G.parseScore('201.0'), { n: 201 }, 'a number that went through a spreadsheet');
eq(G.parseScore(''), { blank: true }, 'empty is blank');
eq(G.parseScore('-'), { blank: true }, 'a dash is blank');
eq(G.parseScore('absent'), { blank: true }, 'absent is blank');
eq(G.parseScore('abc'), { bad: 'abc' }, 'text is not a score');
eq(G.parseScore(187.5), { bad: '187.5' }, 'a fraction is not a score');

// 3. which column is which
let a = G.analyze([['Date', 'Game 1', 'Game 2', 'Game 3', 'Series', 'Avg', 'Center', 'Ball', 'Lane', 'Oil Pattern'], ['9/1/2026', 201, 178, 190, 569, 189, 'Home Lanes', 'Storm Phaze II', '15-16', 'House shot']]);
eq([a.ok, a.hasHeader, a.layout], [true, true, 'wide'], 'one row per night: wide');
eq(a.map, { date: 0, scores: [1, 2, 3], center: 6, ball: 7, lane: 8, pattern: 9, gameNo: -1 }, 'Series and Avg are not score columns; the rest are found by name');
a = G.analyze([['Date', 'Score'], ['9/1/2026', 201], ['9/1/2026', 178]]);
eq([a.layout, a.map.date, a.map.scores], ['long', 0, [1]], 'one game per row');
a = G.analyze([['Date', 'Game', 'Score'], ['9/1/2026', 1, 201], ['9/1/2026', 2, 178]]);
eq([a.map.gameNo, a.map.scores], [1, [2]], '"Game" on its own is the game number');
a = G.analyze([['Date', 'G1', 'G2'], ['9/1/2026', 201, 178]]);
eq(a.map.scores, [1, 2], 'G1, G2 columns');
a = G.analyze([['Date', 'Game 3', 'Game 1', 'Game 2'], ['9/1/2026', 190, 201, 178]]);
eq(a.map.scores, [2, 3, 1], 'game columns are read in game order');
a = G.analyze([['9/1/2026', 201, 178, 190], ['9/8/2026', 165, 188, 212]]);
eq([a.hasHeader, a.map.date, a.map.scores], [false, 0, [1, 2, 3]], 'no header row: the dates and the 0-300 columns are found by their contents');
a = G.analyze([['Day', 'Date', 'Score'], ['Tuesday', '9/1/2026', 201]]);
eq([a.map.date, a.map.scores], [1, [2]], 'a weekday column called Day is not the date');
a = G.analyze([['Date', 'Score'], ['Sept', 201], ['Oct', 178]]);
eq(a.map.date, -1, 'a column named Date that has no dates is not used');
a = G.analyze([['Date', 'Score'], ['9/1/2026', 201]], { hasHeader: false });
eq([a.hasHeader, a.names[0]], [false, 'Column A'], 'the header guess can be overridden');
eq(G.analyze([]).ok, false, 'an empty file is refused');
eq(G.analyze([[], ['', '']]).ok, false, 'a file of blanks is refused');
a = G.analyze(LG.parseCSV('Date;Game 1;Game 2\n01.09.2026;201;178\n08.09.2026;165;188\n'));
eq([a.map.date, a.map.scores, a.order], [0, [1, 2], 'dmy'], 'a semicolon file (Europe) reads, and 08.09.2026-style dates lean on any date like 13.09');
a = G.analyze(LG.parseCSV('Date;Game 1\n13.09.2026;201\n01.09.2026;178\n'));
eq(a.order, 'dmy', 'a 13 in the first place makes it day-first');

// 4. what would be imported: one row per night
let { p } = run([['Date', 'Game 1', 'Game 2', 'Game 3', 'Center'], ['9/1/2026', 201, 178, 190, 'Home Lanes'], ['9/8/2026', 165, '', 212, 'Home Lanes'], ['', 100, 100, 100, ''], ['9/15/2026', 350, 150, '', 'Parkside']]);
eq([p.ok, p.toImport, p.nights, p.duplicates], [true, 6, 3, 0], 'wide: 3 + 2 + 1 games on 3 nights');
eq(p.dates, { first: '2026-09-01', last: '2026-09-15' }, 'first and last night');
eq(p.skipped.map(s => s.row + ':' + s.reason), ['4:No date', '5:A score of 350 isn’t possible (300 is perfect)'], 'rows that can’t be used say why (row numbers as the spreadsheet shows them)');
eq([p.big, p.skippedRows], [1, 2], 'one score over 300, two rows skipped');
eq(p.newCenters, ['Home Lanes', 'Parkside'], 'unknown centers are listed once each');
eq(p.rows.filter(g => g.date === '2026-09-08').map(g => g.gameNo), [1, 2], 'a blank game is left out and the rest renumber');
const g2 = G.toGames(p, { uid: (() => { let n = 0; return () => 'id' + (++n); })(), batch: 'B', centerIdFor: n => 'c-' + n });
eq(g2.length, 6, 'games built');
eq(g2[0], { id: 'id2', date: '2026-09-01', centerId: 'c-Home Lanes', ballId: '', lanes: [], pattern: '', leagueId: '', seriesId: 'id1', gameNo: 1, mode: 'total', total: 201, imported: 'B' }, 'a game record');
eq(new Set(g2.filter(g => g.date === '2026-09-01').map(g => g.seriesId)).size, 1, 'a night’s games share one series');

// 5. one game per row: same night, same place is one series; Game # sets the order
({ p } = run([['Date', 'Game', 'Score'], ['9/1/2026', 2, 178], ['9/1/2026', 1, 201], ['9/1/2026', 3, 190], ['9/8/2026', 1, 165]]));
eq([p.toImport, p.nights], [4, 2], 'long: 4 games on 2 nights');
eq(p.rows.filter(g => g.date === '2026-09-01').sort((x, y) => x.gameNo - y.gameNo).map(g => g.total), [201, 178, 190], 'the Game column puts games in order');
({ p } = run([['Date', 'Score', 'Center'], ['9/1/2026', 201, 'A'], ['9/1/2026', 178, 'B'], ['9/1/2026', 190, 'A']]));
eq(p.nights, 2, 'same date at two places is two nights');
({ p } = run([['Date', 'Score'], ['9/1/2026', 201], ['9/1/2026', 178]]));
eq(p.rows.map(g => g.gameNo), [1, 2], 'without a Game column, file order');

// 6. duplicates: matched one for one, so a re-import adds nothing
const table = [['Date', 'Game 1', 'Game 2', 'Game 3'], ['9/1/2026', 180, 180, 190]];
({ p } = run(table, { existing: [{ date: '2026-09-01', total: 180 }] }));
eq([p.toImport, p.duplicates], [2, 1], 'one 180 on that night is in the log: the other 180 and the 190 are new');
({ p } = run(table, { existing: [{ date: '2026-09-01', total: 180 }, { date: '2026-09-01', total: 180 }, { date: '2026-09-01', total: 190 }] }));
eq([p.toImport, p.duplicates, p.nights], [0, 3, 0], 'everything there already: nothing to import');
({ p } = run(table, { existing: [{ date: '2026-09-02', total: 180 }] }));
eq(p.duplicates, 0, 'same score on another date is not a duplicate');
({ p } = run(table, { existing: [{ date: '2026-09-01', total: 190 }] }));
eq(p.rows.filter(g => !g.dup).map(g => g.gameNo), [1, 2], 'games left after skipping duplicates renumber within the night');
({ p } = run(table));
const first = G.toGames(p, {});
({ p } = run(table, { existing: first.map(g => ({ date: g.date, total: g.total })) }));
eq(p.toImport, 0, 'importing the same file twice adds nothing the second time');

// 7. matching what you already have, and what's new
({ p } = run([['Date', 'Score', 'Center', 'Ball', 'Lane', 'Oil'], ['9/1/2026', 201, 'home lanes', 'storm phaze ii', '15-16', 'House shot'], ['9/8/2026', 190, 'Parkside', 'Mystery Ball', 15, '']],
  { centers: [{ id: 'c1', name: 'Home Lanes' }], balls: [{ id: 'b1', brand: 'Storm', name: 'Phaze II' }, { id: 'b2', brand: 'Hammer', name: 'Black Widow' }] }));
eq([p.rows[0].centerId, p.rows[0].ballId, p.rows[0].lanes, p.rows[0].pattern], ['c1', 'b1', [15, 16], 'House shot'], 'center and ball matched by name, ignoring case; lanes and pattern read');
eq([p.rows[1].centerId, p.rows[1].ballId, p.rows[1].lanes], ['', '', [15]], 'unknown center and ball are left for the screen to handle; a lane number');
eq([p.newCenters, p.unmatchedBalls], [['Parkside'], ['Mystery Ball']], 'new centers and unmatched balls are listed');
({ p } = run([['Date', 'Score', 'Ball'], ['9/1/2026', 201, 'Phaze II']], { balls: [{ id: 'b1', brand: 'Storm', name: 'Phaze II' }] }));
eq(p.rows[0].ballId, 'b1', 'a ball can be matched by name alone');

// 8. day first, and bad columns
const dm = [['Date', 'Score'], ['4/5/2026', 201]];
eq(G.plan(dm, G.analyze(dm).map, { hasHeader: true, order: 'dmy' }, ctx()).rows[0].date, '2026-05-04', 'day-first reading');
eq(G.plan(dm, G.analyze(dm).map, { hasHeader: true, order: 'mdy' }, ctx()).rows[0].date, '2026-04-05', 'month-first reading');
eq(G.plan(dm, { date: -1, scores: [1] }, {}, ctx()).ok, false, 'no date column: refused with a message');
eq(G.plan(dm, { date: 0, scores: [] }, {}, ctx()).error, 'Choose the column that holds the scores.', 'no score column: asks for one');
eq(G.plan([['Date', 'Score']], { date: 0, scores: [1] }, {}, ctx()).toImport, 0, 'a file with only headers has nothing to import');
({ p } = run([['Date', 'Score'], ['9/1/2026', 'abc'], ['9/1/2026', ''], ['9/2/2026', '201']]));
eq([p.toImport, p.skipped.map(s => s.reason)], [1, ['“abc” isn’t a score']], 'text in a score column is skipped with a reason; a dated row with no score at all is just left out');
({ p } = run([['Date', 'Score'], ['9/1/2026', 201], ['', ''], [], ['9/2/2026', 178]]));
eq(p.rows.map(g => g.row), [2, 5], 'blank rows are ignored and the row numbers still match the sheet');

// 9. the template reads back
const tpl = G.analyze(LG.parseCSV(G.template()));
eq([tpl.layout, tpl.map.scores, tpl.map.center, tpl.map.lane, tpl.map.pattern], ['wide', [1, 2, 3], 4, 6, 7], 'the template is understood as it is');
eq(G.plan(LG.parseCSV(G.template()), tpl.map, { hasHeader: tpl.hasHeader, order: tpl.order }, ctx()).toImport, 6, 'and gives six games');

// 10. a real-looking export from a spreadsheet, end to end
const csv = '﻿Date,Game 1,Game 2,Game 3,Series,Average,Location\r\n9/1/2026,201,178,190,569,189,"Lisle Lanes"\r\n9/8/2026,165,188,212,565,188,"Lisle Lanes"\r\n9/15/2026,,,,,,\r\n';
const t = LG.parseCSV(csv);
({ p } = run(t));
eq([p.toImport, p.nights, p.newCenters, p.skipped.map(s => s.reason)], [6, 2, ['Lisle Lanes'], []], 'a spreadsheet CSV with a BOM, quotes and a blank night');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
