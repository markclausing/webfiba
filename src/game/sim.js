/**
 * The game: six players, one ball, the FIBA 3x3 rule book.
 *
 * Fixed sixty ticks a second, no clock read, no randomness that does not come
 * from the seeded generator - so a test can play a thousand games CPU against
 * CPU and get the same thousand games next time. Nothing in here knows there is
 * a screen; the renderer reads the state and the list of events each tick leaves
 * behind, and that is all the contact there is.
 *
 * The rules, as far as they reach into a game like this:
 *
 *   - Ten minutes on the clock, or the first side to 21 wins on the spot. (The
 *     quick game is five minutes and 11.)
 *   - One point inside the arc, two from behind it, one per free throw.
 *   - A twelve second shot clock, reset when the ball touches the ring.
 *   - After a basket the other side takes the ball from under the ring, and
 *     after a defensive rebound or a steal the ball has to be taken behind the
 *     arc before that side may score. That one rule is most of what makes 3x3
 *     feel like 3x3, so it is enforced, and the HUD says CLEAR IT until it is.
 *   - Every dead ball restarts with a check at the top.
 *   - Team fouls: the seventh, eighth and ninth are two free throws, the tenth
 *     and after are two free throws and the ball as well.
 *   - Tied when time runs out: overtime, and the first side to score two more
 *     points wins.
 */

import { COURT, DT, GRAVITY, RIM, CHECK_SPOT, beyondArc, inBounds, distToRim } from './court.js';
import { stepBall, launch, launchTimed, aimPoint } from './ball.js';
import { makeRoster, TEAMS } from './teams.js';
import { think, assignDefense } from './ai.js';

export const LENGTHS = {
  quick: { label: 'QUICK', clock: 300, target: 11 },
  fiba: { label: 'FIBA', clock: 600, target: 21 },
};

/**
 * How hard the CPU tries. Everything here is a dial on the same AI rather than a
 * different AI: how quickly it reacts, how often it reads the right pass, how
 * steady its release is, how greedy its hands are.
 */
export const TIERS = {
  rookie: { label: 'ROOKIE', react: 0.36, decide: 0.55, release: 0.085, shot: 0.86, steal: 0.12, block: 0.6, read: 0.55, help: 0.12 },
  pro: { label: 'PRO', react: 0.24, decide: 0.38, release: 0.055, shot: 1.0, steal: 0.24, block: 1.0, read: 0.8, help: 0.06 },
  legend: { label: 'LEGEND', react: 0.15, decide: 0.26, release: 0.035, shot: 1.1, steal: 0.36, block: 1.25, read: 0.95, help: 0.0 },
};

/** The human side gets a little help on the lower settings. */
const HUMAN_SHOT = { rookie: 1.14, pro: 1.02, legend: 0.96 };

export const SHOT_CLOCK = 12;
const BODY_R = 0.3;
const RUN = 5.1;
const SPRINT = 7.2;
/** The moment in a jump shot when the ball should leave the hand: the top. */
export const JUMPER_APEX = 0.44;
const JUMPER_AUTO = 0.95;
/** Seconds between two catches for the second to keep the ball moving. */
const FLOW_GAP = 3.2;

// --- Seeded randomness --------------------------------------------------------------

export function makeRng(seed = 1) {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (lo, hi) => lo + (hi - lo) * rng();
  rng.normal = () => {
    const u = Math.max(1e-9, rng());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  };
  return rng;
}

// --- Setup ----------------------------------------------------------------------------

export function createGame(opts = {}) {
  const length = LENGTHS[opts.length] ? opts.length : 'quick';
  const tier = TIERS[opts.tier] ? opts.tier : 'pro';
  const home = opts.home || 'amsterdam';
  const away = opts.away || 'riga';
  const rng = makeRng(opts.seed ?? 12345);

  const players = [];
  for (const [team, key] of [[0, home], [1, away]]) {
    for (const r of makeRoster(key)) {
      players.push({
        id: players.length,
        team,
        ...r,
        x: 0, z: 5, vx: 0, vz: 0, y: 0, vy: 0,
        face: Math.PI,
        act: null,
        sprint: false,
        stance: false,
        human: false,
        cooldown: 0,
        blockedFor: 0,
        ai: { mode: 'space', modeT: 0, target: { x: 0, z: 5 }, think: 0, guard: -1, decideT: 0, holdT: 0, plan: null },
      });
    }
  }

  const state = {
    rng,
    tick: 0,
    time: 0,
    length,
    tier,
    teams: [TEAMS[home], TEAMS[away]],
    humanTeam: opts.humanTeam ?? 0,
    target: LENGTHS[length].target,
    clock: LENGTHS[length].clock,
    shotClock: SHOT_CLOCK,
    overtime: false,
    otPoints: [0, 0],
    score: [0, 0],
    fouls: [0, 0],
    possession: 0,
    needsClear: false,
    phase: 'check',
    phaseT: 0,
    next: null,
    players,
    controlled: -1,
    ball: {
      pos: { x: 0, y: 1, z: 6 }, vel: { x: 0, y: 0, z: 0 },
      holder: -1, mode: 'held', shot: null, pass: null,
      lastTouch: -1, lastTeam: 0, touchedRim: false, touchedBoard: false, inNet: 0,
      rimHit: 0, airborne: 0, tried: new Set(), deadAt: 0,
    },
    flow: { team: -1, count: 0, lastCatch: -99, passer: -1, passT: -99 },
    stats: [blankStats(), blankStats()],
    events: [],
    message: null,
    ft: null,
    winner: -1,
    buzzer: false,
    input: null,
    prevInput: blankInput(),
  };

  // Coin toss: whoever wins it has the ball first.
  const first = opts.first ?? (rng() < 0.5 ? 0 : 1);
  setupCheck(state, first, true);
  emit(state, 'tip', { team: first });
  return state;
}

function blankStats() {
  return { pts: 0, fga: 0, fgm: 0, twoA: 0, twoM: 0, dunks: 0, assists: 0, steals: 0, blocks: 0, reb: 0, tov: 0, bestFlow: 0, ftA: 0, ftM: 0 };
}

export function blankInput() {
  return { mx: 0, mz: 0, sprint: false, shoot: false, pass: false, lob: false };
}

function emit(state, type, data = {}) {
  state.events.push({ type, ...data });
}

function say(state, text, sub = '', team = -1, time = 1.6) {
  state.message = { text, sub, team, until: state.time + time, at: state.time };
}

// --- Restarts ---------------------------------------------------------------------------

/**
 * Everybody to their places for a check at the top. The ball goes to the
 * offence's guard; the other two spread to the wings, and each defender picks
 * up the man in front of him.
 */
export function setupCheck(state, team, instant = false) {
  const off = teamPlayers(state, team);
  const def = teamPlayers(state, 1 - team);
  const spots = [
    { x: CHECK_SPOT.x, z: CHECK_SPOT.z + 0.4 },
    { x: -5.4, z: 3.6 },
    { x: 5.4, z: 3.6 },
  ];
  for (let i = 0; i < 3; i++) {
    const o = off[i];
    const d = def[i];
    const s = spots[i];
    const toRim = Math.hypot(s.x, s.z);
    const gap = i === 0 ? 1.05 : 1.8;
    place(state, o, s.x, s.z, instant);
    place(state, d, s.x - (s.x / toRim) * gap, s.z - (s.z / toRim) * gap, instant);
    d.ai.guard = o.id;
    o.ai.guard = d.id;
  }
  state.possession = team;
  state.needsClear = false;
  state.shotClock = SHOT_CLOCK;
  giveBall(state, off[0], 'check');
  state.phase = 'check';
  state.phaseT = 0;
  state.flow = { team, count: 0, lastCatch: -99, passer: -1, passT: -99 };
  for (const p of state.players) {
    p.act = null;
    p.y = 0;
    p.vy = 0;
  }
  if (state.humanTeam >= 0) {
    state.controlled = team === state.humanTeam ? off[0].id : def[0].id;
  }
}

function place(state, p, x, z, instant) {
  p.ai.target = { x, z };
  p.ai.mode = 'reset';
  if (instant) {
    p.x = x;
    p.z = z;
    p.vx = 0;
    p.vz = 0;
    p.face = Math.atan2(-x, -z);
  }
}

/**
 * The ball under the ring after a basket. FIBA has no inbound pass in 3x3: a
 * defender just takes it from under the basket and goes, and has to get it out
 * behind the arc before his side may score.
 */
