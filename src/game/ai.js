/**
 * Everybody who is not you.
 *
 * Three jobs, and every player is doing exactly one of them at any moment:
 *
 *   - With the ball: read the floor every few tenths of a second and pick the
 *     best of shooting, driving, passing or holding it - by expected points, not
 *     by script, so a CPU guard who is left open from two takes it.
 *   - Without it, on offence: be useful. Space the floor, cut when your man
 *     turns his head, set a screen for the ball, roll to the ring after it, and
 *     go and get the lob when it is thrown. This is the half that makes playing
 *     with two team-mates feel like a team rather than two cones.
 *   - On defence: man to man. Stay between your man and the ring, closer the
 *     nearer he is to the ball; help on a drive; contest a shot; switch on a
 *     screen you cannot get through.
 *
 * Your own team-mates run the same code as the CPU's, at the same skill. They are
 * not better because they are on your side, and not worse either.
 */

import { COURT, RIM, beyondArc, distToRim, inBounds } from './court.js';
import { TIERS, seek, openness, shotChance, alleyPlan, nearestOf, teamPlayers } from './sim.js';

/** Where a 3x3 offence likes to stand: behind the arc, and one man in the dunker spot. */
const SPOTS = [
  { x: -6.9, z: 0.6, deep: true },
  { x: 6.9, z: 0.6, deep: true },
  { x: -5.4, z: 4.9, deep: true },
  { x: 5.4, z: 4.9, deep: true },
  { x: 0, z: 7.6, deep: true },
  { x: -2.7, z: 7.1, deep: true },
  { x: 2.7, z: 7.1, deep: true },
  { x: -2.4, z: 0.4, deep: false },
  { x: 2.4, z: 0.4, deep: false },
  { x: -2.6, z: 4.0, deep: false },
  { x: 2.6, z: 4.0, deep: false },
];

export function think(state, p) {
  const ball = state.ball;
  if (state.phase === 'over') return celebrate(state, p);
  if (ball.holder === p.id) return withBall(state, p);
  if (p.team === state.possession && ball.mode !== 'free' && ball.mode !== 'shot') return offBall(state, p);
  if (ball.mode === 'shot' || ball.mode === 'free') return chase(state, p);
  return defend(state, p);
}

function celebrate(state, p) {
  if (p.team === state.winner && !p.act && state.rng() < 0.02) {
    p.act = { kind: 'celebrate', t: 0, dur: 1.2, locked: false };
  }
  return { mx: 0, mz: 0 };
}

// --- With the ball ------------------------------------------------------------------------------------

