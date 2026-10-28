// Turns whatever the player is using into two "casters" (left / right):
//   * Quest 3 hand tracking  -> gestures (gestures.js one-hand, pairs.js two-hand, custom recorded)
//   * Quest 2 / Touch controllers -> buttons
//   * Flat screen preview -> mouse + keyboard (same keys as the fire game: Q, Space, R, B)
// What each gesture/button does is set by the player's bindings (settings.js, Gesture Studio).
// The game only ever looks at the Caster objects, so it doesn't care which one is in use.
import * as THREE from 'three';
import {
  analyzeHand, newGestureState, newGestureFlags, pairFeatures, customActive, FEATURE_COUNT, PAIR_FEATURE_COUNT,
} from './gestures.js';
import { analyzePair, newPairState } from './pairs.js';
import { ELEMENTS } from './particles.js';
import { settings, custom, saveSettings, HOLD_ACTIONS, TAP_ACTIONS } from './settings.js';

export const ELEMENT_COLORS = { fire: 0xff5a2a, water: 0x3fa9ff, air: 0xd8f4ff };

export class Caster {
  constructor(id) {
    this.id = id;
    this.cfg = settings.hands[id];   // live per-hand settings (element + bindings), edited by the menu
    this.source = 'none';          // 'hand' | 'controller' | 'mouse' | 'none'
    this.tracked = false;
    this.act = {};                 // held actions: emit, empower, compress, pull, push, redirect, brake, cool, sweep
    for (const a of HOLD_ACTIONS) this.act[a] = false;
    this.pressed = {};             // one-frame tap actions: cycle, selFire, ..., dispel, menu
    for (const a of TAP_ACTIONS) this.pressed[a] = false;
    this.latch = { emit: false, empower: false, redirect: false, cool: false, compress: false, brake: false }; // menu toggle buttons
    this.active = new Set();       // gesture / button ids active this frame (single-hand)
    this.feat = new Array(FEATURE_COUNT).fill(0);
    this.btn = { trigger: false, grip: false, a: false, b: false, stick: false };
    this.emitPos = new THREE.Vector3();
    this.emitDir = new THREE.Vector3(0, 0, -1);
    this.aimOrigin = new THREE.Vector3();
    this.aimDir = new THREE.Vector3(0, 0, -1);
    this.palm = new THREE.Vector3();
    this.palmNormal = new THREE.Vector3(0, 1, 0);
    this.wrist = new THREE.Vector3();
    this.indexTip = new THREE.Vector3();
    this.vel = new THREE.Vector3();      // hand velocity (m/s), used to push elements
    this._prev = new THREE.Vector3(); this._hasPrev = false;
    this.grip = new THREE.Vector3();
    this.gripQuat = new THREE.Quaternion();
  }
  want(action) { return !!(this.act[action] || this.latch[action]); }
  get wantsEmit() { return this.want('emit'); }
  get wantsEmpower() { return this.want('empower'); }
  get wantsRedirect() { return this.want('redirect'); }
  get wantsCool() { return this.want('cool'); }
  get wide() { return this.active.has('palm'); }   // open palm: sweeping reaches farther / pushes harder
  get element() { return this.cfg.element; }
  set element(v) { this.cfg.element = v; saveSettings(); }
  nextElement() { this.element = ELEMENTS[(ELEMENTS.indexOf(this.element) + 1) % ELEMENTS.length]; }
  clearActions() {
    for (const a of HOLD_ACTIONS) this.act[a] = false;
    for (const a of TAP_ACTIONS) this.pressed[a] = false;
  }
}