function setupAfterScore(state, team) {
  const off = teamPlayers(state, team);
  // Whoever is nearest the ring takes it.
  let taker = off[0];
  for (const p of off) if (distToRim(p.x, p.z) < distToRim(taker.x, taker.z)) taker = p;
  taker.x = Math.max(-1.2, Math.min(1.2, taker.x));
  taker.z = Math.max(0.5, Math.min(1.3, taker.z));
  taker.act = null;
  state.possession = team;
  state.needsClear = true;
  state.shotClock = SHOT_CLOCK;
  giveBall(state, taker, 'inbound');
  state.flow = { team, count: 0, lastCatch: -99, passer: -1, passT: -99 };
  state.phase = 'live';
  state.phaseT = 0;
  for (const p of state.players) {
    if (p.team !== team) {
      // The side that scored retreats: they may not play the ball in the
      // no-charge circle, so in practice they pick up out by the arc.
      p.ai.mode = 'recover';
      p.ai.modeT = 0;
    } else if (p !== taker) {
      p.ai.mode = 'space';
      p.ai.modeT = 0;
    }
  }
  if (state.humanTeam >= 0) {
    state.controlled = team === state.humanTeam ? taker.id : nearestOf(state, 1 - team, taker).id;
  }
  emit(state, 'restart', { team });
}

function setupFreeThrows(state, shooter, count, thenBall) {
  const team = shooter.team;
  state.ft = { shooter: shooter.id, left: count, total: count, then: thenBall, made: 0 };
  state.phase = 'ft';
  state.phaseT = 0;
  const lane = [
    [-2.85, 0.9], [2.85, 0.9], [-2.85, 2.5], [2.85, 2.5], [-4.6, 5.6], [4.6, 5.6],
  ];
  const others = state.players.filter((p) => p !== shooter);
  // Defence takes the spots nearest the ring, as on any court.
  others.sort((a, b) => (a.team === team) - (b.team === team));
  others.forEach((p, i) => place(state, p, lane[i][0], lane[i][1], true));
  place(state, shooter, 0, COURT.FT_Z + 0.35, true);
  shooter.face = Math.PI;
  for (const p of state.players) {
    p.act = null;
    p.y = 0;
  }
  giveBall(state, shooter, 'ft');
  state.possession = team;
  state.needsClear = false;
  if (state.humanTeam >= 0) {
    state.controlled = team === state.humanTeam ? shooter.id : state.controlled;
  }
  emit(state, 'ftsetup', { shooter: shooter.id, count });
}

// --- The tick -------------------------------------------------------------------------------

/**
 * One sixtieth of a second. `input` is the human's controls for this tick, in
 * world space (the camera has already been taken out of the stick); the CPU's
 * come from ai.js.
 */
export function step(state, input = blankInput()) {
  state.events.length = 0;
  state.tick++;
  state.time += DT;
  state.phaseT += DT;
  const prev = state.prevInput;
  const press = {
    shoot: input.shoot && !prev.shoot,
    shootUp: !input.shoot && prev.shoot,
    pass: input.pass && !prev.pass,
    lob: input.lob && !prev.lob,
  };
  state.input = input;
  state.prevInput = { ...input };

  if (state.phase === 'over') {
    for (const p of state.players) movePlayer(state, p, { mx: 0, mz: 0 });
    tickBall(state);
    return state;
  }

  if (state.phase === 'dead' || state.phase === 'scored') {
    runDead(state);
    return state;
  }

  if (state.phase === 'check') {
    runCheck(state, press);
    return state;
  }

  if (state.phase === 'ft') {
    runFreeThrow(state, input, press);
    return state;
  }

  // --- live -------------------------------------------------------------------------
  autoSwitch(state, press);
  assignDefense(state);

  for (const p of state.players) {
    if (p.cooldown > 0) p.cooldown -= DT;
    let intent;
    if (p.id === state.controlled && state.humanTeam === p.team) {
      intent = humanIntent(state, p, input, press);
    } else {
      intent = think(state, p);
    }
    applyIntent(state, p, intent);
    stepAction(state, p, intent);
    movePlayer(state, p, intent);
  }
  separate(state);
  tickBall(state);
  if (state.phase !== 'live') return state;
  rules(state);
  return state;
}

function runDead(state) {
  for (const p of state.players) {
    stepAction(state, p, {});
    const t = p.ai.target;
    if (p.act && p.act.locked) {
      movePlayer(state, p, { mx: 0, mz: 0 });
      continue;
    }
    // Drift: players walk where the restart wants them, or just slow down.
    const intent = state.phase === 'dead' && t ? seek(p, t, 0.5) : { mx: 0, mz: 0 };
    movePlayer(state, p, intent);
  }
  separate(state);
  tickBall(state);
  if (state.phaseT >= (state.deadFor || 1.2) && state.next) {
    const next = state.next;
    state.next = null;
    next();
  }
}

/**
 * The walk to a check. Players head to their spots; once everybody is near
 * enough, or after a couple of seconds whatever happens, the defender hands the
 * ball over and it is live.
 */
function runCheck(state, press) {
  let ready = true;
  for (const p of state.players) {
    const t = p.ai.target;
    const d = Math.hypot(t.x - p.x, t.z - p.z);
    if (d > 0.35) ready = false;
    const intent = d > 0.15 ? seek(p, t, d > 2 ? 1 : 0.6) : { mx: 0, mz: 0 };
    if (p.id === state.ball.holder || p.ai.guard === state.ball.holder) {
      intent.face = Math.atan2(RIM.x - p.x, RIM.z - p.z);
      if (p.team !== state.possession) intent.face += Math.PI;
    }
    movePlayer(state, p, intent);
    if (state.phaseT > 2.4 && d > 0.35) {
      // Nobody waits for a straggler: put him there.
      p.x += (t.x - p.x) * 0.2;
      p.z += (t.z - p.z) * 0.2;
    }
  }
  separate(state);
  holdBall(state);
  const humanReady = press.shoot || press.pass;
  if ((ready && state.phaseT > 0.9) || state.phaseT > 3.0 || (humanReady && state.phaseT > 0.4)) {
    state.phase = 'live';
    state.phaseT = 0;
    for (const p of state.players) {
      p.ai.mode = p.team === state.possession ? 'space' : 'guard';
      p.ai.modeT = 0;
      p.ai.holdT = 0;
    }
    emit(state, 'checked', { team: state.possession });
  }
}

// --- Human controls -----------------------------------------------------------------------------

function humanIntent(state, p, input, press) {
  const intent = { mx: input.mx, mz: input.mz, sprint: input.sprint, human: true };
  const hasBall = state.ball.holder === p.id;
  if (hasBall) {
    if (press.shoot) intent.shoot = true;
    if (press.pass) intent.pass = pickPassTarget(state, p, input.mx, input.mz);
    if (press.lob) {
      intent.pass = pickPassTarget(state, p, input.mx, input.mz, true);
      intent.lob = true;
    }
    intent.release = press.shootUp;
  } else {
    // Defence, or off the ball.
    intent.stance = state.possession !== p.team;
    if (press.shoot) intent.jump = true;
    if (press.pass) intent.steal = true;
  }
  return intent;
}

/**
 * Which team-mate a pass goes to. With the stick held, the one most nearly in
 * that direction; with it centred, whoever is most open - weighted towards a
 * man cutting to the ring, because that is the pass you are usually looking for.
 */
export function pickPassTarget(state, p, dx, dz, lob = false) {
  const mates = state.players.filter((q) => q.team === p.team && q !== p);
  const len = Math.hypot(dx, dz);
  let best = null;
  let bestScore = -Infinity;
  for (const q of mates) {
    const ox = q.x - p.x;
    const oz = q.z - p.z;
    const d = Math.hypot(ox, oz) || 1;
    let score;
    if (len > 0.3) {
      score = (ox * dx + oz * dz) / (d * len) * 3 - d * 0.03;
    } else {
      score = openness(state, q) * 0.6 - d * 0.05;
      if (q.ai.mode === 'cut' || q.ai.mode === 'roll') score += 1.2;
      if (lob) score += Math.max(0, 6 - distToRim(q.x, q.z)) * 0.4;
    }
    if (score > bestScore) {
      bestScore = score;
      best = q;
    }
  }
  return best ? best.id : -1;
}

/** Metres to the nearest opponent. */
export function openness(state, p) {
  let d = 9;
  for (const q of state.players) {
    if (q.team === p.team) continue;
    d = Math.min(d, Math.hypot(q.x - p.x, q.z - p.z));
  }
  return d;
}

/**
 * Who the human is. On offence it is always the man with the ball; when the
 * ball is loose or in the air it is whoever on his side is nearest it; on
 * defence it stays put until the switch button moves it to the defender nearest
 * the ball.
 */