function withBall(state, p) {
  const tier = TIERS[state.tier];
  const ai = p.ai;
  ai.decideT -= 1 / 60;
  const intent = ai.lastMove ? { ...ai.lastMove } : { mx: 0, mz: 0 };
  intent.shoot = false;
  intent.pass = undefined;

  if (state.needsClear) {
    // Out behind the arc first, by the shortest way, looking for an outlet.
    const out = clearSpot(p);
    Object.assign(intent, seek(p, out, 1));
    intent.sprint = Math.hypot(out.x - p.x, out.z - p.z) > 2.5;
    if (ai.decideT <= 0) {
      ai.decideT = tier.decide;
      const outlet = bestPass(state, p, true);
      if (outlet && outlet.score > 0.9 && ai.holdT > 0.35) {
        intent.pass = outlet.to.id;
      }
    }
    ai.lastMove = { mx: intent.mx, mz: intent.mz, sprint: intent.sprint };
    return intent;
  }

  // Driving: keep going until something stops him.
  if (ai.mode === 'drive') {
    ai.modeT += 1 / 60;
    const d = distToRim(p.x, p.z);
    const lane = laneOpen(state, p);
    Object.assign(intent, seek(p, { x: p.x * 0.15, z: Math.max(0.4, p.z * 0.15) }, 1));
    intent.sprint = true;
    const dunkRange = 2.1 + 2.0 * p.r.dunk;
    if ((d < dunkRange && p.r.dunk > 0.6 && lane > 0.5) || d < 2.2) {
      intent.shoot = true;
      ai.mode = 'space';
      return intent;
    }
    if (lane < 0.35 || ai.modeT > 2.6) {
      // Walled off: kick it out, or pull up.
      const kick = bestPass(state, p);
      if (kick && kick.score > 0.7) intent.pass = kick.to.id;
      else if (d < 5.5) intent.shoot = true;
      ai.mode = 'space';
    }
    ai.lastMove = { mx: intent.mx, mz: intent.mz, sprint: true };
    return intent;
  }

  if (ai.decideT > 0) return intent;
  ai.decideT = tier.decide * (0.8 + 0.4 * state.rng());

  const options = [];
  // Everything is priced in expected points. Early in the clock the bar for a
  // shot is high - a 3x3 side with nine seconds left wants a good one, not the
  // first one - and it drops as the clock runs down.
  const patience = Math.max(0, Math.min(1, (state.shotClock - 2.5) / 8));
  const bar = 0.42 + 0.4 * patience;

  // 1. Shoot it.
  // Priced without a release: the CPU's own timing averages out a little better than none.
  const sc = shotChance(state, p, null);
  sc.chance *= 1.1;
  const pts = beyondArc(p.x, p.z) ? 2 : 1;
  let shootValue = sc.chance * pts * (sc.contest.factor >= 0.88 ? 1 : 0.7);
  if (shootValue < bar) shootValue *= 0.45;
  if (state.shotClock < 2.2) shootValue += 1;
  if (ai.holdT < 0.3 && sc.contest.factor < 0.88) shootValue *= 0.6;
  options.push({ kind: 'shoot', value: shootValue });

  // 2. Drive it.
  const lane = laneOpen(state, p);
  const d = distToRim(p.x, p.z);
  const driveValue = lane * lane * (0.5 + 0.35 * p.r.finish) * (d < 9 ? 1 : 0.6) * (state.shotClock > 3 ? 1 : 0.5);
  options.push({ kind: 'drive', value: driveValue });

  // 3. Move it: worth what he could do with it, plus a little for moving it at all.
  const pass = bestPass(state, p);
  if (pass && state.shotClock > 1.8) {
    const q = pass.to;
    const theirs = shotChance(state, q, null);
    const qPts = beyondArc(q.x, q.z) ? 2 : 1;
    let value = Math.max(theirs.chance * qPts, pass.score * 0.75) * passLane(state, p, q);
    value = value * tier.read + 0.12 * patience;
    options.push({ kind: pass.lob ? 'lob' : 'pass', value, to: q });
  }

  // 4. Hold, probe, wait for something.
  options.push({ kind: 'probe', value: 0.28 * patience + 0.05 });

  for (const o of options) o.value *= 0.85 + 0.3 * state.rng();
  options.sort((a, b) => b.value - a.value);
  const pick = options[0];

  if (pick.kind === 'shoot') {
    intent.shoot = true;
    intent.mx = 0;
    intent.mz = 0;
  } else if (pick.kind === 'drive') {
    ai.mode = 'drive';
    ai.modeT = 0;
    Object.assign(intent, seek(p, { x: p.x * 0.15, z: p.z * 0.15 }, 1));
    intent.sprint = true;
  } else if (pick.kind === 'pass' || pick.kind === 'lob') {
    intent.pass = pick.to.id;
    intent.lob = pick.kind === 'lob';
  } else {
    // Probe: a few steps somewhere useful, usually towards a screen or away
    // from pressure.
    const def = state.players[p.ai.guard] || nearestOf(state, 1 - p.team, p);
    const screener = state.players.find((q) => q.team === p.team && q.ai.mode === 'screen' && q.ai.set);
    let target;
    if (screener) {
      // Use the screen: go round the screener, away from the defender.
      const sx = screener.x - (def ? def.x : p.x);
      const sz = screener.z - (def ? def.z : p.z);
      const sl = Math.hypot(sx, sz) || 1;
      target = { x: screener.x + (sx / sl) * 1.6, z: screener.z + (sz / sl) * 1.2 - 0.8 };
    } else {
      const ang = state.rng.range(-1, 1);
      target = { x: p.x + Math.cos(ang) * 2.2 * Math.sign(-p.x || 1), z: p.z + Math.sin(ang) * 1.5 };
    }
    target.x = Math.max(-6.8, Math.min(6.8, target.x));
    target.z = Math.max(1.0, Math.min(8.6, target.z));
    Object.assign(intent, seek(p, target, 0.75));
  }
  ai.lastMove = { mx: intent.mx, mz: intent.mz, sprint: intent.sprint };
  return intent;
}

