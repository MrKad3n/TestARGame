// Player-customisable settings: per-hand element + gesture/button bindings, custom recorded gestures,
// world tuning. Saved in localStorage so they survive reloads.
import { CFG } from './config.js';

// ---------------------------------------------------------------------------
// Actions the player can bind
// ---------------------------------------------------------------------------
// [id, label, help, type]  type: 'hold' = active while the input is held, 'tap' = fires once on press
export const ACTION_DEFS = [
  ['emit', 'Cast element', 'Spawn particles of your hand\'s element at your fingertips.', 'hold'],
  ['empower', 'Empower', 'Fire grows and gets hotter (red > yellow > blue > white). Water warms up.', 'hold'],
  ['compress', 'Compress', 'Squeeze nearby elements of your hand into a tight ball (hotter, denser).', 'hold'],
  ['pull', 'Pull in (gather)', 'Pull ALL elements of both hands in toward your hands. Default: clasp your hands.', 'hold'],
  ['push', 'Blast away', 'Shove nearby elements away from your hand.', 'hold'],
  ['redirect', 'Redirect (throw)', 'Send all of your element flying to where you aim.', 'hold'],
  ['brake', 'Stop momentum', 'Kill the speed of nearby elements of your hand.', 'hold'],
  ['cool', 'Cool water', 'Chill water; cold enough and it freezes into floating ice.', 'hold'],
  ['sweep', 'Sweep (hand motion)', 'Moving your hand pushes nearby elements. Open palm = wider and stronger.', 'hold'],
  ['cycle', 'Next element', 'Switch this hand to fire > water > air.', 'tap'],
  ['selFire', 'Select FIRE', 'Switch this hand to fire.', 'tap'],
  ['selWater', 'Select WATER', 'Switch this hand to water.', 'tap'],
  ['selAir', 'Select AIR', 'Switch this hand to air.', 'tap'],
  ['dispel', 'Dispel all', 'Make all elements of your hand\'s type disappear.', 'tap'],
  ['menu', 'Open menu', 'Open / close the menu.', 'tap'],
];
export const ACTIONS = ACTION_DEFS.map((a) => a[0]);
export const ACTION_LABEL = Object.fromEntries(ACTION_DEFS.map((a) => [a[0], a[1]]));
export const ACTION_HELP = Object.fromEntries(ACTION_DEFS.map((a) => [a[0], a[2]]));
export const TAP_ACTIONS = ACTION_DEFS.filter((a) => a[3] === 'tap').map((a) => a[0]);
export const HOLD_ACTIONS = ACTION_DEFS.filter((a) => a[3] === 'hold').map((a) => a[0]);

