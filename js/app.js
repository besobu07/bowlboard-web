/* BowlBoard prototype app — player side: nav, home, game setup, scoring, series,
 * game detail/edit, photo import, history, stats, centers, arsenal, backup.
 * League admin screens live in js/league-ui.js and share helpers through window.BB.
 *
 * Structure: each screen renders into its own <section> root. Element lookups are
 * scoped to that root (or the open sheet), so an id only has to be unique within
 * one screen. Clicks on [data-act] elements are handled by one delegated listener
 * per app, dispatched to the active screen's ACT table.
 */
(function () {
'use strict';
const S = window.BBScore, Store = window.BBStore, Data = window.BBData, LG = window.BBLeague, Sample = window.BBSample;
const $ = s => document.querySelector(s);
// Set by the build script: embedded = hosted preview (no downloads/print/share), seed = sample data on first run.
const BUILD = window.BB_BUILD || {};
const EMBED = !!BUILD.embedded;

/* ---------- helpers ---------- */
function toast(msg, ms) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), ms || 2400);
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(iso, opts) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  return isNaN(d) ? iso : d.toLocaleDateString(undefined, opts || { month: 'short', day: 'numeric', year: 'numeric' });
}
function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
// Scoped lookups: the open sheet first, then the active screen.
const sheetRoot = () => { const w = $('#sheet'); return w && !w.hidden ? w.querySelector('.sheet') : null; };
const screenRoot = () => document.getElementById('screen-' + nav.current);
function el(id) {
  const sh = sheetRoot();
  return (sh && sh.querySelector('#' + id)) || (screenRoot() && screenRoot().querySelector('#' + id)) || null;
}
function on(id, ev, fn) { const e = el(id); if (e) e.addEventListener(ev, fn); }
const val = id => { const e = el(id); return e ? e.value : ''; };
// League convention: averages are truncated, never rounded up.
const avgFloor = arr => (arr.length ? Math.floor(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
const pct = (n, d) => (d ? Math.round(100 * n / d) + '%' : '—');
const MODE_LABEL = { pins: 'Pin by pin', frames: 'Running totals', total: 'Total only', photo: 'Photo (checked by hand)', sheet: 'League sheet' };
const laneLabel = g => (g.lanes && g.lanes.length ? (g.lanes.length > 1 ? 'Lanes ' + g.lanes.join('-') : 'Lane ' + g.lanes[0]) : (g.laneNote || ''));

function download(filename, text, mime) {
  if (EMBED) { textSheet(filename, text); return false; }
  const blob = new Blob([text], { type: mime || 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  return true;
}
// Where files can't be saved (hosted preview), show the contents with a Copy button instead.
function textSheet(filename, text) {
  openSheet('<h3>' + esc(filename) + '</h3><p class="small muted mt0">Saving files isn’t available here. Copy this and paste it into a file, a spreadsheet or an email.</p>' +
    '<textarea id="tsText" rows="10" readonly>' + esc(text) + '</textarea><button class="btn mt8" id="tsCopy">Copy</button>', sh => {
    sh.querySelector('#tsCopy').addEventListener('click', async () => {
      const ok = await copyText(text);
      if (!ok) { const ta = sh.querySelector('#tsText'); ta.focus(); ta.select(); }
      toast(ok ? 'Copied' : 'Selected — press copy on your keyboard');
    });
  });
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { /* ignore */ }
    ta.remove(); return ok;
  }
}
// Copies formatted HTML so it pastes as a table into Gmail / Outlook, with plain text fallback.
async function copyRich(html, text) {
  try {
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })]);
      return true;
    }
  } catch (e) { /* fall through */ }
  const div = document.createElement('div');
  div.innerHTML = html;
  div.style.cssText = 'position:fixed;left:-9999px;top:0;background:#fff';
  document.body.appendChild(div);
  const r = document.createRange(); r.selectNodeContents(div);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  let ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
  sel.removeAllRanges(); div.remove();
  return ok || copyText(text);
}

/* ---------- bottom sheet (modal: background inert, focus trapped, Esc closes) ---------- */
let sheetTimer = null, sheetOnClose = null, sheetReturnFocus = null;
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
function openSheet(html, bind, onClose) {
  const wrap = $('#sheet'), sh = wrap.querySelector('.sheet');
  clearTimeout(sheetTimer);
  if (sheetOnClose) { const f = sheetOnClose; sheetOnClose = null; f(); }
  sheetOnClose = onClose || null;
  if (wrap.hidden) sheetReturnFocus = document.activeElement;
  sh.innerHTML = '<button class="sheet-x" aria-label="Close" data-close>✕</button>' + html;
  const title = sh.querySelector('h3');
  if (title) { title.id = 'sheetTitle'; sh.setAttribute('aria-labelledby', 'sheetTitle'); } else sh.removeAttribute('aria-labelledby');
  wrap.hidden = false;
  $('.app').inert = true;
  requestAnimationFrame(() => wrap.classList.add('open'));
  sh.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeSheet()));
  if (bind) bind(sh);
  // Desktop: straight to the first field. Phones: focus the sheet itself so the keyboard doesn't jump up.
  const first = Array.from(sh.querySelectorAll('input,select,textarea')).find(x => !x.hidden);
  if (first && window.innerWidth > 700) first.focus();
  else { sh.tabIndex = -1; sh.focus({ preventScroll: true }); }
}
function closeSheet() {
  const wrap = $('#sheet');
  if (sheetOnClose) { const f = sheetOnClose; sheetOnClose = null; f(); }
  wrap.classList.remove('open');
  $('.app').inert = false;
  clearTimeout(sheetTimer);
  sheetTimer = setTimeout(() => { wrap.hidden = true; wrap.querySelector('.sheet').innerHTML = ''; }, 180);
  const back = sheetReturnFocus;
  sheetReturnFocus = null;
  if (back && document.contains(back) && back.focus) back.focus({ preventScroll: true });
}
document.addEventListener('keydown', e => {
  const sh = sheetRoot();
  if (!sh) return;
  if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
  if (e.key !== 'Tab') return;
  const items = Array.from(sh.querySelectorAll(FOCUSABLE)).filter(x => x.offsetParent !== null || x === document.activeElement);
  if (!items.length) { e.preventDefault(); return; }
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === sh)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  else if (!sh.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
});
// In-app confirm: the browser's built-in dialog is ugly on phones and blocked in embedded previews.
function ask(message, okLabel, danger) {
  return new Promise(resolve => {
    let answered = false;
    openSheet('<h3>' + esc(message) + '</h3><div class="row mt12"><button class="btn secondary grow" data-close>Cancel</button>' +
      '<button class="btn grow' + (danger ? ' btn-danger-solid' : '') + '" id="askOk">' + esc(okLabel || 'OK') + '</button></div>', sh => {
      sh.querySelector('#askOk').addEventListener('click', () => { answered = true; sheetOnClose = null; closeSheet(); resolve(true); });
    }, () => { if (!answered) resolve(false); });
  });
}
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });

/* ---------- navigation + delegated actions ---------- */
const RENDER = {};
const ACT = {}; // ACT[screen][action](el, event)
const TAB_OF = { new: 'home', entry: 'home', photo: 'home', saved: 'home', game: 'history', matchup: 'league', centers: 'more', balls: 'more', backup: 'more' };
const nav = { current: 'home', params: {} };
function show(name, params) {
  Store.flush();
  nav.current = name;
  nav.params = params || {};
  // Every visit redraws from state, so a screen's old DOM is stale once you leave it: drop it.
  // (Lookups are scoped to the active screen, so nothing relies on this for correctness.)
  document.querySelectorAll('.screen').forEach(s => {
    const on_ = s.id === 'screen-' + name;
    if (!on_ && s.classList.contains('active')) s.innerHTML = '';
    s.classList.toggle('active', on_);
  });
  const tab = TAB_OF[name] || name;
  document.querySelectorAll('.tabbar button').forEach(b => {
    const on_ = b.dataset.nav === tab;
    b.classList.toggle('active', on_);
    if (on_) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  (RENDER[name] || (() => {}))(nav.params);
  window.scrollTo(0, 0);
}
function rerender() { (RENDER[nav.current] || (() => {}))(nav.params); }
document.querySelectorAll('.tabbar button').forEach(b => b.addEventListener('click', () => show(b.dataset.nav)));
const backLink = (target, label, params) => '<button class="back-link" data-back="' + target + '"' + (params ? " data-back-params='" + esc(JSON.stringify(params)) + "'" : '') + '>‹ ' + esc(label) + '</button>';
document.addEventListener('click', e => {
  const b = e.target.closest('[data-back]');
  if (b) { show(b.dataset.back, b.dataset.backParams ? JSON.parse(b.dataset.backParams) : undefined); return; }
  const a = e.target.closest('[data-act]');
  if (!a || !screenRoot() || !screenRoot().contains(a)) return;
  const table = ACT[nav.current] || {};
  const fn = table[a.dataset.act] || ACT._global[a.dataset.act];
  if (fn) fn(a, e);
});
ACT._global = {
  game: a => show('game', { id: a.dataset.id }),
  series: (a, e) => { if (!e.target.closest('[data-act="game"]')) show('game', { id: a.dataset.first }); },
  league: a => show('league', { id: a.dataset.id, tab: a.dataset.tab || 'standings', week: a.dataset.week ? +a.dataset.week : undefined }),
  go: a => show(a.dataset.to),
};

Store.onSaveError = () => toast('Could not save — phone storage is full or blocked. Download a backup from More.', 5000);
try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* a request, not a guarantee */ }

/* ---------- my games = my own log + league-sheet scores that aren't linked to it ---------- */
function sheetGames() {
  return Store.state.leagues.reduce((all, l) => all.concat(LG.sheetOnlyGames(l)), []);
}
function myGames() { return Store.state.games.concat(sheetGames()); }
function getAnyGame(id) {
  if (!String(id).startsWith('sheet:')) return Store.getGame(id);
  return sheetGames().find(g => g.id === id) || null;
}

/* ---------- shared renderers ---------- */
function frameGridHTML(game, cur) {
  const sc = S.computeScore(game);
  let h = '<div class="frames" id="frameGrid">';
  for (let i = 0; i < 10; i++) {
    const nB = i < 9 ? 2 : 3;
    let balls = '';
    for (let j = 0; j < nB; j++) {
      const m = sc.marks[i][j] || '';
      balls += '<span class="' + (sc.splits[i][j] ? 'split' : '') + (m === 'F' ? ' foul' : '') + '">' + esc(m) + '</span>';
    }
    const cum = sc.cumulative[i];
    const cell = cum != null ? cum : (sc.pending[i] ? '<i class="pend" title="Waiting on bonus balls">…</i>' : '');
    h += '<div class="frame' + (cur === i ? ' cur' : '') + '"><div class="fnum">' + (i + 1) + '</div>' +
      '<div class="balls">' + balls + '</div><div class="cum">' + cell + '</div></div>';
  }
  return h + '</div>';
}
function pendingNote(game) {
  const sc = S.computeScore(game);
  const i = sc.pending.indexOf(true);
  if (i < 0) return '';
  const strike = i < 9 ? game.frames[i].balls[0] === 10 : false;
  return '<span class="pending-note">+ ' + (strike ? 'strike' : 'spare') + ' bonus pending</span>';
}
function centerOptions(sel, withNew) {
  return Store.state.centers.map(a => '<option value="' + a.id + '"' + (a.id === sel ? ' selected' : '') + '>' + esc(a.name + (a.city ? ' — ' + a.city : '')) + '</option>').join('') +
    (withNew ? '<option value="__new"' + (sel === '__new' ? ' selected' : '') + '>+ Add a new center…</option>' : '');
}
function ballOptions(sel) {
  return '<option value="">House ball / none</option>' + Store.state.balls.map(b => '<option value="' + b.id + '"' + (b.id === sel ? ' selected' : '') + '>' + esc(b.brand + ' ' + b.name + (b.weight ? ' · ' + b.weight + ' lb' : '')) + '</option>').join('');
}
function leagueOptions(sel) {
  return '<option value="">Practice / open play</option>' + Store.state.leagues.map(l => '<option value="' + l.id + '"' + (l.id === sel ? ' selected' : '') + '>' + esc(l.name) + '</option>').join('');
}
function patternList() {
  return '<datalist id="patternList">' + Data.OIL_PATTERNS.map(p => '<option value="' + esc(p) + '">').join('') + '</datalist>';
}
// Lane is optional. Open bowling is usually one lane; leagues bowl a pair, so the
// second box opens by default for league games (or when a pair was saved before).
function lanesFields(prefix, lanes, pairByDefault) {
  lanes = lanes || [];
  const pair = lanes.length > 1 || (!lanes.length && !!pairByDefault);
  return '<fieldset class="lanes-fs"><legend>Lane <span class="opt">(optional)</span></legend><div class="lane-pair">' +
    '<input type="number" inputmode="numeric" min="1" max="120" id="' + prefix + 'L" aria-label="Lane" placeholder="15" value="' + (lanes[0] || '') + '">' +
    '<span class="lane-amp" id="' + prefix + 'Amp" aria-hidden="true"' + (pair ? '' : ' hidden') + '>&amp;</span>' +
    '<input type="number" inputmode="numeric" min="1" max="120" id="' + prefix + 'R" aria-label="Second lane" placeholder="16" value="' + (lanes[1] || '') + '"' + (pair ? '' : ' hidden') + '>' +
    '<button type="button" class="link-btn lane-toggle" id="' + prefix + 'Pair" aria-expanded="' + pair + '">' + (pair ? 'One lane' : '+ Second lane') + '</button>' +
    '</div></fieldset>';
}
function readLanes(prefix) {
  const r = el(prefix + 'R');
  const l = parseInt(val(prefix + 'L'), 10), rr = r && !r.hidden ? parseInt(r.value, 10) : NaN;
  return [l, rr].filter(n => Number.isInteger(n) && n > 0 && n <= 120);
}
function bindLanes(prefix, onChange) {
  const changed = () => onChange && onChange(readLanes(prefix));
  on(prefix + 'L', 'input', () => {
    const l = parseInt(val(prefix + 'L'), 10), r = el(prefix + 'R');
    if (r && !r.hidden && !r.value && Number.isInteger(l) && l % 2 === 1) r.value = l + 1; // pairs are odd-even
    changed();
  });
  on(prefix + 'R', 'input', changed);
  on(prefix + 'Pair', 'click', e => {
    const r = el(prefix + 'R'), amp = el(prefix + 'Amp'), btn = e.currentTarget;
    const open = r.hidden;
    r.hidden = !open; amp.hidden = !open;
    if (open) {
      const l = parseInt(val(prefix + 'L'), 10);
      if (!r.value && Number.isInteger(l)) r.value = l % 2 === 1 ? l + 1 : l - 1;
      r.focus();
    } else r.value = '';
    btn.textContent = open ? 'One lane' : '+ Second lane';
    btn.setAttribute('aria-expanded', String(open));
    changed();
  });
}
const leagueName = id => { const l = Store.getLeague(id); return l ? l.name : ''; };
const scoredGames = games => games.filter(g => g.total != null);
function seriesCardHTML(sr) {
  const multi = sr.games.length > 1;
  const g0 = sr.games[0];
  const sub = [Store.centerName(sr.centerId), laneLabel(g0), g0.pattern || '', sr.sheet ? 'week ' + sr.week : ''].filter(x => x && x !== '—').join(' · ');
  return '<div class="series-card" data-act="series" data-first="' + esc(g0.id) + '" role="group" aria-label="' + esc(fmtDate(sr.date)) + '">' +
    '<div class="meta"><div class="d">' + fmtDate(sr.date) + (sr.leagueId ? '<span class="badge league">' + esc(leagueName(sr.leagueId) || 'League') + '</span>' : '') +
    (sr.sheet ? '<span class="badge sheet">league sheet</span>' : '') + '</div>' +
    '<div class="s">' + esc(sub) + '</div><div class="chips">' +
    sr.games.map(g => '<button class="chip" data-act="game" data-id="' + esc(g.id) + '" aria-label="Game ' + g.gameNo + ': ' + (g.total == null ? 'no score' : g.total) + '">' + (g.total == null ? '—' : g.total) + '</button>').join('') +
    '</div></div><div class="score"><small>' + (multi ? sr.games.length + '-game series' : 'Game') + '</small>' + (sr.total == null ? '—' : sr.total) + '</div></div>';
}
// Best three games in a row within any series (a 4-game night counts its best 3-game stretch).
function highSeries(series) {
  let best = null;
  series.forEach(sr => {
    const t = sr.games.map(g => g.total);
    for (let i = 0; i + 3 <= t.length; i++) {
      if (t.slice(i, i + 3).some(x => x == null)) continue;
      const s3 = t[i] + t[i + 1] + t[i + 2];
      if (best == null || s3 > best) best = s3;
    }
  });
  return best;
}

/* ---------- home ---------- */
RENDER.home = function () {
  const mine = myGames();
  const totals = scoredGames(mine).map(g => g.total);
  const avg = avgFloor(totals);
  const series = Store.allSeries(mine);
  const own = Store.allSeries();
  const high3 = highSeries(series);
  const latest = own[0];
  let h = '<div class="hero card"><img class="hero-logo" src="logo-icon.jpg" alt="BowlBoard"><div class="avg">' + (avg == null ? '—' : avg) + '</div>' +
    '<div class="avg-label">average</div><div class="hero-stats">' +
    '<div class="stat"><b>' + totals.length + '</b><span>games</span></div>' +
    '<div class="stat"><b>' + (totals.length ? Math.max(...totals) : '—') + '</b><span>high game</span></div>' +
    '<div class="stat"><b>' + (high3 || '—') + '</b><span>high 3-game</span></div>' +
    '</div>' + myLeagueChips() + '</div>';
  if (latest && latest.date === todayISO() && latest.games.length < 6) {
    h += '<button class="btn" id="homeContinue">Continue today’s series · Game ' + (latest.games.length + 1) + '</button>';
    h += '<button class="btn secondary mt8" id="homeNew">+ Start a new series</button>';
  } else {
    h += '<button class="btn" id="homeNew">+ New game</button>';
  }
  h += backupNudgeHTML();
  if (Sample.has(Store)) {
    h += '<div class="notice sample-note"><b>Sample data.</b> These games and the demo league are examples so you can look around. <button class="link-btn" id="clearSamples">Clear sample data</button></div>';
  }
  h += '<h2 class="screen-title">Recent</h2>';
  h += series.length ? series.slice(0, 4).map(seriesCardHTML).join('') :
    '<div class="empty">No games yet.<br>Tap <b>+ New game</b> to log your first.</div>';
  screenRoot().innerHTML = h;
  on('homeNew', 'click', () => { newSetup = null; show('new'); });
  on('homeContinue', 'click', () => continueSeries(latest.games[latest.games.length - 1]));
  on('clearSamples', 'click', async () => {
    if (!(await ask('Remove the sample games, balls, centers and demo league? Anything you entered yourself stays.', 'Clear sample data', true))) return;
    Sample.clear(Store); toast('Sample data cleared'); RENDER.home();
  });
  on('nudgeBackup', 'click', () => show('backup'));
  on('nudgeLater', 'click', () => { Store.state.backupNudgeAt = new Date().toISOString(); Store.save(); RENDER.home(); });
};
// Storage on a phone can be cleared without warning, so remind people to back up.
function backupNudgeHTML() {
  const st = Store.state;
  const real = st.games.filter(g => !g.sample).length + st.leagues.filter(l => !l.sample).length * 3;
  const days = iso => (iso ? (Date.now() - new Date(iso).getTime()) / 864e5 : Infinity);
  if (real < 3 || days(st.lastBackupAt) < 30 || days(st.backupNudgeAt) < 7) return '';
  return '<div class="notice backup-note"><b>Your games live only on this phone.</b> Clearing browser data or switching phones loses them. ' +
    '<div class="row mt8"><button class="btn small-btn" id="nudgeBackup">Back up now</button><button class="btn secondary small-btn" id="nudgeLater">Not now</button></div></div>';
}
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

/* ---------- new game / series setup ---------- */
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
  return '<div class="small muted hint">Week ' + w + (m ? ' · ' + esc(LG.teamName(l, m.a)) + ' vs ' + esc(LG.teamName(l, m.b)) + ' · lanes ' + esc(m.lanes) : '') +
    '. When you finish you can send this series to the league sheet so it’s only entered once.</div>';
}
RENDER.new = function () {
  if (!newSetup) newSetup = defaultSetup();
  const s = newSetup;
  const cont = !!s.seriesId;
  if (!Store.state.centers.length) s.centerId = '__new';
  let h = '<h2 class="screen-title">' + (cont ? 'Game ' + s.gameNo + ' of your series' : 'New game') + '</h2>';
  if (cont) {
    h += '<div class="card info-card"><b>' + fmtDate(s.date) + ' · ' + esc(Store.centerName(s.centerId)) + '</b>' +
      (s.leagueId ? '<div class="small muted">' + esc(leagueName(s.leagueId)) + '</div>' : '') +
      '<button class="link-btn" id="ngFresh">Start a separate series instead</button></div>';
  }
  h += '<div class="card">';
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
  h += '<h2 class="screen-title">How do you want to enter it?</h2><div class="mode-grid">';
  [['pins', '🎳', 'Pin by pin', 'Tap pins · every stat', ''], ['photo', '📸', 'Photo + check', 'Scan drafts it, you verify', ''],
    ['frames', '🔢', 'Running totals', 'Copy the sheet’s totals', 'Average only*'], ['total', '✏️', 'Total only', 'One number', 'Average only']].forEach(m => {
    h += '<button class="mode-card' + (s.mode === m[0] ? ' sel' : '') + '" data-act="mode" data-mode="' + m[0] + '" aria-pressed="' + (s.mode === m[0]) + '">' +
      '<div class="ic" aria-hidden="true">' + m[1] + '</div><div class="t">' + m[2] + '</div><div class="d">' + m[3] + '</div>' + (m[4] ? '<div class="tag">' + m[4] + '</div>' : '') + '</button>';
  });
  h += '</div>';
  if (s.mode === 'frames' || s.mode === 'total') {
    h += '<div class="notice mode-note">' + (s.mode === 'total'
      ? '<b>Total-only games</b> count toward your average and high games, but not strike %, spare %, splits or leaves.'
      : '<b>Running totals</b> count toward your average. If the totals only fit one ball-by-ball game (a 300, say), BowlBoard works the frames out and they count for strike and spare stats too. Otherwise they don’t.') + '</div>';
  }
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

/* ---------- score entry ---------- */
let entry = null; // {setup, game, sel:Set}

function startGame(setup) {
  if (!setup.seriesId) { setup.seriesId = Store.uid(); setup.gameNo = 1; }
  entry = { setup, game: S.newGame(), sel: new Set() };
  if (setup.mode === 'photo') { resetPhoto(setup); show('photo'); }
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
  entry = null;
  show('saved', { id: g.id });
}
function entryHeader(setup, extra) {
  return '<h2 class="screen-title">Game ' + setup.gameNo + ' <span class="muted small">· ' + fmtDate(setup.date) + ' · ' + esc(Store.centerName(setup.centerId)) + (extra ? ' · ' + extra : '') + '</span></h2>' +
    '<label class="ball-line"><span>Ball</span><select id="entryBall" aria-label="Ball for this game">' + ballOptions(setup.ballId) + '</select></label>';
}
function bindEntryBall(setup) { on('entryBall', 'change', e => { setup.ballId = e.target.value; toast('Ball for game ' + setup.gameNo + ': ' + Store.ballLabel(setup.ballId)); }); }

RENDER.entry = function () {
  if (!entry) { show('new'); return; }
  const root = screenRoot();
  if (entry.setup.mode === 'frames') return renderRunningTotals(root);
  if (entry.setup.mode === 'total') return renderTotalPanel(root);
  root.innerHTML = entryHeader(entry.setup) + '<div id="scoreWrap"></div><div id="deckWrap"></div>';
  bindEntryBall(entry.setup);
  renderPinEntry();
};
// Only the score strip and the deck redraw after a throw; the header (ball picker) stays put.
function renderPinEntry() {
  const game = entry.game, sc = S.computeScore(game);
  const done = S.isComplete(game);
  el('scoreWrap').innerHTML = frameGridHTML(game, done ? -1 : S.currentFrame(game)) +
    '<div class="score-line" aria-live="polite"><div class="now">Score <b>' + (done ? sc.total : sc.runningTotal) + '</b> ' + (done ? '' : pendingNote(game)) + '</div>' +
    '<div class="max">' + (done ? 'Final' : 'Max ' + S.maxPossible(game)) + '</div></div>';
  el('deckWrap').innerHTML = done
    ? '<div class="finish-bar"><button class="btn secondary small-btn" data-act="undo">↩ Undo</button><button class="btn grow" data-act="save">Save game — ' + sc.total + '</button></div>'
    : deckHTML(game);
}
function recordAndRedraw(r) {
  if (!r.ok) { toast(r.error); return; }
  entry.sel = new Set();
  renderPinEntry();
}
function updateThrowButton() {
  const n = entry.sel.size, b = el('throwBtn');
  if (!b) return;
  b.disabled = !n;
  b.textContent = 'Throw · ' + n + ' pin' + (n === 1 ? '' : 's');
}
ACT.entry = {
  pin: a => { // toggle in place — no redraw
    const n = +a.dataset.pin;
    if (entry.sel.has(n)) entry.sel.delete(n); else entry.sel.add(n);
    a.classList.toggle('down', entry.sel.has(n));
    a.setAttribute('aria-pressed', String(entry.sel.has(n)));
    updateThrowButton();
  },
  clear: () => recordAndRedraw(S.recordClear(entry.game)),
  miss: () => recordAndRedraw(S.recordThrow(entry.game, [])),
  foul: () => recordAndRedraw(S.recordThrow(entry.game, [], { foul: true })),
  throw: () => recordAndRedraw(S.standingPins(entry.game) ? S.recordThrow(entry.game, Array.from(entry.sel)) : S.recordBall(entry.game, entry.sel.size)),
  undo: () => { if (!S.undo(entry.game)) toast('Nothing to undo'); entry.sel = new Set(); renderPinEntry(); },
  save: () => saveGame(Object.assign(gameBase(entry.setup), { frames: S.clone(entry.game).frames, total: S.computeScore(entry.game).total })),
};

const PIN_ROWS = [[7, 8, 9, 10], [4, 5, 6], [2, 3], [1]];
function deckHTML(game) {
  const standing = S.standingPins(game) || S.ALL_PINS;
  const fresh = S.freshRack(game);
  const n = entry.sel.size;
  let h = '<div class="pindeck">';
  if (!fresh) {
    const split = S.isSplit(standing);
    h += '<div class="leave-line"><span class="leave-chip' + (split ? ' split' : '') + '">Leave ' + standing.join('-') + (split ? ' · split' : '') + '</span></div>';
  }
  h += '<div class="small muted deck-hint" id="deckHint">Tap the pins that fell, then Throw</div><div role="group" aria-labelledby="deckHint">';
  PIN_ROWS.forEach(row => {
    h += '<div class="pinrow">';
    row.forEach(p => {
      if (standing.indexOf(p) < 0) h += '<span class="pin gone" role="img" aria-label="pin ' + p + ' already down">' + p + '</span>';
      else h += '<button class="pin' + (entry.sel.has(p) ? ' down' : '') + '" data-act="pin" data-pin="' + p + '" aria-label="pin ' + p + '" aria-pressed="' + entry.sel.has(p) + '">' + p + '</button>';
    });
    h += '</div>';
  });
  h += '</div><div class="quick-row">' +
    '<button class="btn quick strong" data-act="clear" id="clearBtn">' + (fresh ? 'X Strike' : '/ Spare') + '</button>' +
    '<button class="btn quick" data-act="miss" id="missBtn">– Miss</button>' +
    '<button class="btn quick" data-act="foul" id="foulBtn">F Foul</button>' +
    '<button class="btn quick undo" data-act="undo" id="undoBtn" aria-label="Undo">↩</button></div>';
  h += '<button class="btn mt8" data-act="throw" id="throwBtn"' + (n ? '' : ' disabled') + '>Throw · ' + n + ' pin' + (n === 1 ? '' : 's') + '</button>';
  return h + '</div>';
}

/* running-total entry: copy the cumulative score printed under each frame */
function checkRunning(vals) {
  const nums = vals.map(v => (v === '' || v == null ? null : parseInt(v, 10)));
  let prev = 0;
  for (let i = 0; i < 10; i++) {
    const n = nums[i];
    if (n == null || isNaN(n)) return { ok: false, msg: 'Enter the running total for frame ' + (i + 1) + '.', filled: i };
    if (n < prev) return { ok: false, msg: 'Frame ' + (i + 1) + ' (' + n + ') can’t be lower than frame ' + i + ' (' + prev + ').', bad: i };
    if (n - prev > 30) return { ok: false, msg: 'Frame ' + (i + 1) + ' jumps ' + (n - prev) + ' pins — a frame is worth 30 at most.', bad: i };
    prev = n;
  }
  // Is there a real ball-by-ball game behind these totals? (e.g. 30 then 40 can't happen)
  const recon = S.framesFromRunningTotals(nums);
  if (!recon.count) return { ok: false, msg: 'No real game gives these totals — a strike or spare needs enough pins in the frames after it. Check the sheet.' };
  return { ok: true, total: prev, nums, recon };
}
function renderRunningTotals(root, opts) {
  opts = opts || {};
  const p = opts.prefix || 'rt';
  const target = opts.target || entry;
  if (!target.cum) target.cum = new Array(10).fill('');
  let h = opts.title || entryHeader(entry.setup, 'running totals');
  h += '<div class="card"><p class="small muted mt0">Type the running score printed under each frame (e.g. 9, 28, 47…).</p><div class="review-grid">';
  target.cum.forEach((v, i) => {
    h += '<label class="review-frame"><div class="fn">F' + (i + 1) + '</div><div class="ballinputs">' +
      '<input type="number" inputmode="numeric" min="0" max="300" data-cum="' + i + '" aria-label="Running total after frame ' + (i + 1) + '" value="' + esc(v) + '" placeholder="–"></div></label>';
  });
  h += '</div><div class="scan-status" id="' + p + 'Status" aria-live="polite"></div>';
  h += '<button class="btn" id="' + p + 'Save">Save game</button></div>';
  root.innerHTML = h;
  if (!opts.title) bindEntryBall(entry.setup);
  const status = () => {
    const r = checkRunning(target.cum);
    const st = root.querySelector('#' + p + 'Status');
    st.textContent = r.ok ? 'Total: ' + r.total + (r.recon.count === 1 ? ' · frames worked out, so strike and spare stats count too' : ' · more than one game fits these totals, so this counts toward your average only') : r.msg;
    st.className = 'scan-status ' + (r.ok ? 'good' : '');
    root.querySelectorAll('[data-cum]').forEach(inp => inp.classList.toggle('bad', r.bad === +inp.dataset.cum));
    const b = root.querySelector('#' + p + 'Save');
    b.disabled = !r.ok; b.textContent = r.ok ? 'Save game — ' + r.total : 'Save game';
    return r;
  };
  root.querySelectorAll('[data-cum]').forEach(inp => inp.addEventListener('input', () => { target.cum[+inp.dataset.cum] = inp.value; status(); }));
  status();
  root.querySelector('#' + p + 'Save').addEventListener('click', () => {
    const r = status();
    if (!r.ok) { toast(r.msg); return; }
    const data = { cumulative: r.nums, total: r.total, frames: undefined, framesDerived: undefined };
    if (r.recon.count === 1) { data.frames = S.validateFrames(r.recon.frames).game.frames; data.framesDerived = true; }
    if (opts.onSave) return opts.onSave(data);
    saveGame(Object.assign(gameBase(entry.setup), data));
  });
}

function renderTotalPanel(root) {
  let h = entryHeader(entry.setup, 'total only') + '<div class="card">';
  h += '<label class="field">Final score<input type="number" inputmode="numeric" id="totalInput" min="0" max="300" placeholder="e.g. 184" value="' + esc(entry.totalVal || '') + '"></label>';
  h += '<button class="btn" id="saveTotalBtn">Save game</button></div>';
  root.innerHTML = h;
  bindEntryBall(entry.setup);
  on('totalInput', 'input', e => { entry.totalVal = e.target.value; });
  on('saveTotalBtn', 'click', () => {
    const t = parseInt(entry.totalVal, 10);
    if (isNaN(t) || t < 0 || t > 300) { toast('Enter a score from 0 to 300'); return; }
    saveGame(Object.assign(gameBase(entry.setup), { total: t }));
  });
}

/* ---------- personal -> league: send a series to the league sheet ---------- */
function linkStatusHTML(g) {
  const l = g.leagueId && Store.getLeague(g.leagueId);
  if (!l) return '';
  const link = LG.findLink(l, g.id);
  if (link) return '<div class="link-ok">✓ On the ' + esc(l.name) + ' sheet · week ' + link.week + ', game ' + link.game + '. Edits here update it.</div>';
  return '';
}
function sendSeriesSheet(seriesId, leagueId, after) {
  const l = Store.getLeague(leagueId);
  if (!l) return;
  if (!LG.me(l)) {
    window.BBLeagueUI.askMe(l, () => sendSeriesSheet(seriesId, leagueId, after), true);
    return;
  }
  const games = Store.seriesGames(seriesId).filter(g => g.total != null);
  const guess = LG.weekForDate(l, games[0] && games[0].date) || LG.currentWeek(l);
  const G = l.gamesPerNight;
  const weekOpts = Array.from({ length: l.seasonWeeks }, (_, i) => i + 1).map(w => '<option value="' + w + '"' + (w === guess ? ' selected' : '') + '>Week ' + w + (LG.weekDate(l, w) ? ' · ' + fmtDate(LG.weekDate(l, w), { month: 'short', day: 'numeric' }) : '') + '</option>').join('');
  openSheet('<h3>Send to ' + esc(l.name) + '</h3>' +
    '<p class="small muted mt0">Puts your games on the league score sheet as <b>' + esc(LG.me(l).name) + '</b>, linked to your log. If you edit a game later, the sheet follows. If the secretary changes a score on the sheet, theirs stands.</p>' +
    '<label class="field">League week<select id="sendWeek">' + weekOpts + '</select></label>' +
    '<div class="send-preview" id="sendPreview"></div>' +
    (games.length > G ? '<p class="small warn">This league bowls ' + G + ' games a night — games 1–' + G + ' are sent.</p>' : '') +
    '<button class="btn" id="sendGo">Send ' + Math.min(G, games.length) + ' game' + (Math.min(G, games.length) === 1 ? '' : 's') + '</button>', sh => {
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
      Store.save(); closeSheet();
      toast('Sent to ' + l.name + ', week ' + w);
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
  if (sr.length > 1) {
    h += '<div class="series-line">' + sr.map(x => '<span class="' + (x.id === g.id ? 'hl' : '') + '">' + (x.total == null ? '—' : x.total) + '</span>').join('<i>·</i>') + '</div>' +
      '<div class="muted small">Series ' + tot + ' · ' + sr.length + ' games</div>';
  }
  h += '</div>';
  const l = g.leagueId && Store.getLeague(g.leagueId);
  if (l) {
    const linked = sr.filter(x => LG.findLink(l, x.id)).length;
    h += '<div class="card league-send"><div class="small"><b>' + esc(l.name) + '</b></div>' +
      (linked ? '<div class="link-ok">✓ ' + linked + ' of ' + sr.length + ' games are on the league sheet' + (linked < sr.length && sr.length <= l.gamesPerNight ? ' — send again to add the new one' : '') + '.</div>' : '<div class="small muted">Put this series on the league sheet so nobody types it twice.</div>') +
      ((linked < Math.min(sr.length, l.gamesPerNight)) ? '<button class="btn secondary mt8" id="sendLeague">Send series to league sheet</button>' : '') + '</div>';
  }
  h += '<button class="btn" id="nextGameBtn">Bowl game ' + (sr.length + 1) + ' →</button>';
  h += '<div class="row mt8"><button class="btn secondary grow" id="viewGameBtn">View game</button><button class="btn secondary grow" id="doneBtn">Done for today</button></div>';
  screenRoot().innerHTML = h;
  on('sendLeague', 'click', () => sendSeriesSheet(g.seriesId, g.leagueId));
  on('nextGameBtn', 'click', () => continueSeries(g));
  on('viewGameBtn', 'click', () => show('game', { id: g.id }));
  on('doneBtn', 'click', () => show('history'));
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
    h += frameGridHTML(game, -1);
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
  h += linkStatusHTML(g);
  h += '</div>';
  if (g.photoId || g.thumb) h += '<img class="photo-preview small" id="gamePhoto" alt="score sheet photo"' + (g.thumb && Store.safeImage(g.thumb) ? ' src="' + Store.safeImage(g.thumb) + '"' : ' hidden') + '>';
  h += '<div class="card"><table class="kv">' +
    '<tr><td>Center</td><td>' + esc(Store.centerName(g.centerId)) + '</td></tr>' +
    (laneLabel(g) ? '<tr><td>Lanes</td><td>' + esc(laneLabel(g).replace(/^Lanes? /, '')) + '</td></tr>' : '') +
    (g.pattern ? '<tr><td>Oil pattern</td><td>' + esc(g.pattern) + '</td></tr>' : '') +
    '<tr><td>Ball</td><td>' + esc(Store.ballLabel(g.ballId)) + '</td></tr>' +
    '<tr><td>Type</td><td>' + (g.leagueId ? esc(leagueName(g.leagueId) || 'League') : 'Practice / open play') + '</td></tr>' +
    '<tr><td>Entered as</td><td>' + (MODE_LABEL[g.mode] || g.mode) + (g.updatedAt ? ' · edited' : '') + '</td></tr></table></div>';
  const l = g.leagueId && Store.getLeague(g.leagueId);
  if (l && !LG.findLink(l, g.id)) h += '<button class="btn secondary mb8" id="sendLeague2">Send series to ' + esc(l.name) + ' sheet</button>';
  h += '<div class="row"><button class="btn secondary grow" id="editDetailsBtn">Edit details</button><button class="btn secondary grow" id="editScoreBtn">Edit score</button></div>';
  h += '<div class="row mt8"><button class="btn secondary grow" id="addGameBtn">+ Add game to series</button><button class="btn danger" id="delGameBtn">Delete</button></div>';
  root.innerHTML = h;
  if (g.photoId) Store.photos.get(g.photoId).then(src => { const im = el('gamePhoto'); if (im && src && nav.params.id === g.id) { im.src = src; im.hidden = false; } });
  on('sendLeague2', 'click', () => sendSeriesSheet(g.seriesId, g.leagueId));
  on('editDetailsBtn', 'click', () => editDetailsSheet(g));
  on('editScoreBtn', 'click', () => editScore(g));
  on('addGameBtn', 'click', () => continueSeries(sr[sr.length - 1]));
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
    const draft = g.frames.map(f => f.balls.slice());
    openSheet('<h3>Edit score</h3><p class="small muted mt0">Fix any ball. Unchanged balls keep their pin detail.</p>' +
      ballGridHTML(draft, 'eg') + '<div class="scan-status" id="egStatus" aria-live="polite"></div><button class="btn" id="egSave">Save score</button>', sh => {
      const build = () => g.frames.map((f, i) => {
        const nf = S.normFrame(f);
        const balls = draft[i].filter(v => v !== '' && v != null).map(Number);
        return { balls, pins: balls.map((b, j) => (b === nf.balls[j] ? nf.pins[j] : null)), fouls: balls.map((b, j) => (b === nf.balls[j] ? nf.fouls[j] : false)) };
      });
      const status = bindBallGrid(sh, draft, 'eg', () => S.validateFrames(build()), 'egStatus', 'egSave');
      sh.querySelector('#egSave').addEventListener('click', () => {
        const r = status();
        if (!r.ok) return;
        Store.updateGame(g.id, { frames: r.game.frames, total: S.computeScore(r.game).total });
        closeSheet(); toast('Score updated'); rerender();
      });
    });
  } else if (g.cumulative) {
    const tgt = { cum: g.cumulative.map(String) };
    openSheet('<div id="egCum"></div>', sh => {
      renderRunningTotals(sh.querySelector('#egCum'), { target: tgt, prefix: 'egc', title: '<h3>Edit running totals</h3>', onSave: data => {
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

/* ball-by-ball grid (photo review + score edit) */
function ballGridHTML(draft, prefix, marked) {
  let h = '<div class="review-grid balls" id="' + prefix + 'Grid">';
  for (let i = 0; i < 10; i++) {
    const nB = i < 9 ? 2 : 3;
    h += '<div class="review-frame' + (marked && marked[i] ? ' scanned' : '') + '"><div class="fn">F' + (i + 1) + '</div><div class="ballinputs">';
    for (let j = 0; j < nB; j++) {
      const v = draft[i] && draft[i][j] != null ? draft[i][j] : '';
      h += '<input type="number" inputmode="numeric" min="0" max="10" aria-label="Frame ' + (i + 1) + ' ball ' + (j + 1) + '" data-rf="' + i + '" data-rb="' + j + '" value="' + esc(v) + '" placeholder="–">';
    }
    h += '</div></div>';
  }
  return h + '</div>';
}
function bindBallGrid(root, draft, prefix, validate, statusId, btnId, extra, gate) {
  const status = () => {
    const v = validate();
    let ok = v.ok, msg;
    if (!v.ok) msg = v.error;
    else if (!S.isComplete(v.game)) { ok = false; msg = 'Incomplete — fill every frame. Total so far: ' + S.computeScore(v.game).runningTotal; }
    else msg = 'Total: ' + S.computeScore(v.game).total + (extra ? extra(v.game) : '');
    const gated = ok && gate && !gate();
    const e = root.querySelector('#' + statusId);
    if (e) { e.textContent = msg; e.className = 'scan-status' + (ok ? ' good' : ''); }
    const btn = root.querySelector('#' + btnId);
    if (btn) { btn.disabled = !ok || gated; btn.textContent = ok ? 'Save — ' + S.computeScore(v.game).total : 'Save'; }
    return { ok: ok && !gated, game: v.game, msg: gated ? 'Tick the box once you’ve checked every frame.' : msg };
  };
  root.querySelector('#' + prefix + 'Grid').addEventListener('input', e => {
    const t = e.target;
    if (!t.dataset.rf) return;
    const i = +t.dataset.rf, j = +t.dataset.rb;
    while (draft[i].length <= j) draft[i].push('');
    draft[i][j] = t.value === '' ? '' : Math.max(0, Math.min(10, parseInt(t.value, 10) || 0));
    while (draft[i].length && draft[i][draft[i].length - 1] === '') draft[i].pop(); // trailing blanks aren't balls
    status();
  });
  return status;
}

/* ---------- photo import: the scan is only ever a draft ---------- */
const photo = { setup: null, img: null, thumb: null, draft: null, note: '', scanning: false, totals: [], scanned: false, checked: false };
function resetPhoto(setup) {
  photo.setup = setup || photo.setup;
  Object.assign(photo, { img: null, thumb: null, draft: null, note: '', scanning: false, totals: [], scanned: false, checked: false });
}
function emptyDraft() { return Array.from({ length: 10 }, () => []); }
function downscale(dataURL, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const r = Math.min(1, maxDim / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * r));
      c.height = Math.max(1, Math.round(img.height * r));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = dataURL;
  });
}
// Tokenize one line of OCR text into ball-mark symbols (multi-digit runs are skipped).
function symbolsFromText(text) {
  const syms = [];
  const re = /\d+|[Xx]|-|F|\//g;
  let m;
  while ((m = re.exec(text))) {
    const t = m[0];
    if (/^\d+$/.test(t)) { if (t.length === 1) syms.push({ t: 'd', v: +t }); }
    else if (t === 'X' || t === 'x') syms.push({ t: 'X' });
    else if (t === '-') syms.push({ t: '-' });
    else if (t === '/') syms.push({ t: '/' });
    else if (t === 'F') syms.push({ t: 'F' });
  }
  return syms;
}
// Split OCR output into mark lines and running-total lines. A line whose numbers
// are mostly multi-digit and never go down is the running-total row, so its
// single digits (e.g. "9" under frame 1) aren't mistaken for pin counts.
function parseSheet(text) {
  const syms = [];
  let totals = [];
  String(text || '').split(/\r?\n/).forEach(line => {
    const nums = (line.match(/\d+/g) || []).map(Number);
    const multi = (line.match(/\d{2,3}/g) || []).length;
    const marks = (line.match(/[Xx/F-]/g) || []).length;
    const rising = nums.length >= 2 && nums.every((n, i) => i === 0 || n >= nums[i - 1]) && nums.every(n => n <= 300);
    if (rising && multi >= 2 && multi >= nums.length / 2 && marks <= 1) {
      if (nums.length > totals.length) totals = nums;
      return;
    }
    symbolsFromText(line).forEach(s => syms.push(s));
  });
  return { syms, totals };
}
function draftFrames(syms) {
  const frames = emptyDraft();
  let i = 0;
  for (const s of syms) {
    if (i >= 10) break;
    const f = frames[i];
    const v = s.t === 'X' ? 10 : (s.t === '-' || s.t === 'F') ? 0 : s.t === 'd' ? s.v : null;
    if (i < 9) {
      if (f.length === 0) {
        if (s.t === 'X') { f.push(10); i++; }
        else if (v !== null) f.push(v);
      } else {
        if (s.t === '/' || s.t === 'X') { f.push(10 - f[0]); i++; }
        else if (v !== null && f[0] + v <= 10) { f.push(v); i++; }
      }
    } else {
      const start = S.rackStart(9, f, f.length);
      const inRack = f.slice(start).reduce((a, x) => a + x, 0);
      const bv = s.t === '/' ? 10 - inRack : v;
      if (bv === null || f.length >= 3) continue;
      if (f.length === 2 && f[0] !== 10 && f[0] + f[1] < 10) continue; // open 10th is finished
      if (inRack + bv <= 10) f.push(bv);
    }
  }
  return frames;
}
function draftToFrames(d) {
  return Array.from({ length: 10 }, (_, i) => ({ balls: (d[i] || []).filter(v => v !== '' && v != null).map(Number) }));
}

RENDER.photo = function () {
  const root = screenRoot();
  const su = photo.setup || {};
  let h = entryHeader(su, 'photo');
  h += '<div class="card">';
  if (!photo.img) {
    h += EMBED ? '<p class="muted small">Attach a photo of the score sheet to keep with the game, then type the balls in. (Auto-scan works in the downloaded app.)</p>'
      : '<p class="muted small">Snap the score sheet or the overhead monitor. The scan only drafts the balls — you check every frame against the sheet before it’s saved.</p>';
    h += '<label class="btn" for="photoFile">📸 Take / upload photo</label>';
    h += '<input type="file" id="photoFile" accept="image/*" capture="environment" hidden>';
    h += '<button class="btn secondary mt8" id="manualBtn">Skip photo — type balls in</button>';
  } else {
    h += '<img class="photo-preview" src="' + Store.safeImage(photo.img) + '" alt="score sheet">';
    h += '<div class="row wrap">' + (EMBED ? '' : '<button class="btn small-btn grow" id="scanBtn"' + (photo.scanning ? ' disabled' : '') + '>' +
      (photo.scanning ? 'Scanning…' : '✨ Draft from photo (beta)') + '</button>') +
      '<button class="btn ' + (EMBED ? '' : 'secondary ') + 'small-btn grow" id="manualBtn">Type it in</button>' +
      '<button class="btn secondary small-btn" id="clearPhotoBtn">Retake</button></div>';
  }
  h += '<div class="scan-status" id="scanNote" aria-live="polite">' + esc(photo.note) + '</div>';
  if (photo.draft) {
    if (photo.scanned) h += '<div class="notice draft-note"><b>Draft — check every frame against the sheet.</b> Scans misread marks; nothing is saved until you confirm.</div>';
    else h += '<div class="small muted">Type each ball from the sheet — tap a box to fill it.</div>';
    h += ballGridHTML(photo.draft, 'ph', photo.scanned ? photo.draft.map(f => f.length > 0) : null);
    h += '<div class="scan-status" id="reviewStatus" aria-live="polite"></div>';
    if (photo.scanned) h += '<label class="check"><input type="checkbox" id="phChecked"' + (photo.checked ? ' checked' : '') + '> I checked every frame against the sheet</label>';
    h += '<button class="btn" id="savePhotoBtn">Save</button>';
  }
  h += '</div>';
  root.innerHTML = h;
  bindEntryBall(su);

  on('photoFile', 'change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    const raw = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
    try {
      photo.img = await downscale(raw, 1600, 0.85);
      photo.thumb = await downscale(raw, 1000, 0.72); // kept in IndexedDB, not in the main save file
    } catch (err) { toast('Could not read that image'); return; }
    RENDER.photo();
  });
  on('scanBtn', 'click', autoScan);
  on('manualBtn', 'click', () => { photo.draft = photo.draft || emptyDraft(); photo.note = ''; RENDER.photo(); });
  on('clearPhotoBtn', 'click', () => { resetPhoto(); RENDER.photo(); });
  if (photo.draft) {
    const sheetCheck = game => {
      const last = photo.totals[photo.totals.length - 1];
      if (!last) return '';
      return S.computeScore(game).total === last ? ' ✓ matches the total on the sheet' : ' — the sheet shows ' + last + ', double-check';
    };
    const status = bindBallGrid(root, photo.draft, 'ph', () => S.validateFrames(draftToFrames(photo.draft)), 'reviewStatus', 'savePhotoBtn', sheetCheck,
      photo.scanned ? () => photo.checked : null);
    status();
    on('phChecked', 'change', e => { photo.checked = e.target.checked; status(); });
    on('savePhotoBtn', 'click', () => {
      const r = status();
      if (!r.ok) { toast(r.msg); return; }
      const g = Object.assign(gameBase(su), { mode: 'photo', frames: r.game.frames, total: S.computeScore(r.game).total });
      const thumb = photo.thumb;
      resetPhoto();
      if (thumb) {
        Store.photos.put(g.id, thumb).then(ok => {
          if (ok) Store.updateGame(g.id, { photoId: g.id });
          else toast('The photo couldn’t be kept on this device — the score is saved.', 3500);
        });
      }
      saveGame(g);
    });
  }
};

async function autoScan() {
  if (!photo.img) { toast('Add a photo first'); return; }
  if (typeof Tesseract === 'undefined' || !Tesseract.createWorker) {
    photo.note = 'Scanner isn’t available (offline?) — type the balls in instead.';
    photo.draft = photo.draft || emptyDraft();
    RENDER.photo(); return;
  }
  photo.scanning = true; photo.note = 'Reading score sheet…'; RENDER.photo();
  let worker;
  try {
    worker = await Tesseract.createWorker('eng');
    await worker.setParameters({ tessedit_char_whitelist: 'Xx/-0123456789F ', preserve_interword_spaces: '1' });
    const res = await worker.recognize(photo.img);
    const parsed = parseSheet(res.data.text || '');
    photo.draft = draftFrames(parsed.syms);
    photo.totals = parsed.totals;
    photo.scanned = true;
    photo.checked = false;
    photo.note = 'Read ' + parsed.syms.length + ' marks' + (parsed.totals.length ? ' and ' + parsed.totals.length + ' running totals' : '') + '.';
  } catch (e) {
    photo.note = 'Scan failed — type the balls in instead.';
    photo.draft = photo.draft || emptyDraft();
  } finally {
    if (worker) worker.terminate().catch(() => {});
  }
  photo.scanning = false;
  RENDER.photo();
}

/* ---------- history ---------- */
const RANGES = [['all', 'All time'], ['d7', 'Last 7 days'], ['d30', 'Last 30 days'], ['d90', 'Last 90 days'], ['y365', 'Last year']];
const histFilter = { preset: 'all', center: '', ball: '', type: '' };
function inRange(dateISO, preset) {
  if (preset === 'all') return true;
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

/* ---------- stats ---------- */
const statFilter = { preset: 'all', type: '' };
RENDER.stats = function () {
  const root = screenRoot();
  const games = scoredGames(myGames().filter(g => inRange(g.date, statFilter.preset) && typeMatch(g, statFilter.type)));
  const totals = games.map(g => g.total);
  const avg = avgFloor(totals);
  const detailed = games.filter(g => g.frames);
  const ps = S.pinStats(detailed);
  const series = Store.allSeries(games);

  const byKey = keyFn => {
    const m = {};
    games.forEach(g => { const k = keyFn(g); (m[k] = m[k] || []).push(g.total); });
    return m;
  };
  const splitTable = (title, map, label) => {
    const keys = Object.keys(map).sort((a, b) => avgFloor(map[b]) - avgFloor(map[a]));
    if (!keys.length) return '';
    return '<div class="card"><h3>' + title + '</h3><table class="split"><tr><th>' + title.replace('By ', '') + '</th><th>Games</th><th>Avg</th></tr>' +
      keys.map(k => '<tr><td>' + esc(label(k)) + '</td><td>' + map[k].length + '</td><td><b>' + avgFloor(map[k]) + '</b></td></tr>').join('') + '</table></div>';
  };

  let h = '<h2 class="screen-title">Stats</h2><div class="filters">' +
    '<select id="stPreset" aria-label="Date range">' + rangeOptions(statFilter.preset) + '</select>' +
    '<select id="stType" aria-label="Practice or league">' + typeOptions(statFilter.type) + '</select></div>';
  if (!games.length) {
    root.innerHTML = h + '<div class="empty">No games in this range yet.</div>' + myLeagueStatsHTML();
    bindStatFilters(); return;
  }
  const card = (v, label) => '<div class="stat-card"><b>' + v + '</b><span>' + label + '</span></div>';
  h += '<div class="stat-grid">' + card(avg, 'Average') + card(Math.max(...totals), 'High game') +
    card(highSeries(series) || '—', 'High 3-game series') + card(totals.length, 'Games') + '</div>';
  h += '<div class="card"><h3>Scores over time</h3><div id="chartScore"></div></div>';
  if (detailed.length) h += '<div class="card"><h3>Strike % and spare %</h3><div id="chartRate"></div></div>';
  if (ps.games) {
    h += '<div class="stat-grid four">' + card(pct(ps.strikes, ps.racks), 'Strike %') + card(pct(ps.spares, ps.spareOpps), 'Spare %') +
      card(pct(ps.singles, ps.singleOpps), 'Single-pin') + card(ps.splitOpps ? ps.splitsMade + '/' + ps.splitOpps : '—', 'Splits made') + '</div>';
    h += '<div class="stat-grid four">' + card(ps.racks ? (ps.firstBallPins / ps.racks).toFixed(1) : '—', 'First-ball avg') +
      card((ps.openFrames / ps.games).toFixed(1), 'Opens / game') + card(ps.cleanGames, 'Clean games') + card(ps.fouls, 'Fouls') + '</div>';
    if (ps.topLeaves.length) {
      h += '<div class="card"><h3>Most common leaves</h3><table class="split"><tr><th>Leave</th><th>Times</th><th>Picked up</th></tr>' +
        ps.topLeaves.map(l => '<tr><td>' + l.leave + (S.isSplit(l.leave.split('-').map(Number)) ? ' <span class="badge split">split</span>' : '') + '</td><td>' + l.count + '</td><td><b>' + pct(l.made, l.count) + '</b></td></tr>').join('') + '</table></div>';
    }
    if (detailed.length < games.length) h += '<p class="small muted">Strike, spare and leave stats use the ' + detailed.length + ' of ' + games.length + ' games with frame detail. Total-only, running-total and league-sheet games count toward average and highs only.</p>';
  } else {
    h += '<p class="small muted">Enter games pin by pin (or check a photo scan) to unlock strike %, spare %, splits and leave stats.</p>';
  }
  h += '<details class="defs"><summary>How these are counted</summary><ul>' +
    '<li><b>Average</b> drops the fraction, as leagues do (189.9 is 189).</li>' +
    '<li><b>Strike %</b> = strikes ÷ strike chances. A chance is every ball thrown at a full rack, including 10th-frame fill balls after a strike or spare — a 300 is 12 for 12.</li>' +
    '<li><b>Spare %</b> = spares ÷ racks left standing after the first ball.</li>' +
    '<li><b>Single-pin</b> = spares made when the first ball counted 9.</li>' +
    '<li><b>Splits</b> follow the USBC rule: headpin down and a pin down between standing pins (7-9, 3-10) or right in front of two of them (5-6, 8-9). Sleepers (2-8, 3-9) aren’t splits.</li>' +
    '<li><b>High 3-game series</b> is your best three games in a row on one night.</li></ul></details>';
  const prac = games.filter(g => !g.leagueId).map(g => g.total), lgn = games.filter(g => g.leagueId).map(g => g.total);
  if (prac.length && lgn.length && !statFilter.type) {
    h += '<div class="card"><h3>Practice vs league nights</h3><div class="versus"><div><b>' + avgFloor(prac) + '</b><span>practice · ' + prac.length + ' g</span></div><div><b>' + avgFloor(lgn) + '</b><span>league · ' + lgn.length + ' g</span></div></div></div>';
  }
  h += myLeagueStatsHTML();
  h += splitTable('By center', byKey(g => g.centerId), k => Store.centerName(k));
  h += splitTable('By ball', byKey(g => (g.sheet ? '__sheet' : g.ballId || '__house')), k => (k === '__house' ? 'House ball' : k === '__sheet' ? 'Not recorded (league sheet)' : Store.ballLabel(k)));
  h += splitTable('By oil pattern', byKey(g => g.pattern || 'Not recorded'), k => k);
  root.innerHTML = h;
  bindStatFilters();
  drawStatCharts(games);
};
function drawStatCharts(games) {
  const C = window.BBCharts;
  if (!C) return;
  const a = el('chartScore'), b = el('chartRate');
  if (a) C.scoreTrend(a, games);
  if (b) { const ok = C.rateTrend(b, games); if (!ok && !b.textContent.trim()) b.closest('.card').hidden = true; }
}
// Charts are sized to the screen: redraw them (only them) when the width changes.
let resizeTimer = null, lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (nav.current !== 'stats' || window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    RENDER.stats();
  }, 200);
});
function bindStatFilters() {
  on('stPreset', 'change', e => { statFilter.preset = e.target.value; RENDER.stats(); });
  on('stType', 'change', e => { statFilter.type = e.target.value; RENDER.stats(); });
}
// Official league numbers for leagues where you've marked yourself on the roster.
function myLeagueStatsHTML() {
  const rows = [];
  Store.state.leagues.forEach(l => {
    const me = LG.me(l);
    if (!me) return;
    const st = LG.bowlerStats(l, LG.lastScoredWeek(l)).find(b => b.id === me.id);
    if (st) rows.push('<tr><td>' + esc(l.name) + '</td><td>' + st.games + '</td><td><b>' + (st.avg == null ? '—' : st.avg) + '</b></td><td>' + (st.highSeries || '—') + '</td><td>' + st.hcp + '</td></tr>');
  });
  if (!rows.length) return '';
  return '<div class="card"><h3>My official league numbers</h3><table class="split"><tr><th>League</th><th>Games</th><th>Avg</th><th>High ser.</th><th>Hcp</th></tr>' + rows.join('') + '</table></div>';
}

/* ---------- more ---------- */
RENDER.more = function () {
  const n = Store.state.games.length;
  screenRoot().innerHTML = '<h2 class="screen-title">More</h2>' +
    '<button class="list-item nav-item" data-act="go" data-to="balls"><span class="ic" aria-hidden="true">🔮</span><div class="grow"><div class="t">My arsenal</div><div class="s">' + Store.state.balls.length + ' ball' + (Store.state.balls.length === 1 ? '' : 's') + '</div></div><span class="chev" aria-hidden="true">›</span></button>' +
    '<button class="list-item nav-item" data-act="go" data-to="centers"><span class="ic" aria-hidden="true">📍</span><div class="grow"><div class="t">Bowling centers</div><div class="s">' + Store.state.centers.length + ' saved</div></div><span class="chev" aria-hidden="true">›</span></button>' +
    '<button class="list-item nav-item" data-act="go" data-to="backup"><span class="ic" aria-hidden="true">💾</span><div class="grow"><div class="t">Backup &amp; restore</div><div class="s">' + n + ' game' + (n === 1 ? '' : 's') + ' · ' + Store.state.leagues.length + ' league' + (Store.state.leagues.length === 1 ? '' : 's') + ' on this device' + (Store.state.lastBackupAt ? ' · last backup ' + fmtDate(Store.state.lastBackupAt.slice(0, 10)) : ' · never backed up') + '</div></div><span class="chev" aria-hidden="true">›</span></button>' +
    installItemHTML() +
    (Sample.has(Store) ? '' : '<button class="list-item nav-item" id="loadSamples"><span class="ic" aria-hidden="true">🎳</span><div class="grow"><div class="t">Load sample data</div><div class="s">Example games and a demo league, labelled and removable</div></div><span class="chev" aria-hidden="true">›</span></button>') +
    '<div class="about"><img src="logo.jpg" alt="BowlBoard logo"><p class="small muted">BowlBoard prototype · data stays on this device</p></div>';
  on('installApp', 'click', installFlow);
  on('loadSamples', 'click', () => {
    try { Sample.seed(Store, S, LG, todayISO()); toast('Sample data loaded — clear it from Home anytime'); show('home'); }
    catch (e) { toast('Couldn\u2019t load sample data'); }
  });
};

/* ---------- centers ---------- */
RENDER.centers = function () {
  let h = backLink('more', 'More') + '<h2 class="screen-title">Bowling centers</h2>';
  h += Store.state.centers.length ? Store.state.centers.map(a => {
    const n = Store.state.games.filter(g => g.centerId === a.id).length;
    const inLeague = Store.state.leagues.some(l => l.centerId === a.id);
    return '<div class="list-item"><div class="grow"><div class="t">' + esc(a.name) + ' ' + (a.sample ? '<span class="seed-tag">sample</span>' : '') + '</div>' +
      '<div class="s">' + esc(a.city || '—') + (n ? ' · ' + n + ' game' + (n === 1 ? '' : 's') : '') + (inLeague ? ' · league house' : '') + '</div></div>' +
      (!n && !inLeague ? '<button class="btn danger" data-act="delCenter" data-id="' + a.id + '" aria-label="Delete ' + esc(a.name) + '">✕</button>' : '') + '</div>';
  }).join('') : '<div class="empty">No centers yet. Add your house here, or when you start a game.</div>';
  h += '<div class="card"><h3>Add a center</h3>' +
    '<label class="field">Name<input type="text" id="cName" placeholder="e.g. Parkside Lanes"></label>' +
    '<label class="field">City<input type="text" id="cCity" placeholder="e.g. Aurora, IL"></label>' +
    '<button class="btn" id="cAdd">Add center</button></div>';
  screenRoot().innerHTML = h;
  on('cAdd', 'click', () => {
    const n = val('cName').trim();
    if (!n) { toast('Give the center a name'); return; }
    Store.addCenter(n, val('cCity').trim());
    toast('Center added'); RENDER.centers();
  });
};
ACT.centers = { delCenter: a => { if (Store.deleteCenter(a.dataset.id)) RENDER.centers(); else toast('That center is in use'); } };

/* ---------- balls / arsenal ---------- */
RENDER.balls = function () {
  let h = backLink('more', 'More') + '<h2 class="screen-title">My arsenal</h2>';
  h += Store.state.balls.length ? Store.state.balls.map(b => {
    const gs = scoredGames(Store.state.games.filter(g => g.ballId === b.id));
    return '<div class="list-item"><div class="grow"><div class="t">' + esc(b.brand + ' ' + b.name) + (b.sample ? ' <span class="seed-tag">sample</span>' : '') + '</div>' +
      '<div class="s">' + esc([b.weight ? b.weight + ' lb' : null, b.cover].filter(Boolean).join(' · ')) +
      (gs.length ? ' · ' + gs.length + ' games · avg ' + avgFloor(gs.map(g => g.total)) : '') + '</div></div>' +
      (!Store.state.games.some(g => g.ballId === b.id) ? '<button class="btn danger" data-act="delBall" data-id="' + b.id + '" aria-label="Remove ' + esc(b.name) + '">✕</button>' : '') + '</div>';
  }).join('') : '<div class="empty">No balls yet — add your arsenal below.</div>';
  const groups = {};
  Data.BALL_CATALOG.forEach((b, i) => { (groups[b.brand] = groups[b.brand] || []).push([i, b]); });
  h += '<div class="card"><h3>Add a ball</h3>' +
    '<label class="field">From catalog<select id="baCat">' +
    Object.keys(groups).sort().map(br => '<optgroup label="' + esc(br) + '">' +
      groups[br].map(([i, b]) => '<option value="' + i + '">' + esc(b.name + ' · ' + b.cover) + '</option>').join('') + '</optgroup>').join('') +
    '<option value="custom">✏️ Custom ball…</option></select></label>' +
    '<div id="baCustomWrap" hidden><label class="field">Brand<input type="text" id="baBrand" placeholder="e.g. Storm"></label>' +
    '<label class="field">Ball name<input type="text" id="baName" placeholder="e.g. Hy-Road"></label>' +
    '<label class="field">Coverstock<input type="text" id="baCover" placeholder="e.g. Hybrid Reactive"></label></div>' +
    '<label class="field">Weight (lb)<select id="baWeight">' +
    [16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6].map(w => '<option value="' + w + '"' + (w === 15 ? ' selected' : '') + '>' + w + '</option>').join('') +
    '</select></label><button class="btn" id="baAdd">Add to arsenal</button></div>';
  screenRoot().innerHTML = h;
  on('baCat', 'change', e => { el('baCustomWrap').hidden = e.target.value !== 'custom'; });
  on('baAdd', 'click', () => {
    const ci = val('baCat');
    const weight = +val('baWeight');
    let ball;
    if (ci === 'custom') {
      const name = val('baName').trim();
      if (!name) { toast('Give the ball a name'); return; }
      ball = { brand: val('baBrand').trim() || 'Custom', name, cover: val('baCover').trim(), weight, custom: true };
    } else {
      const c = Data.BALL_CATALOG[+ci];
      ball = { brand: c.brand, name: c.name, cover: c.cover, weight, custom: false };
    }
    Store.addBall(ball);
    toast('Ball added'); RENDER.balls();
  });
};
ACT.balls = { delBall: a => { if (Store.deleteBall(a.dataset.id)) RENDER.balls(); else toast('That ball is used in games'); } };

/* ---------- backup & restore ---------- */
RENDER.backup = function () {
  const st = Store.state;
  screenRoot().innerHTML = backLink('more', 'More') + '<h2 class="screen-title">Backup &amp; restore</h2>' +
    '<div class="card"><p class="mt0">Your games and leagues are saved on this device only' + (Store.storageOK ? '' : ' — <b class="warn">but saving is blocked right now (private browsing?)</b>') + '. Clearing browser data or switching phones will lose them, so back up now and then.</p>' +
    '<p class="small muted">' + st.games.length + ' games · ' + st.balls.length + ' balls · ' + st.centers.length + ' centers · ' + st.leagues.length + ' leagues' +
    (st.lastBackupAt ? ' · last backup ' + fmtDate(st.lastBackupAt.slice(0, 10)) : ' · never backed up') + '</p>' +
    '<button class="btn" id="bkExport">' + (EMBED ? 'Copy backup' : '⬇︎ Download backup') + '</button>' +
    '<label class="btn secondary mt8" for="bkFile">⬆︎ Restore from backup…</label><input type="file" id="bkFile" accept="application/json,.json" hidden>' +
    '<p class="small muted">Score-sheet photos stay on this device and aren’t part of the backup.</p></div>' +
    '<div class="card"><h3>Start over</h3><p class="small muted mt0">Erase every game, ball, center and league on this device.</p><button class="btn danger" id="bkReset">Erase all data</button></div>';
  on('bkExport', 'click', () => {
    const json = Store.exportJSON();
    Store.markBackedUp();
    if (download('bowlboard-backup-' + todayISO() + '.json', json, 'application/json')) toast('Backup downloaded');
  });
  on('bkFile', 'change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    const text = await f.text();
    if (!(await ask('Replace everything on this device with this backup?', 'Replace', true))) return;
    const r = Store.importJSON(text);
    if (!r.ok) { toast(r.error); return; }
    toast('Restored ' + r.games + ' games and ' + r.leagues + ' leagues');
    RENDER.backup();
  });
  on('bkReset', 'click', async () => {
    if (!(await ask('Erase every game, ball, center and league on this device? This can’t be undone.', 'Erase everything', true))) return;
    Store.resetAll(); toast('All data erased'); show('home');
  });
};

/* ---------- install on the phone (PWA) ---------- */
// Works when the app is served from a web address (https or localhost), not from a
// file on disk and not inside the hosted preview, which can't run service workers.
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const canInstall = () => /^https?:$/.test(location.protocol) && !EMBED && 'serviceWorker' in navigator;
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; if (nav.current === 'more') rerender(); });
window.addEventListener('appinstalled', () => { installPrompt = null; toast('BowlBoard installed — open it from your home screen'); });
if (canInstall()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (w && navigator.serviceWorker.controller) w.addEventListener('statechange', () => { if (w.state === 'activated') toast('BowlBoard updated — the new version loads next time you open it', 4000); });
      });
    }).catch(() => { /* offline support is optional */ });
  });
}
function installItemHTML() {
  if (standalone()) return '';
  return '<button class="list-item nav-item" id="installApp"><span class="ic" aria-hidden="true">📲</span><div class="grow"><div class="t">Install on your phone</div>' +
    '<div class="s">Home-screen icon, opens full screen, works with no signal at the lanes</div></div><span class="chev" aria-hidden="true">›</span></button>';
}
async function installFlow() {
  if (installPrompt) {
    installPrompt.prompt();
    const r = await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    if (r && r.outcome === 'accepted') return;
    rerender(); return;
  }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let body;
  if (!canInstall()) {
    body = '<p class="mt0">Installing needs BowlBoard to be opened from its own web address (the <b>web</b> folder in the download, put on any static host such as Netlify, GitHub Pages or Cloudflare Pages).</p>' +
      '<p class="small muted">' + (EMBED ? 'This preview link can\u2019t install apps or work offline.' : 'Opened as a file, the browser won\u2019t install it.') + ' Your games stay wherever you first entered them, so move them with More → Backup & restore.</p>';
  } else if (ios) {
    body = '<ol class="steps"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button (square with an arrow).</li><li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>' +
      '<p class="small muted">BowlBoard then opens full screen from its icon and works without a signal.</p>';
  } else {
    body = '<ol class="steps"><li>Open your browser\u2019s menu (⋮).</li><li>Choose <b>Install app</b> or <b>Add to Home screen</b>.</li></ol>' +
      '<p class="small muted">If you don\u2019t see it, reload the page once and try again.</p>';
  }
  openSheet('<h3>Install BowlBoard</h3>' + body + '<p class="small muted">The installed app keeps its own copy of your data. If you already entered games here, back them up and restore them in the installed app.</p><button class="btn mt8" data-close>Got it</button>');
}