/** The nearest spot behind the arc, a step beyond it. */
function clearSpot(p) {
  const d = distToRim(p.x, p.z) || 1;
  if (p.z < 1.6) return { x: Math.sign(p.x || 1) * 7.0, z: Math.max(0.4, p.z) };
  const k = 7.4 / d;
  return { x: p.x * k, z: Math.max(2, p.z * k) };
}

/**
 * How clear the way to the ring is, 0 to 1. A defender squarely in the way, near
 * enough to matter, closes it; one beside or behind does not.
 */
function laneOpen(state, p) {
  const d = distToRim(p.x, p.z) || 1;
  const ux = -p.x / d;
  const uz = -p.z / d;
  let open = 1;
  for (const q of state.players) {
    if (q.team === p.team) continue;
    const rx = q.x - p.x;
    const rz = q.z - p.z;
    const along = rx * ux + rz * uz;
    if (along < -0.2 || along > d) continue;
    const side = Math.abs(rx * uz - rz * ux);
    const block = Math.max(0, 1 - side / 1.3) * Math.max(0.3, 1 - along / 6);
    open -= block * (q.act?.kind === 'stumble' || q.act?.whiff ? 0.2 : 0.9);
  }
  return Math.max(0, open);
}

/** The best pass on the floor, scored on how open the man is and what he can do with it. */
function bestPass(state, p, mustBeOut = false) {
  let best = null;
  for (const q of state.players) {
    if (q.team !== p.team || q === p) continue;
    if (mustBeOut && !beyondArc(q.x, q.z)) continue;
    const open = openness(state, q);
    const lane = passLane(state, p, q);
    if (lane < 0.3) continue;
    const dq = distToRim(q.x, q.z);
    const pts = beyondArc(q.x, q.z) ? 2 : 1;
    let score = Math.min(1, open / 3) * lane * (0.6 + 0.4 * pts / 2);
    if (q.ai.mode === 'cut' || q.ai.mode === 'roll') score += dq < 3.5 ? 0.6 : 0.25;
    if (dq < 2.5 && open > 1.2) score += 0.5;
    // A lob to a big rolling to the ring, if the plan works.
    let lob = false;
    if ((q.ai.mode === 'roll' || q.ai.mode === 'cut') && q.r.dunk > 0.75 && dq < 6 && open < 2.4) {
      if (alleyPlan(state, p, q)) {
        lob = true;
        score += 0.35;
      }
    }
    if (!best || score > best.score) best = { to: q, score, lob };
  }
  return best;
}

/** 0..1: how safe the straight line from passer to receiver is. */
export function passLane(state, p, q) {
  const dx = q.x - p.x;
  const dz = q.z - p.z;
  const d = Math.hypot(dx, dz) || 1;
  let safe = 1;
  for (const o of state.players) {
    if (o.team === p.team) continue;
    const rx = o.x - p.x;
    const rz = o.z - p.z;
    const along = (rx * dx + rz * dz) / d;
    if (along < 0.4 || along > d - 0.3) continue;
    const side = Math.abs(rx * dz - rz * dx) / d;
    if (side < 1.1) safe -= (1.1 - side) * 0.85;
  }
  return Math.max(0, safe) * (d > 9 ? 0.7 : 1);
}

// --- Off the ball ----------------------------------------------------------------------------------------

