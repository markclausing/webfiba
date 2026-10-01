/**
 * The ball in flight: gravity, air, the floor, the ring, the glass and the net.
 *
 * Every shot is aimed - the shooter decides where in the ring the ball should
 * arrive, see aimShot() - and then simply let go. Whether it goes in is up to
 * this file. A shot aimed at the middle of the ring drops through clean; one
 * aimed at the front iron hits the front iron and does whatever a ball does
 * then, which is sometimes to roll round and fall in anyway. That is the reason
 * misses look like misses: nothing here knows whether a shot "was a make".
 */

import { COURT, GRAVITY, RIM } from './court.js';

const R = COURT.BALL_R;
/**
 * No air drag. A real ball loses a little to the air and a real shooter aims
 * for it without thinking; here the aiming is a closed-form throw, and a throw
 * that is exact in a vacuum is worth more than drag nobody can see.
 */
const DRAG = 0;
const FLOOR_BOUNCE = 0.8;
const FLOOR_FRICTION = 0.86;
const RIM_BOUNCE = 0.55;
const BOARD_BOUNCE = 0.62;
/** The ring's centreline: inner radius plus half the steel. */
const RING = COURT.RIM_R + COURT.RIM_TUBE;

/**
 * Velocity that takes a ball from `from` to `to` launched at `angle` (radians
 * above horizontal). Returns null if that angle cannot get there, which happens
 * only when the target is above the line of the throw.
 */
export function launch(from, to, angle) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  const h = to.y - from.y;
  const c = Math.cos(angle);
  const t = Math.tan(angle);
  const denom = 2 * c * c * (d * t - h);
  if (d < 1e-4 || denom <= 0) return null;
  const v = Math.sqrt((GRAVITY * d * d) / denom);
  const vh = v * c;
  return { x: (dx / d) * vh, y: v * Math.sin(angle), z: (dz / d) * vh, time: d / vh };
}

/** Velocity for a flight of exactly `time` seconds from `from` to `to`. */
export function launchTimed(from, to, time) {
  return {
    x: (to.x - from.x) / time,
    y: (to.y - from.y) / time + 0.5 * GRAVITY * time,
    z: (to.z - from.z) / time,
    time,
  };
}

/**
 * Where a shot should be aimed so the ball arrives `miss` metres from dead
 * centre, in direction `dir` (radians, 0 = the back of the ring as seen by the
 * shooter). A make is a small miss; the ring is 45 cm across and the ball 23, so
 * anything under about 7 cm off centre drops through without touching iron.
 */
export function aimPoint(shooter, miss, dir) {
  const ax = RIM.x - shooter.x;
  const az = RIM.z - shooter.z;
  const len = Math.hypot(ax, az) || 1;
  const fx = ax / len;
  const fz = az / len;
  // Forward is along the line of the shot, so "long" and "short" are real.
  const fwd = Math.cos(dir) * miss;
  const side = Math.sin(dir) * miss;
  return {
    x: RIM.x + fx * fwd - fz * side,
    y: RIM.y + 0.02,
    z: RIM.z + fz * fwd + fx * side,
  };
}

/**
 * One tick of a free ball. Returns a list of what it touched, for the sound and
 * the rules: 'floor', 'rim', 'board', 'net', 'through' (passed down through the
 * ring) and 'out' (landed outside the court).
 */
export function stepBall(ball, dt) {
  const hits = [];
  const p = ball.pos;
  const v = ball.vel;
  const prevY = p.y;

  v.y -= GRAVITY * dt;
  const drag = 1 - DRAG * dt;
  v.x *= drag;
  v.y *= drag;
  v.z *= drag;

  // Substeps, because a 12 m/s ball moves 20 cm a tick and the ring is 2 cm thick.
  const speed = Math.hypot(v.x, v.y, v.z);
  const steps = Math.max(1, Math.ceil((speed * dt) / 0.03));
  const h = dt / steps;
  for (let s = 0; s < steps; s++) {
    const beforeY = p.y;
    p.x += v.x * h;
    p.y += v.y * h;
    p.z += v.z * h;

    collideRing(ball, hits);
    collideBoard(ball, hits);
    collideNet(ball, h, hits);

    // Down through the ring: the centre crossed the rim plane inside the ring.
    if (beforeY >= RIM.y && p.y < RIM.y && v.y < 0) {
      const r = Math.hypot(p.x - RIM.x, p.z - RIM.z);
      if (r < COURT.RIM_R) hits.push('through');
    }

    if (p.y < R) {
      p.y = R;
      if (v.y < -0.4) hits.push('floor');
      v.y = Math.abs(v.y) < 0.6 ? 0 : -v.y * FLOOR_BOUNCE;
      v.x *= FLOOR_FRICTION;
      v.z *= FLOOR_FRICTION;
      if (Math.abs(p.x) > COURT.HALF_W || p.z < COURT.END_Z || p.z > COURT.TOP_Z) hits.push('out');
    }
  }
  // Rolling resistance once it has stopped bouncing.
  if (p.y <= R + 1e-3 && v.y === 0) {
    const k = Math.exp(-1.2 * dt);
    v.x *= k;
    v.z *= k;
  }
  ball.prevY = prevY;
  return hits;
}

