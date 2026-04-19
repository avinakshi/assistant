// esbuild-driven builder for the Chrome extension. Three JS entry points + copy the
// manifest + html/css + icon assets. Output layout matches what manifest.json refers to.
//
// Run: pnpm --filter @repo/extension build

import { build } from 'esbuild';
import { mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, 'src');
const distDir = resolve(__dirname, 'dist');

// Clean dist
if (existsSync(distDir)) await rm(distDir, { recursive: true });
await mkdir(distDir, { recursive: true });

// Bundle each entry as an IIFE (no module boundaries; extension MV3 permits module
// workers but content scripts must be classic scripts). Each entry inlines its imports.
const entries = {
  popup: 'src/popup.ts',
  background: 'src/background.ts',
  'content-leetcode': 'src/content-leetcode.ts',
  'content-hackerrank': 'src/content-hackerrank.ts',
};

for (const [name, entry] of Object.entries(entries)) {
  await build({
    entryPoints: [resolve(__dirname, entry)],
    bundle: true,
    format: name === 'background' ? 'esm' : 'iife',
    target: ['chrome120'],
    outfile: resolve(distDir, `${name}.js`),
    sourcemap: 'linked',
    minify: false,
    logLevel: 'info',
  });
}

// Copy popup.html + popup.css.
await copyFile(resolve(srcDir, 'popup.html'), resolve(distDir, 'popup.html'));
await copyFile(resolve(srcDir, 'popup.css'), resolve(distDir, 'popup.css'));

// Copy manifest.
await copyFile(resolve(__dirname, 'manifest.json'), resolve(distDir, 'manifest.json'));

// Generate placeholder icons at three sizes. MV3 Chrome rejects a manifest whose
// declared icons are missing, so we emit the same single-color square for all three
// until a designer gives us real art.
const iconSizes = [16, 32, 128];
for (const size of iconSizes) {
  const png = solidPng(size, size, 0x4f, 0x46, 0xe5);
  await writeFile(resolve(distDir, `icon-${size}.png`), png);
}

console.log(`\nDONE — output at ${distDir}`);
console.log('Load in Chrome: chrome://extensions → Developer mode → Load unpacked → select the dist/ folder.');

// ---- pure PNG writer (chromeless, no deps) ---------------------------------
function solidPng(w, h, r, g, b) {
  // Minimal RGBA PNG builder. Duplicates the approach used in
  // apps/desktop/scripts/generate-icons.mjs but stripped to a solid fill.
  const pixels = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    pixels[y * (w * 4 + 1)] = 0; // filter
    for (let x = 0; x < w; x++) {
      const i = y * (w * 4 + 1) + 1 + x * 4;
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = 255;
    }
  }
  const crc32 = (buf) => {
    let c;
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([length, typeBuf, data, crc]);
  };
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(pixels, { level: 9 });
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
