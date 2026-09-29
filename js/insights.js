/* BowlBoard insights — reads a bowler's games and says something useful about them.
 * Pure, no DOM, runs in Node. Games are the app's game records (own log + league
 * sheet games): {date, total, frames?, leagueId?, ballId?, centerId?, pattern?, seriesId, gameNo}.
 *
 * Seasons run August 1 to July 31, as most league seasons do.
 */
(function (global) {
  'use strict';
  const S = (typeof module !== 'undefined' && module.exports) ? require('./score.js') : global.BBScore;

  const floorAvg = a => (a.length ? Math.floor(a.reduce((x, y) => x + y, 0) / a.length) : null);
  const scored = games => (games || []).filter(g => g && typeof g.total === 'number');

  function seasonOf(iso) {
    if (!iso) return null;
    const y = +iso.slice(0, 4), m = +iso.slice(5, 7);
    return m >= 8 ? y : y - 1;
  }
  const seasonLabel = y => y + '–' + String((y + 1) % 100).padStart(2, '0');

  // Oldest first: date, then when it was logged, then game number.
  function chrono(games) {
    return scored(games).slice().sort((a, b) =>
      (a.date || '').localeCompare(b.date || '') || (a.seriesId || '').localeCompare(b.seriesId || '') || ((a.gameNo || 1) - (b.gameNo || 1)));
  }

  function stdev(nums) {
    if (nums.length < 2) return null;
    const m = nums.reduce((a, b) => a + b, 0) / nums.length;
    return Math.sqrt(nums.reduce((a, b) => a + (b - m) * (b - m), 0) / nums.length);
  }
  function consistency(totals) {
    const sd = stdev(totals);
    if (sd == null || totals.length < 5) return null;
    const avg = floorAvg(totals);
    return { sd: Math.round(sd), avg, lo: Math.max(0, Math.round(avg - sd)), hi: Math.min(300, Math.round(avg + sd)) };
  }

  // Best three games in a row within one night (a 4-game night counts its best stretch).
  function highSeries(games) {
    const by = {};
    scored(games).forEach(g => { (by[g.seriesId || g.id] = by[g.seriesId || g.id] || []).push(g); });
    let best = null;
    Object.values(by).forEach(list => {
      list.sort((a, b) => (a.gameNo || 1) - (b.gameNo || 1));
      for (let i = 0; i + 3 <= list.length; i++) {
        const s3 = list[i].total + list[i + 1].total + list[i + 2].total;
        if (!best || s3 > best.total) best = { total: s3, date: list[i].date, seriesId: list[i].seriesId };
      }
    });
    return best;
  }

  function longestStrikeRun(game) {
    let best = 0, run = 0;
    (game.frames || []).forEach((f0, i) => {
      const f = S.normFrame(f0);
      f.balls.forEach((b, j) => {
        if (S.rackStart(i, f.balls, j) !== j) return; // only balls at a full rack
        if (b === 10) { run++; if (run > best) best = run; } else run = 0;
      });
    });
    return best;
  }

  // Attempts at a single-pin leave, oldest first: [{made, date}]
  function pinAttempts(games, pin) {
    const out = [];
    chrono(games).filter(g => g.frames).forEach(g => {
      g.frames.forEach((f0, i) => {
        const f = S.normFrame(f0);
        for (let j = 0; j < f.balls.length; j++) {
          if (S.rackStart(i, f.balls, j) !== j || f.balls[j] === 10 || j + 1 >= f.balls.length) continue;
          const leave = S.leaveAfter(i, f, j);
          if (leave && leave.length === 1 && leave[0] === pin) out.push({ made: f.balls[j] + f.balls[j + 1] === 10, date: g.date });
        }
      });
    });
    return out;
  }

  const pctOf = (n, d) => (d ? Math.round(100 * n / d) : null);
  function rates(games) {
    const det = scored(games).filter(g => g.frames);
    if (!det.length) return null;
    const ps = S.pinStats(det);
    return { games: det.length, strike: pctOf(ps.strikes, ps.racks), spare: pctOf(ps.spares, ps.spareOpps), ps };
  }

  function fmtShort(iso) {
    if (!iso) return '';
    const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return M[+iso.slice(5, 7) - 1] + ' ' + (+iso.slice(8, 10));
  }

  // Plain-language observations, most interesting first. opts.today (ISO) sets "this season".
  function insights(games, opts) {
    opts = opts || {};
    const all = chrono(games);
    const out = [];
    if (!all.length) return out;
    const today = opts.today || all[all.length - 1].date;
    const season = seasonOf(today);
    const thisS = all.filter(g => seasonOf(g.date) === season);
    const lastS = all.filter(g => seasonOf(g.date) === season - 1);
    const totals = all.map(g => g.total);

    // 1. recent trend: last 10 vs the 10 before
    if (all.length >= 20) {
      const last = floorAvg(totals.slice(-10)), prev = floorAvg(totals.slice(-20, -10));
      const d = last - prev;
      if (Math.abs(d) >= 3) {
        out.push({ id: 'trend', tone: d > 0 ? 'up' : 'down', title: d > 0 ? 'You\u2019re on a roll.' : 'A quieter stretch.', text: d > 0
          ? 'Your average is up ' + d + ' pins over your last 10 games (' + last + ', was ' + prev + ').'
          : 'Your last 10 games average ' + last + ', ' + (-d) + ' below the 10 before.' });
      }
    }
    // 2. new season high in the latest night
    if (thisS.length >= 6) {
      const high = Math.max.apply(null, thisS.map(g => g.total));
      const lastDate = all[all.length - 1].date;
      const hit = thisS.filter(g => g.date === lastDate && g.total === high);
      const before = thisS.filter(g => g.date < lastDate).map(g => g.total);
      if (hit.length && before.length && high > Math.max.apply(null, before)) {
        out.push({ id: 'seasonHigh', tone: 'up', title: 'New season high!', text: high + ' on ' + fmtShort(lastDate) + ' is your best game this season.' });
      }
    }
    // 3. 200 games this season
    const two = thisS.filter(g => g.total >= 200).length;
    if (two) out.push({ id: 'twoHundreds', tone: 'up', title: 'Welcome to the 200 club.', text: 'You’ve bowled ' + two + ' game' + (two === 1 ? '' : 's') + ' of 200 or better this season.' });
    // 4. spare % vs last season
    const rNow = rates(thisS), rLast = rates(lastS);
    if (rNow && rLast && rNow.games >= 5 && rLast.games >= 5 && rNow.spare != null && rLast.spare != null) {
      const d = rNow.spare - rLast.spare;
      if (Math.abs(d) >= 3) out.push({ id: 'spares', tone: d > 0 ? 'up' : 'down', title: d > 0 ? 'Your spare game is improving.' : 'Spares need some attention.', text: 'Your spare % is ' + rNow.spare + '%, ' + (d > 0 ? 'up ' : 'down ') + Math.abs(d) + ' points on last season.' });
    }
    // 5. corner pins: the weaker of the 10 and the 7 over your last 20 tries
    const pins = [10, 7].map(p => { const a = pinAttempts(all, p).slice(-20); return { p, n: a.length, made: a.filter(x => x.made).length }; })
      .filter(x => x.n >= 5).sort((a, b) => a.made / a.n - b.made / b.n);
    if (pins.length) {
      const x = pins[0];
      out.push({ id: 'pin' + x.p, tone: x.made / x.n >= 0.85 ? 'up' : 'neutral', title: x.made / x.n >= 0.85 ? 'Your spare game is locked in.' : 'Corner pins to work on.', text: 'You’ve converted ' + x.made + ' of your last ' + x.n + ' ' + x.p + '-pin attempts.' });
    }
    // 6. best series
    const hs = highSeries(all);
    if (hs) out.push({ id: 'bestSeries', tone: 'neutral', title: 'Your best night so far.', text: 'Your best 3-game series is ' + hs.total + ' (' + fmtShort(hs.date) + ').' });
    // 7. league nights vs practice
    const lg = all.filter(g => g.leagueId).map(g => g.total), pr = all.filter(g => !g.leagueId).map(g => g.total);
    if (lg.length >= 6 && pr.length >= 6) {
      const d = floorAvg(lg) - floorAvg(pr);
      if (Math.abs(d) >= 5) out.push({ id: 'leaguePractice', tone: 'neutral', title: d > 0 ? 'League nights bring it out.' : 'Practice pays off.', text: 'You average ' + Math.abs(d) + ' more ' + (d > 0 ? 'on league nights than in practice.' : 'in practice than on league nights.') });
    }
    // 8. strike run
    let run = { n: 0 };
    all.filter(g => g.frames).forEach(g => { const n = longestStrikeRun(g); if (n >= run.n) run = { n, date: g.date }; });
    if (run.n >= 4) out.push({ id: 'strikeRun', tone: 'up', title: 'On fire.', text: 'Longest strike run: ' + run.n + ' in a row (' + fmtShort(run.date) + ').' });
    return out.slice(0, opts.max || 4);
  }

  // Season summary for the dashboard: this season's numbers (or all time if none yet).
  function seasonSummary(games, today) {
    const all = chrono(games);
    const season = seasonOf(today);
    const thisS = all.filter(g => seasonOf(g.date) === season);
    const lastS = all.filter(g => seasonOf(g.date) === season - 1);
    const use = thisS.length ? thisS : all;
    const avg = floorAvg(use.map(g => g.total));
    const lastAvg = floorAvg(lastS.map(g => g.total));
    return {
      label: thisS.length ? seasonLabel(season) + ' season' : 'All time',
      season: thisS.length ? season : null,
      games: use.length, avg,
      high: use.length ? Math.max.apply(null, use.map(g => g.total)) : null,
      highSeries: (highSeries(use) || {}).total || null,
      vsLast: thisS.length && lastS.length >= 9 && avg != null ? avg - lastAvg : null,
    };
  }

  // Per-group numbers (by ball, center, oil pattern...): rows sorted by games.
  function groupRows(games, keyFn) {
    const by = {};
    scored(games).forEach(g => { const k = keyFn(g); if (k == null) return; (by[k] = by[k] || []).push(g); });
    return Object.keys(by).map(k => {
      const list = by[k], t = list.map(g => g.total), r = rates(list);
      return { key: k, games: list.length, avg: floorAvg(t), high: Math.max.apply(null, t), strike: r ? r.strike : null, spare: r ? r.spare : null, detailed: r ? r.games : 0 };
    }).sort((a, b) => b.games - a.games || b.avg - a.avg);
  }

  // Everything the ball page shows.
  function ballReport(games, ballId, labels) {
    labels = labels || {};
    const mine = chrono(games).filter(g => (g.ballId || '') === ballId && !g.sheet);
    if (!mine.length) return { games: 0 };
    const t = mine.map(g => g.total), r = rates(mine);
    const pat = groupRows(mine, g => g.pattern || null).filter(x => x.games >= 3);
    const bestPattern = pat.slice().sort((a, b) => b.avg - a.avg)[0] || null;
    const use = groupRows(mine, g => (g.leagueId ? 'league:' + g.leagueId : 'practice'));
    const mostUsed = use[0] || null;
    return {
      games: mine.length, avg: floorAvg(t), high: Math.max.apply(null, t), strike: r ? r.strike : null, spare: r ? r.spare : null,
      detailed: r ? r.games : 0, first: mine[0].date, last: mine[mine.length - 1].date,
      bestPattern, patterns: groupRows(mine, g => g.pattern || 'Not recorded'), mostUsed,
      centers: groupRows(mine, g => g.centerId || null), recent: mine.slice(-5).reverse(),
      label: labels.ball || '',
    };
  }

  const Insights = { seasonOf, seasonLabel, chrono, stdev, consistency, highSeries, longestStrikeRun, pinAttempts, rates, insights, seasonSummary, groupRows, ballReport, fmtShort };
  if (typeof module !== 'undefined' && module.exports) module.exports = Insights;
  else global.BBInsights = Insights;
})(typeof window !== 'undefined' ? window : globalThis);
