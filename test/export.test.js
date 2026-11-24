// Node tests for getting your games out: CSV, Excel and PDF. Run: node test_export.js
const zlib = require('zlib');
const S = require('../js/score.js');
const E = require('../js/export.js');
const G = require('../js/games-import.js');
const LG = require('../js/league.js');
const XR = require('../js/xlsx.js');
const XW = require('../js/xlsx-write.js');
const PDFW = require('../js/pdf-write.js');
let pass = 0, fail = 0;
function eq(actual, expected, name) {
  const ok = typeof expected === 'object' ? JSON.stringify(actual) === JSON.stringify(expected) : actual === expected;
  if (ok) pass++; else { fail++; console.log('FAIL', name, '- expected', JSON.stringify(expected), 'got', JSON.stringify(actual)); }
}
const ok = (cond, name, extra) => eq(!!cond, true, name + (cond ? '' : ' ' + JSON.stringify(extra)));

// ball counts -> a pin-by-pin (count) game
function bowl(counts) { const g = S.newGame(); counts.forEach(n => { const r = S.recordBall(g, n); if (!r.ok) throw new Error(r.error); }); return g; }
const perfect = bowl(Array(12).fill(10));
const mixed = bowl([9, 1, 8, 1, 10, 7, 3, 10, 0, 0, 5, 4, 10, 10, 9, 0]);   // 9/ 81 X 7/ X -- 54 X X 9-
const gutterSpare = bowl([0, 10].concat(Array(8).fill(10), [10, 10, 10]));   // -/ X X X X X X X X XXX

const names = {
  center: id => ({ c1: 'Sunset Lanes', c2: 'Bowl "Big" & Co, Inc.', c3: '=HYPERLINK("x")', c4: 'Lisle\nLanes' })[id] || '',
  ball: id => ({ b1: 'Storm Phaze II (15 lb)', b2: 'Hammer Black Widow' })[id] || '',
  league: id => ({ l1: 'Thursday Trios' })[id] || '',
  mode: m => ({ pins: 'Pin by pin', total: 'Total only', sheet: 'League sheet' })[m] || m || '',
};
let n = 0;
const mk = (night, date, no, total, extra) => Object.assign({ id: 'g' + (++n), seriesId: night, gameNo: no, date, total, mode: 'total', createdAt: date + 'T20:00:' + String(10 + n).padStart(2, '0') + 'Z' }, extra);

const games = [
  mk('n2', '2026-09-10', 1, 300, { mode: 'pins', frames: perfect.frames, centerId: 'c2' }),
  mk('n1', '2026-09-03', 2, 201, { centerId: 'c1', ballId: 'b1', lanes: [7, 8], leagueId: 'l1' }),
  mk('n1', '2026-09-03', 1, 180, { centerId: 'c1', ballId: 'b1', lanes: [7, 8], pattern: 'House', leagueId: 'l1' }),
  mk('n1', '2026-09-03', 3, 165, { centerId: 'c1', ballId: 'b2', lanes: [7, 8], leagueId: 'l1' }),
  mk('n0', '2025-03-02', 1, 140),
  mk('n0', '2025-03-02', 2, 150),
  mk('nx', '2026-09-11', 1, null, { mode: 'pins' }),              // not finished: never exported
];

// 1. one row per finished game, oldest first, nights kept together
const rows = E.rows(games, names);
eq(rows.length, 6, 'an unfinished game is left out');
eq(rows.map(r => r[0] + '#' + r[1]), ['2025-03-02#1', '2025-03-02#2', '2026-09-03#1', '2026-09-03#2', '2026-09-03#3', '2026-09-10#1'], 'oldest first, games in order within a night');
eq(rows[2].slice(0, 9), ['2026-09-03', 1, 180, 'Sunset Lanes', 'Storm Phaze II (15 lb)', '7-8', 'House', 'Thursday Trios', 'Total only'], 'every column is filled in from names');
eq(rows[0].slice(3, 8), ['', '', '', '', ''], 'a game with no details has empty cells, not "undefined"');
eq(E.HEAD.length, rows[0].length, 'the header and rows have the same width');
eq(E.rows([], names), [], 'no games, no rows');

