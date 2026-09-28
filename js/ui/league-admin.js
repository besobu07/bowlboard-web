/* BowlBoard — league Schedule tab and Admin (the secretary's side): teams and
 * rosters, rules and settings, imports and exports, and "which bowler are you?". */
(function () {
'use strict';
const BB = window.BB;
const LG = window.BBLeague, Store = window.BBStore;
const { esc, icon, el, on, val, show, toast, ask, openSheet, closeSheet, download, plural, todayISO } = BB;
const { lv, fmtD, intOr, slug, save, regenSchedule, renderLeague, needTeams } = BB.L;

/* ---------- league form (create + settings) ---------- */
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
    '<label class="field">Team on a bye gets<select id="lfBye">' + [['none', 'No points'], ['half', 'Half the night’s points'], ['full', 'All the night’s points']].map(o => '<option value="' + o[0] + '"' + ((l.byePoints || 'none') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>' +
    '<div class="small muted">Only matters with an odd number of teams.</div></fieldset>';
  if (full) {
    h += '<fieldset class="fs"><legend>Rules</legend><div class="grid2">' +
      '<label class="field">Absent score = avg minus<input type="number" inputmode="numeric" id="lfAbsent" min="0" max="100" value="' + l.absent.pinsBelowAvg + '"></label>' +
      '<label class="field">Vacancy score<input type="number" inputmode="numeric" id="lfVacant" min="0" max="300" value="' + l.vacancy.score + '"></label>' +
      '<label class="field">Use entering avg until (games)<input type="number" inputmode="numeric" id="lfEst" min="1" max="30" value="' + l.establishGames + '"></label>' +
      '<label class="field">Avg for new bowlers<input type="number" inputmode="numeric" id="lfDefAvg" min="0" max="300" value="' + l.defaultAvg + '"></label></div>' +
      '<label class="field">A new bowler’s first night<select id="lfNewAvg"><option value="default"' + (l.newBowlerAvg !== 'firstNight' ? ' selected' : '') + '>Handicap from the average above</option><option value="firstNight"' + (l.newBowlerAvg === 'firstNight' ? ' selected' : '') + '>Handicap from that night’s own average</option></select></label></fieldset>' +
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
  const games = Math.max(1, Math.min(5, intOr(val('lfGames'), l.gamesPerNight)));
  const most = LG.mostGamesEntered(l);
  if (games < most) return 'Scores are already in for game ' + most + ', so games per night can’t go below ' + most + '.';
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
    l.newBowlerAvg = val('lfNewAvg') === 'firstNight' ? 'firstNight' : 'default';
    l.ccEmails = val('lfCc').trim();
  }
  return null;
}

/* ---------- schedule tab (view; secretaries can switch on editing) ---------- */
BB.LT.schedule = function (l, body) {
  if (needTeams(l, body)) return;
  const cur = LG.currentWeek(l);
  const me = LG.me(l);
  const edit = lv.editSchedule;
  let h = '<div class="row wrap sched-tools"><button class="btn small-btn ' + (edit ? '' : 'secondary') + '" id="schEdit" aria-pressed="' + edit + '">' + icon('pencil') + (edit ? 'Done editing' : 'Edit schedule') + '</button>' +
    (edit ? '<button class="btn small-btn secondary" id="schRegen">Rebuild unbowled weeks</button>' : '') + '<button class="btn small-btn secondary" id="schCsv">Schedule CSV</button></div>';
  if (edit) h += '<p class="small muted">Tap a matchup in a week that hasn’t been bowled to change teams or lanes, or move a week’s date.</p>';
  if (!l.startDate) h += '<div class="notice">Set the first week’s date in Admin → Rules to show dates.</div>';
  if (!l.schedule.length) h += '<div class="empty">No schedule yet.</div>';
  h += l.schedule.map(s => {
    const scored = LG.weekHasScores(l, s.week);
    const canEdit = edit && !scored;
    return '<div class="card sched-week' + (s.week === cur ? ' cur' : '') + '"><div class="team-head"><h3>Week ' + s.week + (scored ? ' <span class="badge ok">bowled</span>' : s.week === cur ? ' <span class="badge">up next</span>' : '') + '</h3><span class="small muted">' + esc(fmtD(s.date || LG.weekDate(l, s.week))) + '</span></div>' +
      s.matchups.map((m, mi) => {
        const mine = me && me.teamId && (m.a === me.teamId || m.b === me.teamId);
        return (canEdit ? '<button class="sched-row edit' + (mine ? ' mine' : '') + '" data-sw="' + s.week + '" data-smi="' + mi + '" aria-label="Edit week ' + s.week + ' matchup">' : '<div class="sched-row' + (mine ? ' mine' : '') + '">') +
          '<span class="muted">' + esc(m.lanes) + '</span>' + esc(LG.teamName(l, m.a)) + ' vs ' + esc(LG.teamName(l, m.b)) + (canEdit ? '<i class="chev" aria-hidden="true">›</i></button>' : '</div>');
      }).join('') +
      (s.bye ? '<div class="sched-row"><span class="muted">bye</span>' + esc(LG.teamName(l, s.bye) + LG.byeNote(l)) + '</div>' : '') +
      (canEdit ? '<button class="link-btn" data-sdate="' + s.week + '">Change date</button>' : '') + '</div>';
  }).join('');
  body.innerHTML = h;
  body.querySelectorAll('[data-sw]').forEach(b => b.addEventListener('click', () => editMatchupSheet(l, +b.dataset.sw, +b.dataset.smi)));
  body.querySelectorAll('[data-sdate]').forEach(b => b.addEventListener('click', () => editWeekDateSheet(l, +b.dataset.sdate)));
  on('schEdit', 'click', () => { lv.editSchedule = !lv.editSchedule; renderLeague(l); });
  on('schRegen', 'click', async () => {
    if (!(await ask('Rebuild matchups for every week that hasn’t been bowled? Bowled weeks stay as they are.', 'Rebuild'))) return;
    regenSchedule(l); save(l); renderLeague(l); toast('Schedule rebuilt');
  });
  on('schCsv', 'click', () => {
    const rows = [['Week', 'Date', 'Lanes', 'Team', 'Opponent']];
    l.schedule.forEach(s => { s.matchups.forEach(m => rows.push([s.week, s.date || LG.weekDate(l, s.week), m.lanes, LG.teamName(l, m.a), LG.teamName(l, m.b)])); if (s.bye) rows.push([s.week, s.date, '', LG.teamName(l, s.bye), 'Bye']); });
    download(slug(l.name) + '-schedule.csv', LG.toCSV(rows), 'text/csv');
  });
};

// Change one matchup (e.g. the center swaps pairs for a night) without rebuilding the season.
function editMatchupSheet(l, week, mi) {
  const sch = LG.weekSchedule(l, week);
  const m = sch.matchups[mi];
  const lanes = String(m.lanes).split('-').map(Number);
  const teamSel = (id, cur) => '<select id="' + id + '">' + l.teams.map(t => '<option value="' + t.id + '"' + (t.id === cur ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('') + '</select>';
  openSheet('<h3>Week ' + week + ' matchup</h3>' +
    '<div class="grid2"><label class="field">Team<span class="sr"> one</span>' + teamSel('emA', m.a) + '</label><label class="field">vs' + teamSel('emB', m.b) + '</label></div>' +
    '<fieldset class="lanes-fs"><legend>Lanes</legend><div class="lane-pair"><input type="number" inputmode="numeric" id="emL" min="1" max="120" aria-label="Left lane" value="' + (lanes[0] || '') + '"><span aria-hidden="true">&amp;</span><input type="number" inputmode="numeric" id="emR" min="1" max="120" aria-label="Right lane" value="' + (lanes[1] || '') + '"></div></fieldset>' +
    '<p class="small muted">Picking a team that’s in another matchup this week swaps the two. Only this week changes.</p>' +
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
      save(l); closeSheet(); renderLeague(l); toast('Week ' + week + ' updated');
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
      save(l); closeSheet(); renderLeague(l); toast('Date saved');
    });
  });
}

/* ---------- admin ---------- */
const SUBS = [['bowlers', 'Bowlers'], ['settings', 'Rules'], ['data', 'Import & export']];
BB.LT.admin = function (l, body) {
  let h = '<div class="admin-note small muted">' + icon('gear') + 'For whoever runs the league. Bowlers don’t need anything here.</div>' +
    '<div class="subseg" role="tablist">' + SUBS.map(s => '<button role="tab" data-sub="' + s[0] + '" aria-selected="' + (lv.admin === s[0]) + '" class="' + (lv.admin === s[0] ? 'on' : '') + '">' + s[1] + '</button>').join('') + '</div><div id="adBody"></div>';
  body.innerHTML = h;
  body.querySelectorAll('[data-sub]').forEach(b => b.addEventListener('click', () => { lv.admin = b.dataset.sub; renderLeague(l); }));
  const inner = body.querySelector('#adBody');
  ({ bowlers: adminBowlers, settings: adminSettings, data: adminData }[lv.admin] || adminBowlers)(l, inner);
};

function adminBowlers(l, body) {
  const w = LG.currentWeek(l);
  let h = '<div class="row wrap"><button class="btn small-btn" id="addTeam">+ Team</button><button class="btn small-btn secondary" id="addBowler">+ Bowler</button><button class="btn small-btn secondary" id="importRoster">Import roster</button></div>';
  if (!l.bowlers.some(b => b.isMe) && l.bowlers.length) h += '<div class="notice">Bowl in this league? Tap your name and turn on <b>This is me</b> — your matchup, league average and linked games then show on Home.</div>';
  if (!l.teams.length) h += '<div class="empty">No teams yet. Add them one at a time, or import a roster (Team, Bowler, Email, Average) from a spreadsheet.</div>';
  const bowlerRow = b => {
    const a = LG.averageBefore(l, b.id, w);
    return '<button class="b-row' + (b.active === false ? ' inactive' : '') + '" data-bowler="' + b.id + '"><span class="nm">' + esc(b.name) + (b.isMe ? ' <span class="badge">you</span>' : '') + (b.active === false ? ' <span class="badge">inactive</span>' : '') + '</span>' +
      '<span class="av">' + a.avg + (a.source === 'league' ? '' : '<small>' + (a.source === 'entering' ? ' ent.' : ' new') + '</small>') + (l.handicap.enabled ? '<small> · hcp ' + LG.handicapFor(l, a.avg) + '</small>' : '') + '</span>' +
      (b.email ? '<span class="em" title="' + esc(b.email) + '">' + icon('mail') + '</span>' : '<span class="em none" title="No email">·</span>') + '</button>';
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
  on('importRoster', 'click', () => importRosterSheet(l));
  body.querySelectorAll('[data-team-edit]').forEach(b => b.addEventListener('click', () => teamSheet(l, l.teams.find(t => t.id === b.dataset.teamEdit))));
  body.querySelectorAll('[data-bowler]').forEach(b => b.addEventListener('click', () => bowlerSheet(l, LG.bowler(l, b.dataset.bowler))));
}

function adminSettings(l, body) {
  body.innerHTML = '<div class="card">' + leagueFormHTML(l, true) + '<button class="btn" id="lfSave">Save settings</button></div>' +
    '<div class="card"><h3>Delete league</h3><p class="small muted mt0">Removes the league, roster, schedule and every week of scores from this device. An automatic copy is kept first.</p><button class="btn danger" id="lfDelete">Delete league</button></div>';
  on('lfSave', 'click', () => {
    const start0 = l.startDate, weeks0 = l.seasonWeeks, teams0 = l.teams.length;
    const err = readLeagueForm(l, true);
    if (err) { toast(err, 4000); return; }
    // Bowled weeks keep their matchups and dates; unbowled weeks keep their dates unless
    // the first week's date moved.
    if (l.startDate !== start0 || l.seasonWeeks !== weeks0 || l.teams.length !== teams0 || !l.schedule.length) {
      LG.rebuildSchedule(l, { redate: l.startDate !== start0 });
    }
    // lineups follow team size / games-per-night changes for weeks not yet bowled
    Object.keys(l.results).forEach(wk => { if (!LG.weekHasScores(l, +wk)) delete l.results[wk]; });
    Object.values(l.results).forEach(r => r.lines.forEach(x => { x.games = (x.games || []).slice(0, l.gamesPerNight); while (x.games.length < l.gamesPerNight) x.games.push(null); }));
    save(l); toast('Settings saved'); renderLeague(l);
  });
  on('lfDelete', 'click', async () => {
    if (!(await ask('Delete ' + l.name + ' with its roster, schedule and every week of scores? Games in your own log stay in History as practice.', 'Delete league', true))) return;
    const can = await Store.snapshots.available();
    const copy = await Store.snapshots.take('before-league-delete', { force: true });
    if (can && !copy) { toast('Couldn’t keep a copy first, so nothing was deleted. Try again.', 4000); return; }
    Store.deleteLeague(l.id); lv.id = null; toast(copy ? 'League deleted — an automatic copy was kept' : 'League deleted'); show('league', { list: true });
  });
}

function adminData(l, body) {
  body.innerHTML = '<div class="card"><h3>' + icon('upload') + 'Import weeks already bowled</h3><p class="small muted mt0">Starting mid-season? Paste or upload Week, Team, Bowler, Game 1… rows (or a LeagueSecretary weekly-scores export).</p><button class="btn secondary" id="impScores">Import weeks</button></div>' +
    '<div class="card"><h3>' + icon('download') + 'Export</h3><div class="row wrap"><button class="btn secondary small-btn" id="lfExport">League (JSON)</button><button class="btn secondary small-btn" id="exStand">Standings CSV</button><button class="btn secondary small-btn" id="exAvg">Averages CSV</button></div>' +
    '<p class="small muted">Backups of everything on this device live under More → Backup &amp; restore.</p></div>';
  on('impScores', 'click', () => importScoresSheet(l));
  on('lfExport', 'click', () => download(slug(l.name) + '.json', JSON.stringify(l, null, 2), 'application/json'));
  const w = LG.lastScoredWeek(l) || 1;
  on('exStand', 'click', () => download(slug(l.name) + '-standings-week-' + w + '.csv', LG.standingsCSV(l, w), 'text/csv'));
  on('exAvg', 'click', () => download(slug(l.name) + '-averages-week-' + w + '.csv', LG.averagesCSV(l, w), 'text/csv'));
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
      save(l); closeSheet(); renderLeague(l);
    });
    const del = sh.querySelector('#tmDel');
    if (del) del.addEventListener('click', async () => {
      if (!(await ask('Delete ' + t.name + '? Its bowlers move to the sub list.', 'Delete team', true))) return;
      l.teams = l.teams.filter(x => x !== t);
      l.bowlers.forEach(b => { if (b.teamId === t.id) b.teamId = ''; });
      Object.values(l.results).forEach(r => { r.lines = r.lines.filter(x => x.teamId !== t.id); });
      regenSchedule(l); save(l); closeSheet(); renderLeague(l);
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
    '<label class="check"><input type="checkbox" id="bwMe"' + (b.isMe ? ' checked' : '') + '> This is me (show my matchup and league average on Home)</label>' +
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
      save(l); closeSheet(); renderLeague(l); toast(isNew ? 'Bowler added' : 'Saved');
    });
    const del = sh.querySelector('#bwDel');
    if (del) del.addEventListener('click', async () => {
      if (!(await ask('Remove ' + b.name + ' from the league?', 'Remove', true))) return;
      l.bowlers = l.bowlers.filter(x => x !== b);
      Object.values(l.results).forEach(r => r.lines.forEach(x => { if (x.bowlerId === b.id) { x.bowlerId = LG.VACANT; } }));
      save(l); closeSheet(); renderLeague(l);
    });
  });
}