function autoSwitch(state, press) {
  if (state.humanTeam < 0) return;
  const ball = state.ball;
  const holder = ball.holder >= 0 ? state.players[ball.holder] : null;
  if (holder && holder.team === state.humanTeam) {
    state.controlled = holder.id;
    return;
  }
  const me = state.players[state.controlled];
  if (!me || me.team !== state.humanTeam) {
    state.controlled = nearestOf(state, state.humanTeam, ball.pos).id;
    return;
  }
  if (press.lob && !holder) {
    state.controlled = nearestOf(state, state.humanTeam, ball.pos, me).id;
    emit(state, 'switch', { id: state.controlled });
    return;
  }
  if (press.lob && holder) {
    state.controlled = nearestOf(state, state.humanTeam, holder, me).id;
    emit(state, 'switch', { id: state.controlled });
    return;
  }
  // A loose ball or a rebound: hand control to the nearest man, with a little
  // reluctance so it does not flick back and forth between two equals.
  if (!holder && (ball.mode === 'free' || ball.mode === 'shot') && !me.act) {
    const n = nearestOf(state, state.humanTeam, ball.pos);
    const dn = Math.hypot(n.x - ball.pos.x, n.z - ball.pos.z);
    const dm = Math.hypot(me.x - ball.pos.x, me.z - ball.pos.z);
    if (n !== me && dn < dm - 1.2 && ball.mode === 'free') state.controlled = n.id;
  }
}

