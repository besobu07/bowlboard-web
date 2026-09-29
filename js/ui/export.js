/* BowlBoard — Export my games: choose which games, then save an Excel workbook, a CSV or a
 * printable PDF report. The files are made on this device; nothing is uploaded.
 * (A full backup you can restore lives in More → Backup & restore; this is for your own records.) */
(function () {
'use strict';
const BB = window.BB;
const Store = window.BBStore, X = window.BBExport, I = window.BBInsights;
const { esc, icon, toast, openSheet, closeSheet, plural, todayISO, EMBED } = BB;

// What the "Scored by" column says. The in-app labels are longer than a spreadsheet column wants.
const MODE_NAME = { pins: 'Pin by pin', frames: 'Running totals', total: 'Total only', photo: 'Photo of the lane screen', sheet: 'League sheet' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// The PDF prints dates in English ("Sep 3, 2026") so it reads the same on every phone and printer.
const pdfDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? MON[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : (iso || ''); };
// Letter paper in the US, Canada and Mexico (and for a bare "en"); A4 everywhere else.
const paperSize = () => (/^en$|^[a-z]{2,3}[-_](US|CA|MX)\b/i.test(navigator.language || 'en-US') ? 'letter' : 'a4');

function names() {
  const st = Store.state;
  return {
    center: id => { const c = st.centers.find(x => x.id === id); return c ? c.name : ''; },
    ball: id => { const b = st.balls.find(x => x.id === id); return b ? (b.brand + ' ' + b.name + (b.weight ? ' (' + b.weight + ' lb)' : '')).trim() : ''; },
    league: id => BB.leagueName(id),
    mode: m => MODE_NAME[m] || m || '',
  };
}

const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

function rangeList(games) {
  const seasons = Array.from(new Set(games.map(g => I.seasonOf(g.date)).filter(s => s != null))).sort((a, b) => b - a);
  const leagues = Array.from(new Set(games.map(g => g.leagueId).filter(Boolean))).filter(id => Store.getLeague(id));
  const out = [{ key: 'all', label: 'All games', games }];
  seasons.forEach(s => { const list = games.filter(g => I.seasonOf(g.date) === s); out.push({ key: 's:' + s, group: 'Season', label: I.seasonLabel(s) + ' season', games: list }); });
  leagues.forEach(id => { const list = games.filter(g => g.leagueId === id); out.push({ key: 'l:' + id, group: 'League', label: BB.leagueName(id), games: list }); });
  return out;
}

function exportSheet(opts) {
  opts = opts || {};
  const P = BB.gamePool();
  const ranges = rangeList(P.games);
  const st = { range: ranges.some(r => r.key === opts.range) ? opts.range : 'all' };
  const current = () => ranges.find(r => r.key === st.range) || ranges[0];
  const optionHTML = r => '<option value="' + esc(r.key) + '"' + (r.key === st.range ? ' selected' : '') + '>' + esc(r.label) + ' (' + r.games.length + ')</option>';
  const groups = [['By season', ranges.filter(r => r.group === 'Season')], ['By league', ranges.filter(r => r.group === 'League')]].filter(g => g[1].length);
  const row = (id, ic, title, sub, off) => '<button class="list-item nav-item" id="' + id + '"' + (off ? ' disabled' : '') + '><span class="li-ic">' + icon(ic) + '</span><div class="grow"><div class="t">' + title + '</div><div class="s">' + sub + '</div></div><span class="chev" aria-hidden="true">' + icon('download') + '</span></button>';

  let h = '<h3>Export my games</h3>';
  if (!P.games.length) {
    h += '<p class="small muted mt0">Nothing to export yet. Games you log, and scores you import from a file, will show up here.</p>';
    openSheet(h + '<button class="btn secondary" data-close>Close</button>');
    return;
  }
  h += '<p class="small muted mt0">Keep your scores, print them or open them in Excel. The files are made on this device and nothing is uploaded.</p>' +
    (P.sample ? '<div class="warn small mb8">These are the sample games. Your own games will be exported once you add some.</div>' : '') +
    '<label class="field">Which games<select id="exRange">' + optionHTML(ranges[0]) +
    groups.map(g => '<optgroup label="' + g[0] + '">' + g[1].map(optionHTML).join('') + '</optgroup>').join('') + '</select></label>' +
    '<div class="small muted" id="exCount" aria-live="polite"></div>' +
    '<div class="export-list mt8">' +
    row('exXlsx', 'file', 'Excel workbook (.xlsx)', 'Every game, plus a season summary', EMBED) +
    row('exCsv', 'file', 'CSV file (.csv)', EMBED ? 'Copy it to paste into a spreadsheet' : 'Opens in any spreadsheet app, and BowlBoard can read it back', false) +
    row('exPdf', 'file', 'Printable report (.pdf)', 'Season summary and every night, ready to print or share', EMBED) + '</div>' +
    (EMBED ? '<p class="small muted mt8">This preview can’t save files. Excel and PDF files can be saved from the installed app.</p>' : '') +
    '<p class="small muted mt8">Want a copy you can restore on another phone? That’s <button class="link-btn inline" id="exBackup">Backup &amp; restore</button>, which also keeps your leagues, balls and centers.</p>';

  openSheet(h, sh => {
    const count = sh.querySelector('#exCount');
    const buttons = ['#exXlsx', '#exCsv', '#exPdf'].map(s => sh.querySelector(s));
    const refresh = () => {
      const r = current(), n = r.games.length, nights = new Set(r.games.map(g => g.seriesId || g.id)).size;
      count.textContent = n ? plural(n, 'game') + ' on ' + plural(nights, 'night') : 'No games in this range.';
      buttons.forEach((b, i) => { b.disabled = !n || (EMBED && i !== 1); });
    };
    refresh();
    sh.querySelector('#exRange').addEventListener('change', e => { st.range = e.target.value; refresh(); });
    sh.querySelector('#exBackup').addEventListener('click', () => { closeSheet(); BB.show('backup'); });

    const save = (kind, ext, mime, build) => sh.querySelector(kind).addEventListener('click', () => {
      const r = current();
      if (!r.games.length) return;
      const iso = todayISO();
      const tag = r.key === 'all' ? '' : slug(r.label);
      const file = X.filename(ext, iso, tag);
      let data;
      try { data = build(r); }
      catch (e) { toast('Couldn’t make that file. Try the CSV instead.', 4000); return; }
      const ok = ext === 'csv' ? BB.download(file, data, mime) : BB.saveFile(file, data, mime);
      if (ok) toast('Saved ' + file, 3500);
    });
    save('#exCsv', 'csv', 'text/csv;charset=utf-8', r => X.csv(X.rows(r.games, names())));
    save('#exXlsx', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', r => X.xlsx(r.games, names(), new Date()));
    save('#exPdf', 'pdf', 'application/pdf', r => {
      const who = BB.firstName();
      return X.pdf(r.games, names(), { title: who ? who + '’s bowling games' : 'My bowling games', rangeLabel: r.label, exportedOn: pdfDate(todayISO()), size: paperSize(), fmtDate: pdfDate });
    });
  });
}

Object.assign(BB, { exportSheet });
})();
