#!/usr/bin/env node
// Stamps sw.js VERSION with a fingerprint of every file the service worker caches, so a deploy always refreshes the
// cached copy on phones, and nobody has to remember to bump it.
//   node tools/stamp-sw.js          rewrite VERSION if the files changed
//   node tools/stamp-sw.js --check  exit 1 if VERSION is out of date, or a cached file is missing (used by npm test)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..'), swPath = path.join(root, 'sw.js'), sw = fs.readFileSync(swPath, 'utf8');
const block = sw.slice(sw.indexOf('const ASSETS = ['), sw.indexOf('];', sw.indexOf('const ASSETS = [')));
const files = [...block.matchAll(/'(\.\/[^']*)'/g)].map(m => m[1]).filter(f => f !== './');
const missing = files.filter(f => !fs.existsSync(path.join(root, f)));
if (missing.length) { console.log('sw.js caches files that do not exist (the whole install would fail):', missing.join(', ')); process.exit(1); }
const h = crypto.createHash('sha256');
files.slice().sort().forEach(f => { h.update(f + '\0'); h.update(fs.readFileSync(path.join(root, f))); h.update('\0'); });
h.update(sw.replace(/const VERSION = '[^']*';/, ''));     // changes to the worker itself count too
const want = h.digest('hex').slice(0, 10), cur = (sw.match(/const VERSION = '([^']*)';/) || [])[1];
if (process.argv.includes('--check')) {
  if (cur === want) { console.log('sw.js VERSION is current (' + want + ', ' + files.length + ' cached files)'); process.exit(0); }
  console.log('sw.js VERSION is stale: it says ' + cur + ' but the files say ' + want + '. Run: node tools/stamp-sw.js'); process.exit(1);
}
if (cur !== want) {
  // the fingerprint includes sw.js, so stamping changes it; settle on a value that is self-consistent
  const out = sw.replace(/const VERSION = '[^']*';/, "const VERSION = '" + want + "';");
  fs.writeFileSync(swPath, out);
}
console.log('sw.js VERSION = ' + want);