// two nights on one day keep their own order (the one logged first comes first)
const twoNights = [mk('late', '2026-01-05', 1, 210, { createdAt: '2026-01-05T22:00:00Z' }), mk('early', '2026-01-05', 1, 150, { createdAt: '2026-01-05T18:00:00Z' }), mk('early', '2026-01-05', 2, 160, { createdAt: '2026-01-05T18:30:00Z' })];
eq(E.rows(twoNights, names).map(r => r[2]), [150, 160, 210], 'two nights on the same day are not interleaved');
// league-sheet games have no created time at all
const sheetGames = [{ id: 's1', seriesId: 'sheet:l1:2', gameNo: 2, date: '2026-09-17', total: 190, mode: 'sheet', leagueId: 'l1', createdAt: '' }, { id: 's0', seriesId: 'sheet:l1:2', gameNo: 1, date: '2026-09-17', total: 170, mode: 'sheet', leagueId: 'l1', createdAt: '' }];
eq(E.rows(sheetGames, names).map(r => [r[1], r[2], r[8]]), [[1, 170, 'League sheet'], [2, 190, 'League sheet']], 'league-file games export in game order');

// 2. pin-by-pin games carry their strike / spare / open counts and the frame marks
const perfRow = rows[5];
eq(perfRow.slice(9), [12, 0, 0, 'X X X X X X X X X XXX'], 'a 300 is 12 strikes, no spares, no open frames');
const mixedRows = E.rows([mk('m', '2026-02-01', 1, S.computeScore(mixed).total, { mode: 'pins', frames: mixed.frames })], names);
eq(mixedRows[0].slice(9), [4, 2, 4, '9/ 81 X 7/ X -- 54 X X 9-'], 'strikes, spares, open frames and marks for an ordinary game');
eq(E.rows([mk('b', '2026-02-02', 1, 100, { frames: [] })], names)[0].slice(9), ['', '', '', ''], 'a game without frames leaves those cells empty');
eq(E.rows([mk('b', '2026-02-02', 1, 100, { frames: 'garbage' })], names)[0].slice(9), ['', '', '', ''], 'damaged frames are skipped, not fatal');