const JOINTS = [
  'wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _hd = new THREE.Vector3(0, 0, -1);

export class InputManager {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.rig = new THREE.Group();
    scene.add(this.rig);
    this.casters = { left: new Caster('left'), right: new Caster('right') };
    this.slots = [];
    this.pointers = [];            // for the in-world UI: { id, kind:'ray'|'tip', origin, dir, pos, down }
    this.pair = new Set();         // active two-hand gestures / chords this frame
    this.pairState = newPairState();
    this.customOn = {};            // custom gesture hysteresis: key -> bool
    this.cap = null;               // gesture recorder: { mode, hand, frames }
    this.handTrackingSeen = false;
    this.controllerSeen = false;
    this._pairFeat = [];

    const handMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
    const sphere = new THREE.SphereGeometry(1, 8, 6);

    for (let i = 0; i < 2; i++) {
      const ctrl = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      const hand = renderer.xr.getHand(i);
      this.rig.add(ctrl, grip, hand);

      const slot = {
        i, ctrl, grip, hand, src: null, kind: 'none', handedness: 'none',
        gesture: newGestureState(), edge: {}, cd: {},
        handMesh: new THREE.InstancedMesh(sphere, handMat.clone(), JOINTS.length),
        ray: makeRay(),
      };
      for (const a of TAP_ACTIONS) { slot.edge[a] = false; slot.cd[a] = 0; }
      slot.handMesh.frustumCulled = false;
      slot.handMesh.visible = false;
      slot.ray.visible = false;
      this.rig.add(slot.handMesh, slot.ray);

      ctrl.addEventListener('connected', (e) => this.onConnected(slot, e.data));
      ctrl.addEventListener('disconnected', () => this.onDisconnected(slot));
      this.slots.push(slot);
    }
    this._outHand = {
      tracked: false, g: newGestureFlags(), feat: new Array(FEATURE_COUNT).fill(0),
      palm: new THREE.Vector3(), palmNormal: new THREE.Vector3(), wrist: new THREE.Vector3(),
      emitPos: new THREE.Vector3(), emitDir: new THREE.Vector3(0, 0, -1),
      aimOrigin: new THREE.Vector3(), aimDir: new THREE.Vector3(0, 0, -1), indexTip: new THREE.Vector3(),
    };
  }

  onConnected(slot, src) {
    slot.src = src;
    slot.handedness = src.handedness === 'left' || src.handedness === 'right' ? src.handedness : (slot.i === 0 ? 'left' : 'right');
    slot.kind = src.hand ? 'hand' : (src.gamepad ? 'controller' : 'none');
    if (slot.kind === 'hand') this.handTrackingSeen = true;
    if (slot.kind === 'controller') this.controllerSeen = true;
    slot.gesture = newGestureState();
    for (const a of TAP_ACTIONS) slot.edge[a] = false;
  }

  onDisconnected(slot) {
    const c = this.casters[slot.handedness];
    if (c) { c.tracked = false; c.source = 'none'; c.clearActions(); c.active.clear(); }
    slot.src = null; slot.kind = 'none';
    slot.handMesh.visible = false; slot.ray.visible = false;
  }

  // ---- gesture recorder (used by the Gesture Studio) ---------------------------------------
  beginCapture(mode, hand) { this.cap = { mode, hand, frames: [] }; }
  endCapture() { const c = this.cap; this.cap = null; return c ? c.frames : []; }
  captureCount() { return this.cap ? this.cap.frames.length : 0; }

  /** Call once per XR frame. head = world position of the headset, headDir = its forward vector. */
  update(dt, head, headDir = _hd) {
    this.pointers.length = 0;
    for (const c of Object.values(this.casters)) {
      c.clearActions();
      if (c.source !== 'mouse') { c.tracked = false; c.active.clear(); }
    }

    // 1. read every device
    for (const slot of this.slots) {
      if (!slot.src) continue;
      const caster = this.casters[slot.handedness];
      if (!caster) continue;
      if (slot.kind === 'hand') this.updateHand(slot, caster, dt, head);
      else if (slot.kind === 'controller') this.updateController(slot, caster);
    }
    // 2. two-hand gestures / chords
    this.updatePairs(dt, head, headDir);
    // 3. gestures / buttons -> actions through the player's bindings
    for (const slot of this.slots) {
      const caster = slot.src && this.casters[slot.handedness];
      if (caster && caster.tracked && (slot.kind === 'hand' || slot.kind === 'controller')) this.applyBindings(slot, caster, dt);
    }
    // 4. recorder
    this.capture();
    for (const c of Object.values(this.casters)) trackVelocity(c, dt);
  }

  updateHand(slot, caster, dt, head) {
    const joints = slot.hand.joints;
    const get = (name) => { const j = joints[name]; return j && j.visible ? j.position : null; };
    const out = this._outHand;
    analyzeHand(get, slot.handedness, head, slot.gesture, out, dt);

    slot.ray.visible = false;
    caster.source = 'hand';
    caster.tracked = out.tracked;
    if (!out.tracked) { slot.handMesh.visible = false; return; }

    for (const id in out.g) if (out.g[id]) caster.active.add(id);
    for (let i = 0; i < FEATURE_COUNT; i++) caster.feat[i] = out.feat[i];
    // custom one-hand gestures
    for (const def of custom) {
      if (def.mode !== 'single') continue;
      const key = slot.handedness + def.id;
      const on = customActive(def, caster.feat, !!this.customOn[key]);
      this.customOn[key] = on;
      if (on) caster.active.add('custom:' + def.id);
    }

    caster.palm.copy(out.palm); caster.palmNormal.copy(out.palmNormal); caster.wrist.copy(out.wrist);
    caster.emitPos.copy(out.emitPos); caster.emitDir.copy(out.emitDir);
    caster.aimOrigin.copy(out.aimOrigin); caster.aimDir.copy(out.aimDir);
    caster.indexTip.copy(out.indexTip);

    // visual joints
    const color = new THREE.Color(ELEMENT_COLORS[caster.element]);
    slot.handMesh.material.color.copy(color).lerp(new THREE.Color(0xffffff), 0.35);
    slot.handMesh.material.opacity = 0.45;
    let n = 0;
    for (const name of JOINTS) {
      const j = joints[name];
      if (j && j.visible) {
        const r = (j.jointRadius || 0.008) * (name.endsWith('tip') ? 1.25 : 0.9);
        _m.compose(j.position, _q.identity(), _s.set(r, r, r));
        slot.handMesh.setMatrixAt(n++, _m);
      }
    }
    slot.handMesh.count = n;
    slot.handMesh.instanceMatrix.needsUpdate = true;
    slot.handMesh.visible = n > 0;

    // in-world UI: poke with the index fingertip of a hand that isn't pinching / fisting
    if (!out.g['pinch-index'] && !out.g.fist) this.pointers.push({ id: caster.id, kind: 'tip', pos: out.indexTip, down: false, slot });
  }

  updateController(slot, caster) {
    const gp = slot.src.gamepad;
    slot.handMesh.visible = false;
    caster.source = 'controller';
    const grip = slot.grip, ctrl = slot.ctrl;
    ctrl.updateWorldMatrix(true, false);
    ctrl.matrixWorld.decompose(_p, _q, _s);
    caster.tracked = !(_p.x === 0 && _p.y === 0 && _p.z === 0);
    if (!caster.tracked) return;

    _fwd.set(0, 0, -1).applyQuaternion(_q);
    caster.aimOrigin.copy(_p);
    caster.aimDir.copy(_fwd);
    caster.emitPos.copy(_p).addScaledVector(_fwd, 0.07);
    caster.emitDir.copy(_fwd);
    caster.palm.copy(_p);
    caster.wrist.copy(_p);
    grip.updateWorldMatrix(true, false);
    grip.matrixWorld.decompose(caster.grip, caster.gripQuat, _s);
    caster.indexTip.copy(caster.emitPos);

    const b = gp ? gp.buttons : [];
    const pressed = (k) => !!(b[k] && b[k].pressed);
    caster.btn.trigger = pressed(0); caster.btn.grip = pressed(1); caster.btn.stick = pressed(3);
    caster.btn.a = pressed(4); caster.btn.b = pressed(5);
    for (const k in caster.btn) if (caster.btn[k]) caster.active.add(k);

    // visible pointer ray, coloured by element
    slot.ray.visible = true;
    slot.ray.position.copy(_p); slot.ray.quaternion.copy(_q);
    slot.ray.material.color.setHex(ELEMENT_COLORS[caster.element]);

    this.pointers.push({ id: caster.id, kind: 'ray', origin: caster.aimOrigin, dir: caster.aimDir, down: caster.btn.trigger, slot });
  }

  updatePairs(dt, head, headDir) {
    this.pair.clear();
    const L = this.casters.left, R = this.casters.right;
    if (!(L.tracked && R.tracked)) { this.pairState.prevDist = null; return; }
    if (L.source === 'hand' && R.source === 'hand') {
      const a = { palm: L.palm, normal: L.palmNormal, has: (id) => L.active.has(id) };
      const b = { palm: R.palm, normal: R.palmNormal, has: (id) => R.active.has(id) };
      analyzePair(a, b, head, headDir, this.pairState, this.pair, dt);
      let feat = null;
      for (const def of custom) {
        if (def.mode !== 'pair') continue;
        if (!feat) feat = pairFeatures(L.feat, R.feat, L.palm, L.palmNormal, R.palm, R.palmNormal, this._pairFeat);
        const on = customActive(def, feat, !!this.customOn['pair' + def.id]);
        this.customOn['pair' + def.id] = on;
        if (on) this.pair.add('custom:' + def.id);
      }
    } else if (L.source === 'controller' && R.source === 'controller') {
      if (L.btn.trigger && R.btn.trigger) this.pair.add('both-triggers');
      if (L.btn.grip && R.btn.grip) this.pair.add('both-grips');
      if (L.btn.stick && R.btn.stick) this.pair.add('both-sticks');
    }
  }

  isOn(caster, id) {
    if (id === 'always') return true;
    if (id === 'none' || !id) return false;
    return caster.active.has(id) || this.pair.has(id);
  }

  applyBindings(slot, caster, dt) {
    const bind = caster.cfg[slot.kind === 'hand' ? 'hand' : 'ctrl'];
    for (const a of HOLD_ACTIONS) caster.act[a] = this.isOn(caster, bind[a]);
    for (const a of TAP_ACTIONS) {
      slot.cd[a] = Math.max(0, slot.cd[a] - dt);
      const on = this.isOn(caster, bind[a]);
      if (on && !slot.edge[a] && slot.cd[a] <= 0) { caster.pressed[a] = true; slot.cd[a] = 0.5; }
      slot.edge[a] = on;
    }
    const p = caster.pressed;
    if (p.cycle) caster.nextElement();
    if (p.selFire) caster.element = 'fire';
    if (p.selWater) caster.element = 'water';
    if (p.selAir) caster.element = 'air';
    if (p.cycle || p.selFire || p.selWater || p.selAir) this.haptic(slot, 0.25, 40);
  }

  capture() {
    const cap = this.cap;
    if (!cap) return;
    const L = this.casters.left, R = this.casters.right;
    if (cap.mode === 'single') {
      const c = this.casters[cap.hand];
      if (c.tracked && c.source === 'hand') cap.frames.push(c.feat.slice());
    } else if (L.tracked && R.tracked && L.source === 'hand' && R.source === 'hand') {
      cap.frames.push(pairFeatures(L.feat, R.feat, L.palm, L.palmNormal, R.palm, R.palmNormal, []).slice());
    }
  }

  haptic(slot, intensity = 0.3, ms = 40) {
    const gp = slot.src && slot.src.gamepad;
    if (!gp) return;
    try {
      if (gp.hapticActuators && gp.hapticActuators[0] && gp.hapticActuators[0].pulse) gp.hapticActuators[0].pulse(intensity, ms);
      else if (gp.vibrationActuator) gp.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: intensity, weakMagnitude: intensity });
    } catch (e) { /* haptics are best-effort */ }
  }
  hapticFor(id, intensity, ms) {
    for (const s of this.slots) if (s.handedness === id) this.haptic(s, intensity, ms);
  }

  get anyTracked() { return this.casters.left.tracked || this.casters.right.tracked; }
  get usingControllers() { return this.slots.some((s) => s.kind === 'controller'); }
  get usingHands() { return this.slots.some((s) => s.kind === 'hand'); }
}

