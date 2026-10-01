/**
 * The building: a hardwood half court under arena lights, a crowd on three
 * sides, LED boards, a video wall over the far stand, haze in the light.
 *
 * The floor is drawn entirely in its shader - planks, grain, seams, stain, the
 * lines - from the same numbers the simulation uses, so a line is razor sharp
 * at any distance and in any replay, and the arc on the floor is exactly the arc
 * the rules measure.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COURT } from '../game/court.js';
import { textTexture, ledTexture, canvas, hex } from './textures.js';

const FLOOR_GLSL = /* glsl */`
uniform vec3 uStain;
uniform vec3 uPaint;
uniform vec3 uApron;
uniform vec3 uLineCol;
uniform sampler2D uLogo;
uniform vec4 uLogoRect;
uniform sampler2D tMirror;
uniform float uMirrorOn;
uniform float uMirrorStrength;
uniform float uFlow;
uniform vec3 uFlowCol;
uniform float uTime;
varying vec3 vWorldPos;
varying vec4 vMirrorUv;

float fh11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float fh21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = fh21(i), b = fh21(i + vec2(1.0, 0.0)), c = fh21(i + vec2(0.0, 1.0)), d = fh21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float ffbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * fnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
float lineAA(float d, float w) {
  float fw = max(fwidth(d), 1e-4);
  return 1.0 - smoothstep(w - fw, w + fw, d);
}
float inside(float sd) {
  float fw = max(fwidth(sd), 1e-4);
  return 1.0 - smoothstep(-fw, fw, sd);
}

float floorRough;
float floorCoat;
vec3 floorNormalW;

vec3 floorColor(vec3 wp) {
  vec2 p = wp.xz;
  // --- planks, running from the basket to the top of the court
  float pw = 0.0572;
  float px = p.x / pw;
  float pi = floor(px);
  float pf = fract(px);
  float hA = fh11(pi);
  float plen = 1.3 + 2.2 * fh11(pi + 7.13);
  float pz = (p.y + hA * 9.0) / plen;
  float pj = floor(pz);
  float pzf = fract(pz);
  float hB = fh21(vec2(pi, pj));
  vec3 light = vec3(0.74, 0.40, 0.16);
  vec3 dark = vec3(0.55, 0.26, 0.09);
  vec3 wood = mix(dark, light, 0.35 + 0.65 * hB);
  float grain = ffbm(vec2(p.x * 70.0 + hB * 30.0, p.y * 2.2 + hB * 11.0));
  float fine = fnoise(vec2(p.x * 400.0, p.y * 9.0 + hB * 40.0));
  wood *= 0.82 + 0.3 * grain + 0.06 * fine;
  // Knots, rarely.
  vec2 kp = vec2(pf - 0.5, (pzf - fh11(pj + pi) ) * plen / pw);
  wood *= 1.0 - 0.35 * smoothstep(0.9, 0.0, length(kp * vec2(1.0, 0.25))) * step(0.93, fh21(vec2(pi, pj + 3.0)));

  // Seams between planks, faded out where they would shimmer.
  float sx = min(pf, 1.0 - pf) * pw;
  float sz = min(pzf, 1.0 - pzf) * plen;
  float fwx = fwidth(px);
  float seamFade = clamp(1.0 - fwx * 3.0, 0.0, 1.0);
  float seam = (1.0 - smoothstep(0.0004, 0.0012, sx)) * seamFade;
  seam = max(seam, (1.0 - smoothstep(0.0005, 0.0015, sz)) * seamFade);
  wood *= 1.0 - 0.55 * seam;
  floorNormalW = vec3((pf < 0.5 ? 1.0 : -1.0) * (1.0 - smoothstep(0.0, 0.003, sx)) * 0.25 * seamFade, 0.0, 0.0);

  // Scuffs and polish, which is most of what makes a floor look used.
  float scuff = ffbm(p * 1.3) * ffbm(p * 7.0 + 3.0);
  floorRough = 0.30 + 0.25 * scuff;

  // --- regions
  float ax = abs(p.x);
  float r = length(p);
  float cornerZ = 1.412;
  float sdCourt = max(ax - 7.5, max(${COURT.END_Z.toFixed(3)} - p.y, p.y - ${COURT.TOP_Z.toFixed(3)}));
  float sdArc = p.y < cornerZ ? ax - 6.6 : r - 6.75;
  sdArc = max(sdArc, ${COURT.END_Z.toFixed(3)} - p.y);
  float sdLane = max(ax - 2.45, max(${COURT.END_Z.toFixed(3)} - p.y, p.y - ${COURT.FT_Z.toFixed(3)}));
  float sdWood = max(ax - 10.6, max(-4.2 - p.y, p.y - 12.8));

  vec3 col = wood;
  float inCourt = inside(sdCourt);
  float inArc = inside(sdArc);
  float inLane = inside(sdLane);
  // Stain inside the arc, translucent so the grain shows; the key painted.
  col = mix(col, wood * mix(vec3(1.0), uStain * 1.6, 0.55), inArc * 0.7);
  col = mix(col, mix(uPaint, uPaint * (0.8 + 0.4 * grain), 0.5), inLane * 0.9);
  // The apron round the court, and the flow glow inside the arc.
  col = mix(col, uApron * (0.85 + 0.25 * grain), (1.0 - inCourt) * 0.92);
  floorRough = mix(floorRough, 0.42, max(inLane, 1.0 - inCourt) * 0.6);

  // --- lines
  float lw = 0.025;
  float L = 0.0;
  float zIn = step(${(COURT.END_Z - 0.05).toFixed(3)}, p.y) * step(p.y, ${(COURT.TOP_Z + 0.05).toFixed(3)});
  L = max(L, lineAA(abs(ax - 7.525), lw) * zIn);
  float xIn = step(ax, 7.55);
  L = max(L, lineAA(abs(p.y - ${(COURT.END_Z - 0.025).toFixed(3)}), lw) * xIn);
  L = max(L, lineAA(abs(p.y - ${(COURT.TOP_Z + 0.025).toFixed(3)}), lw) * xIn);
  // The two point line.
  float arcD = p.y >= cornerZ ? abs(r - 6.725) : abs(ax - 6.575);
  L = max(L, lineAA(arcD, lw) * step(${COURT.END_Z.toFixed(3)}, p.y));
  // The key.
  float laneZ = step(${COURT.END_Z.toFixed(3)}, p.y) * step(p.y, ${COURT.FT_Z.toFixed(3)});
  L = max(L, lineAA(abs(ax - 2.425), lw) * laneZ);
  L = max(L, lineAA(abs(p.y - ${(COURT.FT_Z - 0.025).toFixed(3)}), lw) * step(ax, 2.45));
  // Free throw circle, top half solid.
  float ftc = length(p - vec2(0.0, ${COURT.FT_Z.toFixed(3)}));
  L = max(L, lineAA(abs(ftc - 1.775), lw) * step(${COURT.FT_Z.toFixed(3)}, p.y));
  // Bottom half dashed.
  float ang = atan(p.x, p.y - ${COURT.FT_Z.toFixed(3)});
  float dash = step(0.5, fract(ang * 14.0 / 6.2832 * 2.0));
  L = max(L, lineAA(abs(ftc - 1.775), lw) * step(p.y, ${COURT.FT_Z.toFixed(3)}) * dash);
  // No-charge semicircle.
  L = max(L, lineAA(abs(r - 1.275), lw) * step(0.0, p.y));
  L = max(L, lineAA(abs(ax - 1.275), lw) * step(-0.375, p.y) * step(p.y, 0.0));
  // Lane hash marks.
  for (int i = 0; i < 3; i++) {
    float hz = 0.175 + float(i) * 0.95;
    float hm = lineAA(abs(p.y - hz), 0.025) * step(2.45, ax) * step(ax, 2.6);
    L = max(L, hm);
  }
  col = mix(col, uLineCol, L);
  floorRough = mix(floorRough, 0.5, L);

  // The logo at the top of the court.
  vec2 luv = (p - uLogoRect.xy) / uLogoRect.zw + 0.5;
  if (luv.x > 0.0 && luv.x < 1.0 && luv.y > 0.0 && luv.y < 1.0) {
    vec4 lg = texture2D(uLogo, vec2(luv.x, 1.0 - luv.y));
    col = mix(col, lg.rgb, lg.a * 0.9);
  }

  // Flow: the arc lights up in the team colour when the ball is moving well.
  float rim = exp(-abs(sdArc) * 8.0) * inCourt;
  col += uFlowCol * uFlow * (0.25 * rim + 0.04 * inArc) * (0.7 + 0.3 * sin(uTime * 6.0 - r * 2.0));

  // Off the wood: dark arena floor.
  float onWood = inside(sdWood);
  col = mix(vec3(0.012, 0.012, 0.015), col, onWood);
  floorRough = mix(0.75, floorRough, onWood);
  floorCoat = onWood;
  return col;
}
`;

