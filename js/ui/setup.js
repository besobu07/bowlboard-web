/* BowlBoard — starting a game: how you're scoring (the four ways in), the details,
 * the "saved" screen that keeps a series going, and sending a series to the league sheet. */
(function () {
'use strict';
const BB = window.BB;
const S = window.BBScore, Store = window.BBStore, LG = window.BBLeague;
const { RENDER, ACT, esc, fmtDate, todayISO, icon, el, on, val, show, toast, openSheet, closeSheet, screenRoot, rerender, plural,
  MODE_LABEL, centerOptions, ballOptions, leagueOptions, patternList, lanesFields, readLanes, bindLanes, leagueName, scoredGames, scorecardHTML } = BB;

const MODES = [
  ['pins', 'pin', 'Pin by pin', 'Track every throw — every stat', ''],
  ['photo', 'camera', 'Photo of the lane screen', 'Snap the screen when you finish, check it, done', ''],
  ['frames', 'grid', 'Running totals', 'Copy the score under each frame', ''],
  ['total', 'pencil', 'Total only', 'Just the final score — fastest', ''],
];

let newSetup = null;
function defaultSetup() {
  const last = Store.state.games[0];
  const lastMode = last && last.mode !== 'photo' && MODE_LABEL[last.mode] ? last.mode : 'pins';
  return {
    date: todayISO(),
    centerId: last ? last.centerId : (Store.state.centers[0] || {}).id || '__new',
    ballId: last ? last.ballId || '' : '',
    lanes: [], pattern: last ? last.pattern || '' : '',
    leagueId: '', mode: lastMode, seriesId: null, gameNo: 1,
  };
}
// Start a new game or series; opts can preset {leagueId, mode}.
function newGame(opts) {
  newSetup = defaultSetup();
  if (opts && opts.leagueId) {
    const l = Store.getLeague(opts.leagueId);
    if (l) {
      newSetup.leagueId = l.id;
      if (l.centerId && Store.state.centers.some(c => c.id === l.centerId)) newSetup.centerId = l.centerId;
      const w = LG.weekForDate(l, newSetup.date);
      const mm = w && LG.me(l) ? LG.myMatchup(l, w) : null;
      if (mm && mm.lanes) newSetup.lanes = Store.parseLanes(mm.lanes) || [];
    }
  }
  if (opts && opts.mode) newSetup.mode = opts.mode;
  show('new');
}
function continueSeries(g) {
  const n = Store.seriesGames(g.seriesId).length;
  // After a photo game, go back to regular entry rather than another camera pass.
  const mode = g.mode === 'photo' ? 'pins' : g.mode;
  newSetup = { date: g.date, centerId: g.centerId, ballId: g.ballId || '', lanes: (g.lanes || []).slice(), pattern: g.pattern || '', leagueId: g.leagueId || '', mode, seriesId: g.seriesId, gameNo: n + 1 };
  show('new');
}
function leagueWeekHint(leagueId, date) {
  const l = Store.getLeague(leagueId);
  if (!l) return '';
  const w = LG.weekForDate(l, date);
  const me = LG.me(l);
  if (!w) return '<div class="small muted hint">No week of ' + esc(l.name) + ' falls on this date.</div>';
  const m = me && me.teamId ? LG.weekSchedule(l, w).matchups.find(x => x.a === me.teamId || x.b === me.teamId) : null;
  return '<div class="small muted hint">Week ' + w + (m ? ' · ' + esc(LG.teamName(l, m.a)) + ' vs ' + esc(LG.teamName(l, m.b)) + ' · lanes ' + esc(m.lanes) : '') + '.</div>' +
    '<div class="link-hint">' + icon('link') + '<span>When you finish, send the series to the league sheet. It’s entered once and stays linked: fix a game here and the sheet follows.</span></div>';
}
RENDER.new = function () {
  if (!newSetup) newSetup = defaultSetup();
  const s = newSetup;
  const cont = !!s.seriesId;
  if (!Store.state.centers.length) s.centerId = '__new';
  let h = '<h2 class="screen-title">' + (cont ? 'Game ' + s.gameNo + ' of your series' : 'How are you scoring?') + '</h2>';
  if (cont) {
    h += '<div class="card info-card"><b>' + fmtDate(s.date) + ' · ' + esc(Store.centerName(s.centerId)) + '</b>' +
      (s.leagueId ? '<div class="small muted">' + esc(leagueName(s.leagueId)) + '</div>' : '') +
      '<button class="link-btn" id="ngFresh">Start a separate series instead</button></div>';
  }
  h += '<div class="mode-list" role="group" aria-label="How are you scoring?">';
  MODES.forEach(m => {
    h += '<button class="mode-card' + (s.mode === m[0] ? ' sel' : '') + '" data-act="mode" data-mode="' + m[0] + '" aria-pressed="' + (s.mode === m[0]) + '">' +
      '<span class="mc-ic">' + icon(m[1]) + '</span><span class="mc-body"><span class="t">' + m[2] + '</span><span class="d">' + m[3] + '</span></span>' + (m[4] ? '<span class="tag">' + m[4] + '</span>' : '') + '</button>';
  });
  h += '</div>';
  if (s.mode === 'frames' || s.mode === 'total') {
    h += '<div class="notice mode-note">' + (s.mode === 'total'
      ? '<b>Total-only games</b> count toward your average and high games, but not strike %, spare %, splits or leaves.'
      : '<b>Running totals</b> count toward your average. If the totals only fit one ball-by-ball game (a 300, say), BowlBoard works the frames out and they count for strike and spare stats too. Otherwise they don’t.') + '</div>';
  }
  h += '<h2 class="screen-title">' + (cont ? 'This game' : 'Where and what') + '</h2><div class="card">';
  if (!cont) {
    h += '<label class="field">Date<input type="date" id="ngDate" value="' + esc(s.date) + '"></label>';
    h += '<label class="field">Bowling center<select id="ngCenter">' + centerOptions(s.centerId, true) + '</select></label>';
    h += '<div id="ngNewCenter"' + (s.centerId === '__new' ? '' : ' hidden') + ' class="new-center"><div class="small muted">Add this house — it’s saved for next time.</div>' +
      '<div class="grid2"><label class="field">Center name<input type="text" id="ngCName" placeholder="e.g. Parkside Lanes" value="' + esc(s.newCenterName || '') + '"></label>' +
      '<label class="field">City<input type="text" id="ngCCity" placeholder="optional" value="' + esc(s.newCenterCity || '') + '"></label></div></div>';
  }
  h += lanesFields('ngLane', s.lanes, !!s.leagueId);
  h += '<label class="field">Oil pattern<input type="text" id="ngPattern" list="patternList" placeholder="House shot" value="' + esc(s.pattern) + '"></label>' + patternList();
  h += '<label class="field">Ball for game ' + s.gameNo + '<select id="ngBall">' + ballOptions(s.ballId) + '</select></label>';
  if (!cont) h += '<label class="field">Type<select id="ngLeague">' + leagueOptions(s.leagueId) + '</select></label><div id="ngWeek">' + (s.leagueId ? leagueWeekHint(s.leagueId, s.date) : '') + '</div>';
  h += '</div>';
  h += '<button class="btn" id="ngStart">Start game ' + s.gameNo + ' →</button>';
  screenRoot().innerHTML = h;
  on('ngDate', 'change', e => { s.date = e.target.value; const w = el('ngWeek'); if (w) w.innerHTML = s.leagueId ? leagueWeekHint(s.leagueId, s.date) : ''; });
  on('ngCenter', 'change', e => { s.centerId = e.target.value; el('ngNewCenter').hidden = s.centerId !== '__new'; if (s.centerId === '__new') el('ngCName').focus(); });
  on('ngCName', 'input', e => { s.newCenterName = e.target.value; });
  on('ngCCity', 'input', e => { s.newCenterCity = e.target.value; });
  on('ngBall', 'change', e => { s.ballId = e.target.value; });
  bindLanes('ngLane', l => { s.lanes = l; });
  on('ngPattern', 'input', e => { s.pattern = e.target.value.trim(); });
  on('ngLeague', 'change', e => {
    s.leagueId = e.target.value;
    const l = Store.getLeague(s.leagueId);
    if (l && l.centerId && Store.state.centers.some(c => c.id === l.centerId)) s.centerId = l.centerId;
    RENDER.new();
  });
  on('ngFresh', 'click', () => { newSetup = Object.assign(defaultSetup(), { mode: s.mode }); RENDER.new(); });
  on('ngStart', 'click', () => {
    if (!s.date) { toast('Pick a date'); return; }
    if (s.centerId === '__new' || !s.centerId) {
      const name = (s.newCenterName || '').trim();
      if (!name) { toast('Name the bowling center'); const n = el('ngCName'); if (n) n.focus(); return; }
      s.centerId = Store.addCenter(name, (s.newCenterCity || '').trim()).id;
    }
    s.lanes = readLanes('ngLane');
    startGame(Object.assign({}, s));
    newSetup = null;
  });
};
ACT.new = { mode: a => { newSetup.mode = a.dataset.mode; RENDER.new(); } };

function startGame(setup) {
  if (!setup.seriesId) { setup.seriesId = Store.uid(); setup.gameNo = 1; }
  BB.entry = { setup, game: S.newGame(), sel: new Set() };
  if (setup.mode === 'photo') { BB.resetPhoto(setup); show('photo'); }
  else show('entry');
}
function gameBase(setup) {
  return {
    id: Store.uid(), date: setup.date, centerId: setup.centerId, ballId: setup.ballId || '',
    lanes: (setup.lanes || []).slice(), pattern: setup.pattern || '', leagueId: setup.leagueId || '',
    seriesId: setup.seriesId, gameNo: setup.gameNo, mode: setup.mode,
  };
}
function saveGame(g) {
  Store.addGame(g);
  BB.entry = null;
  show('saved', { id: g.id });
}

/* ---------- personal -> league: send a series to the league sheet ---------- */
function linkStatusHTML(g) {
  const l = g.leagueId && Store.getLeague(g.leagueId);
  if (!l) return '';
  const link = LG.findLink(l, g.id);
  if (!link) return '';
  return '<div class="link-card link-ok">' + icon('link') + '<div><b>Your game · linked</b><div class="small">On the ' + esc(l.name) + ' sheet · week ' + link.week + ', game ' + link.game + '. Changes to this game update the league score.</div></div></div>';
}
function sendSeriesSheet(seriesId, leagueId, after) {
  const l = Store.getLeague(leagueId);
  if (!l) return;
  if (!LG.me(l)) { BB.askMe(l, () => sendSeriesSheet(seriesId, leagueId, after), true); return; }
  const games = Store.seriesGames(seriesId).filter(g => g.total != null);
  const guess = LG.weekForDate(l, games[0] && games[0].date) || LG.currentWeek(l);
  const G = l.gamesPerNight;
  const weekOpts = Array.from({ length: l.seasonWeeks }, (_, i) => i + 1).map(w => '<option value="' + w + '"' + (w === guess ? ' selected' : '') + '>Week ' + w + (LG.weekDate(l, w) ? ' · ' + fmtDate(LG.weekDate(l, w), { month: 'short', day: 'numeric' }) : '') + '</option>').join('');
  openSheet('<h3>Send to ' + esc(l.name) + '</h3>' +
    '<p class="small muted mt0">Puts your games on the league score sheet as <b>' + esc(LG.me(l).name) + '</b>, linked to your log. If you edit a game later, the sheet follows. If the secretary changes a score on the sheet, theirs stands.</p>' +
    '<label class="field">League week<select id="sendWeek">' + weekOpts + '</select></label>' +
    '<div class="send-preview" id="sendPreview"></div>' +
    (games.length > G ? '<p class="small warn">This league bowls ' + G + ' games a night — games 1–' + G + ' are sent.</p>' : '') +
    '<button class="btn" id="sendGo">Send ' + plural(Math.min(G, games.length), 'game') + '</button>', sh => {
    const preview = () => {
      const w = +val('sendWeek');
      const slot = LG.myLineSlot(l, w);
      const box = sh.querySelector('#sendPreview');
      const btn = sh.querySelector('#sendGo');
      if (!slot.ok) { box.innerHTML = '<div class="warn small">' + esc(slot.error) + '</div>'; btn.disabled = true; return; }
      const prior = slot.line && (slot.line.games || []).some(x => x != null) && !(slot.line.links || []).some(Boolean);
      box.innerHTML = '<div class="small">' + esc(LG.teamName(l, slot.teamId)) + ' · ' + games.slice(0, G).map(g => g.total).join(' · ') + '</div>' +
        (prior ? '<div class="small warn">Week ' + w + ' already has scores for you (' + slot.line.games.filter(x => x != null).join(' · ') + '). Sending replaces them.</div>' : '');
      btn.disabled = false;
    };
    sh.querySelector('#sendWeek').addEventListener('change', preview);
    preview();
    sh.querySelector('#sendGo').addEventListener('click', () => {
      const w = +val('sendWeek');
      const r = LG.pushMyGames(l, w, games.slice(0, G).map(g => ({ gameId: g.id, total: g.total })));
      if (!r.ok) { toast(r.error, 4000); return; }
      Store.markLeagueEdit(l); Store.save(); closeSheet();
      toast('Sent to ' + l.name + ', week ' + w + ' · linked');
      if (after) after(); else rerender();
    });
  });
}

/* ---------- saved: keep the series going ---------- */
RENDER.saved = function (p) {
  const g = Store.getGame(p.id);
  if (!g) { show('home'); return; }
  const sr = Store.seriesGames(g.seriesId);
  const tot = scoredGames(sr).reduce((a, x) => a + x.total, 0);
  let h = '<div class="card saved-card"><div class="muted small">Game ' + g.gameNo + ' saved</div><div class="big-score">' + (g.total == null ? '—' : g.total) + '</div>';
  if (g.frames) h += scorecardHTML({ frames: g.frames.map(S.normFrame) }, -1, { id: 'savedCard' });
  if (sr.length > 1) {
    h += '<div class="series-line">' + sr.map(x => '<span class="' + (x.id === g.id ? 'hl' : '') + '">' + (x.total == null ? '—' : x.total) + '</span>').join('<i>·</i>') + '</div>' +
      '<div class="muted small">Series ' + tot + ' · ' + sr.length + ' games</div>';
  }
  h += '</div>';
  const l = g.leagueId && Store.getLeague(g.leagueId);
  if (l) {
    const linked = sr.filter(x => LG.findLink(l, x.id)).length;
    h += '<div class="card league-send"><div class="small"><b>' + esc(l.name) + '</b></div>' +
      (linked ? '<div class="link-ok">' + icon('link') + ' ' + linked + ' of ' + sr.length + ' games are on the league sheet, linked' + (linked < sr.length && sr.length <= l.gamesPerNight ? ' — send again to add the new one' : '') + '.</div>' : '<div class="small muted">Put this series on the league sheet so nobody types it twice.</div>') +
      ((linked < Math.min(sr.length, l.gamesPerNight)) ? '<button class="btn secondary mt8" id="sendLeague">' + icon('link') + 'Send series to league sheet</button>' : '') + '</div>';
  }
  h += '<button class="btn" id="nextGameBtn">Bowl game ' + (sr.length + 1) + ' →</button>';
  h += '<div class="row mt8"><button class="btn secondary grow" id="viewGameBtn">View game</button><button class="btn secondary grow" id="doneBtn">Done for today</button></div>';
  screenRoot().innerHTML = h;
  on('sendLeague', 'click', () => sendSeriesSheet(g.seriesId, g.leagueId));
  on('nextGameBtn', 'click', () => continueSeries(g));
  on('viewGameBtn', 'click', () => show('game', { id: g.id }));
  on('doneBtn', 'click', () => show('history'));
};

Object.assign(BB, { newGame, continueSeries, startGame, gameBase, saveGame, linkStatusHTML, sendSeriesSheet, entry: null });
})();