// ---------------------------------------------------------------------------
// Gesture catalog (premade). 'single' = one hand, 'pair' = needs both hands.
// ---------------------------------------------------------------------------
export const HAND_GESTURES = [
  { id: 'pinch-index', label: 'Pinch: index', cat: 'single', desc: 'Touch thumb and index finger.' },
  { id: 'pinch-middle', label: 'Pinch: middle', cat: 'single', desc: 'Touch thumb and middle finger.' },
  { id: 'pinch-ring', label: 'Pinch: ring', cat: 'single', desc: 'Touch thumb and ring finger.' },
  { id: 'pinch-pinky', label: 'Pinch: pinky', cat: 'single', desc: 'Touch thumb and little finger.' },
  { id: 'fist', label: 'Fist', cat: 'single', desc: 'Close your hand.' },
  { id: 'palm', label: 'Open palm', cat: 'single', desc: 'Spread your hand open, fingers out.' },
  { id: 'point', label: 'Point', cat: 'single', desc: 'Index finger out, others curled.' },
  { id: 'peace', label: 'Peace sign', cat: 'single', desc: 'Index and middle out, others curled.' },
  { id: 'horns', label: 'Rock horns', cat: 'single', desc: 'Index and pinky out, middle and ring curled.' },
  { id: 'thumbs-up', label: 'Thumbs up', cat: 'single', desc: 'Fist with the thumb sticking out.' },
  { id: 'clasp', label: 'Clasp hands', cat: 'pair', desc: 'Bring both hands together (palms within ~15 cm), fingers curled or interlaced.' },
  { id: 'prayer', label: 'Prayer', cat: 'pair', desc: 'Both open palms pressed flat against each other.' },
  { id: 'clap', label: 'Clap', cat: 'pair', desc: 'Smack your palms together quickly.' },
  { id: 'double-fist', label: 'Both fists', cat: 'pair', desc: 'Make a fist with each hand.' },
  { id: 'double-palm', label: 'Both open palms', cat: 'pair', desc: 'Open both hands.' },
  { id: 'both-pinch', label: 'Both pinch', cat: 'pair', desc: 'Pinch thumb + index on both hands.' },
  { id: 'pinch-stretch', label: 'Pinch & stretch', cat: 'pair', desc: 'Pinch with both hands and pull them apart (like drawing a bow).' },
  { id: 'crossed', label: 'Crossed wrists', cat: 'pair', desc: 'Cross your hands in front of you, left hand on the right side.' },
  { id: 'cupped', label: 'Cupped palms up', cat: 'pair', desc: 'Hold both open palms up like a bowl.' },
  { id: 'arms-wide', label: 'Arms wide', cat: 'pair', desc: 'Spread your hands ~1 metre apart.' },
];
export const CTRL_GESTURES = [
  { id: 'trigger', label: 'Trigger', cat: 'single', desc: 'Index trigger.' },
  { id: 'grip', label: 'Grip', cat: 'single', desc: 'Side grip button.' },
  { id: 'a', label: 'A / X button', cat: 'single', desc: 'Lower face button.' },
  { id: 'b', label: 'B / Y button', cat: 'single', desc: 'Upper face button.' },
  { id: 'stick', label: 'Stick click', cat: 'single', desc: 'Press the thumbstick.' },
  { id: 'both-triggers', label: 'Both triggers', cat: 'pair', desc: 'Pull both triggers.' },
  { id: 'both-grips', label: 'Both grips', cat: 'pair', desc: 'Squeeze both grips (hands together).' },
  { id: 'both-sticks', label: 'Both stick clicks', cat: 'pair', desc: 'Press both thumbsticks.' },
];
export const SPECIAL = [
  { id: 'always', label: 'Always on', cat: 'special', desc: 'Active all the time.' },
  { id: 'none', label: '- none -', cat: 'special', desc: 'Unbound.' },
];
const BY_ID = {};
for (const g of [...HAND_GESTURES, ...CTRL_GESTURES, ...SPECIAL]) BY_ID[g.id] = g;

// recorded gestures: { id, name, mode: 'single'|'pair', mean:[...], tol:[...] }
export const custom = [];

