/* BowlBoard — league Scores tab and the matchup sheet (type each bowler's games;
 * handicap and points work themselves out). */
(function () {
'use strict';
const BB = window.BB;
const LG = window.BBLeague, Store = window.BBStore;
const { RENDER, esc, icon, on, val, show, toast, openSheet, closeSheet, download, plural } = BB;
const { lv, fmtD, intOr, slug, save, regenSchedule, renderLeague, weekPicker, bindWeekPicker, needTeams } = BB.L;
const $ = s => document.querySelector(s);

function matchupStatus(l, week, m) {
  const r = LG.matchupResult(l, week, m);
  if (!r.A.entered && !r.B.entered) return { cls: 'todo', text: 'Not entered', r };
  if (!(r.A.complete && r.B.complete)) return { cls: 'part', text: 'In progress', r };
  return { cls: 'done', text: LG.fmtPts(r.ptsA) + '–' + LG.fmtPts(r.ptsB) + ' pts', r };
}
BB.LT.scores = function (l, body) {
  if (needTeams(l, body)) return;
  const w = lv.week;
  const sch = LG.weekSchedule(l, w);
  let h = weekPicker(l);
  if (!sch.matchups.length) {
    h += '<div class="empty">No matchups scheduled this week.<br><button class="btn small-btn mt8" id="mkSched">Build schedule</button></div>';
    body.innerHTML = h; bindWeekPicker(l);
    on('mkSched', 'click', () => { regenSchedule(l); save(l); renderLeague(l); });
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
  if (LG.weekHasScores(l, w)) {
    h += '<div class="row mt12"><button class="btn grow" id="toRecap">Week ' + w + ' recap →</button><button class="btn secondary small-btn" id="wkCsv">CSV</button></div>';
  } else {
    h += '<p class="small muted center">Tap a matchup to enter scores. Handicaps and points are figured as you type.</p>';
  }
  body.innerHTML = h;
  bindWeekPicker(l);
  body.querySelectorAll('[data-mi]').forEach(b => b.addEventListener('click', () => show('matchup', { id: l.id, week: w, mi: +b.dataset.mi })));
  on('toRecap', 'click', () => { lv.tab = 'recap'; renderLeague(l); });
  on('wkCsv', 'click', () => download(slug(l.name) + '-week-' + w + '-scores.csv', LG.weekScoresCSV(l, w), 'text/csv'));
};

/* ---------- matchup score entry ---------- */
function ensureWeek(l, w) {
  if (!l.results[w]) l.results[w] = { lines: [], final: false };
  return l.results[w];
}
function ensureTeamLines(l, w, teamId) {
  const r = ensureWeek(l, w);
  if (!r.lines.some(x => x.teamId === teamId)) LG.defaultLines(l, teamId).forEach(x => r.lines.push(x));
  return r.lines.filter(x => x.teamId === teamId);
}
// Typing scores: batch the writes (flushed when you leave the screen or the app goes to the background).
function touch(l, w) { ensureWeek(l, w).updatedAt = new Date().toISOString(); Store.markLeagueEdit(l); Store.saveSoon(); }

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
  h += '<button class="btn" data-back="league" data-back-params=\'' + esc(JSON.stringify({ id: l.id, tab: 'scores', week: w })) + '\'>Done</button>';
  h += '<p class="small muted center">Scores save as you type.</p>';
  root.innerHTML = h;
  [m.a, m.b].forEach(tid => {
    const card = root.querySelector('[data-team="' + tid + '"]');
    card.innerHTML = teamCardHTML(l, w, tid);
    bindTeam(l, w, tid, m, root, card);
  });
  updateMatchupTotals(l, w, m, root);
};

function lineOptions(l, teamId, current, usedIds) {
  const rosterB = LG.roster(l, teamId), subB = LG.subs(l);
  const opt = (b, label) => '<option value="' + b.id + '"' + (b.id === current ? ' selected' : '') + (usedIds.has(b.id) && b.id !== current ? ' disabled' : '') + '>' + esc(label || b.name) + '</option>';
  let h = '<optgroup label="' + esc(LG.teamName(l, teamId)) + '">' + rosterB.map(b => opt(b)).join('') + '</optgroup>';
  // bowlers from elsewhere already chosen here (e.g. inactive) stay visible
  const cur = LG.bowler(l, current);
  if (cur && !rosterB.includes(cur) && !subB.includes(cur)) h += opt(cur);
  if (subB.length) h += '<optgroup label="Subs">' + subB.map(b => opt(b, b.name + ' (sub)')).join('') + '</optgroup>';
  h += '<option value="' + LG.VACANT + '"' + (current === LG.VACANT ? ' selected' : '') + '>Vacant</option>';
  h += '<option value="__newsub">+ New sub…</option>';
  return h;
}

function teamCardHTML(l, w, tid) {
  const lines = LG.teamLines(l, w, tid) || LG.defaultLines(l, tid);
  const used = new Set(lines.map(x => x.bowlerId));
  const G = l.gamesPerNight;
  let h = '<div class="team-head"><h3>' + esc(LG.teamName(l, tid)) + '</h3><span class="pts" data-pts="' + tid + '"></span></div>';
  lines.forEach((line, li) => {
    const s = LG.scoreLine(l, w, line);
    const who = LG.bowler(l, line.bowlerId);
    const isMe = !!(who && who.isMe);
    const mine = isMe && !(line.links || []).some(Boolean) ? myLoggedGames(l, w) : null;
    h += '<div class="line' + (line.absent ? ' absent' : '') + (s.vacant ? ' vacant' : '') + (isMe ? ' me' : '') + '">' +
      '<div class="line-top"><select data-li="' + li + '" data-f="bowler" aria-label="Bowler">' + lineOptions(l, tid, line.bowlerId, used) + '</select>' +
      (s.vacant ? '' : '<button class="abs-btn' + (line.absent ? ' on' : '') + '" data-li="' + li + '" data-f="absent" aria-pressed="' + !!line.absent + '">Absent</button>') + '</div>' +
      '<div class="line-meta">' + (s.vacant ? 'Vacancy scores ' + l.vacancy.score + ' a game' : 'avg ' + s.avg + (s.avgSource === 'entering' ? ' (entering)' : s.avgSource === 'default' ? ' (new)' : '') + (l.handicap.enabled ? ' · hcp ' + s.hcp : '') + (line.absent ? ' · scores ' + s.games[0] + ' (avg − ' + l.absent.pinsBelowAvg + ')' : '')) + '</div>';
    if (!s.vacant && !line.absent) {
      h += '<div class="game-inputs">';
      for (let gi = 0; gi < G; gi++) {
        const v = (line.games || [])[gi];
        const linked = line.links && line.links[gi];
        const absG = line.absentGames && line.absentGames[gi];
        h += '<input type="number" inputmode="numeric" min="0" max="300" placeholder="' + (absG ? 'abs ' + s.absentScore : 'G' + (gi + 1)) + '" aria-label="' + esc(s.name) + ' game ' + (gi + 1) + (absG ? ' (absent, scores ' + s.absentScore + ')' : '') + (linked ? ' (linked to their own log)' : '') + '"' + (absG ? ' data-abs="1"' : '') +
          (linked ? ' class="linked" title="From ' + esc(s.name) + '’s own log. Typing here replaces it and unlinks it."' : '') + ' data-li="' + li + '" data-gi="' + gi + '" value="' + (v == null ? '' : v) + '">';
      }
      h += '<div class="ser" data-ser="' + tid + '-' + li + '">' + serText(s) + '</div></div>';
      if ((line.links || []).some(Boolean)) {
        h += '<div class="link-note">' + icon('link') + (isMe ? '<span><b>Your games · linked.</b> Changes in your log update these scores.</span>' : '<span>Linked to ' + esc(s.name) + '’s own log. Typing over a score unlinks it and your number stands.</span>') + '</div>';
      } else if (mine && mine.length) h += '<button class="link-btn" data-li="' + li + '" data-f="mine">' + icon('link') + 'Use my logged games and link them (' + mine.slice(0, G).map(g => g.total).join(' · ') + ')</button>';
    }
    h += '</div>';
  });
  h += '<table class="totals" data-totals="' + tid + '"></table>';
  return h;
}
const serText = s => (s.games.some(g => g != null) ? '<b>' + LG.fmtN(s.series) + '</b>' + (s.hcp ? '<small>' + LG.fmtN(s.hcpSeries) + ' w/ hcp</small>' : '') : '');

// Games you logged yourself on this league night (tagged to this league, else same date).
function myLoggedGames(l, w) {
  const date = LG.weekDate(l, w);
  if (!date) return [];
  const same = Store.state.games.filter(g => g.date === date && g.total != null);
  const tagged = same.filter(g => g.leagueId === l.id);
  return (tagged.length ? tagged : same).sort((a, b) => (a.gameNo || 1) - (b.gameNo || 1));
}

// One set of delegated listeners per team card; the card's contents can redraw freely.
function bindTeam(l, w, tid, m, root, card) {
  const redraw = () => { card.innerHTML = teamCardHTML(l, w, tid); updateMatchupTotals(l, w, m, root); };
  card.addEventListener('input', e => {
    const inp = e.target.closest('input[data-gi]');
    if (!inp) return;
    const lines = ensureTeamLines(l, w, tid);
    const line = lines[+inp.dataset.li];
    const gi = +inp.dataset.gi;
    const n = inp.value === '' ? null : parseInt(inp.value, 10);
    const ok = n === null || LG.validScore(n);
    inp.classList.toggle('bad', !ok);
    line.games = line.games || [];
    line.games[gi] = ok ? n : null;
    if (n !== null && line.absentGames && line.absentGames[gi]) { line.absentGames[gi] = false; inp.removeAttribute('data-abs'); }
    if (LG.unlinkGame(line, gi)) {
      inp.classList.remove('linked');
      toast('Unlinked from ' + LG.bowlerName(l, line.bowlerId) + '’s own log — this score now stands.', 3500);
    }
    touch(l, w);
    const ser = card.querySelector('[data-ser="' + tid + '-' + inp.dataset.li + '"]');
    if (ser) ser.innerHTML = serText(LG.scoreLine(l, w, line));
    updateMatchupTotals(l, w, m, root);
    if (ok && inp.value.length === 3) { // three digits typed -> jump to the next box
      const all = Array.from(root.querySelectorAll('input[data-gi]'));
      const nx = all[all.indexOf(inp) + 1];
      if (nx) nx.focus();
    }
  });
  card.addEventListener('change', e => {
    const sel = e.target.closest('select[data-f="bowler"]');
    if (!sel) return;
    const line = ensureTeamLines(l, w, tid)[+sel.dataset.li];
    if (sel.value === '__newsub') {
      newSubSheet(l, b => { line.bowlerId = b.id; line.absent = false; line.links = []; touch(l, w); redraw(); }, redraw);
      return;
    }
    line.bowlerId = sel.value;
    line.absent = false;
    line.links = [];
    touch(l, w); redraw();
  });
  card.addEventListener('click', e => {
    const b = e.target.closest('[data-f]');
    if (!b || b.tagName === 'SELECT') return;
    const line = ensureTeamLines(l, w, tid)[+b.dataset.li];
    if (b.dataset.f === 'absent') {
      line.absent = !line.absent;
      touch(l, w); redraw();
    } else if (b.dataset.f === 'mine') {
      const games = myLoggedGames(l, w).slice(0, l.gamesPerNight);
      line.games = Array.from({ length: l.gamesPerNight }, (_, i) => (games[i] ? games[i].total : null));
      line.links = Array.from({ length: l.gamesPerNight }, (_, i) => (games[i] ? games[i].id : null));
      touch(l, w); redraw(); toast('Filled from your log and linked');
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

function newSubSheet(l, onDone, onCancel) {
  let done = false;
  openSheet('<h3>Add a sub</h3><label class="field">Name<input type="text" id="nsName"></label>' +
    '<label class="field">Average (if known)<input type="number" inputmode="numeric" id="nsAvg" min="0" max="300" placeholder="' + l.defaultAvg + '"></label>' +
    '<label class="field">Email (optional)<input type="email" id="nsEmail"></label><button class="btn" id="nsSave">Add sub</button>', sh => {
    sh.querySelector('#nsSave').addEventListener('click', () => {
      const name = val('nsName').trim();
      if (!name) { toast('Enter a name'); return; }
      const b = { id: LG.uid(), name, email: val('nsEmail').trim(), enteringAvg: intOr(val('nsAvg'), null), teamId: '', isMe: false, active: true };
      l.bowlers.push(b); save(l); done = true; closeSheet(); onDone(b);
    });
  }, () => { if (!done && onCancel) onCancel(); }); // closing without saving puts the select back
}

Object.assign(BB.L, { matchupStatus, myLoggedGames });
})();
