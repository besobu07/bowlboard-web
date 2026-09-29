/* BowlBoard — league Scores tab and the matchup screen (read-only).
 * Every matchup for a week and each bowler's games, handicap and points, as they came in
 * from the league's file. The one thing a bowler can do here is tie their own logged games
 * to their line, so a score is typed once. */
(function () {
'use strict';
const BB = window.BB;
const LG = window.BBLeague, Store = window.BBStore;
const { RENDER, esc, icon, show, toast } = BB;
const { lv, fmtD, save, weekPicker, bindWeekPicker, needTeams } = BB.L;
const $ = s => document.querySelector(s);

function matchupStatus(l, week, m) {
  const r = LG.matchupResult(l, week, m);
  if (!r.A.entered && !r.B.entered) return { cls: 'todo', text: 'No scores', r };
  if (!(r.A.complete && r.B.complete)) return { cls: 'part', text: 'Partial', r };
  return { cls: 'done', text: LG.fmtPts(r.ptsA) + '–' + LG.fmtPts(r.ptsB) + ' pts', r };
}

/* ---------- Scores tab: the week's matchups ---------- */
BB.LT.scores = function (l, body) {
  if (needTeams(l, body)) return;
  const w = lv.week;
  const sch = LG.weekSchedule(l, w);
  let h = weekPicker(l);
  if (!sch.matchups.length) {
    body.innerHTML = h + '<div class="empty">No matchups are scheduled for this week.</div>';
    bindWeekPicker(l);
    return;
  }
  const me = LG.me(l), mm = me ? LG.myMatchup(l, w) : null;
  h += sch.matchups.map((m, i) => {
    const st = matchupStatus(l, w, m);
    const winA = st.cls === 'done' && st.r.ptsA > st.r.ptsB, winB = st.cls === 'done' && st.r.ptsB > st.r.ptsA;
    return '<button class="matchup-card' + (mm && mm.mi === i ? ' mine' : '') + '" data-mi="' + i + '"><div class="lanes">Lanes<b>' + esc(m.lanes) + '</b></div>' +
      '<div class="teams"><span class="' + (winA ? 'win' : '') + '">' + esc(LG.teamName(l, m.a)) + '</span><i>vs</i><span class="' + (winB ? 'win' : '') + '">' + esc(LG.teamName(l, m.b)) + '</span></div>' +
      '<span class="pill ' + st.cls + '">' + st.text + '</span></button>';
  }).join('');
  if (sch.bye) h += '<div class="small muted center mt8">Bye: ' + esc(LG.teamName(l, sch.bye) + LG.byeNote(l)) + '</div>';
  h += LG.weekHasScores(l, w)
    ? '<p class="small muted center">Tap a matchup to see every bowler’s games.</p>'
    : '<p class="small muted center">No scores for this week yet. They appear when you update the league from its file.</p>';
  body.innerHTML = h;
  bindWeekPicker(l);
  body.querySelectorAll('[data-mi]').forEach(b => b.addEventListener('click', () => show('matchup', { id: l.id, week: w, mi: +b.dataset.mi })));
};

/* ---------- one matchup, read-only ---------- */
RENDER.matchup = function (p) {
  const l = Store.getLeague(p.id);
  const root = $('#screen-matchup');
  if (!l) { show('league', { list: true }); return; }
  const w = p.week;
  const m = LG.weekSchedule(l, w).matchups[p.mi];
  if (!m) { show('league', { id: l.id, tab: 'scores' }); return; }
  lv.id = l.id; lv.week = w; lv.tab = 'scores';
  let h = BB.backLink('league', 'Week ' + w + ' scores', { id: l.id, tab: 'scores', week: w });
  h += '<h2 class="screen-title">' + esc(LG.teamName(l, m.a)) + ' <span class="muted">vs</span> ' + esc(LG.teamName(l, m.b)) + '</h2>';
  h += '<div class="small muted mb8">Week ' + w + ' · ' + esc(fmtD(LG.weekDate(l, w))) + ' · lanes ' + esc(m.lanes) +
    (l.handicap.enabled ? ' · ' + l.handicap.pct + '% of ' + l.handicap.basis : ' · scratch') + '</div>';
  h += '<div id="muScore"></div>';
  [m.a, m.b].forEach(tid => { h += '<div class="card team-card" data-team="' + tid + '"></div>'; });
  root.innerHTML = h;
  [m.a, m.b].forEach(tid => {
    const card = root.querySelector('[data-team="' + tid + '"]');
    card.innerHTML = teamCardHTML(l, w, tid);
    bindTeam(l, w, tid, m, root, card);
  });
  updateMatchupTotals(l, w, m, root);
};

const serText = s => (s.games.some(g => g != null) ? '<b>' + LG.fmtN(s.series) + '</b>' + (s.hcp ? '<small>' + LG.fmtN(s.hcpSeries) + ' w/ hcp</small>' : '') : '');

// Games you logged yourself on this league night (tagged to this league, else same date).
function myLoggedGames(l, w) {
  const date = LG.weekDate(l, w);
  if (!date) return [];
  const same = Store.state.games.filter(g => g.date === date && g.total != null);
  const tagged = same.filter(g => g.leagueId === l.id);
  return (tagged.length ? tagged : same).sort((a, b) => (a.gameNo || 1) - (b.gameNo || 1));
}
// Linking is offered only where it can't change a score that came from the league's file:
// each logged game has to match the sheet or fill a blank.
function linkableGames(l, w, line) {
  const mine = myLoggedGames(l, w).slice(0, l.gamesPerNight);
  const sheet = line.games || [];
  return mine.length && mine.every((g, i) => sheet[i] == null || sheet[i] === g.total) ? mine : [];
}

function teamCardHTML(l, w, tid) {
  const lines = LG.teamLines(l, w, tid) || LG.defaultLines(l, tid);
  const G = l.gamesPerNight;
  let h = '<div class="team-head"><h3>' + esc(LG.teamName(l, tid)) + '</h3><span class="pts" data-pts="' + tid + '"></span></div>';
  lines.forEach((line, li) => {
    const s = LG.scoreLine(l, w, line);
    const who = LG.bowler(l, line.bowlerId);
    const isMe = !!(who && who.isMe);
    const isSub = !!(who && !s.vacant && who.teamId !== tid);
    const linked = (line.links || []).some(Boolean);
    const canLink = isMe && !linked && !line.absent && !s.vacant ? linkableGames(l, w, line) : [];
    h += '<div class="line ro' + (line.absent ? ' absent' : '') + (s.vacant ? ' vacant' : '') + (isMe ? ' me' : '') + '">' +
      '<div class="line-top"><span class="who">' + esc(s.name) + (isMe ? ' <span class="badge">you</span>' : '') + (isSub ? ' <span class="badge">sub</span>' : '') + '</span>' +
      (line.absent ? '<span class="badge">absent</span>' : '') + '</div>' +
      '<div class="line-meta">' + (s.vacant ? 'Vacancy scores ' + l.vacancy.score + ' a game'
        : 'avg ' + s.avg + (s.avgSource === 'entering' ? ' (entering)' : s.avgSource === 'default' ? ' (new)' : '') + (l.handicap.enabled ? ' · hcp ' + s.hcp : '') +
          (line.absent ? ' · scores ' + s.games[0] + ' (avg − ' + l.absent.pinsBelowAvg + ')' : '')) + '</div>';
    if (!s.vacant && !line.absent) {
      h += '<div class="game-scores">';
      for (let gi = 0; gi < G; gi++) {
        const v = (line.games || [])[gi];
        const absG = !!(line.absentGames && line.absentGames[gi]);
        const isLinked = !!(line.links && line.links[gi]);
        h += '<span class="gs' + (absG ? ' abs' : v == null ? ' none' : '') + (isLinked ? ' linked' : '') + '" aria-label="' + esc(s.name) + ' game ' + (gi + 1) + ': ' +
          (absG ? 'absent, scores ' + s.absentScore : v == null ? 'no score' : v) + (isLinked ? ', linked to their own log' : '') + '">' +
          (absG ? 'abs ' + s.absentScore : v == null ? '–' : v) + '</span>';
      }
      h += '<div class="ser" data-ser="' + tid + '-' + li + '">' + serText(s) + '</div></div>';
      if (linked) {
        h += '<div class="link-note">' + icon('link') + (isMe
          ? '<span><b>Your games · linked.</b> Changes in your log update these scores.</span><button class="link-btn inline" data-li="' + li + '" data-f="unlink">Unlink</button>'
          : '<span>Linked to ' + esc(s.name) + '’s own log.</span>') + '</div>';
      } else if (canLink.length) {
        h += '<button class="link-btn" data-li="' + li + '" data-f="mine">' + icon('link') + 'Link my logged games (' + canLink.map(g => g.total).join(' · ') + ')</button>';
      }
    }
    h += '</div>';
  });
  h += '<table class="totals" data-totals="' + tid + '"></table>';
  return h;
}

// Only your own line has anything to tap: link your logged games, or let them go again.
function bindTeam(l, w, tid, m, root, card) {
  const redraw = () => { card.innerHTML = teamCardHTML(l, w, tid); updateMatchupTotals(l, w, m, root); };
  card.addEventListener('click', e => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    // a week with no scores yet shows the roster as blank lines; pushMyGames makes them real
    const line = (LG.teamLines(l, w, tid) || LG.defaultLines(l, tid))[+b.dataset.li];
    if (!line) return;
    if (b.dataset.f === 'mine') {
      const mine = linkableGames(l, w, line);
      if (!mine.length) { redraw(); return; }
      const r = LG.pushMyGames(l, w, mine.map(g => ({ gameId: g.id, total: g.total })));
      if (!r.ok) { toast(r.error, 4000); return; }
      save(l); redraw(); toast('Linked to your log');
    } else if (b.dataset.f === 'unlink') {
      line.links = [];
      save(l); redraw(); toast('Unlinked — the league score stays as it is');
    }
  });
}

function updateMatchupTotals(l, w, m, root) {
  const r = LG.matchupResult(l, w, m);
  const G = l.gamesPerNight;
  const useH = l.handicap.enabled;
  [[m.a, r.A, 'a', r.ptsA], [m.b, r.B, 'b', r.ptsB]].forEach(([tid, T, side, pts]) => {
    const tbl = root.querySelector('[data-totals="' + tid + '"]');
    if (!tbl) return;
    const T2 = T.entered ? T : LG.teamWeek(Object.assign({}, l, { results: Object.assign({}, l.results, { [w]: { lines: LG.defaultLines(l, tid) } }) }), w, tid);
    const cell = (v, i) => '<td class="' + (i != null && r.games[i] && r.games[i].winner === side ? 'won' : '') + '">' + (v == null ? '–' : LG.fmtN(v)) + '</td>';
    let h = '<tr><th></th>' + Array.from({ length: G }, (_, i) => '<th>G' + (i + 1) + '</th>').join('') + '<th>Total</th></tr>';
    h += '<tr><td>Scratch</td>' + T2.scratch.map(v => cell(v)).join('') + cell(T2.scratch.every(x => x != null) ? T2.series : null) + '</tr>';
    if (useH) {
      h += '<tr><td>Hcp</td>' + T2.hcp.map(v => cell(v)).join('') + cell(T2.hcp.every(x => x != null) ? T2.hcp.reduce((a, b) => a + b, 0) : null) + '</tr>';
      h += '<tr class="tot"><td>Total</td>' + T2.total.map((v, i) => cell(v, i)).join('') + '<td class="' + (r.decided && ((side === 'a' && r.seriesA > r.seriesB) || (side === 'b' && r.seriesB > r.seriesA)) ? 'won' : '') + '">' + (T2.complete ? LG.fmtN(T2.hcpSeries) : '–') + '</td></tr>';
    }
    tbl.innerHTML = h;
    const p = root.querySelector('[data-pts="' + tid + '"]');
    if (p) p.textContent = (r.games.some(g => g.winner) ? LG.fmtPts(pts) + ' pts' : '');
  });
  const sc = root.querySelector('#muScore');
  if (sc) {
    const known = r.games.some(g => g.winner);
    sc.innerHTML = known ? '<div class="mu-score"><span>' + esc(LG.teamName(l, m.a)) + '</span><b>' + LG.fmtPts(r.ptsA) + ' – ' + LG.fmtPts(r.ptsB) + '</b><span>' + esc(LG.teamName(l, m.b)) + '</span></div>' : '';
  }
}

Object.assign(BB.L, { matchupStatus, myLoggedGames });
})();
