/* BowlBoard — Stats: the season at a glance, what stands out, recent form and
 * consistency, trends, pin stats, and per-ball / center / oil-pattern numbers.
 * Each ball has its own page. */
(function () {
'use strict';
const BB = window.BB;
const S = window.BBScore, Store = window.BBStore, LG = window.BBLeague, I = window.BBInsights;
const { RENDER, esc, fmtDate, todayISO, icon, el, on, show, screenRoot, backLink, avgFloor, pct, plural, myGames, scoredGames, highSeries } = BB;

const statFilter = { preset: 'all', type: '', recent: 0 };
function statsScope(all, preset, type, recent) {
  const filtered = scoredGames(all.filter(g => BB.inRange(g.date, preset) && BB.typeMatch(g, type)));
  return recent ? I.chrono(filtered).slice(-recent) : filtered;
}
BB.statsScope = statsScope;
const card = (v, label, sub) => '<div class="stat-card"><b>' + v + '</b><span>' + label + '</span>' + (sub || '') + '</div>';
const pctCell = v => (v == null ? '—' : v + '%');

function groupTable(title, rows, label, opts) {
  opts = opts || {};
  if (!rows.length) return '';
  const rate = rows.some(r => r.strike != null);
  return '<div class="card"><h3>' + title + '</h3><table class="split"><tr><th>' + esc(opts.col || title.replace('By ', '')) + '</th><th>Games</th>' + (rate ? '<th>Strike</th>' : '') + '<th>Avg</th></tr>' +
    rows.map(r => '<tr>' + (opts.act && opts.act(r.key)
      ? '<td><button class="link-btn inline" data-act="ball" data-id="' + esc(r.key) + '">' + esc(label(r.key)) + ' ›</button></td>'
      : '<td>' + esc(label(r.key)) + '</td>') + '<td>' + r.games + '</td>' + (rate ? '<td>' + pctCell(r.strike) + '</td>' : '') + '<td><b>' + r.avg + '</b></td></tr>').join('') + '</table></div>';
}

RENDER.stats = function () {
  const root = screenRoot();
  const all = myGames();
  const games = statsScope(all, statFilter.preset, statFilter.type, statFilter.recent);
  const totals = games.map(g => g.total);
  const avg = avgFloor(totals);
  const detailed = games.filter(g => g.frames);
  const ps = S.pinStats(detailed);
  const series = Store.allSeries(games);
  const today = todayISO();

  let h = '<div class="head-row"><h2 class="screen-title">My Stats</h2>' + (games.length ? '<button class="link-btn" id="stShare">' + icon('share') + 'Share</button>' : '') + '</div><div class="quick-filters" role="group" aria-label="Recent games">' + [0,12,30].map(n => '<button type="button" data-act="statsRecent" data-count="' + n + '" aria-pressed="' + (statFilter.recent === n && statFilter.preset === 'all') + '">' + (n ? 'Last ' + n + ' games' : 'All time') + '</button>').join('') + '</div><div class="filters">' +
    '<select id="stPreset" aria-label="Date range">' + BB.rangeOptions(statFilter.preset) + '</select>' +
    '<select id="stType" aria-label="Practice or league">' + BB.typeOptions(statFilter.type) + '</select></div>';
  if (!games.length) {
    root.innerHTML = h + '<div class="empty">No games in this range yet.</div>' + myLeagueStatsHTML();
    bindStatFilters(); return;
  }
  // average vs last season, when looking at this season
  let delta = '';
  if (statFilter.preset === 'season') {
    const last = scoredGames(all.filter(g => I.seasonOf(g.date) === I.seasonOf(today) - 1 && BB.typeMatch(g, statFilter.type))).map(g => g.total);
    if (last.length >= 9) { const d = avg - avgFloor(last); if (d) delta = '<em class="' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '+' : '−') + Math.abs(d) + ' vs last season</em>'; }
  }
  h += '<div class="card stats-hero"><div class="kicker">Your average</div><div class="stats-average">' + (totals.reduce((a,b)=>a+b,0)/totals.length).toFixed(1) + '</div>' + delta + '<span class="small muted">' + plural(totals.length, 'scored game') + '</span></div>' +
    '<div class="stat-grid stats-records">' + card(Math.max(...totals), 'High game') +
    card(highSeries(series) || '—', 'High 3-game series') + '</div>' +
    '<div class="card stats-trend"><h3>Scores over time</h3><div id="chartScore"></div></div>';

  if (ps.games) h += '<div class="stat-grid stats-quick-rates">' + card(pct(ps.strikes, ps.racks), 'Strike %') + card(pct(ps.spares, ps.spareOpps), 'Spare %') + card(pct(ps.frames - ps.openFrames, ps.frames), 'Fill %') + '</div>';
  const ins = I.insights(games, { today, max: 4 });
  if (ins.length) {
    h += '<div class="card insights"><h3>' + icon('sparkle') + 'What stands out</h3><ul>' +
      ins.map(x => '<li class="' + x.tone + '">' + esc(x.text) + '</li>').join('') + '</ul></div>';
  }
  h += BB.achCardHTML ? BB.achCardHTML() : '';
  const chrono = I.chrono(games);
  const last5 = chrono.slice(-5);
  const cons = I.consistency(totals);
  h += '<div class="card form"><h3>Recent form</h3><div class="form-games">' + last5.map(g => '<button class="form-g' + (g.total >= avg ? ' hi' : '') + '" data-act="game" data-id="' + esc(g.id) + '" aria-label="' + esc(fmtDate(g.date)) + ': ' + g.total + '"><b>' + g.total + '</b><small>' + esc(I.fmtShort(g.date)) + '</small></button>').join('') + '</div>' +
    '<div class="small muted">Your last ' + plural(last5.length, 'game') + ', oldest first. Highlighted = at or above your ' + avg + ' average.</div>' +
    (cons ? '<div class="consistency"><b>±' + cons.sd + ' pins</b><span>Most of your games land between <b>' + cons.lo + '</b> and <b>' + cons.hi + '</b>. Smaller is steadier.</span></div>' : '') + '</div>';

  if (detailed.length) h += '<div class="card"><h3>Strike % and spare %</h3><div id="chartRate"></div></div>';
  if (ps.games) {
    h += '<div class="stat-grid four">' + card(pct(ps.strikes, ps.racks), 'Strike %') + card(pct(ps.spares, ps.spareOpps), 'Spare %') +
      card(pct(ps.singles, ps.singleOpps), 'Single-pin') + card(ps.splitOpps ? ps.splitsMade + '/' + ps.splitOpps : '—', 'Splits made') + '</div>';
    h += '<div class="stat-grid four">' + card(ps.racks ? (ps.firstBallPins / ps.racks).toFixed(1) : '—', 'First-ball avg') +
      card((ps.openFrames / ps.games).toFixed(1), 'Opens / game') + card(ps.cleanGames, 'Clean games') + card(ps.fouls, 'Fouls') + '</div>';
    if (ps.topLeaves.length) {
      h += '<div class="card"><h3>Most common leaves</h3><table class="split"><tr><th>Leave</th><th>Times</th><th>Picked up</th></tr>' +
        ps.topLeaves.map(l => '<tr><td>' + l.leave + (S.isSplit(l.leave.split('-').map(Number)) ? ' <span class="badge split">split</span>' : '') + '</td><td>' + l.count + '</td><td><b>' + pct(l.made, l.count) + '</b></td></tr>').join('') + '</table></div>';
    }
    if (detailed.length < games.length) h += '<p class="small muted">Strike, spare and leave stats use the ' + detailed.length + ' of ' + games.length + ' games with frame detail. Total-only, running-total and league-sheet games count toward average and highs only.</p>';
  } else {
    h += '<p class="small muted">Enter individual rolls (or verify a lane-screen photo) to unlock strike and spare stats. Track exact pins to unlock detailed leave and split stats.</p>';
  }
  const prac = games.filter(g => !g.leagueId).map(g => g.total), lgn = games.filter(g => g.leagueId).map(g => g.total);
  if (prac.length && lgn.length && !statFilter.type) {
    h += '<div class="card"><h3>Practice vs league nights</h3><div class="versus"><div><b>' + avgFloor(prac) + '</b><span>practice · ' + prac.length + ' g</span></div><div><b>' + avgFloor(lgn) + '</b><span>league · ' + lgn.length + ' g</span></div></div></div>';
  }
  h += myLeagueStatsHTML();
  const known = id => Store.state.balls.some(b => b.id === id);
  h += groupTable('By ball', I.groupRows(games, g => (g.sheet ? '__sheet' : g.ballId || '__house')), k => (k === '__house' ? 'House ball' : k === '__sheet' ? 'Not recorded (league sheet)' : Store.ballLabel(k)), { act: known });
  h += groupTable('By center', I.groupRows(games, g => g.centerId || null), k => Store.centerName(k));
  h += groupTable('By oil pattern', I.groupRows(games, g => (g.sheet ? null : g.pattern || 'Not recorded')), k => k, { col: 'Pattern' });
  h += '<details class="defs"><summary>How these are counted</summary><ul>' +
    '<li><b>Average</b> on the overview shows one decimal; official league averages drop the fraction (189.9 is 189).</li><li><b>Fill %</b> = frames without an open ÷ frames recorded, using games with roll detail.</li>' +
    '<li><b>Strike %</b> = strikes ÷ strike chances. A chance is every ball thrown at a full rack, including 10th-frame fill balls after a strike or spare — a 300 is 12 for 12.</li>' +
    '<li><b>Spare %</b> = spares ÷ racks left standing after the first ball.</li>' +
    '<li><b>Single-pin</b> = spares made when the first ball counted 9.</li>' +
    '<li><b>Splits</b> follow the USBC rule: headpin down and a pin down between standing pins (7-9, 3-10) or right in front of two of them (5-6, 8-9). Sleepers (2-8, 3-9) aren’t splits.</li>' +
    '<li><b>High 3-game series</b> is your best three games in a row on one night.</li>' +
    '<li><b>Consistency</b> is the standard deviation of your scores: about two in three games fall within that many pins of your average.</li>' +
    '<li><b>Seasons</b> run August 1 to July 31.</li></ul></details>';
  root.innerHTML = h;
  bindStatFilters();
  drawStatCharts(games);
};
function drawStatCharts(games) {
  const C = window.BBCharts;
  if (!C) return;
  const a = el('chartScore'), b = el('chartRate');
  if (a) C.scoreTrend(a, games);
  if (b) { const ok = C.rateTrend(b, games); if (!ok && !b.textContent.trim()) b.closest('.card').hidden = true; }
}
// Charts are sized to the screen: redraw them (only them) when the width changes.
let resizeTimer = null, lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (BB.nav.current !== 'stats' || window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    RENDER.stats();
  }, 200);
});
BB.ACT.stats = BB.ACT.stats || {};
BB.ACT.stats.statsRecent = a => { statFilter.preset = 'all'; statFilter.recent = [12,30].includes(+a.dataset.count) ? +a.dataset.count : 0; RENDER.stats(); };
function bindStatFilters() {
  on('stPreset', 'change', e => { statFilter.preset = e.target.value; statFilter.recent = 0; RENDER.stats(); });
  on('stType', 'change', e => { statFilter.type = e.target.value; RENDER.stats(); });
  on('stShare', 'click', () => BB.shareCard('season', { preset: statFilter.preset, type: statFilter.type, recent: statFilter.recent }));
}
// Official league numbers for leagues where you've marked yourself on the roster.
function myLeagueStatsHTML() {
  const rows = [];
  Store.state.leagues.forEach(l => {
    const me = LG.me(l);
    if (!me) return;
    const st = LG.bowlerStats(l, LG.lastScoredWeek(l)).find(b => b.id === me.id);
    if (st) rows.push('<tr><td>' + esc(l.name) + '</td><td>' + st.games + '</td><td><b>' + (st.avg == null ? '—' : st.avg) + '</b></td><td>' + (st.highSeries || '—') + '</td><td>' + st.hcp + '</td></tr>');
  });
  if (!rows.length) return '';
  return '<div class="card"><h3>My official league numbers</h3><table class="split"><tr><th>League</th><th>Games</th><th>Avg</th><th>High ser.</th><th>Hcp</th></tr>' + rows.join('') + '</table></div>';
}

