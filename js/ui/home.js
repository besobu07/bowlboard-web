/* BowlBoard — Home: the bowler's dashboard. Tonight's league night, the season so
 * far, last night's games, one thing worth knowing, and a big Bowl button. */
(function () {
'use strict';
const BB = window.BB;
const Store = window.BBStore, LG = window.BBLeague, Sample = window.BBSample, I = window.BBInsights;
const { RENDER, esc, fmtDate, todayISO, icon, on, show, toast, ask, screenRoot, daysSince, plural, myGames, firstName, myLeagues, seriesCardHTML, backupStatus, backupNow } = BB;

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
const addDays = (iso, n) => LG.addDays(iso, n);

function nightCard(l, today) {
  const fw = LG.featuredWeek(l, today);
  if (!fw) return '';
  const soon = fw.when === 'tonight' || (fw.when === 'next' && fw.date && fw.date <= addDays(today, 6));
  const mm = LG.me(l) ? LG.myMatchup(l, fw.week) : null;
  if (!mm) {
    // Secretary view: a league night today with nobody marked as you.
    if (fw.when !== 'tonight' || l.sample) return '';
    return '<div class="card night"><div class="kicker">' + icon('calendar') + 'Tonight · week ' + fw.week + '</div><div class="night-title">' + esc(l.name) + '</div>' +
      '<button class="btn secondary mt8" data-act="league" data-id="' + l.id + '" data-tab="scores" data-week="' + fw.week + '">Enter week ' + fw.week + ' scores</button></div>';
  }
  if (!soon && fw.when !== 'last') return '';
  const kicker = fw.when === 'tonight' ? 'Tonight · week ' + fw.week : fw.when === 'next' ? fmtDate(fw.date, { weekday: 'short', month: 'short', day: 'numeric' }) + ' · week ' + fw.week : 'Week ' + fw.week + ' result';
  let h = '<div class="card night' + (fw.when === 'tonight' ? ' tonight' : '') + '"><div class="kicker">' + icon(fw.when === 'last' ? 'league' : 'calendar') + esc(kicker) + '</div>';
  if (mm.sub) h += '<div class="night-title">' + esc(l.name) + '</div><div class="small muted">You’re on the sub list this week.</div>';
  else if (mm.bye) h += '<div class="night-title">' + esc(LG.teamName(l, mm.teamId)) + ' has the bye</div><div class="small muted">' + esc(l.name) + '</div>';
  else {
    h += '<div class="night-title"><b>' + esc(LG.teamName(l, mm.teamId)) + '</b> <span class="muted">vs</span> <b>' + esc(LG.teamName(l, mm.opponentId)) + '</b></div>' +
      '<div class="small muted">' + esc([l.time, 'Lanes ' + mm.lanes, l.name].filter(Boolean).join(' · ')) + '</div>';
    if (mm.entered) {
      const g = mm.myGames.filter(x => x != null);
      h += '<div class="night-result"><span class="pts">' + LG.fmtPts(mm.myPts) + '–' + LG.fmtPts(mm.theirPts) + ' pts' + (mm.decided ? '' : ' so far') + '</span>' +
        (g.length ? '<span class="my-games">' + g.join(' · ') + (mm.linked ? ' ' + icon('link') : '') + '</span>' : '') + '</div>';
    }
  }
  const bowled = mm.myGames && mm.myGames.some(x => x != null);
  h += '<div class="row mt8 night-actions">' + (fw.when === 'tonight' && !bowled && !mm.sub && !mm.bye ? '<button class="btn grow bowl-night" data-act="bowlLeague" data-id="' + l.id + '">' + icon('pin') + 'Bowl week ' + fw.week + '</button>' : '') +
    '<button class="btn secondary grow" data-act="league" data-id="' + l.id + '" data-tab="' + (mm.entered ? 'standings' : 'schedule') + '" data-week="' + fw.week + '">' + (mm.entered ? 'Standings' : 'League') + '</button></div>';
  return h + '</div>';
}

RENDER.home = function () {
  const root = screenRoot();
  const today = todayISO();
  const mine = myGames();
  const st = Store.state;
  let h = '';
  if (Store.recovery) {
    h += '<div class="card recover" role="alert"><h3>' + icon('alert') + 'We couldn’t read the data saved on this phone</h3>' +
      '<p class="small mt0">It hasn’t been deleted. BowlBoard set it aside' + (Store.recovery.kept ? '' : ' (and won’t save anything over it)') + '. Restore an automatic copy or a backup file to carry on where you left off.</p>' +
      '<button class="btn" data-act="go" data-to="backup">Restore my data</button><button class="btn secondary mt8" id="recoverFresh">Start fresh instead</button></div>';
  }
  if (!st.games.length && !st.leagues.length) {
    h += '<div class="card welcome"><img class="welcome-logo" src="logo-icon.jpg" alt="BowlBoard">' +
      '<h2>Your bowling season, in one place.</h2>' +
      '<p class="muted">Log every game — pin by pin, from a photo of the lane screen, or just the totals. BowlBoard keeps your average, stats and league standings.</p>' +
      '<button class="btn bowl-btn" id="homeNew">' + icon('pin') + 'Bowl a game</button>' +
      '<button class="btn secondary mt8" data-act="go" data-to="league">' + icon('league') + 'Set up or import a league</button>' +
      (Sample.has(Store) ? '' : '<button class="link-btn mt8" id="homeSamples">Look around with sample data</button>') + '</div>';
    root.innerHTML = h;
    bind(null);
    return;
  }

  const name = firstName();
  const leagues = myLeagues();
  const ctx = leagues.length ? (() => { const l = leagues[0], fw = LG.featuredWeek(l, today); return l.name + (fw && fw.when !== 'last' ? ' · week ' + fw.week : ''); })()
    : fmtDate(today, { weekday: 'long', month: 'long', day: 'numeric' });
  h += '<div class="greet"><h2>' + greeting() + (name ? ', ' + esc(name) : '') + '</h2><div class="small muted">' + esc(ctx) + '</div></div>';

  // league nights (yours first, then any league night you run today)
  const cards = leagues.slice(0, 2).map(l => nightCard(l, today)).concat(st.leagues.filter(l => !LG.me(l)).map(l => nightCard(l, today))).filter(Boolean);
  h += cards.join('');

  // bowl
  const own = Store.allSeries();
  const latest = own[0];
  if (latest && latest.date === today && latest.games.length < 6) {
    h += '<button class="btn bowl-btn" id="homeContinue">' + icon('pin') + 'Continue tonight’s series · game ' + (latest.games.length + 1) + '</button>';
    h += '<button class="btn secondary mt8" id="homeNew">Start a new series</button>';
  } else if (/data-act="bowlLeague"/.test(cards.join(''))) {
    h += '<button class="btn secondary" id="homeNew">' + icon('pin') + 'Bowl a practice game</button>';
  } else {
    h += '<button class="btn bowl-btn" id="homeNew">' + icon('pin') + 'Bowl<small>Pin by pin, a photo of the lane screen, or totals</small></button>';
  }

  // season
  const sum = I.seasonSummary(mine, today);
  if (sum.games) {
    h += '<div class="card season"><div class="kicker">' + esc(sum.label) + '</div><div class="season-row"><div class="season-avg"><b>' + (sum.avg == null ? '—' : sum.avg) + '</b><span>average</span>' +
      (sum.vsLast != null && sum.vsLast !== 0 ? '<em class="' + (sum.vsLast > 0 ? 'up' : 'down') + '">' + (sum.vsLast > 0 ? '+' : '−') + Math.abs(sum.vsLast) + ' vs last season</em>' : '') + '</div>' +
      '<div class="season-stats"><div><b>' + (sum.high == null ? '—' : sum.high) + '</b><span>high game</span></div><div><b>' + (sum.highSeries || '—') + '</b><span>high series</span></div><div><b>' + sum.games + '</b><span>' + (sum.games === 1 ? 'game' : 'games') + '</span></div></div></div>' +
      myLeagueChips() + '</div>';
  }

  // last night
  const series = Store.allSeries(mine);
  const last = series[0];
  if (last) {
    const when = last.date === today ? 'Today' : last.date === addDays(today, -1) ? 'Last night' : fmtDate(last.date, { weekday: 'short', month: 'short', day: 'numeric' });
    const tot = last.games.filter(g => g.total != null);
    h += '<button class="card last-night" data-act="series" data-first="' + esc(last.games[0].id) + '"><div class="kicker">' + esc(when) + (last.leagueId ? ' · ' + esc(BB.leagueName(last.leagueId)) : '') + '</div>' +
      '<div class="ln-games">' + last.games.map(g => '<b>' + (g.total == null ? '—' : g.total) + '</b>').join('<i>·</i>') + '</div>' +
      (tot.length > 1 ? '<div class="small muted">' + tot.reduce((a, g) => a + g.total, 0) + ' series</div>' : '') + '</button>';
  }

  // one insight
  const ins = I.insights(mine, { today, max: 1 })[0];
  if (ins) h += '<button class="card insight" data-act="go" data-to="stats">' + icon('sparkle') + '<span>' + esc(ins.text) + '</span><span class="more-link">More in Stats ›</span></button>';

  // backup
  const bs = backupStatus();
  const snooze = bs.leagueSince ? 1 : 7;
  if (bs.due && daysSince(st.backupNudgeAt) >= snooze) {
    h += '<div class="card backup-card due">' + icon('shield') + '<div class="grow"><b>' + (bs.leagueSince ? 'League scores aren’t backed up yet' : 'Your games live only on this phone') + '</b>' +
      '<div class="small muted">' + esc(bs.label) + '. Clearing browser data or losing the phone loses them.</div>' +
      '<div class="row mt8"><button class="btn small-btn" id="nudgeBackup">Back up now</button><button class="btn secondary small-btn" id="nudgeLater">Not now</button></div></div></div>';
  } else if (bs.today) {
    h += '<div class="backup-ok small">' + icon('check') + 'Backed up today</div>';
  }

  if (Sample.has(Store)) {
    h += '<div class="notice sample-note"><b>Sample data.</b> These games and the demo league are examples so you can look around. <button class="link-btn" id="clearSamples">Clear sample data</button></div>';
  }
  const more = series.slice(1, 4);
  if (more.length) h += '<h2 class="screen-title">Recent</h2>' + more.map(seriesCardHTML).join('') + '<button class="link-btn" data-act="go" data-to="history">All games ›</button>';
  root.innerHTML = h;
  bind(latest);
};

function bind(latest) {
  on('homeNew', 'click', () => BB.newGame());
  on('homeContinue', 'click', () => BB.continueSeries(latest.games[latest.games.length - 1]));
  on('homeSamples', 'click', () => { try { Sample.seed(Store, window.BBScore, LG, todayISO()); toast('Sample data loaded — clear it from Home anytime'); RENDER.home(); } catch (e) { toast('Couldn’t load sample data'); } });
  on('clearSamples', 'click', async () => {
    if (!(await ask('Remove the sample games, balls, centers and demo league? Anything you entered yourself stays.', 'Clear sample data', true))) return;
    Sample.clear(Store); toast('Sample data cleared'); RENDER.home();
  });
  on('nudgeBackup', 'click', () => { backupNow(); RENDER.home(); });
  on('nudgeLater', 'click', () => { Store.state.backupNudgeAt = new Date().toISOString(); Store.save(); RENDER.home(); });
  on('recoverFresh', 'click', async () => {
    const kept = Store.recovery && Store.recovery.kept;
    const msg = kept ? 'Start with no data? What couldn\u2019t be read stays set aside, and automatic copies stay under More → Backup.'
      : 'This phone had no room to set the unreadable data aside, so starting fresh will replace it. Download it first from More → Backup & restore if you might need it. Start fresh anyway?';
    if (!(await ask(msg, kept ? 'Start fresh' : 'Start fresh anyway', !kept))) return;
    Store.dismissRecovery(); RENDER.home();
  });
}
BB.ACT.home = {
  bowlLeague: a => BB.newGame({ leagueId: a.dataset.id }),
};

function myLeagueChips() {
  const out = [];
  Store.state.leagues.forEach(l => {
    const me = LG.me(l);
    if (!me) return;
    const st = LG.bowlerStats(l, LG.lastScoredWeek(l)).find(b => b.id === me.id);
    out.push('<button class="league-chip" data-act="league" data-id="' + l.id + '"><span>' + esc(l.name) + '</span><b>' + (st && st.avg != null ? st.avg : (st ? st.currentAvg : '—')) + '</b><small>league avg' + (st && st.hcp ? ' · hcp ' + st.hcp : '') + '</small></button>');
  });
  return out.length ? '<div class="league-chips">' + out.join('') + '</div>' : '';
}
Object.assign(BB, { myLeagueChips });
})();