export function nearestOf(state, team, point, except = null) {
  let best = null;
  let bd = Infinity;
  for (const p of state.players) {
    if (p.team !== team || p === except) continue;
    const d = Math.hypot(p.x - point.x, p.z - point.z);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

export function teamPlayers(state, team) {
  return state.players.filter((p) => p.team === team);
}

// --- Intents into actions -----------------------------------------------------------------------

function applyIntent(state, p, intent) {
  const ball = state.ball;
  const hasBall = ball.holder === p.id;
  if (p.act && p.act.locked) return;

  if (hasBall) {
    if (intent.shoot) {
      if (state.needsClear) {
        // Not yet: the ball has to go out behind the arc first.
        emit(state, 'mustclear', { id: p.id });
      } else {
        startShot(state, p, intent);
        return;
      }
    }
    if (intent.pass >= 0 && intent.pass !== undefined && p.cooldown <= 0) {
      startPass(state, p, state.players[intent.pass], Boolean(intent.lob));
      return;
    }
  } else if (!p.act) {
    if (intent.jump) startJump(state, p, intent.jumpKind || 'block');
    else if (intent.steal && p.cooldown <= 0) startSteal(state, p);
  }
}

// --- Shots ------------------------------------------------------------------------------------------

function startShot(state, p, intent) {
  const d = distToRim(p.x, p.z);
  const toRimX = -p.x / (d || 1);
  const toRimZ = -p.z / (d || 1);
  const speed = Math.hypot(p.vx, p.vz);
  const approach = speed > 0.5 ? (p.vx * toRimX + p.vz * toRimZ) / speed : 0;
  const dunkRange = (intent.sprint || speed > 5.5 ? 2.1 + 2.0 * p.r.dunk : 1.5 + 1.2 * p.r.dunk);
  const canDunk = p.r.dunk >= 0.4 && d <= dunkRange && d > 0.35 && (approach > 0.2 || d < 1.7);

  if (canDunk) startDunk(state, p, false);
  else if (d <= 3.1) startLayup(state, p);
  else startJumper(state, p, intent);
}

function startJumper(state, p, intent) {
  const tierSigma = TIERS[state.tier].release;
  p.act = {
    kind: 'shoot', t: 0, locked: true, released: false,
    human: Boolean(intent.human),
    // The CPU decides now when it will let go: the apex, give or take.
    releaseAt: intent.human ? null : JUMPER_APEX + state.rng.normal() * tierSigma,
    from: { x: p.x, z: p.z },
    moving: Math.hypot(p.vx, p.vz) > 2.2,
    jump: 0.42 + 0.12 * p.r.dunk,
    dur: 1.05,
  };
  p.vx *= 0.3;
  p.vz *= 0.3;
  p.face = Math.atan2(-p.x, -p.z);
  emit(state, 'gather', { id: p.id, kind: 'shoot' });
}

function startLayup(state, p) {
  const d = distToRim(p.x, p.z) || 1;
  const ux = -p.x / d;
  const uz = -p.z / d;
  p.act = {
    kind: 'layup', t: 0, locked: true, released: false,
    from: { x: p.x, z: p.z },
    to: null,
    jump: 0.6 + 0.2 * p.r.dunk,
    dur: 1.0,
    side: Math.sign(p.x || 1),
  };
  const reach = Math.min(d - 0.7, 1.7);
  p.act.to = { x: p.x + ux * reach, z: p.z + uz * reach };
  p.face = Math.atan2(ux, uz);
  emit(state, 'gather', { id: p.id, kind: 'layup' });
}

/**
 * The dunk. A gather step, a take-off, a flight that peaks with the ball over
 * the ring, the slam, a moment hanging on the iron and the drop.
 *
 * The flight is scripted rather than simulated, because a dunk is the one thing
 * in the game that must never look like it went wrong by accident: the player
 * goes where the ball goes in. What can go wrong goes wrong on purpose - a
 * defender who got up in time takes it off him at the top.
 */
function startDunk(state, p, alley, alleyArrive = 0) {
  const d = distToRim(p.x, p.z) || 1;
  const ux = -p.x / d;
  const uz = -p.z / d;
  // The ball goes down through the middle; the hand that puts it there is a
  // little in front of it, and the body a step further.
  const slam = { x: -ux * 0.42, z: -uz * 0.42 };
  const flight = Math.max(0.42, Math.min(0.72, 0.36 + (d - 0.42) * 0.11));
  const top = Math.max(0.55, COURT.RIM_Y + 0.22 - p.reach);
  const styles = ['one', 'two', 'tomahawk', 'reverse', 'windmill', 'three60'];
  let style;
  const roll = state.rng();
  if (alley) style = roll < 0.5 ? 'two' : 'one';
  else if (d > 3.2 && p.r.dunk > 0.85 && roll < 0.35) style = 'three60';
  else if (d > 2.6 && roll < 0.45) style = 'windmill';
  else if (Math.abs(p.x) < 0.8 && roll < 0.3) style = 'reverse';
  else style = styles[Math.floor(state.rng() * 3)];
  p.act = {
    kind: 'dunk', t: 0, locked: true, released: false,
    from: { x: p.x, z: p.z },
    slam,
    gather: alley ? 0 : 0.16,
    flight,
    hang: 0.38,
    top,
    style,
    alley,
    arrive: alleyArrive,
    dur: (alley ? 0 : 0.16) + flight + 0.38 + 0.9,
  };
  p.face = Math.atan2(ux, uz);
  emit(state, 'gather', { id: p.id, kind: 'dunk', style, alley });
}

/** Defender's leap: a block, a contest, a rebound. */
function startJump(state, p, kind) {
  if (p.act) return;
  p.act = { kind: 'jump', sub: kind, t: 0, locked: true, jump: 0.5 + 0.35 * (kind === 'reb' ? p.r.reb : p.r.block), dur: 0.85 };
  p.vx *= 0.5;
  p.vz *= 0.5;
  emit(state, 'jump', { id: p.id });
}

function startSteal(state, p) {
  const ball = state.ball;
  p.act = { kind: 'steal', t: 0, locked: false, dur: 0.42, done: false };
  p.cooldown = 0.9;
  emit(state, 'reach', { id: p.id });
  if (ball.holder < 0) return;
  const h = state.players[ball.holder];
  if (h.team === p.team) return;
  const d = Math.hypot(h.x - p.x, h.z - p.z);
  if (d > 1.35 || (h.act && h.act.kind !== 'steal')) {
    if (h.act && d < 1.0) {
      // Reaching in on a man who is already rising: that is a foul.
      if (state.rng() < 0.5) foul(state, p, h, h.act.kind === 'shoot' || h.act.kind === 'layup' || h.act.kind === 'dunk');
    }
    return;
  }
  // From behind is a foul more often than a steal; from in front, the other way.
  const hx = Math.sin(h.face);
  const hz = Math.cos(h.face);
  const front = ((p.x - h.x) * hx + (p.z - h.z) * hz) / (d || 1);
  const tier = TIERS[state.tier];
  const skill = p.team === state.humanTeam ? 0.32 : 0.12 + tier.steal * 0.5;
  const chance = skill * p.r.steal * (front > 0 ? 1 : 0.55) * (1.3 - 0.4 * h.r.pass);
  const foulChance = front > 0 ? 0.08 : 0.25;
  const r = state.rng();
  if (r < chance) {
    // Poked loose: the ball squirts away from the dribbler towards the thief.
    ball.holder = -1;
    ball.mode = 'free';
    ball.shot = null;
    ball.pos = { x: h.x + hx * 0.35, y: 0.8, z: h.z + hz * 0.35 };
    ball.vel = { x: (p.x - h.x) * 2.2 + state.rng.range(-1, 1), y: 1.4, z: (p.z - h.z) * 2.2 + state.rng.range(-1, 1) };
    ball.lastTouch = p.id;
    ball.lastTeam = p.team;
    ball.stolenBy = p.id;
    emit(state, 'steal', { id: p.id, from: h.id });
  } else if (r < chance + foulChance) {
    foul(state, p, h, false);
  } else {
    // Missed it, and lunged: a step behind for a moment.
    p.act.whiff = true;
    emit(state, 'whiff', { id: p.id });
  }
}

/**
 * Can this shot go in, and how likely. This is the whole shooting model, and
 * it is deliberately readable: a number for distance, multiplied by the
 * shooter, by the release, by how close a hand is, plus the ball movement that
 * got him the look.
 */
export function shotChance(state, p, timing) {
  const d = distToRim(p.x, p.z);
  const three = beyondArc(p.x, p.z);
  let base;
  if (d < 2.2) base = 0.66;
  else if (d < 4.5) base = 0.52 - (d - 2.2) * 0.02;
  else if (!three) base = 0.47 - (d - 4.5) * 0.02;
  else if (d < 8.2) base = 0.34 - (d - 6.75) * 0.03;
  else base = Math.max(0.04, 0.3 - (d - 8.2) * 0.07);

  const skill = three ? p.r.three : p.r.shoot;
  let chance = base * (0.65 + 0.5 * skill);

  // Release timing: perfect is a bonus, late or early costs a lot.
  if (timing !== null && timing !== undefined) {
    const off = Math.abs(timing);
    if (off < 0.035) chance *= 1.32;
    else if (off < 0.08) chance *= 1.12;
    else if (off < 0.14) chance *= 0.85;
    else chance *= 0.5;
  }

  const c = contest(state, p);
  chance *= c.factor;
  if (p.act?.moving) chance *= 0.86;
  chance += Math.min(4, state.flow.team === p.team ? state.flow.count : 0) * 0.035;
  chance *= p.team === state.humanTeam ? HUMAN_SHOT[state.tier] : TIERS[state.tier].shot;
  return { chance: Math.max(0.02, Math.min(0.96, chance)), contest: c, three, d };
}

/** How much the nearest defender is bothering the shot. */
export function contest(state, p) {
  let near = null;
  let nd = Infinity;
  for (const q of state.players) {
    if (q.team === p.team) continue;
    // Only a defender between the shooter and the ring, or alongside, counts.
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    const toRim = distToRim(p.x, p.z) || 1;
    const along = ((q.x - p.x) * -p.x + (q.z - p.z) * -p.z) / (toRim * (d || 1));
    const eff = along > -0.3 ? d : d * 1.8;
    if (eff < nd) {
      nd = eff;
      near = q;
    }
  }
  const up = near && near.act?.kind === 'jump' && near.y > 0.15;
  let factor = 1;
  if (nd < 0.9) factor = up ? 0.42 : 0.62;
  else if (nd < 1.4) factor = up ? 0.6 : 0.76;
  else if (nd < 2.1) factor = 0.88;
  return { factor, dist: nd, by: near ? near.id : -1, up };
}

function releaseJumper(state, p) {
  const a = p.act;
  a.released = true;
  const timing = a.human ? a.t - JUMPER_APEX : (a.releaseAt - JUMPER_APEX);
  const sc = shotChance(state, p, timing);
  // A perfect release with nobody in his face is the shooter's reward for
  // getting the timing: it goes. Everybody else rolls.
  const green = Math.abs(timing) < 0.035 && sc.contest.factor >= 0.88;
  const make = green || state.rng() < sc.chance;
  const pts = sc.three ? 2 : 1;
  const hand = handPoint(p, 'shot');
  // A make lands inside 6 cm of centre; a miss somewhere on the iron.
  const miss = make ? state.rng() * 0.05 : 0.17 + state.rng() * 0.16;
  const dir = make ? state.rng() * Math.PI * 2 : pickMissDir(state.rng);
  const target = aimPoint({ x: hand.x, z: hand.z }, miss, dir);
  const angle = (50 + state.rng.range(-2, 3)) * Math.PI / 180;
  const v = launch(hand, target, angle) || launchTimed(hand, target, 1);
  releaseBall(state, p, hand, v, {
    kind: 'jumper', pts, make, chance: sc.chance, timing, green, contest: sc.contest, from: { x: p.x, z: p.z },
  });
  emit(state, 'release', { id: p.id, timing, green, chance: sc.chance, human: a.human, pts });
  // A hand right in his face at the release is a foul, sometimes.
  maybeShootingFoul(state, p, sc.contest, pts, 0.42);
}

/** Misses go long, short and off the sides, roughly as often as real ones. */
function pickMissDir(rng) {
  const r = rng();
  if (r < 0.38) return 0; // long, off the back iron
  if (r < 0.72) return Math.PI; // short, front iron
  return (rng() < 0.5 ? 1 : -1) * Math.PI * 0.5 + rng.range(-0.4, 0.4);
}

function releaseLayup(state, p) {
  const a = p.act;
  a.released = true;
  const c = contest(state, p);
  let chance = (0.58 + 0.36 * p.r.finish) * c.factor;
  chance += Math.min(4, state.flow.team === p.team ? state.flow.count : 0) * 0.03;
  chance *= p.team === state.humanTeam ? HUMAN_SHOT[state.tier] : TIERS[state.tier].shot;
  const make = state.rng() < Math.min(0.95, chance);
  const hand = handPoint(p, 'layup');
  const miss = make ? state.rng() * 0.04 : 0.17 + state.rng() * 0.12;
  const target = aimPoint({ x: hand.x, z: hand.z }, miss, make ? 0 : pickMissDir(state.rng));
  // Soft and high: a finger roll, not a jumper.
  const v = launchTimed(hand, target, 0.5 + Math.hypot(hand.x - target.x, hand.z - target.z) * 0.12);
  releaseBall(state, p, hand, v, { kind: 'layup', pts: 1, make, chance, from: { x: p.x, z: p.z }, contest: c });
  emit(state, 'release', { id: p.id, kind: 'layup', chance });
  maybeShootingFoul(state, p, c, 1, 0.3);
}

function maybeShootingFoul(state, p, c, pts, rate) {
  if (c.by < 0 || c.dist > 0.75) return;
  const d = state.players[c.by];
  if (!d.act || d.act.kind !== 'jump') return;
  if (state.rng() < rate * (c.dist < 0.5 ? 1 : 0.5)) {
    state.ball.shot.fouled = { by: d.id, pts };
    emit(state, 'contact', { id: d.id, on: p.id });
  }
}

/** The slam itself. Blocked here or nowhere. */
function slam(state, p) {
  const a = p.act;
  a.released = true;
  const ball = state.ball;
  // Anybody up there with him?
  let blocker = null;
  for (const q of state.players) {
    if (q.team === p.team) continue;
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    const hand = q.reach + q.y;
    if (d < 1.15 && q.y > 0.2 && hand > COURT.RIM_Y + 0.05) {
      blocker = q;
      break;
    }
  }
  if (blocker) {
    const tier = TIERS[state.tier];
    const skill = blocker.team === state.humanTeam ? 0.55 : 0.3 * tier.block;
    const chance = skill * blocker.r.block * (1.25 - 0.45 * p.r.dunk) * (a.alley ? 1.3 : 1);
    const r = state.rng();
    if (r < chance) {
      // Rejected.
      ball.holder = -1;
      ball.mode = 'free';
      ball.shot = null;
      const ox = p.x - blocker.x;
      const oz = p.z - blocker.z;
      const ol = Math.hypot(ox, oz) || 1;
      ball.pos = { x: RIM.x + (p.x - RIM.x) * 0.6, y: COURT.RIM_Y + 0.2, z: RIM.z + (p.z - RIM.z) * 0.6 + 0.2 };
      ball.vel = { x: (ox / ol) * 5 + state.rng.range(-1.5, 1.5), y: 1.5, z: Math.abs(oz / ol) * 5 + 1.5 };
      ball.lastTouch = blocker.id;
      ball.lastTeam = blocker.team;
      a.blocked = true;
      state.stats[blocker.team].blocks++;
      emit(state, 'block', { id: blocker.id, on: p.id, dunk: true });
      state.stats[p.team].fga++;
      return;
    }
    if (r < chance + 0.25) {
      // Got all of him and none of the ball: and one, probably.
      a.fouledBy = blocker.id;
      emit(state, 'contact', { id: blocker.id, on: p.id });
    }
  }
  ball.holder = -1;
  ball.pos = { x: RIM.x, y: COURT.RIM_Y + 0.2, z: RIM.z };
  ball.vel = { x: 0, y: -5.5, z: 0 };
  ball.mode = 'shot';
  ball.lastTouch = p.id;
  ball.lastTeam = p.team;
  ball.touchedRim = false;
  ball.touchedBoard = false;
  ball.shot = {
    by: p.id, team: p.team, kind: 'dunk', pts: 1, make: true, style: a.style, alley: a.alley,
    from: { ...a.from }, fouled: a.fouledBy !== undefined ? { by: a.fouledBy, pts: 1 } : null,
    assist: assistFor(state, p),
  };
  state.stats[p.team].fga++;
  emit(state, 'slam', { id: p.id, style: a.style, alley: a.alley });
}

function releaseBall(state, p, from, v, shot) {
  const ball = state.ball;
  ball.holder = -1;
  ball.mode = 'shot';
  ball.pos = { ...from };
  ball.vel = { x: v.x, y: v.y, z: v.z };
  ball.lastTouch = p.id;
  ball.lastTeam = p.team;
  ball.touchedRim = false;
  ball.touchedBoard = false;
  ball.rimHit = 0;
  ball.shot = { by: p.id, team: p.team, ...shot, assist: assistFor(state, p), released: state.time };
  state.stats[p.team].fga++;
  if (shot.pts === 2) state.stats[p.team].twoA++;
}

/** The pass that set this shot up, if it was recent enough to count. */
function assistFor(state, p) {
  const f = state.flow;
  if (f.passer >= 0 && f.receiver === p.id && state.time - f.lastCatch < 4.5) return f.passer;
  return -1;
}

// --- Passes ---------------------------------------------------------------------------------------

const PASS_SPEED = 12.5;

function startPass(state, p, q, lob) {
  if (!q) return;
  p.act = { kind: 'pass', t: 0, locked: false, released: false, to: q.id, lob, dur: 0.32 };
  p.cooldown = 0.35;
  // Alley-oop: a lob to a man near enough the ring to go and get it.
  if (lob) {
    const plan = alleyPlan(state, p, q);
    if (plan) {
      p.act.alley = plan;
      q.ai.mode = 'alley';
      q.ai.plan = plan;
      q.ai.modeT = 0;
    }
  }
  p.face = Math.atan2(q.x - p.x, q.z - p.z);
  emit(state, 'passwind', { id: p.id, to: q.id, lob, alley: Boolean(p.act.alley) });
}

/**
 * Is an alley-oop on, and how. The receiver needs to get to a take-off spot
 * before the ball gets to the ring, and the ball needs a flight long enough to
 * let him - so the lob is timed to him, not the other way round.
 */
export function alleyPlan(state, p, q) {
  if (q.r.dunk < 0.4) return null;
  const d = distToRim(q.x, q.z);
  if (d > 7.0) return null;
  const ux = q.x / (d || 1);
  const uz = Math.max(0.2, q.z / (d || 1));
  const ul = Math.hypot(ux, uz);
  const dir = { x: ux / ul, z: uz / ul };
  const takeoff = { x: dir.x * 1.9, z: Math.max(0.3, dir.z * 1.9) };
  const run = Math.hypot(takeoff.x - q.x, takeoff.z - q.z);
  const runTime = run / (SPRINT * (0.85 + 0.15 * q.r.speed));
  const flight = 0.48;
  const from = handPoint(p, 'pass');
  const catchAt = { x: dir.x * 0.42, y: COURT.RIM_Y + 0.4, z: dir.z * 0.42 };
  const ballTime = Math.max(0.85, Math.min(1.5, Math.hypot(catchAt.x - from.x, catchAt.z - from.z) / 8 + 0.45, runTime + flight + 0.1));
  if (runTime + flight > ballTime + 0.35) return null;
  return { receiver: q.id, takeoff, catchAt, ballTime, flight, launchAt: state.time + 0.1, arriveAt: state.time + 0.1 + ballTime };
}

function releasePass(state, p) {
  const a = p.act;
  a.released = true;
  const q = state.players[a.to];
  const ball = state.ball;
  const from = handPoint(p, 'pass');
  let v;
  let lead;
  if (a.alley) {
    const plan = a.alley;
    plan.arriveAt = state.time + plan.ballTime;
    v = launchTimed(from, plan.catchAt, plan.ballTime);
    lead = plan.catchAt;
  } else {
    // Lead him: aim where he will be when it gets there.
    let tx = q.x;
    let tz = q.z;
    let t = 0.3;
    for (let i = 0; i < 3; i++) {
      t = Math.hypot(tx - from.x, tz - from.z) / (a.lob ? 8 : PASS_SPEED) + (a.lob ? 0.35 : 0.05);
      tx = q.x + q.vx * t * 0.85;
      tz = q.z + q.vz * t * 0.85;
    }
    tx = Math.max(-COURT.HALF_W + 0.4, Math.min(COURT.HALF_W - 0.4, tx));
    tz = Math.max(COURT.END_Z + 0.4, Math.min(COURT.TOP_Z - 0.4, tz));
    lead = { x: tx, y: a.lob ? 2.2 : 1.25, z: tz };
    v = launchTimed(from, lead, Math.max(0.16, t));
  }
  ball.holder = -1;
  ball.mode = 'pass';
  ball.pos = from;
  ball.vel = { x: v.x, y: v.y, z: v.z };
  ball.lastTouch = p.id;
  ball.lastTeam = p.team;
  ball.pass = { from: p.id, to: q.id, lob: a.lob, alley: a.alley || null, t: state.time, lead };
  ball.tried = new Set();
  state.flow.passer = p.id;
  state.flow.passT = state.time;
  // A pass is a reason to move: the passer cuts if there is room to.
  if (p.id !== state.controlled || p.team !== state.humanTeam) {
    p.ai.mode = state.rng() < 0.55 ? 'cut' : 'space';
    p.ai.modeT = 0;
  }
  q.ai.receiving = true;
  emit(state, 'pass', { id: p.id, to: q.id, lob: a.lob, alley: Boolean(a.alley) });
}

/** Where the ball is in somebody's hands, as far as the simulation needs to know. */
export function handPoint(p, why) {
  const fx = Math.sin(p.face);
  const fz = Math.cos(p.face);
  if (why === 'shot') return { x: p.x + fx * 0.15, y: p.y + p.height * 1.18, z: p.z + fz * 0.15 };
  if (why === 'layup') return { x: p.x + fx * 0.3, y: p.y + p.reach - 0.05, z: p.z + fz * 0.3 };
  if (why === 'pass') return { x: p.x + fx * 0.45, y: p.y + p.height * 0.68, z: p.z + fz * 0.45 };
  if (why === 'dunk') return { x: p.x + fx * 0.4, y: p.y + p.reach + 0.05, z: p.z + fz * 0.4 };
  return { x: p.x + fx * 0.38 + fz * 0.12, y: p.y + 0.95, z: p.z + fz * 0.38 - fx * 0.12 };
}

// --- Actions over time -------------------------------------------------------------------------------

function stepAction(state, p, intent) {
  const a = p.act;
  if (!a) {
    // Landing from anything that left him in the air.
    if (p.y > 0) {
      p.vy -= GRAVITY * DT;
      p.y = Math.max(0, p.y + p.vy * DT);
      if (p.y === 0) p.vy = 0;
    }
    return;
  }
  a.t += DT;

  if (a.kind === 'shoot' || a.kind === 'ft') {
    // Up and down on a fixed curve: off the floor at 0.12, the top at the apex.
    const up = a.kind === 'ft' ? 0 : a.jump;
    const t = a.t - 0.12;
    const air = (JUMPER_APEX - 0.12) * 2;
    p.y = t > 0 && t < air ? up * Math.sin((Math.PI * t) / air) : 0;
    if (!a.released) {
      const auto = a.human ? (a.t >= JUMPER_AUTO || intent.release) : a.t >= a.releaseAt;
      if (auto && state.ball.holder === p.id) {
        if (a.kind === 'ft') releaseFreeThrow(state, p);
        else releaseJumper(state, p);
      }
    }
    if (a.t >= a.dur) p.act = null;
    return;
  }

  if (a.kind === 'layup') {
    const T = 0.62;
    const k = Math.min(1, a.t / T);
    const e = 1 - (1 - k) * (1 - k);
    p.x = a.from.x + (a.to.x - a.from.x) * e;
    p.z = a.from.z + (a.to.z - a.from.z) * e;
    p.vx = 0;
    p.vz = 0;
    const air = 0.78;
    const t = a.t - 0.1;
    p.y = t > 0 && t < air ? a.jump * Math.sin((Math.PI * t) / air) : 0;
    if (!a.released && a.t >= 0.48 && state.ball.holder === p.id) releaseLayup(state, p);
    if (a.t >= a.dur) p.act = null;
    return;
  }

  if (a.kind === 'dunk') {
    stepDunk(state, p, a);
    return;
  }

  if (a.kind === 'jump') {
    const air = a.dur - 0.1;
    const t = a.t - 0.08;
    p.y = t > 0 && t < air ? a.jump * Math.sin((Math.PI * t) / air) : 0;
    if (a.t >= a.dur) p.act = null;
    return;
  }

  if (a.kind === 'pass') {
    if (!a.released && a.t >= 0.1 && state.ball.holder === p.id) releasePass(state, p);
    if (a.t >= a.dur) p.act = null;
    return;
  }

  if (a.kind === 'steal' || a.kind === 'stumble' || a.kind === 'celebrate' || a.kind === 'catch') {
    if (a.t >= a.dur) p.act = null;
  }
}

function stepDunk(state, p, a) {
  const g = a.gather;
  if (a.t < g) {
    // The gather: last step, planting.
    p.vx *= 0.85;
    p.vz *= 0.85;
    p.x += p.vx * DT;
    p.z += p.vz * DT;
    if (a.t + DT >= g) {
      a.from = { x: p.x, z: p.z };
      emit(state, 'takeoff', { id: p.id, style: a.style });
    }
    return;
  }
  const t = a.t - g;
  if (t < a.flight) {
    const k = t / a.flight;
    const e = 1 - (1 - k) ** 2;
    p.x = a.from.x + (a.slam.x - a.from.x) * e;
    p.z = a.from.z + (a.slam.z - a.from.z) * e;
    p.vx = 0;
    p.vz = 0;
    p.y = a.top * (1 - (1 - k) ** 2);
    if (a.style === 'three60') a.spin = k * Math.PI * 2;
    return;
  }
  if (!a.released) {
    if (state.ball.holder === p.id) slam(state, p);
    else a.released = true;
  }
  const h = t - a.flight;
  if (h < a.hang && !a.blocked) {
    // Hanging on the ring.
    p.y = a.top - 0.12 * Math.min(1, h / 0.12);
    return;
  }
  // The drop.
  if (!a.dropping) {
    a.dropping = true;
    p.vy = a.blocked ? -0.5 : 0;
    // Let go and swing back off the ring a little.
    const d = Math.hypot(p.x, p.z) || 1;
    p.vx = (p.x / d) * 1.2;
    p.vz = (p.z / d) * 1.2;
  }
  p.vy -= GRAVITY * DT;
  p.y = Math.max(0, p.y + p.vy * DT);
  p.x += p.vx * DT;
  p.z += p.vz * DT;
  p.vx *= 0.96;
  p.vz *= 0.96;
  if (p.y === 0 && !a.landed) {
    a.landed = true;
    emit(state, 'land', { id: p.id, hard: true });
    a.dur = a.t + 0.35;
  }
  if (a.t >= a.dur) p.act = null;
}

// --- Movement ------------------------------------------------------------------------------------------

/** Steering towards a point, slowing to arrive. */
export function seek(p, t, urgency = 1) {
  const dx = t.x - p.x;
  const dz = t.z - p.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) return { mx: 0, mz: 0 };
  const s = Math.min(1, d / 1.2) * urgency;
  return { mx: (dx / d) * s, mz: (dz / d) * s, sprint: urgency > 0.95 && d > 3 };
}

function movePlayer(state, p, intent) {
  const a = p.act;
  if (a && (a.kind === 'layup' || a.kind === 'dunk')) return;
  const airborne = p.y > 0.02;
  let mx = intent.mx || 0;
  let mz = intent.mz || 0;
  const len = Math.hypot(mx, mz);
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  let top = (intent.sprint ? SPRINT : RUN) * (0.88 + 0.16 * p.r.speed);
  if (state.ball.holder === p.id) top *= 0.93;
  if (intent.stance && !intent.sprint) top *= 0.82;
  if (a) {
    if (a.kind === 'shoot' || a.kind === 'ft' || a.kind === 'jump') top = 0;
    else if (a.kind === 'pass') top *= 0.6;
    else if (a.kind === 'steal') top *= a.whiff ? 0.25 : 0.7;
    else if (a.kind === 'stumble') top *= 0.2;
  }
  p.sprint = Boolean(intent.sprint) && len > 0.2;
  p.stance = Boolean(intent.stance);
  const wantX = mx * top;
  const wantZ = mz * top;
  // Hard to change direction in the air, easy on the floor; harder to stop at
  // a sprint than at a jog.
  const accel = airborne ? 2 : (Math.hypot(wantX, wantZ) > Math.hypot(p.vx, p.vz) ? 22 : 30);
  const dx = wantX - p.vx;
  const dz = wantZ - p.vz;
  const dl = Math.hypot(dx, dz);
  const maxDv = accel * DT;
  if (dl > maxDv) {
    p.vx += (dx / dl) * maxDv;
    p.vz += (dz / dl) * maxDv;
  } else {
    p.vx = wantX;
    p.vz = wantZ;
  }
  // A sharp cut at speed squeaks.
  if (dl > 6 && Math.hypot(p.vx, p.vz) > 3 && state.rng() < 0.08) emit(state, 'squeak', { id: p.id });

  p.x += p.vx * DT;
  p.z += p.vz * DT;
  p.x = Math.max(-9.2, Math.min(9.2, p.x));
  p.z = Math.max(-2.6, Math.min(12.5, p.z));

  // Facing: where he is told to look, else where he is going.
  let want = intent.face;
  if (want === undefined) {
    const sp = Math.hypot(p.vx, p.vz);
    if (sp > 0.6) want = Math.atan2(p.vx, p.vz);
  }
  if (want !== undefined && !(a && a.locked)) {
    let diff = want - p.face;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const rate = 11 * DT;
    p.face += Math.max(-rate, Math.min(rate, diff));
  }
}

/** Bodies do not overlap. This is also what makes a screen a screen. */
function separate(state) {
  const ps = state.players;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i];
      const b = ps[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const min = BODY_R * 2;
      if (d >= min || d < 1e-6) continue;
      const nx = dx / d;
      const nz = dz / d;
      const push = (min - d);
      // Somebody standing set is harder to move than somebody running into him.
      const wa = scripted(a) ? 0 : (a.ai.mode === 'screen' && a.ai.set ? 0.15 : 0.5);
      const wb = scripted(b) ? 0 : (b.ai.mode === 'screen' && b.ai.set ? 0.15 : 0.5);
      const sum = wa + wb || 1;
      a.x -= nx * push * (wa / sum);
      a.z -= nz * push * (wa / sum);
      b.x += nx * push * (wb / sum);
      b.z += nz * push * (wb / sum);
      // Kill the closing speed.
      const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (rv < 0) {
        a.vx += nx * rv * (wa / sum);
        a.vz += nz * rv * (wa / sum);
        b.vx -= nx * rv * (wb / sum);
        b.vz -= nz * rv * (wb / sum);
      }
      if (a.team !== b.team) {
        a.blockedFor += DT;
        b.blockedFor += DT;
      }
    }
  }
  for (const p of ps) p.blockedFor *= 0.96;
}

