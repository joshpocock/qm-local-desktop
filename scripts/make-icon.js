'use strict';

/**
 * Generates assets/icon.png — a simple, ORIGINAL placeholder app icon:
 * a dark rounded square with a blocky "QM" monogram.
 *
 * No canvas / image libraries used — this hand-rolls a raw PNG encoder
 * (IHDR/IDAT/IEND chunks + CRC32) on top of Node's built-in zlib, and
 * draws pixels directly into an RGBA buffer.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const BG = [16, 18, 22, 255]; // near-black
const FG = [212, 160, 23, 255]; // warm gold monogram
const BORDER = [46, 50, 58, 255]; // subtle border tint

// ---- tiny bitmap font: 7x9 glyphs for "Q" and "M" (1 = filled) ----
const GLYPH_Q = [
  '0111100',
  '1000010',
  '1000010',
  '1000010',
  '1000010',
  '1000010',
  '1000110',
  '0111101',
  '0000011',
];

const GLYPH_M = [
  '1000001',
  '1100011',
  '1010101',
  '1010101',
  '1001001',
  '1000001',
  '1000001',
  '1000001',
  '1000001',
];

function buildPixels() {
  const pixels = new Uint8Array(SIZE * SIZE * 4);

  const cornerRadius = 40;

  function setPixel(x, y, color) {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    const idx = (y * SIZE + x) * 4;
    pixels[idx] = color[0];
    pixels[idx + 1] = color[1];
    pixels[idx + 2] = color[2];
    pixels[idx + 3] = color[3];
  }

  function inRoundedSquare(x, y) {
    const cx = Math.min(x, SIZE - 1 - x);
    const cy = Math.min(y, SIZE - 1 - y);
    if (cx >= cornerRadius || cy >= cornerRadius) return true;
    const dx = cornerRadius - cx;
    const dy = cornerRadius - cy;
    return dx * dx + dy * dy <= cornerRadius * cornerRadius;
  }

  // background rounded square
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (inRoundedSquare(x, y)) {
        setPixel(x, y, BG);
      }
    }
  }

  // subtle 2px border, inset
  const inset = 6;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!inRoundedSquare(x, y)) continue;
      const nearEdge =
        x < inset || y < inset || x >= SIZE - inset || y >= SIZE - inset;
      if (nearEdge) setPixel(x, y, BORDER);
    }
  }

  // ---- draw "QM" monogram, scaled up from the 7x9 bitmaps ----
  const cellsWide = 7 + 1 + 7; // Q + gap + M
  const cellsTall = 9;
  const scale = 12;
  const glyphPixelW = cellsWide * scale;
  const glyphPixelH = cellsTall * scale;
  const startX = Math.round((SIZE - glyphPixelW) / 2);
  const startY = Math.round((SIZE - glyphPixelH) / 2);

  function drawGlyph(glyph, colOffset) {
    for (let row = 0; row < glyph.length; row++) {
      const line = glyph[row];
      for (let col = 0; col < line.length; col++) {
        if (line[col] !== '1') continue;
        const px0 = startX + (colOffset + col) * scale;
        const py0 = startY + row * scale;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            setPixel(px0 + dx, py0 + dy, FG);
          }
        }
      }
    }
  }

  drawGlyph(GLYPH_Q, 0);
  drawGlyph(GLYPH_M, 8);

  return pixels;
}

// ---- minimal PNG encoder ----

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePNG(pixels, width, height) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = chunk('IHDR', ihdrData);

  // raw scanlines: filter byte 0 + RGBA row
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // no filter
    Buffer.from(pixels.buffer, y * stride, stride).copy(raw, rowStart + 1);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  const idat = chunk('IDAT', compressed);

  const iend = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function main() {
  const pixels = buildPixels();
  const png = encodePNG(pixels, SIZE, SIZE);
  const outDir = path.join(__dirname, '..', 'assets');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'icon.png');
  fs.writeFileSync(outPath, png);
  console.log(`Wrote ${outPath} (${png.length} bytes)`);
}

main();
