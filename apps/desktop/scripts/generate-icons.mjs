// Generate the app icon and tray icon as PNGs. Runs with zero native deps — just
// Node's built-in zlib for DEFLATE. Produces an intentionally simple brand mark so
// Phase 7 can ship installers without blocking on a designer.
//
// Swap in a real asset by replacing resources/icon.png + resources/tray-icon.png and
// deleting this generator. electron-builder only needs the two PNGs at build time.

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const resourcesDir = resolve(__dirname, '..', 'resources');

// Brand colors. Matches the `brand-600` tailwind token on the web side (#4F46E5 ish).
const BG_TOP = { r: 0x2E, g: 0x22, b: 0xC9 }; // indigo-700
const BG_BOT = { r: 0x7C, g: 0x3A, b: 0xED }; // violet-600
const MARK_COLOR = { r: 0xFF, g: 0xFF, b: 0xFF };

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
function mix(c1, c2, t) {
  return { r: lerp(c1.r, c2.r, t), g: lerp(c1.g, c2.g, t), b: lerp(c1.b, c2.b, t) };
}

// Rounded rect: returns true if (x,y) is inside a round-rect with given radius.
function insideRounded(x, y, size, radius) {
  const maxX = size - 1, maxY = size - 1;
  if (x < 0 || y < 0 || x > maxX || y > maxY) return false;
  const dx = x < radius ? radius - x : x > maxX - radius ? x - (maxX - radius) : 0;
  const dy = y < radius ? radius - y : y > maxY - radius ? y - (maxY - radius) : 0;
  if (dx === 0 || dy === 0) return true;
  return dx * dx + dy * dy <= radius * radius;
}

// Distance from (x,y) to segment (x1,y1)-(x2,y2).
function distToSegment(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(x - x1, y - y1);
  let t = ((x - x1) * dx + (y - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

/**
 * Brand mark: soft vertical gradient with a thick diagonal slash that evokes the "listen
 * and respond" motion of the overlay. Simple enough to render at 16×16 without artifacts
 * and bold enough to stand out in a 1024×1024 hero.
 */
function renderIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const radius = Math.round(size * 0.22);
  const cornerPad = Math.round(size * 0.10);
  const strokeWidth = Math.max(2, size * 0.11);

  for (let y = 0; y < size; y++) {
    const t = y / (size - 1);
    const bg = mix(BG_TOP, BG_BOT, t);
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!insideRounded(x, y, size, radius)) {
        px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 0;
        continue;
      }

      // Slash: from bottom-left corner area up to top-right corner area.
      const d = distToSegment(
        x, y,
        cornerPad, size - cornerPad,
        size - cornerPad, cornerPad,
      );
      const halfW = strokeWidth / 2;
      if (d <= halfW) {
        // Hard white core with a 1px AA soft edge.
        const edgeAA = Math.max(0, Math.min(1, halfW - d));
        px[i] = lerp(bg.r, MARK_COLOR.r, edgeAA);
        px[i + 1] = lerp(bg.g, MARK_COLOR.g, edgeAA);
        px[i + 2] = lerp(bg.b, MARK_COLOR.b, edgeAA);
      } else {
        px[i] = bg.r; px[i + 1] = bg.g; px[i + 2] = bg.b;
      }
      px[i + 3] = 255;
    }
  }
  return px;
}

// ---- Minimal PNG encoder --------------------------------------------------
// Writes RGBA PNG (color type 6, bit depth 8). No interlace, no palette.

function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
    crc32.table = table;
  }
  c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Each scanline is prefixed with filter byte 0 (None).
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idatData = deflateSync(raw, { level: 9 });
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', iend),
  ]);
}

function writeIcon(name, size) {
  const rgba = renderIcon(size);
  const png = encodePng(size, size, rgba);
  const outPath = resolve(resourcesDir, name);
  writeFileSync(outPath, png);
  console.log(`wrote ${outPath} (${size}×${size}, ${png.length.toLocaleString()} bytes)`);
}

writeIcon('icon.png', 1024);
writeIcon('tray-icon.png', 32);
