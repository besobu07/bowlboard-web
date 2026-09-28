/* BowlBoard persistence — on-device store.
 *
 * Game/league data lives in one JSON document in localStorage; score-sheet photos
 * live in IndexedDB (Store.photos) so the JSON stays small. All reads go through
 * Store.state and all writes end in Store.save() / Store.saveSoon(), so swapping
 * this file for a cloud-backed version (accounts + sync) doesn't touch the screens.
 *
 * Safety net (v0.6):
 *   - Automatic copies (Store.snapshots) in IndexedDB: a rolling copy at most every
 *     12 hours, one after each league night, and one before anything that replaces
 *     or erases data (restore, erase, league delete/replace, data upgrades).
 *   - If the saved data can't be read, it is set aside (never overwritten) and
 *     Store.recovery describes what happened so the app can offer a restore.
 *
 * Schema v3:
 *   games[]   {id, date, centerId, ballId, lanes:[left,right], pattern, mode,
 *              frames | cumulative, total, seriesId, gameNo, leagueId, photoId,
 *              framesDerived, sample, createdAt, updatedAt}
 *   centers[] {id, name, city, sample}
 *   balls[]   {id, brand, name, cover, weight, custom, sample}
 *   leagues[] see js/league.js
 *   profile   {name, haptics}
 *   lastBackupAt, backupNudgeAt, backupPromptAt, leagueEditAt, seeded
 */
