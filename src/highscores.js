/**
 * The score board.
 *
 * Ten per list, kept in localStorage so a browser on its own needs nothing at
 * all. Every entry carries an id and the time it was set, which is what lets two
 * boards from two devices be merged later without either winning by being loaded
 * second.
 *
 * The shape is websoccer's rather than webtrack's: a score here is a result, not
 * a number. Biggest win first, then most points scored, then whoever got there
 * earliest. A defeat never makes the board - the whole point is beating the CPU
 * - and unlike football neither does a draw, because basketball does not have
 * them: a tie at the buzzer goes to overtime, first to two.
 *
 * There is a list per game length and per CPU setting. A 21-9 in a ten minute
 * FIBA game and an 11-3 in the quick one are different quantities, and putting
 * them in one table would only ever show the long game at the top.
 *
 * Nothing in here touches the simulation, and the store is injectable so the
 * tests can run it without a browser.
 */

/**
 * Where the board is kept. Its own key, because every game in this family lives
 * on the same github.io origin and one key would mean basketball results landing
 * in the football table.
 */
export const KEY = 'webfiba.highscores.v1';

export const LENGTH_KEYS = ['quick', 'fiba'];
export const TIERS = ['rookie', 'pro', 'legend'];
export const LEVELS = LENGTH_KEYS.flatMap((l) => TIERS.map((t) => `${l}:${t}`));
export const TABLE_SIZE = 10;
export const NAME_LENGTH = 3;

/** The letters you can pick from, in the order the stick cycles through them. */
export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-';

/**
 * Nobody scores sixty in a game that stops at twenty-one. The bound exists to
 * keep a corrupt row or a dishonest one off the board, not to judge anybody.
 */
const MAX_POINTS = 60;

const empty = () => Object.fromEntries(LEVELS.map((l) => [l, []]));

function cleanName(name) {
  const up = String(name ?? '').toUpperCase();
  let out = '';
  for (const ch of up) {
    if (ALPHABET.includes(ch) && out.length < NAME_LENGTH) out += ch;
  }
  return out.padEnd(NAME_LENGTH, '-');
}

function clampNumber(value, lo, hi) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.max(lo, Math.min(hi, n));
}

/**
 * One row, from anywhere: our own storage, another device, or a shared board.
 * Anything unusable comes back null rather than throwing - a corrupt board
 * should cost you a row, not the page.
 */
export function cleanEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const scored = Math.round(Number(raw.scored));
  const conceded = Math.round(Number(raw.conceded));
  if (!Number.isFinite(scored) || !Number.isFinite(conceded)) return null;
  if (scored < 0 || conceded < 0 || scored > MAX_POINTS || conceded > MAX_POINTS) return null;
  if (scored <= conceded) return null; // only wins, and there are no draws
  const at = Number(raw.at);
  return {
    id: String(raw.id || '').slice(0, 40) || makeId(),
    name: cleanName(raw.name),
    scored,
    conceded,
    // The rest is the story of the game rather than its ranking: on the board
    // because a 21-12 with nine dunks in it is a different 21-12.
    dunks: clampNumber(raw.dunks, 0, MAX_POINTS),
    assists: clampNumber(raw.assists, 0, 99),
    ot: Boolean(raw.ot),
    at: Number.isFinite(at) && at > 0 ? at : Date.now(),
  };
}

/** Unique enough to tell two entries apart when boards are merged. */
export function makeId() {
  const rand = Math.floor(Math.random() * 0xffffff).toString(36);
  return `${Date.now().toString(36)}-${rand}`;
}

/** Biggest win first; ties go to whoever scored more, then to whoever was first. */
export function compare(a, b) {
  const margin = (b.scored - b.conceded) - (a.scored - a.conceded);
  if (margin) return margin;
  if (b.scored !== a.scored) return b.scored - a.scored;
  return a.at - b.at;
}

export function sortTable(entries) {
  return [...entries].sort(compare).slice(0, TABLE_SIZE);
}

/** Would this result get on the board? */
export function qualifies(table, entry) {
  const clean = cleanEntry(entry);
  if (!clean) return false;
  // Sorted here rather than trusted: a board that arrived from somewhere else
  // may be in any order, and asking the wrong row would let a worse result in.
  const rows = sortTable(table || []);
  if (rows.length < TABLE_SIZE) return true;
  return compare(clean, rows[rows.length - 1]) < 0;
}

