// Player-customisable settings: per-hand element + input bindings, world tuning.
// Saved in localStorage so they survive reloads.
import { CFG } from './config.js';

export const ACTIONS = ['emit', 'empower', 'redirect', 'cool', 'cycle', 'menu'];
export const ACTION_LABEL = {
  emit: 'Cast element',
  empower: 'Empower (grow / heat)',
  redirect: 'Redirect (pull)',
  cool: 'Cool water',
  cycle: 'Switch element',
  menu: 'Open menu',
};

export const HAND_INPUTS = ['pinch-index', 'pinch-middle', 'pinch-ring', 'pinch-pinky', 'fist', 'palm', 'none'];
export const CTRL_INPUTS = ['trigger', 'grip', 'a', 'b', 'stick', 'none'];
export const INPUT_LABEL = {
  'pinch-index': 'Pinch: index', 'pinch-middle': 'Pinch: middle', 'pinch-ring': 'Pinch: ring', 'pinch-pinky': 'Pinch: pinky',
  fist: 'Fist', palm: 'Open palm',
  trigger: 'Trigger', grip: 'Grip', a: 'A / X button', b: 'B / Y button', stick: 'Stick click',
  none: '- none -',
};
// gesture name -> flag name produced by gestures.js
export const GESTURE_KEY = {
  'pinch-index': 'pinchIndex', 'pinch-middle': 'pinchMiddle', 'pinch-ring': 'pinchRing', 'pinch-pinky': 'pinchPinky',
  fist: 'fist', palm: 'palm',
};

const defHand = () => ({ emit: 'pinch-index', empower: 'fist', redirect: 'palm', cool: 'pinch-middle', cycle: 'pinch-ring', menu: 'none' });
const defCtrl = () => ({ emit: 'trigger', empower: 'a', redirect: 'grip', cool: 'b', cycle: 'stick', menu: 'none' });

// Tunables shown in the WORLD tab: [CFG key, label, min, max, step, decimals]
export const TUNABLES = [
  ['burst', 'Particles per tick', 1, 30, 1, 0],
  ['compression', 'Compression (push)', 20, 400, 10, 0],
  ['changeRate', 'Colour rate (heat)', 3, 30, 1, 0],
  ['lifeScale', 'Lifetime multiplier', 0.5, 4, 0.5, 1],
  ['gravity', 'Water gravity', 0.5, 6, 0.5, 1],
  ['reach', 'Empower / cool reach (m)', 0.3, 1.5, 0.1, 1],
  ['maxParticles', 'Particle cap', 200, 900, 50, 0],
];
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

const KEY = 'rift-settings-v1';

export function loadSettings() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { /* ignore */ }
  if (!raw) return;
  if (raw.menuHand === 'left' || raw.menuHand === 'right') settings.menuHand = raw.menuHand;
  settings.showMesh = !!raw.showMesh;
  for (const id of ['left', 'right']) {
    const r = raw.hands && raw.hands[id];
    if (!r) continue;
    if (['fire', 'water', 'air'].includes(r.element)) settings.hands[id].element = r.element;
    for (const [kind, list] of [['hand', HAND_INPUTS], ['ctrl', CTRL_INPUTS]]) {
      for (const a of ACTIONS) if (r[kind] && list.includes(r[kind][a])) settings.hands[id][kind][a] = r[kind][a];
    }
  }
  if (raw.tune) for (const [k, , min, max] of TUNABLES) if (typeof raw.tune[k] === 'number' && raw.tune[k] >= min && raw.tune[k] <= max) CFG[k] = raw.tune[k];
}

let saveTimer = 0;
export function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tune = {}; for (const [k] of TUNABLES) tune[k] = CFG[k];
    try { localStorage.setItem(KEY, JSON.stringify({ menuHand: settings.menuHand, showMesh: settings.showMesh, hands: settings.hands, tune })); } catch (e) { /* private mode */ }
  }, 150);
}

export function resetHand(id) {
  settings.hands[id].hand = defHand();
  settings.hands[id].ctrl = defCtrl();
  settings.hands[id].element = id === 'left' ? 'water' : 'fire';
  saveSettings();
}

export function resetAll() {
  resetHand('left'); resetHand('right');
  settings.menuHand = 'left'; settings.showMesh = false;
  Object.assign(CFG, TUNABLE_DEFAULTS);
  saveSettings();
}
