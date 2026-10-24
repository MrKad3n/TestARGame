// Turns whatever the player is using into two "casters" (left / right):
//   * Quest 3 hand tracking  -> gestures (gestures.js)
//   * Quest 2 / Touch controllers -> buttons (trigger, grip, A/X, B/Y, thumbstick click)
//   * Flat screen preview -> mouse + keyboard (same keys as the fire game: Q, Space, R, B)
// The game only ever looks at the Caster objects, so it doesn't care which one is in use.
import * as THREE from 'three';
import { analyzeHand, newGestureState } from './gestures.js';
import { ELEMENTS } from './particles.js';

export const ELEMENT_COLORS = { fire: 0xff5a2a, water: 0x3fa9ff, air: 0xd8f4ff };

export class Caster {
  constructor(id, element) {
    this.id = id;
    this.element = element;
    this.source = 'none';          // 'hand' | 'controller' | 'mouse' | 'none'
    this.tracked = false;
    this.emit = this.empower = this.redirect = this.cool = false;
    this.latch = { emit: false, empower: false, redirect: false, cool: false }; // on-screen / in-world toggle buttons
    this.cycle = false;            // one-frame "next element" request
    this.emitPos = new THREE.Vector3();
    this.emitDir = new THREE.Vector3(0, 0, -1);
    this.aimOrigin = new THREE.Vector3();
    this.aimDir = new THREE.Vector3(0, 0, -1);
    this.palm = new THREE.Vector3();
    this.palmNormal = new THREE.Vector3(0, 1, 0);
    this.wrist = new THREE.Vector3();
    this.indexTip = new THREE.Vector3();
    this.grip = new THREE.Vector3();
    this.gripQuat = new THREE.Quaternion();
  }
  get wantsEmit() { return this.emit || this.latch.emit; }
  get wantsEmpower() { return this.empower || this.latch.empower; }
  get wantsRedirect() { return this.redirect || this.latch.redirect; }
  get wantsCool() { return this.cool || this.latch.cool; }
  nextElement() { this.element = ELEMENTS[(ELEMENTS.indexOf(this.element) + 1) % ELEMENTS.length]; }
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

export class InputManager {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.rig = new THREE.Group();
    scene.add(this.rig);
    this.casters = { left: new Caster('left', 'water'), right: new Caster('right', 'fire') };
    this.slots = [];
    this.pointers = [];            // for the in-world UI: { id, kind:'ray'|'tip', origin, dir, pos, down }
    this.handTrackingSeen = false;
    this.controllerSeen = false;
    this.onHaptic = null;

    const handMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
    const sphere = new THREE.SphereGeometry(1, 8, 6);

    for (let i = 0; i < 2; i++) {
      const ctrl = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      const hand = renderer.xr.getHand(i);
      this.rig.add(ctrl, grip, hand);

      const slot = {
        i, ctrl, grip, hand, src: null, kind: 'none', handedness: 'none',
        gesture: newGestureState(), prevButtons: [], stickLatch: false,
        handMesh: new THREE.InstancedMesh(sphere, handMat.clone(), JOINTS.length),
        ray: makeRay(),
        prevTipZ: null,
      };
      slot.handMesh.frustumCulled = false;
      slot.handMesh.visible = false;
      slot.ray.visible = false;
      this.rig.add(slot.handMesh, slot.ray);

      ctrl.addEventListener('connected', (e) => this.onConnected(slot, e.data));
      ctrl.addEventListener('disconnected', () => this.onDisconnected(slot));
      this.slots.push(slot);
    }
    this._outHand = {
      tracked: false, emit: false, cool: false, empower: false, redirect: false, cycle: false,
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
    slot.prevButtons = [];
  }

  onDisconnected(slot) {
    const c = this.casters[slot.handedness];
    if (c) { c.tracked = false; c.source = 'none'; c.emit = c.empower = c.redirect = c.cool = false; }
    slot.src = null; slot.kind = 'none';
    slot.handMesh.visible = false; slot.ray.visible = false;
  }

