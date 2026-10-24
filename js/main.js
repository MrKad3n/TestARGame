import * as THREE from 'three';
import { CFG, loadCfgFromUrl } from './config.js';
import { ParticleWorld, ELEMENTS } from './particles.js';
import { ParticleRenderer } from './render.js';
import { InputManager, FlatInput, ELEMENT_COLORS } from './input.js';
import { Game } from './game.js';
import { Panel, UIManager, panelBackground } from './ui.js';

loadCfgFromUrl();

// ---------------------------------------------------------------------------
// Device detection: Quest 3 = hand tracking, everything else = buttons / controllers
// ---------------------------------------------------------------------------
const params = new URLSearchParams(location.search);
const ua = navigator.userAgent;
const isQuest3 = /Quest 3/i.test(ua);                 // matches "Quest 3" and "Quest 3S"
const isQuest = /OculusBrowser|Quest/i.test(ua);
let scheme = params.get('scheme') || (isQuest3 ? 'hands' : 'buttons');
const deviceName = isQuest3 ? 'Meta Quest 3' : /Quest 2/i.test(ua) ? 'Meta Quest 2' : /Quest Pro/i.test(ua) ? 'Meta Quest Pro' : isQuest ? 'Meta Quest' : 'this device';

// ---------------------------------------------------------------------------
// Three.js setup
// ---------------------------------------------------------------------------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x05060c, 1);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation?.(0.5);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.02, 40);
camera.position.set(0, 1.5, 0.6);
camera.lookAt(0, 1.3, -1.5);

const grid = new THREE.GridHelper(12, 24, 0x2a3a66, 0x151c33);
grid.material.transparent = true; grid.material.opacity = 0.7;
scene.add(grid);

const world = new ParticleWorld(CFG);
const particleRenderer = new ParticleRenderer(scene, 1400);
const game = new Game(scene, world);
const input = new InputManager(renderer, scene);
const flat = new FlatInput(canvas, camera, input.casters.right);
input.casters.right.source = 'mouse';
const ui = new UIManager(scene);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------------------
// In-world panels (menu + wrist HUD / controller button deck)
// ---------------------------------------------------------------------------
const fmt = (n) => String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const HELP = {
  hands: [
    ['Pinch thumb + index', 'cast your element'],
    ['Make a fist', 'empower: hotter fire, warmer water'],
    ['Open palm', 'pull elements to where it points'],
    ['Pinch thumb + middle', 'cool water (cold enough = ice)'],
    ['Pinch thumb + ring', 'switch element'],
    ['Poke buttons', 'with your finger. Left hand: water, right: fire'],
  ],
  buttons: [
    ['Trigger', 'cast your element'],
    ['A / X', 'empower: hotter fire, warmer water'],
    ['Grip', 'pull elements to where you aim'],
    ['B / Y', 'cool water (cold enough = ice)'],
    ['Thumbstick click', 'switch element'],
    ['Left controller panel', 'point + trigger: pick element, latch buttons'],
  ],
};

const menuPanel = ui.add(new Panel(0.9, 0.66, (ctx, p) => {
  const W = p.canvas.width, H = p.canvas.height;
  panelBackground(ctx, W, H);
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, '#ff5a2a'); g.addColorStop(0.5, '#ffd24a'); g.addColorStop(1, '#4fc3ff');
  ctx.fillStyle = g; ctx.font = 'bold 66px system-ui, sans-serif';
  ctx.fillText('ELEMENTAL RIFT', W / 2, 96);
  if (game.state === 'over') {
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.fillText('The rift consumed you', W / 2, 170);
    ctx.font = '36px system-ui, sans-serif';
    ctx.fillText(`Score ${fmt(game.score)}   -   Wave ${game.wave}   -   Best ${fmt(game.best)}`, W / 2, 230);
  } else {
    ctx.fillStyle = '#c9d4ff'; ctx.font = '28px system-ui, sans-serif';
    ctx.fillText(scheme === 'hands' ? 'Hand tracking controls' : 'Controller button controls', W / 2, 150);
    ctx.textAlign = 'left';
    HELP[scheme].forEach(([k, v], i) => {
      ctx.font = 'bold 25px system-ui, sans-serif'; ctx.fillStyle = '#ffd24a'; ctx.fillText(k, 48, 205 + i * 38);
      ctx.font = '24px system-ui, sans-serif'; ctx.fillStyle = '#ffffff'; ctx.fillText(v, 330, 205 + i * 38);
    });
  }
}));
menuPanel.buttons.push({
  id: 'start', x: 270, y: 470, w: 360, h: 120, label: () => (game.state === 'over' ? 'PLAY AGAIN' : 'START'), font: 52, color: '#ffd24a',
  active: () => true,
  onClick: () => startGame(),
});

