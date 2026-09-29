/* BowlBoard reference data: ball catalog and oil-pattern suggestions. */
(function (global) {
  'use strict';

  // New installs start with no centers: people add their own house the first time
  // they bowl there (sample data brings its own clearly labelled ones).
  const CENTERS = [];

  // Sample of well-known balls; users add their own weight + custom balls.
  const BALL_CATALOG = [
    { brand: 'Storm', name: 'Hy-Road', cover: 'Hybrid Reactive' },
    { brand: 'Storm', name: 'Phaze II', cover: 'Solid Reactive' },
    { brand: 'Storm', name: 'Tropical Surge', cover: 'Pearl Reactive' },
    { brand: 'Storm', name: '!Q Tour', cover: 'Solid Reactive' },
    { brand: 'Roto Grip', name: 'Hustle', cover: 'Solid Reactive' },
    { brand: 'Roto Grip', name: 'Idol Cosmos', cover: 'Pearl Reactive' },
    { brand: 'Roto Grip', name: 'Gem', cover: 'Hybrid Reactive' },
    { brand: 'Hammer', name: 'Black Widow 2.0', cover: 'Hybrid Reactive' },
    { brand: 'Hammer', name: 'Purple Solid Urethane', cover: 'Urethane' },
    { brand: 'Motiv', name: 'Venom Shock', cover: 'Pearl Reactive' },
    { brand: 'Motiv', name: 'Jackal Ghost', cover: 'Solid Reactive' },
    { brand: '900 Global', name: 'Reality', cover: 'Solid Reactive' },
    { brand: '900 Global', name: 'Zen', cover: 'Solid Reactive' },
    { brand: 'Brunswick', name: 'Rhino', cover: 'Pearl Reactive' },
    { brand: 'Brunswick', name: 'TZone', cover: 'Polyester' },
    { brand: 'DV8', name: 'Hellcat', cover: 'Pearl Reactive' },
    { brand: 'Ebonite', name: 'Game Breaker 4', cover: 'Hybrid Reactive' },
    { brand: 'Columbia 300', name: 'White Dot', cover: 'Polyester' },
    { brand: 'Track', name: 'Archetype', cover: 'Hybrid Reactive' },
  ];

  // Suggestions for the oil-pattern field (free text is allowed too).
  const OIL_PATTERNS = [
    'House shot', 'Sport shot', 'Challenge', 'Short oil', 'Long oil',
    'PBA Cheetah', 'PBA Chameleon', 'PBA Scorpion', 'PBA Shark', 'PBA Viper', 'PBA Bear', 'PBA Wolf', 'PBA Badger',
  ];

  // The balls offered when someone adds one: the starter catalog above, plus the whole USBC Approved Ball List
  // (js/ball-list.js, made by tools/make_ball_list.py: { source, updated, brands: { Brand: [names] } }) when that
  // file is loaded. Brands and balls come back A–Z; the same ball listed twice shows once.
  const byText = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });
  let memo = null;
  function ballBook() {
    const src = global.BBBallList || null;
    if (memo && memo.src === src) return memo.book;
    const book = new Map();   // lower-case brand -> { brand, balls: Map(lower-case name -> { name, cover }) }
    const put = (brand, name, cover) => {
      brand = String(brand || '').trim(); name = String(name || '').trim();
      if (!brand || !name) return;
      const k = brand.toLowerCase();
      if (!book.has(k)) book.set(k, { brand, balls: new Map() });
      const balls = book.get(k).balls, n = name.toLowerCase();
      if (!balls.has(n)) balls.set(n, { name, cover: cover || '' });
    };
    BALL_CATALOG.forEach(b => put(b.brand, b.name, b.cover));
    if (src && src.brands) Object.keys(src.brands).forEach(br => (src.brands[br] || []).forEach(n => put(br, n, '')));
    memo = { src, book };
    return book;
  }
  const ballBrands = () => Array.from(ballBook().values()).map(v => v.brand).sort(byText);
  const ballsOf = brand => { const v = ballBook().get(String(brand || '').trim().toLowerCase()); return v ? Array.from(v.balls.values()).sort((a, b) => byText(a.name, b.name)) : []; };
  const ballListInfo = () => { const l = global.BBBallList; return l ? { source: l.source || '', updated: l.updated || '' } : null; };

  global.BBData = { CENTERS, BALL_CATALOG, OIL_PATTERNS, ballBrands, ballsOf, ballListInfo };
})(typeof window !== 'undefined' ? window : globalThis);
