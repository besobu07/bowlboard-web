/* BowlBoard — start-up: sample data for the playable builds, the rolling automatic
 * copy, and the first screen. Loaded last. */
(function () {
'use strict';
const BB = window.BB;
const Store = window.BBStore, Sample = window.BBSample, S = window.BBScore, LG = window.BBLeague;

// Playable builds start with clearly labelled sample data (never over unreadable data).
if (BB.BUILD.seed && !Store.recovery && !Store.state.seeded && !Store.state.games.length && !Store.state.leagues.length) {
  try { Sample.seed(Store, S, LG, BB.todayISO()); } catch (e) { /* samples are optional */ }
}

Store.onSaveError = () => BB.toast(Store.recovery ? 'Not saving until the unreadable data is dealt with — see Home.' : 'Could not save — phone storage is full or blocked. Back up from More.', 5000);
try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* a request, not a guarantee */ }

// Rolling automatic copy (at most every 12 hours), once the page has settled.
setTimeout(() => { if (!Store.recovery) Store.snapshots.auto(); }, 1500);

// Test hooks
window.BBEntry = () => BB.entry;
window.BBScanTest = { checkRunning: BB.checkRunning };

document.addEventListener('DOMContentLoaded', () => BB.show('home'));
})();
