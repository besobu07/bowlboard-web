/* BowlBoard — league Standings and the weekly Recap (email / copy / print / download). */
(function () {
'use strict';
const BB = window.BB;
const LG = window.BBLeague, Store = window.BBStore;
const { esc, icon, on, toast, download, copyText, copyRich, plural, EMBED } = BB;
const { lv, slug, renderLeague, weekPicker, bindWeekPicker, needTeams } = BB.L;

/* ---------- standings ---------- */
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
  if (!LG.lastScoredWeek(l)) h += '<p class="small muted center">No scores yet — standings fill in once week 1 is entered.</p>';
  h += '<div class="card"><h3>Team standings</h3><div class="table-wrap"><table class="data"><tr><th>#</th><th class="l">Team</th><th title="Points won">Pts W</th><th title="Points lost">Pts L</th><th>' + (useH ? 'Hcp pins' : 'Pins') + '</th><th>HG</th><th>HS</th></tr>' +
    st.map(s => '<tr class="' + (me && me.teamId === s.teamId ? 'me' : '') + '"><td class="muted">' + s.place + '</td><td class="l"><b>' + esc(s.name) + '</b></td><td><b>' + LG.fmtPts(s.won) + '</b></td><td>' + LG.fmtPts(s.lost) + '</td><td>' + LG.fmtN(useH ? s.hcpPins : s.scratch) + '</td><td>' + (s.highGame ? LG.fmtN(s.highGame) : '–') + '</td><td>' + (s.highSeries ? LG.fmtN(s.highSeries) : '–') + '</td></tr>').join('') +
    '</table></div><div class="small muted">Pts W / Pts L are points, not games: ' + esc(LG.pointsLine(l)) + '. HG / HS = team high game / series' + (useH ? ' with handicap' : '') + '.</div></div>';
  h += '<div class="card"><h3>Bowler averages</h3><div class="table-wrap"><table class="data"><tr><th class="l">Bowler</th><th>Gms</th><th>Avg</th><th>HG</th><th>HS</th>' + (useH ? '<th>Hcp</th>' : '') + '</tr>' +
    avgs.map(b => '<tr class="' + (b.isMe ? 'me' : '') + '"><td class="l">' + esc(b.name) + (b.isMe ? ' <span class="badge">you</span>' : '') + '<small>' + esc(b.team) + '</small></td><td>' + b.games + '</td><td><b>' + (b.avg == null ? '<span class="muted" title="Average used for handicap">' + b.currentAvg + '*</span>' : b.avg) + '</b></td><td>' + (b.highGame == null ? '–' : b.highGame) + '</td><td>' + (b.highSeries == null ? '–' : LG.fmtN(b.highSeries)) + '</td>' + (useH ? '<td>' + b.hcp + '</td>' : '') + '</tr>').join('') +
    '</table></div><div class="small muted">Averages are truncated (189.9 → 189).' + (useH ? ' Hcp is what each bowler gets next week.' : '') + ' * = entering average, no league games yet.</div></div>';
  h += '<div class="row"><button class="btn secondary grow" id="stCsv">Standings CSV</button><button class="btn secondary grow" id="avCsv">Averages CSV</button></div>';
  body.innerHTML = h;
  bindWeekPicker(l);
  on('stCsv', 'click', () => download(slug(l.name) + '-standings-week-' + w + '.csv', LG.standingsCSV(l, w), 'text/csv'));
  on('avCsv', 'click', () => download(slug(l.name) + '-averages-week-' + w + '.csv', LG.averagesCSV(l, w), 'text/csv'));
};

/* ---------- recap ---------- */
const centerLabel = l => (Store.centerName(l.centerId) === '—' ? '' : Store.centerName(l.centerId));
function recapDoc(l, w) {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(LG.recapSubject(l, w)) + '</title>' +
    '<style>body{margin:0;background:#f8fafc}@media print{body{background:#fff}}</style></head><body>' + LG.recapHTML(l, w, centerLabel(l)) + '</body></html>';
}
BB.LT.recap = function (l, body) {
  if (needTeams(l, body)) return;
  const w = lv.week;
  let h = weekPicker(l);
  if (!LG.weekHasScores(l, w)) {
    const last = LG.lastScoredWeek(l);
    h += '<div class="empty">No scores for week ' + w + ' yet.' + (last ? '<br><button class="btn small-btn mt8" id="lastRecap">Show week ' + last + ' recap</button>' : '') + '</div>';
    body.innerHTML = h; bindWeekPicker(l);
    on('lastRecap', 'click', () => { lv.week = last; renderLeague(l); });
    return;
  }
  const rec = LG.recipients(l);
  const text = LG.recapText(l, w, centerLabel(l));
  const partial = LG.weekSchedule(l, w).matchups.some(m => BB.L.matchupStatus(l, w, m).cls !== 'done');
  if (partial) h += '<div class="notice">Some matchups aren’t finished — the recap shows what’s entered so far.</div>';
  h += '<div class="card share-card"><h3>Send it to the league</h3>' +
    '<div class="small muted mb8">' + (rec.length ? plural(rec.length, 'recipient') + ' from the roster' + (l.ccEmails ? ' + extra list' : '') : 'No emails on the roster yet — add them under Admin → Bowlers, or copy and paste into your own email.') + '</div>' +
    '<button class="btn" id="rcEmail">' + icon('mail') + 'Email recap' + (rec.length ? ' to ' + rec.length : '') + '</button>' +
    '<div class="share-grid"><button class="btn secondary" id="rcCopy">Copy for email</button><button class="btn secondary" id="rcText">Copy as text</button>' +
    (rec.length ? '<button class="btn secondary" id="rcAddr">Copy addresses</button>' : '') +
    (!EMBED && navigator.share ? '<button class="btn secondary" id="rcShare">Share…</button>' : '') +
    (EMBED ? '' : '<button class="btn secondary" id="rcPrint">Print / PDF</button><button class="btn secondary" id="rcDl">Download</button>') + '</div>' +
    (rec.length ? '<details class="addr"><summary>Show addresses</summary><div class="addr-list">' + rec.map(esc).join(', ') + '</div></details>' : '') +
    '<div class="small muted mt8"><b>Copy for email</b> keeps the tables — paste into Gmail or Outlook. <b>Email recap</b> opens your mail app with a plain-text version' + (EMBED ? ' (if it doesn’t open here, use Copy addresses + Copy for email)' : '') + '.</div></div>';
  h += '<div class="recap-preview" id="rcPreview">' + LG.recapHTML(l, w, centerLabel(l)) + '</div>';
  body.innerHTML = h;
  bindWeekPicker(l);

  on('rcEmail', 'click', () => {
    const subject = LG.recapSubject(l, w);
    let bodyText = text;
    const base = 'mailto:?' + (rec.length ? 'bcc=' + encodeURIComponent(rec.join(',')) + '&' : '') + 'subject=' + encodeURIComponent(subject) + '&body=';
    if ((base + encodeURIComponent(bodyText)).length > 7500) {
      bodyText = text.split('\nAVERAGES')[0] + '\n\n(Full averages attached separately — see the league page.)\n\nSent with BowlBoard';
      toast('Recap is long — averages left out of the email body. Use Copy for email for the full version.', 4500);
    }
    window.location.href = base + encodeURIComponent(bodyText);
  });
  on('rcCopy', 'click', async () => { const ok = await copyRich(LG.recapHTML(l, w, centerLabel(l)), text); toast(ok ? 'Copied — paste into your email' : 'Copy failed — try Download instead'); });
  on('rcText', 'click', async () => { toast((await copyText(text)) ? 'Text copied' : 'Copy failed'); });
  on('rcAddr', 'click', async () => { toast((await copyText(rec.join(', '))) ? plural(rec.length, 'address', 'addresses') + ' copied' : 'Copy failed — open Show addresses and select them'); });
  on('rcShare', 'click', async () => { try { await navigator.share({ title: LG.recapSubject(l, w), text }); } catch (e) { /* cancelled */ } });
  on('rcDl', 'click', () => download(slug(l.name) + '-week-' + w + '-recap.html', recapDoc(l, w), 'text/html'));
  on('rcPrint', 'click', () => {
    const win = window.open('', '_blank');
    if (!win) { toast('Allow pop-ups to print, or use Download'); return; }
    win.document.write(recapDoc(l, w));
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  });
};
})();
