/**
 * The ball as drawn: pebbled leather, black channels, spinning the way a ball
 * spins - backspin off a shooter's fingers, topspin rolling on the floor - and
 * a soft contact shadow under it that tightens as it nears the floor.
 */

import * as THREE from 'three';
import { COURT } from '../game/court.js';
import { ballTextures, radialTexture } from './textures.js';

export class BallView {
  constructor(scene) {
    const { map, normal } = ballTextures();
    const mat = new THREE.MeshPhysicalMaterial({
      map,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughness: 0.62,
      metalness: 0,
      clearcoat: 0.12,
      clearcoatRoughness: 0.6,
      sheen: 0.4,
      sheenColor: new THREE.Color(0xffb27a),
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(COURT.BALL_R, 64, 40), mat);
    this.mesh.castShadow = true;
    scene.add(this.mesh);
    this.blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: radialTexture('rgba(0,0,0,0.75)'), transparent: true, depthWrite: false }),
    );
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.renderOrder = 2;
    scene.add(this.blob);
    this.pos = new THREE.Vector3(0, 1, 5);
    this.prev = this.pos.clone();
    this.omega = new THREE.Vector3();
    this.offset = new THREE.Vector3();
  }

  /**
   * `drawn` is where the hands say the ball is, when somebody holds it;
   * otherwise the simulation's position. When it leaves a hand the difference
   * between the two melts away over a tenth of a second rather than jumping.
   */
  update(dt, simPos, simVel, drawn, mode) {
    let target;
    if (drawn) {
      target = drawn;
      this.offset.set(0, 0, 0);
      this.held = true;
    } else {
      if (this.held) {
        this.offset.copy(this.pos).sub(simPos);
        this.held = false;
      }
      this.offset.multiplyScalar(Math.exp(-dt * 22));
      target = simPos.clone().add(this.offset);
    }
    this.prev.copy(this.pos);
    this.pos.copy(target);

    // Spin. Rolling on the floor: topspin from the speed. In the air: keep what
    // it had. Coming off a shooter: backspin.
    const v = dt > 0 ? this.pos.clone().sub(this.prev).divideScalar(dt) : new THREE.Vector3();
    const R = COURT.BALL_R;
    if (this.pos.y < R + 0.02) {
      this.omega.set(v.z / R, 0, -v.x / R);
    } else if (mode === 'shot' && this.lastMode !== 'shot') {
      const h = new THREE.Vector3(simVel.x, 0, simVel.z).normalize();
      // Backspin: the top of the ball turns back towards the shooter.
      this.omega.set(-h.z, 0, h.x).multiplyScalar(-14);
    } else if (drawn) {
      this.omega.set(v.z / R, 0, -v.x / R).multiplyScalar(0.5);
    }
    this.lastMode = mode;
    const ang = this.omega.length() * dt;
    if (ang > 1e-5) {
      const q = new THREE.Quaternion().setFromAxisAngle(this.omega.clone().normalize(), ang);
      this.mesh.quaternion.premultiply(q);
    }
    this.mesh.position.copy(this.pos);

    const h = Math.max(0, this.pos.y - R);
    const s = 0.24 + h * 0.18;
    this.blob.scale.set(s, s, s);
    this.blob.position.set(this.pos.x, 0.004, this.pos.z);
    this.blob.material.opacity = Math.max(0, 0.85 - h * 0.35);
  }
}
