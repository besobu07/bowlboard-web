/* BowlBoard prototype — league admin screens.
 * League list, create/settings, teams & rosters (with CSV import), schedule,
 * weekly score entry per matchup, standings/averages, and the weekly recap
 * (email / copy for email / share / download / print).
 */
(function () {
'use strict';
const LG = window.BBLeague, Store = window.BBStore, BB = window.BB;
const { show, toast, esc, on, val, openSheet, closeSheet, ask, download, copyText, copyRich } = BB;
const el = id => BB.el(id);
const RENDER = BB.RENDER;
const EMBED = BB.EMBED;
const $ = s => document.querySelector(s);

const lv = { id: null, tab: 'scores', week: null }; // remembered league view
const TABS = [['scores', 'Scores'], ['standings', 'Standings'], ['recap', 'Recap'], ['bowlers', 'Bowlers'], ['schedule', 'Schedule'], ['settings', 'Settings']];
const fmtD = iso => LG.fmtDate(iso);
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

function save() { Store.save(); }
function intOr(v, d) { const n = parseInt(v, 10); return isNaN(n) ? d : n; }

// Rebuild matchups for weeks that haven't been bowled; bowled weeks keep theirs.
function regenSchedule(l) {
  const fresh = LG.generateSchedule(l);
  l.schedule = fresh.map(w => (LG.weekHasScores(l, w.week) ? (l.schedule.find(k => k.week === w.week) || w) : w));
}

/* ---------- entry point ---------- */
RENDER.league = function (p) {
  p = p || {};
  if (p.list) lv.id = null;
  if (p.id) { if (p.id !== lv.id) lv.week = null; lv.id = p.id; }
  if (p.tab) lv.tab = p.tab;
  if (p.week) lv.week = p.week;
  const l = lv.id && Store.getLeague(lv.id);
  if (!l) { lv.id = null; return renderList(); }
  if (!lv.week) lv.week = LG.currentWeek(l);
  lv.week = Math.max(1, Math.min(l.seasonWeeks, lv.week));
  renderLeague(l);
};

/* ---------- list ---------- */
function renderList() {
  const el = $('#screen-league');
  const ls = Store.state.leagues;
  let h = '<h2 class="screen-title">Leagues</h2>';
  if (!ls.length) {
    h += '<div class="card intro"><div class="intro-ic">🏆</div><h3>Run your league here</h3>' +
      '<p class="small muted">Rosters, weekly scores, handicaps and standings are figured automatically, and a recap is ready to email to the league in one tap.</p>' +
      '<button class="btn" id="lgCreate">Create a league</button><button class="btn secondary mt8" id="lgDemo">Try it with a demo league</button></div>';
  } else {
    h += ls.map(l => {
      const last = LG.lastScoredWeek(l);
      const me = l.bowlers.find(b => b.isMe);
      return '<button class="list-item nav-item league-row" data-lg="' + l.id + '"><span class="ic">🏆</span><div class="grow"><div class="t">' + esc(l.name) + '</div>' +
        '<div class="s">' + esc([Store.centerName(l.centerId) === '—' ? '' : Store.centerName(l.centerId), l.day + 's ' + l.time].filter(Boolean).join(' · ')) + '</div>' +
        '<div class="s">' + plural(l.teams.length, 'team') + ' · ' + (last ? 'week ' + last + ' of ' + l.seasonWeeks + ' bowled' : 'season not started') + (me ? ' · you: ' + esc(me.name) : '') + '</div></div><span class="chev">›</span></button>';
    }).join('');
    h += '<button class="btn mt8" id="lgCreate">+ Create a league</button>';
    if (!ls.some(l => /\(demo\)/.test(l.name))) h += '<button class="btn secondary mt8" id="lgDemo">Load a demo league</button>';
  }
  el.innerHTML = h;
  el.querySelectorAll('[data-lg]').forEach(b => b.addEventListener('click', () => show('league', { id: b.dataset.lg })));
  on('lgCreate', 'click', createSheet);
  on('lgDemo', 'click', () => {
    const l = LG.buildDemoLeague({ today: BB.todayISO(), centerId: (Store.state.centers[0] || {}).id || '' });
    l.sample = true;
    l.askedMe = true; // fictional roster, so don't ask which bowler you are
    Store.addLeague(l);
    toast('Demo league loaded — 6 teams, 4 weeks bowled');
    show('league', { id: l.id, tab: 'standings', week: LG.lastScoredWeek(l) });
  });
}

function leagueFormHTML(l, full) {
  const dayOpts = LG.DAYS.map(d => '<option' + (d === l.day ? ' selected' : '') + '>' + d + '</option>').join('');
  let h = '<label class="field">League name<input type="text" id="lfName" value="' + esc(l.name === 'New league' ? '' : l.name) + '" placeholder="e.g. Tuesday Night Mixed"></label>' +
    '<label class="field">Bowling center<select id="lfCenter"><option value="">—</option>' + BB.centerOptions(l.centerId) + '</select></label>' +
    '<div class="grid2"><label class="field">Night<select id="lfDay">' + dayOpts + '</select></label>' +
    '<label class="field">Start time<input type="text" id="lfTime" value="' + esc(l.time) + '"></label></div>' +
    '<div class="grid2"><label class="field">First week<input type="date" id="lfStart" value="' + esc(l.startDate) + '"></label>' +
    '<label class="field">Weeks in season<input type="number" inputmode="numeric" id="lfWeeks" min="1" max="52" value="' + l.seasonWeeks + '"></label></div>' +
    '<div class="grid2"><label class="field">Bowlers per team<input type="number" inputmode="numeric" id="lfSize" min="1" max="8" value="' + l.teamSize + '"></label>' +
    '<label class="field">Games per night<input type="number" inputmode="numeric" id="lfGames" min="1" max="5" value="' + l.gamesPerNight + '"></label></div>' +
    '<fieldset class="fs"><legend>Handicap</legend><label class="check"><input type="checkbox" id="lfHcp"' + (l.handicap.enabled ? ' checked' : '') + '> Handicap league</label>' +
    '<div class="grid2"><label class="field">Percent<input type="number" inputmode="numeric" id="lfPct" min="0" max="100" value="' + l.handicap.pct + '"></label>' +
    '<label class="field">of basis<input type="number" inputmode="numeric" id="lfBasis" min="0" max="300" value="' + l.handicap.basis + '"></label></div>' +
    '<label class="field">Fractions of a pin<select id="lfRound">' + Object.keys(LG.ROUNDING_LABEL).map(k => '<option value="' + k + '"' + ((l.handicap.rounding || 'floor') === k ? ' selected' : '') + '>' + LG.ROUNDING_LABEL[k] + '</option>').join('') + '</select></label>' +
    '<div class="small muted">e.g. 90% of 220: a 185 bowler gets (220 − 185) × 0.9 = 31.5, which is 31 if you drop the fraction or 32 if you round .5 up. Check your league rules.</div></fieldset>' +
    '<fieldset class="fs"><legend>Points</legend><div class="grid2"><label class="field">Per game won<input type="number" inputmode="decimal" id="lfPg" min="0" step="0.5" value="' + l.points.perGame + '"></label>' +
    '<label class="field">For total pins<input type="number" inputmode="decimal" id="lfPs" min="0" step="0.5" value="' + l.points.perSeries + '"></label></div>' +
    '<label class="field">Team on a bye gets<select id="lfBye">' + [['none', 'No points'], ['half', 'Half the night\u2019s points'], ['full', 'All the night\u2019s points']].map(o => '<option value="' + o[0] + '"' + ((l.byePoints || 'none') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>' +
    '<div class="small muted">Only matters with an odd number of teams.</div></fieldset>';
  if (full) {
    h += '<fieldset class="fs"><legend>Rules</legend><div class="grid2">' +
      '<label class="field">Absent score = avg minus<input type="number" inputmode="numeric" id="lfAbsent" min="0" max="100" value="' + l.absent.pinsBelowAvg + '"></label>' +
      '<label class="field">Vacancy score<input type="number" inputmode="numeric" id="lfVacant" min="0" max="300" value="' + l.vacancy.score + '"></label>' +
      '<label class="field">Use entering avg until (games)<input type="number" inputmode="numeric" id="lfEst" min="1" max="30" value="' + l.establishGames + '"></label>' +
      '<label class="field">Avg for new bowlers<input type="number" inputmode="numeric" id="lfDefAvg" min="0" max="300" value="' + l.defaultAvg + '"></label></div></fieldset>' +
      '<fieldset class="fs"><legend>Recap email</legend><label class="field">Extra recipients (league officers, center, etc.)<input type="text" id="lfCc" value="' + esc(l.ccEmails) + '" placeholder="secretary@example.com, desk@lanes.com"></label>' +
      '<div class="small muted">Bowlers with an email on the roster get the recap automatically.</div></fieldset>';
  }
  return h;
}
function readLeagueForm(l, full) {
  const name = val('lfName').trim();
  if (!name) return 'Give the league a name';
  const weeks = intOr(val('lfWeeks'), l.seasonWeeks);
  if (weeks < 1 || weeks > 52) return 'Season must be 1–52 weeks';
  const lastBowled = LG.lastScoredWeek(l);
  if (weeks < lastBowled) return 'Week ' + lastBowled + ' already has scores — season can’t be shorter';
  Object.assign(l, {
    name, centerId: val('lfCenter'), day: val('lfDay'), time: val('lfTime').trim(), startDate: val('lfStart'), seasonWeeks: weeks,
    teamSize: Math.max(1, Math.min(8, intOr(val('lfSize'), l.teamSize))),
    gamesPerNight: Math.max(1, Math.min(5, intOr(val('lfGames'), l.gamesPerNight))),
    handicap: { enabled: el('lfHcp').checked, pct: Math.max(0, Math.min(100, intOr(val('lfPct'), 90))), basis: Math.max(0, Math.min(300, intOr(val('lfBasis'), 220))), rounding: val('lfRound') || 'floor' },
    byePoints: val('lfBye') || 'none',
    points: { perGame: Math.max(0, parseFloat(val('lfPg')) || 0), perSeries: Math.max(0, parseFloat(val('lfPs')) || 0) },
  });
  if (full) {
    l.absent = { pinsBelowAvg: Math.max(0, intOr(val('lfAbsent'), 10)) };
    l.vacancy = { score: Math.max(0, Math.min(300, intOr(val('lfVacant'), 120))) };
    l.establishGames = Math.max(1, intOr(val('lfEst'), 3));
    l.defaultAvg = Math.max(0, Math.min(300, intOr(val('lfDefAvg'), 150)));
    l.ccEmails = val('lfCc').trim();
  }
  return null;
}
function createSheet() {
  const l = LG.createLeague({ startDate: BB.todayISO(), centerId: (Store.state.centers[0] || {}).id || '' });
  openSheet('<h3>New league</h3>' + leagueFormHTML(l, false) + '<button class="btn" id="lfCreate">Create league</button>', sh => {
    sh.querySelector('#lfCreate').addEventListener('click', () => {
      const err = readLeagueForm(l, false);
      if (err) { toast(err); return; }
      l.day = l.startDate ? LG.DAYS[new Date(l.startDate + 'T12:00:00').getDay()] : l.day;
      Store.addLeague(l);
      closeSheet();
      toast('League created — now add teams and bowlers');
      show('league', { id: l.id, tab: 'bowlers' });
    });
  });
}

/* ---------- league shell ---------- */
function renderLeague(l) {
  const el = $('#screen-league');
  const last = LG.lastScoredWeek(l);
  let h = BB.backLink('league', 'Leagues', { list: true });
  h += '<div class="league-head"><h2 class="screen-title">' + esc(l.name) + '</h2><div class="small muted">' +
    esc([Store.centerName(l.centerId) === '—' ? '' : Store.centerName(l.centerId), l.day + 's ' + l.time, plural(l.teams.length, 'team'), last ? 'week ' + last + ' of ' + l.seasonWeeks + ' bowled' : 'season not started'].filter(Boolean).join(' · ')) + '</div></div>';
  h += '<div class="seg" role="tablist">' + TABS.map(t => '<button role="tab" aria-selected="' + (lv.tab === t[0]) + '" class="' + (lv.tab === t[0] ? 'on' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>';
  h += '<div id="lgBody"></div>';
  el.innerHTML = h;
  el.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { lv.tab = b.dataset.tab; renderLeague(l); }));
  const body = el.querySelector('#lgBody');
  ({ scores: tabScores, standings: tabStandings, recap: tabRecap, bowlers: tabBowlers, schedule: tabSchedule, settings: tabSettings }[lv.tab] || tabScores)(l, body);
  if (!l.askedMe && !LG.me(l) && l.bowlers.length >= 2) setTimeout(() => askMe(l), 50);
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
  on('goBowlers', 'click', () => { lv.tab = 'bowlers'; renderLeague(l); });
  return true;
}

/* ---------- scores ---------- */
function matchupStatus(l, week, m) {
  const r = LG.matchupResult(l, week, m);
  if (!r.A.entered && !r.B.entered) return { cls: 'todo', text: 'Not entered', r };
  if (!(r.A.complete && r.B.complete)) return { cls: 'part', text: 'In progress', r };
  return { cls: 'done', text: LG.fmtPts(r.ptsA) + '–' + LG.fmtPts(r.ptsB) + ' pts', r };
}
function tabScores(l, body) {
  if (needTeams(l, body)) return;
  const w = lv.week;
  const sch = LG.weekSchedule(l, w);
  let h = weekPicker(l);
  if (!sch.matchups.length) {
    h += '<div class="empty">No matchups scheduled this week.<br><button class="btn small-btn mt8" id="mkSched">Build schedule</button></div>';
    body.innerHTML = h; bindWeekPicker(l);
    on('mkSched', 'click', () => { regenSchedule(l); save(); renderLeague(l); });
    return;
  }
  h += sch.matchups.map((m, i) => {
    const st = matchupStatus(l, w, m);
    const winA = st.cls === 'done' && st.r.ptsA > st.r.ptsB, winB = st.cls === 'done' && st.r.ptsB > st.r.ptsA;
    return '<button class="matchup-card" data-mi="' + i + '"><div class="lanes">Lanes<b>' + esc(m.lanes) + '</b></div>' +
      '<div class="teams"><span class="' + (winA ? 'win' : '') + '">' + esc(LG.teamName(l, m.a)) + '</span><i>vs</i><span class="' + (winB ? 'win' : '') + '">' + esc(LG.teamName(l, m.b)) + '</span></div>' +
      '<span class="pill ' + st.cls + '">' + st.text + '</span></button>';
  }).join('');
  if (sch.bye) h += '<div class="small muted center mt8">Bye: ' + esc(LG.teamName(l, sch.bye) + LG.byeNote(l)) + '</div>';
  const any = LG.weekHasScores(l, w);
  if (any) {
    h += '<div class="row mt12"><button class="btn grow" id="toRecap">Week ' + w + ' recap →</button><button class="btn secondary small-btn" id="wkCsv">CSV</button></div>';
  } else {
    h += '<p class="small muted center">Tap a matchup to enter scores. Handicaps and points are figured as you type.</p>';
  }
  h += '<button class="link-btn import-link" id="impScores">Starting mid-season? Import weeks already bowled</button>';
  body.innerHTML = h;
  on('impScores', 'click', () => importScoresSheet(l));
  bindWeekPicker(l);
  body.querySelectorAll('[data-mi]').forEach(b => b.addEventListener('click', () => show('matchup', { id: l.id, week: w, mi: +b.dataset.mi })));
  on('toRecap', 'click', () => { lv.tab = 'recap'; renderLeague(l); });
  on('wkCsv', 'click', () => download(slug(l.name) + '-week-' + w + '-scores.csv', LG.weekScoresCSV(l, w), 'text/csv'));
}
// Bring in weeks that were bowled before the league moved to BowlBoard.
function importScoresSheet(l) {
  const G = l.gamesPerNight;
  const head = ['Week', 'Team', 'Bowler'].concat(Array.from({ length: G }, (_, i) => 'Game ' + (i + 1))).concat(['Status']);
  const template = () => {
    const rows = [head];
    // every week whose date has already passed (at least week 1)
    const today = BB.todayISO();
    let upTo = LG.lastScoredWeek(l);
    for (let w = 1; w <= l.seasonWeeks; w++) { const d = LG.weekDate(l, w); if (d && d < today) upTo = Math.max(upTo, w); }
    for (let w = 1; w <= Math.max(1, upTo); w++) {
      l.teams.forEach(t => LG.roster(l, t.id).forEach(b => rows.push([w, t.name, b.name].concat(new Array(G).fill('')).concat(['']))));
    }
    return LG.toCSV(rows);
  };
  openSheet('<h3>Import weeks already bowled</h3>' +
    '<p class="small muted mt0">Paste from your spreadsheet or upload a CSV with columns <b>' + esc(head.slice(0, 4).join(', ')) + '…</b> and an optional <b>Status</b> (absent / vacant). Each team in the file replaces that team\u2019s scores for that week. Bowlers not on the roster are added to their team.</p>' +
    '<button class="btn secondary small-btn" id="isTpl">Get a template with your roster</button>' +
    '<textarea id="isText" rows="8" class="mt8" placeholder="' + esc(head.join(',')) + '&#10;1,Pin Pals,Dana Ortiz,172,188,165,&#10;1,Pin Pals,Mike Kowalski,,,,absent"></textarea>' +
    '<label class="btn secondary mt8" for="isFile">Choose CSV file…</label><input type="file" id="isFile" accept=".csv,text/csv,text/plain" hidden>' +
    '<div class="import-preview" id="isPreview" aria-live="polite"></div><button class="btn" id="isGo" disabled>Import</button>', sh => {
    const ta = sh.querySelector('#isText');
    let parsed = null;
    const preview = () => {
      const box = sh.querySelector('#isPreview'), btn = sh.querySelector('#isGo');
      if (!ta.value.trim()) { box.innerHTML = ''; btn.disabled = true; return; }
      parsed = LG.scoresFromCSV(l, ta.value);
      if (!parsed.ok) { box.innerHTML = '<div class="warn small">' + esc(parsed.error) + '</div>'; btn.disabled = true; return; }
      const wk = parsed.weekList;
      const overwrite = wk.filter(w => LG.weekHasScores(l, w));
      box.innerHTML = '<div class="small"><b>' + plural(parsed.count, 'bowler line') + '</b> for week' + (wk.length > 1 ? 's ' + wk[0] + '–' + wk[wk.length - 1] : ' ' + wk[0]) + '.</div>' +
        (parsed.newBowlers.length ? '<div class="small">New to the roster: ' + esc(parsed.newBowlers.map(b => b.name + ' (' + b.team + ')').join(', ')) + '</div>' : '') +
        (overwrite.length ? '<div class="small warn">Week ' + overwrite.join(', ') + ' already has scores; teams in the file replace theirs.</div>' : '') +
        (parsed.errors.length ? '<div class="small warn">' + plural(parsed.errors.length, 'row') + ' skipped:<br>' + parsed.errors.slice(0, 5).map(esc).join('<br>') + (parsed.errors.length > 5 ? '<br>…' : '') + '</div>' : '');
      btn.disabled = false;
      btn.textContent = 'Import ' + plural(wk.length, 'week');
    };
    ta.addEventListener('input', preview);
    sh.querySelector('#isFile').addEventListener('change', async e => { const f = e.target.files[0]; if (f) { ta.value = await f.text(); preview(); } });
    sh.querySelector('#isTpl').addEventListener('click', () => {
      const csv = template();
      if (BB.EMBED) { ta.value = csv; preview(); toast('Template filled in — add scores, or copy it into a spreadsheet'); }
      else download(slug(l.name) + '-scores-template.csv', csv, 'text/csv');
    });
    sh.querySelector('#isGo').addEventListener('click', () => {
      if (!parsed || !parsed.ok) return;
      const r = LG.applyScores(l, parsed);
      Store.syncLinks();
      save(); closeSheet();
      lv.week = LG.currentWeek(l);
      renderLeague(l);
      toast('Imported ' + plural(r.weeks, 'week') + (r.added ? ' · ' + plural(r.added, 'new bowler') : ''), 3500);
    });
  });
}
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'league';

/* ---------- matchup score entry ---------- */
function ensureWeek(l, w) {
  if (!l.results[w]) l.results[w] = { lines: [], final: false };
  return l.results[w];
}
function ensureTeamLines(l, w, teamId) {
  const r = ensureWeek(l, w);
  if (!r.lines.some(x => x.teamId === teamId)) LG.defaultLines(l, teamId).forEach(x => r.lines.push(x));
  return r.lines.filter(x => x.teamId === teamId);
}
// Typing scores: batch the writes (flushed when you leave the screen or the app goes to the background).
function touch(l, w) { ensureWeek(l, w).updatedAt = new Date().toISOString(); Store.saveSoon(); }

RENDER.matchup = function (p) {
  const l = Store.getLeague(p.id);
  const el = $('#screen-matchup');
  if (!l) { show('league', { list: true }); return; }
  const w = p.week;
  const m = LG.weekSchedule(l, w).matchups[p.mi];
  if (!m) { show('league', { id: l.id, tab: 'scores' }); return; }
  lv.id = l.id; lv.week = w; lv.tab = 'scores';
  let h = BB.backLink('league', 'Week ' + w + ' scores', { id: l.id, tab: 'scores', week: w });
  h += '<h2 class="screen-title">' + esc(LG.teamName(l, m.a)) + ' <span class="muted">vs</span> ' + esc(LG.teamName(l, m.b)) + '</h2>';
  h += '<div class="small muted mb8">Week ' + w + ' · ' + esc(fmtD(LG.weekDate(l, w))) + ' · lanes ' + esc(m.lanes) +
    (l.handicap.enabled ? ' · ' + l.handicap.pct + '% of ' + l.handicap.basis : ' · scratch') + '</div>';
  h += '<div id="muScore"></div>';
  [m.a, m.b].forEach(tid => { h += '<div class="card team-card" data-team="' + tid + '"></div>'; });
  h += '<button class="btn" data-back="league" data-back-params=\'' + esc(JSON.stringify({ id: l.id, tab: 'scores', week: w })) + '\'>Done</button>';
  h += '<p class="small muted center">Scores save as you type.</p>';
  el.innerHTML = h;
  [m.a, m.b].forEach(tid => {
    const card = el.querySelector('[data-team="' + tid + '"]');
    card.innerHTML = teamCardHTML(l, w, tid);
    bindTeam(l, w, tid, m, el, card);
  });
  updateMatchupTotals(l, w, m, el);
};

function lineOptions(l, teamId, current, usedIds) {
  const rosterB = LG.roster(l, teamId), subB = LG.subs(l);
  const opt = (b, label) => '<option value="' + b.id + '"' + (b.id === current ? ' selected' : '') + (usedIds.has(b.id) && b.id !== current ? ' disabled' : '') + '>' + esc(label || b.name) + '</option>';
  let h = '<optgroup label="' + esc(LG.teamName(l, teamId)) + '">' + rosterB.map(b => opt(b)).join('') + '</optgroup>';
  // bowlers from elsewhere already chosen here (e.g. inactive) stay visible
  const cur = LG.bowler(l, current);
  if (cur && !rosterB.includes(cur) && !subB.includes(cur)) h += opt(cur);
  if (subB.length) h += '<optgroup label="Subs">' + subB.map(b => opt(b, b.name + ' (sub)')).join('') + '</optgroup>';
  h += '<option value="' + LG.VACANT + '"' + (current === LG.VACANT ? ' selected' : '') + '>Vacant</option>';
  h += '<option value="__newsub">+ New sub…</option>';
  return h;
}

function teamCardHTML(l, w, tid) {
  const lines = LG.teamLines(l, w, tid) || LG.defaultLines(l, tid);
  const used = new Set(lines.map(x => x.bowlerId));
  const G = l.gamesPerNight;
  let h = '<div class="team-head"><h3>' + esc(LG.teamName(l, tid)) + '</h3><span class="pts" data-pts="' + tid + '"></span></div>';
  lines.forEach((line, li) => {
    const s = LG.scoreLine(l, w, line);
    const me = LG.bowler(l, line.bowlerId);
    const mine = me && me.isMe && !(line.links || []).some(Boolean) ? myLoggedGames(l, w) : null;
    h += '<div class="line' + (line.absent ? ' absent' : '') + (s.vacant ? ' vacant' : '') + '">' +
      '<div class="line-top"><select data-li="' + li + '" data-f="bowler" aria-label="Bowler">' + lineOptions(l, tid, line.bowlerId, used) + '</select>' +
      (s.vacant ? '' : '<button class="abs-btn' + (line.absent ? ' on' : '') + '" data-li="' + li + '" data-f="absent" aria-pressed="' + !!line.absent + '">Absent</button>') + '</div>' +
      '<div class="line-meta">' + (s.vacant ? 'Vacancy scores ' + l.vacancy.score + ' a game' : 'avg ' + s.avg + (s.avgSource === 'entering' ? ' (entering)' : s.avgSource === 'default' ? ' (new)' : '') + (l.handicap.enabled ? ' · hcp ' + s.hcp : '') + (line.absent ? ' · scores ' + s.games[0] + ' (avg − ' + l.absent.pinsBelowAvg + ')' : '')) + '</div>';
    if (!s.vacant && !line.absent) {
      h += '<div class="game-inputs">';
      for (let gi = 0; gi < G; gi++) {
        const v = (line.games || [])[gi];
        const linked = line.links && line.links[gi];
        h += '<input type="number" inputmode="numeric" min="0" max="300" placeholder="G' + (gi + 1) + '" aria-label="' + esc(s.name) + ' game ' + (gi + 1) + (linked ? ' (from their own log)' : '') + '"' +
          (linked ? ' class="linked" title="From ' + esc(s.name) + '\u2019s own log. Typing here replaces it and unlinks it."' : '') + ' data-li="' + li + '" data-gi="' + gi + '" value="' + (v == null ? '' : v) + '">';
      }
      h += '<div class="ser" data-ser="' + tid + '-' + li + '">' + serText(s) + '</div></div>';
      if ((line.links || []).some(Boolean)) h += '<div class="link-note">🔗 Linked to ' + esc(s.name) + '\u2019s own log</div>';
      else if (mine && mine.length) h += '<button class="link-btn" data-li="' + li + '" data-f="mine">Use my logged games and link them (' + mine.slice(0, G).map(g => g.total).join(' · ') + ')</button>';
    }
    h += '</div>';
  });
  h += '<table class="totals" data-totals="' + tid + '"></table>';
  return h;
}
const serText = s => (s.games.some(g => g != null) ? '<b>' + s.series + '</b>' + (s.hcp ? '<small>' + s.hcpSeries + ' w/ hcp</small>' : '') : '');

// Games you logged yourself on this league night (tagged to this league, else same date).
function myLoggedGames(l, w) {
  const date = LG.weekDate(l, w);
  if (!date) return [];
  const same = Store.state.games.filter(g => g.date === date && g.total != null);
  const tagged = same.filter(g => g.leagueId === l.id);
  return (tagged.length ? tagged : same).sort((a, b) => (a.gameNo || 1) - (b.gameNo || 1));
}

// One set of delegated listeners per team card; the card's contents can redraw freely.
function bindTeam(l, w, tid, m, el, card) {
  const redraw = () => { card.innerHTML = teamCardHTML(l, w, tid); updateMatchupTotals(l, w, m, el); };
  card.addEventListener('input', e => {
    const inp = e.target.closest('input[data-gi]');
    if (!inp) return;
    const lines = ensureTeamLines(l, w, tid);
    const line = lines[+inp.dataset.li];
    const gi = +inp.dataset.gi;
    const n = inp.value === '' ? null : parseInt(inp.value, 10);
    const ok = n === null || LG.validScore(n);
    inp.classList.toggle('bad', !ok);
    line.games = line.games || [];
    line.games[gi] = ok ? n : null;
    if (LG.unlinkGame(line, gi)) {
      inp.classList.remove('linked');
      toast('Unlinked from ' + LG.bowlerName(l, line.bowlerId) + '\u2019s own log — this score now stands.', 3500);
    }
    touch(l, w);
    const ser = card.querySelector('[data-ser="' + tid + '-' + inp.dataset.li + '"]');
    if (ser) ser.innerHTML = serText(LG.scoreLine(l, w, line));
    updateMatchupTotals(l, w, m, el);
    if (ok && inp.value.length === 3) { // three digits typed -> jump to the next box
      const all = Array.from(el.querySelectorAll('input[data-gi]'));
      const nx = all[all.indexOf(inp) + 1];
      if (nx) nx.focus();
    }
  });
  card.addEventListener('change', e => {
    const sel = e.target.closest('select[data-f="bowler"]');
    if (!sel) return;
    const line = ensureTeamLines(l, w, tid)[+sel.dataset.li];
    if (sel.value === '__newsub') {
      newSubSheet(l, b => { line.bowlerId = b.id; line.absent = false; line.links = []; touch(l, w); redraw(); }, redraw);
      return;
    }
    line.bowlerId = sel.value;
    line.absent = false;
    line.links = [];
    touch(l, w); redraw();
  });
  card.addEventListener('click', e => {
    const b = e.target.closest('[data-f]');
    if (!b || b.tagName === 'SELECT') return;
    const line = ensureTeamLines(l, w, tid)[+b.dataset.li];
    if (b.dataset.f === 'absent') {
      line.absent = !line.absent;
      touch(l, w); redraw();
    } else if (b.dataset.f === 'mine') {
      const games = myLoggedGames(l, w).slice(0, l.gamesPerNight);
      line.games = Array.from({ length: l.gamesPerNight }, (_, i) => (games[i] ? games[i].total : null));
      line.links = Array.from({ length: l.gamesPerNight }, (_, i) => (games[i] ? games[i].id : null));
      touch(l, w); redraw(); toast('Filled from your log and linked');
    }
  });
}

function updateMatchupTotals(l, w, m, el) {
  const r = LG.matchupResult(l, w, m);
  const G = l.gamesPerNight;
  const useH = l.handicap.enabled;
  [[m.a, r.A, 'a', r.ptsA], [m.b, r.B, 'b', r.ptsB]].forEach(([tid, T, side, pts]) => {
    const tbl = el.querySelector('[data-totals="' + tid + '"]');
    if (!tbl) return;
    const T2 = T.entered ? T : LG.teamWeek(Object.assign({}, l, { results: Object.assign({}, l.results, { [w]: { lines: LG.defaultLines(l, tid) } }) }), w, tid);
    const cell = (v, i) => '<td class="' + (i != null && r.games[i] && r.games[i].winner === side ? 'won' : '') + '">' + (v == null ? '–' : v) + '</td>';
    let h = '<tr><th></th>' + Array.from({ length: G }, (_, i) => '<th>G' + (i + 1) + '</th>').join('') + '<th>Total</th></tr>';
    h += '<tr><td>Scratch</td>' + T2.scratch.map(v => cell(v)).join('') + cell(T2.scratch.every(x => x != null) ? T2.series : null) + '</tr>';
    if (useH) {
      h += '<tr><td>Hcp</td>' + T2.hcp.map(v => cell(v)).join('') + cell(T2.hcp.every(x => x != null) ? T2.hcp.reduce((a, b) => a + b, 0) : null) + '</tr>';
      h += '<tr class="tot"><td>Total</td>' + T2.total.map((v, i) => cell(v, i)).join('') + '<td class="' + (r.decided && ((side === 'a' && r.seriesA > r.seriesB) || (side === 'b' && r.seriesB > r.seriesA)) ? 'won' : '') + '">' + (T2.complete ? T2.hcpSeries : '–') + '</td></tr>';
    }
    tbl.innerHTML = h;
    const p = el.querySelector('[data-pts="' + tid + '"]');
    if (p) p.textContent = (r.games.some(g => g.winner) ? LG.fmtPts(pts) + ' pts' : '');
  });
  const sc = el.querySelector('#muScore');
  if (sc) {
    const known = r.games.some(g => g.winner);
    sc.innerHTML = known ? '<div class="mu-score"><span>' + esc(LG.teamName(l, m.a)) + '</span><b>' + LG.fmtPts(r.ptsA) + ' – ' + LG.fmtPts(r.ptsB) + '</b><span>' + esc(LG.teamName(l, m.b)) + '</span></div>' : '';
  }
}

function newSubSheet(l, onDone, onCancel) {
  let done = false;
  openSheet('<h3>Add a sub</h3><label class="field">Name<input type="text" id="nsName"></label>' +
    '<label class="field">Average (if known)<input type="number" inputmode="numeric" id="nsAvg" min="0" max="300" placeholder="' + l.defaultAvg + '"></label>' +
    '<label class="field">Email (optional)<input type="email" id="nsEmail"></label><button class="btn" id="nsSave">Add sub</button>', sh => {
    sh.querySelector('#nsSave').addEventListener('click', () => {
      const name = val('nsName').trim();
      if (!name) { toast('Enter a name'); return; }
      const b = { id: LG.uid(), name, email: val('nsEmail').trim(), enteringAvg: intOr(val('nsAvg'), null), teamId: '', isMe: false, active: true };
      l.bowlers.push(b); save(); done = true; closeSheet(); onDone(b);
    });
  }, () => { if (!done && onCancel) onCancel(); }); // closing without saving puts the select back
}

/* ---------- standings ---------- */
function tabStandings(l, body) {
  if (needTeams(l, body)) return;
  const lastW = LG.lastScoredWeek(l);
  if (lastW && lv.week > lastW) lv.week = lastW; // nothing to show past the last bowled week
  const w = lv.week;
  const st = LG.standings(l, w);
  const avgs = LG.bowlerStats(l, w).filter(b => b.games > 0 || b.teamId);
  const useH = l.handicap.enabled;
  let h = weekPicker(l, 'Through week');
  if (!LG.lastScoredWeek(l)) h += '<p class="small muted center">No scores yet — standings fill in once week 1 is entered.</p>';
  h += '<div class="card"><h3>Team standings</h3><div class="table-wrap"><table class="data"><tr><th>#</th><th class="l">Team</th><th title="Points won">Pts W</th><th title="Points lost">Pts L</th><th>' + (useH ? 'Hcp pins' : 'Pins') + '</th><th>HG</th><th>HS</th></tr>' +
    st.map(s => '<tr><td class="muted">' + s.place + '</td><td class="l"><b>' + esc(s.name) + '</b></td><td><b>' + LG.fmtPts(s.won) + '</b></td><td>' + LG.fmtPts(s.lost) + '</td><td>' + (useH ? s.hcpPins : s.scratch) + '</td><td>' + (s.highGame || '–') + '</td><td>' + (s.highSeries || '–') + '</td></tr>').join('') +
    '</table></div><div class="small muted">Pts W / Pts L are points, not games: ' + esc(LG.pointsLine(l)) + '. HG / HS = team high game / series' + (useH ? ' with handicap' : '') + '.</div></div>';
  h += '<div class="card"><h3>Bowler averages</h3><div class="table-wrap"><table class="data"><tr><th class="l">Bowler</th><th>Gms</th><th>Avg</th><th>HG</th><th>HS</th>' + (useH ? '<th>Hcp</th>' : '') + '</tr>' +
    avgs.map(b => '<tr class="' + (b.isMe ? 'me' : '') + '"><td class="l">' + esc(b.name) + (b.isMe ? ' <span class="badge">you</span>' : '') + '<small>' + esc(b.team) + '</small></td><td>' + b.games + '</td><td><b>' + (b.avg == null ? '<span class="muted" title="Average used for handicap">' + b.currentAvg + '*</span>' : b.avg) + '</b></td><td>' + (b.highGame == null ? '–' : b.highGame) + '</td><td>' + (b.highSeries == null ? '–' : b.highSeries) + '</td>' + (useH ? '<td>' + b.hcp + '</td>' : '') + '</tr>').join('') +
    '</table></div><div class="small muted">Averages are truncated (189.9 → 189).' + (useH ? ' Hcp is what each bowler gets next week.' : '') + ' * = entering average, no league games yet.</div></div>';
  h += '<div class="row"><button class="btn secondary grow" id="stCsv">Standings CSV</button><button class="btn secondary grow" id="avCsv">Averages CSV</button></div>';
  body.innerHTML = h;
  bindWeekPicker(l);
  on('stCsv', 'click', () => download(slug(l.name) + '-standings-week-' + w + '.csv', LG.standingsCSV(l, w), 'text/csv'));
  on('avCsv', 'click', () => download(slug(l.name) + '-averages-week-' + w + '.csv', LG.averagesCSV(l, w), 'text/csv'));
}

/* ---------- recap ---------- */
function recapDoc(l, w) {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(LG.recapSubject(l, w)) + '</title>' +
    '<style>body{margin:0;background:#f8fafc}@media print{body{background:#fff}}</style></head><body>' + LG.recapHTML(l, w, centerLabel(l)) + '</body></html>';
}
const centerLabel = l => (Store.centerName(l.centerId) === '—' ? '' : Store.centerName(l.centerId));

function tabRecap(l, body) {
  if (needTeams(l, body)) return;
  const w = lv.week;
  let h = weekPicker(l);
  if (!LG.weekHasScores(l, w)) {
    const last = LG.lastScoredWeek(l);
    h += '<div class="empty">No scores for week ' + w + ' yet.' + (last ? '<br><button class="btn small-btn mt8" id="lastRecap">Show week ' + last + ' recap</button>' : '') + '</div>';
    body.innerHTML = h; bindWeekPicker(l);
    on('lastRecap', 'click', () => { lv.week = last; renderLeague(l); });
    return;
  }
  const rec = LG.recipients(l);
  const text = LG.recapText(l, w, centerLabel(l));
  const partial = LG.weekSchedule(l, w).matchups.some(m => { const st = matchupStatus(l, w, m); return st.cls !== 'done'; });
  if (partial) h += '<div class="notice">Some matchups aren’t finished — the recap shows what’s entered so far.</div>';
  h += '<div class="card share-card"><h3>Send it to the league</h3>' +
    '<div class="small muted mb8">' + (rec.length ? plural(rec.length, 'recipient') + ' from the roster' + (l.ccEmails ? ' + extra list' : '') : 'No emails on the roster yet — add them under Bowlers, or copy and paste into your own email.') + '</div>' +
    '<button class="btn" id="rcEmail">✉️ Email recap' + (rec.length ? ' to ' + rec.length : '') + '</button>' +
    '<div class="share-grid"><button class="btn secondary" id="rcCopy">Copy for email</button><button class="btn secondary" id="rcText">Copy as text</button>' +
    (rec.length ? '<button class="btn secondary" id="rcAddr">Copy addresses</button>' : '') +
    (!EMBED && navigator.share ? '<button class="btn secondary" id="rcShare">Share…</button>' : '') +
    (EMBED ? '' : '<button class="btn secondary" id="rcPrint">Print / PDF</button><button class="btn secondary" id="rcDl">Download</button>') + '</div>' +
    (rec.length ? '<details class="addr"><summary>Show addresses</summary><div class="addr-list">' + rec.map(esc).join(', ') + '</div></details>' : '') +
    '<div class="small muted mt8"><b>Copy for email</b> keeps the tables — paste into Gmail or Outlook. <b>Email recap</b> opens your mail app with a plain-text version' + (EMBED ? ' (if it doesn\u2019t open here, use Copy addresses + Copy for email)' : '') + '.</div></div>';
  h += '<div class="recap-preview" id="rcPreview">' + LG.recapHTML(l, w, centerLabel(l)) + '</div>';
  body.innerHTML = h;
  bindWeekPicker(l);

  on('rcEmail', 'click', () => {
    const subject = LG.recapSubject(l, w);
    let bodyText = text;
    const base = 'mailto:?' + (rec.length ? 'bcc=' + encodeURIComponent(rec.join(',')) + '&' : '') + 'subject=' + encodeURIComponent(subject) + '&body=';
    if ((base + encodeURIComponent(bodyText)).length > 7500) {
      bodyText = text.split('\nAVERAGES')[0] + '\n\n(Full averages attached separately — see the league page.)\n\nSent with BowlBoard';
      toast('Recap is long — averages left out of the email body. Use Copy for email for the full version.', 4500);
    }
    window.location.href = base + encodeURIComponent(bodyText);
  });
  on('rcCopy', 'click', async () => { const ok = await copyRich(LG.recapHTML(l, w, centerLabel(l)), text); toast(ok ? 'Copied — paste into your email' : 'Copy failed — try Download instead'); });
  on('rcText', 'click', async () => { toast((await copyText(text)) ? 'Text copied' : 'Copy failed'); });
  on('rcAddr', 'click', async () => { toast((await copyText(rec.join(', '))) ? plural(rec.length, 'address') + ' copied' : 'Copy failed — open Show addresses and select them'); });
  on('rcShare', 'click', async () => { try { await navigator.share({ title: LG.recapSubject(l, w), text }); } catch (e) { /* cancelled */ } });
  on('rcDl', 'click', () => download(slug(l.name) + '-week-' + w + '-recap.html', recapDoc(l, w), 'text/html'));
  on('rcPrint', 'click', () => {
    const win = window.open('', '_blank');
    if (!win) { toast('Allow pop-ups to print, or use Download'); return; }
    win.document.write(recapDoc(l, w));
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  });
}

/* ---------- bowlers & teams ---------- */
function tabBowlers(l, body) {
  const w = LG.currentWeek(l);
  let h = '<div class="row wrap"><button class="btn small-btn" id="addTeam">+ Team</button><button class="btn small-btn secondary" id="addBowler">+ Bowler</button><button class="btn small-btn secondary" id="importRoster">Import roster</button></div>';
  if (!l.bowlers.some(b => b.isMe) && l.bowlers.length) h += '<div class="notice">Bowl in this league? Tap your name and turn on <b>This is me</b> — your league average then shows on Home and Stats.</div>';
  if (!l.teams.length) h += '<div class="empty">No teams yet. Add them one at a time, or import a roster (Team, Bowler, Email, Average) from a spreadsheet.</div>';
  const bowlerRow = b => {
    const a = LG.averageBefore(l, b.id, w);
    return '<button class="b-row' + (b.active === false ? ' inactive' : '') + '" data-bowler="' + b.id + '"><span class="nm">' + esc(b.name) + (b.isMe ? ' <span class="badge">you</span>' : '') + (b.active === false ? ' <span class="badge">inactive</span>' : '') + '</span>' +
      '<span class="av">' + a.avg + (a.source === 'league' ? '' : '<small>' + (a.source === 'entering' ? ' ent.' : ' new') + '</small>') + (l.handicap.enabled ? '<small> · hcp ' + LG.handicapFor(l, a.avg) + '</small>' : '') + '</span>' +
      (b.email ? '<span class="em" title="' + esc(b.email) + '">✉︎</span>' : '<span class="em none" title="No email">·</span>') + '</button>';
  };
  l.teams.forEach(t => {
    const bs = l.bowlers.filter(b => b.teamId === t.id);
    h += '<div class="card team-list"><div class="team-head"><h3>' + esc(t.name) + '</h3><button class="link-btn" data-team-edit="' + t.id + '">Edit</button></div>' +
      (bs.length ? bs.map(bowlerRow).join('') : '<div class="small muted">No bowlers yet.</div>') +
      (bs.filter(b => b.active !== false).length < l.teamSize ? '<div class="small warn">Short ' + (l.teamSize - bs.filter(b => b.active !== false).length) + ' — empty spots bowl as vacant (' + l.vacancy.score + ').</div>' : '') + '</div>';
  });
  const subsL = l.bowlers.filter(b => !b.teamId);
  h += '<div class="card team-list"><div class="team-head"><h3>Subs</h3></div>' + (subsL.length ? subsL.map(bowlerRow).join('') : '<div class="small muted">No subs yet. Add one here or from the score screen.</div>') + '</div>';
  body.innerHTML = h;
  on('addTeam', 'click', () => teamSheet(l, null));
  on('addBowler', 'click', () => bowlerSheet(l, null));
  on('importRoster', 'click', () => importSheet(l));
  body.querySelectorAll('[data-team-edit]').forEach(b => b.addEventListener('click', () => teamSheet(l, l.teams.find(t => t.id === b.dataset.teamEdit))));
  body.querySelectorAll('[data-bowler]').forEach(b => b.addEventListener('click', () => bowlerSheet(l, LG.bowler(l, b.dataset.bowler))));
}
function teamHasScores(l, tid) { return Object.values(l.results || {}).some(r => r.lines.some(x => x.teamId === tid && (x.absent || (x.games || []).some(g => g != null)))); }
function bowlerHasScores(l, bid) { return Object.values(l.results || {}).some(r => r.lines.some(x => x.bowlerId === bid && (x.absent || (x.games || []).some(g => g != null)))); }

function teamSheet(l, t) {
  const isNew = !t;
  const canDelete = t && !teamHasScores(l, t.id);
  openSheet('<h3>' + (isNew ? 'New team' : 'Edit team') + '</h3><label class="field">Team name<input type="text" id="tmName" value="' + esc(t ? t.name : '') + '"></label>' +
    '<button class="btn" id="tmSave">' + (isNew ? 'Add team' : 'Save') + '</button>' +
    (t ? (canDelete ? '<button class="btn danger mt8" id="tmDel">Delete team</button>' : '<p class="small muted">This team has scores, so it can’t be deleted.</p>') : ''), sh => {
    sh.querySelector('#tmSave').addEventListener('click', () => {
      const name = val('tmName').trim();
      if (!name) { toast('Enter a team name'); return; }
      if (l.teams.some(x => x !== t && x.name.toLowerCase() === name.toLowerCase())) { toast('There’s already a team with that name'); return; }
      if (isNew) { l.teams.push({ id: LG.uid(), name }); regenSchedule(l); }
      else t.name = name;
      save(); closeSheet(); renderLeague(l);
    });
    const del = sh.querySelector('#tmDel');
    if (del) del.addEventListener('click', async () => {
      if (!(await ask('Delete ' + t.name + '? Its bowlers move to the sub list.', 'Delete team', true))) return;
      l.teams = l.teams.filter(x => x !== t);
      l.bowlers.forEach(b => { if (b.teamId === t.id) b.teamId = ''; });
      Object.values(l.results).forEach(r => { r.lines = r.lines.filter(x => x.teamId !== t.id); });
      regenSchedule(l); save(); closeSheet(); renderLeague(l);
    });
  });
}

function bowlerSheet(l, b) {
  const isNew = !b;
  b = b || { name: '', email: '', enteringAvg: null, teamId: (l.teams.find(t => LG.roster(l, t.id).length < l.teamSize) || {}).id || '', isMe: false, active: true };
  const has = !isNew && bowlerHasScores(l, b.id);
  openSheet('<h3>' + (isNew ? 'Add bowler' : 'Edit bowler') + '</h3>' +
    '<label class="field">Name<input type="text" id="bwName" value="' + esc(b.name) + '"></label>' +
    '<label class="field">Email (for the weekly recap)<input type="email" id="bwEmail" value="' + esc(b.email || '') + '" placeholder="name@example.com"></label>' +
    '<div class="grid2"><label class="field">Entering average<input type="number" inputmode="numeric" id="bwAvg" min="0" max="300" value="' + (b.enteringAvg == null ? '' : b.enteringAvg) + '" placeholder="' + l.defaultAvg + '"></label>' +
    '<label class="field">Team<select id="bwTeam">' + l.teams.map(t => '<option value="' + t.id + '"' + (t.id === b.teamId ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('') + '<option value=""' + (!b.teamId ? ' selected' : '') + '>Sub</option></select></label></div>' +
    '<label class="check"><input type="checkbox" id="bwMe"' + (b.isMe ? ' checked' : '') + '> This is me (show my league average on Home &amp; Stats)</label>' +
    (isNew ? '' : '<label class="check"><input type="checkbox" id="bwActive"' + (b.active !== false ? ' checked' : '') + '> Active this season</label>') +
    '<button class="btn" id="bwSave">' + (isNew ? 'Add bowler' : 'Save') + '</button>' +
    (isNew ? '' : (has ? '<p class="small muted">Has league scores — uncheck Active instead of deleting so the history stays.</p>' : '<button class="btn danger mt8" id="bwDel">Remove bowler</button>')), sh => {
    sh.querySelector('#bwSave').addEventListener('click', () => {
      const name = val('bwName').trim();
      if (!name) { toast('Enter a name'); return; }
      const avg = intOr(val('bwAvg'), null);
      if (avg != null && (avg < 0 || avg > 300)) { toast('Average must be 0–300'); return; }
      Object.assign(b, { name, email: val('bwEmail').trim(), enteringAvg: avg, teamId: val('bwTeam'), isMe: el('bwMe').checked });
      const act = el('bwActive');
      if (act) b.active = act.checked;
      if (b.isMe) { l.bowlers.forEach(x => { if (x !== b) x.isMe = false; }); l.askedMe = true; }
      if (isNew) { b.id = LG.uid(); l.bowlers.push(b); }
      save(); closeSheet(); renderLeague(l); toast(isNew ? 'Bowler added' : 'Saved');
    });
    const del = sh.querySelector('#bwDel');
    if (del) del.addEventListener('click', async () => {
      if (!(await ask('Remove ' + b.name + ' from the league?', 'Remove', true))) return;
      l.bowlers = l.bowlers.filter(x => x !== b);
      Object.values(l.results).forEach(r => r.lines.forEach(x => { if (x.bowlerId === b.id) { x.bowlerId = LG.VACANT; } }));
      save(); closeSheet(); renderLeague(l);
    });
  });
}

function importSheet(l) {
  openSheet('<h3>Import roster</h3><p class="small muted mt0">Paste from a spreadsheet or upload a CSV. Columns: <b>Team, Bowler, Email, Average</b>. Leave Team blank (or "Sub") for subs. New teams are created automatically.</p>' +
    '<textarea id="imText" rows="8" placeholder="Team,Bowler,Email,Average&#10;Pin Pals,Dana Ortiz,dana@example.com,172&#10;Pin Pals,Mike Kowalski,,188&#10;Sub,Pat Quinn,,160"></textarea>' +
    '<label class="btn secondary mt8" for="imFile">Choose CSV file…</label><input type="file" id="imFile" accept=".csv,text/csv,text/plain" hidden>' +
    '<div class="scan-status" id="imStatus"></div><button class="btn" id="imGo">Import</button>', sh => {
    const ta = sh.querySelector('#imText');
    const preview = () => {
      const r = LG.rosterFromCSV(ta.value);
      const st = sh.querySelector('#imStatus');
      if (!ta.value.trim()) { st.textContent = ''; return r; }
      st.className = 'scan-status' + (r.ok ? ' good' : '');
      st.textContent = r.ok ? plural(r.rows.length, 'bowler') + ' found across ' + plural(new Set(r.rows.map(x => x.team.toLowerCase()).filter(x => x && !/^subs?$/.test(x))).size, 'team') : r.error;
      return r;
    };
    ta.addEventListener('input', preview);
    sh.querySelector('#imFile').addEventListener('change', async e => { const f = e.target.files[0]; if (f) { ta.value = await f.text(); preview(); } });
    sh.querySelector('#imGo').addEventListener('click', () => {
      const r = preview();
      if (!r.ok) { toast(r.error); return; }
      const res = LG.applyRoster(l, r.rows);
      if (res.teams) regenSchedule(l);
      save(); closeSheet(); renderLeague(l);
      toast('Added ' + plural(res.bowlers, 'bowler') + (res.teams ? ' and ' + plural(res.teams, 'team') : '') + (res.skipped ? ' · ' + res.skipped + ' already on roster' : ''), 4000);
    });
  });
}

/* ---------- schedule ---------- */
function tabSchedule(l, body) {
  if (needTeams(l, body)) return;
  const cur = LG.currentWeek(l);
  let h = '<div class="row wrap"><button class="btn small-btn secondary" id="schRegen">Rebuild unbowled weeks</button><button class="btn small-btn secondary" id="schCsv">Schedule CSV</button></div>';
  if (!l.startDate) h += '<div class="notice">Set the first week’s date in Settings to show dates.</div>';
  if (!l.schedule.length) h += '<div class="empty">No schedule yet.</div>';
  h += l.schedule.map(s => {
    const scored = LG.weekHasScores(l, s.week);
    return '<div class="card sched-week' + (s.week === cur ? ' cur' : '') + '"><div class="team-head"><h3>Week ' + s.week + (scored ? ' <span class="badge ok">bowled</span>' : s.week === cur ? ' <span class="badge">up next</span>' : '') + '</h3><span class="small muted">' + esc(fmtD(s.date || LG.weekDate(l, s.week))) + '</span></div>' +
      s.matchups.map((m, mi) => (scored ? '<div class="sched-row">' : '<button class="sched-row edit" data-sw="' + s.week + '" data-smi="' + mi + '" aria-label="Edit week ' + s.week + ' matchup">') +
        '<span class="muted">' + esc(m.lanes) + '</span>' + esc(LG.teamName(l, m.a)) + ' vs ' + esc(LG.teamName(l, m.b)) + (scored ? '</div>' : '<i class="chev" aria-hidden="true">›</i></button>')).join('') +
      (s.bye ? '<div class="sched-row"><span class="muted">bye</span>' + esc(LG.teamName(l, s.bye) + LG.byeNote(l)) + '</div>' : '') +
      (scored ? '' : '<button class="link-btn" data-sdate="' + s.week + '">Change date</button>') + '</div>';
  }).join('');
  body.innerHTML = h;
  body.querySelectorAll('[data-sw]').forEach(b => b.addEventListener('click', () => editMatchupSheet(l, +b.dataset.sw, +b.dataset.smi)));
  body.querySelectorAll('[data-sdate]').forEach(b => b.addEventListener('click', () => editWeekDateSheet(l, +b.dataset.sdate)));
  on('schRegen', 'click', async () => {
    if (!(await ask('Rebuild matchups for every week that hasn’t been bowled? Bowled weeks stay as they are.', 'Rebuild'))) return;
    regenSchedule(l); save(); renderLeague(l); toast('Schedule rebuilt');
  });
  on('schCsv', 'click', () => {
    const rows = [['Week', 'Date', 'Lanes', 'Team', 'Opponent']];
    l.schedule.forEach(s => { s.matchups.forEach(m => rows.push([s.week, s.date || LG.weekDate(l, s.week), m.lanes, LG.teamName(l, m.a), LG.teamName(l, m.b)])); if (s.bye) rows.push([s.week, s.date, '', LG.teamName(l, s.bye), 'Bye']); });
    download(slug(l.name) + '-schedule.csv', LG.toCSV(rows), 'text/csv');
  });
}

// Change one matchup (e.g. the center swaps pairs for a night) without rebuilding the season.
function editMatchupSheet(l, week, mi) {
  const sch = LG.weekSchedule(l, week);
  const m = sch.matchups[mi];
  const lanes = String(m.lanes).split('-').map(Number);
  const teamSel = (id, cur) => '<select id="' + id + '">' + l.teams.map(t => '<option value="' + t.id + '"' + (t.id === cur ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('') + '</select>';
  openSheet('<h3>Week ' + week + ' matchup</h3>' +
    '<div class="grid2"><label class="field">Team<span class="sr"> one</span>' + teamSel('emA', m.a) + '</label><label class="field">vs' + teamSel('emB', m.b) + '</label></div>' +
    '<fieldset class="lanes-fs"><legend>Lanes</legend><div class="lane-pair"><input type="number" inputmode="numeric" id="emL" min="1" max="120" aria-label="Left lane" value="' + (lanes[0] || '') + '"><span aria-hidden="true">&amp;</span><input type="number" inputmode="numeric" id="emR" min="1" max="120" aria-label="Right lane" value="' + (lanes[1] || '') + '"></div></fieldset>' +
    '<p class="small muted">Picking a team that\u2019s in another matchup this week swaps the two. Only this week changes.</p>' +
    '<button class="btn" id="emSave">Save week ' + week + '</button>', sh => {
    sh.querySelector('#emSave').addEventListener('click', () => {
      const a = val('emA'), b = val('emB');
      const L = intOr(val('emL'), null), R = intOr(val('emR'), null);
      if (a === b) { toast('Pick two different teams'); return; }
      if (!L || !R || L === R) { toast('Enter two different lane numbers'); return; }
      const clash = sch.matchups.find((x, i) => i !== mi && x.lanes === L + '-' + R);
      if (clash) clash.lanes = m.lanes; // lanes swap too
      // Teams pulled in from elsewhere this week trade places with the teams they replace.
      const incoming = [a, b].filter(t => t !== m.a && t !== m.b);
      const displaced = [m.a, m.b].filter(t => t !== a && t !== b);
      incoming.forEach((t, i) => {
        const o = displaced[i];
        const x = sch.matchups.find((y, j) => j !== mi && (y.a === t || y.b === t));
        if (x) { if (x.a === t) x.a = o; else x.b = o; }
        else if (sch.bye === t) sch.bye = o;
      });
      m.a = a; m.b = b; m.lanes = L + '-' + R;
      save(); closeSheet(); renderLeague(l); toast('Week ' + week + ' updated');
    });
  });
}
function editWeekDateSheet(l, week) {
  const s = LG.weekSchedule(l, week);
  openSheet('<h3>Week ' + week + ' date</h3><label class="field">Bowled on<input type="date" id="ewDate" value="' + esc(s.date || LG.weekDate(l, week)) + '"></label>' +
    '<label class="check"><input type="checkbox" id="ewShift"> Move every later week by the same amount</label><button class="btn" id="ewSave">Save</button>', sh => {
    sh.querySelector('#ewSave').addEventListener('click', () => {
      const d = val('ewDate');
      if (!d) { toast('Pick a date'); return; }
      const before = s.date || LG.weekDate(l, week);
      const shift = before ? Math.round((new Date(d + 'T12:00:00') - new Date(before + 'T12:00:00')) / 864e5) : 0;
      s.date = d;
      if (el('ewShift').checked && shift) l.schedule.forEach(x => { if (x.week > week && !LG.weekHasScores(l, x.week)) x.date = LG.addDays(x.date || LG.weekDate(l, x.week), shift); });
      save(); closeSheet(); renderLeague(l); toast('Date saved');
    });
  });
}

/* ---------- which bowler is you? (asked once per league) ---------- */
function askMe(l, after, fromSend) {
  l.askedMe = true;
  save();
  const names = l.bowlers.filter(b => b.active !== false).slice().sort((a, b) => a.name.localeCompare(b.name));
  openSheet('<h3>' + (fromSend ? 'Which bowler are you?' : 'Do you bowl in ' + esc(l.name) + '?') + '</h3>' +
    '<p class="small muted mt0">Pick your name so your league average shows on Home and Stats, and so games you log can go straight onto the league sheet.</p>' +
    '<div class="me-list">' + names.map(b => '<button class="me-pick" data-me="' + b.id + '">' + esc(b.name) + '<small>' + esc(b.teamId ? LG.teamName(l, b.teamId) : 'Sub') + '</small></button>').join('') + '</div>' +
    '<button class="btn secondary mt8" data-close>' + (fromSend ? 'Cancel' : 'I don\u2019t bowl in this league') + '</button>', sh => {
    sh.querySelectorAll('[data-me]').forEach(b => b.addEventListener('click', () => {
      l.bowlers.forEach(x => { x.isMe = x.id === b.dataset.me; });
      save(); closeSheet();
      toast('Got it — you\u2019re ' + LG.bowlerName(l, b.dataset.me));
      if (after) after(); else if (nav().current === 'league') renderLeague(l);
    }));
  });
}
const nav = () => BB.nav;

/* ---------- settings ---------- */
function tabSettings(l, body) {
  body.innerHTML = '<div class="card">' + leagueFormHTML(l, true) + '<button class="btn" id="lfSave">Save settings</button></div>' +
    '<div class="card"><h3>Season data</h3><div class="row wrap"><button class="btn secondary small-btn" id="lfExport">Export league (JSON)</button></div>' +
    '<p class="small muted">Backups of everything on this device live under More → Backup &amp; restore.</p></div>' +
    '<div class="card"><h3>Delete league</h3><p class="small muted mt0">Removes the league, roster, schedule and every week of scores from this device.</p><button class="btn danger" id="lfDelete">Delete league</button></div>';
  on('lfSave', 'click', () => {
    const before = JSON.stringify([l.startDate, l.seasonWeeks, l.teams.length]);
    const err = readLeagueForm(l, true);
    if (err) { toast(err); return; }
    if (JSON.stringify([l.startDate, l.seasonWeeks, l.teams.length]) !== before || !l.schedule.length) {
      regenSchedule(l);
      l.schedule.forEach(s => { s.date = l.startDate ? LG.addDays(l.startDate, 7 * (s.week - 1)) : ''; });
    }
    // lineups follow team size / games-per-night changes for weeks not yet bowled
    Object.keys(l.results).forEach(wk => { if (!LG.weekHasScores(l, +wk)) delete l.results[wk]; });
    Object.values(l.results).forEach(r => r.lines.forEach(x => { x.games = (x.games || []).slice(0, l.gamesPerNight); while (x.games.length < l.gamesPerNight) x.games.push(null); }));
    save(); toast('Settings saved'); renderLeague(l);
  });
  on('lfExport', 'click', () => download(slug(l.name) + '.json', JSON.stringify(l, null, 2), 'application/json'));
  on('lfDelete', 'click', async () => {
    if (!(await ask('Delete ' + l.name + ' with its roster, schedule and every week of scores? Games in your own log stay in History as practice.', 'Delete league', true))) return;
    Store.deleteLeague(l.id); lv.id = null; toast('League deleted'); show('league', { list: true });
  });
}

window.BBLeagueUI = { lv, regenSchedule, myLoggedGames, askMe };
})();