function scripted(p) {
  return p.act && (p.act.kind === 'dunk' || p.act.kind === 'layup');
}

// --- The ball ----------------------------------------------------------------------------------------------

function giveBall(state, p, how) {
  const ball = state.ball;
  ball.holder = p.id;
  ball.mode = 'held';
  ball.shot = null;
  ball.pass = null;
  ball.lastTouch = p.id;
  ball.lastTeam = p.team;
  ball.stolenBy = undefined;
  ball.pos = handPoint(p, 'hold');
  ball.vel = { x: 0, y: 0, z: 0 };
  p.ai.holdT = 0;
  for (const q of state.players) q.ai.receiving = false;
  emit(state, 'possess', { id: p.id, how });
}

function holdBall(state) {
  const ball = state.ball;
  if (ball.holder < 0) return;
  const p = state.players[ball.holder];
  const why = p.act?.kind === 'shoot' || p.act?.kind === 'ft' ? 'shot'
    : p.act?.kind === 'dunk' ? 'dunk'
      : p.act?.kind === 'layup' ? 'layup' : 'hold';
  ball.pos = handPoint(p, why);
  ball.vel = { x: p.vx, y: 0, z: p.vz };
}

function tickBall(state) {
  const ball = state.ball;
  if (ball.holder >= 0) {
    holdBall(state);
    return;
  }
  if (ball.inNet > 0) ball.inNet--;
  const hits = stepBall(ball, DT);
  for (const h of hits) {
    if (h === 'rim') {
      emit(state, 'rim', { power: ball.rimHit, pos: { ...ball.pos } });
      ball.rimHit = 0;
      if (ball.shot && state.phase === 'live') {
        // Twelve again: the ring was hit, whoever gets it.
        state.shotClock = SHOT_CLOCK;
        ball.shot.rim = true;
      }
    } else if (h === 'board') {
      emit(state, 'board', { pos: { ...ball.pos } });
    } else if (h === 'net') {
      emit(state, 'net', { speed: Math.hypot(ball.vel.x, ball.vel.y, ball.vel.z) });
    } else if (h === 'floor') {
      emit(state, 'bounce', { power: Math.abs(ball.vel.y) });
      if (ball.mode === 'shot' || ball.mode === 'pass') {
        if (ball.mode === 'shot' && !ball.shot?.rim && !ball.touchedBoard && state.phase === 'live') {
          emit(state, 'airball', { id: ball.shot?.by });
          ball.airball = true;
        }
        ball.mode = 'free';
      }
    } else if (h === 'through') {
      if (state.phase === 'live' || state.phase === 'ft') scored(state);
      else emit(state, 'swish', { late: true });
    } else if (h === 'out' && state.phase === 'live') {
      outOfBounds(state, ball.lastTeam);
      return;
    }
  }
  // A ball rolling around off the court is out even if it never bounced there.
  if (state.phase === 'live' && ball.pos.y < 1.2 && !inBounds(ball.pos.x, ball.pos.z, -0.05) && ball.mode !== 'shot') {
    outOfBounds(state, ball.lastTeam);
    return;
  }
  if (state.phase === 'live' || state.phase === 'ft') catches(state);
}

