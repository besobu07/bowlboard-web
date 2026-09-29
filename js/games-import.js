/* BowlBoard — bringing in your own scores from a spreadsheet or CSV.
 * No DOM in here, so it all runs under Node for the tests.
 *
 *   analyze(table)          which column is which (a best guess; the screen lets you change it)
 *   plan(table, map, opts)  what would be imported, what's already in your log, what's skipped
 *   toGames(plan, opts)     game records ready for the store
 *   template()              a small CSV to start from
 *
 * A "table" is an array of rows, each an array of cells (strings or numbers), the same
 * thing the .xlsx reader and the CSV parser produce.
 */
(function (global) {
  'use strict';

  const pad = n => String(n).padStart(2, '0');
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const blankCell = c => c == null || (typeof c === 'string' && c.trim() === '');

  /* ---------- dates ---------- */
  function validYMD(y, m, d) {
    if (!(y >= 1950 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? y + '-' + pad(m) + '-' + pad(d) : '';
  }
  const fullYear = s => { const n = parseInt(s, 10); return s.length === 4 ? n : n < 70 ? 2000 + n : 1900 + n; };
  const monthNo = w => { const i = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*$/i.test(w) ? MONTHS.indexOf(w.slice(0, 3).toLowerCase()) : -1; return i + 1; };

  // Any date a spreadsheet is likely to hold, as YYYY-MM-DD ('' if it isn't one).
  // order only matters for 04/05/2026-style dates: 'mdy' (US, the default) or 'dmy'.
  function parseDate(v, order) {
    if (v == null || v === '') return '';
    if (v instanceof Date) return isNaN(v) ? '' : validYMD(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === 'number') {
      if (v < 18264 || v > 73415) return ''; // Excel day numbers for 1950 to 2100
      const d = new Date(Math.round((v - 25569) * 864e5));
      return validYMD(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    let s = String(v).trim();
    if (!s) return '';
    s = s.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i, ''); // "Tue, Sep 22, 2026"
    let m;
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[T\s])/))) return validYMD(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return validYMD(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:$|[T\s])/))) {
      const a = +m[1], b = +m[2], y = fullYear(m[3]);
      return order === 'dmy' ? validYMD(y, b, a) : validYMD(y, a, b);
    }
    if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4}|\d{2})$/))) return monthNo(m[1]) ? validYMD(fullYear(m[3]), monthNo(m[1]), +m[2]) : '';
    if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{4}|\d{2})$/))) return monthNo(m[2]) ? validYMD(fullYear(m[3]), monthNo(m[2]), +m[1]) : '';
    return '';
  }

  // Is 04/05/2026 April 5th or May 4th? Look for a date that can only be one of them.
  function detectOrder(values) {
    let mdy = 0, dmy = 0, both = 0, dotted = 0, slashed = 0;
    values.forEach(v => {
      const m = typeof v === 'string' && v.trim().match(/^(\d{1,2})([-/.])(\d{1,2})[-/.](\d{2,4})(?:$|[T\s])/);
      if (!m) return;
      const a = +m[1], b = +m[3];
      if (m[2] === '.') dotted++; else slashed++;
      if (a > 12 && b <= 12) dmy++; else if (b > 12 && a <= 12) mdy++; else if (a !== b && a <= 12 && b <= 12) both++;
    });
    if (dmy && !mdy) return { order: 'dmy', ambiguous: false };
    if (mdy && !dmy) return { order: 'mdy', ambiguous: false };
    if (dotted && !slashed) return { order: 'dmy', ambiguous: false }; // 04.05.2026 is day-first wherever people write dots
    return { order: 'mdy', ambiguous: both > 0 && !dmy && !mdy };
  }

  /* ---------- scores ---------- */
  function parseScore(v) {
    if (v == null) return { blank: true };
    if (typeof v === 'number') return Math.abs(v - Math.round(v)) < 1e-9 ? { n: Math.round(v) } : { bad: String(v) };
    const s = String(v).trim();
    if (s === '' || /^(-+|–|—|\.|n\/?a|abs|absent|bye|dnp|x)$/i.test(s)) return { blank: true };
    const m = s.match(/^(\d{1,4})(?:\.0+)?$/);
    return m ? { n: +m[1] } : { bad: s };
  }

  /* ---------- which column is which ---------- */
  const norm = h => String(h == null ? '' : h).toLowerCase().replace(/[^a-z0-9# ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const ROLES = {
    date: /^(date|game date|date bowled|bowled|bowled on|played|played on|when)$/,
    center: /^(center|centre|bowling center|bowling centre|alley|bowling alley|house|location|venue|place)$/,
    ball: /^(ball|ball used|bowling ball|balls)$/,
    lane: /^(lane|lanes|lane #|lane no|lane number)$/,
    pattern: /^(oil|oil pattern|pattern|condition|conditions|lane condition|oil condition|shot)$/,
    gameNo: /^(game|game #|game no|game number|gm|gm #|#)$/,
    single: /^(score|scores|total|final|final score|game score|pins|scratch|scratch score|total pins|game total)$/,
  };
  const GAMECOL = /^(?:g|gm|gme|game|score|scr)\s*#?\s*(\d{1,2})$/;
  const NOT_A_SCORE = /(series|avg|average|hdcp|hcp|handicap|high|rank|place|pts|points|diff|strikes|spares|opens|pct)/;
  const colLetter = i => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

  // Text that isn't a number or a date on the first row means it's a row of column names.
  function looksLikeHeader(row) {
    return row.some(c => typeof c === 'string' && c.trim() !== '' && isNaN(Number(c)) && !parseDate(c, 'mdy'));
  }
  const dataRows = table => (Array.isArray(table) ? table : []).filter(r => Array.isArray(r) && r.some(c => !blankCell(c)));

  // opts.hasHeader overrides the guess about whether the first row is column names.
  function analyze(table, opts) {
    const rows = dataRows(table);
    if (!rows.length) return { ok: false, error: 'That file has no rows in it.' };
    const width = Math.max.apply(null, rows.map(r => r.length));
    if (!width) return { ok: false, error: 'That file has no columns in it.' };
    const hasHeader = opts && opts.hasHeader != null ? !!opts.hasHeader : looksLikeHeader(rows[0]);
    const body = hasHeader ? rows.slice(1) : rows;
    const names = Array.from({ length: width }, (_, i) => (hasHeader && !blankCell(rows[0][i]) ? String(rows[0][i]).trim() : 'Column ' + colLetter(i)));
    const map = { date: -1, scores: [], center: -1, ball: -1, lane: -1, pattern: -1, gameNo: -1 };
    if (hasHeader) {
      const keys = rows[0].map(norm);
      const gameCols = [];
      keys.forEach((k, i) => {
        if (!k) return;
        const g = k.match(GAMECOL);
        if (g && !NOT_A_SCORE.test(k)) { gameCols.push([+g[1], i]); return; }
        for (const role of ['date', 'center', 'ball', 'lane', 'pattern']) if (map[role] < 0 && ROLES[role].test(k)) { map[role] = i; return; }
      });
      if (gameCols.length) map.scores = gameCols.sort((a, b) => a[0] - b[0]).map(x => x[1]);
      else {
        const single = keys.findIndex(k => k && ROLES.single.test(k) && !NOT_A_SCORE.test(k));
        if (single >= 0) map.scores = [single];
      }
      const gn = keys.findIndex((k, i) => k && ROLES.gameNo.test(k) && !map.scores.includes(i));
      if (gn >= 0) map.gameNo = gn;
    }
    // Whatever the names didn't settle, the numbers can: a column of dates, columns of 0-300 whole numbers.
    const col = i => body.map(r => r[i]).filter(c => !blankCell(c));
    const isDates = i => { const vals = col(i); return vals.length > 0 && vals.filter(v => parseDate(v, 'mdy') || parseDate(v, 'dmy')).length >= vals.length * 0.8; };
    if (map.date >= 0 && !isDates(map.date)) map.date = -1; // named "date" but isn't one
    if (map.date < 0) {
      for (let i = 0; i < width; i++) if (!map.scores.includes(i) && isDates(i)) { map.date = i; break; }
    }
    if (!map.scores.length) {
      const cand = [];
      for (let i = 0; i < width; i++) {
        if (i === map.date) continue;
        const vals = col(i);
        if (vals.length && vals.every(v => { const s = parseScore(v); return s.n != null && s.n <= 300; }) && vals.length >= body.length * 0.5) cand.push(i);
      }
      map.scores = cand;
    }
    const dates = map.date >= 0 ? col(map.date) : [];
    const ord = detectOrder(dates);
    return {
      ok: true, hasHeader, width, names, map, layout: map.scores.length > 1 ? 'wide' : 'long',
      order: ord.order, ambiguousDates: ord.ambiguous,
      sample: body.slice(0, 3).map(r => Array.from({ length: width }, (_, i) => (blankCell(r[i]) ? '' : String(r[i])))),
      rows: body.length,
    };
  }

  /* ---------- what would be imported ---------- */
  const key = s => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
  function defaultParseLanes(v) {
    if (v == null || v === '') return [];
    if (typeof v === 'number') return Number.isInteger(v) && v > 0 && v < 200 ? [v] : [];
    const m = String(v).match(/(\d{1,3})(?:\s*[-–&/,]\s*|\s+)?(\d{1,3})?/);
    return m ? [+m[1]].concat(m[2] ? [+m[2]] : []) : [];
  }
  const cellText = v => (blankCell(v) ? '' : String(v).trim());

  // ctx: { centers: [{id, name}], balls: [{id, brand, name}], existing: [{date, total}], parseLanes }
  function plan(table, map, opts, ctx) {
    opts = opts || {}; ctx = ctx || {};
    const rows = dataRows(table);
    if (!rows.length) return { ok: false, error: 'That file has no rows in it.' };
    if (!map || map.date == null || map.date < 0) return { ok: false, error: 'Choose the column that holds the date.' };
    if (!map.scores || !map.scores.length) return { ok: false, error: 'Choose the column that holds the scores.' };
    const hasHeader = opts.hasHeader !== false;
    const order = opts.order === 'dmy' ? 'dmy' : 'mdy';
    // file row numbers as a spreadsheet shows them (blank rows counted)
    const numbered = [];
    (Array.isArray(table) ? table : []).forEach((r, i) => { if (Array.isArray(r) && r.some(c => !blankCell(c))) numbered.push({ r, n: i + 1 }); });
    const body = hasHeader ? numbered.slice(1) : numbered;
    const centerBy = {}; (ctx.centers || []).forEach(c => { centerBy[key(c.name)] = c; });
    const ballBy = {};
    (ctx.balls || []).forEach(b => { ballBy[key(b.brand + ' ' + b.name)] = b; if (!ballBy[key(b.name)]) ballBy[key(b.name)] = b; });
    const lanesOf = ctx.parseLanes || defaultParseLanes;
    const out = { ok: true, rows: [], skipped: [], empty: 0, big: 0, newCenters: [], unmatchedBalls: [], dates: { first: '', last: '' } };
    const skip = (n, why) => out.skipped.push({ row: n, reason: why });
    let wide = 0; // wide layout: each row is a night of its own

    body.forEach(({ r, n }, idx) => {
      const dateCell = r[map.date];
      const date = parseDate(dateCell, order);
      if (!date) { skip(n, blankCell(dateCell) ? 'No date' : 'Couldn’t read the date “' + cellText(dateCell) + '”'); return; }
      const totals = [];
      let bad = false;
      map.scores.forEach(ci => {
        const s = parseScore(r[ci]);
        if (s.blank) return;
        if (s.bad != null) { skip(n, '“' + s.bad + '” isn’t a score'); bad = true; return; }
        if (s.n > 300) { out.big++; skip(n, 'A score of ' + s.n + ' isn’t possible (300 is perfect)'); bad = true; return; }
        totals.push(s.n);
      });
      if (!totals.length) { if (!bad) out.empty++; return; } // a dated row with nothing bowled: left out, not a problem
      const center = map.center >= 0 ? cellText(r[map.center]) : '';
      const ball = map.ball >= 0 ? cellText(r[map.ball]) : '';
      const pattern = map.pattern >= 0 ? cellText(r[map.pattern]) : '';
      const lanes = map.lane >= 0 ? lanesOf(r[map.lane]).slice(0, 2) : [];
      const gnum = map.gameNo >= 0 ? parseScore(r[map.gameNo]) : {};
      const base = { row: n, date, center, ball, pattern, lanes };
      if (map.scores.length > 1) {
        const series = 'row' + n + '-' + (wide++);
        totals.forEach(t => out.rows.push(Object.assign({ total: t, series, order: out.rows.length }, base)));
      } else {
        const series = date + '|' + key(center); // long layout: one night at one place is one series
        out.rows.push(Object.assign({ total: totals[0], series, order: out.rows.length, gnum: gnum.n != null ? gnum.n : null }, base));
      }
    });

    // number the games within each night (a Game # column decides the order if there is one)
    const bySeries = new Map();
    out.rows.forEach(g => { if (!bySeries.has(g.series)) bySeries.set(g.series, []); bySeries.get(g.series).push(g); });
    bySeries.forEach(list => {
      const numbered = list.every(g => g.gnum != null);
      list.sort((a, b) => (numbered ? a.gnum - b.gnum : 0) || a.order - b.order);
      list.forEach((g, i) => { g.seq = i + 1; });
    });

    // already in your log? Match date + score one for one, so two 180s on a night need two matches
    const have = {};
    (ctx.existing || []).forEach(g => { if (g && g.total != null && g.date) { const k = g.date + '|' + g.total; have[k] = (have[k] || 0) + 1; } });
    out.rows.slice().sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order).forEach(g => {
      const k = g.date + '|' + g.total;
      if (have[k] > 0) { have[k]--; g.dup = true; } else g.dup = false;
    });

    const fresh = out.rows.filter(g => !g.dup);
    // games left after skipping duplicates are renumbered within their night
    const kept = new Map();
    fresh.slice().sort((a, b) => a.seq - b.seq).forEach(g => { kept.set(g.series, (kept.get(g.series) || 0) + 1); g.gameNo = kept.get(g.series); });
    fresh.forEach(g => {
      const c = g.center ? centerBy[key(g.center)] : null;
      g.centerId = c ? c.id : '';
      if (g.center && !c && !out.newCenters.some(x => key(x) === key(g.center))) out.newCenters.push(g.center);
      const b = g.ball ? ballBy[key(g.ball)] : null;
      g.ballId = b ? b.id : '';
      if (g.ball && !b && !out.unmatchedBalls.some(x => key(x) === key(g.ball))) out.unmatchedBalls.push(g.ball);
    });
    out.total = out.rows.length;
    out.toImport = fresh.length;
    out.duplicates = out.rows.length - fresh.length;
    out.nights = new Set(fresh.map(g => g.series)).size;
    const ds = fresh.map(g => g.date).sort();
    out.dates = { first: ds[0] || '', last: ds[ds.length - 1] || '' };
    out.preview = out.rows.slice().sort((a, b) => a.order - b.order).slice(0, 6);
    out.skippedRows = new Set(out.skipped.map(s => s.row)).size;
    return out;
  }

  // Game records for the store. opts: { uid, batch, centerIdFor(name) }
  function toGames(p, opts) {
    opts = opts || {};
    const uid = opts.uid || (() => 'g' + Math.random().toString(36).slice(2, 10));
    const seriesId = {};
    const fresh = p.rows.filter(g => !g.dup).sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
    return fresh.map(g => {
      if (!seriesId[g.series]) seriesId[g.series] = uid();
      return {
        id: uid(), date: g.date,
        centerId: g.centerId || (opts.centerIdFor ? opts.centerIdFor(g.center) : '') || '', // '' asks for the "no center given" choice
        ballId: g.ballId || '', lanes: g.lanes.slice(), pattern: g.pattern || '', leagueId: '',
        seriesId: seriesId[g.series], gameNo: g.gameNo, mode: 'total', total: g.total,
        imported: opts.batch || '',
      };
    });
  }

  const template = () => [
    'Date,Game 1,Game 2,Game 3,Center,Ball,Lane,Oil pattern',
    '2026-09-01,201,178,190,Home Lanes,,15-16,House shot',
    '2026-09-08,165,188,212,Home Lanes,,17-18,House shot',
  ].join('\n') + '\n';

  const GamesImport = { parseDate, detectOrder, parseScore, analyze, plan, toGames, template };
  if (typeof module !== 'undefined' && module.exports) module.exports = GamesImport;
  else global.BBGamesImport = GamesImport;
})(typeof window !== 'undefined' ? window : globalThis);