/* ---------- a ball's page ---------- */
RENDER.ball = function (p) {
  const root = screenRoot();
  const b = Store.state.balls.find(x => x.id === p.id);
  if (!b) { show('stats'); return; }
  const back = p.from === 'balls' ? backLink('balls', 'My arsenal') : backLink('stats', 'Stats');
  const r = I.ballReport(myGames(), b.id);
  let h = back + '<div class="ball-head">' + BB.ballIcon(b.brand, 'lg') + '<div><h2 class="screen-title">' + esc(b.brand + ' ' + b.name) + '</h2><div class="small muted">' +
    esc([b.weight ? b.weight + ' lb' : null, b.cover].filter(Boolean).join(' · ')) + '</div></div></div>';
  if (!r.games) {
    root.innerHTML = h + '<div class="empty">No games with this ball yet. Pick it when you start a game, or on the scoring screen.</div>';
    return;
  }
  h += '<div class="stat-grid">' + card(r.avg, 'Average') + card(r.high, 'High game') + card(r.games, 'Games') + card(r.strike == null ? '—' : r.strike + '%', 'Strike %', r.spare == null ? '' : '<em>spare ' + r.spare + '%</em>') + '</div>';
  const lines = [];
  if (r.bestPattern) lines.push('<li>Best on <b>' + esc(r.bestPattern.key) + '</b>: ' + r.bestPattern.avg + ' average over ' + plural(r.bestPattern.games, 'game') + '.</li>');
  if (r.mostUsed) {
    const k = r.mostUsed.key;
    const where = k === 'practice' ? 'practice' : (Store.getLeague(k.slice(7)) || {}).name || 'league nights';
    lines.push('<li>Mostly thrown in <b>' + esc(where) + '</b> (' + plural(r.mostUsed.games, 'game') + ').</li>');
  }
  lines.push('<li>First used ' + esc(fmtDate(r.first)) + ', last ' + esc(fmtDate(r.last)) + '.</li>');
  if (r.detailed < r.games) lines.push('<li class="muted">Strike and spare % use the ' + r.detailed + ' pin-by-pin games.</li>');
  h += '<div class="card"><ul class="plain">' + lines.join('') + '</ul></div>';
  h += groupTable('By oil pattern', r.patterns, k => k, { col: 'Pattern' });
  h += groupTable('By center', r.centers, k => Store.centerName(k));
  h += '<div class="card"><h3>Recent games</h3><div class="chips">' + r.recent.map(g => '<button class="chip" data-act="game" data-id="' + esc(g.id) + '">' + g.total + ' <small>' + esc(I.fmtShort(g.date)) + '</small></button>').join('') + '</div></div>';
  root.innerHTML = h;
};

Object.assign(BB, { myLeagueStatsHTML, groupTable });
})();
