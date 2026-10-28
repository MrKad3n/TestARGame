// Gesture Studio: the big popup for customising every action.
//  * left column : every action (cast, empower, compress, pull in, ... ) with its current gesture
//  * right column: pick any premade one-hand / two-hand gesture, a recorded custom one, or "always on" / none
//  * RECORD NEW GESTURE: hold a pose (one hand or both) and the game learns it; then assign it to the action
import { Panel, panelBackground, roundRect } from './ui.js';
import {
  settings, saveSettings, resetHand, copyBindings, addCustom, deleteCustom, custom,
  ACTIONS, ACTION_LABEL, ACTION_HELP, HAND_GESTURES, CTRL_GESTURES, SPECIAL, gestureLabel, gestureInfo,
} from './settings.js';
import { buildDef, matchScore } from './gestures.js';

const ROWS = 8;            // actions per page
const GRID_COLS = 2, GRID_ROWS = 6;
const COUNTDOWN = 3, CAPTURE = 1.6;

export class Studio {
  /** d = { input, getScheme(), place(mesh), onClose() } */
  constructor(ui, d) {
    this.d = d;
    this.handId = 'right';
    this.sel = 0;            // selected action index
    this.actPage = 0;
    this.cat = 'single';
    this.page = 0;
    this.rec = null;         // recorder state, null = normal picking
    this.isOpen = false;
    this.timer = 0;
    this.panel = ui.add(new Panel(1.3, 0.85, (ctx, p) => this.draw(ctx, p)));
  }

  kind() { return settings.bindKind || (this.d.getScheme() === 'hands' ? 'hand' : 'ctrl'); }
  get cfg() { return settings.hands[this.handId]; }
  get action() { return ACTIONS[this.sel]; }

  open(handId) {
    if (handId) this.handId = handId;
    this.isOpen = true;
    this.rec = null;
    this.d.place(this.panel.mesh);
    this.panel.mesh.scale.setScalar(0.8);
    this.build();
    this.panel.visible = true;
    this.panel.dirty = true;
  }
  close() {
    if (this.rec && this.rec.step === 'capture') this.d.input.endCapture();
    this.rec = null;
    this.isOpen = false;
    this.panel.visible = false;
    this.d.onClose();
  }

  // ---- helpers ---------------------------------------------------------------------
  categories() {
    return this.kind() === 'hand'
      ? [['single', 'ONE HAND'], ['pair', 'TWO HANDS'], ['custom', 'MY GESTURES'], ['special', 'ALWAYS / NONE']]
      : [['single', 'BUTTONS'], ['pair', 'BOTH CONTROLLERS'], ['special', 'ALWAYS / NONE']];
  }

  list() {
    const hand = this.kind() === 'hand';
    if (this.cat === 'special') return SPECIAL;
    if (this.cat === 'custom') return custom.map((c) => ({ id: 'custom:' + c.id, label: c.name, desc: c.mode === 'pair' ? 'Recorded two-hand gesture' : 'Recorded one-hand gesture' }));
    return (hand ? HAND_GESTURES : CTRL_GESTURES).filter((g) => g.cat === this.cat);
  }

  pages() { return Math.max(1, Math.ceil(this.list().length / (GRID_COLS * GRID_ROWS))); }

  assign(id) {
    this.cfg[this.kind()][this.action] = id;
    saveSettings(); this.panel.dirty = true;
  }

  // other actions that already use this gesture on this hand (shown as a hint)
  usedBy(id) {
    const b = this.cfg[this.kind()];
    return ACTIONS.filter((a) => a !== this.action && b[a] === id);
  }

