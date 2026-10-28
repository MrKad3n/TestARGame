// ELEMENTAL RIFT - game rules.
//
// Rifts open around you and send elemental creatures floating toward your head.
//   Frost wisp  - melts under fire (hotter fire = faster). Water just makes it sluggish.
//   Ember imp   - put out by water (cold water and ice hurt most). Fire heals it.
//   Stone husk  - only cracks under blue/white-hot fire (power >= 2 x change-rate), so you must
//                 EMPOWER / compress your flames. Soak it with water first and fire does 2.5x.
// Air gusts knock creatures back, ice shards you freeze in mid-air slow and shove them.
// Every creature that reaches you costs a heart. Survive as many waves as you can.
import * as THREE from 'three';
import { CFG } from './config.js';

export const ENEMY_TYPES = {
  frost: { name: 'Frost wisp', color: [0.45, 0.82, 1.0], hp: 60, r: 0.16, speed: 0.30, score: 100 },
  ember: { name: 'Ember imp', color: [1.0, 0.42, 0.12], hp: 60, r: 0.15, speed: 0.34, score: 150 },
  husk: { name: 'Stone husk', color: [0.66, 0.6, 0.5], hp: 140, r: 0.22, speed: 0.20, score: 300 },
};

const RIM_VERT = /* glsl */`
  varying vec3 vN; varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const RIM_FRAG = /* glsl */`
  uniform vec3 uColor; uniform float uFlash; uniform float uPulse;
  varying vec3 vN; varying vec3 vV;
  void main() {
    float f = 1.0 - max(dot(normalize(vN), normalize(vV)), 0.0);
    float rim = pow(f, 2.0);
    float diff = max(dot(normalize(vN), normalize(vec3(0.35, 0.6, 0.7))), 0.0);
    vec3 c = uColor * (0.18 + 0.6 * diff + 0.9 * rim + 0.12 * uPulse) + vec3(uFlash);
    gl_FragColor = vec4(c, 1.0);
  }