/**
 * Who gets the ball. Somebody close enough, at a height he can reach: the man
 * it was thrown to first, then anybody - a defender in the lane included, which
 * is what an interception is.
 */
function catches(state) {
  const ball = state.ball;
  const b = ball.pos;
  const order = state.players.slice();
  // Shuffled, so a rebound is not always won by player zero.
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(state.rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (ball.pass) {
    const to = state.players[ball.pass.to];
    order.splice(order.indexOf(to), 1);
    order.unshift(to);
  }
  for (const p of order) {
    if (p.act && (p.act.kind === 'dunk' && p.act.released)) continue;
    if (p.act && p.act.kind === 'shoot') continue;
    if (ball.mode === 'shot' && ball.shot && ball.shot.by === p.id && state.time - ball.shot.released < 0.6) continue;
    if (ball.mode === 'pass' && ball.pass && ball.pass.from === p.id && state.time - ball.pass.t < 0.5) continue;
    if (ball.mode === 'shot' && b.y > COURT.RIM_Y - 0.4 && Math.hypot(b.x, b.z) < 0.6) continue; // goaltending: hands off
    const dx = b.x - p.x;
    const dz = b.z - p.z;
    const dh = Math.hypot(dx, dz);
    const top = p.y + p.reach + 0.15;
    // The man it was thrown to reaches for it; anybody else has to be in the way.
    const reachH = ball.mode === 'pass' ? (ball.pass && ball.pass.to === p.id ? 0.85 : 0.5) : 0.7;
    if (dh > reachH || b.y > top || b.y < 0.15) continue;

    // An alley-oop caught in the air is a dunk on the spot.
    if (ball.pass?.alley && p.id === ball.pass.to && p.act?.kind === 'dunk' && p.act.alley) {
      ball.holder = p.id;
      ball.mode = 'held';
      ball.pass = null;
      state.flow.receiver = p.id;
      state.flow.lastCatch = state.time;
      emit(state, 'alleycatch', { id: p.id });
      // Straight to the slam.
      p.act.t = p.act.gather + p.act.flight - DT;
      return;
    }

    if (ball.mode === 'pass' && p.team !== ball.lastTeam) {
      // A defender in the lane: maybe.
      if (ball.tried.has(p.id)) continue;
      ball.tried.add(p.id);
      const skill = p.team === state.humanTeam ? 0.75 : 0.25 + 0.45 * TIERS[state.tier].read;
      if (state.rng() > skill * (0.6 + 0.4 * p.r.steal)) {
        emit(state, 'deflect', { id: p.id });
        ball.vel.x *= 0.7;
        ball.vel.z *= 0.7;
        continue;
      }
    }
    gain(state, p);
    return;
  }
}

/** Somebody has the ball. What that means depends on who had it last. */
function gain(state, p) {
  const ball = state.ball;
  const was = ball.mode;
  const pass = ball.pass;
  const shot = ball.shot;
  const team = p.team;
  giveBall(state, p, was);

  if (team !== state.possession) {
    // Change of possession: a defensive rebound, a steal, a block picked up, an
    // interception. All of them mean the ball has to go out behind the arc.
    const how = was === 'pass' ? 'intercept' : (shot || ball.airball ? 'rebound' : 'steal');
    state.possession = team;
    state.needsClear = !beyondArc(p.x, p.z);
    state.shotClock = SHOT_CLOCK;
    state.flow = { team, count: 0, lastCatch: state.time, passer: -1, passT: -99 };
    if (how === 'rebound') state.stats[team].reb++;
    if (how === 'intercept') {
      state.stats[team].steals++;
      state.stats[1 - team].tov++;
    }
    if (how === 'steal') {
      if (ball.stolenBy !== undefined) state.stats[team].steals++;
      state.stats[1 - team].tov++;
    }
    emit(state, 'turnover', { team, how, id: p.id });
    for (const q of state.players) {
      q.ai.mode = q.team === team ? 'space' : 'guard';
      q.ai.modeT = 0;
    }
    if (state.humanTeam >= 0 && team !== state.humanTeam) {
      state.controlled = nearestOf(state, state.humanTeam, p).id;
    }
  } else if (was === 'pass' && pass && pass.from !== p.id) {
    // A completed pass. Quick ones keep the flow going.
    const f = state.flow;
    const quick = state.time - f.lastCatch < FLOW_GAP;
    f.count = quick ? f.count + 1 : 1;
    f.lastCatch = state.time;
    f.receiver = p.id;
    f.passer = pass.from;
    state.stats[team].bestFlow = Math.max(state.stats[team].bestFlow, f.count);
    p.act = { kind: 'catch', t: 0, dur: 0.22, locked: false };
    emit(state, 'catch', { id: p.id, from: pass.from, flow: f.count });
  } else if (shot || was === 'free') {
    // Offensive rebound or a loose ball back: play on.
    if (shot) state.stats[team].reb++;
    state.flow.lastCatch = state.time;
    state.flow.passer = -1;
    emit(state, 'oreb', { id: p.id });
  }
  ball.airball = false;
  if (state.needsClear && beyondArc(p.x, p.z)) state.needsClear = false;
}

// --- Scoring and the rules ------------------------------------------------------------------------------

function scored(state) {
  const ball = state.ball;
  const shot = ball.shot;
  const team = shot ? shot.team : ball.lastTeam;
  if (state.phase === 'ft') {
    state.ft.made++;
    state.lastFtMade = true;
    addPoints(state, team, 1);
    state.stats[team].ftM++;
    emit(state, 'score', { team, pts: 1, kind: 'ft', by: shot?.by ?? -1 });
    return;
  }
  const pts = shot ? shot.pts : 1;
  addPoints(state, team, pts);
  const st = state.stats[team];
  st.fgm++;
  if (pts === 2) st.twoM++;
  if (shot?.kind === 'dunk') st.dunks++;
  const assist = shot?.assist ?? -1;
  if (assist >= 0) st.assists++;
  emit(state, 'score', {
    team, pts, kind: shot?.kind || 'tip', by: shot?.by ?? ball.lastTouch, assist,
    style: shot?.style, alley: shot?.alley, flow: state.flow.team === team ? state.flow.count : 0,
    green: shot?.green,
  });
  ball.shot = null;
  ball.mode = 'free';

  const by = shot ? state.players[shot.by] : null;
  if (by) {
    by.ai.celebrate = true;
  }
  if (gameWon(state)) return;

  if (shot?.fouled) {
    // And one.
    const fouler = state.players[shot.fouled.by];
    state.fouls[fouler.team]++;
    emit(state, 'foul', { id: fouler.id, on: by.id, andOne: true, team: fouler.team, count: state.fouls[fouler.team] });
    say(state, 'AND ONE', `${by.name}`, team);
    toDead(state, 1.4, () => setupFreeThrows(state, by, 1, state.fouls[fouler.team] >= 10 ? 'keep' : 'normal'));
    return;
  }
  const label = shot?.kind === 'dunk' ? (shot.alley ? 'ALLEY-OOP' : 'SLAM DUNK') : (pts === 2 ? '2 POINTS' : '');
  if (label) say(state, label, by ? by.name : '', team, 1.5);
  state.phase = 'scored';
  state.phaseT = 0;
  state.deadFor = shot?.kind === 'dunk' ? 1.9 : 1.15;
  state.next = () => setupAfterScore(state, 1 - team);
}

function addPoints(state, team, pts) {
  state.score[team] += pts;
  state.stats[team].pts += pts;
  if (state.overtime) state.otPoints[team] += pts;
}

/** First to the target wins on the spot; in overtime, first to two. */
function gameWon(state) {
  for (const t of [0, 1]) {
    const won = state.overtime ? state.otPoints[t] >= 2 : state.score[t] >= state.target;
    if (won) {
      endGame(state, t);
      return true;
    }
  }
  return false;
}

function endGame(state, winner) {
  state.winner = winner;
  state.phase = 'over';
  state.phaseT = 0;
  say(state, 'GAME', `${state.teams[winner].city} WIN`, winner, 99);
  emit(state, 'over', { winner });
  for (const p of state.players) {
    if (p.team === winner) p.ai.celebrate = true;
    p.act = p.act && p.act.locked ? p.act : null;
  }
}

function outOfBounds(state, lastTeam) {
  emit(state, 'whistle', { why: 'out' });
  state.stats[lastTeam].tov++;
  say(state, 'OUT OF BOUNDS', `${state.teams[1 - lastTeam].city} BALL`, 1 - lastTeam);
  toDead(state, 1.2, () => setupCheck(state, 1 - lastTeam));
}

function toDead(state, time, next) {
  state.phase = 'dead';
  state.phaseT = 0;
  state.deadFor = time;
  state.next = next;
  const ball = state.ball;
  if (ball.holder >= 0) {
    // The ball is dead: whoever had it drops it.
    ball.holder = -1;
    ball.vel = { x: 0, y: 0, z: 0 };
  }
  ball.mode = 'free';
  ball.shot = null;
  ball.pass = null;
}

/**
 * A foul. Seven, eight and nine are two shots; ten and over two shots and the
 * ball. A shooting foul is at least as many shots as the shot was worth.
 */
function foul(state, by, on, shooting, pts = 1) {
  const team = by.team;
  state.fouls[team]++;
  const n = state.fouls[team];
  emit(state, 'foul', { id: by.id, on: on.id, team, count: n, shooting });
  emit(state, 'whistle', { why: 'foul' });
  let shots = 0;
  let then = 'normal';
  if (shooting) shots = pts;
  if (n >= 7) shots = 2;
  if (n >= 10) then = 'keep';
  if (shots > 0) {
    say(state, 'FOUL', `${shots} FREE THROW${shots > 1 ? 'S' : ''}`, on.team);
    toDead(state, 1.4, () => setupFreeThrows(state, on, shots, then));
  } else {
    say(state, 'FOUL', `TEAM FOUL ${n}`, on.team);
    toDead(state, 1.2, () => setupCheck(state, on.team));
  }
}

function rules(state) {
  const ball = state.ball;

  // The clock runs only while the ball is live.
  if (!state.overtime && state.clock > 0) {
    state.clock = Math.max(0, state.clock - DT);
    if (state.clock === 0) {
      state.buzzer = true;
      emit(state, 'buzzer', {});
    }
  }
  if (state.buzzer && !state.overtime) {
    // A shot in the air at the buzzer still counts. Anything else: it is over.
    if (ball.mode === 'shot' && ball.shot) return;
    state.buzzer = false;
    if (state.score[0] !== state.score[1]) {
      endGame(state, state.score[0] > state.score[1] ? 0 : 1);
    } else {
      state.overtime = true;
      state.otPoints = [0, 0];
      say(state, 'OVERTIME', 'FIRST TO 2 WINS', -1, 2.4);
      emit(state, 'overtime', {});
      const team = state.rng() < 0.5 ? 0 : 1;
      toDead(state, 2.2, () => setupCheck(state, team));
    }
    return;
  }

  // Shot clock.
  const inAir = ball.mode === 'shot' && ball.shot && !ball.shot.rim;
  if (!inAir) state.shotClock = Math.max(0, state.shotClock - DT);
  if (state.shotClock <= 0 && !(ball.mode === 'shot')) {
    const team = state.possession;
    emit(state, 'shotclock', { team });
    state.stats[team].tov++;
    say(state, 'SHOT CLOCK', `${state.teams[1 - team].city} BALL`, 1 - team);
    toDead(state, 1.3, () => setupCheck(state, 1 - team));
    return;
  }

  // The man with the ball stepping out.
  if (ball.holder >= 0) {
    const h = state.players[ball.holder];
    if (!inBounds(h.x, h.z, -0.05) && h.y < 0.05) {
      outOfBounds(state, h.team);
      return;
    }
    if (state.needsClear && beyondArc(h.x, h.z)) {
      state.needsClear = false;
      emit(state, 'cleared', { team: h.team });
    }
    h.ai.holdT += DT;
  }

  // A loose ball after a shot that missed everything is also the end of it.
  if (ball.mode === 'free' && ball.shot && !ball.shot.rim && ball.airball) {
    ball.shot = null;
  }
}

// --- Free throws --------------------------------------------------------------------------------------------

function runFreeThrow(state, input, press) {
  const ft = state.ft;
  const shooter = state.players[ft.shooter];
  for (const p of state.players) {
    stepAction(state, p, p === shooter ? { release: press.shootUp } : {});
    if (p !== shooter) movePlayer(state, p, { mx: 0, mz: 0, face: Math.atan2(-p.x, -p.z) });
  }
  tickBall(state);
  if (state.phase !== 'ft') return;

  const ball = state.ball;
  if (ball.holder === shooter.id && !shooter.act) {
    const human = state.humanTeam === shooter.team;
    const go = human ? (press.shoot && state.phaseT > 0.5) : state.phaseT > 1.3;
    if (go) {
      shooter.act = {
        kind: 'ft', t: 0, locked: true, released: false, human,
        releaseAt: human ? null : JUMPER_APEX + state.rng.normal() * TIERS[state.tier].release,
        jump: 0, dur: 1.0,
      };
      emit(state, 'gather', { id: shooter.id, kind: 'ft' });
    }
    return;
  }

  // Ball in the air: wait for it to be decided.
  if (ball.mode === 'free' || (ball.mode === 'shot' && ball.pos.y < 1.0 && ball.vel.y < 0)) {
    if (!ft.resolved) {
      ft.resolved = true;
      ft.at = state.phaseT;
    }
  }
  if (ft.resolved && state.phaseT - ft.at > 0.6) nextFreeThrow(state);
}

function releaseFreeThrow(state, p) {
  const a = p.act;
  a.released = true;
  const timing = a.human ? a.t - JUMPER_APEX : a.releaseAt - JUMPER_APEX;
  let chance = 0.55 + 0.35 * p.r.shoot;
  const off = Math.abs(timing);
  if (off < 0.035) chance = Math.max(chance, 0.97);
  else if (off < 0.08) chance *= 1.05;
  else if (off < 0.14) chance *= 0.8;
  else chance *= 0.45;
  chance *= p.team === state.humanTeam ? HUMAN_SHOT[state.tier] : TIERS[state.tier].shot;
  const make = state.rng() < chance;
  const hand = handPoint(p, 'shot');
  const target = aimPoint(hand, make ? state.rng() * 0.05 : 0.18 + state.rng() * 0.1, make ? 0 : pickMissDir(state.rng));
  const v = launch(hand, target, 52 * Math.PI / 180);
  releaseBall(state, p, hand, v, { kind: 'ft', pts: 1, make, timing, green: off < 0.035 });
  state.stats[p.team].fga--; // free throws are not field goal attempts
  state.stats[p.team].ftA++;
  state.ft.left--;
  state.lastFtMade = false;
  emit(state, 'release', { id: p.id, timing, green: off < 0.035, kind: 'ft', human: a.human });
}

function nextFreeThrow(state) {
  const ft = state.ft;
  const shooter = state.players[ft.shooter];
  if (gameWon(state)) return;
  if (ft.left > 0) {
    state.ft.resolved = false;
    state.phaseT = 0;
    giveBall(state, shooter, 'ft');
    shooter.act = null;
    return;
  }
  const lastMade = state.lastFtMade === true;
  state.ft = null;
  if (ft.then === 'keep') {
    toDead(state, 0.6, () => setupCheck(state, shooter.team));
  } else if (lastMade) {
    toDead(state, 0.6, () => setupAfterScore(state, 1 - shooter.team));
  } else {
    // Missed the last one: the ball is live, go and get it.
    state.phase = 'live';
    state.phaseT = 0;
    for (const p of state.players) {
      p.ai.mode = p.team === shooter.team ? 'space' : 'guard';
    }
  }
}

// --- Read-only helpers for the renderer and the HUD -----------------------------------------------------------

/** 0..1 on the release meter, and where the sweet spot is. */
export function meter(state) {
  const p = state.players[state.controlled];
  if (!p || !p.act || (p.act.kind !== 'shoot' && p.act.kind !== 'ft') || !p.act.human) return null;
  return { t: p.act.t, apex: JUMPER_APEX, max: JUMPER_AUTO, released: p.act.released, id: p.id };
}
