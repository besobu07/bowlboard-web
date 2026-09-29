/* BowlBoard — Achievements: the badge screen, the summary card on Stats and the note after
 * saving a game that earned one. The badges themselves are worked out from your games
 * (js/achievements.js); the only thing kept is which ones you've already been shown. */
(function () {
'use strict';
const BB = window.BB;
const Store = window.BBStore, A = window.BBAchievements;
const { RENDER, ACT, esc, fmtDate, icon, on, show, screenRoot, backLink, plural, openSheet, closeSheet } = BB;

const evaluate = games => A.evaluate(games || BB.gamePool().games);
const seenSet = () => new Set((Store.state.profile || {}).achSeen || []);
function markSeen(ids) {
  const seen = seenSet();
  const before = seen.size;
  ids.forEach(id => seen.add(id));
  if (seen.size === before) return;
  Store.state.profile = Object.assign({}, Store.state.profile, { achSeen: Array.from(seen) });
  Store.save();
}

// A round gold coin for earned badges, a dashed grey one for the rest. Numbers where the badge is a number.
function coin(a, size) {
  const inner = a.mark ? '<b' + (a.mark.length > 3 ? ' class="sm"' : '') + '>' + esc(a.mark) + '</b>' + (a.sub ? '<small>' + esc(a.sub) + '</small>' : '') : icon(a.icon || 'medal');
  return '<span class="coin' + (a.earned ? ' on' : '') + (size ? ' ' + size : '') + '" aria-hidden="true">' + inner + '</span>';
}
const pctDone = a => (a.earned ? 100 : a.progress && a.progress.need ? Math.max(0, Math.min(100, Math.round(a.progress.have / a.progress.need * 100))) : 0);
const bar = pct => '<div class="bar" role="presentation"><i style="width:' + pct + '%"></i></div>';

/* ---------- the summary card on Stats ---------- */
function cardHTML() {
  const pool = BB.gamePool();
  if (!pool.games.length) return '';
  const res = evaluate(pool.games);
  const seen = seenSet();
  const fresh = res.list.filter(a => a.earned && !seen.has(a.id)).length;
  const recent = A.tops(res.list.filter(a => a.earned)).sort((x, y) => y.earned.date.localeCompare(x.earned.date) || res.list.indexOf(y) - res.list.indexOf(x)).slice(0, 5);
  const nxt = A.next(res);
  return '<div class="card ach-card"><div class="ach-head"><h3>' + icon('medal') + 'Achievements</h3><span class="ach-count"><b>' + res.earned + '</b> of ' + res.total + (fresh ? ' <span class="badge">' + fresh + ' new</span>' : '') + '</span></div>' +
    bar(Math.round(res.earned / res.total * 100)) +
    (recent.length ? '<div class="ach-recent">' + recent.map(a => '<button class="ach-chip" data-act="ach" data-id="' + a.id + '" aria-label="' + esc(a.title) + '">' + coin(a) + '</button>').join('') + '</div>' : '') +
    (nxt ? '<div class="small muted mt8">Next up: <b>' + esc(nxt.title) + '</b> · ' + esc(nxt.progress.label) + '</div>' : '') +
    '<button class="btn secondary small-btn mt8" data-act="achievements">See all achievements</button></div>';
}

/* ---------- the note after saving a game ---------- */
function savedHTML(g) {
  const pool = BB.gamePool();
  if (!g || !pool.games.includes(g)) return '';
  const fresh = A.fresh(evaluate(pool.games.filter(x => x !== g)), evaluate(pool.games));
  if (!fresh.length) return '';
  markSeen(fresh.map(a => a.id));
  BB.haptic('spare');
  const tops = A.tops(fresh);                // a 600 series says more than the 400 and 500 that came with it
  const shown = tops.slice(0, 3);
  return '<div class="card ach-new"><div class="kicker">' + icon('medal') + (tops.length > 1 ? 'New achievements' : 'New achievement') + '</div>' +
    shown.map(a => '<div class="ach-new-row">' + coin(a) + '<div class="grow"><div class="t">' + esc(a.title) + '</div><div class="s">' + esc(a.desc) + '</div></div>' +
      '<button class="link-btn" data-act="achShare" data-id="' + a.id + '">' + icon('share') + 'Share</button></div>').join('') +
    (tops.length > shown.length ? '<div class="small muted mt8">and ' + (tops.length - shown.length) + ' more in <button class="link-btn inline" data-act="achievements">Achievements</button></div>' : '') + '</div>';
}

/* ---------- one badge ---------- */
function achSheet(id) {
  const res = evaluate();
  const a = res.list.find(x => x.id === id);
  if (!a) return;
  const g = a.earned && BB.getAnyGame(a.earned.gameId);
  let h = '<h3>' + esc(a.title) + '</h3><div class="ach-hero">' + coin(a, 'lg') + '<p>' + esc(a.desc) + '</p></div>';
  if (a.earned) {
    const sr = g && !g.sheet ? Store.seriesGames(g.seriesId) : [];
    const where = g ? [sr.length > 1 ? 'Game ' + g.gameNo + ' of ' + sr.length : (sr.length ? 'Game ' + g.gameNo : ''), g.centerId ? Store.centerName(g.centerId) : ''].filter(Boolean).join(' · ') : '';
    h += '<div class="ach-when"><b>Earned ' + esc(fmtDate(a.earned.date)) + '</b>' + (where ? '<div class="small muted">' + esc(where) + '</div>' : '') + '</div>' +
      '<button class="btn" id="achShare">' + icon('share') + 'Share</button>' + (g ? '<button class="btn secondary mt8" id="achView">View the game</button>' : '');
  } else {
    h += bar(pctDone(a)) + '<div class="small muted" id="achProg">' + esc(a.progress ? a.progress.label : '') + '</div>' +
      (a.needs === 'pins' ? '<p class="small muted">Counts games scored pin by pin, or read from a lane-screen photo and checked.</p>' : '') +
      '<button class="btn secondary mt8" data-close>Close</button>';
  }
  openSheet(h, sh => {
    const share = sh.querySelector('#achShare'), view = sh.querySelector('#achView');
    if (share) share.addEventListener('click', () => BB.shareCard('ach', { id }));
    if (view) view.addEventListener('click', () => { closeSheet(); show('game', { id: g.id }); });
  });
}

/* ---------- the screen ---------- */
RENDER.achievements = function () {
  const res = evaluate();
  const seen = seenSet();
  let h = backLink('stats', 'Stats') + '<h2 class="screen-title">Achievements</h2>' +
    '<div class="card ach-summary"><div class="ach-total"><b>' + res.earned + '</b> of ' + res.total + ' earned</div>' + bar(Math.round(res.earned / res.total * 100)) +
    '<div class="small muted">Worked out from your games, so scores you import count too, on the day you bowled them.' + (res.games && !res.framed ? ' Streaks and clean games need games scored pin by pin.' : '') + '</div></div>';
  A.byGroup(res).forEach(grp => {
    h += '<h3 class="group-title">' + esc(grp.group) + '</h3>' + grp.items.map(a =>
      '<button class="ach-row ' + (a.earned ? 'on' : 'locked') + '" data-act="ach" data-id="' + a.id + '">' + coin(a) + '<div class="grow"><div class="t">' + esc(a.title) +
      (a.earned && !seen.has(a.id) ? ' <span class="badge">new</span>' : '') + '</div><div class="s">' + esc(a.desc) + '</div>' +
      (a.earned ? '<div class="ok">Earned ' + esc(fmtDate(a.earned.date)) + '</div>' : bar(pctDone(a)) + '<div class="s">' + esc(a.progress ? a.progress.label : '') + '</div>') +
      '</div><span class="chev" aria-hidden="true">' + icon('chevron') + '</span></button>').join('');
  });
  screenRoot().innerHTML = h;
  markSeen(res.list.filter(a => a.earned).map(a => a.id));
};

ACT.achievements = { ach: a => achSheet(a.dataset.id) };
ACT.stats = Object.assign(ACT.stats || {}, { achievements: () => show('achievements'), ach: a => achSheet(a.dataset.id) });
ACT.saved = Object.assign(ACT.saved || {}, { achievements: () => show('achievements'), achShare: a => BB.shareCard('ach', { id: a.dataset.id }) });

Object.assign(BB, { achCardHTML: cardHTML, achSavedHTML: savedHTML, achSheet, achCoin: coin });
})();
