/* BowlBoard league engine — pure league math, no DOM.
 *
 * League shape:
 * {
 *   id, name, centerId, day, time, startDate:'YYYY-MM-DD', seasonWeeks, gamesPerNight, teamSize,
 *   handicap: { enabled, basis, pct, rounding }, e.g. 90% of 220; rounding 'floor' | 'round' | 'even'
 *   byePoints: 'none' | 'half' | 'full'          what a team on a bye earns that week
 *   points:   { perGame, perSeries },            points for winning each game / total pins
 *   absent:   { pinsBelowAvg },                  absent bowler scores (avg - N) each game
 *   vacancy:  { score },                         empty lineup slot scores this, no handicap
 *   establishGames, defaultAvg,                  entering average used until N league games
 *   newBowlerAvg: 'default' | 'firstNight'       a bowler with no average: default avg, or that night's own average
 *   teams:   [{id, name}],
 *   bowlers: [{id, name, email, enteringAvg, teamId ('' = sub), isMe, active}],
 *   schedule:[{week, date, matchups:[{a, b, lanes}], bye}],
 *   results: { [week]: { lines:[{teamId, bowlerId, absent, games:[n|null], links:[gameId|null]}], final, updatedAt } },
 *     links[i] ties game i to a game in the bowler's own log (see "personal <-> league link")
 *   ccEmails
 * }
 * Averages are always truncated (a 189.9 average is 189), per league convention.
 */