function importRosterSheet(l) {
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
      save(l); closeSheet(); renderLeague(l);
      toast('Added ' + plural(res.bowlers, 'bowler') + (res.teams ? ' and ' + plural(res.teams, 'team') : '') + (res.skipped ? ' · ' + res.skipped + ' already on roster' : ''), 4000);
    });
  });
}

// Bring in weeks that were bowled before the league moved to BowlBoard.
function importScoresSheet(l) {
  const G = l.gamesPerNight;
  const head = ['Week', 'Team', 'Bowler'].concat(Array.from({ length: G }, (_, i) => 'Game ' + (i + 1))).concat(['Status']);
  const template = () => {
    const rows = [head];
    const today = todayISO();
    let upTo = LG.lastScoredWeek(l);
    for (let w = 1; w <= l.seasonWeeks; w++) { const d = LG.weekDate(l, w); if (d && d < today) upTo = Math.max(upTo, w); }
    for (let w = 1; w <= Math.max(1, upTo); w++) {
      l.teams.forEach(t => LG.roster(l, t.id).forEach(b => rows.push([w, t.name, b.name].concat(new Array(G).fill('')).concat(['']))));
    }
    return LG.toCSV(rows);
  };
  openSheet('<h3>Import weeks already bowled</h3>' +
    '<p class="small muted mt0">Paste from your spreadsheet or upload a CSV with columns <b>' + esc(head.slice(0, 4).join(', ')) + '…</b> and an optional <b>Status</b> (absent / vacant). Each team in the file replaces that team’s scores for that week. Bowlers not on the roster are added to their team.</p>' +
    '<button class="btn secondary small-btn" id="isTpl">Get a template with your roster</button>' +
    '<textarea id="isText" rows="8" class="mt8" placeholder="' + esc(head.join(',')) + '&#10;1,Pin Pals,Dana Ortiz,172,188,165,&#10;1,Pin Pals,Mike Kowalski,,,,absent"></textarea>' +
    '<label class="btn secondary mt8" for="isFile">Choose a file (.xlsx or .csv)…</label><input type="file" id="isFile" accept=".xlsx,.csv,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>' +
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
    sh.querySelector('#isFile').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      try { ta.value = await fileToCSV(f); } catch (err) { toast(err.message || 'Couldn’t read that file', 4000); return; }
      preview();
    });
    sh.querySelector('#isTpl').addEventListener('click', () => {
      const csv = template();
      if (BB.EMBED) { ta.value = csv; preview(); toast('Template filled in — add scores, or copy it into a spreadsheet'); }
      else download(slug(l.name) + '-scores-template.csv', csv, 'text/csv');
    });
    sh.querySelector('#isGo').addEventListener('click', () => {
      if (!parsed || !parsed.ok) return;
      const r = LG.applyScores(l, parsed);
      Store.syncLinks();
      save(l); closeSheet();
      lv.week = LG.currentWeek(l);
      renderLeague(l);
      toast('Imported ' + plural(r.weeks, 'week') + (r.added ? ' · ' + plural(r.added, 'new bowler') : ''), 3500);
    });
  });
}

