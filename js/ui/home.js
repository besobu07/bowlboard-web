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
  if (!mm) return ''; // Home only speaks up about leagues you've said you bowl in
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

// A small trend line for the season card: the average as the season went, oldest to newest.
function sparkline(games) {
  const t = I.chrono(games).map(g => g.total).slice(-40);
  if (t.length < 3) return '';
  // running average: how the season average got to where it is
  let sum = 0;
  const pts = t.map((v, i) => { sum += v; return sum / (i + 1); }).slice(Math.min(2, t.length - 3));
  const W = 200, H = 90, pad = 6;
  const lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts), span = Math.max(8, hi - lo);
  const xy = pts.map((v, i) => [pad + (W - 2 * pad) * i / (pts.length - 1), H - pad - (H - 2 * pad) * (v - lo) / span]);
  const line = xy.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const last = xy[xy.length - 1];
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Your average over the season, trending ' + (pts[pts.length - 1] >= pts[0] ? 'up' : 'down') + '">' +
    '<defs><linearGradient id="sfill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#F6A623" stop-opacity=".35"/><stop offset="1" stop-color="#F6A623" stop-opacity="0"/></linearGradient></defs>' +
    '<path d="' + line + ' L' + last[0].toFixed(1) + ' ' + H + ' L' + xy[0][0].toFixed(1) + ' ' + H + ' Z" fill="url(#sfill)"/>' +
    '<path d="' + line + '" fill="none" stroke="#E67E22" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>' +
    '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="4" fill="#E67E22"/></svg>';
}

RENDER.home = function () {
  const root = screenRoot();
  const today = todayISO();
  const mine = myGames();
  const st = Store.state;
  let h = '<div class="home-backdrop" aria-hidden="true"><img src="lane.jpg" alt=""></div>';
  if (Store.recovery) {
    h += '<div class="card recover" role="alert"><h3>' + icon('alert') + 'We couldn’t read the data saved on this phone</h3>' +
      '<p class="small mt0">It hasn’t been deleted. BowlBoard set it aside' + (Store.recovery.kept ? '' : ' (and won’t save anything over it)') + '. Restore an automatic copy or a backup file to carry on where you left off.</p>' +
      '<button class="btn" data-act="go" data-to="backup">Restore my data</button><button class="btn secondary mt8" id="recoverFresh">Start fresh instead</button></div>';
  }
  if (!st.games.length && !st.leagues.length) {
    h += '<div class="card welcome"><img class="welcome-icon" src="app-icon.png" alt=""><img class="welcome-logo" src="wordmark.png" alt="BowlBoard">' +
      '<div class="tagline">Built for Bowlers</div>' +
      '<p class="muted">Log every game — pin by pin, from a photo of the lane screen, or just the score. BowlBoard keeps your average, stats and league standings.</p>' +
      '<button class="btn" id="homeNew">' + icon('pin') + 'Bowl a game</button>' +
      '<button class="btn secondary mt8" data-act="go" data-to="league">' + icon('pins') + 'I bowl in a league</button>' +
      (Sample.has(Store) ? '' : '<button class="link-btn mt8" id="homeSamples">Explore a sample season</button>') + '</div>';
    root.innerHTML = h;
    bind(null);
    return;
  }

  const name = firstName();
  h += '<div class="greet"><h2>' + greeting() + (name ? ', ' + esc(name) : '') + '</h2></div>';

  // BOWL: the hero action
  const own = Store.allSeries();
  const latest = own[0];
  const cont = latest && latest.date === today && latest.games.length < 6;
  h += '<div class="bowl-card" data-act="bowlCard">' +
    '<img class="bc-mark" src="app-icon.png" alt="">' +
    '<div class="bc-body"><div class="bc-title">Bowl</div><div class="bc-sub">' + (cont ? 'Continue tonight’s series · game ' + (latest.games.length + 1) : 'Start a new game') + '</div>' +
    '</div>' +
    '<button class="bc-go" id="' + (cont ? 'homeContinue' : 'homeNew') + '" type="button" aria-label="' + (cont ? 'Continue tonight’s series' : 'Bowl: start a new game') + '">' + icon('arrow') + '</button>' +
    // the three ways to score get their own full-width row so they never wrap on narrow phones
    '<div class="bc-modes"><button type="button" data-act="bowlMode" data-mode="pins">Pin by pin</button><i>•</i><button type="button" data-act="bowlMode" data-mode="photo">Photo</button><i>•</i><button type="button" data-act="bowlMode" data-mode="total">Just the score</button></div></div>';
  if (cont) h += '<button class="link-btn bc-alt" id="homeNew">Start a separate series instead</button>';

  // League: tonight right under Bowl; otherwise quietly further down
  const leagues = myLeagues();
  const cards = leagues.slice(0, 2).map(l => nightCard(l, today)).filter(Boolean);
  const tonight = cards.filter(c => / tonight/.test(c.slice(0, 40)));
  const later = cards.filter(c => tonight.indexOf(c) < 0);
  h += tonight.join('');

  // YOUR GAME: put the most actionable bowling feedback ahead of the historical dashboard.
  const ins = I.insights(mine, { today, max: 1 })[0];
  if (ins) h += '<button class="card your-game" data-act="go" data-to="stats">' + icon('stats') + '<span class="yg"><span class="kicker">Your game</span><span class="yg-title">' + esc(ins.title || '') + '</span><span class="yg-text">' + esc(ins.text) + '</span></span><span class="chev">' + icon('chevron') + '</span></button>';

  // THIS SEASON (paper)
  const sum = I.seasonSummary(mine, today);
  if (sum.games) {
    const scope = sum.season != null ? mine.filter(g => I.seasonOf(g.date) === sum.season) : mine;
    h += '<div class="card season-card"><div class="kicker">' + (sum.season != null ? 'This season' : 'All time') + '</div>' +
      '<div class="season-top"><div class="sa"><b>' + (sum.avg == null ? '—' : sum.avg) + '</b><span>Average</span>' +
      (sum.vsLast != null && sum.vsLast !== 0 ? '<em class="' + (sum.vsLast > 0 ? 'up' : 'down') + '">' + (sum.vsLast > 0 ? '↑ ' : '↓ ') + Math.abs(sum.vsLast) + ' vs. last season</em>' : '') + '</div>' +
      sparkline(scope) + '</div>' +
      '<div class="season-row3"><div><b>' + (sum.high == null ? '—' : sum.high) + '</b><span>High game</span></div><div><b>' + (sum.highSeries || '—') + '</b><span>High series</span></div><div><b>' + sum.games + '</b><span>' + (sum.games === 1 ? 'Game' : 'Games') + '</span></div></div></div>';
  }

  // LAST SESSION
  const series = Store.allSeries(mine);
  const last = series[0];
  if (last) {
    const tot = last.games.filter(g => g.total != null);
    h += '<div class="card last-session"><div class="ls-head"><div class="kicker">Last session</div><small>' + esc(fmtDate(last.date, { weekday: 'short', month: 'short', day: 'numeric' })) + '</small></div>' +
      '<div class="ls-row"><div class="ls-games"><div class="g">' + last.games.map(g => (g.total == null ? '—' : g.total)).join('<i>·</i>') + '</div>' +
      (tot.length > 1 ? '<small>' + tot.reduce((a, g) => a + g.total, 0) + ' series · ' + tot.length + ' games' + (last.leagueId ? ' · ' + esc(BB.leagueName(last.leagueId)) : ' · practice') + '</small>' : '<small>' + (last.leagueId ? esc(BB.leagueName(last.leagueId)) : 'Practice') + '</small>') + '</div>' +
      '<button class="btn-outline" data-act="series" data-first="' + esc(last.games[0].id) + '">View session →</button></div></div>';
  }

  h += later.join('');

  // backup: only when it needs doing (and a quiet confirmation once done)
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
  root.innerHTML = h;
  bind(latest);
};

