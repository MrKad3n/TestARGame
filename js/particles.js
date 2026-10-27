// 3D port of the fire game's particle behaviour.
// Fire  : FireParticle  (overlap count = power, colour ramps red > yellow > blue > white,
//                        shrinks 2%/step, redirect with a decaying speed multiplier, empower grows it)
// Water : WaterParticle (gravity, temperature, freezes < 15 into rigid ice, melts at 20,
//                        cold spreads between neighbours, evaporates when hot)
// Air   : new element (the fire game had an Air button with no behaviour) - a gust that shoves,
//         fans flames and cools water.
import { S, STEP } from './config.js';

const rnd = Math.random;
const MAX_SPEED = 3.5;           // m/s cap for pushed elements
const FIRE_START = 25 * S;
const FIRE_MAX = 0.08;
const EMPOWER_GROW = 2 * S;      // "size += 2" in the fire game

const lifeScaleRef = { v: 1 };
export const ELEMENTS = ['fire', 'water', 'air'];

class Particle {
  constructor(type, x, y, z) {
    this.type = type;
    this.x = x; this.y = y; this.z = z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.size = 0.03;
    this.r = 1; this.g = 1; this.b = 1; this.a = 1;
    this.px = NaN; this.py = 0; this.pz = 0;
    this.dead = false;
  }
  // add velocity (m/s), capped
  kick(dx, dy, dz) {
    this.vx += dx; this.vy += dy; this.vz += dz;
    const s2 = this.vx * this.vx + this.vy * this.vy + this.vz * this.vz;
    if (s2 > MAX_SPEED * MAX_SPEED) { const k = MAX_SPEED / Math.sqrt(s2); this.vx *= k; this.vy *= k; this.vz *= k; }
  }
}

function randomDir(out) {
  let x, y, z, l;
  do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; l = x * x + y * y + z * z; } while (l > 1 || l < 1e-4);
  l = Math.sqrt(l);
  out[0] = x / l; out[1] = y / l; out[2] = z / l;
}
const _d = [0, 0, 0];
const H = { nx: 0, ny: 1, nz: 0, depth: 0 };

// Push a particle out of real-world surfaces. Returns true if it touched something and
// leaves the contact normal in H (pointing toward the particle).
function collideEnv(p, w) {
  const env = w.env;
  if (!env || !env.active) return false;
  let hit = false;
  for (let k = 0; k < 3; k++) {
    if (!env.query(p.x, p.y, p.z, p.size, H, p.px, p.py, p.pz)) break;
    p.x += H.nx * H.depth; p.y += H.ny * H.depth; p.z += H.nz * H.depth;
    hit = true;
  }
  return hit;
}

export class Fire extends Particle {
  constructor(x, y, z) {
    super('fire', x, y, z);
    this.size = FIRE_START;
    this.power = 0;
    this.colorize(10);
  }

  update(w) {
    this.findPower(w);
    this.colorize(w.cfg.changeRate);
    // real velocity (m/s): it survives compression, and is only changed by redirect, hand pushes, drag and walls
    this.x += this.vx * STEP; this.y += this.vy * STEP; this.z += this.vz * STEP;
    const drag = w.cfg.fireDrag;
    this.vx *= drag; this.vy *= drag; this.vz *= drag;
    // fire game: -2% per frame. lifeScale stretches that (2 = lasts twice as long)
    this.size *= w.fireDecay;
    if (this.size <= 0.2 * S) this.dead = true;
    if (collideEnv(this, w)) this.bounce(w);
  }

  // flames shoved against a wall lose their inward speed and kick back off it
  bounce(w) {
    const vn = this.vx * H.nx + this.vy * H.ny + this.vz * H.nz;
    if (vn < 0) {
      const k = 1.35 * vn;
      this.vx -= k * H.nx; this.vy -= k * H.ny; this.vz -= k * H.nz;
      if (-vn > 0.25 && Math.random() < 0.25) w.spark(this.x, this.y, this.z, 1, 0.6, 0.2, 1, 0.4);
    }
  }

