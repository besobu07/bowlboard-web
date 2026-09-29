/* BowlBoard UI — pieces several screens share: the paper scorecard, pickers, series
 * cards, "my games" (own log + league-sheet games) and backup status. */
(function () {
'use strict';
const BB = window.BB;
const S = window.BBScore, Store = window.BBStore, Data = window.BBData, LG = window.BBLeague;
const { esc, fmtDate, icon, el, on, val, daysSince, plural, EMBED, toast, download, todayISO } = BB;

// Tab bar icons come from the same icon set as everything else.
const TAB_ICON = { home: 'home', history: 'history', stats: 'stats', league: 'pins', more: 'more' };
document.querySelectorAll('.tabbar button').forEach(b => { if (!b.querySelector('svg')) b.insertAdjacentHTML('afterbegin', icon(TAB_ICON[b.dataset.nav])); });

const MODE_LABEL = { pins: 'Pin by pin', frames: 'Running totals', total: 'Total only', photo: 'Photo of the lane screen (checked by hand)', sheet: 'League sheet' };
const laneLabel = g => (g.lanes && g.lanes.length ? (g.lanes.length > 1 ? 'Lanes ' + g.lanes.join('-') : 'Lane ' + g.lanes[0]) : (g.laneNote || ''));
const leagueName = id => { const l = Store.getLeague(id); return l ? l.name : ''; };
const scoredGames = games => games.filter(g => g.total != null);

/* ---------- my games = my own log + league-sheet scores that aren't linked to it ---------- */
function sheetGames() { return Store.state.leagues.reduce((all, l) => all.concat(LG.sheetOnlyGames(l)), []); }
function myGames() { return Store.state.games.concat(sheetGames()); }
function getAnyGame(id) {
  if (!String(id).startsWith('sheet:')) return Store.getGame(id);
  return sheetGames().find(g => g.id === id) || null;
}
const myLeagues = () => Store.state.leagues.filter(l => LG.me(l));
// First name for the greeting: the name set in More, else your name on a league roster.
function firstName() {
  const n = (Store.state.profile && Store.state.profile.name || '').trim();
  if (n) return n.split(/\s+/)[0];
  for (const l of myLeagues()) {
    if (l.sample) continue;
    const full = LG.me(l).name || '';
    if (/,/.test(full)) return full.split(',')[1].trim().split(/\s+/)[0] || '';
    return full.split(/\s+/)[0] || '';
  }
  return '';
}

/* ---------- the paper scorecard ---------- */
// frames: [{marks:[...], cum, pending, split:[bool], foul:[bool], flag}] ; opts: {cur, curBall, tap, id, caption}
function cardHTML(frames, opts) {
  opts = opts || {};
  let h = '<div class="scorecard' + (opts.tap ? ' tappable' : '') + '"' + (opts.id !== false ? ' id="' + (opts.id || 'frameGrid') + '"' : '') + (opts.label ? ' role="group" aria-label="' + esc(opts.label) + '"' : '') + '>';
  for (let i = 0; i < 10; i++) {
    const f = frames[i] || { marks: [] };
    const nB = i < 9 ? 2 : 3;
    // On a real sheet a strike in frames 1-9 goes in the small box.
    const shift = i < 9 && f.marks[0] === 'X' && !f.marks[1] ? 1 : 0;
    let balls = '';
    for (let j = 0; j < nB; j++) {
      const k = j - shift;
      const m = k >= 0 ? f.marks[k] || '' : '';
      const cls = [k >= 0 && f.split && f.split[k] ? 'split' : '', m === 'F' ? 'foul' : '', m === 'X' ? 'x' : '', m === '/' ? 'sp' : '', k >= 0 && opts.cur === i && opts.curBall === k ? 'here' : ''].filter(Boolean).join(' ');
      balls += '<span' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(m) + '</span>';
    }
    const cell = f.cum != null ? f.cum : (f.pending ? '<i class="pend" title="Waiting on bonus balls">…</i>' : '');
    const cls = 'frame' + (i === 9 ? ' tenth' : '') + (opts.cur === i ? ' cur' : '') + (f.flag ? ' flag-' + f.flag : '');
    const inner = '<div class="fnum">' + (i + 1) + '</div><div class="balls">' + balls + '</div><div class="cum">' + cell + '</div>';
    h += opts.tap
      ? '<button type="button" class="' + cls + '" data-frame="' + i + '" aria-label="Frame ' + (i + 1) + (f.marks.filter(Boolean).length ? ': ' + f.marks.filter(Boolean).join(' ') : ', empty') + (f.flag === 'bad' ? ' (needs fixing)' : f.flag === 'low' ? ' (check this)' : '') + '"' + (opts.cur === i ? ' aria-current="true"' : '') + '>' + inner + '</button>'
      : '<div class="' + cls + '">' + inner + '</div>';
  }
  return h + '</div>';
}
function scorecardHTML(game, cur, opts) {
  const sc = S.computeScore(game);
  const frames = [];
  for (let i = 0; i < 10; i++) frames.push({ marks: sc.marks[i] || [], cum: sc.cumulative[i], pending: sc.pending[i], split: sc.splits[i] });
  return cardHTML(frames, Object.assign({ cur }, opts || {}));
}
function pendingNote(game) {
  const sc = S.computeScore(game);
  const i = sc.pending.indexOf(true);
  if (i < 0) return '';
  const strike = i < 9 ? game.frames[i].balls[0] === 10 : false;
  return '<span class="pending-note">+ ' + (strike ? 'strike' : 'spare') + ' bonus pending</span>';
}

/* ---------- pickers ---------- */
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

/* ---------- series cards ---------- */
function seriesLinked(sr) {
  const l = sr.leagueId && Store.getLeague(sr.leagueId);
  return !!(l && !sr.sheet && sr.games.some(g => LG.findLink(l, g.id)));
}
function seriesCardHTML(sr) {
  const multi = sr.games.length > 1;
  const g0 = sr.games[0];
  const sub = [Store.centerName(sr.centerId), laneLabel(g0), g0.pattern || '', sr.sheet ? 'week ' + sr.week : ''].filter(x => x && x !== '—').join(' · ');
  return '<div class="series-card" data-act="series" data-first="' + esc(g0.id) + '" role="group" aria-label="' + esc(fmtDate(sr.date)) + '">' +
    '<div class="meta"><div class="d">' + fmtDate(sr.date) + (sr.leagueId ? '<span class="badge league">' + esc(leagueName(sr.leagueId) || 'League') + '</span>' : '') +
    (sr.sheet ? '<span class="badge sheet-only">league sheet</span>' : '') + (seriesLinked(sr) ? '<span class="badge linked">' + icon('link') + 'linked</span>' : '') + '</div>' +
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

/* ---------- backup status ---------- */
function realData() {
  const st = Store.state;
  return st.games.some(g => !g.sample) || st.leagues.some(l => !l.sample);
}
function backupStatus() {
  const st = Store.state;
  const d = daysSince(st.lastBackupAt);
  const leagueSince = st.leagueEditAt && (!st.lastBackupAt || st.leagueEditAt > st.lastBackupAt);
  let label;
  if (!st.lastBackupAt) label = 'Never backed up';
  else if (d < 1 && new Date(st.lastBackupAt).toDateString() === new Date().toDateString()) label = 'Backed up today';
  else if (d < 2) label = 'Last backup yesterday';
  else label = 'Last backup ' + Math.floor(d) + ' days ago';
  const today = label === 'Backed up today' && !leagueSince;
  const due = realData() && !today && (!st.lastBackupAt || d >= 14 || leagueSince);
  return { label, today, due, leagueSince: !!leagueSince, days: d };
}
function backupNow() {
  const json = Store.exportJSON();
  Store.markBackedUp();
  const ok = download('bowlboard-backup-' + todayISO() + '.json', json, 'application/json');
  if (ok) toast('Backup saved to your downloads');
  return ok;
}

Object.assign(BB, {
  MODE_LABEL, laneLabel, leagueName, scoredGames, sheetGames, myGames, getAnyGame, myLeagues, firstName,
  cardHTML, scorecardHTML, frameGridHTML: scorecardHTML, pendingNote, centerOptions, ballOptions, leagueOptions, patternList,
  lanesFields, readLanes, bindLanes, seriesLinked, seriesCardHTML, highSeries, realData, backupStatus, backupNow, plural,
});
})();