(function (global) {
  'use strict';

  const KEY = 'bowlboard.v2';        // storage key kept from v2 so existing data is found
  const OLD_KEY = 'bowlboard.v1';
  const VERSION = 3;

  // Local ids only. When accounts/sync arrive, the server should issue ids; don't
  // treat these as a global sync identity.
  function uid() {
    const c = global.crypto;
    if (c && typeof c.randomUUID === 'function') return 'id-' + c.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
  }

  function blank() {
    return { version: VERSION, profile: { name: '' }, games: [], centers: [], balls: [], leagues: [] };
  }

  // Only our own downscaled JPEG/PNG data URLs are ever rendered as <img src>.
  const IMG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
  function safeImage(src) { return typeof src === 'string' && IMG_RE.test(src) ? src : ''; }

  // "15-16", "15 & 16", "15" -> [15, 16] / [15]; anything else -> null
  function parseLanes(v) {
    if (Array.isArray(v)) return v.map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 2);
    const m = String(v || '').match(/(\d{1,3})(?:\s*[-–&/,]\s*|\s+)?(\d{1,3})?/);
    if (!m) return null;
    return [+m[1]].concat(m[2] ? [+m[2]] : []);
  }

  // v1 -> v2: alleys become centers, every game gets its own series.
  // v2 -> v3: lane text becomes numbers; photos move out to IndexedDB (async, see below).
  function migrate(s) {
    if (!s || typeof s !== 'object' || !Array.isArray(s.games)) return null;
    const out = Object.assign(blank(), s);
    // Drop anything that isn't a record rather than crash on it later.
    out.games = s.games.filter(g => g && typeof g === 'object' && g.id);
    if (!s.version || s.version < 2) {
      out.centers = Array.isArray(s.alleys) ? s.alleys : [];
      delete out.alleys;
      out.games = out.games.map(g => {
        const n = Object.assign({}, g);
        if (n.alleyId !== undefined) { n.centerId = n.alleyId; delete n.alleyId; }
        return n;
      });
    }
    out.version = VERSION;
    out.games.forEach(g => {
      if (!g.seriesId) { g.seriesId = g.id; g.gameNo = 1; }
      if (g.lane !== undefined) {
        const l = parseLanes(g.lane);
        if (l && l.length) g.lanes = l;
        else if (g.lane) g.laneNote = String(g.lane);
        delete g.lane;
      }
      if (g.thumb !== undefined && !safeImage(g.thumb)) delete g.thumb;
    });
    ['centers', 'balls', 'leagues'].forEach(k => { if (!Array.isArray(out[k])) out[k] = []; });
    ['centers', 'balls'].forEach(k => { out[k] = out[k].filter(x => x && typeof x === 'object' && x.id); });
    out.leagues = out.leagues.filter(l => l && typeof l === 'object' && l.id).map(l => {
      ['teams', 'bowlers', 'schedule'].forEach(k => { if (!Array.isArray(l[k])) l[k] = []; });
      if (!l.results || typeof l.results !== 'object') l.results = {};
      return l;
    });
    if (!out.profile || typeof out.profile !== 'object') out.profile = { name: '' };
    return out;
  }

  let storageOK = true;
  let recovery = null;      // set when saved data couldn't be read
  let blockSaves = false;   // true until unreadable data has been set aside somewhere
  let pendingRaw = null;    // raw text to copy into a snapshot once IndexedDB is up
  const UNREADABLE_KEY = KEY + '.unreadable';

  let unreadableRaw = null;
  function setAside(raw, why) {
    unreadableRaw = raw;
    let kept = false;
    try { localStorage.setItem(UNREADABLE_KEY, raw); kept = true; } catch (e) { /* storage full */ }
    recovery = { why, kept, at: new Date().toISOString(), bytes: raw.length };
    pendingRaw = { raw, reason: 'unreadable' };
    blockSaves = !kept; // never overwrite the only copy of someone's data
    return blank();
  }

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY) || localStorage.getItem(OLD_KEY); } catch (e) { storageOK = false; return blank(); }
    if (!raw) return blank();
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return setAside(raw, 'unreadable'); }
    let m;
    try { m = migrate(parsed); } catch (e) { return setAside(raw, 'unreadable'); }
    if (!m) return setAside(raw, 'not-bowlboard');
    if (!parsed.version || parsed.version < VERSION) pendingRaw = { raw, reason: 'before-upgrade' };
    return m;
  }

  const state = load();

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer); saveTimer = null;
    if (blockSaves) {
      storageOK = false;
      if (Store.onSaveError) Store.onSaveError(new Error('blocked until unreadable data is kept'));
      return false;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      storageOK = true;
      return true;
    } catch (e) {
      storageOK = false;
      if (Store.onSaveError) Store.onSaveError(e);
      return false;
    }
  }
  // Batch rapid edits (typing scores) into one write; flushed on navigation and page hide.
  function saveSoon(ms) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, ms == null ? 600 : ms);
  }
  function flush() { if (saveTimer) save(); }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    global.addEventListener && global.addEventListener('pagehide', flush);
  }

  function replaceState(next) {
    Object.keys(state).forEach(k => delete state[k]);
    Object.assign(state, next);
  }

  const byId = (arr, id) => arr.find(x => x.id === id);

  /* ---------- photos (IndexedDB; silently unavailable in some browsers) ---------- */
  const photos = (function () {
    let dbp = null;
    function db() {
      if (dbp) return dbp;
      dbp = new Promise(resolve => {
        try {
          const req = global.indexedDB.open('bowlboard-photos', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('photos');
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      });
      return dbp;
    }
    function run(mode, fn) {
      return db().then(d => new Promise(resolve => {
        if (!d) return resolve(null);
        try {
          const tx = d.transaction('photos', mode);
          const req = fn(tx.objectStore('photos'));
          tx.oncomplete = () => resolve(req && req.result !== undefined ? req.result : true);
          tx.onerror = tx.onabort = () => resolve(null);
        } catch (e) { resolve(null); }
      }));
    }
    return {
      put: (id, dataURL) => (safeImage(dataURL) ? run('readwrite', s => s.put(dataURL, id)) : Promise.resolve(null)),
      get: id => run('readonly', s => s.get(id)).then(v => safeImage(v) || null),
      del: id => run('readwrite', s => s.delete(id)),
    };
  })();

  /* ---------- automatic copies (IndexedDB) ---------- */
  function hash(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  // Retention: the newest 3 of each kind, plus anything from the last 24 hours (up to 30
  // copies), so a busy night or trying several copies in a row can't push out the one
  // you need. Unreadable data is kept until you deal with it.
  const KEEP_EACH = 3, KEEP_MAX = 30, YOUNG_MS = 24 * 36e5;
  const snapshots = (function () {
    let dbp = null;
    function db() {
      if (dbp) return dbp;
      dbp = new Promise(resolve => {
        try {
          const req = global.indexedDB.open('bowlboard-safety', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('snapshots', { keyPath: 'id' });
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      });
      return dbp;
    }
    function tx(mode, fn) {
      return db().then(d => new Promise(resolve => {
        if (!d) return resolve(null);
        try {
          const t = d.transaction('snapshots', mode);
          const req = fn(t.objectStore('snapshots'));
          t.oncomplete = () => resolve(req && req.result !== undefined ? req.result : true);
          t.onerror = t.onabort = () => resolve(null);
        } catch (e) { resolve(null); }
      }));
    }
    const meta = x => ({ id: x.id, at: x.at, reason: x.reason, games: x.games, leagues: x.leagues, bytes: x.bytes, readable: x.readable !== false });
    function all() { return tx('readonly', s => s.getAll()).then(r => (r || []).sort((a, b) => b.at.localeCompare(a.at))); }
    async function prune() {
      const list = await all();
      const drop = [];
      const seen = {};
      let kept = 0;
      const now = Date.now();
      list.forEach(x => {
        if (x.reason === 'unreadable') { kept++; return; }
        const n = (seen[x.reason] = (seen[x.reason] || 0) + 1);
        const young = now - new Date(x.at).getTime() < YOUNG_MS;
        if (n <= KEEP_EACH || (young && kept < KEEP_MAX)) { kept++; return; }
        drop.push(x.id);
      });
      if (drop.length) await tx('readwrite', s => { drop.forEach(id => s.delete(id)); return null; });
    }
    // Copy the current data (or a raw text) with a reason. If an identical copy is
    // already kept, that one is returned instead, unless force is set.
    async function take(reason, opts) {
      opts = opts || {};
      const json = opts.raw != null ? opts.raw : JSON.stringify(state);
      const h = hash(json);
      if (!opts.force) {
        const same = (await all()).find(x => x.hash === h);
        if (same) return meta(same);
      }
      let games = 0, leagues = 0, readable = true;
      try { const d = JSON.parse(json); games = (d.games || []).length; leagues = (d.leagues || []).length; } catch (e) { readable = false; }
      const now = new Date();
      const rec = { id: now.toISOString() + '-' + Math.floor(Math.random() * 1e6), at: now.toISOString(), reason, json, hash: h, games, leagues, bytes: json.length, readable };
      const ok = await tx('readwrite', s => s.put(rec));
      if (!ok) return null;
      await prune();
      return meta(rec);
    }
    return {
      take,
      list: () => all().then(l => l.map(meta)),
      get: id => tx('readonly', s => s.get(id)),
      // Rolling copy: at most one every 12 hours, only when there's something to keep.
      async auto() {
        if (!state.games.length && !state.leagues.length) return null;
        const last = (await all()).find(x => x.reason === 'auto');
        if (last && Date.now() - new Date(last.at).getTime() < 12 * 36e5) return null;
        return take('auto');
      },
      async restore(id) {
        const rec = await tx('readonly', s => s.get(id));
        if (!rec) return { ok: false, error: 'That copy is gone.' };
        let data;
        try { data = JSON.parse(rec.json); } catch (e) { return { ok: false, error: 'That copy can’t be read. Download it for support instead.' }; }
        let m = null;
        try { m = migrate(data); } catch (e) { /* treated as not BowlBoard data */ }
        if (!m) return { ok: false, error: 'That copy isn’t BowlBoard data.' };
        // Keep what's here first (even after unreadable data, anything entered since counts).
        if (state.games.length || state.leagues.length || state.balls.length || state.centers.length) {
          const kept = await take('before-restore');
          if (!kept) return { ok: false, error: 'Couldn’t keep a copy of what’s here first, so nothing was changed.' };
        }
        replaceState(m); blockSaves = false; recovery = null; syncLinks(); save();
        return { ok: true, games: m.games.length, leagues: m.leagues.length };
      },
      available: () => db().then(d => !!d),
    };
  })();
  // Copy the pre-upgrade or unreadable text into a snapshot as soon as IndexedDB is ready.
  function keepPendingRaw() {
    if (!pendingRaw) return Promise.resolve(null);
    const p = pendingRaw; pendingRaw = null;
    return snapshots.take(p.reason, { raw: p.raw, force: true }).then(m => {
      if (m && p.reason === 'unreadable' && recovery) { recovery.kept = true; blockSaves = false; }
      return m;
    });
  }
  if (typeof indexedDB !== 'undefined') setTimeout(keepPendingRaw, 0);

  // Move any photos still embedded in the JSON (v2 data) into IndexedDB.
  function movePhotosOut() {
    const pending = state.games.filter(g => g.thumb);
    pending.forEach(g => {
      photos.put(g.id, g.thumb).then(ok => {
        if (!ok) return; // no IndexedDB: keep the photo where it is rather than lose it
        g.photoId = g.id;
        delete g.thumb;
        saveSoon();
      });
    });
  }
  if (typeof indexedDB !== 'undefined') setTimeout(movePhotosOut, 0);

  /* ---------- personal <-> league link ---------- */
  // Keep league sheet slots in step with the games they're linked to.
  function syncLinks() {
    const LG = global.BBLeague;
    if (!LG || !state.leagues.length) return false;
    const map = {};
    state.games.forEach(g => { map[g.id] = g; });
    let changed = false;
    state.leagues.forEach(l => { if (LG.syncLinks(l, map)) changed = true; });
    return changed;
  }

  const Store = {
    state, save, saveSoon, flush, uid, migrate, safeImage, parseLanes, photos, syncLinks, snapshots, keepPendingRaw,
    get storageOK() { return storageOK; },
    get recovery() { return recovery; },
    // "Start fresh" after unreadable data: the unreadable text stays set aside.
    dismissRecovery() { recovery = null; blockSaves = false; save(); },
    unreadableText() { let t = null; try { t = localStorage.getItem(UNREADABLE_KEY); } catch (e) { /* ignore */ } return t || unreadableRaw; },
    onSaveError: null,
    // League changes in this session (the app offers a backup after league night).
    sessionLeagueEdit: false,
    markLeagueEdit(l) {
      if (l && l.sample) return;
      state.leagueEditAt = new Date().toISOString();
      Store.sessionLeagueEdit = true;
    },

    /* games */
    getGame(id) { return byId(state.games, id); },
    addGame(g) {
      g.id = g.id || uid();
      g.createdAt = g.createdAt || new Date().toISOString();
      if (!g.seriesId) { g.seriesId = g.id; g.gameNo = 1; }
      state.games.unshift(g); syncLinks(); save(); return g;
    },
    updateGame(id, patch) {
      const g = byId(state.games, id);
      if (!g) return null;
      Object.assign(g, patch, { updatedAt: new Date().toISOString() });
      syncLinks(); save(); return g;
    },
    deleteGame(id) {
      const g = byId(state.games, id);
      state.games = state.games.filter(x => x.id !== id);
      if (g) {
        Store.seriesGames(g.seriesId).forEach((x, i) => { x.gameNo = i + 1; });
        if (g.photoId) photos.del(g.photoId);
      }
      syncLinks(); save();
    },
    seriesGames(seriesId, games) {
      return (games || state.games).filter(g => g.seriesId === seriesId).sort((a, b) => (a.gameNo || 1) - (b.gameNo || 1));
    },
    // Games grouped into series, newest first.
    allSeries(games) {
      const map = new Map();
      (games || state.games).forEach(g => {
        if (!map.has(g.seriesId)) map.set(g.seriesId, []);
        map.get(g.seriesId).push(g);
      });
      return Array.from(map.values()).map(list => {
        list.sort((a, b) => (a.gameNo || 1) - (b.gameNo || 1));
        const scored = list.filter(g => g.total != null);
        return {
          id: list[0].seriesId, games: list, date: list[0].date, centerId: list[0].centerId,
          leagueId: list[0].leagueId || '', sheet: !!list[0].sheet, week: list[0].week,
          total: scored.length ? scored.reduce((a, g) => a + g.total, 0) : null,
          createdAt: list.reduce((m, g) => ((g.createdAt || '') > m ? g.createdAt : m), ''),
        };
      }).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt.localeCompare(a.createdAt));
    },

    /* centers */
    addCenter(name, city, extra) {
      const a = Object.assign({ id: uid(), name, city: city || '' }, extra || {});
      state.centers.push(a); save(); return a;
    },
    deleteCenter(id) {
      if (state.games.some(g => g.centerId === id)) return false;
      if (state.leagues.some(l => l.centerId === id)) return false;
      state.centers = state.centers.filter(a => a.id !== id);
      save(); return true;
    },
    centerName(id) {
      const a = byId(state.centers, id);
      return a ? a.name : '—';
    },

    /* balls */
    addBall(ball) {
      const b = Object.assign({ id: uid(), custom: true }, ball);
      state.balls.push(b); save(); return b;
    },
    deleteBall(id) {
      if (state.games.some(g => g.ballId === id)) return false;
      state.balls = state.balls.filter(b => b.id !== id);
      save(); return true;
    },
    ballLabel(id) {
      const b = byId(state.balls, id);
      return b ? (b.brand + ' ' + b.name + (b.weight ? ' (' + b.weight + ' lb)' : '')) : 'House ball';
    },

    /* leagues */
    getLeague(id) { return byId(state.leagues, id); },
    addLeague(l) {
      l.id = l.id || uid();
      const have = byId(state.leagues, l.id);
      if (have) return have; // a double tap must not add the same league twice
      state.leagues.push(l); save(); return l;
    },
    deleteLeague(id) {
      snapshots.take('before-league-delete', { force: true });
      state.leagues = state.leagues.filter(l => l.id !== id);
      state.games.forEach(g => { if (g.leagueId === id) g.leagueId = ''; }); // your own games stay, as practice
      save();
    },

    /* backup / restore (photos stay on the device and aren't part of the backup) */
    exportJSON() {
      flush();
      return JSON.stringify({ app: 'BowlBoard', exportedAt: new Date().toISOString(), data: state }, null, 2);
    },
    markBackedUp() { state.lastBackupAt = new Date().toISOString(); save(); },
    // Is this text a BowlBoard backup? (Checked before anything is copied or replaced.)
    checkBackup(text) {
      let parsed;
      try { parsed = JSON.parse(text); } catch (e) { return { ok: false, error: 'That file is not valid JSON.' }; }
      const data = parsed && parsed.data ? parsed.data : parsed;
      let m = null;
      try { m = migrate(JSON.parse(JSON.stringify(data))); } catch (e) { /* not a backup */ }
      if (!m) return { ok: false, error: 'That file is not a BowlBoard backup.' };
      return { ok: true, games: m.games.length, leagues: m.leagues.length };
    },
    // Restoring replaces everything, so an automatic copy of what's here is taken first
    // (callers that can wait should await Store.snapshots.take('before-restore') before this).
    importJSON(text) {
      let parsed;
      try { parsed = JSON.parse(text); } catch (e) { return { ok: false, error: 'That file is not valid JSON.' }; }
      const data = parsed && parsed.data ? parsed.data : parsed;
      let m = null;
      try { m = migrate(data); } catch (e) { /* treated as not a backup */ }
      if (!m) return { ok: false, error: 'That file is not a BowlBoard backup.' };
      replaceState(m); blockSaves = false; recovery = null; syncLinks(); save();
      return { ok: true, games: m.games.length, leagues: m.leagues.length };
    },
    resetAll() { replaceState(blank()); save(); },
  };

  global.BBStore = Store;
  if (typeof module !== 'undefined' && module.exports) module.exports = Store;
})(typeof window !== 'undefined' ? window : globalThis);
