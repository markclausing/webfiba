/**
 * The players on screen: a rig, a body round it, and everything they do.
 *
 * No animation files. Every pose is a few lines of arithmetic driven by what the
 * simulation says the player is doing - running at this speed, three tenths
 * into a jump shot, hanging on the ring - and every joint eases towards its pose
 * on a spring, so moving from one thing to the next is a blend for free. The
 * hands are then put exactly where they need to be with two-bone IK: on the
 * ball as it comes up off the floor, on the ring when he hangs there.
 *
 * Also here: where the ball is drawn while somebody holds it. The simulation
 * only knows "he has it"; the dribble, the set point of a jump shot and the
 * wind-up of a tomahawk are this file's business.
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { COURT, RIM, DT } from '../game/court.js';
import { JUMPER_APEX } from '../game/sim.js';
import { jerseyTexture } from './textures.js';

const SKINS = [0xe0b394, 0xc68d68, 0x9a6545, 0x7a4b32, 0x5a3523, 0x3d2418];
const HAIR = [0x1a120c, 0x2b1a10, 0x0d0b0a, 0x3a2614];

const skinMats = new Map();
function skinMaterial(i) {
  if (!skinMats.has(i)) {
    skinMats.set(i, new THREE.MeshPhysicalMaterial({
      color: SKINS[i % SKINS.length],
      roughness: 0.48,
      metalness: 0,
      sheen: 0.25,
      sheenColor: new THREE.Color(0xffd8c0),
      clearcoat: 0.08,
      clearcoatRoughness: 0.5,
    }));
  }
  return skinMats.get(i);
}

/** A tapered limb from y = 0 down to y = -len: radii are [fraction along, radius]. */
function limb(len, radii, seg = 18) {
  const pts = [new THREE.Vector2(0.0001, -len)];
  for (let i = radii.length - 1; i >= 0; i--) pts.push(new THREE.Vector2(radii[i][1], -radii[i][0] * len));
  pts.push(new THREE.Vector2(0.0001, 0));
  const g = new THREE.LatheGeometry(pts, seg);
  g.computeVertexNormals();
  return g;
}

const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = (t) => t * t * (3 - 2 * t);

const JOINTS = ['pelvis', 'spine', 'neck', 'upperArmL', 'upperArmR', 'foreArmL', 'foreArmR', 'handL', 'handR', 'thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR'];

export class Character {
  constructor(p, team) {
    this.id = p.id;
    this.H = p.height;
    this.team = team;
    this.root = new THREE.Group();
    this.j = {};
    this.cur = {};
    this.tgt = {};
    for (const k of JOINTS) {
      this.cur[k] = new THREE.Euler();
      this.tgt[k] = new THREE.Euler();
    }
    this.pelvisY = 0;
    this.phase = Math.random() * 6;
    this.drib = { u: Math.random(), side: -1, from: -1, to: -1, bounced: false };
    this.lean = 0;
    this.spin = 0;
    this.yawOffset = 0;
    this.headYaw = 0;
    this.build(p, team);
  }

