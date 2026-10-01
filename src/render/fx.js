/**
 * The things on screen that are not things: the ring under your man, the
 * marker on who the pass will go to, the light trail behind a ball that is
 * moving well, sparks off the iron after a slam, a shockwave on the floor where
 * the dunker lands.
 */

import * as THREE from 'three';
import { radialTexture } from './textures.js';

export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;

    // Your man.
    const ringGeo = new THREE.RingGeometry(0.42, 0.52, 48);
    ringGeo.rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xff6a13, transparent: true, opacity: 0.9, depthWrite: false });
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring.renderOrder = 3;
    const arrowGeo = new THREE.BufferGeometry();
    arrowGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.13, 0, 0.58, 0.13, 0, 0.58, 0, 0, 0.8], 3));
    arrowGeo.computeVertexNormals();
    this.arrow = new THREE.Mesh(arrowGeo, this.ringMat);
    this.ring.add(this.arrow);
    scene.add(this.ring);

    // Who the pass would go to.
    const tGeo = new THREE.RingGeometry(0.34, 0.4, 40, 1, 0, Math.PI * 2);
    tGeo.rotateX(-Math.PI / 2);
    this.targetMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false });
    this.target = new THREE.Mesh(tGeo, this.targetMat);
    this.target.renderOrder = 3;
    scene.add(this.target);

    // Trail behind the ball: a string of glowing points.
    this.trailN = 40;
    this.trailPos = new Float32Array(this.trailN * 3);
    this.trailAge = new Float32Array(this.trailN).fill(9);
    this.trailHead = 0;
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    tg.setAttribute('aAge', new THREE.BufferAttribute(this.trailAge, 1));
    this.trailMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xff6a13) }, uLife: { value: 0.45 } },
      vertexShader: /* glsl */`
        attribute float aAge; uniform float uLife; varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vA = clamp(1.0 - aAge / uLife, 0.0, 1.0);
          gl_PointSize = min(24.0, (70.0 * vA) / max(0.5, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = exp(-dot(c, c) * 14.0);
          gl_FragColor = vec4(uColor * d * vA * 0.18, 1.0);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.trail = new THREE.Points(tg, this.trailMat);
    this.trail.frustumCulled = false;
    scene.add(this.trail);
    this.trailOn = 0;

    // Sparks.
    this.sparkN = 160;
    this.sparkPos = new Float32Array(this.sparkN * 3);
    this.sparkVel = new Float32Array(this.sparkN * 3);
    this.sparkLife = new Float32Array(this.sparkN);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    sg.setAttribute('aLife', new THREE.BufferAttribute(this.sparkLife, 1));
    this.sparkMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(1, 0.7, 0.3) } },
      vertexShader: /* glsl */`
        attribute float aLife; varying float vL;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vL = aLife;
          gl_PointSize = min(30.0, (60.0 * clamp(aLife, 0.0, 1.0)) / max(0.5, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; varying float vL;
        void main() {
          if (vL <= 0.0) discard;
          vec2 c = gl_PointCoord - 0.5;
          float d = exp(-dot(c, c) * 20.0);
          gl_FragColor = vec4(uColor * d * 5.0 * vL, 1.0);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.sparks = new THREE.Points(sg, this.sparkMat);
    this.sparks.frustumCulled = false;
    scene.add(this.sparks);
    this.sparkNext = 0;

    // Shockwaves on the floor.
    this.waves = [];
    this.waveTex = radialTexture('rgba(255,255,255,0)', 'rgba(255,255,255,0)');
    const wc = document.createElement('canvas');
    wc.width = 256;
    wc.height = 256;
    const g = wc.getContext('2d');
    const grd = g.createRadialGradient(128, 128, 80, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.7, 'rgba(255,255,255,0.9)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    this.waveTex = new THREE.CanvasTexture(wc);

    // Player contact shadows.
    this.blobTex = radialTexture('rgba(0,0,0,0.6)');
    this.blobs = [];
  }

  blobFor(i) {
    if (!this.blobs[i]) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: this.blobTex, transparent: true, depthWrite: false }),
      );
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 1;
      this.scene.add(m);
      this.blobs[i] = m;
    }
    return this.blobs[i];
  }

  setRing(player, colour, visible) {
    this.ring.visible = visible && Boolean(player);
    if (!player) return;
    this.ringMat.color.set(colour);
    this.ring.position.set(player.x, 0.012, player.z);
    this.ring.rotation.y = player.face;
    const pulse = 1 + Math.sin(this.time * 6) * 0.04;
    this.ring.scale.setScalar(pulse);
  }

  setTarget(player, colour, strength) {
    this.targetMat.opacity += ((player ? strength : 0) - this.targetMat.opacity) * 0.25;
    this.target.visible = this.targetMat.opacity > 0.02;
    if (!player) return;
    this.targetMat.color.set(colour);
    this.target.position.set(player.x, 0.013, player.z);
    this.target.scale.setScalar(1 + Math.sin(this.time * 9) * 0.06);
  }

  trailColour(c) {
    this.trailMat.uniforms.uColor.value.set(c);
  }

  /** Feed the trail one point a frame while `on` is above zero. */
  updateTrail(dt, pos, on) {
    for (let i = 0; i < this.trailN; i++) this.trailAge[i] += dt;
    this.trailOn = on;
    // Only where the ball has actually gone: points piled on one spot add up to a white blob.
    const lastI = (this.trailHead + this.trailN - 1) % this.trailN;
    const moved = Math.hypot(pos.x - this.trailPos[lastI * 3], pos.y - this.trailPos[lastI * 3 + 1], pos.z - this.trailPos[lastI * 3 + 2]);
    if (on > 0 && moved > 0.12) {
      const i = this.trailHead;
      this.trailPos[i * 3] = pos.x;
      this.trailPos[i * 3 + 1] = pos.y;
      this.trailPos[i * 3 + 2] = pos.z;
      this.trailAge[i] = 0.45 - 0.45 * on;
      this.trailHead = (i + 1) % this.trailN;
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.attributes.aAge.needsUpdate = true;
  }

  burst(pos, n = 60, speed = 4, colour = 0xffb050) {
    this.sparkMat.uniforms.uColor.value.set(colour);
    for (let k = 0; k < n; k++) {
      const i = this.sparkNext;
      this.sparkNext = (i + 1) % this.sparkN;
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 0.9 + 0.1;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.sparkPos[i * 3] = pos.x;
      this.sparkPos[i * 3 + 1] = pos.y;
      this.sparkPos[i * 3 + 2] = pos.z;
      this.sparkVel[i * 3] = Math.cos(a) * Math.sqrt(1 - u * u) * s;
      this.sparkVel[i * 3 + 1] = u * s * 0.8;
      this.sparkVel[i * 3 + 2] = Math.sin(a) * Math.sqrt(1 - u * u) * s;
      this.sparkLife[i] = 0.6 + Math.random() * 0.6;
    }
  }

  shockwave(x, z, colour = 0xffffff, size = 4) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.waveTex, color: colour, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.015, z);
    m.renderOrder = 4;
    this.scene.add(m);
    this.waves.push({ m, t: 0, size });
  }

  update(dt) {
    this.time += dt;
    for (let i = 0; i < this.sparkN; i++) {
      if (this.sparkLife[i] <= 0) continue;
      this.sparkLife[i] -= dt * 1.4;
      this.sparkVel[i * 3 + 1] -= 9.8 * dt;
      this.sparkPos[i * 3] += this.sparkVel[i * 3] * dt;
      this.sparkPos[i * 3 + 1] += this.sparkVel[i * 3 + 1] * dt;
      this.sparkPos[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt;
      if (this.sparkPos[i * 3 + 1] < 0.02) {
        this.sparkPos[i * 3 + 1] = 0.02;
        this.sparkVel[i * 3 + 1] *= -0.4;
      }
    }
    this.sparks.geometry.attributes.position.needsUpdate = true;
    this.sparks.geometry.attributes.aLife.needsUpdate = true;

    for (const w of this.waves) {
      w.t += dt;
      const k = w.t / 0.7;
      w.m.scale.setScalar(0.5 + k * w.size);
      w.m.material.opacity = Math.max(0, 1 - k) * 0.9;
    }
    const done = this.waves.filter((w) => w.t >= 0.7);
    for (const w of done) {
      this.scene.remove(w.m);
      w.m.geometry.dispose();
      w.m.material.dispose();
    }
    this.waves = this.waves.filter((w) => w.t < 0.7);
  }

  updateBlobs(players) {
    players.forEach((p, i) => {
      const b = this.blobFor(i);
      const h = p.y;
      const s = 1.0 + h * 0.4;
      b.scale.set(s, s, s);
      b.position.set(p.x, 0.003, p.z);
      b.material.opacity = Math.max(0.15, 0.8 - h * 0.6);
    });
  }
}
