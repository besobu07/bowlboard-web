/* BowlBoard — More: equipment (balls, centers), data (backup & restore, automatic
 * copies), app settings, install on the phone, about. */
(function () {
'use strict';
const BB = window.BB;
const Store = window.BBStore, Data = window.BBData, LG = window.BBLeague, Sample = window.BBSample, S = window.BBScore;
const { RENDER, ACT, EMBED, esc, fmtDate, todayISO, icon, el, on, val, show, toast, ask, openSheet, closeSheet, screenRoot, rerender, backLink, avgFloor, plural, download, backupStatus, backupNow, scoredGames } = BB;
const VERSION = '0.7.1';

const item = (ic, t, s, attrs) => '<button class="list-item nav-item" ' + attrs + '><span class="li-ic">' + icon(ic) + '</span><div class="grow"><div class="t">' + t + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div><span class="chev" aria-hidden="true">' + icon('chevron') + '</span></button>';

RENDER.more = function () {
  const st = Store.state;
  const bs = backupStatus();
  const prof = st.profile || {};
  let h = '<h2 class="screen-title">More</h2>';
  h += '<h3 class="group-title">My equipment</h3>' +
    item('ball', 'Bowling balls', plural(st.balls.length, 'ball') + ' in your arsenal', 'data-act="go" data-to="balls"') +
    item('place', 'Bowling centers', st.centers.length + ' saved', 'data-act="go" data-to="centers"');
  h += '<h3 class="group-title">Data</h3>' +
    item('shield', 'Backup &amp; restore', esc(bs.label) + ' · ' + plural(st.games.length, 'game') + ', ' + plural(st.leagues.length, 'league'), 'data-act="go" data-to="backup"' + (bs.due ? ' data-due="1"' : '')) +
    item('upload', 'Import a league', 'From a LeagueSecretary or BLS weekly-scores file', 'id="moreImport"') +
    (Sample.has(Store) ? '' : item('sparkle', 'Load sample data', 'Example games and a demo league, labelled and removable', 'id="loadSamples"'));
  h += '<h3 class="group-title">App</h3>' +
    item('user', 'Your name', prof.name ? esc(prof.name) : 'For the greeting on Home', 'id="setName"') +
    '<label class="list-item toggle-item"><span class="li-ic">' + icon('vibrate') + '</span><div class="grow"><div class="t">Vibrate on taps</div><div class="s">Pins, strikes and spares (phones that support it)</div></div>' +
    '<input type="checkbox" class="switch" id="setHaptics"' + (prof.haptics === false ? '' : ' checked') + '></label>' +
    installItemHTML();
  h += item('mail', 'Contact us', 'Questions, ideas or a problem? hello@bowlboard.app', 'id="contactUs"');
  h += '<div class="about"><img src="primary-logo.png" alt="BowlBoard"><p class="tagline">Built for Bowlers</p><p class="small muted">BowlBoard ' + VERSION + ' · <a href="https://bowlboard.app" target="_blank" rel="noopener">bowlboard.app</a> · your data stays on this device</p></div>';
  screenRoot().innerHTML = h;
  on('installApp', 'click', installFlow);
  on('contactUs', 'click', () => { const u = 'mailto:hello@bowlboard.app?subject=' + encodeURIComponent('BowlBoard ' + VERSION); if (EMBED) BB.copyText('hello@bowlboard.app').then(ok => toast(ok ? 'Email address copied: hello@bowlboard.app' : 'Email us at hello@bowlboard.app', 4000)); else window.location.href = u; });
  on('moreImport', 'click', () => { show('league', { list: true }); setTimeout(() => BB.importLeagueSheet && BB.importLeagueSheet(), 0); });
  on('loadSamples', 'click', () => {
    try { Sample.seed(Store, S, LG, todayISO()); toast('Sample data loaded — clear it from Home anytime'); show('home'); }
    catch (e) { toast('Couldn’t load sample data'); }
  });
  on('setName', 'click', () => openSheet('<h3>Your name</h3><label class="field">First name or nickname<input type="text" id="pfName" value="' + esc(prof.name || '') + '" autocomplete="given-name"></label><button class="btn" id="pfSave">Save</button>', sh => {
    sh.querySelector('#pfSave').addEventListener('click', () => {
      st.profile = Object.assign({}, st.profile, { name: val('pfName').trim() });
      Store.save(); closeSheet(); rerender();
    });
  }));
  on('setHaptics', 'change', e => { st.profile = Object.assign({}, st.profile, { haptics: e.target.checked }); Store.save(); if (e.target.checked) BB.haptic('tap'); });
};

/* ---------- centers ---------- */
RENDER.centers = function () {
  let h = backLink('more', 'More') + '<h2 class="screen-title">Bowling centers</h2>';
  h += Store.state.centers.length ? Store.state.centers.map(a => {
    const n = Store.state.games.filter(g => g.centerId === a.id).length;
    const inLeague = Store.state.leagues.some(l => l.centerId === a.id);
    return '<div class="list-item"><span class="li-ic">' + icon('place') + '</span><div class="grow"><div class="t">' + esc(a.name) + ' ' + (a.sample ? '<span class="seed-tag">sample</span>' : '') + '</div>' +
      '<div class="s">' + esc(a.city || '—') + (n ? ' · ' + plural(n, 'game') : '') + (inLeague ? ' · league house' : '') + '</div></div>' +
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
    const used = Store.state.games.some(g => g.ballId === b.id);
    return '<div class="list-item"><button class="ball-open" data-act="openBall" data-id="' + b.id + '"><span class="li-ic">' + icon('ball') + '</span><div class="grow"><div class="t">' + esc(b.brand + ' ' + b.name) + (b.sample ? ' <span class="seed-tag">sample</span>' : '') + '</div>' +
      '<div class="s">' + esc([b.weight ? b.weight + ' lb' : null, b.cover].filter(Boolean).join(' · ')) +
      (gs.length ? ' · ' + plural(gs.length, 'game') + ' · avg ' + avgFloor(gs.map(g => g.total)) : '') + '</div></div></button>' +
      (!used ? '<button class="btn danger" data-act="delBall" data-id="' + b.id + '" aria-label="Remove ' + esc(b.name) + '">✕</button>' : '') + '</div>';
  }).join('') : '<div class="empty">No balls yet — add your arsenal below.</div>';
  const groups = {};
  Data.BALL_CATALOG.forEach((b, i) => { (groups[b.brand] = groups[b.brand] || []).push([i, b]); });
  h += '<div class="card"><h3>Add a ball</h3>' +
    '<label class="field">From catalog<select id="baCat">' +
    Object.keys(groups).sort().map(br => '<optgroup label="' + esc(br) + '">' +
      groups[br].map(([i, b]) => '<option value="' + i + '">' + esc(b.name + ' · ' + b.cover) + '</option>').join('') + '</optgroup>').join('') +
    '<option value="custom">Custom ball…</option></select></label>' +
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
ACT.balls = {
  delBall: a => { if (Store.deleteBall(a.dataset.id)) RENDER.balls(); else toast('That ball is used in games'); },
  openBall: a => show('ball', { id: a.dataset.id, from: 'balls' }),
};

/* ---------- backup & restore ---------- */
const REASON = {
  auto: 'Automatic copy', 'league-night': 'After league night', 'before-restore': 'Before a restore', 'before-erase': 'Before erasing everything',
  'before-upgrade': 'Before an app update changed your data', 'before-league-delete': 'Before a league was deleted', 'before-league-replace': 'Before a league was re-imported',
  unreadable: 'Data that couldn’t be read',
};
const whenLabel = iso => { const d = new Date(iso); return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };

RENDER.backup = function () {
  const st = Store.state;
  const bs = backupStatus();
  let h = backLink('more', 'More') + '<h2 class="screen-title">Backup &amp; restore</h2>';
  h += '<div class="card backup-status' + (bs.today ? ' ok' : bs.due ? ' due' : '') + '">' + icon(bs.today ? 'check' : 'shield', 'bs-ic') +
    '<div class="grow"><div class="kicker">Your data is stored on this device</div><div class="bs-label">' + (bs.today ? '✓ ' : '') + esc(bs.label) + '</div>' +
    '<div class="small muted">' + plural(st.games.length, 'game') + ' · ' + plural(st.balls.length, 'ball') + ' · ' + plural(st.centers.length, 'center') + ' · ' + plural(st.leagues.length, 'league') +
    (Store.storageOK ? '' : ' · <b class="warn">saving is blocked right now (private browsing, or storage full)</b>') + '</div>' +
    (bs.leagueSince ? '<div class="small warn">League scores changed since the last backup.</div>' : '') + '<div id="persistNote" class="small muted"></div></div></div>';
  h += '<button class="btn" id="bkExport">' + icon('download') + (EMBED ? 'Copy backup' : 'Back up now') + '</button>';
  h += '<p class="small muted center">Saves one file with every game, ball, center and league. Keep it somewhere other than this phone — email it to yourself, or put it in Drive or iCloud. Lane-screen photos stay on the phone.</p>';
  h += '<div class="card"><h3>' + icon('clock') + 'Automatic copies on this phone</h3><p class="small muted mt0">BowlBoard keeps a few recent copies by itself: one every 12 hours or so, one after each league night, and one before anything that replaces or erases data. They live on this phone, so they won’t survive a cleared browser — a backup file will.</p><div id="snapList" class="snap-list"><div class="small muted">Looking…</div></div></div>';
  h += '<div class="card"><h3>' + icon('upload') + 'Restore from a backup file</h3><p class="small muted mt0">Replaces everything here with the file’s contents. What’s here now is copied first, so you can undo it below.</p>' +
    '<label class="btn secondary" for="bkFile">Choose backup file…</label><input type="file" id="bkFile" accept="application/json,.json" hidden></div>';
  if (Store.unreadableText()) h += '<div class="card"><h3>Data that couldn’t be read</h3><p class="small muted mt0">Kept exactly as it was found. Email it to hello@bowlboard.app if you need help recovering it.</p><button class="btn secondary" id="bkUnreadable">Download it</button></div>';
  h += '<div class="card"><h3>Start over</h3><p class="small muted mt0">Erase every game, ball, center and league on this device. An automatic copy is taken first where the browser allows it.</p><button class="btn danger" id="bkReset">Erase all data</button></div>';
  screenRoot().innerHTML = h;
  drawSnapshots();
  if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(p => {
    const n = el('persistNote');
    if (n && BB.nav.current === 'backup') n.textContent = p ? 'This browser has agreed to keep BowlBoard’s data.' : 'This browser may clear site data it hasn’t been asked to keep — installing BowlBoard on your home screen helps.';
  }).catch(() => {});
  on('bkExport', 'click', () => { backupNow(); RENDER.backup(); });
  on('bkFile', 'change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    const text = await f.text();
    const chk = Store.checkBackup(text);
    if (!chk.ok) { toast(chk.error, 4000); return; }
    const can = await Store.snapshots.available();
    if (!(await ask('Replace everything on this device with this backup (' + plural(chk.games, 'game') + ', ' + plural(chk.leagues, 'league') + ')?' + (can ? ' What\u2019s here now is copied first.' : ' This browser can\u2019t keep a copy of what\u2019s here, so back it up first if you need it.'), 'Replace', true))) return;
    if (can && !(await Store.snapshots.take('before-restore'))) { toast('Couldn\u2019t keep a copy of what\u2019s here first, so nothing was changed.', 4000); return; }
    const r = Store.importJSON(text);
    if (!r.ok) { toast(r.error); return; }
    toast('Restored ' + plural(r.games, 'game') + ' and ' + plural(r.leagues, 'league'));
    RENDER.backup();
  });
  on('bkUnreadable', 'click', () => download('bowlboard-unreadable-' + todayISO() + '.txt', Store.unreadableText() || '', 'text/plain'));
  on('bkReset', 'click', async () => {
    const can = await Store.snapshots.available();
    if (!(await ask('Erase every game, ball, center and league on this device?' + (can ? '' : ' This browser can\u2019t keep an automatic copy, so this can\u2019t be undone.'), 'Erase everything', true))) return;
    const copy = can ? await Store.snapshots.take('before-erase', { force: true }) : null;
    if (can && !copy) { toast('Couldn\u2019t keep a copy first, so nothing was erased.', 4000); return; }
    Store.resetAll(); toast(copy ? 'All data erased — an automatic copy was kept' : 'All data erased'); show('home');
  });
};
async function drawSnapshots() {
  const box = el('snapList');
  if (!box) return;
  const list = await Store.snapshots.list().catch(() => null);
  if (BB.nav.current !== 'backup' || !el('snapList')) return;
  if (list === null || !(await Store.snapshots.available())) { box.innerHTML = '<div class="small muted">This browser doesn’t allow automatic copies. Use Back up now.</div>'; return; }
  if (!list.length) { box.innerHTML = '<div class="small muted">None yet — the first one is made the next time you open BowlBoard with games saved.</div>'; return; }
  box.innerHTML = list.map(x => '<div class="snap"><div class="grow"><div class="t">' + esc(REASON[x.reason] || x.reason) + '</div><div class="s">' + esc(whenLabel(x.at)) +
    (x.readable ? ' · ' + plural(x.games, 'game') + ', ' + plural(x.leagues, 'league') : '') + '</div></div>' +
    (x.readable ? '<button class="btn secondary small-btn" data-act="snapRestore" data-id="' + esc(x.id) + '">Restore</button>' : '<button class="btn secondary small-btn" data-act="snapDownload" data-id="' + esc(x.id) + '">Download</button>') + '</div>').join('');
}
ACT.backup = {
  snapRestore: async a => {
    const list = await Store.snapshots.list();
    const x = list.find(s => s.id === a.dataset.id);
    if (!x) return;
    if (!(await ask('Go back to the copy from ' + whenLabel(x.at) + '? What’s here now is copied first, so you can undo this.', 'Restore this copy', true))) return;
    const r = await Store.snapshots.restore(x.id);
    if (!r.ok) { toast(r.error, 4000); return; }
    toast('Restored ' + plural(r.games, 'game') + ' and ' + plural(r.leagues, 'league'));
    RENDER.backup();
  },
  snapDownload: async a => {
    const rec = await Store.snapshots.get(a.dataset.id);
    if (rec) download('bowlboard-copy-' + rec.at.slice(0, 10) + '.txt', rec.json, 'text/plain');
  },
};

/* ---------- install on the phone (PWA) ---------- */
// Works when the app is served from a web address (https or localhost), not from a
// file on disk and not inside the hosted preview, which can't run service workers.
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const canInstall = () => /^https?:$/.test(location.protocol) && !EMBED && 'serviceWorker' in navigator;
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; if (BB.nav.current === 'more') rerender(); });
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
  return item('phone', 'Install on your phone', 'Home-screen icon, opens full screen, works with no signal at the lanes', 'id="installApp"');
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
      '<p class="small muted">' + (EMBED ? 'This preview link can’t install apps or work offline.' : 'Opened as a file, the browser won’t install it.') + ' Your games stay wherever you first entered them, so move them with More → Backup & restore.</p>';
  } else if (ios) {
    body = '<ol class="steps"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button (square with an arrow).</li><li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>' +
      '<p class="small muted">BowlBoard then opens full screen from its icon and works without a signal.</p>';
  } else {
    body = '<ol class="steps"><li>Open your browser’s menu (⋮).</li><li>Choose <b>Install app</b> or <b>Add to Home screen</b>.</li></ol>' +
      '<p class="small muted">If you don’t see it, reload the page once and try again.</p>';
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

Object.assign(BB, { VERSION, installFlow });
})();
