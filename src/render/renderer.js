/**
 * The picture: three.js, physically based, through a post chain.
 *
 *   scene -> [planar reflection of the floor] -> render -> ambient occlusion
 *         -> bloom -> grade (vignette, grain, aberration) -> tone map -> SMAA
 *
 * Everything that costs real time hangs off a quality level, and the level can
 * change while the game runs: if the frame rate drops for a few seconds the
 * renderer steps itself down rather than letting a match turn to treacle.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export const QUALITY = {
  low: { ratio: 1, shadow: 1024, reflect: 0, ao: false, bloom: true, smaa: false, crowd: 0.45 },
  medium: { ratio: 1.25, shadow: 2048, reflect: 0.33, ao: false, bloom: true, smaa: true, crowd: 0.75 },
  high: { ratio: 1.5, shadow: 2048, reflect: 0.5, ao: true, bloom: true, smaa: true, crowd: 1 },
  ultra: { ratio: 2, shadow: 4096, reflect: 0.65, ao: true, bloom: true, smaa: true, crowd: 1 },
};
export const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'];

/** A first guess: phones and small screens start lower, everything else high. */
export function guessQuality() {
  const touch = matchMedia?.('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 700;
  if (touch || small) return 'medium';
  return 'high';
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.035 },
    uAberration: { value: 0.0 },
    uFlash: { value: 0.0 },
    uSaturation: { value: 1.08 },
    uTint: { value: new THREE.Color(1, 1, 1) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uAberration, uFlash, uSaturation;
    uniform vec3 uTint;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 0.0) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * uAberration * r2 * 0.06;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation) * uTint;
      col += uFlash * vec3(1.0, 0.95, 0.85);
      col *= 1.0 - uVignette * smoothstep(0.08, 0.62, r2 * 1.6);
      float n = fract(sin(dot(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) * uGrain * (0.35 + l);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

/**
 * The floor's mirror. Renders the scene upside down into a small target, with
 * mipmaps, so the floor material can sample a blurred reflection at whatever
 * roughness it likes. The same matrix maths as three's Reflector, kept here
 * because the floor is not a plain mirror and wants the texture rather than a
 * finished material.
 */
export class FloorMirror {
  constructor(scale) {
    this.scale = scale;
    this.camera = new THREE.PerspectiveCamera();
    this.target = new THREE.WebGLRenderTarget(16, 16, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      colorSpace: THREE.LinearSRGBColorSpace,
    });
    this.matrix = new THREE.Matrix4();
    this.enabled = scale > 0;
    this.hide = [];
  }

  setSize(w, h) {
    if (!this.enabled) return;
    this.target.setSize(Math.max(64, Math.floor(w * this.scale)), Math.max(64, Math.floor(h * this.scale)));
  }

  render(renderer, scene, camera) {
    if (!this.enabled) return;
    const cam = this.camera;
    cam.copy(camera);
    // Mirror the camera in the plane y = 0.
    cam.position.set(camera.position.x, -camera.position.y, camera.position.z);
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    look.y = -look.y;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    up.y = -up.y;
    cam.up.copy(up);
    cam.lookAt(cam.position.clone().add(look));
    cam.updateMatrixWorld();
    cam.projectionMatrix.copy(camera.projectionMatrix);

    // Clip everything under the floor with an oblique near plane, so nothing
    // below y = 0 leaks into the mirror.
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    plane.applyMatrix4(cam.matrixWorldInverse);
    const clip = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const proj = cam.projectionMatrix;
    const q = new THREE.Vector4(
      (Math.sign(clip.x) + proj.elements[8]) / proj.elements[0],
      (Math.sign(clip.y) + proj.elements[9]) / proj.elements[5],
      -1,
      (1 + proj.elements[10]) / proj.elements[14],
    );
    clip.multiplyScalar(2 / clip.dot(q));
    proj.elements[2] = clip.x;
    proj.elements[6] = clip.y;
    proj.elements[10] = clip.z + 1 - 0.0;
    proj.elements[14] = clip.w;

    this.matrix.set(
      0.5, 0, 0, 0.5,
      0, 0.5, 0, 0.5,
      0, 0, 0.5, 0.5,
      0, 0, 0, 1,
    );
    this.matrix.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);

    const was = renderer.getRenderTarget();
    const shadowAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    for (const o of this.hide) o.visible = false;
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, cam);
    for (const o of this.hide) o.visible = true;
    renderer.setRenderTarget(was);
    renderer.shadowMap.autoUpdate = shadowAuto;
  }
}

export class Renderer {
  constructor(canvas, quality = 'high') {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.AgXToneMapping;
    r.toneMappingExposure = 0.92;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 400);
    this.clock = 0;
    this.frameTimes = [];
    this.onQuality = null;
    this.setQuality(quality);
  }

  setQuality(level) {
    if (!QUALITY[level]) level = 'high';
    this.level = level;
    this.q = QUALITY[level];
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.ratio));
    this.mirror?.target.dispose();
    this.mirror = new FloorMirror(this.q.reflect);
    this.buildComposer();
    this.resize();
    this.onQuality?.(level, this.q);
  }

  buildComposer() {
    const r = this.renderer;
    this.composer?.dispose?.();
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 0 });
    const composer = new EffectComposer(r, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.ao = null;
    if (this.q.ao) {
      const ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      ao.output = GTAOPass.OUTPUT.Default;
      ao.blendIntensity = 0.85;
      ao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      composer.addPass(ao);
      this.ao = ao;
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.42, 0.5, 1.6);
    composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    composer.addPass(this.grade);
    composer.addPass(new OutputPass());
    if (this.q.smaa) composer.addPass(new SMAAPass(size.x, size.y));
    this.composer = composer;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer?.setSize(w, h);
    this.mirror?.setSize(size.x, size.y);
  }

  render(dt) {
    this.clock += dt;
    this.grade.uniforms.uTime.value = this.clock;
    this.renderer.shadowMap.needsUpdate = true;
    this.mirror.render(this.renderer, this.scene, this.camera);
    this.renderer.shadowMap.needsUpdate = true;
    this.composer.render(dt);
    this.watch(dt);
  }

  /**
   * Steps the quality down if the game has been running slow for a while. Never
   * up: a machine that struggled once will struggle again, and flicking between
   * two levels is worse than either of them.
   */
  watch(dt) {
    if (!this.autoAdjust) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 180) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    const at = QUALITY_ORDER.indexOf(this.level);
    if (avg > 1 / 45 && at > 0) this.setQuality(QUALITY_ORDER[at - 1]);
  }
}