`;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _a = new THREE.Vector3();

class Enemy {
  constructor(kind, pos, speedMul) {
    this.kind = kind;
    this.def = ENEMY_TYPES[kind];
    this.hp = this.def.hp;
    this.pos = pos.clone();
    this.kb = new THREE.Vector3();
    this.speed = this.def.speed * speedMul;
    this.flash = 0; this.soak = 0; this.slow = 0; this.age = 0;
    this.phase = Math.random() * 6.28;
    this.sparkT = Math.random();
    this.dead = false;

    const c = this.def.color;
    this.uniforms = { uColor: { value: new THREE.Color(c[0], c[1], c[2]) }, uFlash: { value: 0 }, uPulse: { value: 0 } };
    const mat = new THREE.ShaderMaterial({ vertexShader: RIM_VERT, fragmentShader: RIM_FRAG, uniforms: this.uniforms });
    let geo;
    if (kind === 'frost') geo = new THREE.IcosahedronGeometry(this.def.r, 0);
    else if (kind === 'ember') geo = new THREE.IcosahedronGeometry(this.def.r, 2);
    else geo = new THREE.DodecahedronGeometry(this.def.r, 0);
    this.body = new THREE.Mesh(geo, mat);
    this.group = new THREE.Group();
    this.group.add(this.body);

    // health bar (billboarded each frame)
    this.bar = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.028), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthTest: false }));
    this.fill = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.016), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
    this.fill.position.z = 0.001;
    bg.renderOrder = 30; this.fill.renderOrder = 31;
    this.bar.add(bg, this.fill);
    this.bar.position.y = this.def.r + 0.12;
    this.group.add(this.bar);
    this.group.position.copy(this.pos);
  }
}

export class Game {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.enemies = [];
    this.state = 'menu';            // menu | playing | over
    this.wave = 0; this.score = 0; this.lives = 5; this.kills = 0; this.best = typeof localStorage !== 'undefined' ? Number(localStorage.getItem('rift-best') || 0) : 0;
    this.toSpawn = 0; this.spawnTimer = 0; this.nextWaveTimer = 0;
    this.yaw0 = 0;
    this.banner = ''; this.bannerT = 0;
    this.timers = {};
    this.onHit = null;              // (casterId?) => haptic
    this.onEvent = null;
  }

  start(headDir) {
    this.clearEnemies();
    this.world.clear();
    this.state = 'playing';
    this.wave = 0; this.score = 0; this.lives = 5; this.kills = 0;
    this.yaw0 = Math.atan2(-headDir.x, -headDir.z);   // direction the player was facing
    this.nextWave();
  }

  clearEnemies() {
    for (const e of this.enemies) this.root.remove(e.group);
    this.enemies.length = 0;
  }

  nextWave() {
    this.wave++;
    this.toSpawn = 3 + this.wave * 2;
    this.spawnTimer = 1.2;
    this.say(`WAVE ${this.wave}`, 2.4);
  }

  say(text, t = 2) { this.banner = text; this.bannerT = t; }

  spawn(head) {
    const w = this.wave;
    const pool = ['frost'];
    if (w >= 2) pool.push('ember', 'frost', 'ember');
    if (w >= 3) pool.push('husk');
    if (w >= 5) pool.push('husk');
    const kind = pool[Math.floor(Math.random() * pool.length)];
    const yaw = this.yaw0 + (Math.random() - 0.5) * (Math.PI * 1.1);
    const dist = 2.6 + Math.random() * 0.9;
    const pos = new THREE.Vector3(
      head.x - Math.sin(yaw) * dist,
      Math.max(0.5, head.y + (Math.random() - 0.5) * 1.1 - 0.15),
      head.z - Math.cos(yaw) * dist,
    );
    const e = new Enemy(kind, pos, 1 + 0.05 * w);
    this.enemies.push(e);
    this.root.add(e.group);
    const c = e.def.color;
    this.world.spark(pos.x, pos.y, pos.z, c[0], c[1], c[2], 14, 0.9);
  }

  // nearest creature inside a narrow cone around a ray (aim assist for redirect)
  aimAssist(origin, dir, cosMax = 0.966) {
    let best = null, bestCos = cosMax;
    for (const e of this.enemies) {
      _v.subVectors(e.pos, origin);
      const l = _v.length();
      if (l < 0.2) continue;
      const cos = _v.dot(dir) / l;
      if (cos > bestCos) { bestCos = cos; best = e; }
    }
    return best ? best.pos : null;
  }

  redirectTarget(c, out) {
    if (c.source === 'mouse') return out.copy(c.emitPos);
    const assist = this.aimAssist(c.aimOrigin, c.aimDir);
    if (assist) return out.copy(assist);
    return out.copy(c.aimOrigin).addScaledVector(c.aimDir, CFG.aimDistance);
  }

  // ---- per-caster spell driver (fire game: Q / Space / R / B + the new actions) ----------------
  castFor(c, dt) {
    const t = this.timers[c.id] || (this.timers[c.id] = { emit: 0, empower: 0, redirect: 0, cool: 0 });
    if (!c.tracked) { t.emit = t.empower = t.redirect = t.cool = 0; return; }
    const w = this.world;
    const tick = (name, on, interval, fn) => {
      if (!on) { t[name] = interval; return; }   // armed so the first tick fires immediately
      t[name] += dt;
      let guard = 0;
      while (t[name] >= interval && guard++ < 4) { t[name] -= interval; fn(); }
    };
    tick('emit', c.want('emit'), CFG.burstInterval, () => w.emit(c.element, c.emitPos.x, c.emitPos.y, c.emitPos.z, c.emitDir.x, c.emitDir.y, c.emitDir.z));
    tick('empower', c.want('empower'), CFG.actionInterval, () => w.empower(c.element, c.emitPos.x, c.emitPos.y, c.emitPos.z));
    tick('redirect', c.want('redirect'), CFG.actionInterval, () => { this.redirectTarget(c, _a); w.redirect(c.element, _a.x, _a.y, _a.z); });
    tick('cool', c.want('cool'), CFG.actionInterval, () => w.cool(c.element, c.emitPos.x, c.emitPos.y, c.emitPos.z));

    // continuous actions
    if (c.act.sweep && CFG.sweepGain > 0) {
      // an open palm reaches farther and pushes harder
      const wide = c.wide;
      w.push(c.element, c.palm.x, c.palm.y, c.palm.z, c.vel.x, c.vel.y, c.vel.z,
        wide ? CFG.palmRadius : CFG.sweepRadius, CFG.sweepGain * (wide ? CFG.palmGain : 1), dt);
    }
    if (c.want('compress')) w.compress(c.element, c.palm.x, c.palm.y, c.palm.z, CFG.reach, dt);
    if (c.want('push')) w.blast(c.element, c.palm.x, c.palm.y, c.palm.z, CFG.reach + 0.4, 14, dt);
    if (c.want('brake')) w.brake(c.element, c.palm.x, c.palm.y, c.palm.z, CFG.reach, dt);

    // taps
    if (c.pressed.dispel) w.dispel(c.element);
  }

  // "Pull in": any hand doing it drags the elements of BOTH hands toward the middle of your hands.
  pullIn(casters, dt) {
    let pulling = false;
    for (const id in casters) if (casters[id].tracked && casters[id].want('pull')) pulling = true;
    if (!pulling) return;
    const els = new Set();
    let n = 0, x = 0, y = 0, z = 0;
    for (const id in casters) {
      const c = casters[id];
      if (!c.tracked) continue;
      els.add(c.element);
      x += c.palm.x; y += c.palm.y; z += c.palm.z; n++;
    }
    if (n === 0) return;
    this.world.pull(els, x / n, y / n, z / n, CFG.pullStrength, dt);
  }

  update(dt, ctx) {
    const { head, casters, camQuat } = ctx;
    for (const id of Object.keys(casters)) this.castFor(casters[id], dt);
    this.pullIn(casters, dt);
    this.world.update(dt);

    if (this.bannerT > 0) this.bannerT -= dt;

    if (this.state === 'playing') {
      if (this.toSpawn > 0) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          this.spawn(head);
          this.toSpawn--;
          this.spawnTimer = Math.max(0.8, 2.6 - this.wave * 0.18);
        }
      } else if (this.enemies.length === 0) {
        this.nextWaveTimer += dt;
        if (this.nextWaveTimer > 2.5) { this.nextWaveTimer = 0; this.score += 50 * this.wave; this.nextWave(); }
      }
    }
    this.updateEnemies(dt, head, camQuat);
  }

  updateEnemies(dt, head, camQuat) {
    const list = this.world.list;
    const rate = CFG.changeRate;
    for (const e of this.enemies) {
      e.age += dt;
      e.flash = Math.max(0, e.flash - dt * 4);
      e.soak = Math.max(0, e.soak - dt);
      e.slow = Math.max(0, e.slow - dt);

      // ---- particle contact -------------------------------------------------
      let dmg = 0, heal = 0;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p.type === 'spark') continue;
        const dx = p.x - e.pos.x, dy = p.y - e.pos.y, dz = p.z - e.pos.z;
        const reach = e.def.r + p.size * 0.8;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > reach * reach) continue;
        if (p.type === 'fire') {
          if (e.kind === 'frost') dmg += (2 + 0.5 * p.power) * dt;
          else if (e.kind === 'ember') heal += 3 * dt;
          else {
            const hot = p.power >= 2 * rate;
            let d = hot ? 6 + 0.3 * p.power : 0.3;
            if (e.soak > 0) d *= 2.5;
            dmg += d * dt;
          }
          p.size *= 1 - 0.8 * dt;                 // flames are spent as they burn
        } else if (p.type === 'water') {
          if (e.kind === 'ember') {
            dmg += (p.isIce ? 9 : 3 + (1 - p.temperature / 100) * 5) * dt;
            if (!p.isIce) p.temperature = Math.min(100, p.temperature + 40 * dt);   // the imp boils the water
          } else if (e.kind === 'husk') e.soak = 4;
          else e.slow = Math.max(e.slow, 0.8);
          if (p.isIce) {
            e.slow = Math.max(e.slow, 1.2);
            _w.set(-dx, -dy, -dz).normalize();
            e.kb.addScaledVector(_w, 1.2 * dt);
          }
        } else if (p.type === 'air') {
          e.kb.x += p.vx * 0.9 * dt; e.kb.y += p.vy * 0.9 * dt; e.kb.z += p.vz * 0.9 * dt;
        }
        if (Math.random() < dt * 6 && p.type !== 'air') {
          const c = p.type === 'fire' ? [1, 0.6, 0.2] : [0.6, 0.85, 1];
          this.world.spark(p.x, p.y, p.z, c[0], c[1], c[2], 1, 0.5);
        }
      }
      if (dmg > 0) { e.hp -= dmg; e.flash = Math.min(0.6, e.flash + dmg * 0.03); }
      if (heal > 0) e.hp = Math.min(e.def.hp, e.hp + heal);

      // ---- movement ----------------------------------------------------------
      _v.subVectors(head, e.pos);
      const dist = _v.length();
      _v.divideScalar(Math.max(dist, 1e-4));
      const sp = e.speed * (e.slow > 0 ? 0.35 : 1);
      e.pos.addScaledVector(_v, sp * dt);
      e.pos.x += Math.sin(e.age * 1.7 + e.phase) * 0.08 * dt;
      e.pos.y += Math.cos(e.age * 1.3 + e.phase) * 0.08 * dt;
      e.pos.addScaledVector(e.kb, dt * 3);
      e.kb.multiplyScalar(Math.max(0, 1 - 3 * dt));
      if (e.pos.y < 0.3) e.pos.y = 0.3;

      // ---- trail sparks -------------------------------------------------------
      e.sparkT -= dt;
      if (e.sparkT <= 0) {
        e.sparkT = 0.12;
        const c = e.def.color;
        this.world.spark(e.pos.x, e.pos.y, e.pos.z, c[0], c[1], c[2], 1, 0.25);
      }

      // ---- reaches the player ---------------------------------------------------
      if (dist < 0.38 && this.state !== 'menu') {
        e.dead = true;
        if (this.state === 'playing') this.hurtPlayer(e);
      } else if (e.hp <= 0) {
        e.dead = true;
        this.kill(e);
      }

      // ---- visuals ---------------------------------------------------------------
      e.group.position.copy(e.pos);
      e.body.rotation.y += dt * (e.kind === 'ember' ? 0.8 : 0.4);
      e.body.rotation.x += dt * 0.3;
      const pulse = 0.5 + 0.5 * Math.sin(e.age * 5 + e.phase);
      e.uniforms.uPulse.value = pulse;
      e.uniforms.uFlash.value = e.flash;
      if (e.kind === 'husk') e.uniforms.uColor.value.setRGB(...(e.soak > 0 ? [0.35, 0.42, 0.55] : e.def.color));
      e.bar.quaternion.copy(camQuat);
      const f = Math.max(0, e.hp / e.def.hp);
      e.fill.scale.x = Math.max(0.001, f);
      e.fill.position.x = -0.11 * (1 - f);
      e.fill.material.color.setRGB(1 - f * 0.6, 0.35 + f * 0.6, 0.25);
    }
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].dead) { this.root.remove(this.enemies[i].group); this.enemies.splice(i, 1); }
    }
  }

  kill(e) {
    const c = e.def.color;
    this.world.spark(e.pos.x, e.pos.y, e.pos.z, c[0], c[1], c[2], 26, 1.4);
    this.score += e.def.score + 10 * this.wave;
    this.kills++;
    if (this.onEvent) this.onEvent('kill', e);
  }

  hurtPlayer(e) {
    this.world.spark(e.pos.x, e.pos.y, e.pos.z, 1, 0.2, 0.2, 24, 1.2);
    this.lives--;
    this.say(this.lives > 0 ? 'OUCH!' : '', 1);
    if (this.onEvent) this.onEvent('hurt', e);
    if (this.lives <= 0) {
      this.state = 'over';
      this.toSpawn = 0;
      if (this.score > this.best) { this.best = this.score; try { localStorage.setItem('rift-best', String(this.best)); } catch (err) { /* private mode */ } }
      this.say('', 0);
    }
  }
}