const hudPanel = ui.add(new Panel(0.30, 0.40, (ctx, p) => {
  const W = p.canvas.width, H = p.canvas.height;
  panelBackground(ctx, W, scheme === 'buttons' ? H : 290, '#4fc3ff');
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.fillText(game.state === 'playing' ? `WAVE ${game.wave}` : 'PRACTICE', 24, 50);
  ctx.textAlign = 'right';
  ctx.fillText(fmt(game.score), W - 24, 50);
  ctx.textAlign = 'left'; ctx.font = '28px system-ui, sans-serif';
  let hearts = '';
  for (let i = 0; i < 5; i++) hearts += i < game.lives ? '♥ ' : '♡ ';
  ctx.fillStyle = '#ff6b8a'; ctx.fillText(hearts, 24, 92);
  ctx.fillStyle = '#c9d4ff'; ctx.font = '22px system-ui, sans-serif';
  ctx.fillText(`L: ${input.casters.left.element}   R: ${input.casters.right.element}`, 24, 126);
  ctx.fillText(`${game.enemies.length} creatures`, 24, 154);
  if (scheme === 'hands') {
    ctx.fillStyle = '#7f8bb8'; ctx.font = '18px system-ui, sans-serif';
    ctx.fillText(gestureDebug(), 24, 268);
  }
}));
const elementColors = { fire: '#ff5a2a', water: '#3fa9ff', air: '#d8f4ff' };
ELEMENTS.forEach((el, i) => hudPanel.buttons.push({
  id: el, x: 14 + i * 95, y: 172, w: 90, h: 56, label: el.toUpperCase(), font: 19, color: elementColors[el],
  active: () => input.casters.right.element === el,
  onClick: (ptr) => { const c = input.casters[ptr.id]; if (c) c.element = el; },
}));
// extra toggle row for button-only players (Quest 2 etc)
[['emit', 'CAST'], ['empower', 'HEAT'], ['redirect', 'PULL'], ['cool', 'COOL']].forEach(([k, label], i) => hudPanel.buttons.push({
  id: k, x: 18 + (i % 2) * 138, y: 244 + Math.floor(i / 2) * 68, w: 130, h: 58, label, font: 24, color: '#ffd24a',
  hidden: scheme !== 'buttons',
  active: () => input.casters.left.latch[k] || input.casters.right.latch[k],
  onClick: (ptr) => { const c = input.casters[ptr.id]; if (c) c.latch[k] = !c.latch[k]; },
}));
hudPanel.mesh.scale.setScalar(scheme === 'hands' ? 0.62 : 0.85);
ui.onClick = (ptr) => { if (ptr.slot) input.haptic(ptr.slot, 0.3, 30); };

