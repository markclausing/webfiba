/**
 * The camera: a broadcast position behind the top of the court, following the
 * play; a push in low under the ring when somebody takes off for a dunk; a slow
 * orbit for the title screen; and a little shake when the building does.
 *
 * Everything is springs towards targets, so cutting between modes is a move,
 * not a jump.
 */

import * as THREE from 'three';
import { RIM } from '../game/court.js';

const v = (x, y, z) => new THREE.Vector3(x, y, z);

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'orbit';
    this.pos = v(0, 7, 18);
    this.look = v(0, 1.5, 3);
    this.focus = v(0, 0, 4);
    this.trauma = 0;
    this.punch = 0;
    this.punchFor = 0;
    this.punchFrom = v(1, 0, 1);
    this.time = 0;
    this.fov = 40;
    this.side = false;
  }

  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** A dunk is coming: go and get it. `from` is where the dunker took off. */
  dunkCam(from, length = 1.5) {
    this.punchFrom.set(from.x, 0, from.z);
    this.punchFor = length;
  }

  update(dt, ctx) {
    this.time += dt;
    const cam = this.camera;
    let wantPos;
    let wantLook;
    let fov = 40;
    const aspect = cam.aspect || 1.7;
    if (aspect < 1.2) fov = 58;
    else if (aspect < 1.5) fov = 46;

    if (this.mode === 'orbit') {
      const a = this.time * 0.07;
      const r = 15;
      wantPos = v(Math.sin(a) * r, 5.2 + Math.sin(this.time * 0.13) * 1.2, 4 + Math.cos(a) * r);
      wantLook = v(0, 2.0, 2.2);
      fov = 38;
    } else if (this.mode === 'replay') {
      // Low on the baseline, off to the side, looking up at the ring.
      const s = ctx.replaySide || 1;
      wantPos = v(s * 5.5, 1.6, -0.6 + Math.sin(this.time * 0.4) * 0.3);
      wantLook = ctx.ball ? ctx.ball.clone().lerp(v(RIM.x, RIM.y - 0.4, RIM.z), 0.5) : v(0, 2.6, 0.5);
      fov = 44;
    } else {
      // Broadcast: follow a point between the ball and the man you control.
      const b = ctx.ball || v(0, 0, 4);
      const me = ctx.player || b;
      const fx = THREE.MathUtils.clamp(b.x * 0.75 + me.x * 0.25, -4.5, 4.5);
      const fz = THREE.MathUtils.clamp(b.z * 0.75 + me.z * 0.25, 0.4, 7.2);
      this.focus.x += (fx - this.focus.x) * Math.min(1, dt * 2.6);
      this.focus.z += (fz - this.focus.z) * Math.min(1, dt * 2.2);
      const f = this.focus;
      if (this.side) {
        wantPos = v(15.5, 5.6, f.z * 0.8 + 3.2);
        wantLook = v(f.x * 0.6 - 0.5, 1.2, f.z * 0.85 + 0.6);
      } else {
        wantPos = v(f.x * 0.6, 4.7 + f.z * 0.1, f.z + 9.2);
        wantLook = v(f.x * 0.85, 1.1, f.z - 1.8);
      }
    }

    // Dunk push-in: low and to the side of the ring, looking up.
    if (this.punchFor > 0) {
      this.punchFor -= dt;
      this.punch = Math.min(1, this.punch + dt * 4);
    } else {
      this.punch = Math.max(0, this.punch - dt * 1.8);
    }
    if (this.punch > 0 && this.mode === 'broadcast') {
      const d = this.punchFrom.clone().normalize();
      if (d.lengthSq() < 0.01) d.set(0, 0, 1);
      // Rotate the approach 55 degrees towards the camera side.
      const s = d.x >= 0 ? 1 : -1;
      const ang = 0.95 * s;
      const rx = d.x * Math.cos(ang) - d.z * Math.sin(ang);
      const rz = d.x * Math.sin(ang) + d.z * Math.cos(ang);
      const pp = v(RIM.x + rx * 6.2, 1.9, Math.max(1.5, RIM.z + rz * 6.2 + 2.2));
      const pl = v(RIM.x + d.x * 0.6, RIM.y - 0.35, RIM.z + d.z * 0.6);
      const e = this.punch * this.punch * (3 - 2 * this.punch) * 0.8;
      wantPos.lerp(pp, e);
      wantLook.lerp(pl, e);
      fov += e * 6;
    }

    const kp = this.mode === 'orbit' ? 1.2 : 5.5;
    this.pos.lerp(wantPos, Math.min(1, dt * kp));
    this.look.lerp(wantLook, Math.min(1, dt * (kp + 2)));
    this.fov += (fov - this.fov) * Math.min(1, dt * 3);

    cam.position.copy(this.pos);
    cam.lookAt(this.look);
    // Shake: trauma squared, smooth noise.
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const s = this.trauma * this.trauma;
    if (s > 0) {
      const t = this.time * 32;
      cam.position.x += (Math.sin(t * 1.1) + Math.sin(t * 2.3) * 0.5) * 0.08 * s;
      cam.position.y += (Math.sin(t * 1.7 + 1) + Math.sin(t * 2.9) * 0.5) * 0.08 * s;
      cam.rotation.z += Math.sin(t * 1.3 + 2) * 0.02 * s;
    }
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
