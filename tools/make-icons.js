// Draws the app icons and writes them as PNGs.
//
//   node tools/make-icons.js
//
// A PNG by hand, the way the rest of the family does it: a header, one zlib
// stream of scanlines and a trailer, with node's own zlib. The picture is the
// ball, lit from above, on the arena dark.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel((x + 0.5) / size, (y + 0.5) / size);
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a + (b - a) * t;
function pixel(u, v) {
  // Background: arena dark with a warm glow from below.
  let r = mix(8, 40, v * v);
  let g = mix(10, 18, v * v);
  let b = mix(16, 12, v * v);
  const x = u - 0.5;
  const y = v - 0.5;
  const R = 0.36;
  const d = Math.hypot(x, y);
  if (d < R) {
    const nz = Math.sqrt(Math.max(0, 1 - (d / R) ** 2));
    const nx = x / R;
    const ny = y / R;
    const light = Math.max(0, -0.35 * nx - 0.55 * ny + 0.75 * nz);
    r = 225 * (0.25 + 0.85 * light);
    g = 95 * (0.25 + 0.85 * light);
    b = 30 * (0.25 + 0.85 * light);
    // Seams: the two great circles and the two curves.
    const px = nx;
    const py = ny;
    const pz = nz;
    let s = Math.min(Math.abs(px), Math.abs(py));
    s = Math.min(s, Math.abs(Math.abs(px * 0.8 + pz * 0.6) - 0.75));
    if (s < 0.045) {
      r = 25;
      g = 18;
      b = 15;
    }
    const spec = Math.max(0, 1 - Math.hypot(nx + 0.35, ny + 0.45) * 4);
    r = Math.min(255, r + spec * 120);
    g = Math.min(255, g + spec * 100);
    b = Math.min(255, b + spec * 80);
    // Soft edge.
    const e = Math.min(1, (R - d) / 0.012);
    r = mix(40, r, e);
    g = mix(18, g, e);
    b = mix(12, b, e);
  }
  return [Math.round(r), Math.round(g), Math.round(b)];
}

mkdirSync(path.join(ROOT, 'icons'), { recursive: true });
for (const size of [32, 180, 192, 512]) {
  writeFileSync(path.join(ROOT, 'icons', `icon-${size}.png`), png(size, pixel));
}
console.log('icons written');
