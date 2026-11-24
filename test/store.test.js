// Node tests for saving: unreadable data, data upgrades, old backups. Run: node test_store.js
// (Automatic copies use IndexedDB, which is tested in the browser: test_ui.js.)
const path = require('path');
let pass = 0, fail = 0;
function eq(actual, expected, name) {
  const ok = typeof expected === 'object' ? JSON.stringify(actual) === JSON.stringify(expected) : actual === expected;
  if (ok) pass++; else { fail++; console.log('FAIL', name, '- expected', JSON.stringify(expected), 'got', JSON.stringify(actual)); }
}
function fakeStorage(init, quota) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (quota != null && String(v).length > quota) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } m.set(k, String(v)); },
    removeItem: k => m.delete(k),
    _m: m,
  };
}
// Load a fresh copy of store.js against the given storage.
function boot(storage) {
  globalThis.localStorage = storage;
  const p = path.resolve(__dirname, '../js/store.js');
  delete require.cache[p];
  return require(p);
}
const KEY = 'bowlboard.v2';

(async () => {
  // 1. nothing saved: a clean start
  let st = boot(fakeStorage());
  eq([st.recovery, st.state.games.length, st.state.version], [null, 0, 3], 'fresh start');

  // 2. unreadable JSON is set aside, never overwritten
  let ls = fakeStorage({ [KEY]: '{"games":[{"id":"g1","total":2' });
  st = boot(ls);
  eq([st.recovery.why, st.recovery.kept], ['unreadable', true], 'unreadable data detected and kept');
  eq(ls.getItem(KEY + '.unreadable'), '{"games":[{"id":"g1","total":2', 'the unreadable text is kept word for word');
  eq(st.unreadableText().length, 30, 'the app can hand it back for support');
  st.state.games.push({ id: 'n1', total: 150 });
  eq(st.save(), true, 'once it is set aside, saving carries on');
  st.dismissRecovery();
  eq(st.recovery, null, 'start fresh clears the warning');
  eq(ls.getItem(KEY + '.unreadable') !== null, true, 'and the unreadable copy stays');

  // 3. if there's no room to set it aside, nothing is saved over it
  ls = fakeStorage({ [KEY]: 'x'.repeat(50) + '{' }, 40);
  st = boot(ls);
  eq([st.recovery.why, st.recovery.kept], ['unreadable', false], 'no room to keep a copy');
  eq(st.save(), false, 'saving is blocked');
  eq(ls.getItem(KEY), 'x'.repeat(50) + '{', 'the original is untouched');

  // 4. valid JSON that isn't BowlBoard data
  st = boot(fakeStorage({ [KEY]: '{"hello":1}' }));
  eq(st.recovery.why, 'not-bowlboard', 'not BowlBoard data is caught too');

  // 5. damaged records are dropped, not crashed on
  st = boot(fakeStorage({ [KEY]: JSON.stringify({ version: 3, games: [{ id: 'a', total: 180 }, null, 7, { total: 1 }], centers: [null], balls: 'x', leagues: [{ id: 'L', name: 'Mon' }, 5] }) }));
  eq([st.recovery, st.state.games.length, st.state.centers.length, st.state.balls.length], [null, 1, 0, 0], 'bad records dropped');
  eq([st.state.leagues.length, st.state.leagues[0].teams, st.state.leagues[0].results], [1, [], {}], 'a league missing parts gets empty ones');

  // 6. restoring an old (v1) backup file
  st = boot(fakeStorage());
  const v1 = JSON.stringify({ app: 'BowlBoard', data: { games: [{ id: 'g1', date: '2025-01-02', alleyId: 'a1', total: 180, lane: '21-22', thumb: 'javascript:alert(1)' }], alleys: [{ id: 'a1', name: 'Old Lanes' }], balls: [] } });
  const r = st.importJSON(v1);
  eq([r.ok, r.games], [true, 1], 'old backup restores');
  eq([st.state.games[0].centerId, st.centerName('a1'), st.state.games[0].lanes, st.state.games[0].thumb], ['a1', 'Old Lanes', [21, 22], undefined], 'and is brought up to date');
  eq(st.importJSON('not json').ok, false, 'a broken backup file is refused');
  eq(st.importJSON('{"foo":1}').error, 'That file is not a BowlBoard backup.', 'a file that isn’t a backup is refused with a message');

  // 7. league edits are noted (so the app can offer a backup), sample leagues aren't
  st = boot(fakeStorage());
  st.markLeagueEdit({ sample: true });
  eq(st.state.leagueEditAt, undefined, 'sample league edits are ignored');
  st.markLeagueEdit({ name: 'Mon' });
  eq([typeof st.state.leagueEditAt, st.sessionLeagueEdit], ['string', true], 'real league edits are noted');

  // 8. without IndexedDB, automatic copies quietly do nothing
  eq(await st.snapshots.take('auto'), null, 'no IndexedDB: no copy, no crash');
  eq(await st.snapshots.available(), false, 'and the app can tell');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(2); });