/** Where a result would land, counting from 1, or 0 if it would not. */
export function placeOf(table, entry) {
  const clean = cleanEntry(entry);
  if (!clean) return 0;
  const rows = sortTable([...(table || []), clean]);
  const at = rows.findIndex((r) => r.id === clean.id);
  return at < 0 ? 0 : at + 1;
}

/**
 * Any board, in the shape this version expects. Runs on the way in rather than
 * as a one-off migration, because a browser that has not been opened for a
 * month will post whatever shape it was last left with.
 */
function normalise(board) {
  const out = {};
  for (const [key, rows] of Object.entries(board || {})) {
    if (!Array.isArray(rows) || !LEVELS.includes(key)) continue;
    (out[key] ||= []).push(...rows);
  }
  return out;
}

/**
 * Two boards into one. Same id means the same result, however many times it has
 * travelled: a board that has been round three devices must not grow three
 * copies of everything.
 */
export function merge(mine, theirs) {
  const out = empty();
  const a = normalise(mine);
  const b = normalise(theirs);
  for (const level of LEVELS) {
    const seen = new Map();
    for (const raw of [...(a[level] || []), ...(b[level] || [])]) {
      const entry = cleanEntry(raw);
      if (entry && !seen.has(entry.id)) seen.set(entry.id, entry);
    }
    out[level] = sortTable([...seen.values()]);
  }
  return out;
}

/**
 * A board with everything set before `when` dropped. This is what makes emptying
 * the shared board stick: wiping the server does not wipe anybody's browser, and
 * the next sync would post the old rows straight back.
 */
export function since(board, when) {
  if (!when) return merge({}, board);
  const from = normalise(board);
  const out = {};
  for (const level of LEVELS) {
    out[level] = (from[level] || []).filter((row) => Number(row?.at) >= when);
  }
  return merge({}, out);
}

/** A board with these ids taken out, wherever they sit. */
export function without(board, ids) {
  const drop = new Set(ids || []);
  const from = normalise(board);
  const out = {};
  for (const level of LEVELS) {
    out[level] = (from[level] || []).filter((row) => !drop.has(row?.id));
  }
  return merge({}, out);
}

/** `('fiba', 'pro')` -> `'fiba:pro'`, and anything unknown -> the first list. */
export function levelOf(length, tier = 'pro') {
  const key = String(length).includes(':') ? String(length) : `${length}:${tier}`;
  return LEVELS.includes(key) ? key : LEVELS[0];
}

/** Which length and setting a list is for, for putting on screen. */
export function partsOf(key) {
  const [length, tier] = String(key).split(':');
  return {
    length: LENGTH_KEYS.includes(length) ? length : 'quick',
    tier: TIERS.includes(tier) ? tier : 'pro',
  };
}

export class Highscores {
  constructor(store = globalThis.localStorage, key = KEY) {
    this.store = store;
    this.key = key;
    this.tables = this.read();
  }

  read() {
    try {
      const raw = this.store?.getItem(this.key);
      if (!raw) return empty();
      return merge(empty(), JSON.parse(raw));
    } catch {
      // Unreadable, or storage turned off. Losing the board is a shame,
      // refusing to start the game is worse.
      return empty();
    }
  }

  write() {
    try {
      this.store?.setItem(this.key, JSON.stringify(this.tables));
    } catch { /* private mode: the board just will not stick */ }
  }

  table(length, tier) {
    return this.tables[levelOf(length, tier)] || [];
  }

  qualifies(length, tier, entry) {
    return qualifies(this.table(length, tier), entry);
  }

  /** Adds a result and returns where it landed, or 0 if it missed the board. */
  add(length, tier, entry) {
    const clean = cleanEntry(entry);
    if (!clean) return 0;
    const level = levelOf(length, tier);
    this.tables[level] = sortTable([...this.table(level), clean]);
    this.write();
    return this.tables[level].findIndex((r) => r.id === clean.id) + 1;
  }

  best(length, tier) {
    return this.table(length, tier)[0] || null;
  }

  /** Folds in a board from somewhere else and keeps the result. */
  absorb(theirs) {
    this.tables = merge(this.tables, theirs);
    this.write();
    return this.tables;
  }

  all() {
    return this.tables;
  }
}
