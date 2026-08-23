/* All balance + content data lives here so the game is easy to tune. */
(function (BPT) {
  'use strict';

  /* ------------------------------------------------------------- balloons */
  const BALLOONS = [
    { name: 'Red',    color: '#ff4242', hp: 1,     pay: 1,     speed: 1.55, scale: 0.95 },
    { name: 'Orange', color: '#ff8f2e', hp: 3,     pay: 3,     speed: 1.40, scale: 1.00 },
    { name: 'Blue',   color: '#4285ff', hp: 7,     pay: 8,     speed: 1.25, scale: 1.06 },
    { name: 'Green',  color: '#31d963', hp: 15,    pay: 20,    speed: 1.10, scale: 1.13 },
    { name: 'Yellow', color: '#ffd52e', hp: 32,    pay: 48,    speed: 0.95, scale: 1.20 },
    { name: 'Purple', color: '#ab5cf7', hp: 70,    pay: 118,   speed: 0.82, scale: 1.30 },
    { name: 'Cyan',   color: '#26d9ef', hp: 155,   pay: 290,   speed: 0.70, scale: 1.40 },
    { name: 'Pink',   color: '#f978c0', hp: 340,   pay: 720,   speed: 0.60, scale: 1.52 },
    { name: 'Onyx',   color: '#8b93a7', hp: 780,   pay: 1850,  speed: 0.50, scale: 1.66 },
    { name: 'Prism',  color: '#ffffff', hp: 1800,  pay: 4800,  speed: 0.42, scale: 1.80, iridescent: 1 },
  ];
  const GOLD = { name: 'Gold', color: '#ffd24a', hp: 55, pay: 0, speed: 2.4, scale: 1.15, glow: 1 };
  const BOSS = { name: 'Bloatoon', color: '#e0304a', hp: 1, pay: 0, speed: 0.30, scale: 4.2, boss: 1 };

  /* ------------------------------------------------------------- upgrades */
  const UPGRADES = [
    { key: 'rate',  title: 'Spawn Rate', desc: 'Balloons arrive faster',
      max: 25, base: 180,   grow: 1.65, accent: '#7dd3fc' },
    { key: 'limit', title: 'Spawn Limit', desc: 'More balloons at once',
      max: 25, base: 270,   grow: 1.67, accent: '#a3e635' },
    { key: 'cash',  title: 'Cash / Hit', desc: 'Every hit pays more',
      max: 25, base: 150,   grow: 1.63, accent: '#ffd24a' },
    { key: 'damage',title: 'Pop Power', desc: 'More damage per shot',
      max: 25, base: 210,   grow: 1.63, accent: '#fb7185' },
    { key: 'fire',  title: 'Fire Rate', desc: 'Shoot faster',
      max: 20, base: 650,   grow: 1.79, accent: '#f97316' },
    { key: 'range', title: 'Range', desc: 'Reach further downrange',
      max: 18, base: 900,   grow: 1.77, accent: '#c084fc' },
    { key: 'crit',  title: 'Crit Chance', desc: 'Chance of a x4 hit',
      max: 20, base: 1400,  grow: 1.77, accent: '#f43f5e' },
    { key: 'drone', title: 'Drones', desc: 'Auto-popping helpers',
      max: 6,  base: 35000, grow: 3.70, accent: '#5eead4' },
  ];

  // Effects are multiplicative so upgrades keep feeling worthwhile at every level.
  const EFFECT = {
    spawnInterval: (l) => Math.max(0.06, 1.8 * Math.pow(0.88, l)),
    maxBalloons:   (l) => Math.min(300, Math.round(7 * Math.pow(1.13, l))),
    cashMult:      (l) => Math.pow(1.20, l),
    damage:        (l) => Math.pow(1.20, l),
    fireRate:      (l) => 3.2 * Math.pow(1.055, l),
    range:         (l) => 22 + 6 * l,
    critChance:    (l) => Math.min(0.55, 0.026 * l),
    droneCount:    (l) => l,
  };
  const cost = (u, level) => Math.ceil(u.base * Math.pow(u.grow, level));

  /* -------------------------------------------------------------- arenas */
  const ARENAS = [
    {
      id: 'meadow', name: 'Sunny Meadow', sub: 'Where it all began', accent: '#a3e635',
      mult: 1, unlock: 0,
      sky: { zenith: [0.11, 0.31, 0.72], horizon: [0.56, 0.76, 0.95], sun: [1.0, 0.95, 0.82],
             sunDir: [0.42, 0.38, -0.82], cloud: 0.5, cloudTint: [1, 1, 1], star: 0 },
      fog: { color: [0.56, 0.72, 0.88], density: 0.0030 },
      light: { dir: [0.42, 0.62, -0.66], color: [1.0, 0.96, 0.86], ambient: [0.20, 0.25, 0.34], intensity: 0.92 },
      ground: { groundA: '#41773a', groundB: '#5e9c48', groundC: '#2c5730', plaza: '#b9a887' },
      props: { kind: 'tree', count: 170, colorA: '#276b32', colorB: '#4a9440', trunk: '#5c3f22', grass: 1 },
    },
    {
      id: 'dunes', name: 'Sunset Dunes', sub: 'Golden hour, forever', accent: '#fb923c',
      mult: 1.35, unlock: 1,
      sky: { zenith: [0.14, 0.12, 0.36], horizon: [0.92, 0.44, 0.22], sun: [1.0, 0.62, 0.30],
             sunDir: [-0.70, 0.10, -0.70], cloud: 0.62, cloudTint: [0.95, 0.55, 0.45], star: 0.25 },
      fog: { color: [0.62, 0.38, 0.34], density: 0.0038 },
      light: { dir: [-0.62, 0.40, -0.68], color: [1.0, 0.70, 0.46], ambient: [0.24, 0.17, 0.22], intensity: 0.98 },
      ground: { groundA: '#8f6d3f', groundB: '#c19a5e', groundC: '#6a4d2a', plaza: '#d8b98a' },
      props: { kind: 'palm', count: 110, colorA: '#3d5f2e', colorB: '#65893f', trunk: '#6b5232', grass: 0.35 },
    },
    {
      id: 'neon', name: 'Neon Night', sub: 'Synthwave overdrive', accent: '#22d3ee',
      mult: 1.9, unlock: 3,
      sky: { zenith: [0.02, 0.01, 0.07], horizon: [0.32, 0.04, 0.36], sun: [1.0, 0.20, 0.65],
             sunDir: [0.0, 0.04, -1.0], cloud: 0.2, cloudTint: [0.5, 0.15, 0.6], star: 1 },
      fog: { color: [0.10, 0.03, 0.18], density: 0.0042 },
      light: { dir: [0.2, 0.55, -0.8], color: [0.68, 0.48, 1.0], ambient: [0.13, 0.09, 0.26], intensity: 0.85 },
      ground: { groundA: '#150d33', groundB: '#2b1552', groundC: '#0a0620', plaza: '#2d2160' },
      props: { kind: 'pylon', count: 130, colorA: '#22d3ee', colorB: '#f0abfc', trunk: '#2a2050', grass: 0, emissive: 1 },
    },
    {
      id: 'frost', name: 'Frostfield', sub: 'Cold hands, warm profits', accent: '#bae6fd',
      mult: 2.6, unlock: 6,
      sky: { zenith: [0.26, 0.42, 0.68], horizon: [0.74, 0.84, 0.94], sun: [0.88, 0.94, 1.0],
             sunDir: [0.5, 0.26, -0.83], cloud: 0.8, cloudTint: [0.88, 0.92, 0.98], star: 0 },
      fog: { color: [0.72, 0.82, 0.92], density: 0.0048 },
      light: { dir: [0.5, 0.55, -0.67], color: [0.88, 0.93, 1.0], ambient: [0.28, 0.33, 0.44], intensity: 0.86 },
      ground: { groundA: '#9fb3c8', groundB: '#d8e6f2', groundC: '#7d94ac', plaza: '#8fa8bd' },
      props: { kind: 'pine', count: 190, colorA: '#1e3c36', colorB: '#356451', trunk: '#3d2f24', grass: 0 },
    },
    {
      id: 'cloud', name: 'Cloud Nine', sub: 'The sky is the floor', accent: '#f0abfc',
      mult: 3.8, unlock: 10,
      sky: { zenith: [0.20, 0.44, 0.88], horizon: [0.94, 0.72, 0.86], sun: [1.0, 0.93, 0.88],
             sunDir: [-0.3, 0.5, -0.81], cloud: 0.95, cloudTint: [1, 0.97, 1], star: 0 },
      fog: { color: [0.84, 0.78, 0.92], density: 0.0052 },
      light: { dir: [-0.3, 0.72, -0.62], color: [1.0, 0.96, 0.98], ambient: [0.34, 0.32, 0.42], intensity: 0.92 },
      ground: { groundA: '#b9c4e6', groundB: '#e8edfb', groundC: '#94a3d0', plaza: '#cdd6f5' },
      props: { kind: 'cloudpuff', count: 130, colorA: '#ffffff', colorB: '#dde5ff', trunk: '#dfe6ff', grass: 0 },
    },
  ];

  /* -------------------------------------------------------- achievements */
  const ACHIEVEMENTS = [
    { id: 'pop1',    name: 'First Pop',        desc: 'Pop a balloon',                test: s => s.popped >= 1 },
    { id: 'pop100',  name: 'Getting Started',  desc: 'Pop 100 balloons',             test: s => s.popped >= 100 },
    { id: 'pop1k',   name: 'Balloon Menace',   desc: 'Pop 1,000 balloons',           test: s => s.popped >= 1000 },
    { id: 'pop10k',  name: 'Latex Apocalypse', desc: 'Pop 10,000 balloons',          test: s => s.popped >= 10000 },
    { id: 'pop100k', name: 'Why Are You Here', desc: 'Pop 100,000 balloons',         test: s => s.popped >= 100000 },
    { id: 'cash1k',  name: 'Pocket Change',    desc: 'Earn $1,000 total',            test: s => s.lifetime >= 1000 },
    { id: 'cash1m',  name: 'Balloon Baron',    desc: 'Earn $1,000,000 total',        test: s => s.lifetime >= 1e6 },
    { id: 'cash1b',  name: 'Latex Tycoon',     desc: 'Earn $1,000,000,000 total',    test: s => s.lifetime >= 1e9 },
    { id: 'combo10', name: 'On a Roll',        desc: 'Reach a x3 combo',             test: s => s.bestCombo >= 3 },
    { id: 'combo25', name: 'Untouchable',      desc: 'Reach the max combo',          test: s => s.bestCombo >= 8 },
    { id: 'gold1',   name: 'Gold Rush',        desc: 'Pop a golden balloon',         test: s => s.golds >= 1 },
    { id: 'gold25',  name: 'Midas Touch',      desc: 'Pop 25 golden balloons',       test: s => s.golds >= 25 },
    { id: 'boss1',   name: 'Giant Slayer',     desc: 'Take down a Bloatoon',         test: s => s.bosses >= 1 },
    { id: 'boss10',  name: 'Bloat Buster',     desc: 'Take down 10 Bloatoons',       test: s => s.bosses >= 10 },
    { id: 'reb1',    name: 'Born Again',       desc: 'Rebirth once',                 test: s => s.rebirths >= 1 },
    { id: 'reb5',    name: 'Cycle of Latex',   desc: 'Rebirth 5 times',              test: s => s.rebirths >= 5 },
    { id: 'reb10',   name: 'Eternal Return',   desc: 'Rebirth 10 times',             test: s => s.rebirths >= 10 },
    { id: 'maxone',  name: 'Fully Invested',   desc: 'Max out any upgrade',          test: s => s.anyMaxed },
    { id: 'maxall',  name: 'Perfectionist',    desc: 'Max out every upgrade',        test: s => s.allMaxed },
    { id: 'arena2',  name: 'Sun Seeker',       desc: 'Unlock Sunset Dunes',          test: s => s.rebirths >= 1 },
    { id: 'arena3',  name: 'Night Shift',      desc: 'Unlock Neon Night',            test: s => s.rebirths >= 3 },
    { id: 'arena5',  name: 'Head in the Clouds',desc: 'Unlock Cloud Nine',           test: s => s.rebirths >= 10 },
    { id: 'drone',   name: 'Robot Friends',    desc: 'Buy your first drone',         test: s => s.lv.drone >= 1 },
    { id: 'dronemax',name: 'Swarm Commander',  desc: 'Own six drones',               test: s => s.lv.drone >= 6 },
    { id: 'prism',   name: 'Spectrum',         desc: 'Pop a Prism balloon',          test: s => s.tierPops[9] >= 1 },
    { id: 'walk',    name: 'Long Walk',        desc: 'Travel 5 km on foot',          test: s => s.distance >= 5000 },
  ];

  const TUNING = {
    eyeHeight: 1.72,
    walkSpeed: 8.5,
    sprintSpeed: 14.5,
    jumpSpeed: 7.2,
    gravity: 20,
    plazaRadius: 18,
    kioskRadius: 27,
    worldRadius: 130,
    orbitInner: 7,
    orbitOuter: 21,
    orbitLow: 2.4,
    orbitHigh: 12.5,
    aimAssist: 1.35,
    comboWindow: 2.4,
    comboMax: 8,
    comboStep: 0.35,
    critMult: 4,
    goldEvery: [38, 72],       // seconds between golden balloons
    goldFrenzy: 20,            // seconds of x3 cash
    goldFrenzyMult: 3,
    bossEvery: 350,            // pops between bosses
    bossHpFactor: 26,          // x current dps-ish scaling
    rebirthBase: 150000,
    rebirthGrow: 12,
    offlineCapHours: 8,
    offlineRate: 0.35,
  };

  BPT.Config = { BALLOONS, GOLD, BOSS, UPGRADES, EFFECT, cost, ARENAS, ACHIEVEMENTS, TUNING };
})(window.BPT = window.BPT || {});