function offBall(state, p) {
  const ai = p.ai;
  ai.modeT += 1 / 60;
  const ball = state.ball;
  const holder = ball.holder >= 0 ? state.players[ball.holder] : null;

  if (ai.receiving && ball.mode === 'pass' && ball.pass?.to === p.id && !ball.pass.alley) {
    // Come to the ball.
    const t = ball.pass.lead;
    const intent = seek(p, t, 1);
    intent.face = Math.atan2(ball.pos.x - p.x, ball.pos.z - p.z);
    return intent;
  }

  if (ai.mode === 'alley' && ai.plan) return alleyRun(state, p);

  if (ai.mode === 'reset' || ai.mode === 'recover') ai.mode = 'space';

  if (ai.celebrate) {
    ai.celebrate = false;
  }

  // Re-think now and then.
  if (ai.modeT > ai.modeFor || ai.modeFor === undefined) pickOffMode(state, p, holder);

  let intent;
  switch (ai.mode) {
    case 'cut': {
      // Basket cut: hard to the ring, then out to the other side if nothing comes.
      const side = Math.sign(p.x || 1);
      const target = ai.modeT < 1.3 ? { x: side * 0.9, z: 0.9 } : { x: -side * 6.8, z: 0.8 };
      intent = seek(p, target, 1);
      intent.sprint = ai.modeT < 1.3;
      if (ai.modeT > 2.6) setMode(p, 'space');
      break;
    }
    case 'screen': {
      // Go and stand where the ball's defender wants to be.
      const def = holder ? state.players[holder.ai.guard] : null;
      if (!holder || !def) {
        setMode(p, 'space');
        intent = { mx: 0, mz: 0 };
        break;
      }
      const hx = def.x - holder.x;
      const hz = def.z - holder.z;
      const hl = Math.hypot(hx, hz) || 1;
      // Beside the defender, on the side away from the ring-side help.
      const side = ai.screenSide || 1;
      const spot = {
        x: def.x + (-hz / hl) * 0.65 * side + (hx / hl) * 0.1,
        z: def.z + (hx / hl) * 0.65 * side + (hz / hl) * 0.1,
      };
      const d = Math.hypot(spot.x - p.x, spot.z - p.z);
      ai.set = d < 0.5;
      intent = ai.set ? { mx: 0, mz: 0 } : seek(p, spot, 1);
      intent.face = Math.atan2(holder.x - p.x, holder.z - p.z);
      if (ai.set) ai.setT = (ai.setT || 0) + 1 / 60;
      if (ai.setT > 1.1 || ai.modeT > 3.2) {
        ai.set = false;
        ai.setT = 0;
        setMode(p, p.r.dunk > 0.7 || state.rng() < 0.6 ? 'roll' : 'pop');
      }
      break;
    }
    case 'roll': {
      intent = seek(p, { x: Math.sign(p.x || 1) * 0.6, z: 1.2 }, 1);
      intent.sprint = true;
      if (ai.modeT > 1.8) setMode(p, 'space');
      break;
    }
    case 'pop': {
      const d = distToRim(p.x, p.z) || 1;
      intent = seek(p, { x: (p.x / d) * 7.3, z: Math.max(1.5, (p.z / d) * 7.3) }, 1);
      if (ai.modeT > 1.6) setMode(p, 'space');
      break;
    }
    default: {
      intent = seek(p, ai.target, 0.85);
      if (Math.hypot(ai.target.x - p.x, ai.target.z - p.z) < 0.4) {
        // At the spot: face the ball, ready to catch and shoot.
        const b = state.ball.pos;
        intent.face = Math.atan2(b.x - p.x, b.z - p.z);
      }
    }
  }
  return intent;
}

function setMode(p, mode) {
  p.ai.mode = mode;
  p.ai.modeT = 0;
  p.ai.modeFor = undefined;
}

/**
 * What to do next off the ball. Weighted by what the floor offers: a screen when
 * the ball is pressured beyond the arc, a cut when my man is looking at the
 * ball instead of me, otherwise a spot - one that is not on top of anybody.
 */
function pickOffMode(state, p, holder) {
  const ai = p.ai;
  const r = state.rng();
  const myDef = state.players[ai.guard];
  const mates = state.players.filter((q) => q.team === p.team && q !== p);
  const someoneScreening = mates.some((q) => q.ai.mode === 'screen' || q.ai.mode === 'roll');
  ai.modeFor = 1.6 + state.rng() * 1.8;

  if (holder && !someoneScreening && !state.needsClear) {
    const hDef = state.players[holder.ai.guard];
    const tight = hDef ? Math.hypot(hDef.x - holder.x, hDef.z - holder.z) < 1.6 : false;
    if (tight && distToRim(holder.x, holder.z) > 5.5 && r < 0.42) {
      ai.mode = 'screen';
      ai.modeT = 0;
      ai.set = false;
      ai.setT = 0;
      ai.screenSide = holder.x > 0 ? -1 : 1;
      ai.modeFor = 4;
      return;
    }
  }
  if (myDef && holder) {
    // Is my man watching the ball? Then go behind him.
    const lookX = Math.sin(myDef.face);
    const lookZ = Math.cos(myDef.face);
    const toMeX = p.x - myDef.x;
    const toMeZ = p.z - myDef.z;
    const dm = Math.hypot(toMeX, toMeZ) || 1;
    const watching = (lookX * toMeX + lookZ * toMeZ) / dm < 0.1;
    const laneToRim = distToRim(p.x, p.z) > 3.5;
    if ((watching || dm > 2.2) && laneToRim && r < 0.5) {
      ai.mode = 'cut';
      ai.modeT = 0;
      ai.modeFor = 3;
      return;
    }
  }
  ai.mode = 'space';
  ai.modeT = 0;
  ai.target = pickSpot(state, p, holder);
}

