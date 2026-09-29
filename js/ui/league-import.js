/* BowlBoard — getting a league in: import a whole season from a LeagueSecretary / BLS
 * weekly-scores file (or update one from a newer file), "which bowler are you?", the
 * league's points, and the read-only Schedule tab. */
(function () {
'use strict';
const BB = window.BB;
const LG = window.BBLeague, Store = window.BBStore;
const { esc, icon, val, show, toast, openSheet, closeSheet, plural } = BB;
const { lv, fmtD, intOr, save, renderLeague, needTeams } = BB.L;

/* ---------- schedule tab (read-only) ---------- */
BB.LT.schedule = function (l, body) {
  if (needTeams(l, body)) return;
  const cur = LG.currentWeek(l);
  const me = LG.me(l);
  let h = '';
  if (!l.schedule.length) h += '<div class="empty">No schedule yet.</div>';
  h += l.schedule.map(s => {
    const scored = LG.weekHasScores(l, s.week);
    return '<div class="card sched-week' + (s.week === cur ? ' cur' : '') + '"><div class="team-head"><h3>Week ' + s.week + (scored ? ' <span class="badge ok">bowled</span>' : s.week === cur ? ' <span class="badge">up next</span>' : '') + '</h3><span class="small muted">' + esc(fmtD(s.date || LG.weekDate(l, s.week))) + '</span></div>' +
      s.matchups.map(m => {
        const mine = me && me.teamId && (m.a === me.teamId || m.b === me.teamId);
        return '<div class="sched-row' + (mine ? ' mine' : '') + '"><span class="muted">' + esc(m.lanes) + '</span>' + esc(LG.teamName(l, m.a)) + ' vs ' + esc(LG.teamName(l, m.b)) + '</div>';
      }).join('') +
      (s.bye ? '<div class="sched-row"><span class="muted">bye</span>' + esc(LG.teamName(l, s.bye) + LG.byeNote(l)) + '</div>' : '') + '</div>';
  }).join('');
  body.innerHTML = h;
};

/* ---------- files: .xlsx or .csv -> table ---------- */
async function fileToTable(f) {
  if (/\.xlsx$/i.test(f.name) || /spreadsheetml/.test(f.type)) {
    if (!window.BBXlsx || typeof DecompressionStream === 'undefined') throw new Error('This browser can’t open .xlsx files. Save it as CSV and try again.');
    const wb = await window.BBXlsx.read(await f.arrayBuffer());
    const sheet = wb.sheets.find(x => x.rows.length > 1) || wb.sheets[0];
    if (!sheet) throw new Error('That spreadsheet is empty.');
    return sheet.rows;
  }
  return LG.parseCSV(await f.text());
}
function nameFromFile(fname) {
  const base = String(fname || '').replace(/\.[^.]+$/, '').replace(/[-_ ]?(weekly[-_ ]?scores|scores|export|stats?)$/i, '');
  return base.split(/[-_ ]+/).filter(Boolean).map(w => (/^\d{4}$/.test(w) && +w.slice(2) === +w.slice(0, 2) + 1 ? w.slice(0, 2) + '-' + w.slice(2) : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(' ') || 'Imported league';
}

/* ---------- import a whole season from a LeagueSecretary / BLS export ---------- */
function importLeagueSheet() {
  let result = null, check = null, fileName = '';
  const fmt = iso => (iso ? LG.fmtDate(iso) : '');
  const summary = () => {
    const r = result.report;
    const h = r.handicap;
    const li = (ok, txt) => '<li class="' + (ok ? 'ok' : 'warn') + '">' + txt + '</li>';
    return '<ul class="import-facts">' +
      li(true, '<b>' + plural(r.weeks, 'week') + '</b>' + (r.firstDate ? ' · ' + esc(fmt(r.firstDate)) + ' – ' + esc(fmt(r.lastDate)) : '') + ' · ' + esc(result.league.day) + 's') +
      li(true, '<b>' + plural(r.teams, 'team') + '</b> of ' + r.teamSize + ', ' + r.gamesPerNight + ' games a night') +
      li(true, '<b>' + plural(r.bowlers, 'bowler') + '</b> — ' + r.rostered + ' on rosters (from the last week’s lineups), ' + plural(r.subs, 'sub')) +
      li(!r.handicapMatch || r.handicapMatch.ok === r.handicapMatch.tot, h.enabled ? 'Handicap <b>' + h.pct + '% of ' + h.basis + '</b>, ' + esc(LG.ROUNDING_LABEL[h.rounding].toLowerCase()) + (r.handicapMatch ? ' (fits ' + r.handicapMatch.ok + ' of ' + r.handicapMatch.tot + ' rows)' : '') : '<b>Scratch</b> (no handicap)') +
      li(!r.avgMatch || r.avgMatch.ok === r.avgMatch.tot, 'Entering averages kept for <b>' + plural(r.keepGames, 'game') + '</b>' + (r.firstNight ? '; new bowlers’ first night uses their own average (' + r.newBowlers + ' bowlers)' : '')) +
      li(true, 'Absent bowlers score <b>average − ' + r.pinsBelowAvg + '</b>') +
      li(r.laneWeeks === r.weeks, 'Matchups read from lane pairs for <b>' + r.laneWeeks + ' of ' + r.weeks + '</b> weeks') +
      '</ul>' +
      (check ? (check.avgOk === check.checked && check.hcpOk === check.checked
        ? '<div class="import-check ok">✓ BowlBoard recalculated every average and handicap: all <b>' + check.checked.toLocaleString() + '</b> lines match the file.</div>'
        : '<div class="import-check warn">Averages match on ' + check.avgOk + ' and handicaps on ' + check.hcpOk + ' of ' + check.checked + ' lines. First difference: row ' + check.mismatches[0].row + ' (' + esc(check.mismatches[0].bowler) + ', week ' + check.mismatches[0].week + '): file ' + check.mismatches[0].fileAvg + '/' + check.mismatches[0].fileHdcp + ', BowlBoard ' + check.mismatches[0].ourAvg + '/' + check.mismatches[0].ourHdcp + '.</div>') : '') +
      (r.warnings.length ? '<div class="small warn">' + r.warnings.map(esc).join('<br>') + '</div>' : '');
  };
  openSheet('<h3>Import a league from a file</h3>' +
    '<p class="small muted mt0">Use a <b>weekly scores</b> export from LeagueSecretary.com (Excel export with Cloud Access) or from the BLS program: one row per bowler per week with Week, Date, Team, Bowler, Avg, Hdcp, G1–G3, Lane and Note. BowlBoard works out your league’s rules from the numbers and checks them against every row before creating anything.</p>' +
    '<label class="btn" for="ilFile">Choose file (.xlsx or .csv)…</label><input type="file" id="ilFile" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>' +
    '<div id="ilBody" aria-live="polite"></div>', sh => {
    const body = sh.querySelector('#ilBody');
    sh.querySelector('#ilFile').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      fileName = f.name;
      body.innerHTML = '<p class="small muted">Reading ' + esc(f.name) + '…</p>';
      let table;
      try { table = await fileToTable(f); } catch (err) { body.innerHTML = '<div class="warn small mt8">' + esc(err.message || 'Couldn’t read that file.') + '</div>'; return; }
      result = LG.importSeason(table, { name: nameFromFile(fileName), source: fileName });
      if (!result.ok) { body.innerHTML = '<div class="warn small mt8">' + esc(result.error) + '</div>'; return; }
      check = LG.verifySeason(result.league, result.recs);
      const L = result.league;
      const dup = LG.findDuplicate(Store.state.leagues, L);
      body.innerHTML = (dup ? '<div class="notice dup-note" id="ilDup"><b>You already have “' + esc(dup.name) + '”</b>' + (dup.imported ? ' (imported ' + esc(fmt(dup.imported.at.slice(0, 10))) + ')' : '') + '.' +
          '<label class="check"><input type="radio" name="ilDupMode" value="update" checked> <span><b>Update it from this file.</b> Weeks in the file replace those weeks there. Everything else stays: later weeks, the season length and dates, points, who you are, and your linked games. An automatic copy is kept first.</span></label>' +
          '<label class="check"><input type="radio" name="ilDupMode" value="both"> <span>Keep both (adds a second copy)</span></label></div>' : '') +
        summary() +
        '<div id="ilNewFields"' + (dup ? ' hidden' : '') + '>' +
        '<label class="field">League name<input type="text" id="ilName" value="' + esc(L.name) + '"></label>' +
        '<label class="field">Bowling center<select id="ilCenter"><option value="">—</option>' + BB.centerOptions(dup && dup.centerId ? dup.centerId : '', true) + '</select></label>' +
        '<div id="ilNewCenter" hidden class="new-center"><label class="field">Center name<input type="text" id="ilCName" placeholder="e.g. Lisle Lanes"></label></div>' +
        '<label class="field">Weeks in the season<input type="number" inputmode="numeric" id="ilWeeks" min="' + L.seasonWeeks + '" max="52" value="' + L.seasonWeeks + '"></label>' +
        '<div class="small muted">The file has ' + plural(L.seasonWeeks, 'week') + '. Starting mid-season? Enter the full season so the weeks still to come are scheduled.</div>' +
        '<fieldset class="fs"><legend>Points (not in the file)</legend><div class="grid2">' +
        '<label class="field">Per game won<input type="number" inputmode="decimal" id="ilPg" min="0" step="0.5" value="' + L.points.perGame + '"></label>' +
        '<label class="field">For total pins<input type="number" inputmode="decimal" id="ilPs" min="0" step="0.5" value="' + L.points.perSeries + '"></label></div>' +
        '<div class="small muted">Match your league’s standings sheet. You can change it later from the league page.</div></fieldset></div>' +
        '<button class="btn" id="ilGo">' + (dup ? 'Update ' + esc(dup.name) : 'Add league') + '</button>';
      const mode = () => { const m = sh.querySelector('input[name="ilDupMode"]:checked'); return dup && m ? m.value : 'new'; };
      sh.querySelectorAll('input[name="ilDupMode"]').forEach(r => r.addEventListener('change', () => {
        sh.querySelector('#ilNewFields').hidden = mode() === 'update';
        sh.querySelector('#ilGo').textContent = mode() === 'update' ? 'Update ' + dup.name : 'Add league';
      }));
      sh.querySelector('#ilCenter').addEventListener('change', ev => { sh.querySelector('#ilNewCenter').hidden = ev.target.value !== '__new'; });
      const go = sh.querySelector('#ilGo');
      go.addEventListener('click', async () => {
        if (go.disabled) return;
        go.disabled = true; // one tap, one league
        const done = ok => { if (!ok) go.disabled = false; };
        if (mode() === 'update') {
          const can = await Store.snapshots.available();
          const copy = await Store.snapshots.take('before-league-replace', { force: true });
          if (can && !copy) { toast('Couldn’t keep a copy first, so nothing was changed. Try again.', 4000); return done(false); }
          const res = LG.mergeImport(dup, L);
          Store.syncLinks();
          save(dup);
          closeSheet();
          toast('Updated ' + dup.name + ' — ' + plural(res.weeks, 'week') + ' from the file' + (res.bowlers ? ', ' + plural(res.bowlers, 'new bowler') : '') + (res.links ? ' · ' + plural(res.links, 'linked game') + ' kept' : ''), 4000);
          show('league', { id: dup.id, tab: 'standings', week: LG.lastScoredWeek(dup) });
          return;
        }
        const name = val('ilName').trim();
        if (!name) { toast('Give the league a name'); return done(false); }
        let centerId = val('ilCenter');
        if (centerId === '__new') {
          const cn = val('ilCName').trim();
          if (!cn) { toast('Name the bowling center'); return done(false); }
          centerId = Store.addCenter(cn, '').id;
        }
        Object.assign(L, { name, centerId, points: { perGame: Math.max(0, parseFloat(val('ilPg')) || 0), perSeries: Math.max(0, parseFloat(val('ilPs')) || 0) } });
        const weeks = Math.min(52, intOr(val('ilWeeks'), L.seasonWeeks));
        if (weeks > L.seasonWeeks) LG.setSeasonLength(L, weeks);
        Store.addLeague(L);
        Store.syncLinks();
        save(L);
        closeSheet();
        toast('Imported ' + name + ' — ' + plural(result.report.weeks, 'week') + ', ' + plural(result.report.bowlers, 'bowler'), 3500);
        show('league', { id: L.id, tab: 'standings', week: LG.lastScoredWeek(L) });
      });
    });
  });
}

/* ---------- how the league scores points (the one rule a file can't tell us) ---------- */
function pointsSheet(l) {
  const byeOpt = ([v, t]) => '<option value="' + v + '"' + ((l.byePoints || 'none') === v ? ' selected' : '') + '>' + t + '</option>';
  openSheet('<h3>League points</h3>' +
    '<p class="small muted mt0">A weekly-scores file has averages and handicaps but not how points are won. Match your league’s standings sheet.</p>' +
    '<div class="grid2"><label class="field">Per game won<input type="number" inputmode="decimal" id="lpPg" min="0" step="0.5" value="' + l.points.perGame + '"></label>' +
    '<label class="field">For total pins<input type="number" inputmode="decimal" id="lpPs" min="0" step="0.5" value="' + l.points.perSeries + '"></label></div>' +
    '<label class="field">A team on a bye gets<select id="lpBye">' + [['none', 'No points'], ['half', 'Half the night’s points'], ['full', 'All the night’s points']].map(byeOpt).join('') + '</select></label>' +
    '<div class="small muted">The bye setting only matters with an odd number of teams.</div>' +
    '<button class="btn mt8" id="lpSave">Save</button>', sh => {
    sh.querySelector('#lpSave').addEventListener('click', () => {
      l.points = { perGame: Math.max(0, parseFloat(val('lpPg')) || 0), perSeries: Math.max(0, parseFloat(val('lpPs')) || 0) };
      l.byePoints = val('lpBye') || 'none';
      save(l); closeSheet(); renderLeague(l); toast('Points saved');
    });
  });
}

/* ---------- which bowler is you? (asked once per league) ---------- */
function askMe(l, after, fromSend) {
  l.askedMe = true;
  Store.save();
  const names = l.bowlers.filter(b => b.active !== false).slice().sort((a, b) => a.name.localeCompare(b.name));
  openSheet('<h3>' + (fromSend ? 'Which bowler are you?' : 'Do you bowl in ' + esc(l.name) + '?') + '</h3>' +
    '<p class="small muted mt0">Pick your name so your matchup and league average show on Home, and so games you log can go straight onto the league sheet.</p>' +
    '<div class="me-list">' + names.map(b => '<button class="me-pick" data-me="' + b.id + '">' + esc(b.name) + '<small>' + esc(b.teamId ? LG.teamName(l, b.teamId) : 'Sub') + '</small></button>').join('') + '</div>' +
    '<button class="btn secondary mt8" data-close>' + (fromSend ? 'Cancel' : 'I don’t bowl in this league') + '</button>', sh => {
    sh.querySelectorAll('[data-me]').forEach(b => b.addEventListener('click', () => {
      l.bowlers.forEach(x => { x.isMe = x.id === b.dataset.me; });
      Store.save(); closeSheet();
      toast('Got it — you’re ' + LG.bowlerName(l, b.dataset.me));
      if (after) after(); else if (BB.nav.current === 'league') renderLeague(l);
    }));
  });
}

Object.assign(BB, { importLeagueSheet, askMe, pointsSheet, fileToTable, nameFromFile });
})();
