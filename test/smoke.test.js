// Smoke test: the real app in a real browser (Chromium via Playwright), against a tiny local static server.
// Checks that it starts clean, that a game can be scored with the pin-count keypad and saved, that the photo screen
// opens and its pieces are there, and that every file the service worker caches is served.
// The two CDN scripts (accounts, text reader) are blocked on purpose: the app must work, and the built-in glyph
// reader must still be there, with no connection. Run: node test/smoke.test.js
const http = require('http'), fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.join(__dirname, '..');
function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* fall back to a global install */ }
  const g = cp.execSync('npm root -g').toString().trim();
  return require(path.join(g, 'playwright'));
}
const { chromium } = loadPlaywright();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff': 'font/woff', '.txt': 'text/plain' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});

let pass = 0, fail = 0;
const check = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.route(/cdn\.jsdelivr\.net|unpkg\.com/, r => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED/.test(m.text())) errors.push(m.text()); });
  const text = sel => page.textContent(sel).then(t => (t || '').replace(/\s+/g, ' ').trim());

  // 1. starts
  await page.goto(base + 'index.html');
  await page.waitForSelector('.tabbar');
  check(await page.title() === 'BowlBoard', 'the page has its title');
  check(await page.evaluate(() => typeof window.supabase === 'object' && typeof window.supabase.createClient === 'function'), 'supabase-js is served from the app itself (no CDN needed)');
  check(await page.evaluate(() => { const t = [...document.scripts].find(x => /tesseract/.test(x.src)); return !!(t && /^sha384-/.test(t.integrity) && /@5\.\d+\.\d+\//.test(t.src)); }), 'the text reader is pinned to an exact version with an integrity hash');
  for (const t of ['home', 'history', 'stats', 'league', 'more']) check(await page.$('[data-nav="' + t + '"]') !== null, 'tab: ' + t);
  check(await page.evaluate(() => !!(window.BBGlyphs && window.BBGlyphModel && window.BBScore && window.BBScan)), 'engines are loaded, including the built-in glyph reader');

  // 2. every tab opens without errors
  for (const t of ['history', 'stats', 'league', 'more', 'home']) { await page.click('[data-nav="' + t + '"]'); await page.waitForTimeout(150); }
  check(errors.length === 0, 'tabs open without errors', errors);

  // 3. score a perfect game with the pin-count keypad
  await page.click('#homeNew');
  await page.click('.mode-card[data-mode="pins"]');
  await page.click('#ngStart');
  await page.waitForSelector('.roll-keypad');
  check(/Enter Score/.test(await text('.roll-panel')), 'the pin-count keypad is the default');
  check(/Maximum Score Possible: 300/.test(await text('.score-line')), 'the maximum score label shows 300 at the start');
  // a 7 then a 2: pins left standing must follow
  await page.click('[data-act="count"][data-count="7"]');
  check(/3 standing/.test(await text('.roll-heading')), 'after a 7 there are 3 pins standing', await text('.roll-heading'));
  check(await page.$('[data-act="count"][data-count="4"]:not([disabled])') === null, 'a 4 is not possible with 3 pins standing');
  await page.click('[data-act="count"][data-count="2"]');
  check(/Frame 2/.test(await text('.roll-heading')), 'the next frame starts after an open frame');
  await page.click('[data-act="undo"]'); await page.click('[data-act="undo"]');   // back to the start
  check(/Frame 1/.test(await text('.roll-heading')), 'undo takes both rolls back');
  for (let i = 0; i < 12; i++) await page.click('.roll-clear');
  await page.waitForSelector('.finish-bar');
  await page.waitForFunction(() => /Score\s*300/.test(document.querySelector('.score-line').textContent), null, { timeout: 5000 }).catch(() => { });   // the number counts up
  check(/Score 300 Final/.test(await text('.score-line')), 'twelve strikes score 300', await text('.score-line'));
  await page.click('[data-act="save"]');
  await page.waitForTimeout(300);
  check(errors.length === 0, 'scoring and saving run without errors', errors);
  await page.click('[data-nav="history"]'); await page.waitForTimeout(200);
  check(/300/.test(await text('#screen, main, .app')), 'the saved 300 shows in Games');

  // 4. photo screen: guidance, both pickers, and the example
  await page.click('[data-nav="home"]'); await page.click('#homeNew');
  await page.click('.mode-card[data-mode="photo"]'); await page.click('#ngStart');
  await page.waitForSelector('.scan-example');
  check(await page.$('img[src="scan-example.svg"]') !== null, 'the scan example image is shown');
  check(await page.$('#photoFile') !== null && await page.$('#photoPick') !== null, 'both a camera and a photo-library picker exist');
  check(/just your row/i.test(await text('.scan-example')), 'the example says to select just your row');

  // 4b. scan feedback: the email to us is words only, short reports ride in the email, long ones are copied
  const mails = await page.evaluate(() => {
    const short = BB.scanMail('Result: ok', 'v9'), long = BB.scanMail('x'.repeat(3000), 'v9');
    return { short: decodeURIComponent(short.href), shortLong: short.long, long: decodeURIComponent(long.href), longLong: long.long };
  });
  check(/^mailto:hello@bowlboard\.app\?subject=BowlBoard scan problem \(v9\)&body=/.test(mails.short) && /Result: ok/.test(mails.short) && !mails.shortLong, 'a short scan report goes straight into the email', mails.short);
  check(mails.longLong && !/xxxx/.test(mails.long) && /Paste them below/.test(mails.long), 'a long scan report is copied and the email says to paste it');
  await page.evaluate(() => { window.BBPhoto.scan = { photo: { w: 100, h: 50 }, lines: [], raw: 'X', passes: [] }; window.BBPhoto.img = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='; window.BBPhoto.cropping = false; BB.RENDER.photo(); });
  check(await page.$('#sendScanBtn') !== null && await page.$('#copyScanBtn') !== null, 'after a scan: Report a scan problem and Copy scan details are offered');

  // 5. the glyph reader runs in the page on a drawn screen
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/glyph-masks.json')));
  const first = fx['dejavu-bold'];
  const lines = await page.evaluate(j => {
    const b = Uint8Array.from(atob(j.data), c => c.charCodeAt(0));
    return fetch('data:application/octet-stream;base64,' + j.data).then(r => r.arrayBuffer()).then(buf => new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer()).then(raw => {
      const bits = new Uint8Array(raw), m = new Uint8Array(j.W * j.H);
      for (let i = 0; i < m.length; i++) m[i] = (bits[i >> 3] >> (i & 7)) & 1;
      return window.BBGlyphs.find(m, j.W, j.H).lines.map(l => l.text);
    });
  }, first);
  check(lines.length >= 2 && lines[0].replace(/ /g, '') === 'X9/72XX53X72X81', 'the glyph reader reads the marks in the browser, offline', lines);

  // 6. every file the service worker caches is actually served
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const block = sw.slice(sw.indexOf('const ASSETS = ['), sw.indexOf('];', sw.indexOf('const ASSETS = [')));
  const files = [...block.matchAll(/'\.\/([^']+)'/g)].map(m => m[1]);
  const bad = [];
  for (const f of files) { const r = await page.request.get(base + f); if (!r.ok()) bad.push(f); }
  check(bad.length === 0, 'all ' + files.length + ' cached files are served', bad);

  check(errors.length === 0, 'no page errors at all during the run', errors);
  await browser.close(); server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); try { server.close(); } catch (x) { } process.exit(1); });