function pickSpot(state, p, holder) {
  const others = state.players.filter((q) => q.team === p.team && q !== p);
  let best = SPOTS[0];
  let bestScore = -Infinity;
  for (const s of SPOTS) {
    let score = s.deep ? 1.0 : (p.r.dunk > 0.8 ? 1.1 : 0.4);
    for (const q of others) {
      const t = q.ai.mode === 'space' && q !== holder ? q.ai.target : q;
      const d = Math.hypot(s.x - t.x, s.z - t.z);
      score -= Math.max(0, 4.6 - d) * 0.5;
    }
    score -= Math.hypot(s.x - p.x, s.z - p.z) * 0.06;
    score += state.rng() * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return { x: best.x, z: best.z };
}

/** The run to the take-off spot for an alley-oop, and the jump. */
function alleyRun(state, p) {
  const plan = p.ai.plan;
  const ball = state.ball;
  if (!(ball.mode === 'pass' || ball.holder >= 0) || (ball.pass && ball.pass.to !== p.id)) {
    p.ai.plan = null;
    setMode(p, 'space');
    return { mx: 0, mz: 0 };
  }
  const intent = seek(p, plan.takeoff, 1);
  intent.sprint = true;
  intent.face = Math.atan2(-p.x, -p.z);
  // Time to go?
  if (ball.mode === 'pass' && !p.act) {
    const left = plan.arriveAt - state.time;
    if (left <= plan.flight + 1 / 60) {
      startAlleyJump(state, p, plan);
    }
  }
  return intent;
}

function startAlleyJump(state, p, plan) {
  const d = distToRim(p.x, p.z) || 1;
  const top = Math.max(0.55, COURT.RIM_Y + 0.22 - p.reach);
  p.act = {
    kind: 'dunk', t: 0, locked: true, released: false,
    from: { x: p.x, z: p.z },
    slam: { x: (p.x / d) * 0.42, z: (p.z / d) * 0.42 },
    gather: 0,
    flight: plan.flight,
    hang: 0.38,
    top,
    style: state.rng() < 0.5 ? 'two' : 'one',
    alley: true,
    dur: plan.flight + 0.38 + 0.9,
  };
  p.ai.plan = null;
  p.ai.mode = 'space';
  state.events.push({ type: 'takeoff', id: p.id, style: p.act.style, alley: true });
}

// --- Loose balls and rebounds ---------------------------------------------------------------------------

function chase(state, p) {
  const ball = state.ball;
  const b = ball.pos;
  // Where will it come down? Rough: a little ahead along its flight.
  const lead = ball.mode === 'shot' ? 0.35 : 0.2;
  let tx = b.x + ball.vel.x * lead;
  let tz = b.z + ball.vel.z * lead;
  if (ball.mode === 'shot' && b.y > 2) {
    // Rebounds come off long from long shots; crowd the ring until we know.
    tx = b.x * 0.4 + tx * 0.6;
    tz = Math.max(0.3, b.z * 0.4 + tz * 0.6 + 0.7);
  }
  const mine = nearestOf(state, p.team, { x: tx, z: tz });
  const close = Math.hypot(tx - p.x, tz - p.z);
  let intent;
  if (mine === p || close < 2.5 || p.r.reb > 0.85) {
    intent = seek(p, { x: tx, z: tz }, 1);
    intent.sprint = close > 1.5;
  } else {
    // Not my ball: drift back to a sensible place.
    const home = p.team === state.possession ? p.ai.target : { x: p.x * 0.6, z: Math.max(1.5, p.z * 0.6) };
    intent = seek(p, home, 0.6);
  }
  // Jump for it when it is coming down within reach.
  const dh = Math.hypot(b.x - p.x, b.z - p.z);
  const top = p.reach + 0.6;
  if (!p.act && dh < 1.0 && b.y > p.reach - 0.1 && b.y < top && ball.vel.y < 0 && p.y === 0) {
    intent.jump = true;
    intent.jumpKind = 'reb';
  }
  intent.face = Math.atan2(b.x - p.x, b.z - p.z);
  return intent;
}

// --- Defence --------------------------------------------------------------------------------------------------

/**
 * Who guards whom. Straight across to start, then kept, except: the human
 * guards whoever he likes and the other two take the remaining two; and a
 * defender who has been stuck on a screen swaps with the man guarding the
 * screener.
 */
export function assignDefense(state) {
  if (state.tick % 15 !== 0) return;
  const defTeam = 1 - state.possession;
  const defs = teamPlayers(state, defTeam);
  const offs = teamPlayers(state, state.possession);
  const human = defTeam === state.humanTeam ? state.players[state.controlled] : null;

  let taken = new Set();
  if (human) {
    const mark = nearestOf(state, state.possession, human);
    human.ai.guard = mark.id;
    taken.add(mark.id);
  }
  // Switch on a screen: stuck for a while, and the screener's man is near.
  for (const d of defs) {
    if (d === human) continue;
    if (d.blockedFor > 0.35) {
      const screener = offs.find((o) => o.ai.mode === 'screen' && Math.hypot(o.x - d.x, o.z - d.z) < 1.0);
      if (screener) {
        const other = defs.find((x) => x.ai.guard === screener.id && x !== d && x !== human);
        if (other) {
          const g = d.ai.guard;
          d.ai.guard = screener.id;
          other.ai.guard = g;
          d.blockedFor = 0;
          state.events.push({ type: 'switch-def', id: d.id });
        }
      }
    }
  }
  // Fix up anybody left guarding nobody, or two on one.
  const rest = defs.filter((d) => d !== human);
  const free = offs.filter((o) => !taken.has(o.id));
  const counts = new Map();
  for (const d of rest) counts.set(d.ai.guard, (counts.get(d.ai.guard) || 0) + 1);
  const bad = rest.some((d) => !free.some((o) => o.id === d.ai.guard) || counts.get(d.ai.guard) > 1);
  if (bad) {
    // Two defenders, two (or three) attackers: try both pairings, keep the shorter.
    taken = new Set();
    const sorted = [...rest].sort((a, b) => a.id - b.id);
    let bestCost = Infinity;
    let bestPair = null;
    const perms = permutations(free.map((o) => o.id), sorted.length);
    for (const perm of perms) {
      let cost = 0;
      sorted.forEach((d, i) => {
        const o = state.players[perm[i]];
        cost += Math.hypot(o.x - d.x, o.z - d.z);
      });
      if (cost < bestCost) {
        bestCost = cost;
        bestPair = perm;
      }
    }
    if (bestPair) sorted.forEach((d, i) => { d.ai.guard = bestPair[i]; });
  }
  // The attackers know who is on them, for cutting and screening.
  for (const d of defs) {
    const o = state.players[d.ai.guard];
    if (o) o.ai.guard = d.id;
  }
}

function permutations(ids, k) {
  const out = [];
  const go = (pre, rest) => {
    if (pre.length === k) {
      out.push(pre);
      return;
    }
    for (let i = 0; i < rest.length; i++) go([...pre, rest[i]], [...rest.slice(0, i), ...rest.slice(i + 1)]);
  };
  go([], ids);
  return out;
}

function defend(state, p) {
  const tier = TIERS[state.tier];
  const ball = state.ball;
  const man = state.players[p.ai.guard] || nearestOf(state, 1 - p.team, p);
  const holder = ball.holder >= 0 ? state.players[ball.holder] : null;
  const intent = { stance: true };

  // After a basket, the scorers back off to the arc while the ball comes out.
  if (state.needsClear && holder && distToRim(holder.x, holder.z) < 3 && man === holder) {
    const t = { x: holder.x * 0.4, z: Math.max(4.2, holder.z + 3.5) };
    Object.assign(intent, seek(p, t, 1));
    intent.face = Math.atan2(holder.x - p.x, holder.z - p.z);
    return intent;
  }

  let target;
  if (man === holder) {
    // On the ball: between him and the ring, a stride off. Tighter on a shooter
    // beyond the arc, looser on a driver deep out.
    const d = distToRim(man.x, man.z) || 1;
    const gap = d > 8.5 ? 1.8 : (beyondArc(man.x, man.z) ? 1.05 : 0.95);
    target = { x: man.x - (man.x / d) * gap, z: man.z - (man.z / d) * gap };
    // Beaten? Then sprint to get back in front.
    const behind = ((p.x - man.x) * -man.x + (p.z - man.z) * -man.z) / d < 0;
    if (behind) intent.sprint = true;

    // React to a shot going up.
    if (man.act && (man.act.kind === 'shoot' || man.act.kind === 'layup' || man.act.kind === 'dunk')) {
      p.ai.sawShot = (p.ai.sawShot || 0) + 1 / 60;
      const dist = Math.hypot(man.x - p.x, man.z - p.z);
      if (p.ai.sawShot > tier.react && dist < 2.0 && !p.act) {
        intent.jump = true;
        intent.jumpKind = 'block';
      }
      Object.assign(intent, seek(p, { x: man.x, z: man.z }, 1));
      intent.sprint = true;
    } else {
      p.ai.sawShot = 0;
      // Reach for it now and then.
      const close = Math.hypot(man.x - p.x, man.z - p.z) < 1.15;
      if (close && !p.act && p.cooldown <= 0 && state.rng() < tier.steal / 60 * (1 + p.r.steal)) {
        intent.steal = true;
      }
    }
  } else {
    // Off the ball: on the line from my man to the ring, sagging towards the ball.
    const b = holder || ball.pos;
    const dBall = Math.hypot(man.x - b.x, man.z - b.z);
    const sag = Math.min(0.55, 0.18 + dBall * 0.05);
    target = { x: man.x + (RIM.x - man.x) * sag, z: man.z + (RIM.z - man.z) * sag };
    target.x += (b.x - target.x) * 0.15;
    target.z += (b.z - target.z) * 0.15;
    // Deny the pass when he is one pass away and close.
    if (dBall < 5 && holder) {
      const mx = (man.x + b.x) / 2;
      const mz = (man.z + b.z) / 2;
      target.x += (mx - target.x) * 0.25;
      target.z += (mz - target.z) * 0.25;
    }
    // Help on a drive: the ball is near the ring and its defender is beaten.
    if (holder && distToRim(holder.x, holder.z) < 3.8) {
      const hd = state.players[holder.ai.guard];
      const beaten = !hd || distToRim(hd.x, hd.z) > distToRim(holder.x, holder.z) + 0.3;
      if (beaten && state.rng() > tier.help) {
        const helper = nearestOf(state, p.team, { x: holder.x * 0.5, z: holder.z * 0.5 }, hd);
        if (helper === p) {
          target = { x: holder.x * 0.5, z: holder.z * 0.5 };
          intent.sprint = true;
          if (holder.act && (holder.act.kind === 'dunk' || holder.act.kind === 'layup') && !p.act) {
            p.ai.sawShot = (p.ai.sawShot || 0) + 1 / 60;
            if (p.ai.sawShot > tier.react && Math.hypot(holder.x - p.x, holder.z - p.z) < 2.2) {
              intent.jump = true;
              intent.jumpKind = 'block';
            }
          }
        }
      }
    }
    // A cutter going past: stay with him.
    if (man.ai.mode === 'cut' || man.ai.mode === 'roll') {
      target = { x: man.x + (RIM.x - man.x) * 0.2, z: man.z + (RIM.z - man.z) * 0.2 };
      intent.sprint = true;
    }
    // An alley-oop in the air: go up with him.
    if (ball.mode === 'pass' && ball.pass?.alley && ball.pass.to === man.id) {
      target = { x: ball.pass.alley.catchAt.x * 1.5, z: ball.pass.alley.catchAt.z * 1.5 + 0.3 };
      intent.sprint = true;
      const left = ball.pass.alley.arriveAt - state.time;
      if (left < 0.5 && left > 0.25 && !p.act && Math.hypot(man.x - p.x, man.z - p.z) < 1.6 && state.rng() < 0.08 * tier.block) {
        intent.jump = true;
        intent.jumpKind = 'block';
      }
    }
  }

  if (!inBounds(target.x, target.z)) {
    target.x = Math.max(-COURT.HALF_W, Math.min(COURT.HALF_W, target.x));
    target.z = Math.max(COURT.END_Z, Math.min(COURT.TOP_Z, target.z));
  }
  Object.assign(intent, seek(p, target, 1), { stance: true, sprint: intent.sprint });
  const look = holder || ball.pos;
  intent.face = Math.atan2(look.x - p.x, look.z - p.z);
  return intent;
}
