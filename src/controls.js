/**
 * Which key and which pad button does what.
 *
 * Two keys per action and one or two pad buttons, kept in localStorage, with a
 * couple of presets. Binding a key that is already in use takes it away from
 * the action that had it, so the board can never end up with one key meaning
 * two things - which in a game where shoot and block share a button is the
 * difference between a stop and a foul.
 *
 * Moving with the left stick and the D-pad is not configurable: those are the
 * stick, and nobody wants them anywhere else.
 */

export const ACTIONS = [
  { key: 'up', label: 'Up / towards the ring' },
  { key: 'down', label: 'Down' },
  { key: 'left', label: 'Left' },
  { key: 'right', label: 'Right' },
  { key: 'sprint', label: 'Sprint', pad: true },
  { key: 'shoot', label: 'Shoot · block', pad: true },
  { key: 'pass', label: 'Pass · steal', pad: true },
  { key: 'lob', label: 'Alley-oop · switch', pad: true },
  { key: 'camera', label: 'Camera', pad: true },
  { key: 'pause', label: 'Pause', pad: true },
];

export const PRESETS = {
  wasd: {
    label: 'WASD + SPACE',
    keys: {
      up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
      sprint: ['ShiftLeft', 'ShiftRight'], shoot: ['Space', 'KeyJ'], pass: ['KeyE', 'KeyK'], lob: ['KeyQ', 'KeyL'],
      camera: ['KeyC', null], pause: ['KeyP', null],
    },
  },
  arrows: {
    label: 'ARROWS + ZXC',
    keys: {
      up: ['ArrowUp', null], down: ['ArrowDown', null], left: ['ArrowLeft', null], right: ['ArrowRight', null],
      sprint: ['ShiftLeft', 'ShiftRight'], shoot: ['KeyZ', 'Space'], pass: ['KeyX', null], lob: ['KeyC', null],
      camera: ['KeyV', null], pause: ['KeyP', null],
    },
  },
  ijkl: {
    label: 'IJKL + ASD',
    keys: {
      up: ['KeyI', null], down: ['KeyK', null], left: ['KeyJ', null], right: ['KeyL', null],
      sprint: ['KeyF', 'ShiftLeft'], shoot: ['KeyA', 'Space'], pass: ['KeyS', null], lob: ['KeyD', null],
      camera: ['KeyC', null], pause: ['KeyP', null],
    },
  },
};

export const DEFAULT_PAD = {
  sprint: [7, 5], shoot: [2, null], pass: [0, null], lob: [3, 1], camera: [8, null], pause: [9, null],
};

const STORE = 'webfiba.controls.v1';

/** Keys the browser or the page needs for itself, and that cannot be bound. */
const RESERVED = new Set(['Escape', 'Enter', 'Tab', 'MetaLeft', 'MetaRight', 'F5', 'F11', 'F12']);

export class Controls {
  constructor(store = globalThis.localStorage) {
    this.store = store;
    this.keys = clone(PRESETS.wasd.keys);
    this.pad = clone(DEFAULT_PAD);
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(this.store?.getItem(STORE) || 'null');
      if (!raw) return;
      for (const a of ACTIONS) {
        if (Array.isArray(raw.keys?.[a.key])) this.keys[a.key] = [raw.keys[a.key][0] ?? null, raw.keys[a.key][1] ?? null];
        if (a.pad && Array.isArray(raw.pad?.[a.key])) this.pad[a.key] = [num(raw.pad[a.key][0]), num(raw.pad[a.key][1])];
      }
    } catch { /* a broken save just means the defaults */ }
  }

  save() {
    try {
      this.store?.setItem(STORE, JSON.stringify({ keys: this.keys, pad: this.pad }));
    } catch { /* private mode */ }
  }

  preset(name) {
    if (!PRESETS[name]) return;
    this.keys = clone(PRESETS[name].keys);
    this.save();
  }

  resetPad() {
    this.pad = clone(DEFAULT_PAD);
    this.save();
  }

  /** Which preset this is, if it is one. */
  presetName() {
    for (const [name, p] of Object.entries(PRESETS)) {
      if (JSON.stringify(p.keys) === JSON.stringify(this.keys)) return name;
    }
    return null;
  }

  canBind(code) {
    return !RESERVED.has(code);
  }

  /** Puts `code` in slot `slot` of `action`, taking it off anything else first. */
  bindKey(action, slot, code) {
    if (code !== null && !this.canBind(code)) return false;
    if (code !== null) {
      for (const a of ACTIONS) {
        const list = this.keys[a.key];
        for (let i = 0; i < 2; i++) if (list[i] === code) list[i] = null;
      }
    }
    this.keys[action][slot] = code;
    // An action that lost its first key keeps its second, moved up, so the
    // first column is always the one that works.
    for (const a of ACTIONS) {
      const list = this.keys[a.key];
      if (!list[0] && list[1]) {
        list[0] = list[1];
        list[1] = null;
      }
    }
    this.save();
    return true;
  }

  bindPad(action, slot, button) {
    if (button !== null) {
      for (const a of ACTIONS) {
        if (!a.pad) continue;
        const list = this.pad[a.key];
        for (let i = 0; i < 2; i++) if (list[i] === button) list[i] = null;
      }
    }
    this.pad[action][slot] = button;
    this.save();
  }

  /** Every action with no key at all: the menu warns about these. */
  unbound() {
    return ACTIONS.filter((a) => !this.keys[a.key][0] && !this.keys[a.key][1]).map((a) => a.key);
  }
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

function num(v) {
  const n = Number(v);
  return v === null || v === undefined || !Number.isInteger(n) || n < 0 || n > 31 ? null : n;
}

const NAMED = {
  Space: 'SPACE', ShiftLeft: 'L SHIFT', ShiftRight: 'R SHIFT', ControlLeft: 'L CTRL', ControlRight: 'R CTRL',
  AltLeft: 'L ALT', AltRight: 'R ALT', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Backspace: 'BKSP', CapsLock: 'CAPS', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`',
  IntlBackslash: '§', ContextMenu: 'MENU', Delete: 'DEL', Insert: 'INS', Home: 'HOME', End: 'END',
  PageUp: 'PG UP', PageDown: 'PG DN',
};

/** `KeyW` -> `W`, `Numpad4` -> `NUM 4`, and so on. */
export function keyLabel(code) {
  if (!code) return '—';
  if (NAMED[code]) return NAMED[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `NUM ${code.slice(6).replace('Enter', '↵').replace('Add', '+').replace('Subtract', '-').replace('Multiply', '*').replace('Divide', '/').replace('Decimal', '.')}`;
  return code.toUpperCase();
}

const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'SELECT', 'START', 'L STICK', 'R STICK', 'D ↑', 'D ↓', 'D ←', 'D →', 'HOME'];

export function padLabel(i) {
  if (i === null || i === undefined) return '—';
  return PAD_NAMES[i] || `BUTTON ${i}`;
}