  // power = how many fire particles overlap this one. More compressed = hotter.
  findPower(w) {
    const nb = w.neighbors(this);
    let power = 0;
    for (let i = 0; i < nb.length; i++) {
      const q = nb[i];
      if (q === this) continue;
      const dx = this.x - q.x, dy = this.y - q.y, dz = this.z - q.z;
      const reach = this.size + q.size;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= reach * reach) continue;
      const dist = Math.sqrt(d2);

      if (q.type === 'fire') {
        power++;
        let nx, ny, nz;
        if (dist < 1e-6) { randomDir(_d); nx = _d[0]; ny = _d[1]; nz = _d[2]; }
        else { nx = dx / dist; ny = dy / dist; nz = dz / dist; }
        const push = (reach - dist) / w.cfg.compression;
        this.x += nx * push; this.y += ny * push; this.z += nz * push;
        q.x -= nx * push; q.y -= ny * push; q.z -= nz * push;
      } else if (q.type === 'water') {
        // fire heats water (and melts ice) but is dampened by it
        q.temperature = Math.min(q.temperatureMax, q.temperature + (q.isIce ? 1.4 : 0.7));
        this.size *= 0.985;
      }
    }
    this.power = power;
  }

  // Fire game changeColor(): red (0..rate), yellow (..2rate), blue (..3rate), white.
  colorize(rate) {
    const p = this.power;
    let r = 255, g = 0, b = 0;
    if (p < rate) {
      g = (p / rate) * 255;
    } else if (p < 2 * rate) {
      const t = (p - rate) / rate;
      r = 255 * (1 - t); g = 255 * (1 - t); b = 255 * t;
    } else if (p < 3 * rate) {
      const t = (p - 2 * rate) / rate;
      r = 255 * t; g = 255 * t; b = 255;
    } else { r = g = b = 255; }
    this.r = r / 255; this.g = g / 255; this.b = b / 255;
    this.a = Math.min(1, this.size / (FIRE_START * 0.55)) * 0.85;
  }

  empower() {
    this.size = Math.min(FIRE_MAX, this.size + EMPOWER_GROW);
  }

  // Fire game redirectFlame(): fly toward the target, travelling ~1.12x the distance before drag stops it.
  // (the fire game set a per-frame speed of d/62.5 and decayed it 0.985/frame; same total travel here)
  redirect(tx, ty, tz, drag = 0.988) {
    const k = 1.12 * (1 - drag) * 60;
    this.vx = (tx - this.x) * k;
    this.vy = (ty - this.y) * k;
    this.vz = (tz - this.z) * k;
  }
}

export class Water extends Particle {
  constructor(x, y, z, fx = 0, fy = 0, fz = 0) {
    super('water', x, y, z);
    // fire game: velocityX = (rand-.5)*4 px/frame, velocityY = rand*-2 px/frame (up)
    const k = S * 60;
    this.vx = (rnd() - 0.5) * 4 * k + fx;
    this.vy = rnd() * 2 * k + fy;
    this.vz = (rnd() - 0.5) * 4 * k + fz;
    this.size = (10 + rnd() * 10) * S;
    this.temperature = 20;
    this.temperatureMax = 100;
    this.isIce = false;
    this.fx = 0; this.fy = 0; this.fz = 0;
    this.colorize();
  }

  update(w) {
    const c = w.cfg;
    if (!this.isIce && this.temperature < 15) {
      this.isIce = true;
      this.fx = this.x; this.fy = this.y; this.fz = this.z;
      this.vx = this.vy = this.vz = 0;
    }
    if (this.isIce && this.temperature >= 20) {
      this.isIce = false;
      this.vy = -S * 60;
    }

    if (this.isIce) {
      this.x = this.fx; this.y = this.fy; this.z = this.fz;
      this.temperature += 0.005 / c.lifeScale;
      this.transferTemperature(w);
    } else {
      this.vy -= c.gravity * STEP;
      this.x += this.vx * STEP; this.y += this.vy * STEP; this.z += this.vz * STEP;
      this.vx *= 0.995; this.vz *= 0.995; this.vy *= 0.999;   // fire game used 0.98: water now keeps its momentum

      if (this.y - this.size <= c.floorY) {
        this.y = c.floorY + this.size;
        this.vy = Math.abs(this.vy) * 0.3;
        if (this.vy < 0.05) this.vy = 0;
        this.vx *= 0.92; this.vz *= 0.92;
      }

      this.temperature += 0.02 / c.lifeScale;
      if (this.temperature > 70) this.size -= 0.15 * S * ((this.temperature - 70) / 30) / c.lifeScale;
      else this.size -= 0.005 * S / c.lifeScale;

      if (collideEnv(this, w)) {
        const vn = this.vx * H.nx + this.vy * H.ny + this.vz * H.nz;
        if (vn < 0) {
          const k = Math.abs(vn) < 0.08 ? 1 : 1.3;      // resting contact: just stop, don't jitter
          this.vx -= k * vn * H.nx; this.vy -= k * vn * H.ny; this.vz -= k * vn * H.nz;
        }
        this.vx *= 0.96; this.vz *= 0.96;
      }

      this.findColdParticles(w);
    }

    this.colorize();
    if (this.size < 0) this.size = 0;
    if (this.temperature >= this.temperatureMax) this.size = 0;
    if (this.size <= 0.2 * S) this.dead = true;
    // water that wandered far away is gone
    if (this.y < c.floorY - 1 || Math.abs(this.x) > 12 || Math.abs(this.z) > 12) this.dead = true;
  }

