/* BowlBoard Accounts Beta — Supabase auth + whole-state cloud sync.
 *
 * This is deliberately small for the private beta: one JSON document per user,
 * protected by Supabase RLS. BowlBoard remains local-first; cloud sync is a
 * backup/second-device layer, not a replacement for the local store.
 *
 * Configure with window.BB_SUPABASE = { url: 'https://YOUR_PROJECT.supabase.co', anonKey: 'YOUR_ANON_KEY' }.
 */
(function (global) {
  'use strict';

  const CFG = global.BB_SUPABASE || {};
  const configured = !!(CFG.url && CFG.anonKey && !String(CFG.url).includes('YOUR_PROJECT') && !String(CFG.anonKey).includes('YOUR_'));
  const client = configured && global.supabase ? global.supabase.createClient(CFG.url, CFG.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  }) : null;

  let user = null;
  let syncing = false;
  let suspended = false;
  let timer = null;
  let lastCloudAt = null;
  let reconciling = false;
  const listeners = [];

  function emit() { listeners.forEach(fn => { try { fn(api); } catch (e) {} }); }
  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; }
  function email() { return user && user.email ? user.email : ''; }
  function displayName() { return user && ((user.user_metadata && (user.user_metadata.display_name || user.user_metadata.full_name)) || '') || ''; }
  function status() {
    if (!configured) return { configured: false, signedIn: false, syncing: false, label: 'Accounts beta needs setup' };
    if (!user) return { configured: true, signedIn: false, syncing, label: 'Not signed in' };
    return { configured: true, signedIn: true, syncing, email: email(), name: displayName(), cloudAt: lastCloudAt, label: syncing ? 'Syncing…' : 'Signed in' };
  }

  async function signUp(address, password, name) {
    if (!client) throw new Error('Accounts beta is not connected yet.');
    const r = await client.auth.signUp({ email: address.trim(), password, options: { data: { display_name: name.trim() } } });
    if (r.error) throw r.error;
    user = r.data.user || null;
    emit();
    return r.data;
  }
  async function signIn(address, password) {
    if (!client) throw new Error('Accounts beta is not connected yet.');
    const r = await client.auth.signInWithPassword({ email: address.trim(), password });
    if (r.error) throw r.error;
    user = r.data.user || null;
    emit();
    return r.data;
  }
  async function signOut() {
    if (!client) return;
    clearTimeout(timer); timer = null;
    const r = await client.auth.signOut();
    if (r.error) throw r.error;
    user = null; lastCloudAt = null; emit();
  }
  async function resetPassword(address) {
    if (!client) throw new Error('Accounts beta is not connected yet.');
    const r = await client.auth.resetPasswordForEmail(address.trim(), { redirectTo: global.location.origin + global.location.pathname });
    if (r.error) throw r.error;
  }

  function payload() {
    const Store = global.BBStore;
    Store.flush();
    return JSON.parse(JSON.stringify(Store.state));
  }

  async function fetchCloud() {
    if (!client || !user) return null;
    const r = await client.from('bowlboard_data').select('data,updated_at').eq('user_id', user.id).maybeSingle();
    if (r.error) throw r.error;
    if (!r.data) return null;
    lastCloudAt = r.data.updated_at || null;
    return { data: r.data.data, updatedAt: r.data.updated_at };
  }

  async function pushCloud() {
    if (!client || !user || syncing || suspended) return false;
    syncing = true; emit();
    try {
      const data = payload();
      const now = new Date().toISOString();
      const r = await client.from('bowlboard_data').upsert({ user_id: user.id, data, updated_at: now }, { onConflict: 'user_id' });
      if (r.error) throw r.error;
      lastCloudAt = now;
      return true;
    } finally {
      syncing = false; emit();
    }
  }

  function schedulePush() {
    if (!user || suspended) return;
    clearTimeout(timer);
    timer = setTimeout(() => pushCloud().catch(err => {
      global.BB && global.BB.toast && global.BB.toast('Cloud sync failed — your local data is safe.', 4000);
      if (global.console) console.warn('[BowlBoard] cloud sync failed', err);
    }), 1400);
  }

  async function replaceLocal(data) {
    const Store = global.BBStore;
    const m = Store.migrate(JSON.parse(JSON.stringify(data)));
    if (!m) throw new Error('The cloud copy is not valid BowlBoard data.');
    suspended = true;
    try {
      await Store.snapshots.take('before-cloud-restore', { force: true });
      Store.replaceState ? Store.replaceState(m) : Object.keys(Store.state).forEach(k => delete Store.state[k]);
      if (!Store.replaceState) Object.assign(Store.state, m);
      Store.save();
    } finally { suspended = false; }
  }

  async function pullCloud() {
    const row = await fetchCloud();
    if (!row) return { found: false };
    await replaceLocal(row.data);
    return { found: true, updatedAt: row.updatedAt };
  }

  async function reconcileAfterLogin() {
    if (!user) return { action: 'none' };
    if (reconciling) return { action: 'busy' };
    reconciling = true;
    try {
    const cloud = await fetchCloud();
    const Store = global.BBStore;
    const localHas = Store.state.games.length || Store.state.leagues.length || Store.state.centers.length || Store.state.balls.length;
      if (!cloud) {
        await pushCloud();
        return { action: 'uploaded-local' };
      }
      const cloudData = cloud.data || {};
      const cloudHas = (cloudData.games || []).length || (cloudData.leagues || []).length || (cloudData.centers || []).length || (cloudData.balls || []).length;
      if (!localHas) {
        await replaceLocal(cloudData);
        return { action: 'downloaded-cloud' };
      }
      return { action: 'conflict', cloud, localHas: true, cloudHas: !!cloudHas };
    } finally {
      reconciling = false;
    }
  }

  function init() {
    if (!client) { emit(); return; }
    client.auth.getSession().then(({ data }) => {
      user = data && data.session ? data.session.user : null;
      emit();
      if (user) reconcileAfterLogin().then(r => {
        if (r.action === 'conflict' && global.BB && global.BB.accountConflictSheet) global.BB.accountConflictSheet(r.cloud);
        else if (global.BB && global.BB.rerender) global.BB.rerender();
      }).catch(err => { if (global.console) console.warn('[BowlBoard] login reconciliation failed', err); });
    }).catch(() => emit());
    client.auth.onAuthStateChange((event, session) => {
      user = session ? session.user : null;
      emit();
    });
    const Store = global.BBStore;
    if (Store) Store.onSave = () => { if (!suspended) schedulePush(); };
  }

  const api = {
    configured, client, onChange, status, signUp, signIn, signOut, resetPassword,
    pushCloud, pullCloud, fetchCloud, reconcileAfterLogin, init,
    get user() { return user; },
    get email() { return email(); },
    get displayName() { return displayName(); },
    get syncing() { return syncing; },
  };
  global.BBAccount = api;
})(typeof window !== 'undefined' ? window : globalThis);
