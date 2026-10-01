/**
 * Pictures drawn at start-up with a 2D canvas: numbers on shirts, the ball's
 * skin, the court logo, the boards around the court. Nothing is downloaded, so
 * nothing can fail to arrive.
 */

import * as THREE from 'three';

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function hex(color) {
  return `#${new THREE.Color(color).getHexString()}`;
}

/**
 * A jersey: team colour, piping, the number front and back, the city across
 * the chest. Laid out for a lathe, whose u runs round the body starting at the
 * front (+z) and whose v runs up from the waist.
 */
export function jerseyTexture(team, num, name) {
  const W = 1024;
  const H = 512;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = hex(team.main);
  g.fillRect(0, 0, W, H);
  // Subtle mesh: tiny holes in the fabric.
  g.globalAlpha = 0.08;
  g.fillStyle = '#000';
  for (let y = 0; y < H; y += 6) {
    for (let x = (y / 6) % 2 ? 3 : 0; x < W; x += 6) g.fillRect(x, y, 2, 2);
  }
  g.globalAlpha = 1;
  // Side panels in the trim colour.
  g.fillStyle = hex(team.trim);
  for (const u of [0.25, 0.75]) g.fillRect(u * W - 26, 0, 52, H);
  g.fillStyle = hex(team.alt);
  for (const u of [0.25, 0.75]) g.fillRect(u * W - 8, 0, 16, H);
  // Neck and arm holes are at the top: a band of trim.
  g.fillStyle = hex(team.trim);
  g.fillRect(0, 0, W, 22);

  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const font = (px) => `900 ${px}px "Archivo Black", "Arial Black", Impact, sans-serif`;
  const outlined = (text, x, y, px) => {
    g.font = font(px);
    g.lineWidth = px * 0.12;
    g.strokeStyle = hex(team.alt);
    g.lineJoin = 'round';
    g.strokeText(text, x, y);
    g.fillStyle = hex(team.trim);
    g.fillText(text, x, y);
  };
  // Front: u = 0 is the front, so the front number straddles the seam.
  for (const x of [0, W]) {
    outlined(String(num), x, H * 0.36, 150);
  }
  g.font = font(44);
  g.fillStyle = hex(team.trim);
  for (const x of [0, W]) g.fillText(team.city, x, H * 0.12);
  // Back: name and big number.
  g.font = font(42);
  g.fillText(name, W * 0.5, H * 0.13);
  outlined(String(num), W * 0.5, H * 0.43, 210);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/**
 * The ball: pebbled orange leather and eight black channels. Drawn as an
 * equirectangular map from the sphere's own coordinates, so the seams are where
 * a real ball has them rather than where a UV seam happens to fall.
 */
export function ballTextures() {
  const W = 1024;
  const H = 512;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const n = canvas(W, H);
  const ng = n.getContext('2d');
  const nimg = ng.createImageData(W, H);
  const height = new Float32Array(W * H);

  const seamW = 0.022;
  for (let y = 0; y < H; y++) {
    const v = y / H;
    const theta = v * Math.PI;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const phi = u * Math.PI * 2;
      const px = Math.sin(theta) * Math.cos(phi);
      const py = Math.cos(theta);
      const pz = Math.sin(theta) * Math.sin(phi);
      // The two great circles, and the two curved seams round the poles of x.
      let s = Math.min(Math.abs(py), Math.abs(pz));
      const curve = Math.abs(Math.abs(px) - (0.64 + 0.28 * py * py));
      s = Math.min(s, curve);
      const seam = s < seamW ? 1 : (s < seamW + 0.01 ? 1 - (s - seamW) / 0.01 : 0);
      // Pebbles: a cheap cellular pattern.
      const cell = pebble(u * 180, v * 90);
      const i = (y * W + x) * 4;
      const tone = 0.92 + 0.08 * cell;
      const r = 205 * tone;
      const gg = 88 * tone;
      const b = 38 * tone;
      img.data[i] = r * (1 - seam) + 22 * seam;
      img.data[i + 1] = gg * (1 - seam) + 18 * seam;
      img.data[i + 2] = b * (1 - seam) + 16 * seam;
      img.data[i + 3] = 255;
      height[y * W + x] = cell * 0.5 - seam * 2.5;
    }
  }
  g.putImageData(img, 0, 0);
  // Normal map from the height field.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const l = height[y * W + ((x - 1 + W) % W)];
      const r = height[y * W + ((x + 1) % W)];
      const u = height[Math.max(0, y - 1) * W + x];
      const d = height[Math.min(H - 1, y + 1) * W + x];
      let nx = (l - r) * 1.2;
      let ny = (u - d) * 1.2;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * W + x) * 4;
      nimg.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      nimg.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      nimg.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      nimg.data[i + 3] = 255;
    }
  }
  ng.putImageData(nimg, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const normal = new THREE.CanvasTexture(n);
  normal.anisotropy = 8;
  return { map, normal };
}