/* ---------- files: .xlsx or .csv -> table ---------- */
async function fileToTable(f) {
  if (/\.xlsx$/i.test(f.name) || /spreadsheetml/.test(f.type)) {
    if (!window.BBXlsx || typeof DecompressionStream === 'undefined') throw new Error('This browser can’t open .xlsx files. Save it as CSV and try again.');
    const wb = await window.BBXlsx.read(await f.arrayBuffer());
    const sheet = wb.sheets.find(x => x.rows.length > 1) || wb.sheets[0];
    if (!sheet) throw new Error('That spreadsheet is empty.');
    return sheet.rows;
  }
  return LG.parseCSV(await f.text());
}
async function fileToCSV(f) { return LG.toCSV(await fileToTable(f)); }
function nameFromFile(fname) {
  const base = String(fname || '').replace(/\.[^.]+$/, '').replace(/[-_ ]?(weekly[-_ ]?scores|scores|export|stats?)$/i, '');
  return base.split(/[-_ ]+/).filter(Boolean).map(w => (/^\d{4}$/.test(w) && +w.slice(2) === +w.slice(0, 2) + 1 ? w.slice(0, 2) + '-' + w.slice(2) : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(' ') || 'Imported league';
}

/* ---------- import a whole season from a LeagueSecretary / BLS export ---------- */
function importLeagueSheet() {
  let result = null, check = null, fileName = '';
  const fmt = iso => (iso ? LG.fmtDate(iso) : '');
  const summary = () => {
    const r = result.report;
    const h = r.handicap;
    const li = (ok, txt) => '<li class="' + (ok ? 'ok' : 'warn') + '">' + txt + '</li>';
    return '<ul class="import-facts">' +
      li(true, '<b>' + plural(r.weeks, 'week') + '</b>' + (r.firstDate ? ' · ' + esc(fmt(r.firstDate)) + ' – ' + esc(fmt(r.lastDate)) : '') + ' · ' + esc(result.league.day) + 's') +
      li(true, '<b>' + plural(r.teams, 'team') + '</b> of ' + r.teamSize + ', ' + r.gamesPerNight + ' games a night') +
      li(true, '<b>' + plural(r.bowlers, 'bowler') + '</b> — ' + r.rostered + ' on rosters (from the last week’s lineups), ' + plural(r.subs, 'sub')) +
      li(!r.handicapMatch || r.handicapMatch.ok === r.handicapMatch.tot, h.enabled ? 'Handicap <b>' + h.pct + '% of ' + h.basis + '</b>, ' + esc(LG.ROUNDING_LABEL[h.rounding].toLowerCase()) + (r.handicapMatch ? ' (fits ' + r.handicapMatch.ok + ' of ' + r.handicapMatch.tot + ' rows)' : '') : '<b>Scratch</b> (no handicap)') +
      li(!r.avgMatch || r.avgMatch.ok === r.avgMatch.tot, 'Entering averages kept for <b>' + plural(r.keepGames, 'game') + '</b>' + (r.firstNight ? '; new bowlers’ first night uses their own average (' + r.newBowlers + ' bowlers)' : '')) +
      li(true, 'Absent bowlers score <b>average − ' + r.pinsBelowAvg + '</b>') +
      li(r.laneWeeks === r.weeks, 'Matchups read from lane pairs for <b>' + r.laneWeeks + ' of ' + r.weeks + '</b> weeks') +
      '</ul>' +
      (check ? (check.avgOk === check.checked && check.hcpOk === check.checked
        ? '<div class="import-check ok">✓ BowlBoard recalculated every average and handicap: all <b>' + check.checked.toLocaleString() + '</b> lines match the file.</div>'
        : '<div class="import-check warn">Averages match on ' + check.avgOk + ' and handicaps on ' + check.hcpOk + ' of ' + check.checked + ' lines. First difference: row ' + check.mismatches[0].row + ' (' + esc(check.mismatches[0].bowler) + ', week ' + check.mismatches[0].week + '): file ' + check.mismatches[0].fileAvg + '/' + check.mismatches[0].fileHdcp + ', BowlBoard ' + check.mismatches[0].ourAvg + '/' + check.mismatches[0].ourHdcp + '.</div>') : '') +
      (r.warnings.length ? '<div class="small warn">' + r.warnings.map(esc).join('<br>') + '</div>' : '');
  };
  openSheet('<h3>Import a league from a file</h3>' +
    '<p class="small muted mt0">Use a <b>weekly scores</b> export from LeagueSecretary.com (Excel export with Cloud Access) or from the BLS program: one row per bowler per week with Week, Date, Team, Bowler, Avg, Hdcp, G1–G3, Lane and Note. BowlBoard works out your league’s rules from the numbers and checks them against every row before creating anything.</p>' +
    '<label class="btn" for="ilFile">Choose file (.xlsx or .csv)…</label><input type="file" id="ilFile" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>' +
    '<div id="ilBody" aria-live="polite"></div>', sh => {
    const body = sh.querySelector('#ilBody');
    sh.querySelector('#ilFile').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      fileName = f.name;
      body.innerHTML = '<p class="small muted">Reading ' + esc(f.name) + '…</p>';
      let table;
      try { table = await fileToTable(f); } catch (err) { body.innerHTML = '<div class="warn small mt8">' + esc(err.message || 'Couldn’t read that file.') + '</div>'; return; }
      result = LG.importSeason(table, { name: nameFromFile(fileName), source: fileName });
      if (!result.ok) { body.innerHTML = '<div class="warn small mt8">' + esc(result.error) + '</div>'; return; }
      check = LG.verifySeason(result.league, result.recs);
      const L = result.league;
      const dup = LG.findDuplicate(Store.state.leagues, L);
      body.innerHTML = (dup ? '<div class="notice dup-note" id="ilDup"><b>You already have “' + esc(dup.name) + '”</b>' + (dup.imported ? ' (imported ' + esc(fmt(dup.imported.at.slice(0, 10))) + ')' : '') + '.' +
          '<label class="check"><input type="radio" name="ilDupMode" value="update" checked> <span><b>Update it from this file.</b> Weeks in the file replace those weeks there. Everything else stays: later weeks, the season length and dates, rules and points, roster emails, who you are, and your linked games. An automatic copy is kept first.</span></label>' +
          '<label class="check"><input type="radio" name="ilDupMode" value="both"> <span>Keep both (adds a second copy)</span></label></div>' : '') +
        summary() +
        '<div id="ilNewFields"' + (dup ? ' hidden' : '') + '>' +
        '<label class="field">League name<input type="text" id="ilName" value="' + esc(L.name) + '"></label>' +
        '<label class="field">Bowling center<select id="ilCenter"><option value="">—</option>' + BB.centerOptions(dup && dup.centerId ? dup.centerId : '', true) + '</select></label>' +
        '<div id="ilNewCenter" hidden class="new-center"><label class="field">Center name<input type="text" id="ilCName" placeholder="e.g. Lisle Lanes"></label></div>' +
        '<label class="field">Weeks in the season<input type="number" inputmode="numeric" id="ilWeeks" min="' + L.seasonWeeks + '" max="52" value="' + L.seasonWeeks + '"></label>' +
        '<div class="small muted">The file has ' + plural(L.seasonWeeks, 'week') + '. Starting mid-season? Enter the full season so the weeks still to come are scheduled.</div>' +
        '<fieldset class="fs"><legend>Points (not in the file)</legend><div class="grid2">' +
        '<label class="field">Per game won<input type="number" inputmode="decimal" id="ilPg" min="0" step="0.5" value="' + L.points.perGame + '"></label>' +
        '<label class="field">For total pins<input type="number" inputmode="decimal" id="ilPs" min="0" step="0.5" value="' + L.points.perSeries + '"></label></div>' +
        '<div class="small muted">Match your league’s standings sheet; you can change it later in Admin → Rules.</div></fieldset></div>' +
        '<button class="btn" id="ilGo">' + (dup ? 'Update ' + esc(dup.name) : 'Create league') + '</button>';
      const mode = () => { const m = sh.querySelector('input[name="ilDupMode"]:checked'); return dup && m ? m.value : 'new'; };
      sh.querySelectorAll('input[name="ilDupMode"]').forEach(r => r.addEventListener('change', () => {
        sh.querySelector('#ilNewFields').hidden = mode() === 'update';
        sh.querySelector('#ilGo').textContent = mode() === 'update' ? 'Update ' + dup.name : 'Create league';
      }));
      sh.querySelector('#ilCenter').addEventListener('change', ev => { sh.querySelector('#ilNewCenter').hidden = ev.target.value !== '__new'; });
      const go = sh.querySelector('#ilGo');
      go.addEventListener('click', async () => {
        if (go.disabled) return;
        go.disabled = true; // one tap, one league
        const done = ok => { if (!ok) go.disabled = false; };
        if (mode() === 'update') {
          const can = await Store.snapshots.available();
          const copy = await Store.snapshots.take('before-league-replace', { force: true });
          if (can && !copy) { toast('Couldn’t keep a copy first, so nothing was changed. Try again.', 4000); return done(false); }
          const res = LG.mergeImport(dup, L);
          Store.syncLinks();
          save(dup);
          closeSheet();
          toast('Updated ' + dup.name + ' — ' + plural(res.weeks, 'week') + ' from the file' + (res.bowlers ? ', ' + plural(res.bowlers, 'new bowler') : '') + (res.links ? ' · ' + plural(res.links, 'linked game') + ' kept' : ''), 4000);
          show('league', { id: dup.id, tab: 'standings', week: LG.lastScoredWeek(dup) });
          return;
        }
        const name = val('ilName').trim();
        if (!name) { toast('Give the league a name'); return done(false); }
        let centerId = val('ilCenter');
        if (centerId === '__new') {
          const cn = val('ilCName').trim();
          if (!cn) { toast('Name the bowling center'); return done(false); }
          centerId = Store.addCenter(cn, '').id;
        }
        Object.assign(L, { name, centerId, points: { perGame: Math.max(0, parseFloat(val('ilPg')) || 0), perSeries: Math.max(0, parseFloat(val('ilPs')) || 0) } });
        const weeks = Math.min(52, intOr(val('ilWeeks'), L.seasonWeeks));
        if (weeks > L.seasonWeeks) LG.setSeasonLength(L, weeks);
        Store.addLeague(L);
        Store.syncLinks();
        save(L);
        closeSheet();
        toast('Imported ' + name + ' — ' + plural(result.report.weeks, 'week') + ', ' + plural(result.report.bowlers, 'bowler'), 3500);
        show('league', { id: L.id, tab: 'standings', week: LG.lastScoredWeek(L) });
      });
    });
  });
}