(function (global) {
  'use strict';

  const VACANT = '__vacant';
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function uid() {
    return 'lg-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
  }

  function createLeague(opts) {
    opts = opts || {};
    return Object.assign({
      id: uid(), name: 'New league', centerId: '', day: 'Tuesday', time: '6:30 PM',
      startDate: '', seasonWeeks: 30, gamesPerNight: 3, teamSize: 4,
      handicap: { enabled: true, basis: 220, pct: 90, rounding: 'floor' },
      byePoints: 'none',
      points: { perGame: 1, perSeries: 1 },
      absent: { pinsBelowAvg: 10 },
      vacancy: { score: 120 },
      establishGames: 3, defaultAvg: 150, newBowlerAvg: 'default',
      teams: [], bowlers: [], schedule: [], results: {}, ccEmails: '',
      createdAt: new Date().toISOString(),
    }, opts);
  }

  /* ---------- dates ---------- */
  function addDays(iso, n) {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function weekDate(league, week) {
    const s = league.schedule.find(x => x.week === week);
    if (s && s.date) return s.date;
    return league.startDate ? addDays(league.startDate, 7 * (week - 1)) : '';
  }

  /* ---------- schedule ---------- */
  // Round robin (circle method). With an odd team count one team sits out each week.
  // The rotation repeats until seasonWeeks is filled; lane pairs shift each week.
  function generateSchedule(league) {
    const ids = league.teams.map(t => t.id);
    const out = [];
    if (ids.length < 2) return out;
    const list = ids.slice();
    if (list.length % 2) list.push(null);
    const n = list.length, rounds = n - 1, pairs = n / 2;
    const rot = list.slice(1);
    const roundPairs = [];
    for (let r = 0; r < rounds; r++) {
      const cur = [list[0]].concat(rot);
      const ps = [];
      for (let i = 0; i < pairs; i++) {
        let a = cur[i], b = cur[n - 1 - i];
        if (r % 2 && i === 0) { const t = a; a = b; b = t; } // alternate home/away for the fixed team
        ps.push([a, b]);
      }
      roundPairs.push(ps);
      rot.unshift(rot.pop());
    }
    const realPairs = Math.floor(ids.length / 2);
    for (let w = 1; w <= league.seasonWeeks; w++) {
      const ps = roundPairs[(w - 1) % rounds];
      const games = ps.filter(p => p[0] && p[1]);
      const byePair = ps.find(p => !p[0] || !p[1]);
      const shift = (w - 1) % Math.max(1, realPairs);
      const matchups = games.map((p, i) => {
        const pairNo = (i + shift) % realPairs;
        return { a: p[0], b: p[1], lanes: (pairNo * 2 + 1) + '-' + (pairNo * 2 + 2) };
      });
      out.push({ week: w, date: league.startDate ? addDays(league.startDate, 7 * (w - 1)) : '', matchups, bye: byePair ? (byePair[0] || byePair[1]) : null });
    }
    return out;
  }

  // Give undated weeks a date one week after the week before them, so holiday gaps
  // in weeks already dated (or bowled) are kept.
  function chainDates(league) {
    let prev = null;
    league.schedule.sort((a, b) => a.week - b.week).forEach(s => {
      if (!s.date) s.date = prev ? addDays(prev, 7) : (league.startDate || '');
      prev = s.date || prev;
    });
  }
  // Rebuild matchups for weeks that haven't been bowled. Bowled weeks keep theirs; every
  // week keeps its date unless opts.redate (the first week's date changed).
  function rebuildSchedule(league, opts) {
    opts = opts || {};
    const old = new Map((league.schedule || []).map(s => [s.week, s]));
    const fresh = generateSchedule(league);
    league.schedule = fresh.map(w => {
      const o = old.get(w.week);
      if (o && weekHasScores(league, w.week)) return o;
      return Object.assign(w, { date: opts.redate || !o ? '' : (o.date || '') });
    });
    chainDates(league);
  }
  // Season length: never shorter than the last week bowled; new weeks are scheduled.
  function setSeasonLength(league, weeks) {
    league.seasonWeeks = Math.max(1, weeks, lastScoredWeek(league));
    rebuildSchedule(league);
  }
  // The most games any bowler has entered in one night (games per night can't go below it).
  function mostGamesEntered(league) {
    let most = 0;
    Object.values(league.results || {}).forEach(r => (r.lines || []).forEach(l => {
      (l.games || []).forEach((g, i) => { if (g != null) most = Math.max(most, i + 1); });
      (l.absentGames || []).forEach((a, i) => { if (a) most = Math.max(most, i + 1); });
    }));
    return most;
  }

  function weekSchedule(league, week) {
    return league.schedule.find(s => s.week === week) || { week, matchups: [], bye: null };
  }
  function opponentOf(league, week, teamId) {
    const m = weekSchedule(league, week).matchups.find(x => x.a === teamId || x.b === teamId);
    return m ? (m.a === teamId ? m.b : m.a) : null;
  }

  /* ---------- lookups ---------- */
  const teamName = (league, id) => { const t = league.teams.find(x => x.id === id); return t ? t.name : (id === null ? 'Bye' : '—'); };
  const bowler = (league, id) => league.bowlers.find(b => b.id === id);
  const bowlerName = (league, id) => id === VACANT ? 'Vacant' : ((bowler(league, id) || {}).name || '—');
  const roster = (league, teamId) => league.bowlers.filter(b => b.teamId === teamId && b.active !== false);
  const subs = league => league.bowlers.filter(b => !b.teamId && b.active !== false);
  const weekNumbers = league => Object.keys(league.results || {}).map(Number).filter(w => weekHasScores(league, w)).sort((a, b) => a - b);

  function validScore(v) { return Number.isInteger(v) && v >= 0 && v <= 300; }

  // A line can be absent for the whole night (absent) or for single games (absentGames[i]).
  const gameAbsent = (l, i) => !!(l.absent || (l.absentGames && l.absentGames[i]));

  function weekHasScores(league, week) {
    const r = league.results && league.results[week];
    return !!(r && r.lines && r.lines.some(l => l.absent || (l.absentGames || []).some(Boolean) || (l.games || []).some(validScore)));
  }

  // Last week with scores entered (0 if none); the "current" week is the one after, capped at season length.
  function lastScoredWeek(league) { const ws = weekNumbers(league); return ws.length ? ws[ws.length - 1] : 0; }
  function currentWeek(league) { return Math.min(league.seasonWeeks || 1, lastScoredWeek(league) + 1) || 1; }

  /* ---------- averages & handicap ---------- */
  // Every real game a bowler has bowled in weeks < beforeWeek (absent/vacant games never count).
  function gamesBefore(league, bowlerId, beforeWeek) {
    const out = [];
    Object.keys(league.results || {}).map(Number).sort((a, b) => a - b).forEach(w => {
      if (w >= beforeWeek) return;
      league.results[w].lines.forEach(l => {
        if (l.bowlerId !== bowlerId || l.absent) return;
        (l.games || []).forEach((g, i) => { if (validScore(g) && !gameAbsent(l, i)) out.push({ week: w, score: g }); });
      });
    });
    return out;
  }

  function averageBefore(league, bowlerId, week) {
    const b = bowler(league, bowlerId) || {};
    const gs = gamesBefore(league, bowlerId, week);
    const pins = gs.reduce((a, g) => a + g.score, 0);
    const n = gs.length;
    const entering = Number.isInteger(b.enteringAvg) && b.enteringAvg > 0 ? b.enteringAvg : null;
    if (n >= (league.establishGames || 1) || (n > 0 && entering == null)) {
      return { avg: Math.floor(pins / n), games: n, pins, source: 'league' };
    }
    if (entering != null) return { avg: entering, games: n, pins, source: 'entering' };
    // New bowler's first night: some leagues set that night's handicap from the scores bowled that night.
    if (league.newBowlerAvg === 'firstNight' && n === 0) {
      const r = league.results && league.results[week];
      const l = r && r.lines.find(x => x.bowlerId === bowlerId && !x.absent);
      const own = l ? (l.games || []).filter((g, i) => validScore(g) && !gameAbsent(l, i)) : [];
      if (own.length) return { avg: Math.floor(own.reduce((a, g) => a + g, 0) / own.length), games: 0, pins: 0, source: 'firstNight' };
    }
    return { avg: league.defaultAvg || 150, games: n, pins, source: 'default' };
  }

  function handicapFor(league, avg) {
    const h = league.handicap || {};
    if (!h.enabled) return 0;
    // integer maths so 31.5 is exactly 31.5: num is hundredths of a pin
    const num = Math.round((h.basis - avg) * h.pct);
    if (num <= 0) return 0;
    const q = Math.floor(num / 100), r = num - q * 100;
    if (h.rounding === 'round') return r >= 50 ? q + 1 : q;                      // .5 rounds up
    if (h.rounding === 'even') return r > 50 || (r === 50 && q % 2) ? q + 1 : q; // .5 to the even pin
    return q;                                                                    // drop the fraction (default)
  }

  /* ---------- weekly lines ---------- */
  function defaultLines(league, teamId) {
    const lines = roster(league, teamId).slice(0, league.teamSize).map(b => ({ teamId, bowlerId: b.id, absent: false, games: new Array(league.gamesPerNight).fill(null) }));
    while (lines.length < league.teamSize) lines.push({ teamId, bowlerId: VACANT, absent: false, games: new Array(league.gamesPerNight).fill(null) });
    return lines;
  }

  function teamLines(league, week, teamId) {
    const r = league.results && league.results[week];
    const saved = r ? r.lines.filter(l => l.teamId === teamId) : [];
    return saved.length ? saved : null;
  }

  // Scored view of one lineup slot.
  function scoreLine(league, week, line) {
    const G = league.gamesPerNight;
    if (line.bowlerId === VACANT) {
      const v = (league.vacancy && league.vacancy.score) || 0;
      const games = new Array(G).fill(v);
      return { line, name: 'Vacant', vacant: true, absent: false, avg: null, hcp: 0, games, hcpGames: games.slice(), series: v * G, hcpSeries: v * G, complete: true, counted: false };
    }
    const a = averageBefore(league, line.bowlerId, week);
    const hcp = handicapFor(league, a.avg);
    const absScore = Math.max(0, a.avg - ((league.absent && league.absent.pinsBelowAvg) || 0));
    const absentGames = Array.from({ length: G }, (_, i) => gameAbsent(line, i));
    const games = Array.from({ length: G }, (_, i) => (absentGames[i] ? absScore : validScore((line.games || [])[i]) ? line.games[i] : null));
    const complete = games.every(g => g != null);
    const hcpGames = games.map(g => (g == null ? null : g + hcp));
    const sum = arr => arr.reduce((x, y) => x + (y || 0), 0);
    return {
      line, name: bowlerName(league, line.bowlerId), vacant: false, absent: !!line.absent,
      avg: a.avg, avgSource: a.source, hcp, games, hcpGames, absentGames, absentScore: absScore,
      series: sum(games), hcpSeries: sum(hcpGames), complete, counted: !line.absent,
    };
  }

  function teamWeek(league, week, teamId) {
    const lines = teamLines(league, week, teamId);
    if (!lines) return { teamId, entered: false, lines: [], scratch: [], hcp: [], total: [], series: 0, hcpSeries: 0, complete: false };
    const scored = lines.map(l => scoreLine(league, week, l));
    const G = league.gamesPerNight;
    const scratch = [], hcp = [], total = [];
    for (let i = 0; i < G; i++) {
      const done = scored.every(s => s.games[i] != null);
      const sc = scored.reduce((a, s) => a + (s.games[i] || 0), 0);
      const hc = scored.reduce((a, s) => a + (s.games[i] != null ? s.hcp : 0), 0);
      scratch.push(done ? sc : null);
      hcp.push(done ? hc : null);
      total.push(done ? sc + hc : null);
    }
    const complete = total.every(t => t != null);
    const sum = arr => arr.reduce((a, x) => a + (x || 0), 0);
    return { teamId, entered: true, lines: scored, scratch, hcp, total, series: sum(scratch), hcpSeries: sum(total), complete };
  }

  // Points for one matchup. Compares handicap totals when handicap is on, scratch otherwise.
  function matchupResult(league, week, m) {
    const A = teamWeek(league, week, m.a), B = teamWeek(league, week, m.b);
    const useH = league.handicap && league.handicap.enabled;
    const pg = (league.points && league.points.perGame) || 0;
    const ps = (league.points && league.points.perSeries) || 0;
    const res = { m, A, B, games: [], ptsA: 0, ptsB: 0, decided: false };
    for (let i = 0; i < league.gamesPerNight; i++) {
      const a = useH ? A.total[i] : A.scratch[i];
      const b = useH ? B.total[i] : B.scratch[i];
      if (a == null || b == null) { res.games.push({ a, b, winner: null }); continue; }
      const winner = a > b ? 'a' : b > a ? 'b' : 'tie';
      res.games.push({ a, b, winner });
      if (winner === 'a') res.ptsA += pg; else if (winner === 'b') res.ptsB += pg; else { res.ptsA += pg / 2; res.ptsB += pg / 2; }
    }
    if (A.complete && B.complete) {
      const a = useH ? A.hcpSeries : A.series, b = useH ? B.hcpSeries : B.series;
      if (a > b) res.ptsA += ps; else if (b > a) res.ptsB += ps; else { res.ptsA += ps / 2; res.ptsB += ps / 2; }
      res.decided = true;
    }
    res.seriesA = useH ? A.hcpSeries : A.series;
    res.seriesB = useH ? B.hcpSeries : B.series;
    return res;
  }

  const ROUNDING_LABEL = { floor: 'Drop the fraction', round: 'Round .5 up', even: 'Round .5 to even' };

  function pointsPerNight(league) {
    return league.gamesPerNight * ((league.points && league.points.perGame) || 0) + ((league.points && league.points.perSeries) || 0);
  }

  /* ---------- standings ---------- */
  function standings(league, uptoWeek) {
    const rows = {};
    league.teams.forEach(t => { rows[t.id] = { teamId: t.id, name: t.name, won: 0, lost: 0, scratch: 0, hcpPins: 0, games: 0, highGame: 0, highSeries: 0, weeks: 0 }; });
    const byeShare = { full: 1, half: 0.5 }[league.byePoints] || 0;
    weekNumbers(league).filter(w => w <= uptoWeek).forEach(w => {
      const sched = weekSchedule(league, w);
      let anyDecided = false;
      sched.matchups.forEach(m => {
        const r = matchupResult(league, w, m);
        if (!r.decided) return; // half-entered matchups don't touch the standings yet
        anyDecided = true;
        const avail = r.games.filter(g => g.winner).length * ((league.points && league.points.perGame) || 0) + (r.decided ? ((league.points && league.points.perSeries) || 0) : 0);
        [[m.a, r.A, r.ptsA], [m.b, r.B, r.ptsB]].forEach(([id, T, pts]) => {
          const row = rows[id];
          if (!row || !T.entered) return;
          row.won += pts;
          row.lost += avail - pts;
          row.scratch += T.series;
          row.hcpPins += T.hcpSeries;
          row.games += T.total.filter(x => x != null).length;
          row.highGame = Math.max(row.highGame, ...T.total.map(x => x || 0));
          if (T.complete) row.highSeries = Math.max(row.highSeries, T.hcpSeries);
          row.weeks++;
        });
      });
      // a team on a bye earns the bye setting's share of a night's points once the week is bowled
      if (sched.bye && anyDecided && byeShare && rows[sched.bye]) {
        rows[sched.bye].won += pointsPerNight(league) * byeShare;
        rows[sched.bye].byes = (rows[sched.bye].byes || 0) + 1;
      }
    });
    const list = Object.values(rows).sort((a, b) => b.won - a.won || b.hcpPins - a.hcpPins || a.name.localeCompare(b.name));
    list.forEach((r, i) => { r.place = i > 0 && r.won === list[i - 1].won && r.hcpPins === list[i - 1].hcpPins ? list[i - 1].place : i + 1; });
    return list;
  }

  /* ---------- individual stats ---------- */
  function bowlerStats(league, uptoWeek) {
    const next = uptoWeek + 1;
    return league.bowlers.map(b => {
      const gs = gamesBefore(league, b.id, next);
      const pins = gs.reduce((a, g) => a + g.score, 0);
      const byWeek = {};
      gs.forEach(g => { (byWeek[g.week] = byWeek[g.week] || []).push(g.score); });
      const seriesList = Object.values(byWeek).filter(a => a.length === league.gamesPerNight).map(a => a.reduce((x, y) => x + y, 0));
      const cur = averageBefore(league, b.id, next);
      return {
        id: b.id, name: b.name, teamId: b.teamId, team: b.teamId ? teamName(league, b.teamId) : 'Sub', isMe: !!b.isMe,
        games: gs.length, pins, avg: gs.length ? Math.floor(pins / gs.length) : null,
        highGame: gs.length ? Math.max(...gs.map(g => g.score)) : null,
        highSeries: seriesList.length ? Math.max(...seriesList) : null,
        currentAvg: cur.avg, avgSource: cur.source, hcp: handicapFor(league, cur.avg),
      };
    }).sort((a, b) => (b.avg || 0) - (a.avg || 0) || a.name.localeCompare(b.name));
  }

  /* ---------- weekly highlights ---------- */
  function weekHighlights(league, week) {
    const bowled = []; // real bowlers who bowled this week
    league.teams.forEach(t => {
      const T = teamWeek(league, week, t.id);
      T.lines.forEach(s => { if (!s.vacant && !s.absent && s.games.some(g => g != null)) bowled.push(Object.assign({ teamId: t.id, team: t.name }, s)); });
    });
    const games = [];
    bowled.forEach(s => s.games.forEach((g, i) => { if (g != null && !s.absentGames[i]) games.push({ name: s.name, team: s.team, bowlerId: s.line.bowlerId, score: g, hcpScore: g + s.hcp, game: i + 1 }); }));
    const fullSeries = bowled.filter(s => s.complete && !s.absentGames.some(Boolean)).map(s => ({ name: s.name, team: s.team, bowlerId: s.line.bowlerId, score: s.series, hcpScore: s.hcpSeries, avg: s.avg, over: s.series - s.avg * league.gamesPerNight }));
    const top = (arr, key, n) => arr.slice().sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name)).slice(0, n);

    const milestones = [];
    games.forEach(g => {
      if (g.score === 300) milestones.push({ kind: 'perfect', text: g.name + ' bowled a 300 perfect game!', name: g.name });
      else if (g.score >= 250) milestones.push({ kind: 'g250', text: g.name + ' rolled a ' + g.score + ' (game ' + g.game + ')', name: g.name });
      else if (g.score >= 200) {
        const prior = gamesBefore(league, g.bowlerId, week).some(x => x.score >= 200);
        const earlierTonight = games.some(x => x.bowlerId === g.bowlerId && x.game < g.game && x.score >= 200);
        if (!prior && !earlierTonight) milestones.push({ kind: 'first200', text: g.name + ' — first league 200 game (' + g.score + ')', name: g.name });
      }
    });
    fullSeries.forEach(s => {
      if (s.score >= 800) milestones.push({ kind: 's800', text: s.name + ' fired an ' + s.score + ' series!', name: s.name });
      else if (s.score >= 700) milestones.push({ kind: 's700', text: s.name + ' shot a ' + s.score + ' series', name: s.name });
      else if (s.score >= 600 && league.gamesPerNight === 3) milestones.push({ kind: 's600', text: s.name + ' shot a ' + s.score + ' series', name: s.name });
    });

    const teamGames = [], teamSeries = [];
    league.teams.forEach(t => {
      const T = teamWeek(league, week, t.id);
      T.total.forEach((x, i) => { if (x != null) teamGames.push({ name: t.name, score: T.scratch[i], hcpScore: x }); });
      if (T.complete) teamSeries.push({ name: t.name, score: T.series, hcpScore: T.hcpSeries });
    });

    return {
      scratchGame: top(games, 'score', 3), scratchSeries: top(fullSeries, 'score', 3),
      hcpGame: top(games, 'hcpScore', 3), hcpSeries: top(fullSeries, 'hcpScore', 3),
      overAvg: top(fullSeries.filter(s => s.over > 0), 'over', 3),
      teamGame: top(teamGames, 'hcpScore', 1), teamSeries: top(teamSeries, 'hcpScore', 1),
      milestones, bowledCount: bowled.length,
    };
  }

  /* ---------- recap (email / share) ---------- */
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T12:00:00');
    return isNaN(d) ? iso : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
  const escH = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Thousands separators for display (never in CSV exports).
  const fmtN = n => (n == null || n === '' ? '–' : Number(n).toLocaleString('en-US'));
  const fmtPts = n => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  function pointsLine(league) {
    const p = league.points || {};
    const parts = [];
    if (p.perGame) parts.push(fmtPts(p.perGame) + ' per game won');
    if (p.perSeries) parts.push(fmtPts(p.perSeries) + ' for total pins');
    return (parts.join(' + ') || 'none') + ' = ' + fmtPts(pointsPerNight(league)) + ' a night';
  }
  function byeNote(league) {
    const share = { full: 1, half: 0.5 }[league.byePoints] || 0;
    return share ? ' (+' + fmtPts(pointsPerNight(league) * share) + ' pts)' : '';
  }

  function recapData(league, week, centerName) {
    const sched = weekSchedule(league, week);
    return {
      league, week, date: weekDate(league, week), centerName: centerName || '',
      results: sched.matchups.map(m => matchupResult(league, week, m)),
      bye: sched.bye,
      standings: standings(league, week),
      highs: weekHighlights(league, week),
      averages: bowlerStats(league, week).filter(b => b.games > 0),
      next: week < league.seasonWeeks ? weekSchedule(league, week + 1) : null,
      useH: !!(league.handicap && league.handicap.enabled),
    };
  }

  function recapText(league, week, centerName) {
    const d = recapData(league, week, centerName);
    const L = [];
    const pad = (s, n) => String(s).padEnd(n).slice(0, n);
    const lpad = (s, n) => String(s).padStart(n);
    L.push(league.name.toUpperCase() + ' — WEEK ' + week + ' RECAP');
    L.push([fmtDate(d.date), d.centerName].filter(Boolean).join(' · '));
    L.push('');
    L.push('RESULTS');
    d.results.forEach(r => {
      if (!r.A.entered && !r.B.entered) { L.push('  ' + teamName(league, r.m.a) + ' vs ' + teamName(league, r.m.b) + ' — not entered yet'); return; }
      if (!r.decided) { L.push('  ' + teamName(league, r.m.a) + ' vs ' + teamName(league, r.m.b) + ' — scores incomplete'); return; }
      L.push('  ' + teamName(league, r.m.a) + ' ' + fmtPts(r.ptsA) + ' – ' + fmtPts(r.ptsB) + ' pts ' + teamName(league, r.m.b) + '   (' + fmtN(r.seriesA) + ' to ' + fmtN(r.seriesB) + (d.useH ? ' w/ hcp' : '') + ')');
    });
    if (d.bye) L.push('  Bye: ' + teamName(league, d.bye) + byeNote(league));
    L.push('');
    L.push('STANDINGS');
    L.push('  ' + pad('#', 3) + pad('Team', 22) + lpad('Pts W', 7) + lpad('Pts L', 7) + lpad('Pins', 8));
    d.standings.forEach(s => L.push('  ' + pad(s.place, 3) + pad(s.name, 22) + lpad(fmtPts(s.won), 7) + lpad(fmtPts(s.lost), 7) + lpad(fmtN(d.useH ? s.hcpPins : s.scratch), 8)));
    L.push('  Points: ' + pointsLine(league));
    L.push('');
    L.push('HIGHS THIS WEEK');
    const hl = (label, arr) => { if (arr.length) L.push('  ' + label + ': ' + arr.map(x => x.name + ' ' + x.score).join(', ')); };
    const hlH = (label, arr) => { if (arr.length) L.push('  ' + label + ': ' + arr.map(x => x.name + ' ' + x.hcpScore).join(', ')); };
    hl('Scratch game', d.highs.scratchGame);
    hl('Scratch series', d.highs.scratchSeries);
    if (d.useH) { hlH('Handicap game', d.highs.hcpGame); hlH('Handicap series', d.highs.hcpSeries); }
    if (d.highs.overAvg.length) L.push('  Most pins over average: ' + d.highs.overAvg.map(x => x.name + ' +' + x.over).join(', '));
    if (d.highs.milestones.length) {
      L.push('');
      L.push('SHOUT-OUTS');
      d.highs.milestones.forEach(m => L.push('  * ' + m.text));
    }
    L.push('');
    L.push('AVERAGES');
    L.push('  ' + pad('Bowler', 22) + pad('Team', 16) + lpad('Avg', 5) + lpad('Gms', 5) + (d.useH ? lpad('Hcp', 5) : ''));
    d.averages.forEach(b => L.push('  ' + pad(b.name, 22) + pad(b.team, 16) + lpad(b.avg, 5) + lpad(b.games, 5) + (d.useH ? lpad(b.hcp, 5) : '')));
    if (d.next && d.next.matchups.length) {
      L.push('');
      L.push('NEXT WEEK — ' + fmtDate(d.next.date || weekDate(league, week + 1)));
      d.next.matchups.forEach(m => L.push('  Lanes ' + m.lanes + ': ' + teamName(league, m.a) + ' vs ' + teamName(league, m.b)));
      if (d.next.bye) L.push('  Bye: ' + teamName(league, d.next.bye));
    }
    L.push('');
    L.push('Sent with BowlBoard');
    return L.join('\n');
  }

  // Email-safe HTML: tables + inline styles only, light background (renders in Gmail/Outlook).
  function recapHTML(league, week, centerName) {
    const d = recapData(league, week, centerName);
    const C = { navy: '#0b1222', blue: '#2563eb', cyan: '#0891b2', line: '#e2e8f0', muted: '#64748b', bg: '#f8fafc' };
    const th = 'padding:6px 8px;text-align:left;font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:' + C.muted + ';border-bottom:2px solid ' + C.line + ';';
    const thr = th + 'text-align:right;';
    const td = 'padding:7px 8px;border-bottom:1px solid ' + C.line + ';font-size:14px;';
    const tdr = td + 'text-align:right;font-variant-numeric:tabular-nums;';
    const h2 = t => '<h2 style="margin:26px 0 8px;font-size:15px;color:' + C.navy + ';text-transform:uppercase;letter-spacing:.8px;border-left:4px solid ' + C.cyan + ';padding-left:8px">' + escH(t) + '</h2>';
    const table = (head, rows) => '<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse">' + head + rows + '</table>';
    let h = '<div style="background:' + C.bg + ';padding:16px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">';
    h += '<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid ' + C.line + ';border-radius:12px;overflow:hidden">';
    h += '<div style="background:' + C.navy + ';padding:20px 22px"><div style="color:#22d3ee;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:700">Week ' + week + ' recap</div>' +
      '<div style="color:#fff;font-size:24px;font-weight:800;margin-top:4px">' + escH(league.name) + '</div>' +
      '<div style="color:#94a3b8;font-size:13px;margin-top:4px">' + escH([fmtDate(d.date), d.centerName].filter(Boolean).join(' · ')) + '</div></div>';
    h += '<div style="padding:4px 22px 22px">';

    if (d.highs.milestones.length) {
      h += '<div style="margin-top:18px;background:#ecfeff;border:1px solid #a5f3fc;border-radius:10px;padding:12px 14px">' +
        '<div style="font-weight:800;color:' + C.cyan + ';font-size:13px;text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px">Shout-outs</div>' +
        d.highs.milestones.map(m => '<div style="font-size:14px;margin:3px 0">🎳 ' + escH(m.text) + '</div>').join('') + '</div>';
    }

    h += h2('Results');
    h += table('<tr><th style="' + th + '">Matchup</th><th style="' + thr + '">Pins' + (d.useH ? ' (hcp)' : '') + '</th><th style="' + thr + '">Points</th></tr>',
      d.results.map(r => {
        if (!r.decided) {
          return '<tr><td style="' + td + '">' + escH(teamName(league, r.m.a)) + ' vs ' + escH(teamName(league, r.m.b)) + '<div style="font-size:12px;color:' + C.muted + '">Lanes ' + escH(r.m.lanes) + '</div></td><td colspan="2" style="' + tdr + 'color:' + C.muted + '">' + (r.A.entered || r.B.entered ? 'Scores incomplete' : 'Not entered yet') + '</td></tr>';
        }
        const aWin = r.ptsA > r.ptsB, bWin = r.ptsB > r.ptsA;
        return '<tr><td style="' + td + '"><span style="' + (aWin ? 'font-weight:700' : '') + '">' + escH(teamName(league, r.m.a)) + '</span> vs <span style="' + (bWin ? 'font-weight:700' : '') + '">' + escH(teamName(league, r.m.b)) + '</span><div style="font-size:12px;color:' + C.muted + '">Lanes ' + escH(r.m.lanes) + ' · games ' + r.games.map(g => g.a + '–' + g.b).join(', ') + '</div></td>' +
          '<td style="' + tdr + '">' + fmtN(r.seriesA) + ' – ' + fmtN(r.seriesB) + '</td><td style="' + tdr + 'font-weight:700">' + fmtPts(r.ptsA) + '–' + fmtPts(r.ptsB) + ' pts</td></tr>';
      }).join('') + (d.bye ? '<tr><td colspan="3" style="' + td + 'color:' + C.muted + '">Bye: ' + escH(teamName(league, d.bye) + byeNote(league)) + '</td></tr>' : ''));

    h += h2('Standings');
    h += table('<tr><th style="' + th + '">#</th><th style="' + th + '">Team</th><th style="' + thr + '">Pts won</th><th style="' + thr + '">Pts lost</th><th style="' + thr + '">' + (d.useH ? 'Hcp pins' : 'Pins') + '</th><th style="' + thr + '">High ser.</th></tr>',
      d.standings.map(s => '<tr><td style="' + td + 'color:' + C.muted + '">' + s.place + '</td><td style="' + td + 'font-weight:600">' + escH(s.name) + '</td><td style="' + tdr + 'font-weight:700">' + fmtPts(s.won) + '</td><td style="' + tdr + '">' + fmtPts(s.lost) + '</td><td style="' + tdr + '">' + fmtN(d.useH ? s.hcpPins : s.scratch) + '</td><td style="' + tdr + '">' + (s.highSeries ? fmtN(s.highSeries) : '–') + '</td></tr>').join(''));

    h += '<div style="font-size:12px;color:' + C.muted + ';margin-top:6px">Points: ' + escH(pointsLine(league)) + '</div>';
    const hiBlock = (label, arr, key) => arr.length ? '<tr><td style="' + td + 'color:' + C.muted + ';width:38%">' + label + '</td><td style="' + td + '">' + arr.map((x, i) => (i === 0 ? '<b>' : '') + escH(x.name) + ' ' + fmtN(x[key]) + (i === 0 ? '</b>' : '')).join(' · ') + '</td></tr>' : '';
    h += h2('This week’s highs');
    h += table('', hiBlock('Scratch game', d.highs.scratchGame, 'score') + hiBlock('Scratch series', d.highs.scratchSeries, 'score') +
      (d.useH ? hiBlock('Handicap game', d.highs.hcpGame, 'hcpScore') + hiBlock('Handicap series', d.highs.hcpSeries, 'hcpScore') : '') +
      (d.highs.overAvg.length ? '<tr><td style="' + td + 'color:' + C.muted + '">Over average</td><td style="' + td + '">' + d.highs.overAvg.map((x, i) => (i === 0 ? '<b>' : '') + escH(x.name) + ' +' + x.over + (i === 0 ? '</b>' : '')).join(' · ') + '</td></tr>' : '') +
      hiBlock('Team game', d.highs.teamGame, 'hcpScore') + hiBlock('Team series', d.highs.teamSeries, 'hcpScore'));

    h += h2('Averages');
    h += table('<tr><th style="' + th + '">Bowler</th><th style="' + th + '">Team</th><th style="' + thr + '">Avg</th><th style="' + thr + '">Games</th><th style="' + thr + '">High</th>' + (d.useH ? '<th style="' + thr + '">Hcp</th>' : '') + '</tr>',
      d.averages.map(b => '<tr><td style="' + td + '">' + escH(b.name) + '</td><td style="' + td + 'color:' + C.muted + '">' + escH(b.team) + '</td><td style="' + tdr + 'font-weight:700">' + b.avg + '</td><td style="' + tdr + '">' + b.games + '</td><td style="' + tdr + '">' + b.highGame + '</td>' + (d.useH ? '<td style="' + tdr + '">' + b.hcp + '</td>' : '') + '</tr>').join(''));

    if (d.next && d.next.matchups.length) {
      h += h2('Next week · ' + fmtDate(d.next.date || weekDate(league, week + 1)));
      h += table('', d.next.matchups.map(m => '<tr><td style="' + td + 'color:' + C.muted + ';width:90px">Lanes ' + escH(m.lanes) + '</td><td style="' + td + '">' + escH(teamName(league, m.a)) + ' vs ' + escH(teamName(league, m.b)) + '</td></tr>').join('') +
        (d.next.bye ? '<tr><td style="' + td + 'color:' + C.muted + '">Bye</td><td style="' + td + '">' + escH(teamName(league, d.next.bye)) + '</td></tr>' : ''));
    }
    h += '<div style="margin-top:24px;font-size:12px;color:' + C.muted + ';text-align:center">Sent with BowlBoard</div>';
    h += '</div></div></div>';
    return h;
  }

  function recapSubject(league, week) {
    return league.name + ' — Week ' + week + ' results' + (weekDate(league, week) ? ' (' + fmtDate(weekDate(league, week)) + ')' : '');
  }

  function recipients(league) {
    const list = league.bowlers.map(b => (b.email || '').trim()).concat(String(league.ccEmails || '').split(/[,;\s]+/));
    return Array.from(new Set(list.filter(e => /.+@.+\..+/.test(e))));
  }

  /* ---------- CSV ---------- */
  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const toCSV = rows => rows.map(r => r.map(csvCell).join(',')).join('\n');

  function parseCSV(text) {
    const rows = [];
    let row = [], cell = '', q = false;
    // Excel in much of Europe saves CSV with semicolons; if the first line has more of those than commas, split on them.
    const head = String(text).split(/\r?\n/, 1)[0].replace(/"[^"]*"/g, '');
    const semi = (head.match(/;/g) || []).length > (head.match(/,/g) || []).length;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if ((semi ? c === ';' : c === ',') || c === '\t') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.map(r => r.map(x => x.trim())).filter(r => r.some(x => x !== ''));
  }

  // Roster import. Columns (header optional, any order if headed): Team, Bowler/Name, Email, Average.
  // A blank team (or "sub") adds the bowler to the sub list.
  function rosterFromCSV(text) {
    const rows = parseCSV(text);
    if (!rows.length) return { ok: false, error: 'Nothing to import.' };
    const head = rows[0].map(h => h.toLowerCase());
    let idx = { team: 0, name: 1, email: 2, avg: 3 };
    let body = rows;
    if (head.some(h => /team|bowler|name|email|avg|average/.test(h))) {
      const find = re => head.findIndex(h => re.test(h));
      idx = { team: find(/team/), name: find(/bowler|name/), email: find(/mail/), avg: find(/avg|average/) };
      body = rows.slice(1);
      if (idx.name < 0) return { ok: false, error: 'Need a "Bowler" or "Name" column.' };
    }
    const out = body.map(r => ({
      team: idx.team >= 0 ? (r[idx.team] || '') : '',
      name: r[idx.name] || '',
      email: idx.email >= 0 ? (r[idx.email] || '') : '',
      avg: idx.avg >= 0 ? parseInt(r[idx.avg], 10) : NaN,
    })).filter(r => r.name);
    if (!out.length) return { ok: false, error: 'No bowlers found.' };
    return { ok: true, rows: out };
  }

  // Merge imported rows into a league (creates teams as needed, skips duplicate names).
  function applyRoster(league, rows, makeId) {
    makeId = makeId || uid;
    let teams = 0, bowlers = 0, skipped = 0;
    rows.forEach(r => {
      let teamId = '';
      const tn = r.team.trim();
      if (tn && !/^subs?$/i.test(tn)) {
        let t = league.teams.find(x => x.name.toLowerCase() === tn.toLowerCase());
        if (!t) { t = { id: makeId(), name: tn }; league.teams.push(t); teams++; }
        teamId = t.id;
      }
      if (league.bowlers.some(b => b.name.toLowerCase() === r.name.toLowerCase())) { skipped++; return; }
      league.bowlers.push({ id: makeId(), name: r.name, email: r.email, enteringAvg: Number.isInteger(r.avg) && r.avg > 0 ? r.avg : null, teamId, isMe: false, active: true });
      bowlers++;
    });
    return { teams, bowlers, skipped };
  }

  /* ---------- importing weeks already bowled ----------
   * Columns (header required, any order): Week, Team, Bowler, Game 1..N
   * (or G1 / Gm1), optional Status ("absent" / "vacant"). This is the same
   * layout the app's own "week scores" CSV export writes, so files round-trip.
   * Bowlers not on the roster are added to the named team (entering average blank).
   */
  function scoresFromCSV(league, text) {
    const rows = parseCSV(text);
    if (rows.length < 2) return { ok: false, error: 'Need a header row and at least one score row.' };
    const head = rows[0].map(h => h.toLowerCase().trim());
    const col = re => head.findIndex(h => re.test(h));
    const iWeek = col(/^(week|wk)\b/), iName = col(/^(bowler|name|player)/), iStatus = col(/^(status|note)/);
    let iTeam = col(/^team( name)?$/); if (iTeam < 0) iTeam = col(/^team(?!\s*(#|no|num))/);
    const gameCols = head.map((h, i) => [h, i]).filter(([h]) => /^(game|gm|g)\s*\d+$/.test(h.replace(/\s+/g, ' ')))
      .map(([h, i]) => [parseInt(h.replace(/\D/g, ''), 10), i]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    if (iWeek < 0 || iTeam < 0 || iName < 0) return { ok: false, error: 'Need Week, Team and Bowler columns.' };
    if (!gameCols.length) return { ok: false, error: 'Need game columns (Game 1, Game 2… or G1, G2…).' };
    const weeks = {}, errors = [], newBowlers = [], teamsSeen = new Set();
    const findTeam = n => league.teams.find(t => t.name.toLowerCase() === n.toLowerCase());
    const pending = {}; // new bowler name -> teamId
    rows.slice(1).forEach((r, k) => {
      const line = k + 2;
      const w = parseInt(r[iWeek], 10);
      if (!Number.isInteger(w) || w < 1 || w > league.seasonWeeks) { errors.push('Row ' + line + ': week "' + (r[iWeek] || '') + '" isn’t 1–' + league.seasonWeeks); return; }
      const team = findTeam(r[iTeam] || '');
      if (!team) { errors.push('Row ' + line + ': no team called "' + (r[iTeam] || '') + '"'); return; }
      const name = (r[iName] || '').trim();
      if (!name) { errors.push('Row ' + line + ': bowler name missing'); return; }
      const status = iStatus >= 0 ? (r[iStatus] || '').toLowerCase() : '';
      let bowlerId;
      if (status === 'vacant' || /^vacant$/i.test(name)) bowlerId = VACANT;
      else {
        const b = league.bowlers.find(x => x.name.toLowerCase() === name.toLowerCase());
        if (b) bowlerId = b.id;
        else {
          const key = name.toLowerCase();
          if (!pending[key]) { pending[key] = { name, teamId: team.id }; newBowlers.push({ name, team: team.name }); }
          bowlerId = 'new:' + key;
        }
      }
      const games = gameCols.slice(0, league.gamesPerNight).map(i => {
        const v = (r[i] || '').trim();
        if (v === '') return null;
        const n = parseInt(v, 10);
        return validScore(n) ? n : NaN;
      });
      if (games.some(g => Number.isNaN(g))) { errors.push('Row ' + line + ': scores must be 0–300'); return; }
      while (games.length < league.gamesPerNight) games.push(null);
      const absentGames = Array.from({ length: league.gamesPerNight }, (_, i) => new RegExp('\\bg' + (i + 1) + '\\s*absent').test(status));
      const allAbsent = status === 'absent' || absentGames.every(Boolean);
      const lineOut = { teamId: team.id, bowlerId, absent: allAbsent, games: allAbsent ? games.map(() => null) : games.map((g, i) => (absentGames[i] ? null : g)) };
      if (!allAbsent && absentGames.some(Boolean)) lineOut.absentGames = absentGames;
      (weeks[w] = weeks[w] || []).push(lineOut);
      teamsSeen.add(w + ':' + team.id);
    });
    const count = Object.values(weeks).reduce((a, l) => a + l.length, 0);
    if (!count) return { ok: false, error: errors[0] || 'No score rows found.', errors };
    return { ok: true, weeks, errors, newBowlers, pending, count, weekList: Object.keys(weeks).map(Number).sort((a, b) => a - b) };
  }

  // Write a parsed import into the league: each (week, team) in the file replaces that team's lineup.
  function applyScores(league, parsed, makeId) {
    makeId = makeId || uid;
    const ids = {};
    Object.keys(parsed.pending).forEach(k => {
      const p = parsed.pending[k];
      const b = { id: makeId(), name: p.name, email: '', enteringAvg: null, teamId: p.teamId, isMe: false, active: true };
      league.bowlers.push(b);
      ids['new:' + k] = b.id;
    });
    Object.keys(parsed.weeks).forEach(w => {
      const lines = parsed.weeks[w].map(l => Object.assign({}, l, { bowlerId: ids[l.bowlerId] || l.bowlerId, links: [] }));
      const teams = new Set(lines.map(l => l.teamId));
      const r = league.results[w] || (league.results[w] = { lines: [], final: false });
      r.lines = r.lines.filter(l => !teams.has(l.teamId)).concat(lines);
      r.updatedAt = new Date().toISOString();
    });
    return { weeks: parsed.weekList.length, lines: parsed.count, added: Object.keys(parsed.pending).length };
  }

  /* ---------- importing a whole season (LeagueSecretary / BLS "weekly scores" export) ----------
   * Input: a table (array of rows, first row = headers) with, in any order:
   *   Week, Date, Team, Bowler, G1..Gn   (required)
   *   Team #, Avg, Hdcp, Lane, Note/Status, +/- Avg   (used when present)
   * The league's rules are worked out from the data and then checked row by row:
   *   handicap basis / percent / rounding (from Avg -> Hdcp), absent penalty (Avg - absent score),
   *   how many games an entering average is kept, whether new bowlers get a first-night average,
   *   matchups from lane pairs (odd lane vs the next even lane).
   */
  function parseDateCell(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0'); }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[0] : '';
  }

  function seasonRecords(table) {
    if (!Array.isArray(table) || table.length < 2) return { ok: false, error: 'The file has no rows.' };
    const head = table[0].map(h => String(h == null ? '' : h).trim().toLowerCase());
    const col = re => head.findIndex(h => re.test(h));
    const c = {
      week: col(/^(week|wk)$/), date: col(/^date$/), teamNo: col(/^team\s*(#|no|num)/), team: col(/^team( name)?$/),
      bowler: col(/^(bowler|name|player)( name)?$/), avg: col(/^(avg|average)$/), hdcp: col(/^(hdcp|hcp|handicap)$/),
      lane: col(/^lane$/), note: col(/^(note|notes|status)$/), pm: col(/^\+\/-/),
    };
    const gameCols = head.map((h, i) => [h, i]).filter(([h]) => /^(g|gm|game)\s*\d+$/.test(h))
      .map(([h, i]) => [parseInt(h.replace(/\D/g, ''), 10), i]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    const missing = ['week', 'team', 'bowler'].filter(k => c[k] < 0);
    if (missing.length || !gameCols.length) return { ok: false, error: 'This doesn’t look like a weekly scores export. It needs Week, Team, Bowler and G1, G2… columns.' };
    const num = v => (v === '' || v == null ? null : Number(v));
    const recs = [], skipped = [];
    table.slice(1).forEach((r, k) => {
      if (!r || r.every(v => v == null || v === '')) return;
      const week = parseInt(r[c.week], 10);
      const team = String(r[c.team] == null ? '' : r[c.team]).trim(), name = String(r[c.bowler] == null ? '' : r[c.bowler]).trim();
      if (!Number.isInteger(week) || week < 1 || !team || !name) { skipped.push(k + 2); return; }
      const note = c.note >= 0 ? String(r[c.note] || '').toLowerCase() : '';
      const games = gameCols.map(i => num(r[i]));
      const absentGames = games.map((_, i) => /\babsent\b/.test(note) && (new RegExp('\\bg' + (i + 1) + '\\s*absent').test(note) || !/\bg\d/.test(note)));
      recs.push({
        row: k + 2, week, date: c.date >= 0 ? parseDateCell(r[c.date]) : '', teamNo: c.teamNo >= 0 ? num(r[c.teamNo]) : null, team, name,
        avg: c.avg >= 0 ? num(r[c.avg]) : null, hdcp: c.hdcp >= 0 ? num(r[c.hdcp]) : null, lane: c.lane >= 0 ? num(r[c.lane]) : null,
        pm: c.pm >= 0 ? num(r[c.pm]) : null, games, absentGames, vacant: /^vacan/i.test(name),
      });
    });
    if (!recs.length) return { ok: false, error: 'No score rows found.' };
    return { ok: true, recs, skipped, gamesPerNight: gameCols.length, has: { avg: c.avg >= 0, hdcp: c.hdcp >= 0, lane: c.lane >= 0, date: c.date >= 0 } };
  }

  function mode(arr) {
    const m = new Map(); let best = null, bc = 0;
    arr.forEach(v => { const n = (m.get(v) || 0) + 1; m.set(v, n); if (n > bc) { bc = n; best = v; } });
    return best;
  }

  // Replays each bowler's season under a candidate rule and counts how many Avg cells it reproduces.
  function simulateAverages(recs, keepGames, firstNight) {
    const by = new Map();
    recs.filter(r => !r.vacant && r.avg != null).sort((a, b) => a.week - b.week).forEach(r => { if (!by.has(r.name)) by.set(r.name, []); by.get(r.name).push(r); });
    let ok = 0, tot = 0;
    const newBowlers = new Set();
    by.forEach((rs, name) => {
      const first = rs[0];
      const own = first.games.filter((g, i) => g != null && !first.absentGames[i]);
      const isNew = firstNight && own.length && !first.absentGames.some(Boolean) && first.avg === Math.floor(own.reduce((a, g) => a + g, 0) / own.length) && (first.pm == null || first.pm === 0);
      if (isNew) newBowlers.add(name);
      const entering = isNew ? null : first.avg;
      let pins = 0, n = 0;
      rs.forEach(r => {
        const exp = n === 0 ? (isNew ? first.avg : entering) : (entering != null && n < keepGames ? entering : Math.floor(pins / n));
        tot++; if (exp === r.avg) ok++;
        r.games.forEach((g, i) => { if (g != null && !r.absentGames[i]) { pins += g; n++; } });
      });
    });
    return { ok, tot, newBowlers };
  }

  function importSeason(table, opts) {
    opts = opts || {};
    const P = seasonRecords(table);
    if (!P.ok) return P;
    const recs = P.recs, G = P.gamesPerNight, warnings = [];
    if (P.skipped.length) warnings.push(P.skipped.length + ' row' + (P.skipped.length === 1 ? '' : 's') + ' without a week, team or bowler were skipped.');
    const makeId = opts.makeId || uid;

    // teams, in team-number order when the file has one
    const teamOrder = new Map();
    recs.forEach(r => { if (!teamOrder.has(r.team)) teamOrder.set(r.team, r.teamNo == null ? 1e9 + teamOrder.size : r.teamNo); });
    const teams = Array.from(teamOrder.entries()).sort((a, b) => a[1] - b[1]).map(([name]) => ({ id: makeId(), name }));
    const teamId = name => teams.find(t => t.name === name).id;

    const weeks = Array.from(new Set(recs.map(r => r.week))).sort((a, b) => a - b);
    const lastWeek = weeks[weeks.length - 1];
    const perTeamWeek = new Map();
    recs.forEach(r => { const k = r.week + '|' + r.team; perTeamWeek.set(k, (perTeamWeek.get(k) || 0) + 1); });
    const teamSize = Math.max(...perTeamWeek.values());
    const dates = {};
    recs.forEach(r => { if (r.date && !dates[r.week]) dates[r.week] = r.date; });
    const startDate = dates[weeks[0]] ? addDays(dates[weeks[0]], -7 * (weeks[0] - 1)) : '';

    // handicap: find basis / percent / rounding that reproduce the Hdcp column
    let handicap = { enabled: true, basis: 220, pct: 90, rounding: 'floor' }, hMatch = null;
    const hr = recs.filter(r => r.avg != null && r.hdcp != null && !r.vacant);
    if (hr.length) {
      if (hr.every(r => r.hdcp === 0)) { handicap.enabled = false; hMatch = { ok: hr.length, tot: hr.length }; }
      else {
        let best = null;
        for (let basis = 150; basis <= 250; basis += 5) for (let pct = 50; pct <= 100; pct += 5) for (const rounding of ['floor', 'round', 'even']) {
          const h = { handicap: { enabled: true, basis, pct, rounding } };
          let ok = 0;
          for (const r of hr) if (handicapFor(h, r.avg) === r.hdcp) ok++;
          if (!best || ok > best.ok) best = { ok, basis, pct, rounding };
          if (ok === hr.length) break;
        }
        handicap = { enabled: true, basis: best.basis, pct: best.pct, rounding: best.rounding };
        hMatch = { ok: best.ok, tot: hr.length };
        if (best.ok < hr.length) warnings.push('Handicap matched ' + best.ok + ' of ' + hr.length + ' rows with ' + best.pct + '% of ' + best.basis + '. Check it in Settings.');
      }
    } else warnings.push('No handicap column, so handicap is set to 90% of 220. Check it in Settings.');

    // absent penalty: average minus the score an absent bowler got
    const absDiffs = [];
    recs.forEach(r => r.absentGames.forEach((a, i) => { if (a && r.avg != null && r.games[i] != null) absDiffs.push(r.avg - r.games[i]); }));
    const pinsBelowAvg = absDiffs.length ? Math.max(0, mode(absDiffs)) : 10;

    // how long an entering average is kept, and the first-night rule for new bowlers
    let keep = { n: 9, ok: 0, tot: 0 }, firstNight = false, newBowlers = new Set();
    if (P.has.avg) {
      let best = null;
      for (const fn of [true, false]) for (const n of [1, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30]) {
        const sim = simulateAverages(recs, n, fn);
        if (!best || sim.ok > best.ok) best = Object.assign({ n, fn }, sim);
      }
      keep = { n: best.n, ok: best.ok, tot: best.tot };
      firstNight = best.fn && best.newBowlers.size > 0;
      newBowlers = best.newBowlers;
      if (best.ok < best.tot) warnings.push('Averages matched ' + best.ok + ' of ' + best.tot + ' rows. Differences usually mean a bowler’s average was set by hand in the other program.');
    } else warnings.push('No Avg column, so entering averages are blank.');

    // bowlers: rosters = each team's lineup in the last week; everyone else is a sub
    const firstRec = new Map(), lastTeam = new Map();
    recs.slice().sort((a, b) => a.week - b.week).forEach(r => { if (r.vacant) return; if (!firstRec.has(r.name)) firstRec.set(r.name, r); });
    recs.filter(r => r.week === lastWeek && !r.vacant).forEach(r => lastTeam.set(r.name, r.team));
    const bowlers = Array.from(firstRec.entries()).map(([name, r]) => ({
      id: makeId(), name, email: '', enteringAvg: newBowlers.has(name) || r.avg == null ? null : r.avg,
      teamId: lastTeam.has(name) ? teamId(lastTeam.get(name)) : '', isMe: false, active: true,
    }));
    const bowlerId = name => (bowlers.find(b => b.name === name) || {}).id;

    // vacancy score, if the file has vacant rows
    const vacScores = [];
    recs.filter(r => r.vacant).forEach(r => r.games.forEach(g => { if (g != null) vacScores.push(g); }));

    // results
    const results = {};
    weeks.forEach(w => {
      results[w] = { lines: recs.filter(r => r.week === w).map(r => {
        const all = r.absentGames.every(Boolean);
        const line = { teamId: teamId(r.team), bowlerId: r.vacant ? VACANT : bowlerId(r.name), absent: all && !r.vacant, games: r.games.map((g, i) => (r.absentGames[i] || r.vacant ? null : g)), links: [] };
        if (!all && r.absentGames.some(Boolean)) line.absentGames = r.absentGames.slice();
        return line;
      }), final: true, updatedAt: new Date().toISOString() };
    });

    // schedule: odd lane vs the next even lane
    const schedule = [];
    let laneWeeks = 0;
    const baseLeague = createLeague({ seasonWeeks: lastWeek, teams });
    const fallback = generateSchedule(Object.assign({}, baseLeague, { startDate }));
    for (let w = 1; w <= lastWeek; w++) {
      const tl = new Map();
      recs.filter(r => r.week === w && r.lane != null).forEach(r => tl.set(r.team, r.lane));
      const byLane = new Map(Array.from(tl.entries()).map(([t, l]) => [l, t]));
      const matchups = [], used = new Set();
      Array.from(byLane.keys()).sort((a, b) => a - b).forEach(l => {
        if (used.has(l)) return;
        const mate = l % 2 ? l + 1 : l - 1;
        if (byLane.has(mate) && !used.has(mate)) {
          const lo = Math.min(l, mate), hi = Math.max(l, mate);
          matchups.push({ a: teamId(byLane.get(lo)), b: teamId(byLane.get(hi)), lanes: lo + '-' + hi });
          used.add(lo); used.add(hi);
        }
      });
      const inWeek = new Set(matchups.flatMap(m => [m.a, m.b]));
      const bye = teams.length % 2 ? (teams.find(t => !inWeek.has(t.id)) || {}).id || null : null;
      if (matchups.length && matchups.length === Math.floor(teams.length / 2)) {
        laneWeeks++;
        schedule.push({ week: w, date: dates[w] || (startDate ? addDays(startDate, 7 * (w - 1)) : ''), matchups, bye });
      } else {
        const f = fallback[w - 1];
        schedule.push({ week: w, date: dates[w] || f.date, matchups: f.matchups, bye: f.bye });
      }
    }
    if (laneWeeks < weeks.length) warnings.push('Matchups for ' + (weeks.length - laneWeeks) + ' week' + (weeks.length - laneWeeks === 1 ? '' : 's') + ' couldn’t be read from lanes, so a round robin was used for those. Check the Schedule tab.');

    const league = createLeague({
      name: opts.name || 'Imported league', centerId: opts.centerId || '',
      day: startDate ? DAYS[new Date(startDate + 'T12:00:00').getDay()] : 'Monday', time: opts.time || '', startDate,
      seasonWeeks: Math.max(lastWeek, opts.seasonWeeks || 0), gamesPerNight: G, teamSize, handicap,
      absent: { pinsBelowAvg }, vacancy: { score: vacScores.length ? mode(vacScores) : 120 },
      establishGames: keep.n, newBowlerAvg: firstNight ? 'firstNight' : 'default',
      teams, bowlers, schedule, results, askedMe: false,
      imported: { from: opts.source || 'file', at: new Date().toISOString(), rows: recs.length },
    });
    league.day = startDate ? DAYS[new Date(startDate + 'T12:00:00').getDay()] : league.day;
    return {
      ok: true, league, recs,
      report: {
        rows: recs.length, weeks: weeks.length, firstDate: dates[weeks[0]] || '', lastDate: dates[lastWeek] || '',
        teams: teams.length, bowlers: bowlers.length, rostered: bowlers.filter(b => b.teamId).length, subs: bowlers.filter(b => !b.teamId).length,
        teamSize, gamesPerNight: G, handicap, handicapMatch: hMatch, pinsBelowAvg, keepGames: keep.n, avgMatch: P.has.avg ? { ok: keep.ok, tot: keep.tot } : null,
        firstNight, newBowlers: newBowlers.size, laneWeeks, warnings,
      },
    };
  }

  // Recompute every imported line and compare with the file's Avg and Hdcp columns.
  function verifySeason(league, recs) {
    let checked = 0, avgOk = 0, hcpOk = 0;
    const mismatches = [];
    recs.forEach(r => {
      if (r.vacant || r.avg == null) return;
      const w = league.results[r.week];
      const b = league.bowlers.find(x => x.name === r.name);
      const line = w && b && w.lines.find(l => l.bowlerId === b.id && l.teamId === (league.teams.find(t => t.name === r.team) || {}).id);
      if (!line) return;
      const s = scoreLine(league, r.week, line);
      checked++;
      const aOk = s.avg === r.avg, hOk = r.hdcp == null || s.hcp === r.hdcp;
      if (aOk) avgOk++;
      if (hOk) hcpOk++;
      if ((!aOk || !hOk) && mismatches.length < 10) mismatches.push({ row: r.row, week: r.week, bowler: r.name, fileAvg: r.avg, ourAvg: s.avg, fileHdcp: r.hdcp, ourHdcp: s.hcp });
    });
    return { checked, avgOk, hcpOk, mismatches };
  }

  function standingsCSV(league, week) {
    const rows = [['Place', 'Team', 'Points won', 'Points lost', 'Scratch pins', 'Handicap pins', 'High game (hcp)', 'High series (hcp)']];
    standings(league, week).forEach(s => rows.push([s.place, s.name, s.won, s.lost, s.scratch, s.hcpPins, s.highGame, s.highSeries]));
    return toCSV(rows);
  }

  function weekScoresCSV(league, week) {
    const G = league.gamesPerNight;
    const head = ['Week', 'Date', 'Team', 'Bowler', 'Status', 'Average', 'Handicap'];
    for (let i = 1; i <= G; i++) head.push('Game ' + i);
    head.push('Series', 'Handicap series');
    const rows = [head];
    league.teams.forEach(t => {
      teamWeek(league, week, t.id).lines.forEach(s => {
        rows.push([week, weekDate(league, week), t.name, s.name, s.vacant ? 'vacant' : s.absent ? 'absent' : s.absentGames.some(Boolean) ? s.absentGames.map((x, i) => (x ? 'G' + (i + 1) + ' absent' : '')).filter(Boolean).join(' ') : 'bowled', s.avg == null ? '' : s.avg, s.hcp]
          .concat(s.games.map(g => (g == null ? '' : g))).concat([s.series, s.hcpSeries]));
      });
    });
    return toCSV(rows);
  }

  function averagesCSV(league, week) {
    const rows = [['Bowler', 'Team', 'Games', 'Pins', 'Average', 'High game', 'High series', 'Handicap next week', 'Email']];
    bowlerStats(league, week).forEach(b => rows.push([b.name, b.team, b.games, b.pins, b.avg == null ? '' : b.avg, b.highGame == null ? '' : b.highGame, b.highSeries == null ? '' : b.highSeries, b.hcp, (bowler(league, b.id) || {}).email || '']));
    return toCSV(rows);
  }

  /* ---------- personal <-> league link ----------
   * One score, two views. A game in the bowler's own log can be tied to a slot on
   * the league sheet (line.links[i] = gameId). While linked, the log is the source
   * of truth and syncLinks() copies its total onto the sheet. If the secretary types
   * over a linked score, the link is dropped and the sheet's number stands.
   * League scores for "me" with no link show up in the personal log as read-only
   * "league sheet" games, so nothing has to be entered twice.
   */
  const me = league => league.bowlers.find(b => b.isMe) || null;

  // Week whose date matches (or is within 3 days of) the given date.
  function weekForDate(league, date) {
    if (!date) return null;
    let best = null, bestGap = 4;
    for (let w = 1; w <= league.seasonWeeks; w++) {
      const d = weekDate(league, w);
      if (!d) continue;
      const gap = Math.abs((new Date(d + 'T12:00:00') - new Date(date + 'T12:00:00')) / 864e5);
      if (gap < bestGap) { best = w; bestGap = gap; }
    }
    return best;
  }

  // Where "me" bowls in a week: an existing line with me on it, else my team's lineup.
  function myLineSlot(league, week) {
    const b = me(league);
    if (!b) return { ok: false, error: 'Pick which bowler you are first (League tab → Pick my name).' };
    const r = league.results && league.results[week];
    const existing = r && r.lines.find(l => l.bowlerId === b.id);
    if (existing) return { ok: true, bowler: b, teamId: existing.teamId, line: existing };
    if (!b.teamId) return { ok: false, error: 'You’re listed as a sub. Ask your secretary to put you in a lineup for week ' + week + ' first.' };
    if (!weekSchedule(league, week).matchups.some(m => m.a === b.teamId || m.b === b.teamId)) {
      return { ok: false, error: teamName(league, b.teamId) + ' doesn’t bowl in week ' + week + ' (bye).' };
    }
    return { ok: true, bowler: b, teamId: b.teamId, line: null };
  }

  // Put my games (entries: [{gameId, total}]) onto the league sheet for a week, linked.
  function pushMyGames(league, week, entries) {
    const slot = myLineSlot(league, week);
    if (!slot.ok) return slot;
    if (!league.results[week]) league.results[week] = { lines: [], final: false };
    const r = league.results[week];
    let line = slot.line;
    if (!line) {
      if (!r.lines.some(l => l.teamId === slot.teamId)) defaultLines(league, slot.teamId).forEach(l => r.lines.push(l));
      const team = r.lines.filter(l => l.teamId === slot.teamId);
      line = team.find(l => l.bowlerId === slot.bowler.id) || team.find(l => l.bowlerId === VACANT);
      if (!line) return { ok: false, error: 'Your team’s lineup is full for week ' + week + '. Ask your secretary to swap you in.' };
      line.bowlerId = slot.bowler.id;
    }
    const G = league.gamesPerNight;
    const oldGames = line.games || [], oldLinks = line.links || [];
    line.absent = false;
    line.games = Array.from({ length: G }, (_, i) => (entries[i] && validScore(entries[i].total) ? entries[i].total : (oldGames[i] == null ? null : oldGames[i])));
    line.links = Array.from({ length: G }, (_, i) => (entries[i] ? entries[i].gameId : (oldLinks[i] || null)));
    r.updatedAt = new Date().toISOString();
    return { ok: true, teamId: slot.teamId, count: Math.min(G, entries.length) };
  }

  // Copy linked game totals onto the sheet; drop links to games that no longer exist.
  function syncLinks(league, gamesById) {
    let changed = false;
    Object.values(league.results || {}).forEach(r => r.lines.forEach(l => {
      (l.links || []).forEach((id, i) => {
        if (!id) return;
        const g = gamesById[id];
        if (!g) { l.links[i] = null; changed = true; return; }
        if (validScore(g.total) && l.games[i] !== g.total) { l.games[i] = g.total; changed = true; }
      });
    }));
    return changed;
  }

  function unlinkGame(line, i) {
    if (line.links && line.links[i]) { line.links[i] = null; return true; }
    return false;
  }

  // Where a personal game sits on this league's sheet, if anywhere: {week, game, teamId}
  function findLink(league, gameId) {
    for (const w of Object.keys(league.results || {})) {
      for (const l of league.results[w].lines) {
        const i = (l.links || []).indexOf(gameId);
        if (i >= 0) return { week: +w, game: i + 1, teamId: l.teamId, line: l };
      }
    }
    return null;
  }

  // My league scores that aren't linked to my own log: shown read-only in History/Stats.
  function sheetOnlyGames(league) {
    const b = me(league);
    if (!b) return [];
    const out = [];
    Object.keys(league.results || {}).map(Number).sort((x, y) => x - y).forEach(w => {
      league.results[w].lines.forEach(l => {
        if (l.bowlerId !== b.id || l.absent) return;
        (l.games || []).forEach((g, i) => {
          if (!validScore(g) || gameAbsent(l, i) || (l.links && l.links[i])) return;
          out.push({ id: 'sheet:' + league.id + ':' + w + ':' + i, seriesId: 'sheet:' + league.id + ':' + w, gameNo: i + 1, date: weekDate(league, w),
            centerId: league.centerId, leagueId: league.id, week: w, mode: 'sheet', total: g, sheet: true, createdAt: '' });
        });
      });
    });
    return out;
  }

  /* ---------- the bowler's view: which night to show, and my matchup in it ---------- */
  // Tonight if a week falls on today; else the next week not yet bowled; else the last one bowled.
  function featuredWeek(league, today) {
    const n = league.seasonWeeks || 0;
    let next = null;
    for (let w = 1; w <= n; w++) {
      const d = weekDate(league, w);
      if (d && d === today) return { week: w, date: d, when: 'tonight' };
      if (d && d > today && !weekHasScores(league, w) && !next) next = { week: w, date: d, when: 'next' };
    }
    if (next) return next;
    const last = lastScoredWeek(league);
    if (last) return { week: last, date: weekDate(league, last), when: 'last' };
    return n ? { week: 1, date: weekDate(league, 1), when: 'next' } : null;
  }
  function myMatchup(league, week) {
    const b = me(league);
    if (!b) return null;
    const r = league.results && league.results[week];
    const line = r && r.lines.find(l => l.bowlerId === b.id);
    const teamId = line ? line.teamId : b.teamId;
    if (!teamId) return { bowler: b, teamId: '', sub: true };
    const sch = weekSchedule(league, week);
    const mi = sch.matchups.findIndex(m => m.a === teamId || m.b === teamId);
    if (mi < 0) return { bowler: b, teamId, bye: sch.bye === teamId };
    const m = sch.matchups[mi];
    const side = m.a === teamId ? 'a' : 'b';
    const res = matchupResult(league, week, m);
    const entered = res.A.entered || res.B.entered;
    return {
      bowler: b, teamId, mi, m, lanes: m.lanes, opponentId: side === 'a' ? m.b : m.a,
      entered, decided: res.decided,
      myPts: side === 'a' ? res.ptsA : res.ptsB, theirPts: side === 'a' ? res.ptsB : res.ptsA,
      myGames: line ? (line.games || []).slice() : [], linked: !!(line && (line.links || []).some(Boolean)),
    };
  }
  // Is this league already here? Same name (ignoring case/spaces) or imported from the same file.
  function findDuplicate(leagues, league) {
    const norm = x => String(x || '').toLowerCase().replace(/\s+/g, ' ').trim();
    return (leagues || []).find(l => l !== league && l.id !== league.id && (norm(l.name) === norm(league.name) ||
      (l.imported && league.imported && l.imported.from && l.imported.from === league.imported.from))) || null;
  }

  // Re-importing a league: bring over what the file doesn't have — who "you" are,
  // roster emails, the recap list, and links from your own logged games.
  function carryOver(from, to) {
    const key = n => String(n || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const byName = {};
    to.bowlers.forEach(b => { byName[key(b.name)] = b; });
    const idMap = {};
    let emails = 0, links = 0, me = false;
    from.bowlers.forEach(b => {
      const t = byName[key(b.name)];
      if (!t) return;
      idMap[b.id] = t.id;
      if (b.email && !t.email) { t.email = b.email; emails++; }
      if (b.isMe) { to.bowlers.forEach(x => { x.isMe = x === t; }); me = true; }
    });
    if (me || from.askedMe) to.askedMe = true;
    if (from.ccEmails && !to.ccEmails) to.ccEmails = from.ccEmails;
    Object.keys(from.results || {}).forEach(w => {
      const nr = to.results && to.results[w];
      if (!nr) return;
      from.results[w].lines.forEach(ol => {
        if (!(ol.links || []).some(Boolean) || !idMap[ol.bowlerId]) return;
        const nl = nr.lines.find(x => x.bowlerId === idMap[ol.bowlerId]);
        if (!nl) return;
        nl.links = nl.links || [];
        ol.links.forEach((id, i) => { if (id && nl.games && nl.games[i] === ol.games[i]) { nl.links[i] = id; links++; } });
      });
    });
    return { me, emails, links };
  }

  // Update a league from a newer (or older) export of the same league. Weeks in the file
  // replace those weeks here — keeping links to your own logged games where the score
  // didn't change — and add any new teams and bowlers. Everything else stays: weeks that
  // aren't in the file, the season length, dates of later weeks, rules and points,
  // roster emails, who you are.
  function mergeImport(dst, src) {
    const key = n => String(n || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const out = { weeks: 0, links: 0, teams: 0, bowlers: 0 };
    const teamMap = {};
    src.teams.forEach(t => {
      let d = dst.teams.find(x => key(x.name) === key(t.name));
      if (!d) { d = { id: uid(), name: t.name }; dst.teams.push(d); out.teams++; }
      teamMap[t.id] = d.id;
    });
    const bMap = {};
    src.bowlers.forEach(b => {
      let d = dst.bowlers.find(x => key(x.name) === key(b.name));
      if (!d) {
        d = { id: uid(), name: b.name, email: b.email || '', enteringAvg: b.enteringAvg == null ? null : b.enteringAvg, teamId: teamMap[b.teamId] || '', isMe: false, active: b.active !== false };
        dst.bowlers.push(d); out.bowlers++;
      } else if (d.enteringAvg == null && b.enteringAvg != null) d.enteringAvg = b.enteringAvg;
      bMap[b.id] = d.id;
    });
    const mapB = id => (id === VACANT ? VACANT : bMap[id] || id);
    Object.keys(src.results || {}).forEach(w => {
      const old = dst.results[w];
      const lines = src.results[w].lines.map(l => Object.assign({}, l, { teamId: teamMap[l.teamId] || l.teamId, bowlerId: mapB(l.bowlerId), links: [] }));
      if (old) lines.forEach(nl => {
        const ol = old.lines.find(x => x.bowlerId === nl.bowlerId);
        if (!ol || !(ol.links || []).some(Boolean)) return;
        nl.links = (nl.games || []).map((g, i) => (ol.links[i] && ol.games && ol.games[i] === g ? ol.links[i] : null));
        out.links += nl.links.filter(Boolean).length;
      });
      dst.results[w] = Object.assign({}, src.results[w], { lines });
      out.weeks++;
      const ss = (src.schedule || []).find(s => s.week === +w);
      if (ss) {
        const entry = { week: +w, date: ss.date, matchups: ss.matchups.map(m => ({ a: teamMap[m.a] || m.a, b: teamMap[m.b] || m.b, lanes: m.lanes })), bye: ss.bye ? teamMap[ss.bye] || ss.bye : null };
        const i = dst.schedule.findIndex(s => s.week === +w);
        if (i >= 0) dst.schedule[i] = entry; else dst.schedule.push(entry);
      }
    });
    if (src.seasonWeeks > dst.seasonWeeks) dst.seasonWeeks = src.seasonWeeks;
    const have = new Set(dst.schedule.map(s => s.week));
    if (Array.from({ length: dst.seasonWeeks }, (_, i) => i + 1).some(w => !have.has(w))) rebuildSchedule(dst);
    else chainDates(dst);
    dst.imported = Object.assign({}, dst.imported || {}, { from: (src.imported || {}).from || (dst.imported || {}).from, at: new Date().toISOString(), rows: (src.imported || {}).rows });
    return out;
  }

  /* ---------- demo data (fictional) ---------- */
  function buildDemoLeague(opts) {
    opts = opts || {};
    let seed = opts.seed || 42;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) / 0.7071; };
    const weeksBowled = opts.weeksBowled == null ? 4 : opts.weeksBowled;
    const today = opts.today || '2026-09-01';
    const dow = new Date(today + 'T12:00:00').getDay();
    const nextTue = addDays(today, (2 - dow + 7) % 7);
    const start = opts.startDate || addDays(nextTue, -7 * weeksBowled);
    const lg = createLeague({
      name: opts.name || 'Tuesday Night Mixed (demo)', centerId: opts.centerId || '', day: DAYS[new Date(start + 'T12:00:00').getDay()],
      time: '6:30 PM', startDate: start, seasonWeeks: 30, gamesPerNight: 3, teamSize: 4,
      points: { perGame: 2, perSeries: 2 }, ccEmails: '',
    });
    const teamNames = ['Pin Pals', 'Split Happens', 'Gutter Gang', 'Lane Rangers', 'Lucky Strikes', 'Spare Me'];
    const people = ['Dana Ortiz', 'Mike Kowalski', 'Priya Shah', 'Tom Becker', 'Lena Novak', 'Chris Adams', 'Jo Whitfield', 'Sam Reyes',
      'Rita Moreno', 'Dave Lindqvist', 'Kim Tran', 'Ben Harper', 'Ava Brooks', 'Luis Garza', 'Nina Patel', 'Greg Olson',
      'Tess Carter', 'Omar Haddad', 'Beth Morgan', 'Ray Dillon', 'Kate Sullivan', 'Hank Weber', 'Maya Chen', 'Joel Fischer'];
    let n = 0;
    const id = () => 'demo-' + (++n);
    teamNames.forEach((tn, ti) => {
      const t = { id: id(), name: tn };
      lg.teams.push(t);
      for (let k = 0; k < 4; k++) {
        const name = people[ti * 4 + k];
        const avg = Math.round(135 + rnd() * 70);
        lg.bowlers.push({ id: id(), name, email: name.toLowerCase().replace(/[^a-z]+/g, '.') + '@example.com', enteringAvg: avg, teamId: t.id, isMe: false, active: true, _true: avg });
      }
    });
    ['Pat Quinn', 'Alex Romero'].forEach(name => lg.bowlers.push({ id: id(), name, email: '', enteringAvg: 160, teamId: '', isMe: false, active: true, _true: 160 }));
    lg.schedule = generateSchedule(lg);
    for (let w = 1; w <= weeksBowled; w++) {
      const lines = [];
      lg.teams.forEach(t => {
        defaultLines(lg, t.id).forEach(l => {
          const b = bowler(lg, l.bowlerId);
          if (rnd() < 0.05) { l.absent = true; l.games = [null, null, null]; }
          else l.games = l.games.map(() => Math.max(70, Math.min(279, Math.round(b._true + gauss() * 24))));
          lines.push(l);
        });
      });
      lg.results[w] = { lines, final: true, updatedAt: new Date().toISOString() };
    }
    lg.bowlers.forEach(b => { delete b._true; });
    return lg;
  }

  const League = {
    VACANT, DAYS, uid, createLeague, buildDemoLeague, addDays, weekDate, generateSchedule, weekSchedule, opponentOf,
    teamName, bowler, bowlerName, roster, subs, weekNumbers, weekHasScores, lastScoredWeek, currentWeek,
    validScore, gamesBefore, averageBefore, handicapFor, defaultLines, teamLines, scoreLine, teamWeek,
    matchupResult, pointsPerNight, pointsLine, byeNote, ROUNDING_LABEL, standings,
    me, weekForDate, myLineSlot, featuredWeek, myMatchup, findDuplicate, carryOver, mergeImport, chainDates, rebuildSchedule, setSeasonLength, mostGamesEntered, pushMyGames, syncLinks, unlinkGame, findLink, sheetOnlyGames, bowlerStats, weekHighlights,
    recapData, recapText, recapHTML, recapSubject, recipients, fmtDate, fmtPts, fmtN,
    parseCSV, toCSV, rosterFromCSV, applyRoster, scoresFromCSV, applyScores, seasonRecords, importSeason, verifySeason, parseDateCell, standingsCSV, weekScoresCSV, averagesCSV,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = League;
  else global.BBLeague = League;
})(typeof window !== 'undefined' ? window : globalThis);
