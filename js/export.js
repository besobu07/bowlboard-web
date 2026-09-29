/* BowlBoard — getting your games out: a spreadsheet-friendly CSV, an Excel workbook and a
 * printable PDF report. No DOM, so it runs under Node for the tests.
 *
 * Games are the app's records ({date, total, gameNo, seriesId, centerId, ballId, lanes,
 * pattern, leagueId, mode, frames?}). The screen passes in how to turn ids into names:
 *   names = { center(id), ball(id), league(id), mode(mode) }
 *
 *   rows(games, names)          one row per game, oldest first (the CSV and the Games sheet)
 *   nights(games, names)        one entry per night, newest first (the PDF)
 *   summary(games)              per season, and all time
 *   csv(rows) / xlsx(...) / pdf(...)
 */
(function (global) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const dep = (g, file) => (node ? require(file) : global[g]);

  const HEAD = ['Date', 'Game', 'Score', 'Center', 'Ball', 'Lane', 'Oil pattern', 'League', 'Scored by', 'Strikes', 'Spares', 'Open frames', 'Frames'];
  const scored = games => (games || []).filter(g => g && typeof g.total === 'number');
  const floorAvg = a => (a.length ? Math.floor(a.reduce((x, y) => x + y, 0) / a.length) : null);
  const lanesText = g => (g.lanes && g.lanes.length ? g.lanes.join('-') : '');

  // Games in the order you bowled them: by date, then by night (as logged), then game number.
  function ordered(games) {
    const first = {};
    scored(games).forEach(g => { const k = g.seriesId || g.id; const c = g.createdAt || ''; if (first[k] == null || c < first[k]) first[k] = c; });
    return scored(games).slice().sort((a, b) => (a.date || '').localeCompare(b.date || '') ||
      String(first[a.seriesId || a.id]).localeCompare(String(first[b.seriesId || b.id])) ||
      String(a.seriesId || a.id).localeCompare(String(b.seriesId || b.id)) || (a.gameNo || 1) - (b.gameNo || 1));
  }

  function frameInfo(g) {
    if (!g.frames || !g.frames.length) return { strikes: '', spares: '', opens: '', marks: '' };
    const S = dep('BBScore', './score.js');
    try {
      const game = { frames: g.frames.map(S.normFrame) };
      const st = S.pinStats([game]);
      const sc = S.computeScore(game);
      return { strikes: st.strikes, spares: st.spares, opens: st.openFrames, marks: sc.marks.filter(m => m && m.length).map(m => m.join('')).join(' ') };
    } catch (e) { return { strikes: '', spares: '', opens: '', marks: '' }; }
  }

  function rows(games, names) {
    return ordered(games).map(g => {
      const f = frameInfo(g);
      return [g.date || '', g.gameNo || 1, g.total, g.centerId ? names.center(g.centerId) : '', g.ballId ? names.ball(g.ballId) : '', lanesText(g),
        g.pattern || '', g.leagueId ? names.league(g.leagueId) : '', names.mode(g.mode), f.strikes, f.spares, f.opens, f.marks];
    });
  }

  /* ---------- CSV ---------- */
  // Text that starts with = + - @ would be read as a formula by a spreadsheet app (a first-frame
  // gutter ball makes the Frames column start with "-"); a leading ' keeps it as plain text.
  const cell = v => {
    let s = v == null ? '' : String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  // UTF-8 with a byte-order mark so Excel shows accents properly; CRLF line ends.
  function csv(rowList) { return '﻿' + [HEAD].concat(rowList).map(r => r.map(cell).join(',')).join('\r\n') + '\r\n'; }

  /* ---------- nights and seasons ---------- */
  function nights(games, names) {
    const by = new Map();
    scored(games).forEach(g => { const k = g.seriesId || g.id; if (!by.has(k)) by.set(k, []); by.get(k).push(g); });
    return Array.from(by.values()).map(list => {
      list.sort((a, b) => (a.gameNo || 1) - (b.gameNo || 1));
      const t = list.map(g => g.total);
      const balls = Array.from(new Set(list.map(g => (g.ballId ? names.ball(g.ballId) : '')).filter(Boolean)));
      return {
        date: list[0].date || '', center: list[0].centerId ? names.center(list[0].centerId) : '', league: list[0].leagueId ? names.league(list[0].leagueId) : '',
        scores: t, series: t.reduce((a, b) => a + b, 0), avg: floorAvg(t), balls, lanes: lanesText(list[0]),
        createdAt: list.reduce((m, g) => ((g.createdAt || '') > m ? g.createdAt : m), ''),
      };
    }).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }

  function summary(games) {
    const I = dep('BBInsights', './insights.js');
    const all = scored(games);
    const one = (label, list) => {
      const t = list.map(g => g.total);
      return { label, nights: new Set(list.map(g => g.seriesId || g.id)).size, games: list.length, avg: floorAvg(t), high: t.length ? Math.max.apply(null, t) : null, highSeries: (I.highSeries(list) || {}).total || null };
    };
    const seasons = Array.from(new Set(all.map(g => I.seasonOf(g.date)).filter(s => s != null))).sort((a, b) => b - a);
    return { all: one('All time', all), seasons: seasons.map(s => one(I.seasonLabel(s), all.filter(g => I.seasonOf(g.date) === s))) };
  }

  /* ---------- Excel ---------- */
  function xlsx(games, names, when) {
    const X = dep('BBXlsxWrite', './xlsx-write.js');
    const sum = summary(games);
    const sumRow = s => [s.label, s.nights, s.games, s.avg, s.high, s.highSeries];
    return X.build({
      sheets: [
        { name: 'Games', header: HEAD, widths: [12, 7, 8, 24, 24, 8, 16, 22, 16, 9, 9, 12, 44], rows: rows(games, names).map(r => [r[0] ? { date: r[0] } : ''].concat(r.slice(1))) },
        { name: 'Summary', header: ['Season', 'Nights', 'Games', 'Average', 'High game', 'High 3-game series'], widths: [14, 9, 9, 10, 11, 18], rows: sum.seasons.map(sumRow).concat([sumRow(sum.all)]) },
      ],
    }, when);
  }

  /* ---------- PDF ---------- */
  const INK = '#121416', GREY = '#6B6B6B', GOLD = '#F6A623', CREAM = '#F8EED7', RULE = '#DDD0AE', ZEBRA = '#FBF7EC';
  // meta: { title, rangeLabel, exportedOn: 'Sep 29, 2026', size: 'letter'|'a4', fmtDate(iso) }
  function pdf(games, names, meta) {
    const P = dep('BBPdf', './pdf-write.js');
    meta = meta || {};
    const fmtDate = meta.fmtDate || (iso => iso);
    const doc = P.create({ title: meta.title || 'BowlBoard: my games', author: 'BowlBoard', size: meta.size || 'letter' });
    const M = 40, W = doc.width - 2 * M, H = doc.height;
    const sum = summary(games), list = nights(games, names);
    const pages = [];
    let page, y;
    const newPage = first => {
      page = doc.addPage(); pages.push(page);
      page.rect(0, 0, doc.width, 8, { fill: GOLD });
      y = first ? 44 : 34;
    };
    const tableHead = (cols) => {
      page.rect(M, y - 11, W, 17, { fill: CREAM });
      cols.forEach(c => page.text(c.align === 'right' ? c.x + c.w : c.x, y + 1, c.title, { size: 8.5, bold: true, color: INK, align: c.align }));
      y += 15;
    };

    newPage(true);
    page.text(M, y, 'BowlBoard', { size: 24, bold: true, color: INK });
    page.text(doc.width - M, y, 'Built for Bowlers', { size: 9, bold: true, color: GOLD, align: 'right' });
    y += 20;
    page.text(M, y, meta.title || 'My bowling games', { size: 13, bold: true, color: INK });
    y += 15;
    page.text(M, y, [meta.rangeLabel || 'All games', sum.all.games + ' games on ' + sum.all.nights + ' nights', meta.exportedOn ? 'Exported ' + meta.exportedOn : ''].filter(Boolean).join('  ·  '), { size: 9, color: GREY });
    y += 22;

    // the four numbers
    const boxes = [['Games', sum.all.games], ['Average', sum.all.avg == null ? '-' : sum.all.avg], ['High game', sum.all.high == null ? '-' : sum.all.high], ['High 3-game series', sum.all.highSeries == null ? '-' : sum.all.highSeries]];
    const bw = (W - 3 * 10) / 4;
    boxes.forEach((b, i) => {
      const x = M + i * (bw + 10);
      page.rect(x, y, bw, 46, { fill: CREAM, stroke: RULE, width: 0.6 });
      page.text(x + 10, y + 16, b[0], { size: 8, color: GREY });
      page.text(x + 10, y + 37, String(b[1]), { size: 20, bold: true, color: INK });
    });
    y += 66;

    // by season
    if (sum.seasons.length) {
      page.text(M, y, 'By season', { size: 11, bold: true, color: INK });
      y += 16;
      const sc = [{ title: 'Season', x: M + 6, w: 90 }, { title: 'Nights', x: M + 110, w: 50, align: 'right' }, { title: 'Games', x: M + 170, w: 50, align: 'right' },
        { title: 'Average', x: M + 230, w: 55, align: 'right' }, { title: 'High game', x: M + 295, w: 65, align: 'right' }, { title: 'High series', x: M + 370, w: 70, align: 'right' }];
      tableHead(sc);
      sum.seasons.slice(0, 10).forEach((s, i) => {
        if (i % 2) page.rect(M, y - 10, W, 15, { fill: ZEBRA });
        const v = [s.label, s.nights, s.games, s.avg == null ? '-' : s.avg, s.high == null ? '-' : s.high, s.highSeries == null ? '-' : s.highSeries];
        sc.forEach((c, k) => page.text(c.align === 'right' ? c.x + c.w : c.x, y, String(v[k]), { size: 9, bold: k === 3, color: INK, align: c.align }));
        y += 15;
      });
      y += 14;
    }

    // every night
    const cols = [{ title: 'Date', x: M + 6, w: 62 }, { title: 'Center', x: M + 72, w: 104 }, { title: 'Games', x: M + 180, w: 112 },
      { title: 'Series', x: M + 296, w: 38, align: 'right' }, { title: 'Avg', x: M + 338, w: 30, align: 'right' }, { title: 'League / ball', x: M + 380, w: W - 384 }];
    const start = () => { page.text(M, y, 'Every night', { size: 11, bold: true, color: INK }); y += 16; tableHead(cols); };
    if (y > H - 130) newPage(false);
    start();
    list.forEach((n, i) => {
      if (y > H - 52) { newPage(false); tableHead(cols); }
      if (i % 2) page.rect(M, y - 10, W, 15, { fill: ZEBRA });
      const detail = [n.league, n.balls.join(', ')].filter(Boolean).join(' · ');
      const cell = (c, str, o) => page.text(c.align === 'right' ? c.x + c.w : c.x, y, doc.fit(str, c.w, 9, o && o.bold), Object.assign({ size: 9, color: INK, align: c.align }, o));
      cell(cols[0], fmtDate(n.date));
      cell(cols[1], n.center || '-');
      cell(cols[2], n.scores.join(' · '));
      cell(cols[3], String(n.series), { bold: true });
      cell(cols[4], n.avg == null ? '-' : String(n.avg));
      cell(cols[5], detail || '-', { color: detail ? INK : GREY });
      y += 15;
    });
    if (!list.length) page.text(M + 6, y, 'No games in this range.', { size: 9, color: GREY });

    pages.forEach((pg, i) => {
      pg.line(M, H - 34, doc.width - M, H - 34, { color: RULE, width: 0.6 });
      pg.text(M, H - 22, 'BowlBoard · bowlboard.app · your data stays on your device', { size: 8, color: GREY });
      pg.text(doc.width - M, H - 22, 'Page ' + (i + 1) + ' of ' + pages.length, { size: 8, color: GREY, align: 'right' });
    });
    return doc.build();
  }

  const stamp = iso => iso.replace(/-/g, '');
  // bowlboard-games-2026-09-29.xlsx, or bowlboard-games-thursday-trios-2026-09-29.xlsx for one league
  const filename = (ext, iso, tag) => 'bowlboard-games' + (tag ? '-' + tag : '') + '-' + iso + '.' + ext;

  const Export = { HEAD, rows, csv, nights, summary, xlsx, pdf, filename, stamp };
  if (node) module.exports = Export;
  else global.BBExport = Export;
})(typeof window !== 'undefined' ? window : globalThis);