let lastGestureText = '';
function gestureDebug() {
  const r = input.casters.right, l = input.casters.left;
  const f = (c) => [c.tracked ? '' : '-', c.emit ? 'pinch' : '', c.empower ? 'fist' : '', c.redirect ? 'palm' : '', c.cool ? 'cool' : ''].join(' ').trim() || 'idle';
  return `L ${f(l)} | R ${f(r)}`;
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------
const head = new THREE.Vector3();
const headDir = new THREE.Vector3();
const camQuat = new THREE.Quaternion();
const flatFwd = new THREE.Vector3();
let inXR = false;
let xrKind = 'immersive-ar';
let needMenuPlace = false;

function startGame() {
  getHead();
  game.start(headDir);
  menuPanel.visible = false;
  syncFlatUi();
}

function placeMenu() {
  flatFwd.set(headDir.x, 0, headDir.z);
  if (flatFwd.lengthSq() < 1e-4) flatFwd.set(0, 0, -1);
  flatFwd.normalize();
  menuPanel.mesh.position.set(head.x + flatFwd.x * 1.1, head.y - 0.12, head.z + flatFwd.z * 1.1);
  menuPanel.mesh.lookAt(head.x, menuPanel.mesh.position.y, head.z);
  menuPanel.visible = true;
  menuPanel.dirty = true;
}

game.onEvent = (type) => {
  if (type === 'hurt') { input.hapticFor('left', 0.9, 220); input.hapticFor('right', 0.9, 220); flashHurt(); }
  if (type === 'kill') { input.hapticFor('left', 0.25, 40); input.hapticFor('right', 0.25, 40); }
  if (game.state === 'over') { if (inXR) placeMenu(); syncFlatUi(); }
};

function getHead() {
  if (inXR) {
    const cam = renderer.xr.getCamera();
    cam.getWorldPosition(head);
    cam.getWorldQuaternion(camQuat);
  } else {
    camera.getWorldPosition(head);
    camera.getWorldQuaternion(camQuat);
  }
  headDir.set(0, 0, -1).applyQuaternion(camQuat);
}

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
function placeHud() {
  const L = input.casters.left;
  const m = hudPanel.mesh;
  if (L.tracked && L.source === 'hand') {
    // floats over the back of the left hand like a watch; only shows when you look at it
    _n.copy(L.palmNormal).negate();
    _p.copy(L.palm).addScaledVector(_n, 0.12);
    m.position.copy(_p);
    m.lookAt(head);
    _n.subVectors(head, _p).normalize();
    const facing = _n.dot(L.palmNormal.clone().negate());
    hudPanel.visible = facing > 0.25;
  } else if (L.tracked && L.source === 'controller') {
    _p.copy(L.grip).add(_n.set(0, 0.13, 0));
    m.position.copy(_p);
    m.lookAt(head);
    hudPanel.visible = true;
  } else {
    // no left hand/controller: park the HUD to the left of the menu spot
    _p.set(head.x, head.y - 0.25, head.z).addScaledVector(headDir, 0.9);
    _p.x += -headDir.z * 0.45; _p.z += headDir.x * 0.45;
    m.position.copy(_p);
    m.lookAt(head);
    hudPanel.visible = true;
  }
}

let hudTimer = 0;
let lastT = performance.now();
const hurtEl = document.getElementById('hurt');
function flashHurt() { if (!hurtEl) return; hurtEl.style.opacity = '0.6'; setTimeout(() => { hurtEl.style.opacity = '0'; }, 120); }

function loop() {
  const now = performance.now();
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  const xr = renderer.xr.isPresenting;
  if (xr !== inXR) { inXR = xr; }
  getHead();

  if (inXR) {
    input.update(dt, head);
    if (needMenuPlace && head.lengthSq() > 0) { needMenuPlace = false; placeMenu(); }
  } else {
    flat.update();
  }

  game.update(dt, { head, casters: input.casters, camQuat });
  particleRenderer.update(world);

  if (inXR) {
    placeHud();
    ui.update(dt, input.pointers);
    hudTimer -= dt;
    if (hudTimer <= 0) { hudPanel.dirty = true; hudTimer = 0.25; }
    ui.redrawDirty();
  } else {
    hudTimer -= dt;
    if (hudTimer <= 0) { hudTimer = 0.15; updateFlatHud(); }
  }
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(loop);

// ---------------------------------------------------------------------------
// WebXR session handling
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const intro = $('intro');
const flatUi = $('flat-ui');

async function enterXR(kind) {
  if (!navigator.xr) return;
  xrKind = kind;
  try {
    const session = await navigator.xr.requestSession(kind, {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hand-tracking'],
    });
    await renderer.xr.setSession(session);
    session.addEventListener('end', onXREnd);
    inXR = true;
    flat.enabled = false;
    for (const c of Object.values(input.casters)) { c.source = 'none'; c.tracked = false; c.emit = c.empower = c.redirect = c.cool = false; }
    intro.style.display = 'none';
    flatUi.style.display = 'none';
    const ar = kind === 'immersive-ar';
    renderer.setClearColor(0x000000, ar ? 0 : 1);
    scene.background = ar ? null : new THREE.Color(0x05060c);
    grid.visible = !ar;
    game.state = 'menu';
    game.clearEnemies();
    needMenuPlace = true;
  } catch (err) {
    console.error(err);
    $('status').textContent = `Could not start ${kind === 'immersive-ar' ? 'AR' : 'VR'}: ${err.message}`;
  }
}

function onXREnd() {
  inXR = false;
  flat.enabled = true;
  input.casters.right.source = 'mouse';
  input.casters.left.source = 'none';
  for (const c of Object.values(input.casters)) { c.tracked = false; c.element = c.id === 'left' ? 'water' : 'fire'; }
  menuPanel.visible = false; hudPanel.visible = false;
  renderer.setClearColor(0x05060c, 1);
  scene.background = null;
  grid.visible = true;
  game.state = 'menu';
  game.clearEnemies();
  intro.style.display = 'flex';
  flatUi.style.display = 'none';
}

async function detect() {
  const status = $('status');
  const arBtn = $('btn-ar'), vrBtn = $('btn-vr');
  arBtn.disabled = vrBtn.disabled = true;
  let ar = false, vr = false;
  if (navigator.xr) {
    try { ar = await navigator.xr.isSessionSupported('immersive-ar'); } catch (e) { /* ignore */ }
    try { vr = await navigator.xr.isSessionSupported('immersive-vr'); } catch (e) { /* ignore */ }
  }
  arBtn.disabled = !ar;
  vrBtn.disabled = !vr;
  vrBtn.style.display = !ar && vr ? 'inline-block' : 'none';
  const schemeSel = $('scheme');
  schemeSel.value = scheme;
  schemeSel.onchange = () => { scheme = schemeSel.value; refreshIntro(); hudPanel.buttons.forEach((b) => { if (['emit', 'empower', 'redirect', 'cool'].includes(b.id)) b.hidden = scheme !== 'buttons'; }); hudPanel.mesh.scale.setScalar(scheme === 'hands' ? 0.62 : 0.85); hudPanel.dirty = true; menuPanel.dirty = true; };
  if (ar) status.textContent = `Detected ${deviceName}. ${scheme === 'hands' ? 'Hand tracking controls are on.' : 'Controller button controls are on.'}`;
  else if (vr) status.textContent = `${deviceName}: passthrough AR isn't available, VR mode will be used.`;
  else status.textContent = 'WebXR immersive mode not available here (needs the Meta Quest Browser over HTTPS). You can still try the on-screen preview.';
  refreshIntro();
}

function refreshIntro() {
  $('how-hands').style.display = scheme === 'hands' ? 'block' : 'none';
  $('how-buttons').style.display = scheme === 'buttons' ? 'block' : 'none';
}

$('btn-ar').onclick = () => enterXR('immersive-ar');
$('btn-vr').onclick = () => enterXR('immersive-vr');
$('btn-flat').onclick = () => {
  intro.style.display = 'none';
  flatUi.style.display = 'block';
  syncFlatUi();
};
$('btn-exit-flat').onclick = () => { flatUi.style.display = 'none'; intro.style.display = 'flex'; };

// ---------------------------------------------------------------------------
// Flat-screen preview UI (the fire game's buttons + inputs, plus game controls)
// ---------------------------------------------------------------------------
document.querySelectorAll('[data-element]').forEach((b) => {
  b.addEventListener('click', () => { input.casters.right.element = b.dataset.element; updateFlatHud(); });
});
document.querySelectorAll('[data-hold]').forEach((b) => {
  const key = b.dataset.hold;
  const on = (e) => { input.casters.right.latch[key] = true; b.classList.add('down'); e.preventDefault(); };
  const off = () => { input.casters.right.latch[key] = false; b.classList.remove('down'); };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointerleave', off);
  b.addEventListener('pointercancel', off);
});
const bindNum = (id, key) => { const el = $(id); el.value = CFG[key]; el.addEventListener('input', () => { const v = parseFloat(el.value); if (v > 0) CFG[key] = v; }); };
bindNum('compression-meter', 'compression');
bindNum('change-rate', 'changeRate');
bindNum('particlesPerClick', 'burst');

$('btn-start').onclick = () => { startGame(); };

function syncFlatUi() {
  $('btn-start').style.display = game.state === 'playing' ? 'none' : 'inline-block';
  $('btn-start').textContent = game.state === 'over' ? 'Play again' : 'Start game';
}

function updateFlatHud() {
  const el = $('hud');
  if (!el) return;
  const c = world.counts();
  const hearts = '♥'.repeat(Math.max(0, game.lives)) + '♡'.repeat(Math.max(0, 5 - game.lives));
  el.innerHTML = game.state === 'over'
    ? `<b>Game over</b> &mdash; score ${fmt(game.score)}, wave ${game.wave} (best ${fmt(game.best)})`
    : `${game.state === 'playing' ? `<b>Wave ${game.wave}</b>` : '<b>Practice</b>'} &nbsp; ${hearts} &nbsp; score ${fmt(game.score)} &nbsp; ${game.enemies.length} creatures`
      + `<br><small>element: <b>${input.casters.right.element}</b> &nbsp; fire ${c.fire} water ${c.water} ice ${c.ice} air ${c.air}</small>`;
  document.querySelectorAll('[data-element]').forEach((b) => b.classList.toggle('sel', b.dataset.element === input.casters.right.element));
  syncFlatUi();
  const banner = $('banner');
  if (banner) { banner.textContent = game.bannerT > 0 ? game.banner : ''; banner.style.opacity = game.bannerT > 0 ? Math.min(1, game.bannerT) : 0; }
}

detect();

// handy for debugging / tests
window.__rift = { THREE, CFG, world, game, input, renderer, scene, camera, startGame, hudPanel, menuPanel, ui };