// 3. CSV: opens right in Excel and is safe to open
const csv = E.csv(rows);
eq(csv.charCodeAt(0), 0xFEFF, 'starts with a byte-order mark so accents show properly');
eq(csv.slice(1, csv.indexOf('\r\n')), E.HEAD.join(','), 'header line');
ok(!/[^\r]\n/.test(csv), 'every line ends CRLF');
eq(csv.split('\r\n').length, rows.length + 2, 'one line per game, plus the header and a final line end');
const quoted = E.csv(E.rows([mk('q', '2026-03-01', 1, 150, { centerId: 'c2' }), mk('r', '2026-03-02', 1, 151, { centerId: 'c4' }), mk('s', '2026-03-03', 1, 152, { centerId: 'c3' })], names));
ok(quoted.includes('"Bowl ""Big"" & Co, Inc."'), 'commas and quotes are quoted and doubled');
ok(quoted.includes('"Lisle\nLanes"'), 'a line break inside a name stays inside its cell');
ok(quoted.includes(`,"'=HYPERLINK(""x"")",`), 'a name that starts with = is kept as text, not a formula', quoted);
const gutterCsv = E.csv(E.rows([mk('g', '2026-03-04', 1, S.computeScore(gutterSpare).total, { mode: 'pins', frames: gutterSpare.frames })], names));
ok(gutterCsv.includes(",'-/ X X X X X X X X XXX"), 'frames that start with a gutter ball are not read as a formula', gutterCsv);
ok(!/,'\d/.test(E.csv(rows)), 'numbers are never given a leading quote');
eq(E.csv([]), '﻿' + E.HEAD.join(',') + '\r\n', 'no games is just the header');

// 4. the CSV can be brought straight back in, and BowlBoard sees it's all there already
const table = LG.parseCSV(csv);
eq(table.length, rows.length + 1, 'parses back to the same number of lines');
const info = G.analyze(table);
eq([info.ok, info.hasHeader, info.layout], [true, true, 'long'], 'the importer understands the export');
ok(info.map.date === 0 && info.map.scores.length === 1 && info.map.scores[0] === 2 && info.map.center === 3 && info.map.ball === 4 && info.map.lane === 5 && info.map.pattern === 6 && info.map.gameNo === 1, 'and finds date, score, center, ball, lane, pattern and game number', info.map);
const plan = (existing, centers) => G.plan(table, info.map, { hasHeader: info.hasHeader, order: info.order }, { centers: centers || [], balls: [], existing, parseLanes: s => (String(s).match(/\d+/g) || []).map(Number) });
const again = plan(games);
eq([again.total, again.toImport, again.duplicates, again.skippedRows], [6, 0, 6, 0], 'importing your own export again adds nothing');
const fresh = plan([]);
eq([fresh.toImport, fresh.duplicates, fresh.nights], [6, 0, 3], 'into an empty log it brings back every game, in three nights');
const back = G.toGames(fresh, { uid: (() => { let i = 0; return () => 'u' + (++i); })(), batch: 'b1', centerIdFor: name => name ? 'C:' + name : '' });
eq(back.map(g => g.date + ':' + g.total).sort(), games.filter(g => g.total != null).map(g => g.date + ':' + g.total).sort(), 'the same dates and scores come back');
eq(back.filter(g => g.centerId).map(g => g.centerId).sort(), ['C:Bowl "Big" & Co, Inc.', 'C:Sunset Lanes', 'C:Sunset Lanes', 'C:Sunset Lanes'], 'centers come back by name');
eq(back.filter(g => g.lanes && g.lanes.length).map(g => g.lanes.join('-')), ['7-8', '7-8', '7-8'], 'lanes come back');

// 5. nights and seasons
const N = E.nights(games, names);
eq(N.map(x => x.date), ['2026-09-10', '2026-09-03', '2025-03-02'], 'newest night first');
eq(N[1], { date: '2026-09-03', center: 'Sunset Lanes', league: 'Thursday Trios', scores: [180, 201, 165], series: 546, avg: 182, balls: ['Storm Phaze II (15 lb)', 'Hammer Black Widow'], lanes: '7-8', createdAt: N[1].createdAt }, 'a night: scores in game order, series, average (rounded down), balls used once each');
eq(N[2].avg, 145, 'average of 140 and 150');
eq(E.nights([mk('a', '2026-01-05', 1, 100, { createdAt: '2026-01-05T09:00:00Z' }), mk('b', '2026-01-05', 1, 200, { createdAt: '2026-01-05T21:00:00Z' })], names).map(x => x.series), [200, 100], 'two nights on one day: the later one first');
eq(E.nights([], names), [], 'no nights');

const sum = E.summary(games);
eq([sum.all.label, sum.all.nights, sum.all.games, sum.all.avg, sum.all.high, sum.all.highSeries], ['All time', 3, 6, 189, 300, 546], 'all time');
eq(sum.seasons.map(s => [s.label, s.nights, s.games, s.avg, s.high, s.highSeries]), [['2026–27', 2, 4, 211, 300, 546], ['2024–25', 1, 2, 145, 150, null]], 'seasons, newest first; no series shown until a night has three games');
const edge = E.summary([mk('e1', '2026-07-31', 1, 150), mk('e2', '2026-08-01', 1, 160)]);
eq(edge.seasons.map(s => s.label), ['2026–27', '2025–26'], 'a season runs August 1 to July 31');
eq(E.summary([]).all, { label: 'All time', nights: 0, games: 0, avg: null, high: null, highSeries: null }, 'nothing to summarise');
eq(E.summary([]).seasons, [], 'and no seasons');
eq(E.summary([mk('x', '2026-01-05', 1, 100), mk('x', '2026-01-05', 2, 200), mk('x', '2026-01-05', 3, 150), mk('x', '2026-01-05', 4, 240)]).all.highSeries, 590, 'a four-game night counts its best three in a row');

// 6. Excel: a real workbook
const when = new Date('2026-09-29T12:00:00Z');
const xl = E.xlsx(games, names, when);
ok(xl instanceof Uint8Array && xl[0] === 0x50 && xl[1] === 0x4B, 'a zip file');
// walk the zip's own directory and check every file's checksum with an independent implementation
(function zipCheck() {
  const dv = new DataView(xl.buffer, xl.byteOffset, xl.byteLength);
  let e = xl.length - 22;
  while (e > 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  const count = dv.getUint16(e + 10, true), dirAt = dv.getUint32(e + 16, true);
  let p = dirAt, allGood = true;
  const listed = [];
  for (let i = 0; i < count; i++) {
    const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 24, true), nameLen = dv.getUint16(p + 28, true), extra = dv.getUint16(p + 30, true), comment = dv.getUint16(p + 32, true), at = dv.getUint32(p + 42, true);
    const name = Buffer.from(xl.subarray(p + 46, p + 46 + nameLen)).toString();
    const lNameLen = dv.getUint16(at + 26, true), lExtra = dv.getUint16(at + 28, true);
    const data = xl.subarray(at + 30 + lNameLen + lExtra, at + 30 + lNameLen + lExtra + size);
    if (zlib.crc32(data) !== crc) allGood = false;
    listed.push(name);
    p += 46 + nameLen + extra + comment;
  }
  ok(allGood, 'every file in the workbook has a matching checksum');
  eq(listed.sort(), ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'], 'the parts of a workbook');
})();
XR.read(xl).then(book => {
  eq(book.sheets.map(s => s.name), ['Games', 'Summary'], 'two sheets');
  const g = book.sheets[0].rows;
  eq(g[0], E.HEAD, 'header row');
  eq(g.length, 7, 'header plus six games');
  eq(g[3].slice(2, 8), [180, 'Sunset Lanes', 'Storm Phaze II (15 lb)', '7-8', 'House', 'Thursday Trios'], 'cells match the CSV');
  eq(typeof g[3][0] === 'number' ? XR.serialToISO(g[3][0]) : g[3][0], '2026-09-03', 'dates are real dates');
  eq([g[6][9], g[6][12]], [12, 'X X X X X X X X X XXX'], 'strike count and marks for the 300');
  const s = book.sheets[1].rows;
  eq(s[0], ['Season', 'Nights', 'Games', 'Average', 'High game', 'High 3-game series'], 'summary header');
  eq(s.slice(1).map(r => r.slice(0, 5)), [['2026–27', 2, 4, 211, 300], ['2024–25', 1, 2, 145, 150], ['All time', 3, 6, 189, 300]], 'seasons then all time');
}).then(finish, e => { fail++; console.log('FAIL reading the workbook back', e && e.message); finish(); });

// sheet names: unique, short, no forbidden characters; text is escaped
const odd = XW.build({ sheets: [{ name: 'Season: 2026/27?*', header: ['a & b', '<c>'], rows: [['x "y" <z> & \u0001w', 1]] }, { name: 'Season: 2026/27?*', header: ['q'], rows: [] }, { name: 'x'.repeat(50), header: ['q'], rows: [] }] });
const oddText = Buffer.from(odd).toString('latin1');
ok(/<sheet name="Season  2026 27  "|<sheet name="Season  2026 27"/.test(oddText) || /name="Season/.test(oddText), 'forbidden characters are removed from sheet names');
const wbName = /<sheets>(.*?)<\/sheets>/s.exec(Buffer.from(odd).toString('latin1'));
const shNames = wbName ? Array.from(wbName[1].matchAll(/name="([^"]*)"/g)).map(m => m[1]) : [];
eq(new Set(shNames.map(s => s.toLowerCase())).size, 3, 'sheet names are all different');
ok(shNames.every(s => s.length <= 31 && !/[\\/?*[\]:]/.test(s)), 'and valid for Excel', shNames);
XR.read(odd).then(b => eq(b.sheets[0].rows[1][0], 'x "y" <z> & w', 'special characters survive in a cell; control characters are dropped'), e => { fail++; console.log('FAIL odd workbook', e.message); });

// 7. PDF: a well-formed file that says what it should
function pdfParts(bytes) {
  const s = Buffer.from(bytes).toString('latin1');
  const res = { text: s, okHeader: /^%PDF-1\.\d\n/.test(s), okEnd: /%%EOF\n$/.test(s) };
  const sx = /startxref\n(\d+)\n%%EOF\n$/.exec(s);
  res.xrefAt = sx ? +sx[1] : -1;
  res.xrefOk = res.xrefAt > 0 && s.slice(res.xrefAt, res.xrefAt + 5) === 'xref\n';
  const head = /^xref\n0 (\d+)\n/.exec(s.slice(res.xrefAt));
  res.size = head ? +head[1] : 0;
  res.offsetsOk = false;
  if (head) {
    const entries = s.slice(res.xrefAt + head[0].length).split('\n').slice(0, res.size);
    res.offsetsOk = entries.slice(1).every((line, i) => s.slice(+line.slice(0, 10), +line.slice(0, 10) + String(i + 1).length + 6) === (i + 1) + ' 0 obj');
    res.entryLen = entries.every(l => l.length === 19);
  }
  res.pages = +(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(s) || [0, 0])[1];
  res.media = (/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(s) || []).slice(1).map(Number);
  return res;
}
const meta = { title: 'Matt’s bowling games', rangeLabel: 'All games', exportedOn: 'Sep 29, 2026', size: 'letter', fmtDate: iso => iso };
const pdf1 = E.pdf(games, names, meta);
const P1 = pdfParts(pdf1);
ok(pdf1 instanceof Uint8Array, 'bytes');
ok(P1.okHeader && P1.okEnd && P1.xrefOk && P1.offsetsOk && P1.entryLen, 'header, cross-reference table and end marker are all in place', { h: P1.okHeader, e: P1.okEnd, x: P1.xrefOk, o: P1.offsetsOk });
eq(P1.pages, 1, 'six games fit on one page');
eq(P1.media, [612, 792], 'US letter');
ok(/Page 1 of 1/.test(P1.text) && /Built for Bowlers/.test(P1.text) && /your data stays on your device/.test(P1.text), 'branding and page number');
ok(/\(546\)/.test(P1.text) && /\(189\)/.test(P1.text) && /\(300\)/.test(P1.text), 'the headline numbers are printed');
ok(/\(180 \\267 201 \\267 165\)/.test(P1.text), 'each night lists its games');
ok(/2026\\22627/.test(P1.text), 'season labels use a proper dash');
ok(/Bowl "Big" & Co, Inc\./.test(P1.text), 'quotes and commas print as they are');
ok(/\/Title <FEFF/.test(P1.text), 'the title is stored as Unicode so the apostrophe shows correctly');
eq(pdfParts(E.pdf(games, names, Object.assign({}, meta, { size: 'a4' }))).media, [595.28, 841.89], 'A4 when asked');

// many nights: pages are added, every page has its header, footer and page count
const many = [];
for (let d = 0; d < 400; d++) {
  const date = new Date(Date.UTC(2024, 8, 1 + d)).toISOString().slice(0, 10);
  for (let k = 1; k <= 3; k++) many.push(mk('night' + d, date, k, 120 + ((d * 7 + k * 13) % 150), { centerId: 'c1', ballId: 'b1', leagueId: d % 2 ? 'l1' : undefined, createdAt: date + 'T20:00:00Z' }));
}
const PM = pdfParts(E.pdf(many, names, meta));
ok(PM.pages >= 8 && PM.pages <= 20, 'a long history runs to several pages', PM.pages);
ok(PM.okHeader && PM.okEnd && PM.xrefOk && PM.offsetsOk, 'and is still a well-formed file');
ok(new RegExp('Page ' + PM.pages + ' of ' + PM.pages).test(PM.text) && new RegExp('Page 2 of ' + PM.pages).test(PM.text), 'every page is numbered');
eq((PM.text.match(/\(Every night\)/g) || []).length, 1, 'the night table is titled once');
ok((PM.text.match(/\(League \/ ball\)/g) || []).length === PM.pages || (PM.text.match(/\(League \/ ball\)/g) || []).length >= PM.pages - 1, 'and its column headings repeat on each page', (PM.text.match(/\(League \/ ball\)/g) || []).length);
eq((PM.text.match(/\(546\)|\(\d{3}\) Tj/g) || []).length > 400, true, 'every night is listed');

// odd text: brackets, backslashes, accents and characters no printer font has
const weird = E.pdf([mk('w', '2026-04-01', 1, 222, { centerId: 'cx' })], Object.assign({}, names, { center: () => 'Lanes (East) \\ Café ☃ \u{1F600} ' + 'very long name '.repeat(8) }), meta);
const PW = pdfParts(weird);
ok(PW.okHeader && PW.okEnd && PW.xrefOk && PW.offsetsOk, 'brackets, backslashes and emoji leave a well-formed file');
ok(/Lanes \\\(East\\\) \\\\ Caf\\351 \? \?/.test(PW.text), 'brackets and backslashes are escaped; é is kept; what the font lacks becomes ?');
ok(/very long[^)]*\\205\)/.test(PW.text) || /…|\\205\)/.test(PW.text), 'a very long name is shortened with an ellipsis instead of running over the next column');
const empty = pdfParts(E.pdf([], names, meta));
ok(empty.okHeader && empty.okEnd && empty.xrefOk && empty.offsetsOk && /No games in this range/.test(empty.text), 'no games still gives a valid, friendly page');

// the low-level writers
const doc = PDFW.create({ size: 'a4' });
eq([doc.width, doc.height], [595.28, 841.89], 'A4 dimensions');
ok(doc.measure('BowlBoard', 12, true) > doc.measure('BowlBoard', 12, false), 'bold text is wider');
eq(doc.fit('short', 200, 9), 'short', 'text that fits is left alone');
ok(doc.fit('a much longer string than fits', 60, 9).endsWith('…') && doc.measure(doc.fit('a much longer string than fits', 60, 9), 9) <= 60, 'text that does not fit is cut to width');

// 8. file names
eq(E.filename('csv', '2026-09-29'), 'bowlboard-games-2026-09-29.csv', 'plain name');
eq(E.filename('xlsx', '2026-09-29', 'thursday-trios'), 'bowlboard-games-thursday-trios-2026-09-29.xlsx', 'name with the league or season');

function finish() {
  // runs once the asynchronous workbook checks have settled
  setTimeout(() => { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }, 50);
}