function pebble(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let best = 9;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i + hash2(ix + i, iy + j);
      const cy = iy + j + hash2(iy + j + 17, ix + i + 3);
      best = Math.min(best, (x - cx) ** 2 + (y - cy) ** 2);
    }
  }
  return 1 - Math.min(1, Math.sqrt(best) * 1.4);
}

function hash2(a, b) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Big flat type for logos and boards. */
export function textTexture(lines, opts = {}) {
  const W = opts.width || 1024;
  const H = opts.height || 256;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  if (opts.bg) {
    g.fillStyle = opts.bg;
    g.fillRect(0, 0, W, H);
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const l of lines) {
    g.font = `${l.weight || 900} ${l.size}px ${l.font || '"Archivo Black", "Arial Black", Impact, sans-serif'}`;
    if (l.stroke) {
      g.lineWidth = l.strokeWidth || 8;
      g.strokeStyle = l.stroke;
      g.strokeText(l.text, l.x ?? W / 2, l.y ?? H / 2);
    }
    g.fillStyle = l.color || '#fff';
    if (l.spacing) g.letterSpacing = `${l.spacing}px`;
    g.fillText(l.text, l.x ?? W / 2, l.y ?? H / 2);
    if (l.spacing) g.letterSpacing = '0px';
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * A strip of LED board: messages scrolling past in segments, drawn once wide
 * and scrolled in the material by moving the texture offset.
 */
export function ledTexture(messages, colors) {
  const W = 4096;
  const H = 128;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#05060a';
  g.fillRect(0, 0, W, H);
  const seg = W / messages.length;
  messages.forEach((m, i) => {
    const col = colors[i % colors.length];
    const grd = g.createLinearGradient(i * seg, 0, (i + 1) * seg, 0);
    grd.addColorStop(0, col[0]);
    grd.addColorStop(1, col[1]);
    g.fillStyle = grd;
    g.fillRect(i * seg + 2, 4, seg - 4, H - 8);
    g.fillStyle = col[2] || '#fff';
    // As big as fits in the segment, and no bigger.
    let px = 78;
    g.font = `900 ${px}px "Archivo Black", "Arial Black", Impact, sans-serif`;
    while (g.measureText(m).width > seg - 60 && px > 30) {
      px -= 4;
      g.font = `900 ${px}px "Archivo Black", "Arial Black", Impact, sans-serif`;
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(m, i * seg + seg / 2, H / 2 + 4);
  });
  // LED pixel grid.
  g.fillStyle = 'rgba(0,0,0,0.38)';
  for (let x = 0; x < W; x += 4) g.fillRect(x, 0, 1, H);
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** A soft round spot, for blob shadows and glows. */
export function radialTexture(inner = 'rgba(0,0,0,0.7)', outer = 'rgba(0,0,0,0)') {
  const c = canvas(128, 128);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}
