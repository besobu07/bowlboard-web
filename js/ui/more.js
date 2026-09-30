/* BowlBoard — More: equipment (balls, centers), data (backup & restore, automatic
 * copies), app settings, install on the phone, about. */
(function () {
'use strict';
const BB = window.BB;
const Store = window.BBStore, LG = window.BBLeague, Sample = window.BBSample, S = window.BBScore;
const { RENDER, ACT, EMBED, esc, fmtDate, todayISO, icon, el, on, val, show, toast, ask, openSheet, closeSheet, screenRoot, rerender, backLink, avgFloor, plural, download, backupStatus, backupNow, scoredGames } = BB;
const VERSION = '1.3.0 Accounts Beta';
const Account = window.BBAccount;

const item = (ic, t, s, attrs) => '<button class="list-item nav-item" ' + attrs + '><span class="li-ic">' + icon(ic) + '</span><div class="grow"><div class="t">' + t + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div><span class="chev" aria-hidden="true">' + icon('chevron') + '</span></button>';

function accountItem() {
  const a = Account && Account.status ? Account.status() : { configured: false, signedIn: false };
  if (!a.configured) return item('user', 'Account', 'Accounts beta not connected yet', 'id="accountOpen"');
  if (!a.signedIn) return item('user', 'Create account / Sign in', 'Sync your bowling history across devices', 'id="accountOpen"');
  return item('check', 'Signed in as ' + esc(a.name || a.email), a.syncing ? 'Syncing your bowling history…' : 'Cloud sync is on', 'id="accountOpen"');
}

function accountError(e) {
  const m = String((e && e.message) || e || '');
  if (/invalid login credentials/i.test(m)) return 'Email or password is incorrect';
  if (/user already registered/i.test(m)) return 'That email already has a BowlBoard account';
  return m || 'Account action failed';
}

async function finishAccountLogin() {
  try {
    const r = await Account.reconcileAfterLogin();
    if (r.action === 'conflict') BB.accountConflictSheet(r.cloud);
    else if (r.action === 'uploaded-local') toast('Your bowling history is now backed up to your account', 3500);
    else if (r.action === 'downloaded-cloud') toast('Your bowling history is ready');
    rerender();
  } catch (e) { toast('Account connected, but sync needs another try'); }
}

function accountSheet() {
  if (!Account || !Account.status().configured) {
    openSheet('<h3>Accounts beta</h3><p class="muted">The account experience is wired in, but this build is not connected to the BowlBoard beta server yet.</p><p class="small">Add the Supabase Project URL and anon/publishable key to <code>js/config.js</code>. Your local data is unchanged.</p><button class="btn" data-close>Close</button>');
    return;
  }
  const st = Account.status();
  if (st.signedIn) {
    openSheet('<h3>Your BowlBoard account</h3><div class="card compact"><strong>' + esc(st.name || 'BowlBoard bowler') + '</strong><div class="small muted mt4">' + esc(st.email) + '</div><div class="small muted mt4">' + (st.syncing ? 'Syncing…' : 'Cloud sync is on') + '</div></div>' +
      '<div class="row mt12"><button class="btn secondary grow" id="accountSync">Sync now</button><button class="btn danger grow" id="accountSignOut">Sign out</button></div>' +
      '<p class="small muted mt12">Your score history syncs to your account. Score-sheet photos remain on this device during the beta.</p>', sh => {
        sh.querySelector('#accountSync').addEventListener('click', async () => { try { await Account.pushCloud(); toast('BowlBoard is synced'); closeSheet(); rerender(); } catch (e) { toast('Couldn’t sync right now'); } });
        sh.querySelector('#accountSignOut').addEventListener('click', async () => { try { await Account.signOut(); toast('Signed out — your local data stays on this device'); closeSheet(); rerender(); } catch (e) { toast(e.message || 'Couldn’t sign out'); } });
      });
    return;
  }
  openSheet('<h3>BowlBoard account</h3><p class="muted">Create an account to keep your bowling history with you across devices.</p>' +
    '<div class="segmented"><button class="active" id="acctTabCreate" type="button">Create account</button><button id="acctTabSignIn" type="button">Sign in</button></div>' +
    '<div id="acctCreateForm"><label class="field">Name<input type="text" id="acctName" autocomplete="name" placeholder="First name or nickname"></label><label class="field">Email<input type="email" id="acctEmail" autocomplete="email" inputmode="email" placeholder="you@example.com"></label><label class="field">Password<input type="password" id="acctPassword" autocomplete="new-password" placeholder="At least 6 characters"></label><button class="btn" id="acctCreate">Create account</button></div>' +
    '<div id="acctSignInForm" hidden><label class="field">Email<input type="email" id="acctLoginEmail" autocomplete="email" inputmode="email"></label><label class="field">Password<input type="password" id="acctLoginPassword" autocomplete="current-password"></label><button class="btn" id="acctLogin">Sign in</button><button class="link-btn mt8" id="acctReset">Forgot password?</button></div>' +
    '<p class="small muted mt12">For the private beta, account data is separated by user. BowlBoard stays usable offline.</p>', sh => {
      const create = sh.querySelector('#acctCreateForm'), login = sh.querySelector('#acctSignInForm'), ctab = sh.querySelector('#acctTabCreate'), ltab = sh.querySelector('#acctTabSignIn');
      const setTab = c => { create.hidden = !c; login.hidden = c; ctab.classList.toggle('active', c); ltab.classList.toggle('active', !c); };
      ctab.addEventListener('click', () => setTab(true)); ltab.addEventListener('click', () => setTab(false));
      sh.querySelector('#acctCreate').addEventListener('click', async () => {
        const name = sh.querySelector('#acctName').value.trim(), email = sh.querySelector('#acctEmail').value.trim(), pw = sh.querySelector('#acctPassword').value;
        if (!name || !email || pw.length < 6) { toast('Enter a name, email and password'); return; }
        try { const r = await Account.signUp(email, pw, name); if (r.session) { toast('Account created'); closeSheet(); await finishAccountLogin(); } else { toast('Check your email to confirm your account', 5000); closeSheet(); rerender(); } } catch (e) { toast(accountError(e)); }
      });
      sh.querySelector('#acctLogin').addEventListener('click', async () => {
        const email = sh.querySelector('#acctLoginEmail').value.trim(), pw = sh.querySelector('#acctLoginPassword').value;
        if (!email || !pw) { toast('Enter your email and password'); return; }
        try { await Account.signIn(email, pw); toast('Signed in'); closeSheet(); await finishAccountLogin(); } catch (e) { toast(accountError(e)); }
      });
      sh.querySelector('#acctReset').addEventListener('click', async () => {
        const email = sh.querySelector('#acctLoginEmail').value.trim();
        if (!email) { toast('Enter your email first'); return; }
        try { await Account.resetPassword(email); toast('Password reset email sent'); } catch (e) { toast(accountError(e)); }
      });
    });
}

BB.accountConflictSheet = function (cloud) {
  const n = (cloud && cloud.data && cloud.data.games || []).length;
  openSheet('<h3>Choose your bowling history</h3><p class="muted">This device already has bowling data, and this account has a cloud copy. BowlBoard won’t silently overwrite either one.</p>' +
    '<div class="card"><strong>This device</strong><div class="small muted mt4">Your current games and settings</div></div><div class="card"><strong>Cloud copy</strong><div class="small muted mt4">' + n + ' game' + (n === 1 ? '' : 's') + ' · last updated ' + esc(cloud.updatedAt ? new Date(cloud.updatedAt).toLocaleString() : 'recently') + '</div></div>' +
    '<div class="row mt12"><button class="btn secondary grow" id="useDevice">Keep this device</button><button class="btn grow" id="useCloud">Use cloud copy</button></div><p class="small muted mt12">Choosing the cloud copy first creates a local safety snapshot. Choosing this device uploads it to your account.</p>', sh => {
      sh.querySelector('#useDevice').addEventListener('click', async () => { try { await Account.pushCloud(); closeSheet(); toast('This device is now the cloud copy'); rerender(); } catch (e) { toast('Couldn’t upload this device'); } });
      sh.querySelector('#useCloud').addEventListener('click', async () => { try { await Account.pullCloud(); closeSheet(); toast('Cloud history loaded'); rerender(); } catch (e) { toast('Couldn’t load the cloud copy'); } });
    });
};


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
    item('upload', 'Import my scores', 'From a CSV or Excel file: date and score per row', 'id="moreImportScores"') +
    item('download', 'Export my games', 'Excel, CSV or a printable PDF report', 'id="moreExport"') +
    item('upload', 'Import a league', 'From a LeagueSecretary or BLS weekly-scores file', 'id="moreImport"') +
    (Sample.has(Store) ? '' : item('sparkle', 'Load sample data', 'Example games and a demo league, labelled and removable', 'id="loadSamples"'));
  h += '<h3 class="group-title">Account</h3>' + accountItem() +
    '<h3 class="group-title">App</h3>' +
    item('user', 'Your name', prof.name ? esc(prof.name) : 'For the greeting on Home', 'id="setName"') +
    '<label class="list-item toggle-item"><span class="li-ic">' + icon('vibrate') + '</span><div class="grow"><div class="t">Vibrate on taps</div><div class="s">Pins, strikes and spares (phones that support it)</div></div>' +
    '<input type="checkbox" class="switch" id="setHaptics"' + (prof.haptics === false ? '' : ' checked') + '></label>' +
    installItemHTML();
  h += item('mail', 'Contact us', 'Questions, ideas or a problem? hello@bowlboard.app', 'id="contactUs"');
  h += '<div class="about"><img class="about-icon" src="app-icon.png" alt=""><img class="about-wordmark" src="wordmark.png" alt="BowlBoard"><p class="tagline">Built for Bowlers</p><p class="small muted">BowlBoard ' + VERSION + ' · <a href="https://bowlboard.app" target="_blank" rel="noopener">bowlboard.app</a> · your data stays on this device</p></div>';
  screenRoot().innerHTML = h;
  on('installApp', 'click', installFlow);
  on('contactUs', 'click', () => { const u = 'mailto:hello@bowlboard.app?subject=' + encodeURIComponent('BowlBoard ' + VERSION); if (EMBED) BB.copyText('hello@bowlboard.app').then(ok => toast(ok ? 'Email address copied: hello@bowlboard.app' : 'Email us at hello@bowlboard.app', 4000)); else window.location.href = u; });
  on('moreImportScores', 'click', () => BB.importScoresSheet());
  on('moreExport', 'click', () => BB.exportSheet());
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
  on('accountOpen', 'click', accountSheet);
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
    return '<div class="list-item"><button class="ball-open" data-act="openBall" data-id="' + b.id + '"><span class="li-ic ball">' + BB.ballIcon(b.brand) + '</span><div class="grow"><div class="t">' + esc(b.brand + ' ' + b.name) + (b.sample ? ' <span class="seed-tag">sample</span>' : '') + '</div>' +
      '<div class="s">' + esc([b.weight ? b.weight + ' lb' : null, b.cover].filter(Boolean).join(' · ')) +
      (gs.length ? ' · ' + plural(gs.length, 'game') + ' · avg ' + avgFloor(gs.map(g => g.total)) : '') + '</div></div></button>' +
      (!used ? '<button class="btn danger" data-act="delBall" data-id="' + b.id + '" aria-label="Remove ' + esc(b.name) + '">✕</button>' : '') + '</div>';
  }).join('') : '<div class="empty">No balls yet — add your arsenal below.</div>';
  h += '<div class="card"><h3>Add a ball</h3>' + BB.ballFormHTML('ba') + '<button class="btn mt8" id="baAdd">Add to arsenal</button></div>';
  const root = screenRoot();
  root.innerHTML = h;
  BB.bindBallForm(root, 'ba');
  on('baAdd', 'click', () => {
    const r = BB.readBallForm(root, 'ba');
    if (r.error) { toast(r.error); return; }
    Store.addBall(r.ball);
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
