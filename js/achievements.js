/* BowlBoard achievements — milestones worked out from your games. Nothing is stored: every
 * badge is derived from the games themselves, so importing a season, fixing a typo or deleting
 * a game keeps the badges honest, and a badge shows the date it was really earned.
 * Pure and DOM-free, so it runs under Node for the tests.
 *
 *   evaluate(games) -> { list: [{ id, group, title, desc, mark, sub, icon, needs, earned, progress }], earned, total, games, framed }
 *     earned:   null, or { date, gameId, seriesId } for the first time it happened
 *     progress: null once earned, else { have, need, label } (label is ready to print)
 *   fresh(before, after) -> the badges in `after` that `before` didn't have
 *   tops(list)           -> the top rung of each ladder in a list (600 series, not 400 and 500 too)
 *   next(result)         -> the unearned badge you're closest to, or null
 *
 * Badges that need to know how a game was bowled (strike streaks, clean games, splits) only
 * count games entered pin by pin or read from a photo; a 300 counts as twelve strikes either way.
 */
(function (global) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const S = node ? require('./score.js') : global.BBScore;
  const I = node ? require('./insights.js') : global.BBInsights;

  const MIN_AVG_GAMES = 15;   // an average only counts once it's over this many games
  const GROUPS = ['Getting started', 'High games', 'Series', 'Strikes', 'Precision', 'Averages', 'Games bowled'];

  /* ---------- what we know about each game and night ---------- */
  function detail(g) {
    const d = { run: g.total === 300 ? 12 : 0, clean: false, split: false, bed: false, framed: false };
    if (Array.isArray(g.frames) && g.frames.length === 10) {
      try {
        const game = { frames: g.frames.map(S.normFrame) };
        d.framed = true;
        d.run = Math.max(d.run, I.longestStrikeRun(game));
        const st = S.pinStats([game]);
        d.clean = st.cleanGames === 1;
        d.split = st.splitsMade > 0;
        d.bed = !!(st.leaves['7-10'] && st.leaves['7-10'].made);
      } catch (e) { d.framed = false; }
    }
    return d;
  }

  function prepare(games) {
    const list = I.chrono(games);                       // finished games, oldest first
    const info = new Map();
    list.forEach(g => info.set(g, detail(g)));
    const by = new Map(), nights = [];
    list.forEach(g => {
      const k = g.seriesId || g.id;
      let n = by.get(k);
      if (!n) { n = { key: k, date: g.date, games: [] }; by.set(k, n); nights.push(n); }
      n.games.push(g);
    });
    nights.forEach(n => {
      n.games.sort((a, b) => (a.gameNo || 1) - (b.gameNo || 1));
      // best three games in a row, and the longest stretch of 200s
      n.best3 = null; n.run200 = 0; n.trip200 = null;
      let cur = 0;
      n.games.forEach((g, i) => {
        if (g.total >= 200) { cur++; if (cur > n.run200) n.run200 = cur; } else cur = 0;
        if (i >= 2) {
          const sum = n.games[i - 2].total + n.games[i - 1].total + g.total;
          if (!n.best3 || sum > n.best3.sum) n.best3 = { sum, first: n.games[i - 2] };
        }
      });
      const t = n.games.findIndex((g, i) => i >= 2 && g.total >= 200 && n.games[i - 1].total >= 200 && n.games[i - 2].total >= 200);
      if (t >= 0) n.trip200 = n.games[t - 2];
    });
    const c = { list, nights, info, count: list.length };
    c.framed = list.filter(g => info.get(g).framed).length;
    c.best = list.reduce((m, g) => Math.max(m, g.total), 0);
    c.bestSeries = nights.reduce((m, n) => Math.max(m, n.best3 ? n.best3.sum : 0), 0);
    c.bestRun = list.reduce((m, g) => Math.max(m, info.get(g).run), 0);
    c.bestTrip = nights.reduce((m, n) => Math.max(m, n.run200), 0);
    // the running average, game by game
    let sum = 0;
    c.avgAt = [];
    list.forEach((g, i) => { sum += g.total; c.avgAt.push(Math.floor(sum / (i + 1))); });
    c.avg = c.avgAt.length ? c.avgAt[c.avgAt.length - 1] : 0;
    return c;
  }

  const hit = g => ({ earned: { date: g.date, gameId: g.id, seriesId: g.seriesId } });
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const pinsHint = c => (c.framed ? 'Not yet' : 'Score a game pin by pin to earn this');

  /* ---------- the badges ---------- */
  const DEFS = [];
  const add = d => DEFS.push(d);

  add({ id: 'first', group: 'Getting started', title: 'First game', desc: 'Log your first game', icon: 'pin',
    check: c => (c.count ? hit(c.list[0]) : { progress: { have: 0, need: 1, label: 'Log a game to start' } }) });
  add({ id: 'league', group: 'Getting started', title: 'League bowler', desc: 'Bowl a league night', icon: 'league',
    check: c => { const g = c.list.find(x => x.leagueId || x.mode === 'sheet'); return g ? hit(g) : { progress: { have: 0, need: 1, label: 'Not yet' } }; } });

  [[100, 'Broke 100', 'Bowl a game of 100 or more'], [150, '150 game', 'Bowl a game of 150 or more'], [200, 'The 200 club', 'Bowl a game of 200 or more'],
    [250, '250 game', 'Bowl a game of 250 or more'], [300, 'Perfect game', '300: twelve strikes in a row']].forEach(([min, title, desc], rank) => {
    add({ id: 'game' + min, group: 'High games', ladder: 'game', rank, title, desc, mark: String(min), sub: 'GAME',
      check: c => { const g = c.list.find(x => x.total >= min); return g ? hit(g) : { progress: { have: c.best, need: min, label: c.best ? 'Best game so far: ' + c.best : 'No games yet' } }; } });
  });

  [[400, '400 series'], [500, '500 series'], [600, '600 series'], [700, '700 series'], [800, '800 series']].forEach(([min, title], rank) => {
    add({ id: 'series' + min, group: 'Series', ladder: 'series', rank, title, desc: min + ' or more over three games in a row', mark: String(min), sub: 'SERIES',
      check: c => { const n = c.nights.find(x => x.best3 && x.best3.sum >= min); return n ? hit(n.best3.first) : { progress: { have: c.bestSeries, need: min, label: c.bestSeries ? 'Best series so far: ' + c.bestSeries : 'Bowl three games in one night' } }; } });
  });
  add({ id: 'triple200', group: 'Series', title: 'Triple 200', desc: 'Three 200 games in a row on one night', mark: '3×200', sub: 'IN A ROW',
    check: c => { const n = c.nights.find(x => x.trip200); return n ? hit(n.trip200) : { progress: { have: Math.min(c.bestTrip, 3), need: 3, label: c.bestTrip ? 'Most 200s in a row so far: ' + c.bestTrip : 'Not yet' } }; } });

  [[3, 'Turkey', 'Three strikes in a row', 'turkey'], [4, 'Hambone', 'Four strikes in a row', 'hambone'], [6, 'Six-pack', 'Six strikes in a row', 'sixpack']].forEach(([n, title, desc, id], rank) => {
    add({ id, group: 'Strikes', ladder: 'strikes', rank, title, desc, mark: String(n), sub: 'STRIKES', icon: 'flame', needs: 'pins',
      check: c => { const g = c.list.find(x => c.info.get(x).run >= n); return g ? hit(g) : { progress: { have: c.bestRun, need: n, label: c.framed ? 'Longest run so far: ' + c.bestRun : 'Score a game pin by pin to track this' } }; } });
  });

  add({ id: 'clean', group: 'Precision', title: 'Clean game', desc: 'A game with no open frames', icon: 'check', needs: 'pins',
    check: c => { const g = c.list.find(x => c.info.get(x).clean); return g ? hit(g) : { progress: { have: 0, need: 1, label: pinsHint(c) } }; } });
  add({ id: 'split', group: 'Precision', title: 'Split converted', desc: 'Pick up a split for a spare', icon: 'target', needs: 'pins',
    check: c => { const g = c.list.find(x => c.info.get(x).split); return g ? hit(g) : { progress: { have: 0, need: 1, label: pinsHint(c) } }; } });
  add({ id: 'bedposts', group: 'Precision', title: 'Bedposts', desc: 'Pick up the 7–10 split', icon: 'star', needs: 'pins',
    check: c => { const g = c.list.find(x => c.info.get(x).bed); return g ? hit(g) : { progress: { have: 0, need: 1, label: pinsHint(c) } }; } });

  [100, 125, 150, 175, 200].forEach((th, rank) => {
    add({ id: 'avg' + th, group: 'Averages', ladder: 'avg', rank, title: th + ' average', desc: 'Average ' + th + ' or better over at least ' + MIN_AVG_GAMES + ' games', mark: String(th), sub: 'AVG',
      check: c => {
        const i = c.avgAt.findIndex((a, k) => k + 1 >= MIN_AVG_GAMES && a >= th);
        if (i >= 0) return hit(c.list[i]);
        return { progress: { have: c.avg, need: th, label: c.count < MIN_AVG_GAMES ? (c.count ? plural(c.count, 'game') + ' so far. It counts from ' + MIN_AVG_GAMES + '.' : 'No games yet') : 'Average so far: ' + c.avg } };
      } });
  });

  [[10, '10'], [50, '50'], [100, '100'], [250, '250'], [500, '500'], [1000, '1K']].forEach(([n, mark], rank) => {
    add({ id: 'games' + n, group: 'Games bowled', ladder: 'games', rank, title: n === 1000 ? '1,000 games' : n + ' games', desc: 'Log ' + (n === 1000 ? '1,000' : n) + ' games', mark, sub: 'GAMES',
      check: c => (c.count >= n ? hit(c.list[n - 1]) : { progress: { have: c.count, need: n, label: c.count + ' of ' + n + ' games' } }) });
  });

  /* ---------- results ---------- */
  function evaluate(games) {
    const c = prepare(games);
    const list = DEFS.map(d => {
      const r = d.check(c);
      return { id: d.id, group: d.group, ladder: d.ladder || null, rank: d.rank || 0, title: d.title, desc: d.desc, mark: d.mark || null, sub: d.sub || null, icon: d.icon || null, needs: d.needs || null,
        earned: r.earned || null, progress: r.earned ? null : r.progress };
    });
    return { list, earned: list.filter(a => a.earned).length, total: list.length, games: c.count, framed: c.framed };
  }

  const fresh = (before, after) => {
    const had = new Set(((before && before.list) || []).filter(a => a.earned).map(a => a.id));
    return after.list.filter(a => a.earned && !had.has(a.id));
  };

  // Of the badges in a list, keep the top rung of each ladder (a 600 series says more than the 400 and 500 that
  // came with it). Everything else stays, in order.
  const tops = list => list.filter(a => !a.ladder || !list.some(b => b.ladder === a.ladder && b.rank > a.rank));

  // Closest to earning: the highest have/need among what's left (badges with no progress at all come last).
  function next(res) {
    let best = null, bestRatio = -1;
    res.list.forEach(a => {
      if (a.earned || !a.progress) return;
      if (a.needs === 'pins' && !res.framed) return;
      const r = a.progress.need ? a.progress.have / a.progress.need : 0;
      if (r > bestRatio && r < 1) { best = a; bestRatio = r; }
    });
    return bestRatio > 0 ? best : null;
  }

  const byGroup = res => GROUPS.map(g => ({ group: g, items: res.list.filter(a => a.group === g) })).filter(x => x.items.length);

  const Achievements = { DEFS, GROUPS, MIN_AVG_GAMES, evaluate, fresh, next, tops, byGroup };
  if (node) module.exports = Achievements;
  else global.BBAchievements = Achievements;
})(typeof window !== 'undefined' ? window : globalThis);
