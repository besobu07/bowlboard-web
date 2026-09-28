/* BowlBoard — League: the list of leagues, creating one, and each league's home.
 * A league opens on the bowler's view (this week, scores, standings, schedule,
 * recap); rosters, rules, imports and exports live under Admin. */
(function () {
'use strict';
const BB = window.BB;
const LG = window.BBLeague, Store = window.BBStore;
const { RENDER, esc, icon, on, val, show, toast, ask, openSheet, closeSheet, screenRoot, todayISO, fmtDate, plural, backupNow } = BB;
const $ = s => document.querySelector(s);

const lv = { id: null, tab: 'scores', week: null, admin: 'bowlers', editSchedule: false }; // remembered league view
const TABS = [['scores', 'Scores'], ['standings', 'Standings'], ['schedule', 'Schedule'], ['recap', 'Recap'], ['admin', 'Admin']];
const fmtD = iso => LG.fmtDate(iso);
const intOr = (v, d) => { const n = parseInt(v, 10); return isNaN(n) ? d : n; };
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'league';
// Every league change goes through here, so the app knows league night happened.
function save(l) { Store.markLeagueEdit(l && l.teams ? l : Store.getLeague(lv.id)); Store.save(); }

// Rebuild matchups for weeks that haven't been bowled; bowled weeks keep theirs, and
// every week keeps its date (new weeks follow on a week apart).
function regenSchedule(l) { LG.rebuildSchedule(l); }

/* ---------- entry point ---------- */
RENDER.league = function (p) {
  p = p || {};
  if (p.list) lv.id = null;
  if (p.id) { if (p.id !== lv.id) { lv.week = null; lv.editSchedule = false; } lv.id = p.id; }
  if (p.tab) lv.tab = p.tab === 'bowlers' || p.tab === 'settings' ? 'admin' : p.tab;
  if (p.tab === 'bowlers' || p.tab === 'settings') lv.admin = p.tab;
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
  let h = '<h2 class="screen-title">Leagues</h2>';
  if (!ls.length) {
    h += '<div class="card intro">' + icon('league', 'intro-ic') + '<h3>Your league, in one place</h3>' +
      '<p class="small muted">Bowl in a league? See your matchup, standings and averages. Running one? Rosters, weekly scores, handicaps and standings are figured automatically, and a recap is ready to email in one tap.</p>' +
      '<button class="btn" id="lgCreate">Create a league</button><button class="btn secondary mt8" id="lgImport">' + icon('upload') + 'Import a league from a file</button><button class="btn secondary mt8" id="lgDemo">Try it with a demo league</button></div>';
  } else {
    h += ls.map(l => {
      const last = LG.lastScoredWeek(l);
      const me = LG.me(l);
      return '<button class="list-item nav-item league-row" data-lg="' + l.id + '"><span class="li-ic">' + icon('league') + '</span><div class="grow"><div class="t">' + esc(l.name) + '</div>' +
        '<div class="s">' + esc([Store.centerName(l.centerId) === '—' ? '' : Store.centerName(l.centerId), l.day + 's ' + l.time].filter(Boolean).join(' · ')) + '</div>' +
        '<div class="s">' + plural(l.teams.length, 'team') + ' · ' + (last ? 'week ' + last + ' of ' + l.seasonWeeks + ' bowled' : 'season not started') + (me ? ' · you: ' + esc(me.name) : '') + '</div></div><span class="chev">' + icon('chevron') + '</span></button>';
    }).join('');
    h += '<button class="btn mt8" id="lgCreate">+ Create a league</button><button class="btn secondary mt8" id="lgImport">' + icon('upload') + 'Import a league from a file</button>';
    if (!ls.some(l => /\(demo\)/.test(l.name))) h += '<button class="btn secondary mt8" id="lgDemo">Load a demo league</button>';
  }
  root.innerHTML = h;
  root.querySelectorAll('[data-lg]').forEach(b => b.addEventListener('click', () => show('league', { id: b.dataset.lg })));
  on('lgCreate', 'click', createSheet);
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

function createSheet() {
  const l = LG.createLeague({ startDate: todayISO(), centerId: (Store.state.centers[0] || {}).id || '' });
  openSheet('<h3>New league</h3>' + BB.leagueFormHTML(l, false) + '<button class="btn" id="lfCreate">Create league</button>', sh => {
    const btn = sh.querySelector('#lfCreate');
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const err = BB.readLeagueForm(l, false);
      if (err) { toast(err); return; }
      btn.disabled = true; // one tap, one league
      l.day = l.startDate ? LG.DAYS[new Date(l.startDate + 'T12:00:00').getDay()] : l.day;
      Store.addLeague(l);
      save(l);
      closeSheet();
      toast('League created — now add teams and bowlers');
      show('league', { id: l.id, tab: 'bowlers' });
    });
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
function renderLeague(l) {
  const root = $('#screen-league');
  const last = LG.lastScoredWeek(l);
  let h = BB.backLink('league', 'Leagues', { list: true });
  h += '<div class="league-head"><h2 class="screen-title">' + esc(l.name) + '</h2><div class="small muted">' +
    esc([Store.centerName(l.centerId) === '—' ? '' : Store.centerName(l.centerId), l.day + 's ' + l.time, plural(l.teams.length, 'team'), last ? 'week ' + last + ' of ' + l.seasonWeeks + ' bowled' : 'season not started'].filter(Boolean).join(' · ')) + '</div></div>';
  if (l.teams.length >= 2) h += thisWeekCard(l);
  h += '<div class="seg" role="tablist">' + TABS.map(t => '<button role="tab" aria-selected="' + (lv.tab === t[0]) + '" class="' + (lv.tab === t[0] ? 'on' : '') + (t[0] === 'admin' ? ' admin-tab' : '') + '" data-tab="' + t[0] + '"' + (t[0] === 'admin' ? ' title="Admin: teams, rules, imports"' : '') + '>' + (t[0] === 'admin' ? icon('gear') + '<span class="sr">' + t[1] + '</span>' : t[1]) + '</button>').join('') + '</div>';
  h += '<div id="lgBody"></div>';
  root.innerHTML = h;
  root.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { lv.tab = b.dataset.tab; renderLeague(l); }));
  root.querySelectorAll('[data-go-week]').forEach(b => b.addEventListener('click', () => show('matchup', { id: l.id, week: +b.dataset.goWeek, mi: +b.dataset.goMi })));
  on('twMe', 'click', () => BB.askMe(l));
  const body = root.querySelector('#lgBody');
  const T = BB.LT;
  ({ scores: T.scores, standings: T.standings, recap: T.recap, schedule: T.schedule, admin: T.admin }[lv.tab] || T.scores)(l, body);
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
  body.innerHTML = '<div class="empty">Add at least two teams to get a schedule going.<br><button class="btn small-btn mt8" id="goBowlers">Add teams &amp; bowlers</button></div>';
  on('goBowlers', 'click', () => { lv.tab = 'admin'; lv.admin = 'bowlers'; renderLeague(l); });
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
BB.L = { lv, TABS, fmtD, intOr, slug, save, regenSchedule, renderLeague, renderList, weekPicker, bindWeekPicker, needTeams };
})();