  // ---- buttons ---------------------------------------------------------------------
  build() {
    const B = [];
    const kind = this.kind();
    const other = this.handId === 'left' ? 'right' : 'left';

    // header
    ['left', 'right'].forEach((h, i) => B.push({
      id: 'hand-' + h, x: 400 + i * 180, y: 14, w: 170, h: 54, label: h.toUpperCase() + ' HAND', font: 22, color: '#4fc3ff',
      active: () => this.handId === h, onClick: () => { this.handId = h; this.build(); this.panel.dirty = true; },
    }));
    B.push({
      id: 'kind', x: 780, y: 14, w: 300, h: 54, font: 20, color: '#4fc3ff',
      label: () => (this.kind() === 'hand' ? 'HAND GESTURES' : 'CONTROLLER BUTTONS'),
      onClick: () => { settings.bindKind = this.kind() === 'hand' ? 'ctrl' : 'hand'; this.cat = 'single'; this.page = 0; this.rec = null; this.build(); this.panel.dirty = true; saveSettings(); },
    });
    B.push({ id: 'close', x: 1190, y: 14, w: 90, h: 54, label: 'BACK', font: 22, color: '#ff6b8a', onClick: () => this.close() });

    // action list
    const first = this.actPage * ROWS;
    ACTIONS.slice(first, first + ROWS).forEach((a, i) => {
      const idx = first + i;
      B.push({
        id: 'act-' + a, x: 30, y: 92 + i * 52, w: 590, h: 46, label: '', font: 22, color: '#ffd24a',
        active: () => this.sel === idx,
        onClick: () => { this.sel = idx; this.rec = null; this.build(); this.panel.dirty = true; },
        after: (ctx, b, hover, active) => {
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left'; ctx.font = '21px system-ui, sans-serif'; ctx.fillStyle = active ? '#101018' : '#ffffff';
          ctx.fillText(ACTION_LABEL[a], b.x + 16, b.y + b.h / 2 + 2);
          ctx.textAlign = 'right'; ctx.font = 'bold 20px system-ui, sans-serif'; ctx.fillStyle = active ? '#3a1f00' : '#ffd24a';
          ctx.fillText(gestureLabel(this.cfg[this.kind()][a]), b.x + b.w - 16, b.y + b.h / 2 + 2);
        },
      });
    });
    const pagesA = Math.ceil(ACTIONS.length / ROWS);
    B.push({ id: 'act-prev', x: 30, y: 516, w: 120, h: 40, label: '< PREV', font: 18, color: '#4fc3ff', enabled: this.actPage > 0, onClick: () => { if (this.actPage > 0) { this.actPage--; this.build(); this.panel.dirty = true; } } });
    B.push({ id: 'act-next', x: 500, y: 516, w: 120, h: 40, label: 'NEXT >', font: 18, color: '#4fc3ff', enabled: this.actPage < pagesA - 1, onClick: () => { if (this.actPage < pagesA - 1) { this.actPage++; this.build(); this.panel.dirty = true; } } });

    if (this.rec) this.buildRecorder(B);
    else this.buildPicker(B);

    // bottom row
    if (kind === 'hand') {
      B.push({ id: 'record', x: 30, y: 768, w: 380, h: 58, label: 'RECORD NEW GESTURE', font: 24, color: '#ff6b8a', active: () => !!this.rec, onClick: () => this.startRecorder() });
    }
    const sel = this.cfg[kind][this.action];
    B.push({
      id: 'delete', x: 430, y: 768, w: 330, h: 58, label: 'DELETE THIS RECORDING', font: 20, color: '#ff6b8a',
      hidden: !String(sel).startsWith('custom:'), onClick: () => { deleteCustom(sel); this.build(); this.panel.dirty = true; },
    });
    B.push({ id: 'copy', x: 780, y: 768, w: 260, h: 58, label: `COPY TO ${other.toUpperCase()}`, font: 19, color: '#4fc3ff', onClick: () => { copyBindings(this.handId, other, kind); this.panel.dirty = true; } });
    B.push({ id: 'reset', x: 1060, y: 768, w: 220, h: 58, label: 'RESET HAND', font: 19, color: '#ff6b8a', onClick: () => { resetHand(this.handId); this.panel.dirty = true; } });
    this.panel.buttons = B;
  }