  build(p, team) {
    const H = this.H;
    const skin = skinMaterial(p.skin ?? 0);
    const jersey = new THREE.MeshPhysicalMaterial({
      map: jerseyTexture(team, p.num, p.name),
      roughness: 0.72,
      sheen: 1,
      sheenRoughness: 0.45,
      sheenColor: new THREE.Color(team.main).lerp(new THREE.Color(0xffffff), 0.5),
    });
    const shorts = new THREE.MeshPhysicalMaterial({
      color: team.main,
      roughness: 0.65,
      sheen: 1,
      sheenRoughness: 0.4,
      sheenColor: new THREE.Color(team.main).lerp(new THREE.Color(0xffffff), 0.6),
    });
    const trim = new THREE.MeshStandardMaterial({ color: team.trim, roughness: 0.6 });
    const sock = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.9 });
    const shoe = new THREE.MeshPhysicalMaterial({ color: team.trim === 0xffffff ? 0x111111 : team.trim, roughness: 0.35, clearcoat: 0.6 });
    const sole = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.6 });
    const hair = new THREE.MeshStandardMaterial({ color: HAIR[p.id % HAIR.length], roughness: 0.9 });

    const add = (parent, geo, mat, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const joint = (name, parent, x, y, z) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      parent.add(g);
      this.j[name] = g;
      return g;
    };

    this.len = {
      upper: 0.2 * H, fore: 0.17 * H, hand: 0.09 * H, thigh: 0.235 * H, shin: 0.235 * H,
    };
    this.hipY = 0.51 * H;

    const pelvis = joint('pelvis', this.root, 0, this.hipY, 0);
    // Shorts round the hips.
    const hips = limb(0.16 * H, [[0, 0.083 * H], [0.5, 0.088 * H], [1, 0.08 * H]], 20);
    hips.scale(1, 1, 0.72);
    add(pelvis, hips, shorts, 0, 0.07 * H, 0);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.084 * H, 0.084 * H, 0.018 * H, 20, 1, true), trim);
    band.scale.set(1, 1, 0.72);
    band.position.y = 0.065 * H;
    pelvis.add(band);

    const spine = joint('spine', pelvis, 0, 0.03 * H, 0);
    const torso = new THREE.LatheGeometry([
      new THREE.Vector2(0.0001, -0.1 * H),
      new THREE.Vector2(0.077 * H, -0.1 * H),
      new THREE.Vector2(0.079 * H, -0.03 * H),
      new THREE.Vector2(0.082 * H, 0.05 * H),
      new THREE.Vector2(0.094 * H, 0.13 * H),
      new THREE.Vector2(0.099 * H, 0.2 * H),
      new THREE.Vector2(0.093 * H, 0.245 * H),
      new THREE.Vector2(0.07 * H, 0.272 * H),
      new THREE.Vector2(0.036 * H, 0.288 * H),
      new THREE.Vector2(0.0001, 0.29 * H),
    ], 28);
    torso.scale(1, 1, 0.62);
    torso.computeVertexNormals();
    add(spine, torso, jersey);

    const neck = joint('neck', spine, 0, 0.275 * H, 0);
    add(neck, new THREE.CylinderGeometry(0.03 * H, 0.034 * H, 0.06 * H, 14), skin, 0, 0.025 * H, 0);
    const headGeo = new THREE.SphereGeometry(0.062 * H, 28, 20);
    headGeo.scale(0.86, 1.08, 0.97);
    const head = add(neck, headGeo, skin, 0, 0.1 * H, 0.004 * H);
    this.head = head;
    // Hair, ears and a nose, which is all a face needs at this distance.
    const cap = new THREE.SphereGeometry(0.064 * H, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
    cap.scale(0.87, 0.9, 0.98);
    add(head, cap, hair, 0, 0.012 * H, -0.004 * H).rotation.x = -0.25;
    for (const s of [-1, 1]) add(head, new THREE.SphereGeometry(0.012 * H, 8, 6), skin, s * 0.053 * H, 0, -0.002 * H);
    add(head, new THREE.SphereGeometry(0.012 * H, 8, 6), skin, 0, -0.006 * H, 0.058 * H);
    // Eyes and brows: dark, simple, and enough to say which way he is looking.
    const dark = new THREE.MeshStandardMaterial({ color: 0x120c0a, roughness: 0.35 });
    for (const s of [-1, 1]) {
      const eye = add(head, new THREE.SphereGeometry(0.0075 * H, 8, 6), dark, s * 0.02 * H, 0.008 * H, 0.052 * H);
      eye.scale.set(1.2, 0.8, 0.5);
      const brow = add(head, new THREE.BoxGeometry(0.022 * H, 0.004 * H, 0.006 * H), hair, s * 0.021 * H, 0.019 * H, 0.054 * H);
      brow.rotation.z = s * -0.12;
    }
    if (p.role === 'big' || p.id % 4 === 1) {
      // A beard, on some.
      const beard = new THREE.SphereGeometry(0.058 * H, 18, 10, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.3);
      beard.scale(0.86, 1.05, 0.97);
      add(head, beard, hair, 0, 0, 0.004 * H);
    }
    if (p.role === 'guard') {
      const hb = new THREE.Mesh(new THREE.TorusGeometry(0.056 * H, 0.008 * H, 6, 24), trim);
      hb.rotation.x = Math.PI / 2 - 0.15;
      hb.position.y = 0.022 * H;
      head.add(hb);
    }

    for (const [s, side] of [['L', 1], ['R', -1]]) {
      const sh = joint(`upperArm${s}`, spine, side * 0.118 * H, 0.245 * H, 0);
      add(sh, new THREE.SphereGeometry(0.043 * H, 16, 12), skin, 0, -0.01 * H, 0);
      add(sh, limb(this.len.upper, [[0, 0.04 * H], [0.35, 0.038 * H], [0.75, 0.031 * H], [1, 0.027 * H]]), skin);
      const fa = joint(`foreArm${s}`, sh, 0, -this.len.upper, 0);
      add(fa, new THREE.SphereGeometry(0.028 * H, 12, 8), skin);
      add(fa, limb(this.len.fore, [[0, 0.029 * H], [0.3, 0.031 * H], [1, 0.02 * H]]), skin);
      const hand = joint(`hand${s}`, fa, 0, -this.len.fore, 0);
      add(hand, new RoundedBoxGeometry(0.048 * H, 0.085 * H, 0.024 * H, 2, 0.01 * H), skin, 0, -0.04 * H, 0.004 * H);
      // A thumb, angled forward.
      const th = add(hand, new THREE.CapsuleGeometry(0.008 * H, 0.03 * H, 2, 6), skin, side * -0.022 * H, -0.02 * H, 0.012 * H);
      th.rotation.set(0.5, 0, side * 0.5);

      const th0 = joint(`thigh${s}`, pelvis, side * 0.05 * H, -0.015 * H, 0);
      add(th0, limb(this.len.thigh, [[0, 0.058 * H], [0.3, 0.055 * H], [0.8, 0.042 * H], [1, 0.036 * H]]), skin);
      // Shorts leg.
      add(th0, limb(0.13 * H, [[0, 0.07 * H], [1, 0.065 * H]], 18), shorts, 0, 0.01 * H, 0);
      const sh0 = joint(`shin${s}`, th0, 0, -this.len.thigh, 0);
      add(sh0, new THREE.SphereGeometry(0.037 * H, 12, 8), skin);
      add(sh0, limb(this.len.shin, [[0, 0.037 * H], [0.22, 0.043 * H], [0.6, 0.032 * H], [1, 0.023 * H]]), skin);
      add(sh0, limb(0.09 * H, [[0, 0.03 * H], [1, 0.027 * H]], 14), sock, 0, -this.len.shin + 0.09 * H, 0);
      const ft = joint(`foot${s}`, sh0, 0, -this.len.shin, 0);
      add(ft, new RoundedBoxGeometry(0.055 * H, 0.045 * H, 0.15 * H, 2, 0.015 * H), shoe, 0, -0.022 * H, 0.03 * H);
      add(ft, new RoundedBoxGeometry(0.058 * H, 0.016 * H, 0.155 * H, 2, 0.006 * H), sole, 0, -0.04 * H, 0.03 * H);
    }
  }

  // --- posing ---------------------------------------------------------------------------------------

  set(name, x = 0, y = 0, z = 0) {
    this.tgt[name].set(x, y, z);
  }

  /**
   * One frame. `p` is the simulation's player, interpolated; `ctx` carries the
   * ball, the hoop, the state and whether this one holds the ball. Returns the
   * ball's drawn position if he has it.
   */
  update(dt, p, ctx) {
    const H = this.H;
    const k = H / 2;
    const a = p.act;
    const sp = Math.hypot(p.vx, p.vz);
    const fx = Math.sin(p.face);
    const fz = Math.cos(p.face);
    // Velocity in his own frame: forward, and to his left.
    const vf = p.vx * fx + p.vz * fz;
    const vl = p.vx * fz - p.vz * fx;
    const runAmt = clamp(sp / 7, 0, 1);
    const moving = sp > 0.35;
    const hasBall = ctx.holder;
    let ballLocal = null;
    let ik = { L: null, R: null };
    let rate = 14;
    let crouch = 0;
    let yaw = 0;

    // --- legs and body: locomotion -------------------------------------------------------
    if (moving) this.phase += dt * (sp / (1.15 + 0.5 * runAmt)) * Math.PI;
    const ph = this.phase;
    const amp = clamp(sp / 5.5, 0, 1.25);
    const stance = p.stance && !a;
    if (stance) {
      // Defensive slide: low, wide, hands active, feet shuffling sideways.
      const lat = clamp(vl / 3, -1, 1);
      const sl = Math.sin(ph * 1.2);
      crouch = 0.1 * H;
      this.set('thighL', -0.55 + 0.25 * (vf / 4) * Math.sin(ph), 0, 0.32 + 0.18 * lat * sl);
      this.set('thighR', -0.55 - 0.25 * (vf / 4) * Math.sin(ph), 0, -0.32 + 0.18 * lat * sl);
      this.set('shinL', 1.0, 0, 0);
      this.set('shinR', 1.0, 0, 0);
      this.set('footL', -0.42, 0, -0.25);
      this.set('footR', -0.42, 0, 0.25);
      this.set('spine', 0.38, 0, 0);
      this.set('upperArmL', -0.4, 0, 1.05);
      this.set('upperArmR', -0.4, 0, -1.05);
      this.set('foreArmL', -0.7, 0, 0);
      this.set('foreArmR', -0.7, 0, 0);
      this.set('handL', 0.2, 0, -0.3);
      this.set('handR', 0.2, 0, 0.3);
    } else if (moving) {
      const s = Math.sin(ph);
      const c = Math.cos(ph);
      const swing = 0.32 + 0.6 * Math.min(1, amp);
      // Run sideways or backwards by rotating the cycle a bit; mostly he turns
      // to run, the simulation sees to that.
      this.set('thighL', -s * swing - 0.12 * amp, 0, 0.04);
      this.set('thighR', s * swing - 0.12 * amp, 0, -0.04);
      this.set('shinL', 0.15 + (0.35 + 1.25 * amp) * Math.max(0, c), 0, 0);
      this.set('shinR', 0.15 + (0.35 + 1.25 * amp) * Math.max(0, -c), 0, 0);
      this.set('footL', -0.15 - 0.3 * Math.max(0, -c) * amp, 0, 0);
      this.set('footR', -0.15 - 0.3 * Math.max(0, c) * amp, 0, 0);
      this.set('spine', 0.1 + 0.22 * amp, 0.12 * s * amp, 0);
      this.set('upperArmL', s * (0.25 + 0.75 * amp) - 0.05, 0, 0.14);
      this.set('upperArmR', -s * (0.25 + 0.75 * amp) - 0.05, 0, -0.14);
      this.set('foreArmL', -(0.5 + 0.9 * amp), 0, 0);
      this.set('foreArmR', -(0.5 + 0.9 * amp), 0, 0);
      this.set('handL', 0, 0, 0);
      this.set('handR', 0, 0, 0);
      crouch = (0.02 + 0.03 * amp) * H + Math.abs(Math.cos(ph * 2)) * 0.018 * H * amp;
    } else {
      // Standing: knees soft, a little sway.
      const br = Math.sin(ctx.time * 1.6 + this.id) * 0.02;
      this.set('thighL', -0.12, 0, 0.07);
      this.set('thighR', -0.08, 0, -0.07);
      this.set('shinL', 0.24, 0, 0);
      this.set('shinR', 0.2, 0, 0);
      this.set('footL', -0.1, 0, 0);
      this.set('footR', -0.1, 0, 0);
      this.set('spine', 0.08 + br, 0, 0);
      this.set('upperArmL', 0.05, 0, 0.16);
      this.set('upperArmR', 0.05, 0, -0.16);
      this.set('foreArmL', -0.35, 0, 0);
      this.set('foreArmR', -0.35, 0, 0);
      this.set('handL', 0, 0, 0);
      this.set('handR', 0, 0, 0);
      crouch = 0.025 * H;
    }
    this.set('neck', 0, 0, 0);

    // --- with the ball ----------------------------------------------------------------------
    if (hasBall && !a) {
      if (ctx.phase === 'live') {
        ballLocal = this.dribble(dt, vl, runAmt, k, ctx);
        const hand = this.drib.hand;
        ik[hand] = { local: ballLocal.clone().add(new THREE.Vector3(0, COURT.BALL_R * 0.9, 0)), w: 1 };
        // Off arm out a little, protecting the ball.
        const off = hand === 'R' ? 'L' : 'R';
        const sgn = off === 'L' ? 1 : -1;
        this.set(`upperArm${off}`, -0.6, 0, sgn * 0.6);
        this.set(`foreArm${off}`, -1.0, 0, 0);
        this.set('spine', this.tgt.spine.x + 0.12, 0, 0);
      } else {
        // Holding it: check, free throw set-up, dead ball.
        ballLocal = new THREE.Vector3(0, 0.62 * H, 0.26 * k);
        this.twoHands(ik, ballLocal, k);
      }
    }

    // --- actions ------------------------------------------------------------------------------
    if (a) {
      const out = this.action(a, p, ctx, ik, k);
      if (out.ball) ballLocal = out.ball;
      if (out.crouch !== undefined) crouch = out.crouch;
      if (out.rate) rate = out.rate;
      if (out.yaw) yaw = out.yaw;
    }

    // --- apply ----------------------------------------------------------------------------------
    for (const name of JOINTS) {
      const c = this.cur[name];
      const t = this.tgt[name];
      c.x = damp(c.x, t.x, rate, dt);
      c.y = damp(c.y, t.y, rate, dt);
      c.z = damp(c.z, t.z, rate, dt);
      this.j[name].rotation.copy(c);
    }
    this.pelvisY = damp(this.pelvisY, crouch, rate, dt);
    this.j.pelvis.position.y = this.hipY - this.pelvisY;

    // Lean into turns at speed.
    const leanT = clamp(-vl * 0.035, -0.22, 0.22) * (moving && !stance ? 1 : 0);
    this.lean = damp(this.lean, leanT, 8, dt);
    this.j.pelvis.rotation.z = this.lean;

    this.yawOffset = damp(this.yawOffset, yaw, 16, dt);
    this.root.position.set(p.x, p.y, p.z);
    this.root.rotation.y = p.face + this.yawOffset;

    // Head: look at the ball, within reason.
    this.root.updateMatrixWorld(true);
    if (ctx.ball && !(a && a.kind === 'dunk')) {
      const local = this.root.worldToLocal(ctx.ball.clone());
      const want = clamp(Math.atan2(local.x, local.z), -1.1, 1.1);
      this.headYaw = damp(this.headYaw, want, 10, dt);
      this.j.neck.rotation.y = this.headYaw * 0.8;
      this.j.spine.rotation.y += this.headYaw * 0.2;
    }
    this.root.updateMatrixWorld(true);

    // Hands where they must be.
    for (const s of ['L', 'R']) {
      const req = ik[s];
      if (!req) continue;
      const target = req.world || this.root.localToWorld(req.local.clone());
      this.solveArm(s, target, req.w ?? 1);
    }

    if (ballLocal) return this.root.localToWorld(ballLocal.clone());
    return null;
  }

  /** Two hands on the ball, either side of it. */
  twoHands(ik, ball, k, w = 1) {
    ik.L = { local: ball.clone().add(new THREE.Vector3(0.1 * k, 0, -0.02 * k)), w };
    ik.R = { local: ball.clone().add(new THREE.Vector3(-0.1 * k, 0, -0.02 * k)), w };
  }

  /**
   * The dribble, in his own frame. The ball goes down from the hand to a spot
   * on the floor ahead and to the side, and back up; changing direction hard
   * across his body brings it across the front to the other hand.
   */
  dribble(dt, vl, runAmt, k, ctx) {
    const d = this.drib;
    const period = 0.52 - 0.17 * runAmt;
    const before = d.u;
    d.u += dt / period;
    // Which hand: the one on the side he is moving towards, usually the right.
    const want = vl > 1.2 ? 1 : (vl < -1.2 ? -1 : d.to);
    if (d.u >= 1) {
      d.u -= 1;
      d.from = d.to;
      d.to = want;
      d.bounced = false;
    }
    const side = (s) => s * 0.27 * k;
    const handY = 0.92 * k;
    const fwd = 0.2 * k + 0.12 * runAmt;
    const hand0 = new THREE.Vector3(side(d.from), handY, fwd);
    const hand1 = new THREE.Vector3(side(d.to), handY, fwd);
    const cross = d.from !== d.to;
    const floor = new THREE.Vector3(cross ? 0 : side(d.from) * 1.05, COURT.BALL_R, fwd + 0.14 + 0.35 * runAmt);
    const split = 0.45;
    let pos;
    if (d.u < split) {
      const t = d.u / split;
      pos = hand0.clone().lerp(floor, t * t);
    } else {
      const t = (d.u - split) / (1 - split);
      pos = floor.clone().lerp(hand1, 1 - (1 - t) * (1 - t));
      if (!d.bounced) {
        d.bounced = true;
        ctx.onBounce?.(0.6 + runAmt * 0.4);
      }
    }
    if (before > d.u && !d.bounced) d.bounced = false;
    d.hand = (d.u < split ? d.from : d.to) > 0 ? 'L' : 'R';
    return pos;
  }

  /** Everything that is not running about: shots, dunks, passes, leaps. */
  action(a, p, ctx, ik, k) {
    const H = this.H;
    const out = {};
    const t = a.t;
    if (a.kind === 'shoot' || a.kind === 'ft') {
      out.rate = 22;
      const rise = clamp((t - 0.05) / (JUMPER_APEX - 0.05), 0, 1);
      const air = p.y > 0.02;
      // Dip, then up through the legs.
      out.crouch = t < 0.12 ? 0.1 * H * smooth(t / 0.12) : 0.1 * H * (1 - smooth(clamp((t - 0.12) / 0.14, 0, 1)));
      const knees = t < 0.12 ? 1.1 : (air ? 0.25 : 0.4);
      this.set('thighL', t < 0.12 ? -0.6 : -0.12, 0, 0.06);
      this.set('thighR', t < 0.12 ? -0.6 : -0.05, 0, -0.06);
      this.set('shinL', knees, 0, 0);
      this.set('shinR', knees, 0, 0);
      this.set('footL', air ? 0.45 : -0.3, 0, 0);
      this.set('footR', air ? 0.45 : -0.3, 0, 0);
      this.set('spine', t < 0.12 ? 0.25 : 0.02, 0, 0);
      if (!a.released) {
        const chest = new THREE.Vector3(0, 0.66 * H, 0.24 * k);
        const set = new THREE.Vector3(-0.04 * k, 1.18 * H - 0.04, 0.15);
        out.ball = chest.lerp(set, smooth(rise));
        // Shooting hand under it, guide hand on the side.
        ik.R = { local: out.ball.clone().add(new THREE.Vector3(0, -0.11 * k, -0.04 * k)), w: 1 };
        ik.L = { local: out.ball.clone().add(new THREE.Vector3(0.11 * k, -0.02, -0.02 * k)), w: 1 };
      } else {
        // Follow through: arm up and out, wrist down, held.
        this.set('upperArmR', -2.75, 0, -0.12);
        this.set('foreArmR', -0.08, 0, 0);
        this.set('handR', -1.1, 0, 0);
        this.set('upperArmL', -2.2, 0, 0.35);
        this.set('foreArmL', -0.5, 0, 0);
        this.set('handL', -0.4, 0, 0);
      }
      return out;
    }

    if (a.kind === 'layup') {
      out.rate = 18;
      const air = p.y > 0.02;
      const hand = (a.side || 1) > 0 ? 'L' : 'R';
      const sgn = hand === 'L' ? 1 : -1;
      // Knee drive on the side of the ball hand's opposite leg.
      const drive = hand === 'L' ? 'R' : 'L';
      const plant = hand;
      this.set(`thigh${drive}`, air ? -1.45 : -0.6, 0, 0);
      this.set(`shin${drive}`, air ? 1.7 : 0.8, 0, 0);
      this.set(`thigh${plant}`, air ? 0.25 : -0.2, 0, 0);
      this.set(`shin${plant}`, air ? 0.3 : 0.5, 0, 0);
      this.set('spine', 0.05, 0, 0);
      if (!a.released) {
        const r = clamp(t / 0.48, 0, 1);
        const from = new THREE.Vector3(sgn * 0.1 * k, 0.7 * H, 0.25 * k);
        const to = new THREE.Vector3(sgn * 0.08 * k, p.reach - 0.05, 0.3);
        out.ball = from.lerp(to, smooth(r));
        ik[hand] = { local: out.ball.clone().add(new THREE.Vector3(0, -0.1 * k, -0.03)), w: 1 };
        const other = hand === 'L' ? 'R' : 'L';
        if (r < 0.6) ik[other] = { local: out.ball.clone().add(new THREE.Vector3(-sgn * 0.1 * k, 0, -0.02)), w: 1 - r };
      } else {
        this.set(`upperArm${hand}`, -2.9, 0, sgn * 0.1);
        this.set(`foreArm${hand}`, -0.1, 0, 0);
        this.set(`hand${hand}`, -0.8, 0, 0);
      }
      return out;
    }

    if (a.kind === 'dunk') return this.dunk(a, p, ctx, ik, k, out);

    if (a.kind === 'jump') {
      out.rate = 20;
      const air = p.y > 0.02;
      out.crouch = !air && t < 0.12 ? 0.09 * H : 0;
      this.set('thighL', air ? -0.2 : -0.5, 0, 0.08);
      this.set('thighR', air ? -0.15 : -0.5, 0, -0.08);
      this.set('shinL', air ? 0.45 : 0.9, 0, 0);
      this.set('shinR', air ? 0.4 : 0.9, 0, 0);
      this.set('footL', air ? 0.5 : -0.3, 0, 0);
      this.set('footR', air ? 0.5 : -0.3, 0, 0);
      this.set('spine', 0.05, 0, 0);
      if (a.sub === 'block') {
        // Hands straight up, the near one higher, towards the ball.
        if (ctx.ball) {
          ik.R = { world: ctx.ball.clone().add(new THREE.Vector3(0, 0.08, 0)), w: 0.6 };
        }
        this.set('upperArmL', -2.95, 0, 0.12);
        this.set('upperArmR', -3.0, 0, -0.12);
        this.set('foreArmL', -0.1, 0, 0);
        this.set('foreArmR', -0.1, 0, 0);
      } else {
        // Rebound: both hands up for it.
        if (ctx.ball) {
          ik.L = { world: ctx.ball.clone().add(new THREE.Vector3(0.1, 0, 0)), w: 0.8 };
          ik.R = { world: ctx.ball.clone().add(new THREE.Vector3(-0.1, 0, 0)), w: 0.8 };
        }
      }
      return out;
    }

    if (a.kind === 'pass') {
      out.rate = 24;
      const r = clamp(t / 0.1, 0, 1);
      const chest = new THREE.Vector3(0, 0.66 * H, 0.22 * k);
      const reach = new THREE.Vector3(0, a.lob ? 1.15 * H : 0.68 * H, a.lob ? 0.35 : 0.55 * k);
      if (!a.released) {
        out.ball = chest.lerp(reach, r * r);
        this.twoHands(ik, out.ball, k);
      } else {
        // Arms out after it, thumbs down.
        this.set('upperArmL', a.lob ? -2.6 : -1.45, 0, 0.12);
        this.set('upperArmR', a.lob ? -2.6 : -1.45, 0, -0.12);
        this.set('foreArmL', -0.1, 0, 0);
        this.set('foreArmR', -0.1, 0, 0);
        this.set('handL', 0.3, 0, -0.6);
        this.set('handR', 0.3, 0, 0.6);
      }
      this.set('spine', 0.18, 0, 0);
      return out;
    }

    if (a.kind === 'catch') {
      out.ball = new THREE.Vector3(0, 0.66 * H, 0.3 * k);
      this.twoHands(ik, out.ball, k);
      return out;
    }

    if (a.kind === 'steal') {
      // A swipe low and forward with the right hand.
      out.rate = 26;
      const r = Math.sin(clamp(t / a.dur, 0, 1) * Math.PI);
      this.set('upperArmR', -1.3 * r - 0.2, 0, -0.25);
      this.set('foreArmR', -0.15, 0, 0);
      this.set('spine', 0.35 + 0.25 * r, -0.3 * r, 0);
      out.crouch = 0.08 * H;
      return out;
    }

    if (a.kind === 'celebrate') {
      out.rate = 12;
      const pump = Math.sin(t * 12) * 0.3;
      this.set('upperArmL', -2.6 + pump, 0, 0.5);
      this.set('upperArmR', -2.6 - pump, 0, -0.5);
      this.set('foreArmL', -1.2, 0, 0);
      this.set('foreArmR', -1.2, 0, 0);
      this.set('spine', -0.15, 0, 0);
      return out;
    }
    return out;
  }

  /**
   * The dunk. A gather, the leap with the ball where the style puts it, the
   * slam, the hang, the drop. The ball's drawn position meets the simulation's
   * at the slam, where it is released down through the ring.
   */
  dunk(a, p, ctx, ik, k, out) {
    const H = this.H;
    const t = a.t - (a.gather || 0);
    out.rate = 20;
    const air = p.y > 0.02;
    const toRim = new THREE.Vector3(RIM.x - p.x, 0, RIM.z - p.z);
    const style = a.style;
    // Body: gather low, then explode up with a knee drive.
    if (t < 0) {
      out.crouch = 0.12 * this.H;
      this.set('thighL', -0.7, 0, 0.05);
      this.set('thighR', -0.3, 0, -0.05);
      this.set('shinL', 1.2, 0, 0);
      this.set('shinR', 1.0, 0, 0);
      this.set('spine', 0.4, 0, 0);
      out.ball = new THREE.Vector3(0, 0.62 * H, 0.3 * k);
      this.twoHands(ik, out.ball, k);
      return out;
    }
    const k01 = clamp(t / a.flight, 0, 1);
    if (t < a.flight) {
      this.set('thighL', -1.3 * (1 - k01) - 0.2, 0, 0.1);
      this.set('shinL', 1.6 * (1 - k01) + 0.3, 0, 0);
      this.set('thighR', 0.35, 0, -0.05);
      this.set('shinR', 0.6 + 0.4 * k01, 0, 0);
      this.set('footL', 0.4, 0, 0);
      this.set('footR', 0.6, 0, 0);
      this.set('spine', 0.1 - 0.25 * k01, 0, 0);
      if (style === 'three60') out.yaw = (a.spin || 0);
      if (style === 'reverse') out.yaw = Math.PI * smooth(k01);
      if (!a.released && ctx.holder) {
        let ball;
        const top = new THREE.Vector3(0, p.reach - p.height * 0.02, 0.35);
        if (style === 'tomahawk') {
          // Cocked behind the head, then thrown down over it.
          const back = new THREE.Vector3(-0.08, p.reach - 0.05, -0.28);
          ball = back.lerp(top, smooth(clamp((k01 - 0.6) / 0.4, 0, 1)));
          ik.R = { local: ball.clone().add(new THREE.Vector3(0, 0.09, -0.06)), w: 1 };
        } else if (style === 'windmill') {
          const ang = -Math.PI * 0.5 + k01 * Math.PI * 2;
          const r = p.height * 0.42;
          ball = new THREE.Vector3(-0.2, 0.82 * H + Math.sin(ang) * r * 0.9, Math.cos(ang) * r);
          if (k01 > 0.85) ball.lerp(top, (k01 - 0.85) / 0.15);
          ik.R = { local: ball.clone().add(new THREE.Vector3(0, 0.1, -0.03)), w: 1 };
        } else if (style === 'one') {
          ball = new THREE.Vector3(-0.1, 0.7 * H, 0.3).lerp(top, smooth(k01));
          ik.R = { local: ball.clone().add(new THREE.Vector3(0, 0.1, -0.06)), w: 1 };
        } else {
          // Two hands, up and over.
          const from = a.alley ? top.clone() : new THREE.Vector3(0, 0.72 * H, 0.3);
          ball = from.lerp(top, smooth(k01));
          if (style === 'two' && !a.alley) ball.z -= Math.sin(k01 * Math.PI) * 0.35;
          this.twoHands(ik, ball, k);
        }
        // Meet the simulation where it lets go: just over the middle of the ring.
        const end = this.root.worldToLocal(new THREE.Vector3(RIM.x, RIM.y + 0.22, RIM.z));
        const blend = smooth(clamp((k01 - 0.7) / 0.3, 0, 1));
        ball.lerp(end, blend);
        out.ball = ball;
      } else if (a.alley && !ctx.holder) {
        // Reaching for the lob.
        if (ctx.ball) {
          ik.L = { world: ctx.ball.clone().add(new THREE.Vector3(0.1, 0, 0)), w: 1 };
          ik.R = { world: ctx.ball.clone().add(new THREE.Vector3(-0.1, 0, 0)), w: 1 };
        }
      }
      return out;
    }
    // Hanging on the ring.
    const h = t - a.flight;
    if (h < a.hang && !a.blocked) {
      const d = toRim.length() || 1;
      const front = ctx.hoop.rimPoint(-toRim.x / d, -toRim.z / d);
      const side = new THREE.Vector3(toRim.z / d, 0, -toRim.x / d).multiplyScalar(0.12);
      const both = style === 'two' || style === 'reverse' || style === 'three60' || a.alley;
      ik.R = { world: front.clone().add(side.clone().multiplyScalar(-1)), w: 1 };
      if (both) ik.L = { world: front.clone().add(side), w: 1 };
      else {
        this.set('upperArmL', -1.2, 0, 0.9);
        this.set('foreArmL', -1.0, 0, 0);
      }
      const swing = Math.sin(h * 14) * 0.25;
      this.set('thighL', -0.5 + swing, 0, 0.15);
      this.set('thighR', -0.3 + swing, 0, -0.15);
      this.set('shinL', 1.1, 0, 0);
      this.set('shinR', 0.9, 0, 0);
      this.set('spine', -0.15, 0, 0);
      if (style === 'reverse') out.yaw = Math.PI;
      if (style === 'three60') out.yaw = Math.PI * 2;
      return out;
    }
    // The drop and the landing.
    if (style === 'reverse') out.yaw = Math.PI;
    if (style === 'three60') out.yaw = Math.PI * 2;
    this.set('upperArmL', -0.6, 0, 0.7);
    this.set('upperArmR', -0.6, 0, -0.7);
    this.set('foreArmL', -0.8, 0, 0);
    this.set('foreArmR', -0.8, 0, 0);
    this.set('thighL', air ? -0.4 : -0.7, 0, 0.12);
    this.set('thighR', air ? -0.3 : -0.7, 0, -0.12);
    this.set('shinL', air ? 0.6 : 1.3, 0, 0);
    this.set('shinR', air ? 0.5 : 1.3, 0, 0);
    this.set('spine', air ? 0.0 : 0.45, 0, 0);
    if (!air) out.crouch = 0.13 * this.H;
    return out;
  }

  /**
   * Two-bone IK for an arm: the elbow goes out and down and a little back, the
   * hand goes to the target if it can reach and as far as it can if not.
   */
  solveArm(s, target, w) {
    const upper = this.j[`upperArm${s}`];
    const fore = this.j[`foreArm${s}`];
    const L1 = this.len.upper;
    const L2 = this.len.fore + this.len.hand * 0.45;
    const S = upper.getWorldPosition(_v1);
    const d = _v2.copy(target).sub(S);
    let dist = d.length();
    if (dist < 1e-4) return;
    const dn = d.divideScalar(dist);
    dist = clamp(dist, Math.abs(L1 - L2) + 0.02, (L1 + L2) * 0.999);
    // Pole: outward, down and back, in world space from the body's frame.
    const side = s === 'L' ? 1 : -1;
    const rootQ = this.root.getWorldQuaternion(_q1);
    const pole = _v3.set(side * 0.8, -0.6, -0.35).applyQuaternion(rootQ);
    pole.addScaledVector(dn, -pole.dot(dn)).normalize();
    const along = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, L1 * L1 - along * along));
    const E = _v4.copy(S).addScaledVector(dn, along).addScaledVector(pole, h);
    const T = _v5.copy(S).addScaledVector(dn, dist);
    const dir1 = _v6.copy(E).sub(S).normalize();
    const dir2 = _v7.copy(T).sub(E).normalize();
    const zAx = _v8.copy(dir2).addScaledVector(dir1, -dir2.dot(dir1));
    if (zAx.lengthSq() < 1e-6) zAx.copy(pole).multiplyScalar(-1);
    zAx.normalize();
    const yAx = _v9.copy(dir1).multiplyScalar(-1);
    const xAx = _v10.crossVectors(yAx, zAx).normalize();
    _m1.makeBasis(xAx, yAx, zAx);
    const qW = _q2.setFromRotationMatrix(_m1);
    const parentQ = upper.parent.getWorldQuaternion(_q3);
    const qLocal = parentQ.invert().multiply(qW);
    upper.quaternion.slerp(qLocal, w);
    const bend = Math.acos(clamp(dir1.dot(dir2), -1, 1));
    _q4.setFromEuler(_e1.set(-bend, 0, 0));
    fore.quaternion.slerp(_q4, w);
    upper.updateMatrixWorld(true);
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
  }
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _v6 = new THREE.Vector3();
const _v7 = new THREE.Vector3();
const _v8 = new THREE.Vector3();
const _v9 = new THREE.Vector3();
const _v10 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _q4 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _e1 = new THREE.Euler();

export { DT };
