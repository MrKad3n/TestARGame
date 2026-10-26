// Real-world collision.
//
// Quest 3 : WebXR "mesh-detection" (the room scan from Space Setup) and "plane-detection"
//           (walls / tables / furniture). Both become triangles.
// Quest 2 : has no room scan, so we use the Guardian boundary ("bounded-floor") as walls.
//           (Everything also collides with the floor at y = 0.)
//
// Everything is flattened into one triangle soup + a spatial hash, and particles ask
// `query(x, y, z, radius, out)` whether a sphere is touching anything.
import * as THREE from 'three';

const CELL = 0.2;
const MARGIN = 0.1;      // triangles are registered a bit beyond their bounds (particle radius <= 0.08)
const GUARDIAN_HEIGHT = 2.6;

let cx = 0, cy = 0, cz = 0;   // scratch: closest point

// Ericson, Real-Time Collision Detection 5.1.5
function closestOnTri(px, py, pz, t, o) {
  const ax = t[o], ay = t[o + 1], az = t[o + 2];
  const bx = t[o + 3], by = t[o + 4], bz = t[o + 5];
  const qx = t[o + 6], qy = t[o + 7], qz = t[o + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = qx - ax, acy = qy - ay, acz = qz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { cx = ax; cy = ay; cz = az; return; }
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { cx = bx; cy = by; cz = bz; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    cx = ax + abx * v; cy = ay + aby * v; cz = az + abz * v; return;
  }
  const cpx = px - qx, cpy = py - qy, cpz = pz - qz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { cx = qx; cy = qy; cz = qz; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    cx = ax + acx * w; cy = ay + acy * w; cz = az + acz * w; return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    cx = bx + (qx - bx) * w; cy = by + (qy - by) * w; cz = bz + (qz - bz) * w; return;
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  cx = ax + abx * v + acx * w; cy = ay + aby * v + acy * w; cz = az + abz * v + acz * w;
}

const key = (x, y, z) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);

export class Environment {
  constructor(scene) {
    this.sources = new Map();   // id -> { pos: Float32Array(world xyz), idx: Uint32Array|null, kind }
    this.tris = new Float32Array(0);   // 12 floats per tri: a, b, c, normal
    this.triCount = 0;
    this.grid = new Map();
    this.active = false;
    this.dirty = false;
    this.lastBuild = 0;
    this.nMesh = 0; this.nPlane = 0; this.hasGuardian = false;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.wire = null;
    if (scene) scene.add(this.group);
    this.showWire = false;
    this.xrKeys = new Set();
  }

  // ---- sources ----------------------------------------------------------------
  setSource(id, pos, idx, kind = 'static') { this.sources.set(id, { pos, idx, kind }); this.dirty = true; }
  removeSource(id) { if (this.sources.delete(id)) this.dirty = true; }

  addBox(id, min, max) {
    const [x0, y0, z0] = min, [x1, y1, z1] = max;
    const p = new Float32Array([x0,y0,z0, x1,y0,z0, x1,y1,z0, x0,y1,z0, x0,y0,z1, x1,y0,z1, x1,y1,z1, x0,y1,z1]);
    const i = new Uint32Array([0,2,1,0,3,2, 4,5,6,4,6,7, 0,4,7,0,7,3, 1,2,6,1,6,5, 0,1,5,0,5,4, 3,7,6,3,6,2]);
    this.setSource(id, p, i, 'static');
  }

  clear() {
    this.sources.clear(); this.xrKeys.clear();
    this.nMesh = this.nPlane = 0; this.hasGuardian = false;
    this.dirty = true; this.rebuild();
  }

  // ---- per-XR-frame update --------------------------------------------------------
  updateFrame(frame, refSpace, bounds) {
    let changed = false;
    const meshes = frame.detectedMeshes;
    const planes = frame.detectedPlanes;
    const haveMeshes = !!meshes && meshes.size > 0;

    if (meshes) {
      const seen = new Set();
      for (const m of meshes) {
        const id = m; seen.add(id);
        const rec = this.sources.get(id);
        if (rec && rec.t === m.lastChangedTime) continue;
        const pose = frame.getPose(m.meshSpace, refSpace);
        if (!pose) continue;
        const pos = transformVerts(m.vertices, pose.transform.matrix);
        this.sources.set(id, { pos, idx: m.indices, kind: 'mesh', t: m.lastChangedTime });
        this.xrKeys.add(id); changed = true;
      }
      for (const id of [...this.xrKeys]) if (id.vertices && !seen.has(id)) { this.sources.delete(id); this.xrKeys.delete(id); changed = true; }
      this.nMesh = meshes.size;
    }

    if (planes) {
      const seen = new Set();
      for (const pl of planes) {
        seen.add(pl);
        if (haveMeshes) continue;                 // the mesh already covers it
        const rec = this.sources.get(pl);
        if (rec && rec.t === pl.lastChangedTime) continue;
        const pose = frame.getPose(pl.planeSpace, refSpace);
        if (!pose) continue;
        const poly = pl.polygon;
        if (!poly || poly.length < 3) continue;
        const raw = new Float32Array(poly.length * 3);
        poly.forEach((p, i) => { raw[i * 3] = p.x; raw[i * 3 + 1] = p.y; raw[i * 3 + 2] = p.z; });
        const idx = [];
        for (let i = 1; i < poly.length - 1; i++) idx.push(0, i, i + 1);
        this.sources.set(pl, { pos: transformVerts(raw, pose.transform.matrix), idx: new Uint32Array(idx), kind: 'plane', t: pl.lastChangedTime });
        this.xrKeys.add(pl); changed = true;
      }
      for (const id of [...this.xrKeys]) if (id.polygon && !seen.has(id)) { this.sources.delete(id); this.xrKeys.delete(id); changed = true; }
      this.nPlane = planes.size;
    }
    if (haveMeshes) for (const id of [...this.xrKeys]) if (id.polygon) { this.sources.delete(id); this.xrKeys.delete(id); changed = true; }

    // Guardian walls only when there's no room scan (e.g. Quest 2)
    const scanned = this.nMesh > 0 || this.nPlane > 0;
    if (!scanned && bounds && bounds.length >= 3 && !this.hasGuardian) {
      const g = guardianWalls(bounds);
      this.sources.set('guardian', { pos: g.pos, idx: g.idx, kind: 'guardian' });
      this.hasGuardian = true; changed = true;
    } else if (scanned && this.hasGuardian) {
      this.sources.delete('guardian'); this.hasGuardian = false; changed = true;
    }

    if (changed) this.dirty = true;
    const now = performance.now();
    if (this.dirty && now - this.lastBuild > 600) this.rebuild();
  }

  // ---- build ----------------------------------------------------------------------
  rebuild() {
    this.dirty = false; this.lastBuild = performance.now();
    let n = 0;
    for (const s of this.sources.values()) n += s.idx ? s.idx.length / 3 : s.pos.length / 9;
    const tris = new Float32Array(n * 12);
    let t = 0;
    for (const s of this.sources.values()) {
      const P = s.pos, I = s.idx;
      const count = I ? I.length / 3 : P.length / 9;
      for (let k = 0; k < count; k++) {
        const a = I ? I[k * 3] * 3 : k * 9, b = I ? I[k * 3 + 1] * 3 : k * 9 + 3, c = I ? I[k * 3 + 2] * 3 : k * 9 + 6;
        const o = t * 12;
        tris[o] = P[a]; tris[o + 1] = P[a + 1]; tris[o + 2] = P[a + 2];
        tris[o + 3] = P[b]; tris[o + 4] = P[b + 1]; tris[o + 5] = P[b + 2];
        tris[o + 6] = P[c]; tris[o + 7] = P[c + 1]; tris[o + 8] = P[c + 2];
        const e1x = tris[o + 3] - tris[o], e1y = tris[o + 4] - tris[o + 1], e1z = tris[o + 5] - tris[o + 2];
        const e2x = tris[o + 6] - tris[o], e2y = tris[o + 7] - tris[o + 1], e2z = tris[o + 8] - tris[o + 2];
        let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
        const l = Math.hypot(nx, ny, nz);
        if (l < 1e-10) continue;        // degenerate, skip (t not advanced)
        tris[o + 9] = nx / l; tris[o + 10] = ny / l; tris[o + 11] = nz / l;
        t++;
      }
    }
    this.tris = tris; this.triCount = t;
    const grid = new Map();
    for (let i = 0; i < t; i++) {
      const o = i * 12;
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let v = 0; v < 3; v++) {
        const x = tris[o + v * 3], y = tris[o + v * 3 + 1], z = tris[o + v * 3 + 2];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      const i0 = Math.floor((x0 - MARGIN) / CELL), i1 = Math.floor((x1 + MARGIN) / CELL);
      const j0 = Math.floor((y0 - MARGIN) / CELL), j1 = Math.floor((y1 + MARGIN) / CELL);
      const k0 = Math.floor((z0 - MARGIN) / CELL), k1 = Math.floor((z1 + MARGIN) / CELL);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) * (k1 - k0 + 1) > 3000) continue;
      for (let a = i0; a <= i1; a++) for (let b = j0; b <= j1; b++) for (let c = k0; c <= k1; c++) {
        const kk = key(a, b, c);
        let arr = grid.get(kk);
        if (!arr) { arr = []; grid.set(kk, arr); }
        arr.push(i);
      }
    }
    this.grid = grid;
    this.active = t > 0;
    this.buildWire();
  }

  buildWire() {
    if (this.wire) { this.group.remove(this.wire); this.wire.geometry.dispose(); this.wire = null; }
    if (!this.showWire || this.triCount === 0) return;
    const n = Math.min(this.triCount, 40000);
    const pos = new Float32Array(n * 18);
    const T = this.tris;
    for (let i = 0; i < n; i++) {
      const o = i * 12, p = i * 18;
      const seg = [0, 3, 3, 6, 6, 0];
      for (let s = 0; s < 6; s++) { pos[p + s * 3] = T[o + seg[s]]; pos[p + s * 3 + 1] = T[o + seg[s] + 1]; pos[p + s * 3 + 2] = T[o + seg[s] + 2]; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.wire = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x35e0a0, transparent: true, opacity: 0.25, depthWrite: false }));
    this.wire.frustumCulled = false;
    this.group.add(this.wire);
  }

  setWireVisible(v) { this.showWire = v; this.group.visible = v; this.buildWire(); }

  // ---- collision query ------------------------------------------------------------
  // Sphere (x,y,z,r) vs triangles. out = {nx,ny,nz,depth} (normal points toward the sphere).
  query(x, y, z, r, out, px = NaN, py = 0, pz = 0) {
    const havePrev = px === px;
    if (!this.active) return false;
    const arr = this.grid.get(key(Math.floor(x / CELL), Math.floor(y / CELL), Math.floor(z / CELL)));
    if (!arr) return false;
    const T = this.tris;
    let best = 0;
    // fast particles can jump a thin wall in one step: widen the search by the distance moved
    const mv = havePrev ? Math.min(0.12, Math.hypot(x - px, y - py, z - pz)) : 0;
    const rr = r + mv;
    for (let i = 0; i < arr.length; i++) {
      const o = arr[i] * 12;
      // cheap reject: farther from the triangle's plane than the search radius
      const pd = (x - T[o]) * T[o + 9] + (y - T[o + 1]) * T[o + 10] + (z - T[o + 2]) * T[o + 11];
      if (pd > rr || pd < -rr) continue;
      closestOnTri(x, y, z, T, o);
      const dx = x - cx, dy = y - cy, dz = z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2);
      let depth = r - d;
      let nx, ny, nz;
      if (d > 1e-5) { nx = dx / d; ny = dy / d; nz = dz / d; }
      else { nx = T[o + 9]; ny = T[o + 10]; nz = T[o + 11]; }
      let crossed = false;
      if (havePrev) {
        // Side the particle came from. If it ended up on the far side of this surface
        // (squeezed into / jumped a thin wall), push it back out the way it came.
        let fx = T[o + 9], fy = T[o + 10], fz = T[o + 11];
        const s = (px - T[o]) * fx + (py - T[o + 1]) * fy + (pz - T[o + 2]) * fz;
        if (s < 0) { fx = -fx; fy = -fy; fz = -fz; }
        if (dx * fx + dy * fy + dz * fz < 0) { nx = fx; ny = fy; nz = fz; depth = r + d; crossed = true; }
      }
      if (!crossed && d >= r) continue;
      if (depth <= best) continue;
      best = depth;
      out.nx = nx; out.ny = ny; out.nz = nz; out.depth = depth;
    }
    return best > 0;
  }

  label() {
    if (this.nMesh > 0) return `Room scan: ${this.triCount.toLocaleString()} tris`;
    if (this.nPlane > 0) return `Room planes: ${this.nPlane}`;
    if (this.hasGuardian) return 'Guardian walls + floor';
    if (this.sources.size) return 'Custom surfaces';
    return 'Floor only (no room scan)';
  }
}

function transformVerts(v, m) {
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i += 3) {
    const x = v[i], y = v[i + 1], z = v[i + 2];
    out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  return out;
}

function guardianWalls(points) {
  const n = points.length;
  const pos = new Float32Array(n * 4 * 3);
  const idx = [];
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    const o = i * 12;
    pos.set([a.x, 0, a.z, b.x, 0, b.z, b.x, GUARDIAN_HEIGHT, b.z, a.x, GUARDIAN_HEIGHT, a.z], o);
    const v = i * 4;
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
  }
  return { pos, idx: new Uint32Array(idx) };
}