  buildPicker(B) {
    this.categories().forEach(([id, label], i, arr) => {
      const w = Math.floor((630 - (arr.length - 1) * 8) / arr.length);
      B.push({
        id: 'cat-' + id, x: 640 + i * (w + 8), y: 140, w, h: 46, label, font: arr.length > 3 ? 16 : 18, color: '#ffb02a',
        active: () => this.cat === id, onClick: () => { this.cat = id; this.page = 0; this.build(); this.panel.dirty = true; },
      });
    });
    const items = this.list();
    const per = GRID_COLS * GRID_ROWS;
    const bind = this.cfg[this.kind()];
    items.slice(this.page * per, this.page * per + per).forEach((g, i) => {
      const col = i % GRID_COLS, row = Math.floor(i / GRID_COLS);
      B.push({
        id: 'g-' + g.id, x: 640 + col * 320, y: 198 + row * 52, w: 310, h: 46, label: g.label, font: 20, color: '#ffffff',
        active: () => bind[this.action] === g.id,
        onClick: () => this.assign(g.id),
        after: (ctx, b) => {
          const used = this.usedBy(g.id);
          if (used.length && g.id !== 'none' && g.id !== 'always') {
            ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.font = '13px system-ui, sans-serif'; ctx.fillStyle = '#ff9fb0';
            ctx.fillText('also: ' + ACTION_LABEL[used[0]].split(' ')[0], b.x + b.w - 8, b.y + 9);
          }
        },
      });
    });
    const pages = this.pages();
    B.push({ id: 'pg-prev', x: 640, y: 516, w: 120, h: 40, label: '< PREV', font: 18, color: '#4fc3ff', enabled: this.page > 0, onClick: () => { if (this.page > 0) { this.page--; this.build(); this.panel.dirty = true; } } });
    B.push({ id: 'pg-next', x: 1150, y: 516, w: 120, h: 40, label: 'NEXT >', font: 18, color: '#4fc3ff', enabled: this.page < pages - 1, onClick: () => { if (this.page < pages - 1) { this.page++; this.build(); this.panel.dirty = true; } } });
  }

  // ---- recorder ----------------------------------------------------------------------------
  startRecorder() {
    if (this.kind() !== 'hand') return;
    this.rec = { step: 'setup', mode: 'single', hand: this.handId, t: 0, frames: null, def: null, msg: '', quality: '' };
    this.build(); this.panel.dirty = true;
  }

  buildRecorder(B) {
    const r = this.rec, input = this.d.input;
    const cancel = () => { if (r.step === 'capture') input.endCapture(); this.rec = null; this.build(); this.panel.dirty = true; };
    if (r.step === 'setup') {
      B.push({ id: 'rec-one', x: 640, y: 150, w: 310, h: 56, label: 'ONE HAND', font: 24, color: '#ffb02a', active: () => r.mode === 'single', onClick: () => { r.mode = 'single'; this.build(); this.panel.dirty = true; } });
      B.push({ id: 'rec-two', x: 960, y: 150, w: 310, h: 56, label: 'BOTH HANDS', font: 24, color: '#ffb02a', active: () => r.mode === 'pair', onClick: () => { r.mode = 'pair'; this.build(); this.panel.dirty = true; } });
      B.push({ id: 'rec-left', x: 640, y: 236, w: 310, h: 50, label: 'LEFT HAND DOES IT', font: 20, color: '#4fc3ff', hidden: r.mode !== 'single', active: () => r.hand === 'left', onClick: () => { r.hand = 'left'; this.build(); this.panel.dirty = true; } });
      B.push({ id: 'rec-right', x: 960, y: 236, w: 310, h: 50, label: 'RIGHT HAND DOES IT', font: 20, color: '#4fc3ff', hidden: r.mode !== 'single', active: () => r.hand === 'right', onClick: () => { r.hand = 'right'; this.build(); this.panel.dirty = true; } });
      B.push({ id: 'rec-start', x: 700, y: 440, w: 480, h: 90, label: 'START RECORDING', font: 34, color: '#ff6b8a', active: () => true, onClick: () => { r.step = 'count'; r.t = 0; this.build(); this.panel.dirty = true; } });
      B.push({ id: 'rec-cancel', x: 640, y: 516, w: 200, h: 40, label: 'CANCEL', font: 18, color: '#9aa3c8', onClick: cancel });
    } else if (r.step === 'count' || r.step === 'capture') {
      B.push({ id: 'rec-cancel', x: 640, y: 516, w: 200, h: 40, label: 'CANCEL', font: 18, color: '#9aa3c8', onClick: cancel });
    } else if (r.step === 'review') {
      B.push({ id: 'rec-save-use', x: 640, y: 330, w: 630, h: 74, label: () => `SAVE & USE FOR: ${ACTION_LABEL[this.action].toUpperCase()}`, font: 24, color: '#7ff0c0', active: () => true, onClick: () => this.saveRecording(true) });
      B.push({ id: 'rec-save', x: 640, y: 420, w: 310, h: 56, label: 'SAVE ONLY', font: 22, color: '#7ff0c0', onClick: () => this.saveRecording(false) });
      B.push({ id: 'rec-retry', x: 960, y: 420, w: 310, h: 56, label: 'TRY AGAIN', font: 22, color: '#ffb02a', onClick: () => { r.step = 'setup'; this.build(); this.panel.dirty = true; } });
      B.push({ id: 'rec-discard', x: 640, y: 516, w: 200, h: 40, label: 'DISCARD', font: 18, color: '#ff6b8a', onClick: cancel });
    } else if (r.step === 'fail') {
      B.push({ id: 'rec-retry', x: 700, y: 400, w: 480, h: 70, label: 'TRY AGAIN', font: 28, color: '#ffb02a', active: () => true, onClick: () => { r.step = 'setup'; this.build(); this.panel.dirty = true; } });
      B.push({ id: 'rec-cancel', x: 640, y: 516, w: 200, h: 40, label: 'CANCEL', font: 18, color: '#9aa3c8', onClick: cancel });
    }
  }