  colorize() {
    let r, g, b, a;
    if (this.temperature < 20) {
      const t = Math.max(0, this.temperature / 20);
      r = 150 + t * 30; g = 200 + t * 20; b = 255; a = 0.92;
    } else {
      const t = Math.min(1, this.temperature / this.temperatureMax);
      r = t * 100; g = 80 + t * 130; b = 220 + t * 35; a = Math.max(0.05, 0.9 - t * 0.6);
    }
    this.r = r / 255; this.g = g / 255; this.b = b / 255; this.a = Math.min(1, a * 1.05);
  }

  heatUp(amount) { this.temperature = Math.min(this.temperatureMax, this.temperature + amount); }
  changeTemperature(amount) { this.temperature = Math.min(this.temperatureMax, Math.max(0, this.temperature + amount)); }

  transferTemperature(w) {
    const nb = w.neighbors(this);
    for (let i = 0; i < nb.length; i++) {
      const p = nb[i];
      if (p === this || p.type !== 'water') continue;
      const dx = this.x - p.x, dy = this.y - p.y, dz = this.z - p.z;
      const lim = (this.size + p.size) * 1.5;
      if (dx * dx + dy * dy + dz * dz < lim * lim) {
        const t = (this.temperature - p.temperature) * 0.02;
        this.temperature -= t;
        p.temperature += t;
      }
    }
  }

  findColdParticles(w) {
    const nb = w.neighbors(this);
    const compression = w.cfg.compression;
    for (let i = 0; i < nb.length; i++) {
      const p = nb[i];
      if (p === this || p.type !== 'water') continue;
      const dx = this.x - p.x, dy = this.y - p.y, dz = this.z - p.z;
      const minDist = this.size + p.size;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= minDist * minDist || d2 <= 0) continue;
      const dist = Math.sqrt(d2);

      const nx = dx / dist, ny = dy / dist, nz = dz / dist;
      const overlap = (minDist - dist) / compression * 3;
      if (p.isIce) {
        // ice is immovable: only this particle gets pushed
        this.x += nx * overlap * 2; this.y += ny * overlap * 2; this.z += nz * overlap * 2;
      } else {
        this.x += nx * overlap; this.y += ny * overlap; this.z += nz * overlap;
        p.x -= nx * overlap; p.y -= ny * overlap; p.z -= nz * overlap;
      }

      const t = (this.temperature - p.temperature) * 0.02;
      this.temperature -= t;
      p.temperature += t;

      if (this.temperature < 50 && !p.isIce) {
        const blend = 0.05;
        const ax = (this.vx + p.vx) / 2, ay = (this.vy + p.vy) / 2, az = (this.vz + p.vz) / 2;
        this.vx += (ax - this.vx) * blend; this.vy += (ay - this.vy) * blend; this.vz += (az - this.vz) * blend;
        p.vx += (ax - p.vx) * blend; p.vy += (ay - p.vy) * blend; p.vz += (az - p.vz) * blend;
      }
    }
  }

  // Fire game redirectParticle(): velocity = distance / (1000ms / 16ms) per frame
  redirect(tx, ty, tz) {
    if (this.isIce) return;
    const k = 60 / 62.5;
    this.vx = (tx - this.x) * k;
    this.vy = (ty - this.y) * k;
    this.vz = (tz - this.z) * k;
  }
}