export class Arena {
  constructor(scene, renderer, quality, opts = {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.time = 0;
    this.hype = 0;
    this.flashes = [];
    this.uniforms = {
      uStain: { value: new THREE.Color(0xff6a13) },
      uPaint: { value: new THREE.Color(0x14213d) },
      uApron: { value: new THREE.Color(0x0e1626) },
      uLineCol: { value: new THREE.Color(0xf4f4f0) },
      uLogo: { value: null },
      uLogoRect: { value: new THREE.Vector4(0, 8.35, 3.6, 1.2) },
      tMirror: { value: null },
      uMirrorMatrix: { value: new THREE.Matrix4() },
      uMirrorOn: { value: 0 },
      uMirrorStrength: { value: 0.55 },
      uFlow: { value: 0 },
      uFlowCol: { value: new THREE.Color(0xff6a13) },
      uTime: { value: 0 },
    };
    this.buildEnvironment();
    this.buildFloor();
    this.buildLights(quality);
    this.buildStands(quality);
    this.buildBoards();
    this.buildCeiling();
    this.buildVideoWall(opts);
  }

  /** The reflections every shiny thing in the building sees: lights overhead, dark round. */
  buildEnvironment() {
    const env = new THREE.Scene();
    const room = new THREE.Mesh(
      new THREE.BoxGeometry(60, 30, 60),
      new THREE.MeshBasicMaterial({ color: 0x07080c, side: THREE.BackSide }),
    );
    room.position.y = 12;
    env.add(room);
    const panel = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.97, 0.9).multiplyScalar(14) });
    for (let i = -2; i <= 2; i++) {
      for (let j = -1; j <= 2; j++) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.2), panel);
        m.rotation.x = Math.PI / 2;
        m.position.set(i * 5.5, 26.5, j * 6);
        env.add(m);
      }
    }
    const warm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.5, 0.2).multiplyScalar(1.2) });
    const strip = new THREE.Mesh(new THREE.BoxGeometry(58, 1.2, 58), warm);
    strip.position.y = 3;
    const inner = new THREE.Mesh(new THREE.BoxGeometry(56, 1.4, 56), new THREE.MeshBasicMaterial({ color: 0x07080c }));
    inner.position.y = 3;
    env.add(strip);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.18, 0.07) }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2.9;
    env.add(ground);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(env, 0.02).texture;
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.4;
    this.scene.background = new THREE.Color(0x020306);
    this.scene.fog = new THREE.FogExp2(0x05070c, 0.012);
    pmrem.dispose();
  }

  buildFloor() {
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.07,
      envMapIntensity: 0.6,
    });
    const u = this.uniforms;
    u.uLogo.value = this.logoTexture();
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform mat4 uMirrorMatrix;
          varying vec3 vWorldPos;
          varying vec4 vMirrorUv;`)
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vMirrorUv = uMirrorMatrix * vec4(vWorldPos, 1.0);`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FLOOR_GLSL}`)
        .replace('#include <map_fragment>', `
          vec3 fcol = floorColor(vWorldPos);
          diffuseColor.rgb = fcol;`)
        .replace('#include <roughnessmap_fragment>', `float roughnessFactor = floorRough;`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          normal = normalize(normal + (viewMatrix * vec4(floorNormalW, 0.0)).xyz);`)
        .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
          material.clearcoat *= floorCoat;`)
        .replace('#include <opaque_fragment>', `
          if (uMirrorOn > 0.5) {
            vec2 muv = vMirrorUv.xy / vMirrorUv.w;
            muv += floorNormalW.xz * 0.004;
            float lod = 1.0 + floorRough * 5.0;
            vec3 refl = textureLod(tMirror, muv, lod).rgb;
            vec3 vdir = normalize(vViewPosition);
            float ndv = clamp(dot(normal, vdir), 0.0, 1.0);
            float F = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
            outgoingLight += refl * mix(0.22, 1.0, F) * uMirrorStrength * floorCoat * (1.15 - floorRough);
          }
          #include <opaque_fragment>`);
    };
    const geo = new THREE.PlaneGeometry(70, 70, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(geo, mat);
    floor.position.set(0, 0, 4);
    floor.receiveShadow = true;
    this.floor = floor;
    this.group.add(floor);
  }

  /** Hand the floor this frame's mirror. */
  setMirror(mirror) {
    this.uniforms.uMirrorOn.value = mirror && mirror.enabled ? 1 : 0;
    if (mirror && mirror.enabled) {
      this.uniforms.tMirror.value = mirror.target.texture;
      this.uniforms.uMirrorMatrix.value.copy(mirror.matrix);
    }
  }

  logoTexture() {
    const c = canvas(1200, 400);
    const g = c.getContext('2d');
    g.clearRect(0, 0, 1200, 400);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 230px "Archivo Black", "Arial Black", Impact, sans-serif';
    g.lineWidth = 14;
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.strokeText('3×3', 600, 210);
    g.fillStyle = 'rgba(20,33,61,0.0)';
    g.fillText('3×3', 600, 210);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  setColours(home) {
    this.uniforms.uStain.value.set(home.main).lerp(new THREE.Color(0xffffff), 0.25);
    this.uniforms.uPaint.value.set(0x14213d);
  }

  buildLights(quality) {
    const hemi = new THREE.HemisphereLight(0x8090b0, 0x2a1a10, 0.22);
    this.group.add(hemi);

    // The rig over the court: one big soft key that casts the shadows, and
    // spots from the corners for the highlights in the floor.
    const key = new THREE.DirectionalLight(0xfff4e6, 2.1);
    key.position.set(3, 22, 9);
    key.target.position.set(0, 0, 3.5);
    key.castShadow = true;
    const s = key.shadow;
    s.mapSize.set(quality.shadow, quality.shadow);
    s.camera.left = -11;
    s.camera.right = 11;
    s.camera.top = 11;
    s.camera.bottom = -11;
    s.camera.near = 5;
    s.camera.far = 45;
    s.bias = -0.0004;
    s.normalBias = 0.02;
    s.radius = 3;
    this.key = key;
    this.group.add(key, key.target);

    const spots = [
      [-10, 15, -6], [10, 15, -6], [-10, 15, 13], [10, 15, 13],
    ];
    this.spots = [];
    for (const [x, y, z] of spots) {
      const sp = new THREE.SpotLight(0xfff0dd, 130, 50, 0.42, 0.6, 1.6);
      sp.position.set(x, y, z);
      sp.target.position.set(x * 0.15, 0, 3.5 + (z - 3.5) * 0.1);
      this.group.add(sp, sp.target);
      this.spots.push(sp);
    }
    // A warm rim from behind the basket: separates the players from the stands.
    const rim = new THREE.SpotLight(0xffb070, 160, 45, 0.6, 0.8, 1.6);
    rim.position.set(0, 12, -14);
    rim.target.position.set(0, 1.5, 3);
    this.group.add(rim, rim.target);
  }

  /** Steps of seats on three sides and a little behind the camera. */
  buildStands(quality) {
    const steps = [];
    const rows = 13;
    const rowD = 0.85;
    const rowH = 0.42;
    const seats = [];
    const addBlock = (cx, cz, along, width, facing) => {
      // `facing` is the direction the seats look: towards the court.
      for (let r = 0; r < rows; r++) {
        const h = 0.6 + r * rowH;
        const off = 0.5 + r * rowD;
        const box = new THREE.BoxGeometry(along === 'x' ? width : rowD, h, along === 'x' ? rowD : width);
        const px = along === 'x' ? cx : cx + facing.x * -off;
        const pz = along === 'x' ? cz + facing.z * -off : cz;
        box.translate(px, h / 2, pz);
        steps.push(box);
        const n = Math.floor(width / 0.56);
        for (let i = 0; i < n; i++) {
          const t = -width / 2 + 0.28 + i * 0.56;
          seats.push({
            x: along === 'x' ? cx + t : px,
            z: along === 'x' ? pz : cz + t,
            y: h,
            face: Math.atan2(facing.x, facing.z),
            row: r,
          });
        }
      }
    };
    // Behind the basket.
    addBlock(0, -6.2, 'x', 26, { x: 0, z: 1 });
    // Both sides.
    addBlock(-12.4, 4.2, 'z', 20, { x: 1, z: 0 });
    addBlock(12.4, 4.2, 'z', 20, { x: -1, z: 0 });
    // Behind the camera, for the cinematic shots.
    addBlock(0, 15.6, 'x', 24, { x: 0, z: -1 });

    const geo = mergeGeometries(steps);
    const mat = new THREE.MeshStandardMaterial({ color: 0x15171d, roughness: 0.85, metalness: 0.1 });
    const stands = new THREE.Mesh(geo, mat);
    stands.receiveShadow = true;
    this.group.add(stands);

    this.buildCrowd(seats, quality);
  }

  /**
   * The crowd: one instanced mesh, a few thousand people, each a torso, a head
   * and two arms. The arms go up and the bodies bounce when something happens,
   * all in the vertex shader, driven by one number: hype.
   */
  buildCrowd(seats, quality) {
    const keep = seats.filter(() => Math.random() < 0.86 * quality.crowd);
    const parts = [];
    const tag = (g, part) => {
      const n = g.attributes.position.count;
      g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
      g.deleteAttribute('uv');
      return g;
    };
    const torso = new THREE.CapsuleGeometry(0.19, 0.32, 4, 10);
    torso.scale(1, 1, 0.7);
    torso.translate(0, 0.42, 0);
    parts.push(tag(torso, 0));
    const head = new THREE.SphereGeometry(0.11, 12, 10);
    head.translate(0, 0.86, 0.02);
    parts.push(tag(head, 2));
    for (const side of [-1, 1]) {
      const arm = new THREE.CapsuleGeometry(0.055, 0.42, 3, 6);
      arm.translate(0, -0.24, 0);
      arm.rotateX(0.5);
      arm.translate(side * 0.25, 0.66, 0.05);
      const g = tag(arm, side < 0 ? 3 : 4);
      parts.push(g);
    }
    const legs = new THREE.BoxGeometry(0.34, 0.16, 0.45);
    legs.translate(0, 0.08, 0.2);
    parts.push(tag(legs, 1));
    const person = mergeGeometries(parts);

    const mat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
    const uniforms = { uTime: { value: 0 }, uHype: { value: 0 } };
    this.crowdUniforms = uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aPart;
          attribute float aRand;
          uniform float uTime;
          uniform float uHype;
          varying float vPart;
          varying float vRand;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vPart = aPart;
          vRand = aRand;
          float energy = 0.15 + uHype * (0.4 + 0.6 * fract(aRand * 7.31));
          float bounce = max(0.0, sin(uTime * (5.0 + 3.0 * aRand) + aRand * 40.0)) * energy;
          float up = uHype > 0.35 && fract(aRand * 3.7) < uHype ? 1.0 : 0.0;
          if (aPart > 2.5) {
            float side = aPart > 3.5 ? 1.0 : -1.0;
            vec3 pivot = vec3(side * 0.25, 0.66, 0.05);
            vec3 q = transformed - pivot;
            float a = up * (-2.6 - 0.4 * sin(uTime * 8.0 + aRand * 20.0));
            float c = cos(a), s = sin(a);
            q = vec3(q.x, q.y * c - q.z * s, q.y * s + q.z * c);
            transformed = pivot + q;
          }
          // Standing up for the big moments.
          float stand = up * 0.35;
          if (aPart < 0.5 || aPart > 1.5) transformed.y += bounce * 0.12 + stand;
          if (aPart > 0.5 && aPart < 1.5) transformed.y += stand * 0.3;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying float vPart;
          varying float vRand;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          if (vPart > 1.5) {
            vec3 skins[4];
            skins[0] = vec3(0.85, 0.6, 0.45); skins[1] = vec3(0.55, 0.36, 0.24);
            skins[2] = vec3(0.32, 0.19, 0.12); skins[3] = vec3(0.7, 0.48, 0.33);
            int k = int(floor(fract(vRand * 13.7) * 4.0));
            diffuseColor.rgb = skins[k] * 0.55;
            if (vPart < 2.5 && fract(vRand * 5.3) < 0.7) {
              // Hair on most heads: darken the top.
            }
          }
          if (vPart > 0.5 && vPart < 1.5) diffuseColor.rgb = vec3(0.04, 0.045, 0.06);`);
    };
    const mesh = new THREE.InstancedMesh(person, mat, keep.length);
    const rand = new Float32Array(keep.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const shirts = [0xff6a13, 0xffffff, 0x1b1d24, 0x2b4fd1, 0xd8d8d8, 0x8c1d2e, 0x111111, 0xf2c94c, 0x3a3f4b, 0xff6a13];
    const col = new THREE.Color();
    keep.forEach((s, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.face + (Math.random() - 0.5) * 0.3);
      const sc = 0.92 + Math.random() * 0.16;
      m.compose(new THREE.Vector3(s.x + (Math.random() - 0.5) * 0.1, s.y, s.z), q, new THREE.Vector3(sc, sc, sc));
      mesh.setMatrixAt(i, m);
      col.set(shirts[Math.floor(Math.random() * shirts.length)]).multiplyScalar(0.35 + Math.random() * 0.4);
      mesh.setColorAt(i, col);
      rand[i] = Math.random();
    });
    person.setAttribute('aRand', new THREE.InstancedBufferAttribute(rand, 1));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    this.crowd = mesh;
    this.group.add(mesh);

    // Phone lights and camera flashes: points that twinkle.
    const n = Math.floor(keep.length * 0.06);
    const pos = new Float32Array(n * 3);
    const ph = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = keep[Math.floor(Math.random() * keep.length)];
      pos[i * 3] = s.x;
      pos[i * 3 + 1] = s.y + 1.0;
      pos[i * 3 + 2] = s.z;
      ph[i] = Math.random();
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pg.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    const pm = new THREE.ShaderMaterial({
      uniforms: { uTime: uniforms.uTime, uHype: uniforms.uHype, uFlash: { value: 0 } },
      vertexShader: /* glsl */`
        attribute float aPhase;
        uniform float uTime; uniform float uHype; uniform float uFlash;
        varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float tw = fract(aPhase * 17.0 + uTime * (0.05 + aPhase * 0.1));
          float flash = step(0.985 - uFlash * 0.2, fract(aPhase * 91.0 + floor(uTime * 6.0) * 0.137)) * (0.4 + uFlash);
          vA = 0.25 * step(0.6, aPhase) + flash * 3.0;
          // Clamped: a point a metre from the lens must not cover the screen.
          gl_PointSize = min(14.0, (40.0 + flash * 90.0) / max(1.0, -mv.z));
          if (-mv.z < 2.0) vA = 0.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = exp(-dot(c, c) * 18.0);
          gl_FragColor = vec4(vec3(1.0, 0.97, 0.9) * d * vA * 4.0, 1.0);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.flashMat = pm;
    const pts = new THREE.Points(pg, pm);
    pts.frustumCulled = false;
    this.group.add(pts);
  }

  /** LED ribbons on the front of the stands, and the low boards behind the baseline. */
  buildBoards() {
    const msgs = ['WEBFIBA 3×3', 'NO LOOK', 'CHECK BALL', 'TWELVE SECONDS', 'FIRST TO 21', 'HALFCOURT', 'AND ONE', 'CLEAR IT'];
    const cols = [
      ['#ff6a13', '#ff9a3c', '#111'],
      ['#0d1b3d', '#1f4fd1', '#fff'],
      ['#111', '#222', '#ff6a13'],
      ['#e8e8e8', '#ffffff', '#111'],
    ];
    const tex = ledTexture(msgs, cols);
    this.ledTex = tex;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.6, roughness: 0.4,
    });
    this.ledMat = mat;
    const add = (w, h, x, y, z, ry, repeat) => {
      const t = tex.clone();
      t.repeat.set(repeat, 1);
      t.needsUpdate = true;
      const m = mat.clone();
      m.emissiveMap = t;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), m);
      mesh.position.set(x, y, z);
      mesh.rotation.y = ry;
      this.group.add(mesh);
      (this.leds ||= []).push(t);
      return mesh;
    };
    // Baseline boards, just behind the hoop.
    add(18, 0.9, 0, 0.45, -4.9, 0, 1.4);
    // Ribbons on the front of the side and end stands.
    add(26, 0.6, 0, 0.9, -5.6, 0, 2);
    add(20, 0.6, -11.8, 0.9, 4.2, Math.PI / 2, 1.6);
    add(20, 0.6, 11.8, 0.9, 4.2, -Math.PI / 2, 1.6);
    // A second ribbon higher up behind the basket.
    add(28, 0.7, 0, 6.3, -13.0, 0, 2.2);
  }

  /** Trusses, light banks and the haze in their beams. */
  buildCeiling() {
    const truss = new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.6, metalness: 0.7 });
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.96, 0.88).multiplyScalar(5) });
    const g = new THREE.Group();
    for (const z of [-5, 3.5, 12]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(26, 0.5, 0.5), truss);
      bar.position.set(0, 16, z);
      g.add(bar);
    }
    for (const x of [-12, 12]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 20), truss);
      bar.position.set(x, 16, 3.5);
      g.add(bar);
    }
    // Light banks, and a beam of haze under each.
    const beamMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uStrength: { value: 0.06 } },
      vertexShader: /* glsl */`
        varying float vY; varying vec3 vN; varying vec3 vV; varying vec3 vW;
        void main() {
          vY = uv.y;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - w.xyz);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime; uniform float uStrength;
        varying float vY; varying vec3 vN; varying vec3 vV; varying vec3 vW;
        void main() {
          float edge = pow(abs(dot(vN, vV)), 1.6);
          float fall = smoothstep(0.0, 0.7, vY) * (0.35 + 0.65 * vY);
          float n = 0.75 + 0.25 * sin(vW.y * 1.7 + uTime * 0.6 + vW.x * 0.8) * sin(vW.z * 1.3 - uTime * 0.4);
          float a = edge * fall * n * uStrength;
          gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * a, 1.0);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.beamMat = beamMat;
    const banks = [[-7, -5], [0, -5], [7, -5], [-9, 3.5], [9, 3.5], [-7, 12], [0, 12], [7, 12]];
    for (const [x, z] of banks) {
      const housing = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 0.8), truss);
      housing.position.set(x, 15.6, z);
      const lens = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.6), glow);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(x, 15.38, z);
      g.add(housing, lens);
      // Beam pointing at the court.
      const to = new THREE.Vector3(x * 0.25, 0, 3.5 + (z - 3.5) * 0.2);
      const from = new THREE.Vector3(x, 15.3, z);
      const len = from.distanceTo(to);
      const cone = new THREE.CylinderGeometry(0.5, 3.4, len, 24, 1, true);
      cone.translate(0, -len / 2, 0);
      const beam = new THREE.Mesh(cone, beamMat);
      beam.position.copy(from);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), to.clone().sub(from).normalize());
      beam.renderOrder = 10;
      g.add(beam);
    }
    this.group.add(g);
  }

  /** The big screen over the far stand: the score, and the moment. */
  buildVideoWall(opts) {
    const c = canvas(1600, 600);
    this.wallCanvas = c;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this.wallTex = tex;
    const mat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.1 });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(16, 6), mat);
    wall.position.set(0, 12.2, -15.5);
    this.group.add(wall);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(16.6, 6.6, 0.4), new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.5, metalness: 0.6 }));
    frame.position.set(0, 12.2, -15.75);
    this.group.add(frame);
    this.drawWall({ teams: opts.teams || null, score: [0, 0], text: 'WEBFIBA 3×3' });
  }

  drawWall({ teams, score, text, clock }) {
    const c = this.wallCanvas;
    const g = c.getContext('2d');
    const W = c.width;
    const H = c.height;
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#0b1020');
    grd.addColorStop(1, '#020308');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 64px "Archivo Black", "Arial Black", Impact, sans-serif';
    g.fillStyle = '#ff7a1a';
    g.fillText(text || '', W / 2, 90);
    if (teams) {
      for (const [i, x] of [[0, W * 0.25], [1, W * 0.75]]) {
        g.fillStyle = hex(teams[i].main);
        g.fillRect(x - 300, 170, 600, 70);
        g.fillStyle = teams[i].main === 0xf2f2f2 ? '#111' : '#fff';
        g.font = '900 52px "Archivo Black", "Arial Black", Impact, sans-serif';
        g.fillText(teams[i].city, x, 207);
        g.fillStyle = '#fff';
        g.font = '900 260px "Archivo Black", "Arial Black", Impact, sans-serif';
        g.fillText(String(score[i]), x, 410);
      }
      if (clock) {
        g.font = '700 70px "JetBrains Mono", Menlo, monospace';
        g.fillStyle = '#ffd36b';
        g.fillText(clock, W / 2, 410);
      }
    }
    // LED grid over everything.
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let x = 0; x < W; x += 5) g.fillRect(x, 0, 1, H);
    for (let y = 0; y < H; y += 5) g.fillRect(0, y, W, 1);
    this.wallTex.needsUpdate = true;
  }

  update(dt, hype, flow, flowColour) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    this.hype += (hype - this.hype) * Math.min(1, dt * 2.5);
    if (this.crowdUniforms) {
      this.crowdUniforms.uTime.value = this.time;
      this.crowdUniforms.uHype.value = this.hype;
    }
    if (this.flashMat) {
      const f = this.flashMat.uniforms.uFlash;
      f.value = Math.max(0, f.value - dt * 0.8);
    }
    this.beamMat.uniforms.uTime.value = this.time;
    for (const t of this.leds || []) t.offset.x = (t.offset.x + dt * 0.035) % 1;
    const u = this.uniforms.uFlow;
    u.value += (flow - u.value) * Math.min(1, dt * 3);
    if (flowColour !== undefined) this.uniforms.uFlowCol.value.set(flowColour);
  }

  /** Camera flashes in the crowd: a big moment just happened. */
  flash(amount = 1) {
    if (this.flashMat) this.flashMat.uniforms.uFlash.value = Math.min(1.5, this.flashMat.uniforms.uFlash.value + amount);
  }
}