  saveRecording(assign) {
    const r = this.rec;
    if (!r || !r.def) return;
    const id = addCustom(null, r.mode, r.def.mean, r.def.tol);
    if (assign) this.cfg.hand[this.action] = id;
    this.cat = 'custom'; this.page = 0;
    this.rec = null;
    this.build(); this.panel.dirty = true;
  }

  tick(dt) {
    const r = this.rec;
    const input = this.d.input;
    if (r) {
      if (r.step === 'count') {
        r.t += dt;
        if (r.t >= COUNTDOWN) { r.step = 'capture'; r.t = 0; input.beginCapture(r.mode, r.hand); this.build(); }
        this.panel.dirty = true;
      } else if (r.step === 'capture') {
        r.t += dt;
        if (r.t >= CAPTURE) {
          const frames = input.endCapture();
          const need = 0.4 * CAPTURE * 60;      // at least ~40% of the frames must have both hands tracked
          if (frames.length < need) {
            r.step = 'fail';
            r.msg = r.mode === 'pair' ? 'I could not see both hands the whole time.' : `I could not see your ${r.hand} hand clearly.`;
          } else {
            r.frames = frames;
            r.def = buildDef(frames, r.mode === 'pair');
            let s = 0; for (const f of frames) s += matchScore(r.def, f);
            s /= frames.length;
            r.quality = s < 0.5 ? 'GOOD - nice and steady' : s < 0.7 ? 'OK - a bit shaky' : 'LOOSE - try holding it more still';
            r.step = 'review';
          }
          this.build();
        }
        this.panel.dirty = true;
      }
    }
    this.timer -= dt;
    if (this.timer <= 0) { this.timer = 0.15; if (this.isOpen) this.panel.dirty = true; }
  }

  // ---- drawing ------------------------------------------------------------------------------
  draw(ctx, p) {
    const W = p.canvas.width, H = p.canvas.height;
    panelBackground(ctx, W, H, '#ff6b8a');
    const text = (s, x, y, font, color, align = 'left') => { ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y); };
    text('GESTURE STUDIO', 30, 42, 'bold 32px system-ui, sans-serif', '#ffb02a');
    const kind = this.kind();
    const cfg = this.cfg;

    // left column header + help
    text('1. Pick an action', 30, 84 - 2, '16px system-ui, sans-serif', '#9aa3c8');
    const a = this.action;
    this.wrap(ctx, ACTION_HELP[a], 30, 592, 620, 24, '19px system-ui, sans-serif', '#c9d4ff');
    text(`Page ${this.actPage + 1} / ${Math.ceil(ACTIONS.length / ROWS)}`, 325, 536, '16px system-ui, sans-serif', '#7f8bb8', 'center');

    // right column
    if (this.rec) this.drawRecorder(ctx, text);
    else {
      text(`2. Choose the gesture for  "${ACTION_LABEL[a]}"  (${this.handId} hand)`, 640, 108, 'bold 21px system-ui, sans-serif', '#ffffff');
      text(`Page ${this.page + 1} / ${this.pages()}`, 955, 536, '16px system-ui, sans-serif', '#7f8bb8', 'center');
      if (this.cat === 'custom' && custom.length === 0) text('Nothing recorded yet. Press RECORD NEW GESTURE.', 955, 300, '22px system-ui, sans-serif', '#9aa3c8', 'center');
      const cur = gestureInfo(cfg[kind][a]);
      text(`Now: ${cur.label}`, 640, 586, 'bold 20px system-ui, sans-serif', '#ffd24a');
      this.wrap(ctx, cur.desc || '', 640, 616, 1270, 24, '18px system-ui, sans-serif', '#c9d4ff');
    }

