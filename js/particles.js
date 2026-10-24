// 3D port of the fire game's particle behaviour.
// Fire  : FireParticle  (overlap count = power, colour ramps red > yellow > blue > white,
//                        shrinks 2%/step, redirect with a decaying speed multiplier, empower grows it)
// Water : WaterParticle (gravity, temperature, freezes < 15 into rigid ice, melts at 20,
//                        cold spreads between neighbours, evaporates when hot)
// Air   : new element (the fire game had an Air button with no behaviour) - a gust that shoves,
//         fans flames and cools water.
import { S, STEP } from './config.js';

const rnd = Math.random;
const COMPRESS_DRAG = 0.004;     // fire game used 0.01 per overlap per frame; softer in 3D where clumps are looser
const FIRE_START = 25 * S;
const FIRE_MAX = 0.08;
const EMPOWER_GROW = 2 * S;      // "size += 2" in the fire game

export const ELEMENTS = ['fire', 'water', 'air'];

class Particle {
  constructor(type, x, y, z) {
    this.type = type;
    this.x = x; this.y = y; this.z = z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.size = 0.03;
    this.r = 1; this.g = 1; this.b = 1; this.a = 1;
    this.dead = false;
  }
}

function randomDir(out) {
  let x, y, z, l;
  do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; l = x * x + y * y + z * z; } while (l > 1 || l < 1e-4);
  l = Math.sqrt(l);
  out[0] = x / l; out[1] = y / l; out[2] = z / l;
}
const _d = [0, 0, 0];

export class Fire extends Particle {
  constructor(x, y, z) {
    super('fire', x, y, z);
    this.size = FIRE_START;
    this.sx = 0; this.sy = 0; this.sz = 0;  // per-step redirect velocity (fire game: speedX/speedY)
    this.mult = 0;                          // fire game: speedMultipler
    this.power = 0;
    this.colorize(10);
  }

  update(w) {
    this.findPower(w);
    this.colorize(w.cfg.changeRate);
    this.x += this.sx * this.mult;
    this.y += this.sy * this.mult;
    this.z += this.sz * this.mult;
    this.size -= this.size * 0.02;
    this.mult *= 0.985;
    if (this.size <= 0.2 * S) this.dead = true;
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
        this.mult = Math.max(0, this.mult - COMPRESS_DRAG);
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

  // Fire game redirectFlame(): speed = distance / (duration/16) per frame, multiplier reset to 1.05
  redirect(tx, ty, tz) {
    this.sx = (tx - this.x) / 62.5;
    this.sy = (ty - this.y) / 62.5;
    this.sz = (tz - this.z) / 62.5;
    this.mult = 1.05;
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
      this.temperature += 0.005;
      this.transferTemperature(w);
    } else {
      this.vy -= c.gravity * STEP;
      this.x += this.vx * STEP; this.y += this.vy * STEP; this.z += this.vz * STEP;
      this.vx *= 0.98; this.vz *= 0.98; this.vy *= 0.999;

      if (this.y - this.size <= c.floorY) {
        this.y = c.floorY + this.size;
        this.vy = Math.abs(this.vy) * 0.3;
        if (this.vy < 0.05) this.vy = 0;
        this.vx *= 0.92; this.vz *= 0.92;
      }

      this.temperature += 0.02;
      if (this.temperature > 70) this.size -= 0.15 * S * ((this.temperature - 70) / 30);
      else this.size -= 0.005 * S;

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
    this.maxLife = 0.9 + rnd() * 0.7;
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
  update() {
    this.life += STEP;
    const k = this.life / this.maxLife;
    if (k >= 1) { this.dead = true; return; }
    this.x += this.vx * STEP; this.y += this.vy * STEP; this.z += this.vz * STEP;
    this.vy -= 0.8 * STEP;
    this.a = 1 - k;
  }
}

export class ParticleWorld {
  constructor(cfg) {
    this.cfg = cfg;
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
      } else p.redirect(tx, ty, tz);
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
    for (let i = 0; i < list.length; i++) list[i].update(this);
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
