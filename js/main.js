import * as THREE from 'three';
import { CFG, loadCfgFromUrl } from './config.js';
import { ParticleWorld, ELEMENTS } from './particles.js';
import { ParticleRenderer } from './render.js';
import { InputManager, FlatInput, ELEMENT_COLORS } from './input.js';
import { Game } from './game.js';
import { Environment } from './environment.js';
import { UIManager } from './ui.js';
import { Menu } from './menu.js';
import { Studio } from './studio.js';
import { settings, loadSettings } from './settings.js';

loadCfgFromUrl();
loadSettings();

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
const env = new Environment(scene);          // real-world surfaces (room scan / planes / Guardian)
world.env = env;
if (params.get('showmesh') === '1' || settings.showMesh) env.setWireVisible(true);
if (params.get('demo') === '1') {            // desktop preview: a virtual table and back wall to try collisions
  env.addBox('demo-table', [-0.6, 0.78, -1.5], [0.6, 0.84, -0.8]);
  env.addBox('demo-wall', [-3, 0, -2.6], [3, 3, -2.5]);
  env.addBox('demo-pillar', [0.9, 0, -1.9], [1.2, 2, -1.6]);
  env.rebuild(); env.setWireVisible(true);
}
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
// In-world menu: closed by default, opened only by the small menu button on your wrist/controller
// ---------------------------------------------------------------------------
const fmt = (n) => String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const menu = new Menu(ui, {
  game, input, env,
  getScheme: () => scheme,
  onStart: () => startGame(),
  place: (mesh) => placeMenu(mesh),
  openStudio: (hand) => { menu.close(); studio.open(hand); },
});
const studio = new Studio(ui, {
  input,
  getScheme: () => scheme,
  place: (mesh) => placeMenu(mesh),
  onClose: () => menu.open(),
});
studio.panel.visible = false;
menu.panel.visible = false;
menu.badge.mesh.scale.setScalar(0.8);
ui.onClick = (ptr) => { if (ptr.slot) input.haptic(ptr.slot, 0.3, 30); };

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
let boundsPoints = null;

function startGame() {
  getHead();
  game.start(headDir);
  menu.close();
  syncFlatUi();
}

// put a panel in front of the player at about chest height, facing them
function placeMenu(mesh) {
  getHead();
  flatFwd.set(headDir.x, 0, headDir.z);
  if (flatFwd.lengthSq() < 1e-4) flatFwd.set(0, 0, -1);
  flatFwd.normalize();
  mesh.position.set(head.x + flatFwd.x * 0.95, head.y - 0.12, head.z + flatFwd.z * 0.95);
  mesh.lookAt(head.x, mesh.position.y, head.z);
  mesh.scale.setScalar(0.95);
}

game.onEvent = (type) => {
  if (type === 'hurt') { input.hapticFor('left', 0.9, 220); input.hapticFor('right', 0.9, 220); flashHurt(); }
  if (type === 'kill') { input.hapticFor('left', 0.25, 40); input.hapticFor('right', 0.25, 40); }
  if (type === 'hurt' && game.state === 'over') { if (inXR) menu.open('play'); syncFlatUi(); }
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
// The menu button sits above the back of your menu hand (like a watch) / above the controller.
// It only shows while you look at it, so nothing is permanently in your face.
function placeBadge() {
  const c = input.casters[settings.menuHand];
  const m = menu.badge.mesh;
  if (c.tracked && c.source === 'hand') {
    _n.copy(c.palmNormal).negate();
    _p.copy(c.palm).addScaledVector(_n, 0.1);
    m.position.copy(_p);
    m.lookAt(head);
    _n.subVectors(head, _p).normalize();
    menu.badge.visible = _n.dot(c.palmNormal.clone().negate()) > 0.2 || menu.isOpen;
  } else if (c.tracked && c.source === 'controller') {
    _p.copy(c.grip).add(_n.set(0, 0.1, 0));
    m.position.copy(_p);
    m.lookAt(head);
    menu.badge.visible = true;
  } else {
    // menu hand not tracked: park the button low and to the side so you can still get to the menu
    _p.set(head.x, head.y - 0.45, head.z).addScaledVector(headDir, 0.7);
    _p.x += -headDir.z * 0.3; _p.z += headDir.x * 0.3;
    m.position.copy(_p);
    m.lookAt(head);
    menu.badge.visible = true;
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
    const frame = renderer.xr.getFrame();
    if (frame) { try { env.updateFrame(frame, renderer.xr.getReferenceSpace(), boundsPoints); } catch (err) { console.warn('environment', err); } }
    input.update(dt, head, headDir);
    if (needMenuPlace && head.lengthSq() > 0) { needMenuPlace = false; menu.open('play'); }
    if (Object.values(input.casters).some((c) => c.pressed.menu)) { if (studio.isOpen) studio.close(); else menu.toggle(); }
  } else {
    flat.update(dt);
  }

  game.update(dt, { head, casters: input.casters, camQuat });
  particleRenderer.update(world);

  if (inXR) {
    placeBadge();
    ui.update(dt, input.pointers);
    menu.tick(dt);
    studio.tick(dt);
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
      optionalFeatures: ['hand-tracking', 'mesh-detection', 'plane-detection', 'bounded-floor'],
    });
    await renderer.xr.setSession(session);
    session.addEventListener('end', onXREnd);
    inXR = true;
    flat.enabled = false;
    boundsPoints = null;
    // Quest 2 fallback: Guardian boundary (only if the session granted bounded-floor)
    session.requestReferenceSpace('bounded-floor').then((s) => { boundsPoints = s.boundsGeometry && s.boundsGeometry.length ? s.boundsGeometry : null; }).catch(() => {});
    for (const c of Object.values(input.casters)) { c.source = 'none'; c.tracked = false; c.clearActions(); }
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
  if (params.get('demo') !== '1') env.clear();
  flat.enabled = true;
  input.casters.right.source = 'mouse';
  input.casters.left.source = 'none';
  for (const c of Object.values(input.casters)) c.tracked = false;
  menu.close(); menu.badge.visible = false;
  studio.isOpen = false; studio.panel.visible = false; studio.rec = null; input.endCapture();
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
  schemeSel.onchange = () => { scheme = schemeSel.value; refreshIntro(); menu.panel.dirty = true; };
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
window.__rift = { env, THREE, CFG, world, game, input, renderer, scene, camera, startGame, menu, studio, settings, ui };