    // live detection strip
    roundRect(ctx, 24, 650, W - 48, 100, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill();
    text('LIVE: what the game sees right now (test your gestures here)', 40, 668, '16px system-ui, sans-serif', '#9aa3c8');
    const L = this.d.input.casters.left, R = this.d.input.casters.right;
    const names = (set) => [...set].filter((i) => i !== 'always').map(gestureLabel).join(', ') || '-';
    text(`Left: ${L.tracked ? names(L.active) : 'not tracked'}`, 40, 696, '20px system-ui, sans-serif', '#4fc3ff');
    text(`Right: ${R.tracked ? names(R.active) : 'not tracked'}`, 40, 724, '20px system-ui, sans-serif', '#ff9a6a');
    text(`Both: ${names(this.d.input.pair)}`, 700, 696, '20px system-ui, sans-serif', '#7ff0c0');
    if (kind === 'ctrl') text('Recording gestures needs hand tracking.', 700, 724, '16px system-ui, sans-serif', '#7f8bb8');
  }

  drawRecorder(ctx, text) {
    const r = this.rec;
    text('Record a new gesture', 640, 108, 'bold 24px system-ui, sans-serif', '#ff6b8a');
    if (r.step === 'setup') {
      const lines = [
        '1. Choose one hand or both hands.',
        '2. Press START, get your hands in the pose during the 3-second countdown.',
        '3. Hold the pose steady for about 1.5 seconds while it records.',
        '4. Save it, assign it to the action, and test it in the LIVE box.',
      ];
      lines.forEach((l, i) => text(l, 640, 330 + i * 26, '19px system-ui, sans-serif', '#c9d4ff'));
    } else if (r.step === 'count') {
      text(String(Math.max(1, Math.ceil(3 - r.t))), 955, 300, 'bold 170px system-ui, sans-serif', '#ffd24a', 'center');
      text(r.mode === 'pair' ? 'Get BOTH hands into the pose...' : `Get your ${r.hand.toUpperCase()} hand into the pose...`, 955, 440, '24px system-ui, sans-serif', '#ffffff', 'center');
    } else if (r.step === 'capture') {
      text('HOLD IT!', 955, 250, 'bold 80px system-ui, sans-serif', '#ff6b8a', 'center');
      roundRect(ctx, 700, 340, 510, 36, 12); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fill();
      roundRect(ctx, 700, 340, Math.max(8, 510 * Math.min(1, r.t / CAPTURE)), 36, 12); ctx.fillStyle = '#ff6b8a'; ctx.fill();
      text(`${this.d.input.captureCount()} frames`, 955, 410, '20px system-ui, sans-serif', '#c9d4ff', 'center');
    } else if (r.step === 'review') {
      text(`Captured ${r.frames.length} frames of a ${r.mode === 'pair' ? 'two-hand' : 'one-hand'} gesture.`, 640, 170, '22px system-ui, sans-serif', '#ffffff');
      text(`Consistency: ${r.quality}`, 640, 210, 'bold 22px system-ui, sans-serif', '#7ff0c0');
      text('It will be called "Custom N". You can test it in the LIVE box after saving.', 640, 260, '18px system-ui, sans-serif', '#c9d4ff');
    } else if (r.step === 'fail') {
      text(r.msg, 955, 280, 'bold 24px system-ui, sans-serif', '#ff9fb0', 'center');
      text('Keep your hand(s) in view of the headset and try again.', 955, 330, '20px system-ui, sans-serif', '#c9d4ff', 'center');
    }
  }

  // simple word wrap
  wrap(ctx, str, x, y, right, lineH, font, color) {
    const width = right - x;
    ctx.font = font; ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const words = String(str).split(' ');
    let line = '', yy = y + 0;
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > width && line) { ctx.fillText(line, x, yy); line = w; yy += lineH; } else line = t;
    }
    if (line) ctx.fillText(line, x, yy);
  }
}