/* ---------- fixed header: keep the page clear of it ---------- */
function measureHeader() {
  const h = document.querySelector('.app-header');
  if (h) document.documentElement.style.setProperty('--header-h', h.offsetHeight + 'px');
}
window.addEventListener('resize', measureHeader);
window.addEventListener('orientationchange', () => setTimeout(measureHeader, 250));
document.addEventListener('DOMContentLoaded', measureHeader);
window.addEventListener('load', measureHeader); // logo image may change the height

/* ---------- first run ---------- */
if (BUILD.seed && !Store.state.seeded && !Store.state.games.length && !Store.state.leagues.length) {
  try { Sample.seed(Store, S, LG, todayISO()); } catch (e) { /* samples are optional */ }
}

/* ---------- shared API for league-ui.js and tests ---------- */
window.BB = {
  EMBED, BUILD, ACT, show, rerender, nav, RENDER, toast, esc, fmtDate, todayISO, el, on, val, avgFloor, download, copyText, copyRich,
  openSheet, closeSheet, ask, backLink, centerOptions, frameGridHTML, screenRoot, sendSeriesSheet, myGames, highSeries,
  get entry() { return entry; }, set entry(v) { entry = v; },
};
window.BBEntry = () => entry;
window.BBPhoto = photo;
window.BBScanTest = { symbolsFromText, parseSheet, draftFrames, emptyDraft, checkRunning };

document.addEventListener('DOMContentLoaded', () => show('home'));
})();
