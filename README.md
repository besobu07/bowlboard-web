# BowlBoard (web prototype)

Bowling scorekeeping web app — manual score entry, photo score import, game history with stats, alley and ball-arsenal management, and league tracking.

Static prototype: open `index.html` or serve the directory with any static server.

## Run locally

```sh
npx serve .
# or
python3 -m http.server 8000
```

## Tests

```sh
npm install                     # once: only needed for the browser smoke test (Playwright)
npx playwright install chromium # once
npm test                        # service-worker stamp check, unit tests, then the browser smoke test
npm run stamp                   # after changing any cached file: refresh the service worker's VERSION
```

- `test/*.test.js`: scoring, scan reading, the glyph reader, achievements, league, score import, export, insights, storage. No dependencies; run any one with `node test/score.test.js`.
- `test/smoke.test.js`: the real app in Chromium with the CDN scripts blocked: starts clean, scores a game with the pin-count keypad, saves it, opens the photo screen, runs the glyph reader, checks every file the service worker caches is served.
- `test/fixtures/glyph-masks.json` is made by `tools/make_glyph_fixtures.py` (drawn lane screens, no real photos).
- GitHub runs `npm test` on every push (`.github/workflows/test.yml`).
- `sw.js` VERSION is a fingerprint of the cached files, set by `tools/stamp-sw.js`. `npm test` fails if it is stale.
