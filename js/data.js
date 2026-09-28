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

  global.BBData = { CENTERS, BALL_CATALOG, OIL_PATTERNS };
})(typeof window !== 'undefined' ? window : globalThis);
