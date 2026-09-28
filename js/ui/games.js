/* BowlBoard — History (every series, filterable) and a game's page: scorecard,
 * league link, photo, details, edits. */
(function () {
'use strict';
const BB = window.BB;
const S = window.BBScore, Store = window.BBStore, LG = window.BBLeague, Scan = window.BBScan, I = window.BBInsights;
const { RENDER, esc, fmtDate, todayISO, icon, el, on, val, show, toast, ask, openSheet, closeSheet, screenRoot, rerender, backLink,
  MODE_LABEL, laneLabel, leagueName, scoredGames, sheetGames, myGames, getAnyGame, scorecardHTML, centerOptions, ballOptions, leagueOptions,
  patternList, lanesFields, readLanes, bindLanes, seriesCardHTML, frameEditor } = BB;

/* ---------- filters (shared with Stats) ---------- */
const RANGES = [['all', 'All time'], ['season', 'This season'], ['d7', 'Last 7 days'], ['d30', 'Last 30 days'], ['d90', 'Last 90 days'], ['y365', 'Last year']];
function inRange(dateISO, preset) {
  if (preset === 'all') return true;
  if (preset === 'season') return I.seasonOf(dateISO) === I.seasonOf(todayISO());
  const days = { d7: 7, d30: 30, d90: 90, y365: 365 }[preset] || 0;
  const cut = new Date(); cut.setHours(0, 0, 0, 0); cut.setDate(cut.getDate() - days);
  return new Date(dateISO + 'T12:00:00') >= cut;
}
function typeMatch(g, type) {
  if (!type) return true;
  if (type === '__practice') return !g.leagueId;
  if (type === '__league') return !!g.leagueId;
  return g.leagueId === type;
}
function typeOptions(sel) {
  return [['', 'Practice + league'], ['__practice', 'Practice only'], ['__league', 'League nights']].concat(Store.state.leagues.map(l => [l.id, l.name]))
    .map(o => '<option value="' + esc(o[0]) + '"' + (sel === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('');
}
const rangeOptions = sel => RANGES.map(o => '<option value="' + o[0] + '"' + (sel === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('');

/* ---------- history ---------- */
const histFilter = { preset: 'all', center: '', ball: '', type: '' };
RENDER.history = function () {
  const root = screenRoot();
  let h = '<h2 class="screen-title">History</h2><div class="filters">';
  h += '<select id="hfPreset" aria-label="Date range">' + rangeOptions(histFilter.preset) + '</select>';
  h += '<select id="hfType" aria-label="Practice or league">' + typeOptions(histFilter.type) + '</select>';
  h += '<select id="hfCenter" aria-label="Center"><option value="">All centers</option>' +
    Store.state.centers.map(a => '<option value="' + a.id + '"' + (histFilter.center === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>').join('') + '</select>';
  h += '<select id="hfBall" aria-label="Ball"><option value="">All balls</option><option value="__house"' + (histFilter.ball === '__house' ? ' selected' : '') + '>House ball</option>' +
    Store.state.balls.map(b => '<option value="' + b.id + '"' + (histFilter.ball === b.id ? ' selected' : '') + '>' + esc(b.brand + ' ' + b.name) + '</option>').join('') + '</select>';
  h += '</div><div id="histList">';
  const games = myGames().filter(g => inRange(g.date, histFilter.preset) && typeMatch(g, histFilter.type) &&
    (!histFilter.center || g.centerId === histFilter.center) &&
    (!histFilter.ball || (!g.sheet && (histFilter.ball === '__house' ? !g.ballId : g.ballId === histFilter.ball))));
  const series = Store.allSeries(games);
  h += series.length ? series.map(seriesCardHTML).join('') : '<div class="empty">' + (myGames().length ? 'No games match these filters.' : 'No games yet.') + '</div>';
  h += '</div>';
  root.innerHTML = h;
  on('hfPreset', 'change', e => { histFilter.preset = e.target.value; RENDER.history(); });
  on('hfType', 'change', e => { histFilter.type = e.target.value; RENDER.history(); });
  on('hfCenter', 'change', e => { histFilter.center = e.target.value; RENDER.history(); });
  on('hfBall', 'change', e => { histFilter.ball = e.target.value; RENDER.history(); });
};

/* ---------- game detail + edit ---------- */
RENDER.game = function (p) {
  const g = getAnyGame(p.id);
  const root = screenRoot();
  if (!g) { show('history'); return; }
  if (g.sheet) return renderSheetGame(root, g);
  const sr = Store.seriesGames(g.seriesId);
  let h = backLink('history', 'History');
  h += '<h2 class="screen-title">Game ' + g.gameNo + (sr.length > 1 ? ' of ' + sr.length : '') + ' <span class="muted small">· ' + fmtDate(g.date) + '</span></h2>';
  if (sr.length > 1) {
    h += '<div class="chips mb8">' + sr.map(x => '<button class="chip' + (x.id === g.id ? ' sel' : '') + '" data-act="game" data-id="' + esc(x.id) + '"' + (x.id === g.id ? ' aria-current="true"' : '') + '>G' + x.gameNo + ' · ' + (x.total == null ? '—' : x.total) + '</button>').join('') +
      '<span class="chip ghost">Series ' + scoredGames(sr).reduce((a, x) => a + x.total, 0) + '</span></div>';
  }
  h += '<div class="card detail-score"><div class="big-score">' + (g.total == null ? '—' : g.total) + '</div>';
  if (g.frames) {
    const game = { frames: g.frames.map(S.normFrame) };
    h += scorecardHTML(game, -1);
    const st = S.pinStats([game]);
    h += '<div class="mini-stats"><span><b>' + st.strikes + '</b> strikes</span><span><b>' + st.spares + '/' + st.spareOpps + '</b> spares</span><span><b>' + st.openFrames + '</b> open</span>' +
      (st.splitOpps ? '<span><b>' + st.splitsMade + '/' + st.splitOpps + '</b> splits</span>' : '') + (st.fouls ? '<span><b>' + st.fouls + '</b> fouls</span>' : '') + '</div>';
    if (g.framesDerived) h += '<div class="small muted mt8">Frames worked out from the running totals (only one game fits them).</div>';
  } else if (g.cumulative) {
    h += '<div class="cum-row">' + g.cumulative.map((c, i) => '<div><small>F' + (i + 1) + '</small><b>' + c + '</b></div>').join('') + '</div>' +
      '<div class="small muted mt8">Running totals only — this game counts toward your average, not strike or spare stats.</div>';
  } else {
    h += '<div class="small muted">Total only — counts toward your average, not strike or spare stats.</div>';
  }
  h += '</div>';
  h += BB.linkStatusHTML(g);
  if (g.photoId || g.thumb) h += '<img class="photo-preview small" id="gamePhoto" alt="lane screen photo"' + (g.thumb && Store.safeImage(g.thumb) ? ' src="' + Store.safeImage(g.thumb) + '"' : ' hidden') + '>';
  h += '<div class="card"><table class="kv">' +
    '<tr><td>Center</td><td>' + esc(Store.centerName(g.centerId)) + '</td></tr>' +
    (laneLabel(g) ? '<tr><td>Lanes</td><td>' + esc(laneLabel(g).replace(/^Lanes? /, '')) + '</td></tr>' : '') +
    (g.pattern ? '<tr><td>Oil pattern</td><td>' + esc(g.pattern) + '</td></tr>' : '') +
    '<tr><td>Ball</td><td>' + (g.ballId && Store.state.balls.some(b => b.id === g.ballId) ? '<button class="link-btn inline" data-act="ball" data-id="' + esc(g.ballId) + '">' + esc(Store.ballLabel(g.ballId)) + ' ›</button>' : esc(Store.ballLabel(g.ballId))) + '</td></tr>' +
    '<tr><td>Type</td><td>' + (g.leagueId ? esc(leagueName(g.leagueId) || 'League') : 'Practice / open play') + '</td></tr>' +
    '<tr><td>Entered as</td><td>' + (MODE_LABEL[g.mode] || g.mode) + (g.updatedAt ? ' · edited' : '') + '</td></tr></table></div>';
  const l = g.leagueId && Store.getLeague(g.leagueId);
  if (l && !LG.findLink(l, g.id)) h += '<button class="btn secondary mb8" id="sendLeague2">' + icon('link') + 'Send series to ' + esc(l.name) + ' sheet</button>';
  h += '<div class="row"><button class="btn secondary grow" id="editDetailsBtn">Edit details</button><button class="btn secondary grow" id="editScoreBtn">Edit score</button></div>';
  h += '<div class="row mt8"><button class="btn secondary grow" id="addGameBtn">+ Add game to series</button><button class="btn danger" id="delGameBtn">Delete</button></div>';
  root.innerHTML = h;
  if (g.photoId) Store.photos.get(g.photoId).then(src => { const im = el('gamePhoto'); if (im && src && BB.nav.params.id === g.id) { im.src = src; im.hidden = false; } });
  on('sendLeague2', 'click', () => BB.sendSeriesSheet(g.seriesId, g.leagueId));
  on('editDetailsBtn', 'click', () => editDetailsSheet(g));
  on('editScoreBtn', 'click', () => editScore(g));
  on('addGameBtn', 'click', () => BB.continueSeries(sr[sr.length - 1]));
  on('delGameBtn', 'click', async () => {
    const linked = l && LG.findLink(l, g.id);
    if (!(await ask('Delete this game? This can’t be undone.' + (linked ? ' Its score stays on the league sheet.' : ''), 'Delete', true))) return;
    Store.deleteGame(g.id);
    toast('Game deleted');
    const rest = Store.seriesGames(g.seriesId);
    show(rest.length ? 'game' : 'history', rest.length ? { id: rest[0].id } : undefined);
  });
};
// League-sheet game (entered by the secretary, not in your log): read-only here.
function renderSheetGame(root, g) {
  const l = Store.getLeague(g.leagueId);
  const all = sheetGames().filter(x => x.seriesId === g.seriesId);
  let h = backLink('history', 'History');
  h += '<h2 class="screen-title">Game ' + g.gameNo + ' of ' + all.length + ' <span class="muted small">· ' + fmtDate(g.date) + '</span></h2>';
  h += '<div class="chips mb8">' + all.map(x => '<button class="chip' + (x.id === g.id ? ' sel' : '') + '" data-act="game" data-id="' + esc(x.id) + '">G' + x.gameNo + ' · ' + x.total + '</button>').join('') + '</div>';
  h += '<div class="card detail-score"><div class="big-score">' + g.total + '</div><div class="small muted">From the ' + esc(l ? l.name : 'league') + ' score sheet, week ' + g.week + '. It counts toward your average here, but frames weren’t recorded.</div></div>';
  h += '<button class="btn secondary" data-act="league" data-id="' + esc(g.leagueId) + '" data-tab="scores" data-week="' + g.week + '">Open the league sheet</button>';
  root.innerHTML = h;
}

function editDetailsSheet(g) {
  const multi = Store.seriesGames(g.seriesId).length > 1;
  openSheet('<h3>Edit details</h3>' +
    '<label class="field">Date<input type="date" id="edDate" value="' + esc(g.date) + '"></label>' +
    '<label class="field">Bowling center<select id="edCenter">' + centerOptions(g.centerId) + '</select></label>' +
    lanesFields('edLane', g.lanes) +
    '<label class="field">Oil pattern<input type="text" id="edPattern" list="patternList" value="' + esc(g.pattern || '') + '"></label>' + patternList() +
    '<label class="field">Ball (this game)<select id="edBall">' + ballOptions(g.ballId) + '</select></label>' +
    '<label class="field">Type<select id="edLeague">' + leagueOptions(g.leagueId) + '</select></label>' +
    (multi ? '<label class="check"><input type="checkbox" id="edAll" checked> Apply date, center, lanes and type to the whole series</label>' : '') +
    '<button class="btn" id="edSave">Save changes</button>', sh => {
    bindLanes('edLane');
    sh.querySelector('#edSave').addEventListener('click', () => {
      const shared = { date: val('edDate'), centerId: val('edCenter'), leagueId: val('edLeague'), lanes: readLanes('edLane') };
      if (!shared.date) { toast('Pick a date'); return; }
      Store.updateGame(g.id, Object.assign({ pattern: val('edPattern').trim(), ballId: val('edBall') }, shared));
      const all = sh.querySelector('#edAll');
      if (all && all.checked) Store.seriesGames(g.seriesId).forEach(x => { if (x.id !== g.id) Store.updateGame(x.id, shared); });
      closeSheet(); toast('Saved'); rerender();
    });
  });
}

function editScore(g) {
  if (g.frames && !g.framesDerived) {
    const orig = g.frames.map(S.normFrame);
    const D = Scan.fromFrames(orig);
    openSheet('<h3>Edit score</h3><p class="small muted mt0">Tap a frame, then its marks. Balls you don’t change keep their pin detail.</p>' +
      '<div id="egEd"></div><div class="scan-status" id="egStatus" aria-live="polite"></div><button class="btn" id="egSave">Save score</button>', sh => {
      let last = null;
      const status = r => {
        last = r;
        const ok = r.ok && r.complete;
        const st = sh.querySelector('#egStatus'), btn = sh.querySelector('#egSave');
        st.textContent = !r.ok ? r.error : !r.complete ? 'Keep going — fill every frame.' : 'Total: ' + r.total;
        st.className = 'scan-status' + (ok ? ' good' : '');
        btn.disabled = !ok; btn.textContent = ok ? 'Save score — ' + r.total : 'Save score';
      };
      frameEditor(sh.querySelector('#egEd'), D, { prefix: 'eg', status });
      sh.querySelector('#egSave').addEventListener('click', () => {
        if (!last || !last.ok || !last.complete) return;
        // keep pin detail for balls that didn't change (validateFrames drops any that no longer fit)
        const frames = D.balls.map((b, i) => {
          const o = orig[i];
          let same = true;
          return { balls: b.slice(), fouls: b.map((v, j) => !!D.fouls[i][j]), pins: b.map((v, j) => { same = same && o.balls[j] === v && !!o.fouls[j] === !!D.fouls[i][j]; return same ? o.pins[j] : null; }) };
        });
        const v = S.validateFrames(frames);
        if (!v.ok) { toast(v.error); return; }
        Store.updateGame(g.id, { frames: v.game.frames, total: S.computeScore(v.game).total });
        closeSheet(); toast('Score updated'); rerender();
      });
    });
  } else if (g.cumulative) {
    const tgt = { cum: g.cumulative.map(String) };
    openSheet('<div id="egCum"></div>', sh => {
      BB.renderRunningTotals(sh.querySelector('#egCum'), { target: tgt, prefix: 'egc', title: '<h3>Edit running totals</h3>', onSave: data => {
        Store.updateGame(g.id, data); closeSheet(); toast('Score updated'); rerender();
      } });
    });
  } else {
    openSheet('<h3>Edit score</h3><label class="field">Final score<input type="number" inputmode="numeric" id="egTotal" min="0" max="300" value="' + esc(g.total) + '"></label><button class="btn" id="egSave">Save score</button>', sh => {
      sh.querySelector('#egSave').addEventListener('click', () => {
        const t = parseInt(val('egTotal'), 10);
        if (isNaN(t) || t < 0 || t > 300) { toast('Enter a score from 0 to 300'); return; }
        Store.updateGame(g.id, { total: t }); closeSheet(); toast('Score updated'); rerender();
      });
    });
  }
}

Object.assign(BB, { RANGES, inRange, typeMatch, typeOptions, rangeOptions });
})();
