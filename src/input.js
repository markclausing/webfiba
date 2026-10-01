/**
 * Keyboard, gamepad and touch, all into one shape:
 *
 *   { mx, my, sprint, shoot, pass, lob }   held state, stick in screen space
 *   pressed.pause, pressed.camera            edges, for the menus
 *   mask                                     the family's six-bit mask
 *
 * Nothing downstream knows which of the three it came from.
 */

import { BTN } from './constants.js';

const KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  shoot: ['Space', 'KeyJ'],
  pass: ['KeyE', 'KeyK'],
  lob: ['KeyQ', 'KeyL'],
};

export class Input {
  constructor() {
    this.down = new Set();
    this.edges = new Set();
    this.touch = { mx: 0, my: 0, shoot: false, pass: false, lob: false, sprint: false };
    this.usingPad = false;
    this.pad = null;
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.down.add(e.code);
      this.edges.add(e.code);
      this.usingPad = false;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
    this.padPrev = [];
  }

  any(list) {
    return list.some((k) => this.down.has(k));
  }

  /** One frame's worth of input. */
  poll() {
    let mx = (this.any(KEYS.right) ? 1 : 0) - (this.any(KEYS.left) ? 1 : 0);
    let my = (this.any(KEYS.up) ? 1 : 0) - (this.any(KEYS.down) ? 1 : 0);
    let sprint = this.any(KEYS.sprint);
    let shoot = this.any(KEYS.shoot);
    let pass = this.any(KEYS.pass);
    let lob = this.any(KEYS.lob);
    const pressed = {
      pause: this.edges.has('Escape') || this.edges.has('KeyP'),
      camera: this.edges.has('KeyC'),
      confirm: this.edges.has('Enter'),
    };
    this.edges.clear();

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      this.pad = gp;
      const ax = gp.axes[0] || 0;
      const ay = gp.axes[1] || 0;
      const dead = Math.hypot(ax, ay) > 0.18;
      const b = (i) => Boolean(gp.buttons[i]?.pressed);
      const prev = this.padPrev;
      const edge = (i) => b(i) && !prev[i];
      if (dead || gp.buttons.some((x) => x.pressed)) this.usingPad = true;
      if (dead) {
        mx = ax;
        my = -ay;
      }
      if (b(12)) my = 1;
      if (b(13)) my = -1;
      if (b(14)) mx = -1;
      if (b(15)) mx = 1;
      sprint ||= b(7) || b(5) || (gp.buttons[7]?.value || 0) > 0.3;
      shoot ||= b(2);
      pass ||= b(0);
      lob ||= b(3) || b(1);
      pressed.pause ||= edge(9);
      pressed.camera ||= edge(8);
      this.padPrev = gp.buttons.map((x) => x.pressed);
      break;
    }

    const t = this.touch;
    if (Math.hypot(t.mx, t.my) > 0.1) {
      mx = t.mx;
      my = t.my;
    }
    sprint ||= t.sprint;
    shoot ||= t.shoot;
    pass ||= t.pass;
    lob ||= t.lob;

    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    let mask = 0;
    if (my > 0.5) mask |= BTN.UP;
    if (my < -0.5) mask |= BTN.DOWN;
    if (mx < -0.5) mask |= BTN.LEFT;
    if (mx > 0.5) mask |= BTN.RIGHT;
    if (shoot || pass) mask |= BTN.FIRE;
    if (lob) mask |= BTN.SWITCH;
    return { mx, my, sprint, shoot, pass, lob, pressed, mask };
  }

  /** A thump in the hands, where the hardware can. */
  rumble(strong = 0.6, weak = 0.4, ms = 180) {
    const gp = this.pad;
    const act = gp?.vibrationActuator;
    if (!act || !this.usingPad) return;
    try {
      act.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak });
    } catch { /* not every pad, not every browser */ }
  }

  /**
   * On-screen controls for phones and tablets: a stick on the left, four
   * buttons on the right. They write into `touch`, which poll() reads like any
   * other device.
   */
  attachTouch(root) {
    const stick = root.querySelector('#stick');
    const knob = root.querySelector('#knob');
    let id = null;
    let cx = 0;
    let cy = 0;
    const R = 56;
    stick.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      const r = stick.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      stick.setPointerCapture(id);
      move(e);
    });
    const move = (e) => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        dx *= R / d;
        dy *= R / d;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.touch.mx = dx / R;
      this.touch.my = -dy / R;
      this.touch.sprint = d > R * 0.92;
    };
    stick.addEventListener('pointermove', move);
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      knob.style.transform = '';
      this.touch.mx = 0;
      this.touch.my = 0;
      this.touch.sprint = false;
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
    for (const [sel, key] of [['#tShoot', 'shoot'], ['#tPass', 'pass'], ['#tLob', 'lob']]) {
      const b = root.querySelector(sel);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.touch[key] = true;
        b.classList.add('down');
      });
      const up = () => {
        this.touch[key] = false;
        b.classList.remove('down');
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
    }
  }
}