// Smoothed hand velocity from the palm / controller position. Tiny jitter is ignored.
export function trackVelocity(c, dt) {
  if (!c.tracked || dt <= 0.0005) { c._hasPrev = false; c.vel.set(0, 0, 0); return; }
  if (c._hasPrev) {
    const k = 0.4;
    const rx = (c.palm.x - c._prev.x) / dt, ry = (c.palm.y - c._prev.y) / dt, rz = (c.palm.z - c._prev.z) / dt;
    c.vel.x += (rx - c.vel.x) * k; c.vel.y += (ry - c.vel.y) * k; c.vel.z += (rz - c.vel.z) * k;
    const s = c.vel.length();
    if (s < 0.08) c.vel.set(0, 0, 0);
    else if (s > 8) c.vel.multiplyScalar(8 / s);
  }
  c._prev.copy(c.palm); c._hasPrev = true;
}

function makeRay() {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -0.05), new THREE.Vector3(0, 0, -1.6)]);
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }));
  l.frustumCulled = false;
  return l;
}

// ---------------------------------------------------------------------------
// Flat-screen preview input (desktop / phone browser): behaves like the fire game.
// The "hand" is the mouse moved over a plane in front of the camera.
// ---------------------------------------------------------------------------
export class FlatInput {
  constructor(domElement, camera, caster) {
    this.dom = domElement;
    this.camera = camera;
    this.caster = caster;
    this.keys = new Set();
    this.ndc = new THREE.Vector2(0, 0);
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 1.2); // z = -1.2
    this.pointerDown = false;
    this.enabled = true;
    caster.source = 'mouse';

