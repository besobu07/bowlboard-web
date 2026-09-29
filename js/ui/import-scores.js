/* BowlBoard — import your own scores from a CSV or Excel file: pick the file, check which
 * column is which, see exactly what will happen, then bring the games in. Games already in
 * your log are skipped, and the whole import can be taken back. */
(function () {
'use strict';
const BB = window.BB;
const Store = window.BBStore, GI = window.BBGamesImport;
const { esc, fmtDate, icon, val, show, toast, openSheet, closeSheet, plural, download } = BB;

function importScoresSheet() {
  const st = { table: null, info: null, map: null, hasHeader: true, order: 'mdy', fileName: '' };
  const ctx = () => ({
    centers: Store.state.centers, balls: Store.state.balls, parseLanes: Store.parseLanes,
    existing: BB.myGames().map(g => ({ date: g.date, total: g.total })),
  });
  const colOptions = (sel, none) => (none ? '<option value="-1"' + (sel < 0 ? ' selected' : '') + '>' + none + '</option>' : '') +
    st.info.names.map((n, i) => {
      const sample = (st.info.sample[0] || [])[i];
      return '<option value="' + i + '"' + (sel === i ? ' selected' : '') + '>' + esc(n) + (sample ? ' — ' + esc(String(sample).slice(0, 14)) : '') + '</option>';
    }).join('');
  const pickSel = (id, label, sel, none) => '<label class="field">' + label + '<select id="' + id + '">' + colOptions(sel, none || '— none —') + '</select></label>';

  openSheet('<h3>Import scores from a file</h3>' +
    '<p class="small muted mt0">Bring in games you’ve kept in a spreadsheet: a CSV or Excel file with a date and a score on each row, or one row per night with Game 1, Game 2… columns. Games already in BowlBoard are skipped, so importing the same file twice is safe.</p>' +
    '<label class="btn" for="isFile">' + icon('upload') + 'Choose a file (.csv or .xlsx)…</label><input type="file" id="isFile" accept=".csv,.xlsx,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>' +
    '<button class="link-btn mt8" id="isTpl">Get a template to fill in</button>' +
    '<div id="isBody" aria-live="polite"></div>', sh => {
    const body = sh.querySelector('#isBody');

    sh.querySelector('#isTpl').addEventListener('click', () => download('bowlboard-scores-template.csv', GI.template(), 'text/csv'));
    sh.querySelector('#isFile').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      st.fileName = f.name;
      body.innerHTML = '<p class="small muted">Reading ' + esc(f.name) + '…</p>';
      try { st.table = await BB.fileToTable(f); } catch (err) { body.innerHTML = '<div class="warn small mt8">' + esc(err.message || 'Couldn’t read that file.') + '</div>'; return; }
      analyse(null);
    });

    function analyse(forceHeader) {
      st.info = GI.analyze(st.table, forceHeader == null ? undefined : { hasHeader: forceHeader });
      if (!st.info.ok) { body.innerHTML = '<div class="warn small mt8">' + esc(st.info.error) + '</div>'; return; }
      st.hasHeader = st.info.hasHeader;
      st.map = st.info.map;
      st.order = st.info.order;
      drawMapping();
    }

    function drawMapping() {
      const m = st.map, info = st.info;
      const onlyCenter = Store.state.centers.length === 1 ? Store.state.centers[0].id : ''; // one home house: assume it
      const more = m.center >= 0 || m.ball >= 0 || m.lane >= 0 || m.pattern >= 0;
      body.innerHTML = '<div class="small muted mt8">' + esc(st.fileName) + ' · ' + plural(info.rows, 'row') + '</div>' +
        '<label class="check"><input type="checkbox" id="isHdr"' + (st.hasHeader ? ' checked' : '') + '> The first row holds column names</label>' +
        '<fieldset class="fs"><legend>Which column is which?</legend>' +
        pickSel('mapDate', 'Date', m.date, 'Choose…') +
        '<div class="field-label">Scores <small class="muted">tap every column that holds a game</small></div>' +
        '<div class="chips" id="mapScores" role="group" aria-label="Score columns">' + info.names.map((n, i) =>
          '<button type="button" class="chip' + (m.scores.includes(i) ? ' sel' : '') + '" data-col="' + i + '" aria-pressed="' + m.scores.includes(i) + '"' + (i === m.date ? ' disabled' : '') + '>' + esc(n) + '</button>').join('') + '</div>' +
        '<details class="more-cols"' + (more ? ' open' : '') + '><summary>Center, ball, lane, oil pattern</summary>' +
        pickSel('mapCenter', 'Center', m.center) + pickSel('mapBall', 'Ball', m.ball) + pickSel('mapLane', 'Lane', m.lane) + pickSel('mapPattern', 'Oil pattern', m.pattern) +
        (m.scores.length === 1 ? pickSel('mapGameNo', 'Game number (to put a night’s games in order)', m.gameNo) : '') + '</details></fieldset>' +
        (info.ambiguousDates ? '<label class="field">Dates like 4/5/2026 are<select id="isOrder"><option value="mdy"' + (st.order === 'mdy' ? ' selected' : '') + '>Month/Day/Year (April 5)</option><option value="dmy"' + (st.order === 'dmy' ? ' selected' : '') + '>Day/Month/Year (May 4)</option></select></label>' : '') +
        '<label class="field">Center for games that don’t name one<select id="isCenter"><option value="">— Not set —</option>' + BB.centerOptions(onlyCenter, true) + '</select></label>' +
        '<div id="isNewCenter" hidden class="new-center"><label class="field">Center name<input type="text" id="isCName" placeholder="e.g. Parkside Lanes"></label></div>' +
        '<div class="import-preview" id="isPreview" aria-live="polite"></div>' +
        '<button class="btn" id="isGo" disabled>Import</button>';
      bindMapping();
      preview();
    }

    function bindMapping() {
      const num = id => { const v = parseInt(val(id), 10); return isNaN(v) ? -1 : v; };
      sh.querySelector('#isHdr').addEventListener('change', e => analyse(e.target.checked));
      const sync = () => {
        st.map.date = num('mapDate');
        st.map.center = num('mapCenter'); st.map.ball = num('mapBall'); st.map.lane = num('mapLane'); st.map.pattern = num('mapPattern');
        if (sh.querySelector('#mapGameNo')) st.map.gameNo = num('mapGameNo');
        const o = sh.querySelector('#isOrder'); if (o) st.order = o.value;
        st.map.scores = st.map.scores.filter(i => i !== st.map.date);
        sh.querySelectorAll('#mapScores [data-col]').forEach(b => {
          const i = +b.dataset.col;
          b.disabled = i === st.map.date;
          b.classList.toggle('sel', st.map.scores.includes(i));
          b.setAttribute('aria-pressed', st.map.scores.includes(i));
        });
        preview();
      };
      ['mapDate', 'mapCenter', 'mapBall', 'mapLane', 'mapPattern', 'mapGameNo', 'isOrder'].forEach(id => { const e = sh.querySelector('#' + id); if (e) e.addEventListener('change', sync); });
      sh.querySelectorAll('#mapScores [data-col]').forEach(b => b.addEventListener('click', () => {
        const i = +b.dataset.col;
        st.map.scores = st.map.scores.includes(i) ? st.map.scores.filter(x => x !== i) : st.map.scores.concat(i).sort((a, b) => a - b);
        sync();
      }));
      sh.querySelector('#isCenter').addEventListener('change', e => { sh.querySelector('#isNewCenter').hidden = e.target.value !== '__new'; });
      sh.querySelector('#isGo').addEventListener('click', doImport);
    }

    let current = null;
    function preview() {
      const box = sh.querySelector('#isPreview'), go = sh.querySelector('#isGo');
      current = GI.plan(st.table, st.map, { hasHeader: st.hasHeader, order: st.order }, ctx());
      if (!current.ok) { box.innerHTML = '<div class="small muted">' + esc(current.error) + '</div>'; go.disabled = true; go.textContent = 'Import'; return; }
      const p = current;
      let h = '';
      if (p.toImport) {
        h += '<div class="small"><b>' + plural(p.toImport, 'game') + '</b> on <b>' + plural(p.nights, 'night') + '</b>' + (p.dates.first ? ', ' + esc(fmtDate(p.dates.first)) + (p.dates.last !== p.dates.first ? ' – ' + esc(fmtDate(p.dates.last)) : '') : '') + '.</div>';
      } else h += '<div class="warn small">' + (p.duplicates ? 'Everything in this file is already in your log.' : 'Nothing here can be imported yet.') + '</div>';
      if (p.duplicates) h += '<div class="small muted">' + plural(p.duplicates, 'game') + ' already in your log (or on a league sheet) will be skipped.</div>';
      if (p.newCenters.length) h += '<div class="small">New center' + (p.newCenters.length > 1 ? 's' : '') + ' to add: ' + esc(p.newCenters.join(', ')) + '</div>';
      if (p.unmatchedBalls.length) h += '<div class="small muted">' + plural(p.unmatchedBalls.length, 'ball name') + ' didn’t match a ball in your bag, so those games have no ball: ' + esc(p.unmatchedBalls.slice(0, 4).join(', ')) + (p.unmatchedBalls.length > 4 ? '…' : '') + '</div>';
      if (p.empty) h += '<div class="small muted">' + plural(p.empty, 'row') + ' had a date but no score and ' + (p.empty === 1 ? 'was' : 'were') + ' left out.</div>';
      if (p.skipped.length) {
        h += '<div class="small warn">' + plural(p.skippedRows, 'row') + ' skipped:<br>' + p.skipped.slice(0, 4).map(s => 'Row ' + s.row + ': ' + esc(s.reason)).join('<br>') + (p.skipped.length > 4 ? '<br>…and ' + (p.skipped.length - 4) + ' more' : '') + '</div>';
        if (p.big) h += '<div class="small muted">If a column with big numbers is a series total, pick the single-game columns above instead.</div>';
      }
      if (p.preview.length) {
        h += '<div class="table-wrap"><table class="data"><tr><th class="l">Date</th><th>Score</th><th class="l">Center</th><th></th></tr>' +
          p.preview.map(g => '<tr><td class="l">' + esc(fmtDate(g.date, { month: 'short', day: 'numeric', year: 'numeric' })) + '</td><td><b>' + g.total + '</b></td><td class="l">' + esc(g.center || '—') + '</td><td>' + (g.dup ? '<span class="badge">have it</span>' : '') + '</td></tr>').join('') +
          '</table></div>' + (p.total > p.preview.length ? '<div class="small muted center">First ' + p.preview.length + ' of ' + p.total + ' games</div>' : '');
      }
      box.innerHTML = h;
      go.disabled = !p.toImport;
      go.textContent = p.toImport ? 'Import ' + plural(p.toImport, 'game') : 'Import';
    }

    async function doImport(e) {
      const go = e.currentTarget;
      if (go.disabled || !current || !current.ok || !current.toImport) return;
      go.disabled = true; // one tap, one import
      let fallback = sh.querySelector('#isCenter').value;
      if (fallback === '__new' && !val('isCName').trim()) { toast('Name the bowling center'); go.disabled = false; return; }
      try { await Store.snapshots.take('before-import'); } catch (err) { /* a missing copy never blocks an import */ }
      const batch = Store.uid();
      const made = {};
      const centerIdFor = name => {
        if (!name) {
          if (fallback === '__new') { fallback = Store.addCenter(val('isCName').trim(), '', { importBatch: batch }).id; }
          return fallback;
        }
        const k = name.toLowerCase().replace(/\s+/g, ' ').trim();
        if (!made[k]) made[k] = Store.addCenter(name, '', { importBatch: batch }).id;
        return made[k];
      };
      const games = GI.toGames(current, { uid: Store.uid, batch, centerIdFor });
      Store.addGames(games);
      const nights = new Set(games.map(g => g.seriesId)).size;
      const range = games.length ? fmtDate(games[0].date) + (games[games.length - 1].date !== games[0].date ? ' – ' + fmtDate(games[games.length - 1].date) : '') : '';
      openSheet('<h3>' + icon('check') + 'Imported ' + plural(games.length, 'game') + '</h3>' +
        '<p class="mt0">' + plural(nights, 'night') + ', ' + esc(range) + '. Your average and stats now include ' + (games.length === 1 ? 'it' : 'them') + '.' +
        (current.duplicates ? ' ' + plural(current.duplicates, 'game') + ' you already had ' + (current.duplicates === 1 ? 'was' : 'were') + ' skipped.' : '') + '</p>' +
        '<button class="btn" id="isView">See History</button><button class="btn secondary mt8" id="isUndo">' + icon('undo') + 'Undo this import</button><button class="btn secondary mt8" data-close>Done</button>', s2 => {
        s2.querySelector('#isView').addEventListener('click', () => { closeSheet(); show('history'); });
        s2.querySelector('#isUndo').addEventListener('click', () => {
          const r = Store.undoImport(batch);
          closeSheet(); BB.rerender();
          toast('Import undone — ' + plural(r.games, 'game') + ' removed', 3000);
        });
      }, () => BB.rerender());
    }
  });
}

Object.assign(BB, { importScoresSheet });
})();
