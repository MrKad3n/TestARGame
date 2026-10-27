// In-world menu, opened only by the small menu button on your wrist / controller.
//   PLAY        start / resume, summary of what each hand does
//   LEFT / RIGHT HAND   element, which gesture or button triggers each action, hold-toggles
//   WORLD       particle tuning, which hand wears the menu button, room-mesh overlay
import { Panel, panelBackground, roundRect } from './ui.js';
import { CFG } from './config.js';
import { ELEMENTS } from './particles.js';
import {
  settings, saveSettings, resetHand, resetAll,
  ACTIONS, ACTION_LABEL, HAND_INPUTS, CTRL_INPUTS, INPUT_LABEL, TUNABLES,
} from './settings.js';

const COLORS = { fire: '#ff5a2a', water: '#3fa9ff', air: '#d8f4ff' };
const TABS = [['play', 'PLAY'], ['left', 'LEFT HAND'], ['right', 'RIGHT HAND'], ['world', 'WORLD']];
const ROW = 50;           // hand-tab row pitch
const WROW = 44;          // world-tab row pitch
const fmt = (n) => String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export class Menu {
  /**
   * d = { game, input, env, getScheme(), onStart(), place(mesh) }
   */
  constructor(ui, d) {
    this.d = d;
    this.tab = 'play';
    this.isOpen = false;
    this.timer = 0;
    this.panel = ui.add(new Panel(1.0, 0.7, (ctx, p) => this.draw(ctx, p)));
    this.badge = ui.add(new Panel(0.24, 0.075, (ctx, p) => this.drawBadge(ctx, p)));
    this.badge.buttons = [{
      id: 'menu', x: 4, y: 4, w: 67, h: 67, label: '≡', font: 48, color: '#ffd24a',
      active: () => this.isOpen, onClick: () => this.toggle(),
    }];
    this.build();
  }

  kind() { return settings.bindKind || (this.d.getScheme() === 'hands' ? 'hand' : 'ctrl'); }

  // ---- open / close --------------------------------------------------------------
  open(tab) {
    if (tab) this.tab = tab;
    this.isOpen = true;
    this.build();
    this.d.place(this.panel.mesh);
    this.panel.visible = true;
    this.panel.dirty = true; this.badge.dirty = true;
  }
  close() {
    this.isOpen = false;
    this.panel.visible = false;
    this.badge.dirty = true;
  }
  toggle() { this.isOpen ? this.close() : this.open(); }

  tick(dt) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.25;
      this.badge.dirty = true;
      if (this.isOpen) this.panel.dirty = true;
    }
  }

  // ---- buttons ---------------------------------------------------------------------
  mark() { this.panel.dirty = true; saveSettings(); }

  build() {
    const B = [];
    const d = this.d;
    TABS.forEach(([id, label], i) => B.push({
      id: 'tab-' + id, x: 28 + i * 212, y: 16, w: 202, h: 58, label, font: 25, color: '#4fc3ff',
      active: () => this.tab === id, onClick: () => { this.tab = id; this.build(); this.panel.dirty = true; },
    }));
    B.push({ id: 'close', x: 890, y: 16, w: 82, h: 58, label: 'X', font: 30, color: '#ff6b8a', onClick: () => this.close() });

    if (this.tab === 'play') {
      B.push({
        id: 'start', x: 300, y: 590, w: 400, h: 90, font: 46, color: '#ffd24a', active: () => true,
        label: () => (d.game.state === 'playing' ? 'RESUME' : d.game.state === 'over' ? 'PLAY AGAIN' : 'START'),
        onClick: () => { if (d.game.state !== 'playing') d.onStart(); this.close(); },
      });
    } else if (this.tab === 'left' || this.tab === 'right') {
      this.buildHand(B, this.tab);
    } else {
      this.buildWorld(B);
    }
    this.panel.buttons = B;
  }

  buildHand(B, id) {
    const cfg = settings.hands[id];
    const caster = this.d.input.casters[id];
    ELEMENTS.forEach((el, i) => B.push({
      id: 'el-' + el, x: 250 + i * 165, y: 98, w: 155, h: 56, label: el.toUpperCase(), font: 24, color: COLORS[el],
      active: () => cfg.element === el, onClick: () => { cfg.element = el; this.mark(); },
    }));
    const kind = this.kind();
    const list = kind === 'hand' ? HAND_INPUTS : CTRL_INPUTS;
    ACTIONS.forEach((a, i) => {
      const y = 172 + i * ROW;
      const step = (dir) => () => {
        const cur = list.indexOf(cfg[kind][a]);
        cfg[kind][a] = list[(cur + dir + list.length) % list.length];
        this.mark();
      };
      B.push({ id: `${a}-prev`, x: 470, y, w: 56, h: 42, label: '<', font: 28, color: '#ffd24a', onClick: step(-1) });
      B.push({ id: `${a}-val`, x: 532, y, w: 262, h: 42, label: () => INPUT_LABEL[cfg[kind][a]], font: 24, color: '#ffffff', onClick: step(1) });
      B.push({ id: `${a}-next`, x: 800, y, w: 56, h: 42, label: '>', font: 28, color: '#ffd24a', onClick: step(1) });
    });
    // latch toggles: keep an action held without any gesture / button (great for Quest 2 or tired hands)
    [['emit', 'CAST'], ['empower', 'HEAT'], ['redirect', 'PULL'], ['cool', 'COOL']].forEach(([k, label], i) => B.push({
      id: 'latch-' + k, x: 250 + i * 165, y: 172 + ACTIONS.length * ROW + 2, w: 155, h: 42, label, font: 22, color: '#ffd24a',
      active: () => caster.latch[k], onClick: () => { caster.latch[k] = !caster.latch[k]; this.panel.dirty = true; },
    }));
    B.push({
      id: 'reset-hand', x: 28, y: 616, w: 270, h: 52, label: 'RESET THIS HAND', font: 22, color: '#ff6b8a',
      onClick: () => { resetHand(id); this.panel.dirty = true; },
    });
    B.push({
      id: 'kind', x: 318, y: 616, w: 400, h: 52, font: 22, color: '#4fc3ff',
      label: () => (this.kind() === 'hand' ? 'EDITING: HAND GESTURES' : 'EDITING: CONTROLLER BUTTONS'),
      onClick: () => { settings.bindKind = this.kind() === 'hand' ? 'ctrl' : 'hand'; this.build(); this.mark(); },
    });
  }

  buildWorld(B) {
    TUNABLES.forEach(([key, , min, max, step, dec], i) => {
      const y = 92 + i * WROW;
      const change = (dir) => () => {
        const v = Math.round((CFG[key] + dir * step) * 100) / 100;
        CFG[key] = Math.min(max, Math.max(min, v));
        this.mark();
      };
      B.push({ id: key + '-', x: 600, y, w: 60, h: 38, label: '-', font: 32, color: '#ffd24a', onClick: change(-1) });
      B.push({ id: key + '+', x: 800, y, w: 60, h: 38, label: '+', font: 32, color: '#ffd24a', onClick: change(1) });
    });
    const y1 = 92 + TUNABLES.length * WROW;
    B.push({
      id: 'menuhand', x: 600, y: y1, w: 260, h: 38, font: 24, color: '#ffffff',
      label: () => (settings.menuHand === 'left' ? 'LEFT HAND' : 'RIGHT HAND'),
      onClick: () => { settings.menuHand = settings.menuHand === 'left' ? 'right' : 'left'; this.mark(); },
    });
    B.push({
      id: 'mesh', x: 600, y: y1 + WROW, w: 260, h: 38, font: 24, color: '#7ff0c0',
      label: () => (settings.showMesh ? 'SHOWN' : 'HIDDEN'), active: () => settings.showMesh,
      onClick: () => { settings.showMesh = !settings.showMesh; this.d.env.setWireVisible(settings.showMesh); this.mark(); },
    });
    B.push({
      id: 'reset-all', x: 28, y: 642, w: 300, h: 44, label: 'RESET EVERYTHING', font: 20, color: '#ff6b8a',
      onClick: () => { resetAll(); this.d.env.setWireVisible(false); this.build(); this.panel.dirty = true; },
    });
  }

  // ---- drawing ------------------------------------------------------------------------
  draw(ctx, p) {
    const W = p.canvas.width, H = p.canvas.height;
    panelBackground(ctx, W, H, '#ffb02a');
    ctx.textBaseline = 'middle';
    const text = (s, x, y, font, color, align = 'left') => { ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(s, x, y); };
    if (this.tab === 'play') this.drawPlay(ctx, W, text);
    else if (this.tab === 'world') {
      TUNABLES.forEach(([key, label, , , , dec], i) => {
        const y = 92 + i * WROW + 19;
        text(label, 32, y, '24px system-ui, sans-serif', '#ffffff');
        text(Number(CFG[key]).toFixed(dec), 730, y, 'bold 26px system-ui, sans-serif', '#ffd24a', 'center');
      });
      const y1 = 92 + TUNABLES.length * WROW + 19;
      text('Menu button is on your', 32, y1, '24px system-ui, sans-serif', '#ffffff');
      text('Room surfaces overlay', 32, y1 + WROW, '24px system-ui, sans-serif', '#ffffff');
      text('Saved automatically on this headset.', 360, 664, '20px system-ui, sans-serif', '#7f8bb8');
    } else this.drawHand(ctx, W, text);
  }

  drawPlay(ctx, W, text) {
    const g = this.d.game;
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#ff5a2a'); grad.addColorStop(0.5, '#ffd24a'); grad.addColorStop(1, '#4fc3ff');
    text('ELEMENTAL RIFT', W / 2, 120, 'bold 60px system-ui, sans-serif', grad, 'center');
    if (g.state === 'over') {
      text('The rift consumed you', W / 2, 190, 'bold 38px system-ui, sans-serif', '#ffffff', 'center');
      text(`Score ${fmt(g.score)}  -  Wave ${g.wave}  -  Best ${fmt(g.best)}`, W / 2, 238, '30px system-ui, sans-serif', '#c9d4ff', 'center');
    } else if (g.state === 'playing') {
      text(`Wave ${g.wave}  -  Score ${fmt(g.score)}  -  Lives ${g.lives}`, W / 2, 190, '30px system-ui, sans-serif', '#c9d4ff', 'center');
    } else text('Hold the line against the rift. Customise both hands in the tabs above.', W / 2, 190, '24px system-ui, sans-serif', '#c9d4ff', 'center');

    const kind = this.kind();
    ['left', 'right'].forEach((id, c) => {
      const cfg = settings.hands[id], x = 40 + c * 480;
      text(`${id.toUpperCase()} HAND: ${cfg.element.toUpperCase()}`, x, 290, 'bold 28px system-ui, sans-serif', COLORS[cfg.element]);
      ['emit', 'empower', 'redirect', 'cool', 'cycle', 'sweep'].forEach((a, i) => {
        text(INPUT_LABEL[cfg[kind][a]], x, 330 + i * 34, 'bold 21px system-ui, sans-serif', '#ffd24a');
        text(ACTION_LABEL[a], x + 190, 330 + i * 34, '22px system-ui, sans-serif', '#ffffff');
      });
    });
    text(`Menu button: on your ${settings.menuHand} ${this.d.getScheme() === 'hands' ? 'hand (look at the back of it)' : 'controller'}`, W / 2, 553, '22px system-ui, sans-serif', '#9aa3c8', 'center');
  }

  drawHand(ctx, W, text) {
    const id = this.tab, cfg = settings.hands[id];
    text('Element', 32, 126, 'bold 26px system-ui, sans-serif', COLORS[cfg.element]);
    ACTIONS.forEach((a, i) => text(ACTION_LABEL[a], 32, 172 + i * ROW + 21, '24px system-ui, sans-serif', '#ffffff'));
    text('Hold on', 32, 172 + ACTIONS.length * ROW + 23, '24px system-ui, sans-serif', '#ffffff');
    text(`Tap < > or the box to change. Gestures: ${this.kind() === 'hand' ? 'pinch with thumb + finger, fist, open palm.' : 'trigger, grip, A/X, B/Y, stick click.'}`, W / 2, 594, '18px system-ui, sans-serif', '#7f8bb8', 'center');
  }

  drawBadge(ctx, p) {
    const W = p.canvas.width, H = p.canvas.height, g = this.d.game;
    roundRect(ctx, 2, 2, W - 4, H - 4, 18);
    ctx.fillStyle = 'rgba(10,12,22,0.7)'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#ffb02a'; ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillText(g.state === 'playing' ? `WAVE ${g.wave}` : g.state === 'over' ? 'GAME OVER' : 'PRACTICE', 82, 24);
    ctx.fillStyle = '#ff6b8a'; ctx.font = '20px system-ui, sans-serif';
    ctx.fillText(`♥ ${Math.max(0, g.lives)}`, 82, 52);
    ctx.fillStyle = '#ffd24a'; ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.fillText(fmt(g.score), 140, 52);
  }
}
