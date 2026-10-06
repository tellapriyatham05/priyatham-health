// Generates assets/icon.png: an arc reactor (glowing core, ring of coils) on a dark disc.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5);
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const size = 256;
const c = size / 2;
const clamp = (v) => Math.max(0, Math.min(1, v));
const image = png(size, (x, y) => {
  const d = Math.hypot(x - c, y - c);
  const ang = Math.atan2(y - c, x - c);
  const disc = clamp(124 - d);                       // dark round base
  if (disc <= 0) return [0, 0, 0, 0];
  let r = 12, g = 20, b = 34;
  const glow = clamp(1 - d / 120) ** 2;               // blue light from the middle
  r += 40 * glow; g += 150 * glow; b += 220 * glow;
  const ring = clamp(1 - Math.abs(d - 92) / 7);       // outer metal ring
  const coils = (Math.cos(ang * 10) > 0.2 ? 1 : 0) * clamp(1 - Math.abs(d - 70) / 13); // ten coils
  const core = clamp(42 - d);                         // white-hot core
  const mix = (col, k) => { r = r * (1 - k) + col[0] * k; g = g * (1 - k) + col[1] * k; b = b * (1 - k) + col[2] * k; };
  mix([170, 190, 205], ring * 0.9);
  mix([103, 232, 249], coils);
  mix([235, 252, 255], core);
  return [Math.round(r), Math.round(g), Math.round(b), Math.round(disc * 255)];
});
fs.mkdirSync(path.join(__dirname, '..', 'assets'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'assets', 'icon.png'), image);
console.log('assets/icon.png written');