export class Air extends Particle {
  constructor(x, y, z, vx, vy, vz) {
    super('air', x, y, z);
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.life = 0;
    this.maxLife = (0.9 + rnd() * 0.7) * lifeScaleRef.v;
    this.size = 0.02;
    this.r = 0.85; this.g = 0.97; this.b = 1; this.a = 0;
  }
  update(w) {
    this.life += STEP;
    const k = this.life / this.maxLife;
    if (k >= 1) { this.dead = true; return; }
    this.size = 0.02 + 0.05 * k;
    this.x += this.vx * STEP; this.y += this.vy * STEP; this.z += this.vz * STEP;
    this.vx *= 0.992; this.vy *= 0.992; this.vz *= 0.992;
    if (collideEnv(this, w)) {
      const vn = this.vx * H.nx + this.vy * H.ny + this.vz * H.nz;
      if (vn < 0) { this.vx -= 1.5 * vn * H.nx; this.vy -= 1.5 * vn * H.ny; this.vz -= 1.5 * vn * H.nz; }
    }
    this.a = 0.32 * (1 - k) * Math.min(1, k / 0.1);

    // gust: shove flames and droplets, fan flames, cool water
    const nb = w.neighbors(this);
    const f = 1 - k;
    for (let i = 0; i < nb.length; i++) {
      const q = nb[i];
      if (q === this || q.type === 'air') continue;
      const dx = this.x - q.x, dy = this.y - q.y, dz = this.z - q.z;
      if (dx * dx + dy * dy + dz * dz > (this.size + q.size + 0.04) ** 2) continue;
      if (q.type === 'fire') {
        q.x += this.vx * STEP * 0.6 * f; q.y += this.vy * STEP * 0.6 * f; q.z += this.vz * STEP * 0.6 * f;
        q.size = Math.min(FIRE_MAX, q.size + 0.0004);
      } else if (q.type === 'water' && !q.isIce) {
        q.vx += this.vx * 0.03 * f; q.vy += this.vy * 0.03 * f; q.vz += this.vz * 0.03 * f;
        q.temperature = Math.max(0, q.temperature - 0.15);
      }
    }
  }
}

// Short-lived visual sparks (enemy hits / deaths). No interactions.
export class Spark extends Particle {
  constructor(x, y, z, vx, vy, vz, r, g, b, life = 0.6) {
    super('spark', x, y, z);
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.r = r; this.g = g; this.b = b; this.a = 1;
    this.life = 0; this.maxLife = life * (0.7 + rnd() * 0.6);
    this.size = 0.012 + rnd() * 0.012;
  }
  update(w) {
    this.life += STEP;
    const k = this.life / this.maxLife;
    if (k >= 1) { this.dead = true; return; }
    this.x += this.vx * STEP; this.y += this.vy * STEP; this.z += this.vz * STEP;
    this.vy -= 0.8 * STEP;
    if (collideEnv(this, w)) {
      const vn = this.vx * H.nx + this.vy * H.ny + this.vz * H.nz;
      if (vn < 0) { this.vx -= 1.4 * vn * H.nx; this.vy -= 1.4 * vn * H.ny; this.vz -= 1.4 * vn * H.nz; }
    }
    this.a = 1 - k;
  }
}

export class ParticleWorld {
  constructor(cfg) {
    this.cfg = cfg;
    this.fireDecay = 0.98;
    this.env = null;                 // Environment (real-world surfaces), set by main.js
    this.list = [];
    this.acc = 0;
    this.cell = 0.16;
    this.grid = new Map();
    this.nb = [];
  }

  add(p) {
    this.list.push(p);
    const over = this.list.length - this.cfg.maxParticles;
    if (over > 0) this.list.splice(0, over);
    return p;
  }

  clear() { this.list.length = 0; this.grid.clear(); }

  // ---- spawning ----------------------------------------------------------
  // dir = unit vector the caster is aiming; fire stays put like in the fire game,
  // water is poured forward a little, air is blown hard.
  emit(element, x, y, z, dx, dy, dz) {
    const n = this.cfg.burst;
    for (let i = 0; i < n; i++) {
      const jx = (rnd() - 0.5) * 0.024, jy = (rnd() - 0.5) * 0.024, jz = (rnd() - 0.5) * 0.024;
      if (element === 'fire') {
        this.add(new Fire(x + jx, y + jy, z + jz));
      } else if (element === 'water') {
        this.add(new Water(x + jx, y + jy, z + jz, dx * 0.35, dy * 0.35, dz * 0.35));
      } else if (element === 'air') {
        const sp = 1.3 + rnd() * 0.6;
        this.add(new Air(x + jx, y + jy, z + jz,
          dx * sp + (rnd() - 0.5) * 0.4, dy * sp + (rnd() - 0.5) * 0.4, dz * sp + (rnd() - 0.5) * 0.4));
      }
    }
  }