  /** Call once per XR frame. head = world position of the headset. */
  update(dt, head) {
    this.pointers.length = 0;
    for (const c of Object.values(this.casters)) { c.cycle = false; if (c.source !== 'mouse') c.tracked = false; }

    for (const slot of this.slots) {
      if (!slot.src) continue;
      const caster = this.casters[slot.handedness];
      if (!caster) continue;
      if (slot.kind === 'hand') this.updateHand(slot, caster, dt, head);
      else if (slot.kind === 'controller') this.updateController(slot, caster);
    }
  }

  updateHand(slot, caster, dt, head) {
    const joints = slot.hand.joints;
    const get = (name) => { const j = joints[name]; return j && j.visible ? j.position : null; };
    const out = this._outHand;
    analyzeHand(get, slot.handedness, head, slot.gesture, out, dt);

    slot.ray.visible = false;
    caster.source = 'hand';
    caster.tracked = out.tracked;
    if (!out.tracked) { caster.emit = caster.empower = caster.redirect = caster.cool = false; slot.handMesh.visible = false; return; }

    caster.emit = out.emit; caster.empower = out.empower; caster.redirect = out.redirect; caster.cool = out.cool;
    if (out.cycle) { caster.cycle = true; caster.nextElement(); this.haptic(slot, 0.2, 40); }
    caster.palm.copy(out.palm); caster.palmNormal.copy(out.palmNormal); caster.wrist.copy(out.wrist);
    caster.emitPos.copy(out.emitPos); caster.emitDir.copy(out.emitDir);
    caster.aimOrigin.copy(out.aimOrigin); caster.aimDir.copy(out.aimDir);
    caster.indexTip.copy(out.indexTip);

    // visual joints
    const color = new THREE.Color(ELEMENT_COLORS[caster.element]);
    slot.handMesh.material.color.copy(color).lerp(new THREE.Color(0xffffff), 0.35);
    slot.handMesh.material.opacity = caster.wantsEmit || caster.wantsEmpower || caster.wantsRedirect ? 0.85 : 0.45;
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

    // in-world UI: poke with the index fingertip of the hand that isn't pinching
    if (!out.emit) this.pointers.push({ id: caster.id, kind: 'tip', pos: out.indexTip, down: false, slot });
  }

  updateController(slot, caster) {
    const gp = slot.src.gamepad;
    slot.handMesh.visible = false;
    caster.source = 'controller';
    const grip = slot.grip, ctrl = slot.ctrl;
    // grip may not exist yet on the first frame
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
    const trigger = pressed(0), squeeze = pressed(1), stick = pressed(3), btnA = pressed(4), btnB = pressed(5);
    const prev = slot.prevButtons;

    caster.emit = trigger;
    caster.redirect = squeeze;
    caster.empower = btnA;
    caster.cool = btnB;
    if (stick && !prev[3]) { caster.cycle = true; caster.nextElement(); this.haptic(slot, 0.25, 40); }
    slot.prevButtons = [trigger, squeeze, false, stick, btnA, btnB];

    // visible pointer ray, coloured by element
    slot.ray.visible = true;
    slot.ray.position.copy(_p); slot.ray.quaternion.copy(_q);
    slot.ray.material.color.setHex(ELEMENT_COLORS[caster.element]);

    this.pointers.push({ id: caster.id, kind: 'ray', origin: caster.aimOrigin, dir: caster.aimDir, down: trigger, slot });
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
  update() {
    const c = this.caster;
    if (!this.enabled) { c.tracked = false; return; }
    this.ray.setFromCamera(this.ndc, this.camera);
    const hit = this.ray.ray.intersectPlane(this.plane, c.emitPos);
    if (!hit) c.emitPos.copy(this.ray.ray.direction).multiplyScalar(1.2).add(this.ray.ray.origin);
    c.tracked = true;
    c.palm.copy(c.emitPos); c.indexTip.copy(c.emitPos); c.aimOrigin.copy(c.emitPos);
    c.emitDir.copy(this.ray.ray.direction);
    c.aimDir.copy(this.ray.ray.direction);
    c.emit = this.keys.has('KeyQ') || this.pointerDown;
    c.empower = this.keys.has('Space');
    c.redirect = this.keys.has('KeyR');
    c.cool = this.keys.has('KeyB');
    if (this.keys.has('KeyE')) { if (!this._e) { c.nextElement(); this._e = true; } } else this._e = false;
  }
}
