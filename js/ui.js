// In-world UI: canvas-textured panels you can poke with a fingertip (Quest 3 hands)
// or point at with a controller ray + trigger (Quest 2 / Touch controllers).
import * as THREE from 'three';

const PX_PER_M = 1000;
const _inv = new THREE.Matrix4();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();

export class Panel {
  constructor(wMeters, hMeters, draw) {
    this.w = wMeters; this.h = hMeters;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(wMeters * PX_PER_M);
    this.canvas.height = Math.round(hMeters * PX_PER_M);
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(wMeters, hMeters),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.mesh.renderOrder = 40;
    this.mesh.visible = false;
    this.buttons = [];        // { id, x, y, w, h (canvas px), label, color, toggle, onClick(pointer) }
    this.hover = new Set();
    this.drawFn = draw;
    this.dirty = true;
    this.state = {};          // per-pointer click tracking
  }

  get visible() { return this.mesh.visible; }
  set visible(v) { this.mesh.visible = v; }

  redraw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawFn(ctx, this);
    for (const b of this.buttons) if (!b.hidden) drawButton(ctx, b, this.hover.has(b.id));
    this.tex.needsUpdate = true;
    this.dirty = false;
  }

  buttonAt(lx, ly) {
    const px = (lx + this.w / 2) * PX_PER_M, py = (this.h / 2 - ly) * PX_PER_M;
    for (const b of this.buttons) {
      if (b.hidden) continue;
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return b;
    }
    return null;
  }

  // ray hit in local space -> {button, t}
  rayHit(origin, dir) {
    this.mesh.updateWorldMatrix(true, false);
    _inv.copy(this.mesh.matrixWorld).invert();
    _o.copy(origin).applyMatrix4(_inv);
    _d.copy(dir).transformDirection(_inv);
    if (_d.z >= -1e-4) return null;
    const t = -_o.z / _d.z;
    if (t <= 0 || t > 6) return null;
    const x = _o.x + _d.x * t, y = _o.y + _d.y * t;
    if (Math.abs(x) > this.w / 2 || Math.abs(y) > this.h / 2) return null;
    return { button: this.buttonAt(x, y), t };
  }

  // fingertip in local space -> {button, z}
  tipHit(pos) {
    this.mesh.updateWorldMatrix(true, false);
    _inv.copy(this.mesh.matrixWorld).invert();
    _o.copy(pos).applyMatrix4(_inv);
    if (Math.abs(_o.x) > this.w / 2 || Math.abs(_o.y) > this.h / 2) return { button: null, z: _o.z };
    return { button: this.buttonAt(_o.x, _o.y), z: _o.z };
  }
}

export class UIManager {
  constructor(scene) { this.scene = scene; this.panels = []; this.time = 0; }
  add(panel) { this.panels.push(panel); this.scene.add(panel.mesh); return panel; }

  update(dt, pointers) {
    for (const panel of this.panels) {
      if (!panel.visible) continue;
      const hoverNow = new Set();
      for (const p of pointers) {
        const key = p.id + p.kind;
        const st = panel.state[key] || (panel.state[key] = { down: false, z: null });
        if (p.kind === 'ray') {
          const hit = panel.rayHit(p.origin, p.dir);
          if (hit && hit.button && hit.button.enabled !== false) {
            hoverNow.add(hit.button.id);
            if (p.down && !st.down) this.click(panel, hit.button, p);
          }
          st.down = p.down;
        } else {
          const hit = panel.tipHit(p.pos);
          if (hit.button && hit.button.enabled !== false && hit.z > -0.05 && hit.z < 0.06) {
            hoverNow.add(hit.button.id);
            if (st.z !== null && st.z > 0.012 && hit.z <= 0.012) this.click(panel, hit.button, p);
          }
          st.z = hit.z;
        }
      }
      let changed = hoverNow.size !== panel.hover.size;
      if (!changed) for (const id of hoverNow) if (!panel.hover.has(id)) { changed = true; break; }
      if (changed) { panel.hover = hoverNow; panel.dirty = true; }
    }
  }

  click(panel, button, pointer) {
    if (button.onClick) button.onClick(pointer);
    panel.dirty = true;
    if (this.onClick) this.onClick(pointer);
  }

  redrawDirty() { for (const p of this.panels) if (p.visible && p.dirty) p.redraw(); }
}

// ---------------------------------------------------------------------------
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawButton(ctx, b, hover) {
  const active = typeof b.active === 'function' ? b.active() : false;
  roundRect(ctx, b.x, b.y, b.w, b.h, 14);
  ctx.fillStyle = active ? b.color : hover ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.10)';
  ctx.fill();
  ctx.lineWidth = hover ? 5 : 3;
  ctx.strokeStyle = hover || active ? '#ffffff' : b.color;
  ctx.stroke();
  ctx.fillStyle = active ? '#101018' : '#ffffff';
  ctx.font = `bold ${b.font || 30}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = typeof b.label === 'function' ? b.label() : b.label;
  if (label) ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 2);
  if (b.after) b.after(ctx, b, hover, active);   // custom content drawn on top of the button
}

export function panelBackground(ctx, w, h, accent = '#ff7a3a') {
  roundRect(ctx, 4, 4, w - 8, h - 8, 28);
  ctx.fillStyle = 'rgba(10,12,22,0.82)';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = accent;
  ctx.stroke();
}
