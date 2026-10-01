/**
 * The basket: stanchion, glass, ring, net, and the shot clock on top of the
 * board where 3x3 puts it.
 *
 * The net is cloth - a grid of knots joined by cords, integrated with Verlet and
 * pushed out of the ball's way - because the net is where a make is felt. A
 * swish should snap it, a dunk should whip it, a ball rattling round should
 * shake it. The ring flexes on a spring when it is hit and bends right down
 * when somebody hangs on it.
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { COURT, RIM } from '../game/court.js';
import { canvas } from './textures.js';

const ROWS = 7;
const COLS = 14;
const NET_LEN = 0.44;

export class Hoop {
  constructor(scene, teamColour = 0xff6a13) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.rimTilt = 0;
    this.rimVel = 0;
    this.boardShake = 0;
    this.boardVel = 0;
    this.hang = 0;
    this.buildStanchion(teamColour);
    this.buildBoard();
    this.buildRim();
    this.buildNet();
    this.buildShotClock();
  }

  buildStanchion(teamColour) {
    const steel = new THREE.MeshStandardMaterial({ color: 0x1b1e24, roughness: 0.35, metalness: 0.85 });
    const pad = new THREE.MeshPhysicalMaterial({ color: 0x15171c, roughness: 0.6, sheen: 0.5, sheenColor: 0x555a66, clearcoat: 0.25 });
    const stripe = new THREE.MeshPhysicalMaterial({ color: teamColour, roughness: 0.5, clearcoat: 0.3 });
    const base = new THREE.Mesh(new RoundedBoxGeometry(2.0, 1.15, 2.6, 4, 0.12), pad);
    base.position.set(0, 0.575, -3.75);
    base.castShadow = true;
    base.receiveShadow = true;
    this.group.add(base);
    // Front pad facing the court.
    const front = new THREE.Mesh(new RoundedBoxGeometry(1.9, 1.3, 0.35, 4, 0.12), pad);
    front.position.set(0, 0.65, -2.35);
    front.castShadow = true;
    this.group.add(front);
    // A band of team colour round the pads, which is all the colour they need.
    for (const [w, h, d, x, y, z] of [[2.02, 0.12, 2.62, 0, 0.95, -3.75], [1.92, 0.12, 0.37, 0, 1.1, -2.35]]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stripe);
      band.position.set(x, y, z);
      this.group.add(band);
    }
    // The arm: up from the base and over to the back of the board.
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 1.1, -3.6),
      new THREE.Vector3(0, 2.6, -3.5),
      new THREE.Vector3(0, 3.55, -2.9),
      new THREE.Vector3(0, 3.85, -1.6),
      new THREE.Vector3(0, 3.6, -0.6),
    ]);
    const arm = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.11, 16, false), steel);
    arm.castShadow = true;
    this.group.add(arm);
    // Padded post wrap, team colour.
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 1.3, 24), pad);
    wrap.position.set(0, 1.75, -3.55);
    wrap.castShadow = true;
    this.group.add(wrap);
    // Brace from arm to board back.
    const brace = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.08), steel);
    brace.position.set(0, 3.55, -0.5);
    this.group.add(brace);
  }

  buildBoard() {
    const board = new THREE.Group();
    // Pivot at the back of the board, for the shake.
    board.position.set(0, (COURT.BOARD_BOTTOM + COURT.BOARD_TOP) / 2, COURT.BOARD_Z - COURT.BOARD_THICK / 2);
    this.board = board;
    this.group.add(board);
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: 0.04,
      transmission: 1,
      thickness: 0.03,
      ior: 1.5,
      transparent: true,
      opacity: 1,
      envMapIntensity: 1.2,
      specularIntensity: 1,
    });
    const w = COURT.BOARD_HALF_W * 2;
    const h = COURT.BOARD_TOP - COURT.BOARD_BOTTOM;
    const pane = new THREE.Mesh(new THREE.BoxGeometry(w, h, COURT.BOARD_THICK), glass);
    board.add(pane);
    // The white border and the shooter's square, painted on the glass.
    const c = canvas(1024, 600);
    const g = c.getContext('2d');
    g.clearRect(0, 0, 1024, 600);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 28;
    g.strokeRect(14, 14, 1024 - 28, 600 - 28);
    const sqW = (0.59 / w) * 1024;
    const sqH = (0.45 / h) * 600;
    const sqBottom = ((RIM.y - COURT.BOARD_BOTTOM + 0.0) / h) * 600;
    g.lineWidth = 26;
    g.strokeRect(512 - sqW / 2, 600 - sqBottom - sqH, sqW, sqH);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.3, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.15 }),
    );
    decal.position.z = COURT.BOARD_THICK / 2 + 0.001;
    board.add(decal);
    // Steel frame round the glass and the padded bottom edge.
    const frame = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.3, metalness: 0.9 });
    const bottomPad = new THREE.Mesh(new RoundedBoxGeometry(w + 0.04, 0.08, 0.09, 3, 0.03), new THREE.MeshStandardMaterial({ color: 0x0d0e12, roughness: 0.7 }));
    bottomPad.position.y = -h / 2 - 0.03;
    board.add(bottomPad);
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.035, h, 0.05), frame);
      side.position.x = sx * (w / 2 + 0.015);
      board.add(side);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.07, 0.035, 0.05), frame);
    top.position.y = h / 2 + 0.015;
    board.add(top);
  }

  buildRim() {
    // The ring pivots at the bracket on the board, which is what a breakaway
    // ring does when you hang on it.
    const pivot = new THREE.Group();
    pivot.position.set(0, RIM.y, COURT.BOARD_Z);
    this.rimPivot = pivot;
    this.group.add(pivot);
    const orange = new THREE.MeshStandardMaterial({ color: 0xff4a12, roughness: 0.32, metalness: 0.75 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(COURT.RIM_R + COURT.RIM_TUBE, COURT.RIM_TUBE, 16, 72), orange);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(RIM.x, 0, RIM.z - COURT.BOARD_Z);
    ring.castShadow = true;
    pivot.add(ring);
    this.ring = ring;
    // Bracket.
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.16), orange);
    bracket.position.set(0, -0.015, 0.08);
    pivot.add(bracket);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.02), orange);
    plate.position.set(0, -0.08, 0.01);
    pivot.add(plate);
    // Hooks for the net, round the underside.
    const hookGeo = new THREE.TorusGeometry(0.012, 0.003, 4, 8);
    for (let i = 0; i < COLS; i++) {
      const a = (i / COLS) * Math.PI * 2;
      const hook = new THREE.Mesh(hookGeo, orange);
      hook.position.set(Math.sin(a) * (COURT.RIM_R + 0.005), -0.012, RIM.z - COURT.BOARD_Z + Math.cos(a) * (COURT.RIM_R + 0.005));
      pivot.add(hook);
    }
  }

  /** Knots in rows, each row offset by half a step: the diamond pattern of a real net. */
  buildNet() {
    const n = ROWS * COLS;
    this.knots = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.rest = [];
    const R0 = COURT.RIM_R - 0.004;
    for (let r = 0; r < ROWS; r++) {
      const k = r / (ROWS - 1);
      const radius = R0 * (1 - 0.42 * k) + 0.012 * Math.sin(k * Math.PI);
      const y = RIM.y - 0.01 - k * NET_LEN;
      for (let c = 0; c < COLS; c++) {
        const a = ((c + (r % 2) * 0.5) / COLS) * Math.PI * 2;
        const i = (r * COLS + c) * 3;
        this.knots[i] = RIM.x + Math.sin(a) * radius;
        this.knots[i + 1] = y;
        this.knots[i + 2] = RIM.z + Math.cos(a) * radius;
      }
    }
    this.prev.set(this.knots);
    this.top = this.knots.slice(0, COLS * 3);
    // Cords: each knot to the two below it.
    this.cords = [];
    for (let r = 0; r < ROWS - 1; r++) {
      for (let c = 0; c < COLS; c++) {
        const a = r * COLS + c;
        const below = [(r + 1) * COLS + c, (r + 1) * COLS + ((c + (r % 2 ? 1 : -1) + COLS) % COLS)];
        for (const b of below) {
          const d = Math.hypot(
            this.knots[a * 3] - this.knots[b * 3],
            this.knots[a * 3 + 1] - this.knots[b * 3 + 1],
            this.knots[a * 3 + 2] - this.knots[b * 3 + 2],
          );
          this.cords.push([a, b, d]);
        }
      }
    }
    // Keep the bottom row from collapsing in on itself.
    for (let c = 0; c < COLS; c++) {
      const a = (ROWS - 1) * COLS + c;
      const b = (ROWS - 1) * COLS + ((c + 1) % COLS);
      const d = Math.hypot(this.knots[a * 3] - this.knots[b * 3], this.knots[a * 3 + 2] - this.knots[b * 3 + 2]);
      this.cords.push([a, b, d]);
    }
    const geo = new THREE.CylinderGeometry(0.0045, 0.0045, 1, 5, 1, true);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xf8f8f4, roughness: 0.85, emissive: 0x222222 });
    this.netMesh = new THREE.InstancedMesh(geo, mat, this.cords.length);
    this.netMesh.frustumCulled = false;
    this.netMesh.castShadow = true;
    this.group.add(this.netMesh);
    this.tmpM = new THREE.Matrix4();
    this.tmpQ = new THREE.Quaternion();
    this.tmpA = new THREE.Vector3();
    this.tmpB = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
  }

  buildShotClock() {
    const c = canvas(512, 160);
    this.clockCanvas = c;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.clockTex = tex;
    const box = new THREE.Mesh(
      new RoundedBoxGeometry(0.62, 0.22, 0.14, 3, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x0a0b0e, roughness: 0.4, metalness: 0.4 }),
    );
    box.position.set(0, COURT.BOARD_TOP + 0.14, COURT.BOARD_Z - 0.04);
    this.group.add(box);
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(0.56, 0.175),
      new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 2.2 }),
    );
    face.position.set(0, COURT.BOARD_TOP + 0.14, COURT.BOARD_Z + 0.031);
    this.group.add(face);
    this.lastClock = '';
    this.setClock(12, '10:00');
  }

  /** Shot clock in red, game clock in amber, as the tour hangs them on the glass. */
  setClock(shot, game) {
    const s = String(Math.ceil(Math.max(0, shot)));
    const key = `${s}|${game}`;
    if (key === this.lastClock) return;
    this.lastClock = key;
    const g = this.clockCanvas.getContext('2d');
    g.fillStyle = '#050505';
    g.fillRect(0, 0, 512, 160);
    g.textBaseline = 'middle';
    g.font = '700 118px "JetBrains Mono", "DSEG7 Classic", Menlo, monospace';
    g.textAlign = 'right';
    g.fillStyle = Number(s) <= 5 ? '#ff2a1a' : '#ff3b2a';
    g.fillText(s.padStart(2, ' '), 190, 84);
    g.textAlign = 'left';
    g.fillStyle = '#ffb21a';
    g.font = '700 84px "JetBrains Mono", Menlo, monospace';
    g.fillText(game, 228, 86);
    this.clockTex.needsUpdate = true;
  }

  /** A knock on the iron: power in m/s of the ball's speed into it. */
  hitRim(power) {
    this.rimVel -= Math.min(4, power) * 0.6;
    this.boardVel += Math.min(4, power) * 0.05;
  }

  hitBoard(power = 2) {
    this.boardVel += power * 0.2;
  }

  /** Somebody is hanging on it: 0..1. */
  setHang(amount) {
    this.hang = amount;
  }

  slam() {
    this.rimVel -= 7;
    this.boardVel += 1.6;
    // Whip the net: kick every knot downward.
    for (let i = 0; i < this.knots.length; i += 3) {
      this.prev[i + 1] += 0.025 * (i / this.knots.length);
    }
  }

  update(dt, ball) {
    // Ring: a damped spring on the hinge, pulled down by whoever hangs on it.
    const target = -0.28 * this.hang;
    const k = 260;
    const c = 9;
    this.rimVel += ((target - this.rimTilt) * k - this.rimVel * c) * dt;
    this.rimTilt += this.rimVel * dt;
    this.rimTilt = Math.max(-0.4, Math.min(0.15, this.rimTilt));
    this.rimPivot.rotation.x = -this.rimTilt;
    // Board: a stiffer, faster wobble.
    this.boardVel += (-this.boardShake * 900 - this.boardVel * 14) * dt;
    this.boardShake += this.boardVel * dt;
    this.board.rotation.x = this.boardShake * 0.05;
    this.board.position.y = (COURT.BOARD_BOTTOM + COURT.BOARD_TOP) / 2 + this.boardShake * 0.004;

    this.stepNet(Math.min(dt, 1 / 30), ball);
    this.drawNet();
  }

  stepNet(dt, ball) {
    const kn = this.knots;
    const pv = this.prev;
    const g = -9.81 * dt * dt;
    const damp = 0.965;
    // The top row rides on the ring as it tilts.
    const pivotZ = COURT.BOARD_Z;
    // The same hinge angle the ring is drawn with.
    const cos = Math.cos(-this.rimTilt);
    const sin = Math.sin(-this.rimTilt);
    for (let c = 0; c < COLS; c++) {
      const i = c * 3;
      const lz = this.top[i + 2] - pivotZ;
      const ly = this.top[i + 1] - RIM.y;
      kn[i] = this.top[i];
      kn[i + 1] = RIM.y + ly * cos - lz * sin;
      kn[i + 2] = pivotZ + ly * sin + lz * cos;
      pv[i] = kn[i];
      pv[i + 1] = kn[i + 1];
      pv[i + 2] = kn[i + 2];
    }
    for (let i = COLS * 3; i < kn.length; i += 3) {
      const x = kn[i];
      const y = kn[i + 1];
      const z = kn[i + 2];
      kn[i] += (x - pv[i]) * damp;
      kn[i + 1] += (y - pv[i + 1]) * damp + g;
      kn[i + 2] += (z - pv[i + 2]) * damp;
      pv[i] = x;
      pv[i + 1] = y;
      pv[i + 2] = z;
    }
    const br = COURT.BALL_R + 0.012;
    for (let it = 0; it < 6; it++) {
      for (const [a, b, rest] of this.cords) {
        const ia = a * 3;
        const ib = b * 3;
        const dx = kn[ib] - kn[ia];
        const dy = kn[ib + 1] - kn[ia + 1];
        const dz = kn[ib + 2] - kn[ia + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        if (d < rest * 0.6 && it > 0) continue; // cords go slack, they do not push
        const diff = (d - rest) / d;
        const wa = a < COLS ? 0 : 0.5;
        const wb = b < COLS ? 0 : 0.5;
        const s = wa + wb || 1;
        const corr = d > rest ? 1 : 0.15;
        kn[ia] += dx * diff * (wa / s) * corr;
        kn[ia + 1] += dy * diff * (wa / s) * corr;
        kn[ia + 2] += dz * diff * (wa / s) * corr;
        kn[ib] -= dx * diff * (wb / s) * corr;
        kn[ib + 1] -= dy * diff * (wb / s) * corr;
        kn[ib + 2] -= dz * diff * (wb / s) * corr;
      }
      // The ball pushes the cords out of its way.
      if (ball) {
        for (let i = COLS * 3; i < kn.length; i += 3) {
          const dx = kn[i] - ball.x;
          const dy = kn[i + 1] - ball.y;
          const dz = kn[i + 2] - ball.z;
          const d = Math.hypot(dx, dy, dz);
          if (d < br && d > 1e-5) {
            const push = (br - d) / d;
            kn[i] += dx * push;
            kn[i + 1] += dy * push;
            kn[i + 2] += dz * push;
          }
        }
      }
    }
  }

  drawNet() {
    const kn = this.knots;
    const m = this.tmpM;
    const a = this.tmpA;
    const b = this.tmpB;
    const scale = new THREE.Vector3();
    this.cords.forEach(([ia, ib], i) => {
      a.set(kn[ia * 3], kn[ia * 3 + 1], kn[ia * 3 + 2]);
      b.set(kn[ib * 3], kn[ib * 3 + 1], kn[ib * 3 + 2]);
      const len = a.distanceTo(b);
      b.sub(a).normalize();
      this.tmpQ.setFromUnitVectors(this.up, b);
      scale.set(1, len, 1);
      m.compose(a, this.tmpQ, scale);
      this.netMesh.setMatrixAt(i, m);
    });
    this.netMesh.instanceMatrix.needsUpdate = true;
  }

  /** Where the front of the ring is now, for a hand hanging on it. */
  rimPoint(dirX, dirZ) {
    const p = new THREE.Vector3(RIM.x + dirX * COURT.RIM_R, RIM.y, RIM.z + dirZ * COURT.RIM_R);
    const lz = p.z - COURT.BOARD_Z;
    p.y = RIM.y - lz * Math.sin(-this.rimTilt);
    p.z = COURT.BOARD_Z + lz * Math.cos(-this.rimTilt);
    return p;
  }
}