    domElement.addEventListener('pointermove', (e) => this.move(e));
    domElement.addEventListener('pointerdown', (e) => { this.move(e); this.pointerDown = true; });
    window.addEventListener('pointerup', () => { this.pointerDown = false; });
    window.addEventListener('keydown', (e) => { if (!/INPUT|TEXTAREA/.test(e.target.tagName)) { this.keys.add(e.code); if (e.code === 'Space') e.preventDefault(); } });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }
  move(e) {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  update(dt = 0.016) {
    const c = this.caster;
    if (!this.enabled) { c.tracked = false; return; }
    this.ray.setFromCamera(this.ndc, this.camera);
    const hit = this.ray.ray.intersectPlane(this.plane, c.emitPos);
    if (!hit) c.emitPos.copy(this.ray.ray.direction).multiplyScalar(1.2).add(this.ray.ray.origin);
    c.tracked = true;
    c.palm.copy(c.emitPos); c.indexTip.copy(c.emitPos); c.aimOrigin.copy(c.emitPos);
    c.emitDir.copy(this.ray.ray.direction);
    c.aimDir.copy(this.ray.ray.direction);
    const a = c.act;
    a.emit = this.keys.has('KeyQ') || this.pointerDown;
    a.empower = this.keys.has('Space');
    a.redirect = this.keys.has('KeyR');
    a.cool = this.keys.has('KeyB');
    a.compress = this.keys.has('KeyC');
    a.pull = this.keys.has('KeyG');
    a.push = this.keys.has('KeyV');
    a.brake = this.keys.has('KeyX');
    a.sweep = true;
    trackVelocity(c, dt);
    if (this.keys.has('KeyE')) { if (!this._e) { c.nextElement(); this._e = true; } } else this._e = false;
    c.pressed.dispel = this.keys.has('KeyZ') && !this._z; this._z = this.keys.has('KeyZ');
  }
}