/* ---------- which bowler is you? (asked once per league) ---------- */
function askMe(l, after, fromSend) {
  l.askedMe = true;
  Store.save();
  const names = l.bowlers.filter(b => b.active !== false).slice().sort((a, b) => a.name.localeCompare(b.name));
  openSheet('<h3>' + (fromSend ? 'Which bowler are you?' : 'Do you bowl in ' + esc(l.name) + '?') + '</h3>' +
    '<p class="small muted mt0">Pick your name so your matchup and league average show on Home, and so games you log can go straight onto the league sheet.</p>' +
    '<div class="me-list">' + names.map(b => '<button class="me-pick" data-me="' + b.id + '">' + esc(b.name) + '<small>' + esc(b.teamId ? LG.teamName(l, b.teamId) : 'Sub') + '</small></button>').join('') + '</div>' +
    '<button class="btn secondary mt8" data-close>' + (fromSend ? 'Cancel' : 'I don’t bowl in this league') + '</button>', sh => {
    sh.querySelectorAll('[data-me]').forEach(b => b.addEventListener('click', () => {
      l.bowlers.forEach(x => { x.isMe = x.id === b.dataset.me; });
      Store.save(); closeSheet();
      toast('Got it — you’re ' + LG.bowlerName(l, b.dataset.me));
      if (after) after(); else if (BB.nav.current === 'league') renderLeague(l);
    }));
  });
}

Object.assign(BB, { leagueFormHTML, readLeagueForm, importLeagueSheet, askMe, fileToTable, nameFromFile });
window.BBLeagueUI = { lv, regenSchedule, myLoggedGames: BB.L.myLoggedGames, askMe };
})();
