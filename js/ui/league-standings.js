/* BowlBoard — league Standings tab (read-only): team standings and every bowler's average,
 * through any week that has scores. Your own team and your own row are highlighted. */
(function () {
'use strict';
const BB = window.BB;
const LG = window.BBLeague;
const { esc } = BB;
const { lv, weekPicker, bindWeekPicker, needTeams } = BB.L;

BB.LT.standings = function (l, body) {
  if (needTeams(l, body)) return;
  const lastW = LG.lastScoredWeek(l);
  if (lastW && lv.week > lastW) lv.week = lastW; // nothing to show past the last bowled week
  const w = lv.week;
  const st = LG.standings(l, w);
  const avgs = LG.bowlerStats(l, w).filter(b => b.games > 0 || b.teamId);
  const useH = l.handicap.enabled;
  const me = LG.me(l);
  let h = weekPicker(l, 'Through week');
  if (!lastW) h += '<p class="small muted center">No scores yet. Standings fill in once you import your league’s scores.</p>';
  h += '<div class="card"><h3>Team standings</h3><div class="table-wrap"><table class="data"><tr><th>#</th><th class="l">Team</th><th title="Points won">Pts W</th><th title="Points lost">Pts L</th><th>' + (useH ? 'Hcp pins' : 'Pins') + '</th><th>HG</th><th>HS</th></tr>' +
    st.map(s => '<tr class="' + (me && me.teamId === s.teamId ? 'me' : '') + '"><td class="muted">' + s.place + '</td><td class="l"><b>' + esc(s.name) + '</b></td><td><b>' + LG.fmtPts(s.won) + '</b></td><td>' + LG.fmtPts(s.lost) + '</td><td>' + LG.fmtN(useH ? s.hcpPins : s.scratch) + '</td><td>' + (s.highGame ? LG.fmtN(s.highGame) : '–') + '</td><td>' + (s.highSeries ? LG.fmtN(s.highSeries) : '–') + '</td></tr>').join('') +
    '</table></div><div class="small muted">Pts W / Pts L are points, not games: ' + esc(LG.pointsLine(l)) + '. HG / HS = team high game / series' + (useH ? ' with handicap' : '') + '.</div></div>';
  h += '<div class="card"><h3>Bowler averages</h3><div class="table-wrap"><table class="data"><tr><th class="l">Bowler</th><th>Gms</th><th>Avg</th><th>HG</th><th>HS</th>' + (useH ? '<th>Hcp</th>' : '') + '</tr>' +
    avgs.map(b => '<tr class="' + (b.isMe ? 'me' : '') + '"><td class="l">' + esc(b.name) + (b.isMe ? ' <span class="badge">you</span>' : '') + '<small>' + esc(b.team) + '</small></td><td>' + b.games + '</td><td><b>' + (b.avg == null ? '<span class="muted" title="Average used for handicap">' + b.currentAvg + '*</span>' : b.avg) + '</b></td><td>' + (b.highGame == null ? '–' : b.highGame) + '</td><td>' + (b.highSeries == null ? '–' : LG.fmtN(b.highSeries)) + '</td>' + (useH ? '<td>' + b.hcp + '</td>' : '') + '</tr>').join('') +
    '</table></div><div class="small muted">Averages are truncated (189.9 → 189).' + (useH ? ' Hcp is what each bowler gets next week.' : '') + ' * = entering average, no league games yet.</div></div>';
  body.innerHTML = h;
  bindWeekPicker(l);
};
})();
