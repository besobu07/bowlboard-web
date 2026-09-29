/* BowlBoard UI core — helpers, icons, bottom sheet, navigation and the action dispatcher.
 *
 * The UI is split by screen (js/ui/*.js). Every file shares one namespace, window.BB:
 * this file creates it, later files add to it. A file only destructures what earlier
 * files defined; anything from a later file is called as BB.name(...) at run time.
 *
 * Each screen renders into its own <section> root. Element lookups are scoped to
 * that root (or the open sheet), so an id only has to be unique within one screen.
 * Clicks on [data-act] elements go through one delegated listener, dispatched to the
 * active screen's ACT table.
 */
(function () {
'use strict';
const $ = s => document.querySelector(s);
// Set by the build script: embedded = hosted preview (no downloads/print/share), seed = sample data on first run.
const BUILD = window.BB_BUILD || {};
const EMBED = !!BUILD.embedded;

/* ---------- icons (one stroke set, drawn to match the logo's clean line) ---------- */
const P = d => '<path d="' + d + '"/>';
const C = (x, y, r) => '<circle cx="' + x + '" cy="' + y + '" r="' + r + '"/>';
const ICONS = {
  home: P('M3.5 11 12 4l8.5 7') + P('M5.5 9.5V20h4.5v-5.5h4V20h4.5V9.5'),
  history: P('M9 3.5h6v3H9z') + P('M7.5 5H5.5v15.5h13V5h-2') + P('M8.5 11h7M8.5 14.5h7M8.5 18h4'),
  stats: P('M3.5 20h17') + P('M6.5 20v-7') + P('M12 20V6') + P('M17.5 20v-10'),
  league: P('M8 4h8v5.5a4 4 0 0 1-8 0z') + P('M8 6H5.2a2.8 2.8 0 0 0 3 4') + P('M16 6h2.8a2.8 2.8 0 0 1-3 4') + P('M12 13.5V17') + P('M8.5 20h7') + P('M10 17h4v3h-4z'),
  pins: ['M5.5', 'M12', 'M18.5'].map((_, i) => '<g transform="translate(' + [-3.2, 3.8, 10.8][i] + ' ' + (i === 1 ? 1.2 : 3.2) + ') scale(.62)"><path d="M12 2.5c1.6 0 2.3 1.5 2 3-.2 1-.9 1.6-.9 2.6 0 1.4 2.9 3.2 2.9 7.3 0 3.4-1.7 6.1-4 6.1s-4-2.7-4-6.1c0-4.1 2.9-5.9 2.9-7.3 0-1-.7-1.6-.9-2.6-.3-1.5.4-3 2-3z"/></g>').join(''),
  arrow: P('M5 12h14') + P('M13 6l6 6-6 6'),
  more: C(5.5, 12, 1.3) + C(12, 12, 1.3) + C(18.5, 12, 1.3),
  pin: P('M12 2.5c1.6 0 2.3 1.5 2 3-.2 1-.9 1.6-.9 2.6 0 1.4 2.9 3.2 2.9 7.3 0 3.4-1.7 6.1-4 6.1s-4-2.7-4-6.1c0-4.1 2.9-5.9 2.9-7.3 0-1-.7-1.6-.9-2.6-.3-1.5.4-3 2-3z') + P('M10.4 7.8h3.2'),
  camera: P('M4 7.5h3.2L9 5h6l1.8 2.5H20v11H4z') + C(12, 13, 3.3),
  screen: P('M3.5 5h17v11h-17z') + P('M9 20h6') + P('M12 16v4') + P('M7 10.5h2M11 10.5h2M15 10.5h2'),
  grid: P('M3.5 6h17v12h-17z') + P('M3.5 11.5h17') + P('M9.2 6v12') + P('M14.8 6v12'),
  pencil: P('M4.5 19.5l1-4.2L15.8 5a2 2 0 0 1 2.8 2.8L8.3 18.1z') + P('M14 6.8l3 3'),
  ball: C(12, 12, 8.5) + C(9.3, 9.2, 1.1) + C(12.6, 8.2, 1.1) + C(11.2, 12, 1.3),
  place: P('M12 21s-6.5-5.8-6.5-10.8a6.5 6.5 0 0 1 13 0C18.5 15.2 12 21 12 21z') + C(12, 10.2, 2.3),
  shield: P('M12 3.2 19.5 6v5.6c0 4.3-3.1 7.8-7.5 9.2-4.4-1.4-7.5-4.9-7.5-9.2V6z') + P('M8.8 12.2l2.2 2.2 4.3-4.6'),
  download: P('M12 4v11') + P('M7.5 10.5 12 15l4.5-4.5') + P('M5 20h14'),
  upload: P('M12 20V9') + P('M7.5 13.5 12 9l4.5 4.5') + P('M5 4h14'),
  phone: P('M8 2.5h8a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5z') + P('M11 18.5h2'),
  sparkle: P('M12 3.5l1.7 5 5 1.7-5 1.7-1.7 5-1.7-5-5-1.7 5-1.7z') + P('M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z'),
  link: P('M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.1 1.1') + P('M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.1-1.1'),
  mail: P('M3.5 6h17v12h-17z') + P('M3.8 6.5 12 12.5l8.2-6'),
  user: C(12, 8, 3.8) + P('M4.5 20.5c1-3.9 4-6 7.5-6s6.5 2.1 7.5 6'),
  info: C(12, 12, 8.5) + P('M12 11v5.5') + P('M12 7.6v.4'),
  vibrate: P('M9 4.5h6a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z') + P('M4.5 9v6M19.5 9v6M2.5 10.5v3M21.5 10.5v3'),
  chevron: P('M9.5 6l6 6-6 6'),
  check: P('M5 12.5l4.5 4.5L19 7.5'),
  alert: P('M12 4 21 19.5H3z') + P('M12 10v4.5') + P('M12 17v.3'),
  undo: P('M9 14.5 4.5 10 9 5.5') + P('M4.5 10H14a5.5 5.5 0 0 1 0 11h-3'),
  calendar: P('M4 6h16v14H4z') + P('M4 10h16') + P('M8.5 3.5v4M15.5 3.5v4'),
  people: C(9, 8.5, 3.2) + P('M3 19.5c.8-3.2 3.1-5 6-5s5.2 1.8 6 5') + P('M15.5 5.6a3 3 0 0 1 0 5.8') + P('M17.4 14.8c1.8.6 3.1 2.2 3.6 4.7'),
  gear: P('M10.44 2.93 L13.56 2.93 L13.55 5.17 L15.73 6.08 L17.31 4.49 L19.51 6.69 L17.92 8.27 L18.83 10.45 L21.07 10.44 L21.07 13.56 L18.83 13.55 L17.92 15.73 L19.51 17.31 L17.31 19.51 L15.73 17.92 L13.55 18.83 L13.56 21.07 L10.44 21.07 L10.45 18.83 L8.27 17.92 L6.69 19.51 L4.49 17.31 L6.08 15.73 L5.17 13.55 L2.93 13.56 L2.93 10.44 L5.17 10.45 L6.08 8.27 L4.49 6.69 L6.69 4.49 L8.27 6.08 L10.45 5.17 Z') + C(12, 12, 3),
  clock: C(12, 12, 8.5) + P('M12 7.5V12h3.5'),
  crop: P('M7 3.5V17h13.5') + P('M3.5 7H17v13.5'),
  file: P('M6.5 3.5h7l4 4v13h-11z') + P('M13.5 3.5v4h4'),
};
function icon(name, cls) {
  return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (ICONS[name] || '') + '</svg>';
}

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
const daysSince = iso => (iso ? (Date.now() - new Date(iso).getTime()) / 864e5 : Infinity);
const plural = (n, w, ws) => n + ' ' + (n === 1 ? w : (ws || w + 's'));
// League convention: averages are truncated, never rounded up.
const avgFloor = arr => (arr.length ? Math.floor(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
const pct = (n, d) => (d ? Math.round(100 * n / d) + '%' : '—');
const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// Scoped lookups: the open sheet first, then the active screen.
const sheetRoot = () => { const w = $('#sheet'); return w && !w.hidden ? w.querySelector('.sheet') : null; };
const screenRoot = () => document.getElementById('screen-' + nav.current);
function el(id) {
  const sh = sheetRoot();
  return (sh && sh.querySelector('#' + id)) || (screenRoot() && screenRoot().querySelector('#' + id)) || null;
}
function on(id, ev, fn) { const e = el(id); if (e) e.addEventListener(ev, fn); }
const val = id => { const e = el(id); return e ? e.value : ''; };

/* ---------- feel: haptics and count-up ---------- */
// A short tick where the phone supports it (Android; iPhone browsers don't vibrate). Off in More.
function haptic(kind) {
  const prof = (window.BBStore && window.BBStore.state.profile) || {};
  if (prof.haptics === false || !navigator.vibrate) return;
  try { navigator.vibrate(kind === 'strike' ? [14, 50, 14, 50, 22] : kind === 'spare' ? [14, 50, 18] : kind === 'throw' ? 16 : 7); } catch (e) { /* not allowed */ }
}
function countUp(node, from, to, ms) {
  if (!node) return;
  if (reduceMotion() || from == null || from === to || !window.requestAnimationFrame) { node.textContent = to; return; }
  const t0 = performance.now(), dur = ms || 380;
  const step = t => {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    node.textContent = Math.round(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- files and clipboard ---------- */
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
  wrap.classList.remove('closing');
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
  wrap.classList.add('closing'); // its buttons can't be tapped twice while it slides away
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
const TAB_OF = { new: 'home', entry: 'home', photo: 'home', saved: 'home', game: 'history', ball: 'stats', matchup: 'league', centers: 'more', balls: 'more', backup: 'more' };
const nav = { current: 'home', params: {} };
const leaveHooks = []; // fn(from, to) — e.g. offer a backup after league night
function show(name, params) {
  const from = nav.current;
  Store().flush();
  nav.current = name;
  nav.params = params || {};
  // Every visit redraws from state, so a screen's old DOM is stale once you leave it: drop it.
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
  if (from !== name) leaveHooks.forEach(fn => { try { fn(from, name); } catch (e) { /* a hook must never break navigation */ } });
}
const Store = () => window.BBStore;
function rerender() { (RENDER[nav.current] || (() => {}))(nav.params); }
document.querySelectorAll('.tabbar button').forEach(b => b.addEventListener('click', () => show(b.dataset.nav)));
{ const g = document.getElementById('hdrGear'); if (g) { g.innerHTML = icon('gear'); g.addEventListener('click', () => show('more')); } }
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
  go: a => show(a.dataset.to, a.dataset.params ? JSON.parse(a.dataset.params) : undefined),
  ball: a => show('ball', { id: a.dataset.id }),
};

window.BB = {
  BUILD, EMBED, $, icon, toast, esc, fmtDate, todayISO, daysSince, plural, avgFloor, pct, reduceMotion, haptic, countUp,
  sheetRoot, screenRoot, el, on, val, download, textSheet, copyText, copyRich, openSheet, closeSheet, ask,
  RENDER, ACT, TAB_OF, nav, show, rerender, backLink, onLeave: fn => leaveHooks.push(fn),
};
})();