function bind(latest) {
  on('homeNew', 'click', e => { e.stopPropagation(); BB.newGame(); });
  on('homeContinue', 'click', e => { e.stopPropagation(); BB.continueSeries(latest.games[latest.games.length - 1]); });
  on('homeSamples', 'click', () => { try { Sample.seed(Store, window.BBScore, LG, todayISO()); toast('Sample data loaded — clear it from Home anytime'); RENDER.home(); } catch (e) { toast('Couldn’t load sample data'); } });
  on('clearSamples', 'click', async () => {
    if (!(await ask('Remove the sample games, balls, centers and demo league? Anything you entered yourself stays.', 'Clear sample data', true))) return;
    Sample.clear(Store); toast('Sample data cleared'); RENDER.home();
  });
  on('nudgeBackup', 'click', () => { backupNow(); RENDER.home(); });
  on('nudgeLater', 'click', () => { Store.state.backupNudgeAt = new Date().toISOString(); Store.save(); RENDER.home(); });
  on('recoverFresh', 'click', async () => {
    const kept = Store.recovery && Store.recovery.kept;
    const msg = kept ? 'Start with no data? What couldn’t be read stays set aside, and automatic copies stay under More → Backup.'
      : 'This phone had no room to set the unreadable data aside, so starting fresh will replace it. Download it first from More → Backup & restore if you might need it. Start fresh anyway?';
    if (!(await ask(msg, kept ? 'Start fresh' : 'Start fresh anyway', !kept))) return;
    Store.dismissRecovery(); RENDER.home();
  });
}
BB.ACT.home = {
  bowlLeague: a => BB.newGame({ leagueId: a.dataset.id }),
  bowlMode: (a, e) => { e.stopPropagation(); BB.newGame({ mode: a.dataset.mode }); },
  bowlCard: (a, e) => {
    if (e.target.closest('button')) return; // the buttons inside handle themselves
    const own = Store.allSeries()[0];
    if (own && own.date === todayISO() && own.games.length < 6) BB.continueSeries(own.games[own.games.length - 1]);
    else BB.newGame();
  },
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