/** The ring as a torus: nearest point on the steel circle, and push out of it. */
function collideRing(ball, hits) {
  const p = ball.pos;
  const v = ball.vel;
  const dx = p.x - RIM.x;
  const dz = p.z - RIM.z;
  const r = Math.hypot(dx, dz);
  if (r < 1e-5) return;
  // Nearest point on the ring's centre circle.
  const cx = RIM.x + (dx / r) * RING;
  const cz = RIM.z + (dz / r) * RING;
  const nx0 = p.x - cx;
  const ny0 = p.y - RIM.y;
  const nz0 = p.z - cz;
  const d = Math.hypot(nx0, ny0, nz0);
  const reach = R + COURT.RIM_TUBE;
  if (d >= reach || d < 1e-6) return;
  const nx = nx0 / d;
  const ny = ny0 / d;
  const nz = nz0 / d;
  p.x = cx + nx * reach;
  p.y = RIM.y + ny * reach;
  p.z = cz + nz * reach;
  const vn = v.x * nx + v.y * ny + v.z * nz;
  if (vn < 0) {
    // Bounce the normal part, and scrub some of the tangential part: a ball on
    // the iron loses speed, which is what lets it roll round and drop.
    v.x -= (1 + RIM_BOUNCE) * vn * nx;
    v.y -= (1 + RIM_BOUNCE) * vn * ny;
    v.z -= (1 + RIM_BOUNCE) * vn * nz;
    v.x *= 0.9;
    v.y *= 0.9;
    v.z *= 0.9;
    if (vn < -0.35) hits.push('rim');
    ball.rimHit = Math.max(ball.rimHit || 0, -vn);
    ball.touchedRim = true;
  }
}

/** The glass: a slab, its front face at BOARD_Z. Only the front and edges matter. */
function collideBoard(ball, hits) {
  const p = ball.pos;
  const v = ball.vel;
  const front = COURT.BOARD_Z;
  const back = front - COURT.BOARD_THICK;
  // Nearest point on the slab.
  const qx = Math.max(-COURT.BOARD_HALF_W, Math.min(COURT.BOARD_HALF_W, p.x));
  const qy = Math.max(COURT.BOARD_BOTTOM, Math.min(COURT.BOARD_TOP, p.y));
  const qz = Math.max(back, Math.min(front, p.z));
  const dx = p.x - qx;
  const dy = p.y - qy;
  const dz = p.z - qz;
  const d = Math.hypot(dx, dy, dz);
  if (d >= R) return;
  let nx = 0;
  let ny = 0;
  let nz = 1;
  if (d > 1e-6) {
    nx = dx / d;
    ny = dy / d;
    nz = dz / d;
  }
  p.x = qx + nx * R;
  p.y = qy + ny * R;
  p.z = qz + nz * R;
  const vn = v.x * nx + v.y * ny + v.z * nz;
  if (vn < 0) {
    v.x -= (1 + BOARD_BOUNCE) * vn * nx;
    v.y -= (1 + BOARD_BOUNCE) * vn * ny;
    v.z -= (1 + BOARD_BOUNCE) * vn * nz;
    // Backspin bites on glass: the ball comes off it slower and lower.
    v.y -= 0.6;
    if (vn < -0.5) hits.push('board');
    ball.touchedBoard = true;
  }
}

/**
 * The net, as the simulation sees it: drag on a ball inside the cylinder under
 * the ring. The cloth itself lives in the renderer; here it only has to slow a
 * ball that is going through, which is the sound and the look of a swish.
 */
function collideNet(ball, h, hits) {
  const p = ball.pos;
  if (p.y > RIM.y || p.y < RIM.y - 0.45) return;
  const r = Math.hypot(p.x - RIM.x, p.z - RIM.z);
  if (r > COURT.RIM_R) return;
  if (!ball.inNet) hits.push('net');
  ball.inNet = 2;
  const k = Math.exp(-5 * h);
  ball.vel.x *= k;
  ball.vel.z *= k;
  // Pull gently to the middle: the cords funnel it.
  ball.vel.x -= (p.x - RIM.x) * 12 * h;
  ball.vel.z -= (p.z - RIM.z) * 12 * h;
  if (ball.vel.y < -2.5) ball.vel.y *= Math.exp(-2 * h);
}
