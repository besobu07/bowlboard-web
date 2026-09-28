/* BowlBoard persistence — on-device store (prototype).
 *
 * Game/league data lives in one JSON document in localStorage; score-sheet photos
 * live in IndexedDB (Store.photos) so the JSON stays small. All reads go through
 * Store.state and all writes end in Store.save() / Store.saveSoon(), so swapping
 * this file for a cloud-backed version (accounts + sync) doesn't touch the screens.
 *
 * Schema v3:
 *   games[]   {id, date, centerId, ballId, lanes:[left,right], pattern, mode,
 *              frames | cumulative, total, seriesId, gameNo, leagueId, photoId,
 *              framesDerived, sample, createdAt, updatedAt}
 *   centers[] {id, name, city, sample}
 *   balls[]   {id, brand, name, cover, weight, custom, sample}
 *   leagues[] see js/league.js
 *   lastBackupAt, backupNudgeAt, seeded
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
    if (!s.version || s.version < 2) {
      out.centers = Array.isArray(s.alleys) ? s.alleys : [];
      delete out.alleys;
      out.games = s.games.map(g => {
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
    if (!out.profile) out.profile = { name: '' };
    return out;
  }

  let storageOK = true;
  function load() {
    try {
      const raw = localStorage.getItem(KEY) || localStorage.getItem(OLD_KEY);
      if (raw) {
        const m = migrate(JSON.parse(raw));
        if (m) return m;
      }
    } catch (e) { storageOK = false; }
    return blank();
  }

  const state = load();

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer); saveTimer = null;
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
    state, save, saveSoon, flush, uid, migrate, safeImage, parseLanes, photos, syncLinks,
    get storageOK() { return storageOK; },
    onSaveError: null,

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
    addLeague(l) { l.id = l.id || uid(); state.leagues.push(l); save(); return l; },
    deleteLeague(id) {
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
    importJSON(text) {
      let parsed;
      try { parsed = JSON.parse(text); } catch (e) { return { ok: false, error: 'That file is not valid JSON.' }; }
      const data = parsed && parsed.data ? parsed.data : parsed;
      const m = migrate(data);
      if (!m) return { ok: false, error: 'That file is not a BowlBoard backup.' };
      replaceState(m); syncLinks(); save();
      return { ok: true, games: m.games.length, leagues: m.leagues.length };
    },
    resetAll() { replaceState(blank()); save(); },
  };

  global.BBStore = Store;
})(typeof window !== 'undefined' ? window : globalThis);
