/* BowlBoard — League: the list of leagues and each league's home (bowler's view).
 * A league opens on this week's matchup with Standings, Scores and Schedule below.
 * Everything here is read-only; league data comes from importing a weekly-scores file
 * (LeagueSecretary / BLS) and from games the bowler logs themselves.
 * The secretary tools (teams, rules, score entry, recaps) are archived in admin-archive/. */
(function () {
'use strict';
const BB = window.BB;
const LG = window.BBLeague, Store = window.BBStore;
const { RENDER, esc, icon, on, show, toast, ask, openSheet, closeSheet, todayISO, fmtDate, plural, backupNow } = BB;
const $ = s => document.querySelector(s);

const lv = { id: null, tab: 'standings', week: null }; // remembered league view
const TABS = [['standings', 'Standings'], ['scores', 'Scores'], ['schedule', 'Schedule']];
const fmtD = iso => LG.fmtDate(iso);
const intOr = (v, d) => { const n = parseInt(v, 10); return isNaN(n) ? d : n; };
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'league';
// Every league change goes through here, so the app knows league night happened.
function save(l) { Store.markLeagueEdit(l && l.teams ? l : Store.getLeague(lv.id)); Store.save(); }

/* ---------- entry point ---------- */
RENDER.league = function (p) {
  p = p || {};
  if (p.list) lv.id = null;
  if (p.id) { if (p.id !== lv.id) lv.week = null; lv.id = p.id; }
  if (p.tab) lv.tab = TABS.some(t => t[0] === p.tab) ? p.tab : 'standings'; // older links (admin, recap...) land on Standings
  if (p.week) lv.week = p.week;
  const l = lv.id && Store.getLeague(lv.id);
  if (!l) { lv.id = null; return renderList(); }
  if (!lv.week) lv.week = LG.currentWeek(l);
  lv.week = Math.max(1, Math.min(l.seasonWeeks, lv.week));
  renderLeague(l);
};

/* ---------- list ---------- */
function renderList() {
  const root = $('#screen-league');
  const ls = Store.state.leagues;
  let h = '<h2 class="screen-title">League</h2>';
  if (!ls.length) {
    h += '<div class="card intro">' + icon('league', 'intro-ic') + '<h3>No league yet</h3>' +
      '<p class="small muted">Bowl in a league? Import your league’s weekly scores (an Excel or CSV export from LeagueSecretary or BLS) to see standings, your matchup and everyone’s averages. Nothing to set up.</p>' +
      '<button class="btn" id="lgImport">' + icon('upload') + 'Import league scores</button><button class="btn secondary mt8" id="lgDemo">Try it with a demo league</button></div>' +
      '<p class="small muted center">Not in a league? Everything else in BowlBoard works without one.</p>';
  } else {
    h += ls.map(l => {
      const last = LG.lastScoredWeek(l);
      const me = LG.me(l);
      return '<button class="list-item nav-item league-row" data-lg="' + l.id + '"><span class="li-ic">' + icon('league') + '</span><div class="grow"><div class="t">' + esc(l.name) + '</div>' +
        '<div class="s">' + esc([Store.centerName(l.centerId) === '—' ? '' : Store.centerName(l.centerId), l.day + 's ' + l.time].filter(Boolean).join(' · ')) + '</div>' +
        '<div class="s">' + plural(l.teams.length, 'team') + ' · ' + (last ? 'week ' + last + ' of ' + l.seasonWeeks + ' bowled' : 'season not started') + (me ? ' · you: ' + esc(me.name) : '') + '</div></div><span class="chev">' + icon('chevron') + '</span></button>';
    }).join('');
    h += '<button class="btn secondary mt8" id="lgImport">' + icon('upload') + 'Import or update from a file</button>';
    if (!ls.some(l => /\(demo\)/.test(l.name))) h += '<button class="btn secondary mt8" id="lgDemo">Load a demo league</button>';
  }
  root.innerHTML = h;
  root.querySelectorAll('[data-lg]').forEach(b => b.addEventListener('click', () => show('league', { id: b.dataset.lg })));
  on('lgImport', 'click', () => BB.importLeagueSheet());
  on('lgDemo', 'click', () => {
    const l = LG.buildDemoLeague({ today: todayISO(), centerId: (Store.state.centers[0] || {}).id || '' });
    l.sample = true;
    l.askedMe = true; // fictional roster, so don't ask which bowler you are
    Store.addLeague(l);
    toast('Demo league loaded — 6 teams, 4 weeks bowled');
    show('league', { id: l.id, tab: 'standings', week: LG.lastScoredWeek(l) });
  });
}

/* ---------- league home ---------- */
function thisWeekCard(l) {
  const fw = LG.featuredWeek(l, todayISO());
  if (!fw) return '';
  const mm = LG.me(l) ? LG.myMatchup(l, fw.week) : null;
  const kicker = (fw.when === 'tonight' ? 'Tonight' : fw.when === 'next' ? 'Next up' : 'Last bowled') + ' · week ' + fw.week + (fw.date ? ' · ' + fmtDate(fw.date, { weekday: 'short', month: 'short', day: 'numeric' }) : '');
  let h = '<div class="card this-week' + (fw.when === 'tonight' ? ' tonight' : '') + '"><div class="kicker">' + icon('calendar') + esc(kicker) + '</div>';
  if (mm && mm.m) {
    h += '<div class="tw-title"><b>' + esc(LG.teamName(l, mm.teamId)) + '</b> <span class="muted">vs</span> <b>' + esc(LG.teamName(l, mm.opponentId)) + '</b></div>' +
      '<div class="small muted">' + esc(['Lanes ' + mm.lanes, l.time].filter(Boolean).join(' · ')) + '</div>';
    if (mm.entered) h += '<div class="night-result"><span class="pts">' + LG.fmtPts(mm.myPts) + '–' + LG.fmtPts(mm.theirPts) + ' pts' + (mm.decided ? '' : ' so far') + '</span>' +
      (mm.myGames.some(x => x != null) ? '<span class="my-games">You: ' + mm.myGames.filter(x => x != null).join(' · ') + (mm.linked ? ' ' + icon('link') : '') + '</span>' : '') + '</div>';
    h += '<button class="link-btn" data-go-week="' + fw.week + '" data-go-mi="' + mm.mi + '">' + (mm.entered ? 'Open the matchup ›' : 'Matchup sheet ›') + '</button>';
  } else if (mm && mm.bye) {
    h += '<div class="tw-title">' + esc(LG.teamName(l, mm.teamId)) + ' has the bye</div>';
  } else {
    const sch = LG.weekSchedule(l, fw.week);
    const done = sch.matchups.filter(m => { const r = LG.matchupResult(l, fw.week, m); return r.decided; }).length;
    h += '<div class="tw-title">' + plural(sch.matchups.length, 'matchup') + '</div><div class="small muted">' + (done ? done + ' of ' + sch.matchups.length + ' finished' : 'No scores in yet') + '</div>' +
      (l.bowlers.length && !l.sample ? '<button class="link-btn" id="twMe">Bowl in this league? Pick your name ›</button>' : '');
  }
  return h + '</div>';
}

// Small footer on every league: who you are, refresh from a file, remove it.
function optionsCard(l) {
  const me = LG.me(l);
  return '<div class="card league-options"><h3>' + esc(l.name) + '</h3>' +
    '<div class="small muted mb8">' + (me ? 'You’re ' + esc(me.name) + '.' : 'You haven’t picked which bowler you are.') + '</div>' +
    '<div class="row wrap"><button class="btn secondary small-btn" id="lgWho">' + (me ? 'Change my name' : 'Pick my name') + '</button>' +
    '<button class="btn secondary small-btn" id="lgUpdate">' + icon('upload') + 'Update from a file</button>' +
    '<button class="btn secondary small-btn" id="lgPoints">League points</button></div>' +
    '<button class="link-btn danger-link" id="lgRemove">Remove this league from this phone</button></div>';
}
async function removeLeague(l) {
  if (!(await ask('Remove ' + l.name + ' from this phone? Your own games stay in History. An automatic copy is kept first.', 'Remove league', true))) return;
  const can = await Store.snapshots.available();
  const copy = await Store.snapshots.take('before-league-delete', { force: true });
  if (can && !copy) { toast('Couldn’t keep a copy first, so nothing was removed. Try again.', 4000); return; }
  Store.deleteLeague(l.id); lv.id = null;
  toast(copy ? 'League removed — an automatic copy was kept' : 'League removed');
  show('league', { list: true });
}

function renderLeague(l) {
  const root = $('#screen-league');
  const last = LG.lastScoredWeek(l);
  let h = BB.backLink('league', 'Leagues', { list: true });
  h += '<div class="league-head"><h2 class="screen-title">' + esc(l.name) + '</h2><div class="small muted">' +
    esc([Store.centerName(l.centerId) === '—' ? '' : Store.centerName(l.centerId), l.day + 's ' + l.time, plural(l.teams.length, 'team'), last ? 'week ' + last + ' of ' + l.seasonWeeks + ' bowled' : 'season not started'].filter(Boolean).join(' · ')) + '</div></div>';
  if (l.teams.length >= 2) h += thisWeekCard(l);
  h += '<div class="seg" role="tablist">' + TABS.map(t => '<button role="tab" aria-selected="' + (lv.tab === t[0]) + '" class="' + (lv.tab === t[0] ? 'on' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>';
  h += '<div id="lgBody"></div>' + optionsCard(l);
  root.innerHTML = h;
  root.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { lv.tab = b.dataset.tab; renderLeague(l); }));
  root.querySelectorAll('[data-go-week]').forEach(b => b.addEventListener('click', () => show('matchup', { id: l.id, week: +b.dataset.goWeek, mi: +b.dataset.goMi })));
  on('twMe', 'click', () => BB.askMe(l));
  on('lgWho', 'click', () => BB.askMe(l));
  on('lgUpdate', 'click', () => BB.importLeagueSheet());
  on('lgPoints', 'click', () => BB.pointsSheet(l));
  on('lgRemove', 'click', () => removeLeague(l));
  const body = root.querySelector('#lgBody');
  const T = BB.LT;
  ({ scores: T.scores, standings: T.standings, schedule: T.schedule }[lv.tab] || T.standings)(l, body);
  if (!l.askedMe && !LG.me(l) && l.bowlers.length >= 2) setTimeout(() => BB.askMe(l), 50);
}

function weekPicker(l, label) {
  const w = lv.week;
  const scored = LG.weekHasScores(l, w);
  return '<div class="week-picker"><button class="wk-btn" id="wkPrev" aria-label="Previous week"' + (w <= 1 ? ' disabled' : '') + '>‹</button>' +
    '<div class="wk-mid"><b>' + (label || 'Week') + ' ' + w + '</b><small>' + esc(fmtD(LG.weekDate(l, w))) + (scored ? ' · scores in' : '') + '</small></div>' +
    '<button class="wk-btn" id="wkNext" aria-label="Next week"' + (w >= l.seasonWeeks ? ' disabled' : '') + '>›</button></div>';
}
function bindWeekPicker(l) {
  on('wkPrev', 'click', () => { lv.week = Math.max(1, lv.week - 1); renderLeague(l); });
  on('wkNext', 'click', () => { lv.week = Math.min(l.seasonWeeks, lv.week + 1); renderLeague(l); });
}
function needTeams(l, body) {
  if (l.teams.length >= 2) return false;
  body.innerHTML = '<div class="empty">This league has no teams yet.<br>Import a weekly scores file to fill it in.<br><button class="btn small-btn mt8" id="goImport">Import a file</button></div>';
  on('goImport', 'click', () => BB.importLeagueSheet());
  return true;
}

/* ---------- after league night: keep a copy, offer a backup file ---------- */
const LEAGUE_SCREENS = ['league', 'matchup'];
BB.onLeave((from, to) => {
  if (LEAGUE_SCREENS.indexOf(from) < 0 || LEAGUE_SCREENS.indexOf(to) >= 0) return;
  const st = Store.state;
  if (!Store.sessionLeagueEdit || !st.leagueEditAt) return;
  if (st.lastBackupAt && st.lastBackupAt >= st.leagueEditAt) return;
  if (st.backupPromptAt && st.backupPromptAt >= st.leagueEditAt) return;
  if (st.backupPromptAt && Date.now() - new Date(st.backupPromptAt).getTime() < 30 * 60e3) { Store.snapshots.take('league-night'); return; } // asked a moment ago
  st.backupPromptAt = new Date().toISOString();
  Store.save();
  Store.snapshots.take('league-night');
  if (BB.sheetRoot()) return; // don't cover a sheet that's already open
  openSheet('<h3>' + icon('shield') + 'Back up the league scores?</h3>' +
    '<p class="mt0">They’re saved on this phone, and BowlBoard just kept an automatic copy. A backup file is the only copy that survives a cleared browser or a lost phone.</p>' +
    '<button class="btn" id="lnBackup">' + icon('download') + (BB.EMBED ? 'Copy backup' : 'Back up now') + '</button><button class="btn secondary mt8" id="lnLater" data-close>Not now</button>', sh => {
    sh.querySelector('#lnBackup').addEventListener('click', () => { closeSheet(); backupNow(); if (BB.nav.current === 'home') BB.rerender(); });
  });
});

BB.LT = {}; // league tabs, filled in by the league files that follow
BB.L = { lv, TABS, fmtD, intOr, slug, save, renderLeague, renderList, weekPicker, bindWeekPicker, needTeams };
})();