export function gestureInfo(id) {
  if (BY_ID[id]) return BY_ID[id];
  if (typeof id === 'string' && id.startsWith('custom:')) {
    const c = custom.find((x) => 'custom:' + x.id === id);
    if (c) return { id, label: c.name, cat: 'custom', desc: c.mode === 'pair' ? 'Your recorded two-hand gesture.' : 'Your recorded one-hand gesture.' };
  }
  return { id, label: '? ' + id, cat: 'special', desc: '' };
}
export const gestureLabel = (id) => gestureInfo(id).label;
export function isPairGesture(id) {
  if (BY_ID[id]) return BY_ID[id].cat === 'pair';
  const c = custom.find((x) => 'custom:' + x.id === id);
  return !!c && c.mode === 'pair';
}
export function validId(kind, id) {
  if (id === 'always' || id === 'none') return true;
  const list = kind === 'hand' ? HAND_GESTURES : CTRL_GESTURES;
  if (list.some((g) => g.id === id)) return true;
  return kind === 'hand' && typeof id === 'string' && id.startsWith('custom:') && custom.some((c) => 'custom:' + c.id === id);
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
const defHand = () => ({
  emit: 'pinch-index', empower: 'fist', compress: 'pinch-pinky', pull: 'clasp', push: 'double-palm', redirect: 'none',
  brake: 'peace', cool: 'pinch-middle', sweep: 'always', cycle: 'pinch-ring', selFire: 'none', selWater: 'none', selAir: 'none',
  dispel: 'clap', menu: 'none',
});
const defCtrl = () => ({
  emit: 'trigger', empower: 'a', compress: 'none', pull: 'both-grips', push: 'none', redirect: 'grip',
  brake: 'none', cool: 'b', sweep: 'always', cycle: 'stick', selFire: 'none', selWater: 'none', selAir: 'none',
  dispel: 'none', menu: 'none',
});

// Tunables shown in the WORLD tab: [CFG key, label, min, max, step, decimals]
export const TUNABLES = [
  ['burst', 'Particles per tick', 1, 30, 1, 0],
  ['compression', 'Compression (push)', 20, 400, 10, 0],
  ['changeRate', 'Colour rate (heat)', 3, 30, 1, 0],
  ['lifeScale', 'Lifetime multiplier', 0.5, 4, 0.5, 1],
  ['gravity', 'Water gravity', 0.5, 6, 0.5, 1],
  ['reach', 'Empower / cool reach (m)', 0.3, 1.5, 0.1, 1],
  ['maxParticles', 'Particle cap', 200, 900, 50, 0],
  ['maxSpeed', 'Max element speed (m/s)', 2, 15, 1, 0],
  ['sweepGain', 'Hand push strength', 0, 3, 0.25, 2],
  ['sweepRadius', 'Hand push radius (m)', 0.2, 0.8, 0.1, 1],
  ['palmGain', 'Open-palm boost (x)', 1, 6, 0.5, 1],
  ['palmRadius', 'Open-palm radius (m)', 0.3, 2, 0.1, 1],
  ['pullStrength', 'Pull-in strength', 4, 60, 4, 0],
];
export const TUNABLE_PAGE = 7;     // tunables per page in the WORLD tab
const TUNABLE_DEFAULTS = {};
for (const [k] of TUNABLES) TUNABLE_DEFAULTS[k] = CFG[k];

export const settings = {
  menuHand: 'left',
  showMesh: false,
  bindKind: null,                 // which binding set the menu edits: 'hand' | 'ctrl' (null = follow control scheme)
  hands: {
    left: { element: 'water', hand: defHand(), ctrl: defCtrl() },
    right: { element: 'fire', hand: defHand(), ctrl: defCtrl() },
  },
};

const KEY = 'rift-settings-v2';

export function loadSettings() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { /* ignore */ }
  if (!raw) return;
  if (raw.menuHand === 'left' || raw.menuHand === 'right') settings.menuHand = raw.menuHand;
  settings.showMesh = !!raw.showMesh;
  custom.length = 0;
  for (const c of raw.custom || []) {
    if (c && typeof c.id === 'string' && Array.isArray(c.mean) && Array.isArray(c.tol) && c.mean.length === c.tol.length && c.mean.every(Number.isFinite) && c.tol.every(Number.isFinite)) {
      custom.push({ id: c.id, name: String(c.name || 'Custom').slice(0, 24), mode: c.mode === 'pair' ? 'pair' : 'single', mean: c.mean, tol: c.tol });
    }
  }
  for (const id of ['left', 'right']) {
    const r = raw.hands && raw.hands[id];
    if (!r) continue;
    if (['fire', 'water', 'air'].includes(r.element)) settings.hands[id].element = r.element;
    for (const kind of ['hand', 'ctrl']) {
      for (const a of ACTIONS) if (r[kind] && validId(kind, r[kind][a])) settings.hands[id][kind][a] = r[kind][a];
    }
  }
  if (raw.tune) for (const [k, , min, max] of TUNABLES) if (typeof raw.tune[k] === 'number' && raw.tune[k] >= min && raw.tune[k] <= max) CFG[k] = raw.tune[k];
}

let saveTimer = 0;
export function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tune = {}; for (const [k] of TUNABLES) tune[k] = CFG[k];
    try { localStorage.setItem(KEY, JSON.stringify({ menuHand: settings.menuHand, showMesh: settings.showMesh, hands: settings.hands, custom, tune })); } catch (e) { /* private mode */ }
  }, 150);
}

export function addCustom(name, mode, mean, tol) {
  let n = 1; while (custom.some((c) => c.id === 'c' + n)) n++;
  const c = { id: 'c' + n, name: name || `Custom ${n}`, mode, mean, tol };
  custom.push(c); saveSettings();
  return 'custom:' + c.id;
}

export function deleteCustom(gid) {
  const i = custom.findIndex((c) => 'custom:' + c.id === gid);
  if (i < 0) return;
  custom.splice(i, 1);
  for (const h of ['left', 'right']) for (const a of ACTIONS) if (settings.hands[h].hand[a] === gid) settings.hands[h].hand[a] = 'none';
  saveSettings();
}

export function resetHand(id) {
  settings.hands[id].hand = defHand();
  settings.hands[id].ctrl = defCtrl();
  settings.hands[id].element = id === 'left' ? 'water' : 'fire';
  saveSettings();
}

export function copyBindings(from, to, kind) {
  Object.assign(settings.hands[to][kind], settings.hands[from][kind]);
  saveSettings();
}

export function resetAll() {
  resetHand('left'); resetHand('right');
  custom.length = 0;
  settings.menuHand = 'left'; settings.showMesh = false;
  Object.assign(CFG, TUNABLE_DEFAULTS);
  saveSettings();
}