  spark(x, y, z, r, g, b, count = 8, speed = 0.8) {
    for (let i = 0; i < count; i++) {
      randomDir(_d);
      const s = speed * (0.4 + rnd() * 0.8);
      this.add(new Spark(x, y, z, _d[0] * s, _d[1] * s, _d[2] * s, r, g, b));
    }
  }

  // ---- element-wide actions (fire game: Space / R / B) --------------------
  empower(element, cx, cy, cz) {
    const reach2 = this.cfg.reach * this.cfg.reach;
    for (const p of this.list) {
      if (p.type !== element) continue;
      const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
      if (dx * dx + dy * dy + dz * dz > reach2) continue;
      if (element === 'fire') p.empower();
      else if (element === 'water') p.heatUp(15);
    }
  }

  redirect(element, tx, ty, tz) {
    for (const p of this.list) {
      if (p.type !== element) continue;
      if (element === 'air') {
        const dx = tx - p.x, dy = ty - p.y, dz = tz - p.z;
        const l = Math.hypot(dx, dy, dz) || 1;
        const sp = Math.hypot(p.vx, p.vy, p.vz) || 1.2;
        p.vx = dx / l * sp; p.vy = dy / l * sp; p.vz = dz / l * sp;
      } else if (element === 'fire') p.redirect(tx, ty, tz, this.cfg.fireDrag);
      else p.redirect(tx, ty, tz);
    }
  }

  // Hand sweep: moving your hand (velocity hx,hy,hz in m/s) pushes elements of this type that are near it.
  // The push is an impulse, so sweeping the opposite way by the same amount cancels it out.
  push(element, cx, cy, cz, hx, hy, hz, radius, gain, dt) {
    if (gain <= 0 || Math.hypot(hx, hy, hz) < 0.05) return;
    const k = 4 * gain * dt, r2 = radius * radius;
    for (const p of this.list) {
      if (p.type !== element || p.isIce) continue;
      const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      const w = 1 - Math.sqrt(d2) / radius;
      p.kick(hx * k * w, hy * k * w, hz * k * w);
    }
  }

  cool(element, cx, cy, cz) {
    if (element !== 'water') return;
    const reach2 = this.cfg.reach * this.cfg.reach;
    for (const p of this.list) {
      if (p.type !== 'water') continue;
      const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
      if (dx * dx + dy * dy + dz * dz > reach2) continue;
      p.changeTemperature(-15);
    }
  }

  // ---- simulation ---------------------------------------------------------
  update(dt) {
    this.acc = Math.min(this.acc + dt, STEP * 2.5);   // never spiral: at worst the sim runs slightly slow-mo
    while (this.acc >= STEP) { this.step(); this.acc -= STEP; }
  }

  neighbors(p) {
    const out = this.nb; out.length = 0;
    const c = this.cell;
    const ix = Math.floor(p.x / c), iy = Math.floor(p.y / c), iz = Math.floor(p.z / c);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) {
      const arr = this.grid.get(key(ix + a, iy + b, iz + d));
      if (arr) for (let i = 0; i < arr.length; i++) out.push(arr[i]);
    }
    return out;
  }

  step() {
    lifeScaleRef.v = this.cfg.lifeScale;
    this.fireDecay = Math.pow(0.98, 1 / this.cfg.lifeScale);
    const g = this.grid; g.clear();
    const c = this.cell, list = this.list;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.type === 'spark') continue;
      const k = key(Math.floor(p.x / c), Math.floor(p.y / c), Math.floor(p.z / c));
      let arr = g.get(k);
      if (!arr) { arr = []; g.set(k, arr); }
      arr.push(p);
    }
    for (let i = 0; i < list.length; i++) { const q = list[i]; q.update(this); q.px = q.x; q.py = q.y; q.pz = q.z; }   // last collision-resolved position
    let j = 0;
    for (let i = 0; i < list.length; i++) if (!list[i].dead) list[j++] = list[i];
    list.length = j;
  }

  counts() {
    const out = { fire: 0, water: 0, ice: 0, air: 0 };
    for (const p of this.list) {
      if (p.type === 'water') { if (p.isIce) out.ice++; else out.water++; }
      else if (out[p.type] !== undefined) out[p.type]++;
    }
    return out;
  }
}

function key(x, y, z) { return ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512); }
