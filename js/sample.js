/* BowlBoard sample data — one place for everything the playable builds preload.
 *
 * The personal log and the demo league share one bowler ("You (sample)"):
 *   - two practice series, bowled pin by pin
 *   - league weeks 3 and 4 bowled pin by pin in the log and sent to the league
 *     sheet (linked), so edits flow through
 *   - league weeks 1 and 2 exist only on the league sheet, so they show up in
 *     History as read-only "league sheet" games
 * Everything is flagged `sample` so Clear sample data removes it cleanly.
 */
(function (global) {
  'use strict';

  // A realistic ~185 bowler: common leaves, the odd split, missed spares.
  const LEAVES = [[10], [10], [10], [10], [7], [7], [4], [6], [2], [3], [5], [8], [9], [6, 10], [6, 10], [3, 6, 10], [2, 4, 5, 8],
    [4, 7], [2, 8], [3, 10], [2, 4, 7], [7, 10], [4, 7, 10], [6, 7, 10], [1, 2, 4, 10], [1, 3, 6, 10], [4, 9]];

  function rng(seed) {
    return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  }

  function game(S, rnd) {
    const g = S.newGame();
    let guard = 0;
    while (!S.isComplete(g) && guard++ < 40) {
      const standing = S.standingPins(g);
      if (S.freshRack(g)) {
        if (rnd() < 0.4) { S.recordClear(g); continue; }
        const leave = LEAVES[Math.floor(rnd() * LEAVES.length)];
        S.recordThrow(g, S.ALL_PINS.filter(p => leave.indexOf(p) < 0));
      } else {
        const conv = S.isSplit(standing) ? 0.2 : standing.length === 1 ? 0.88 : 0.62;
        if (rnd() < conv) S.recordClear(g);
        else S.recordThrow(g, standing.slice(0, Math.floor(rnd() * standing.length)));
      }
    }
    return g;
  }

  function addDays(iso, n) {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function addSeries(Store, S, rnd, o) {
    const seriesId = 'sample-' + o.date + '-' + (o.leagueId ? 'lg' : 'p');
    const out = [];
    for (let n = 1; n <= 3; n++) {
      const g = game(S, rnd);
      out.push(Store.addGame({
        id: seriesId + '-g' + n, date: o.date, centerId: o.center.id, ballId: n === 3 && o.ball2 ? o.ball2.id : o.ball.id,
        lanes: o.lanes, pattern: o.pattern, leagueId: o.leagueId || '', seriesId, gameNo: n, mode: 'pins',
        frames: g.frames, total: S.computeScore(g).total, sample: true,
        createdAt: new Date(new Date(o.date + 'T19:00:00').getTime() + n * 9e5).toISOString(),
      }));
    }
    return out;
  }

  function seed(Store, S, LG, today) {
    const st = Store.state;
    const rnd = rng(7);
    const home = Store.addCenter('Riverside Lanes', 'Sample City', { sample: true });
    const away = Store.addCenter('Starlite Bowl', 'Sample City', { sample: true });
    const b1 = Store.addBall({ brand: 'Storm', name: 'Phaze II', cover: 'Solid Reactive', weight: 15, custom: false, sample: true });
    const b2 = Store.addBall({ brand: 'Hammer', name: 'Purple Solid Urethane', cover: 'Urethane', weight: 15, custom: false, sample: true });

    const lg = LG.buildDemoLeague({ today, centerId: home.id });
    lg.sample = true;
    lg.askedMe = true;
    const me = lg.bowlers.find(b => b.teamId) ;
    me.name = 'You (sample)';
    me.email = '';
    me.isMe = true;
    Store.addLeague(lg);

    addSeries(Store, S, rnd, { date: addDays(today, -26), center: away, ball: b1, pattern: 'House shot', lanes: [11, 12] });
    addSeries(Store, S, rnd, { date: addDays(today, -12), center: away, ball: b2, ball2: b1, pattern: 'Sport shot', lanes: [19, 20] });
    [3, 4].forEach(w => {
      const m = LG.weekSchedule(lg, w).matchups.find(x => x.a === me.teamId || x.b === me.teamId);
      const games = addSeries(Store, S, rnd, {
        date: LG.weekDate(lg, w), center: home, ball: b1, pattern: 'House shot',
        lanes: m ? Store.parseLanes(m.lanes) : [], leagueId: lg.id,
      });
      LG.pushMyGames(lg, w, games.map(g => ({ gameId: g.id, total: g.total })));
    });
    st.seeded = true;
    Store.save();
  }

  function clear(Store) {
    const st = Store.state;
    st.games = st.games.filter(g => !g.sample);
    st.leagues = st.leagues.filter(l => !l.sample);
    st.balls = st.balls.filter(b => !b.sample || st.games.some(g => g.ballId === b.id));
    st.centers = st.centers.filter(c => !c.sample || st.games.some(g => g.centerId === c.id) || st.leagues.some(l => l.centerId === c.id));
    st.seeded = true;
    Store.save();
  }

  const has = Store => Store.state.games.some(g => g.sample) || Store.state.leagues.some(l => l.sample);

  global.BBSample = { seed, clear, has, game, LEAVES };
})(typeof window !== 'undefined' ? window : globalThis);
