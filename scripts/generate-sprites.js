/*
 * generate-sprites.js — Procedural asset generator for Retro Soccer 2D.
 *
 * Pure Node.js, zero native dependencies (ESM because package.json declares
 * "type": "module" for Vite; stdlib imports only). Emits into public/assets/:
 *   - pitch.png       960x540  two-tone striped pitch with white field lines
 *   - ball.png        32x32    shaded white ball with black pentagon dots
 *   - ball-shadow.png 32x16    semi-transparent black ellipse (Z-axis shadow)
 *   - players.png     96x64    spritesheet, 32x32 frames
 *                        row 0 = home [Idle, Run, Kick]
 *                        row 1 = away [Idle, Run, Kick]
 *   - manifest.json   single source of truth consumed by BootScene
 *
 * Determinism: no Date, no Math.random, no locale-dependent output, and zlib
 * compression level is pinned to 9, so repeated runs are byte-identical.
 *
 * Usage: node scripts/generate-sprites.js
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Part A — RGBA canvas + minimal PNG encoder
// ---------------------------------------------------------------------------

/** Create a fully transparent w*h RGBA canvas backed by a Buffer. */
function createCanvas(w, h) {
  return { w, h, buf: Buffer.alloc(w * h * 4, 0) };
}

/** Parse '#rrggbb' into [r, g, b]. */
function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * Alpha-blend "src over dst" and WRITE to dst. Returns [r, g, b, a] of dst.
 * sa/da are 0..1 float alpha; colors are 0..255 ints.
 */
function blendOver(sc, sa, dc, da) {
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return [0, 0, 0, 0];
  const r = (sc[0] * sa + dc[0] * da * (1 - sa)) / outA;
  const g = (sc[1] * sa + dc[1] * da * (1 - sa)) / outA;
  const b = (sc[2] * sa + dc[2] * da * (1 - sa)) / outA;
  return [Math.round(r), Math.round(g), Math.round(b), Math.round(outA * 255)];
}

/**
 * Blend `rgb` into pixel (x, y) with alpha `a` (0..255).
 */
function blendPx(canvas, x, y, rgb, a) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= canvas.w || y >= canvas.h || a <= 0) return;
  const i = (y * canvas.w + x) * 4;
  const b = canvas.buf;
  if (a >= 255 || b[i + 3] === 0) {
    b[i] = rgb[0];
    b[i + 1] = rgb[1];
    b[i + 2] = rgb[2];
    b[i + 3] = a >= 255 ? 255 : a;
    return;
  }
  const out = blendOver(rgb, a / 255, [b[i], b[i + 1], b[i + 2]], b[i + 3] / 255);
  b[i] = out[0];
  b[i + 1] = out[1];
  b[i + 2] = out[2];
  b[i + 3] = out[3];
}

/** Fully covered anti-aliased supersample is overkill here; integer prims only. */
function fillRect(canvas, x, y, w, h, rgb, a = 255) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      blendPx(canvas, xx, yy, rgb, a);
    }
  }
}

/** Filled disc: all pixels whose center lies within radius r of (cx, cy). */
function fillDisc(canvas, cx, cy, r, rgb, a = 255) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) blendPx(canvas, x, y, rgb, a);
    }
  }
}

/** Filled axis-aligned ellipse inside bounding box centered at (cx, cy). */
function fillEllipse(canvas, cx, cy, rx, ry, rgb, a = 255) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) blendPx(canvas, x, y, rgb, a);
    }
  }
}

/** Circle outline of given thickness, pixels whose distance to (cx,cy) ~ r. */
function strokeCircle(canvas, cx, cy, r, thickness, rgb, a = 255) {
  const half = thickness / 2;
  for (let y = Math.floor(cy - r - half); y <= Math.ceil(cy + r + half); y++) {
    for (let x = Math.floor(cx - r - half); x <= Math.ceil(cx + r + half); x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (Math.abs(d - r) <= half) blendPx(canvas, x, y, rgb, a);
    }
  }
}

// --- CRC32 (standard PNG polynomial table) ---

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
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

/** Build one PNG chunk: length(4) + type(4) + data + crc32(type+data). */
function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/** Encode an RGBA canvas into a PNG buffer (8-bit, color type 6, filter 0). */
function encodePng(canvas) {
  const { w, h, buf } = canvas;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth: 8
  ihdr[9] = 6; // color type: 6 = truecolor with alpha (RGBA)
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method: standard
  ihdr[12] = 0; // interlace: none

  // One filter byte (0 = None) prepended per scanline.
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    buf.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Part B — Painters
// ---------------------------------------------------------------------------

const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

const PITCH_W = 960;
const PITCH_H = 540;
/** Perceived margin of the playable field inside the image. */
const FIELD = { x: 40, y: 30, w: PITCH_W - 80, h: PITCH_H - 60 };

function paintPitch() {
  const c = createCanvas(PITCH_W, PITCH_H);
  const toneA = hexRgb('#3f9e4d');
  const toneB = hexRgb('#359144');

  // 8 vertical mow stripes, alternating tones.
  const stripeW = PITCH_W / 8;
  for (let s = 0; s < 8; s++) {
    fillRect(c, Math.floor(s * stripeW), 0, Math.ceil(stripeW), PITCH_H, s % 2 === 0 ? toneA : toneB);
  }

  // White field markings.
  const lw = 3; // line width
  // Outer border
  fillRect(c, FIELD.x, FIELD.y, FIELD.w, lw, WHITE);
  fillRect(c, FIELD.x, FIELD.y + FIELD.h - lw, FIELD.w, lw, WHITE);
  fillRect(c, FIELD.x, FIELD.y, lw, FIELD.h, WHITE);
  fillRect(c, FIELD.x + FIELD.w - lw, FIELD.y, lw, FIELD.h, WHITE);
  // Halfway line
  fillRect(c, Math.floor(PITCH_W / 2) - Math.floor(lw / 2), FIELD.y, lw, FIELD.h, WHITE);
  // Center circle + spot
  strokeCircle(c, Math.floor(PITCH_W / 2), Math.floor(PITCH_H / 2), 55, lw, WHITE);
  fillDisc(c, Math.floor(PITCH_W / 2), Math.floor(PITCH_H / 2), 4, WHITE);

  // Penalty boxes + goal areas on both flanks.
  const boxW = 90;
  const boxH = 220;
  const goalW = 36;
  const goalH = 110;
  const boxY = Math.floor((PITCH_H - boxH) / 2);
  const goalY = Math.floor((PITCH_H - goalH) / 2);
  for (const side of ['L', 'R']) {
    const bx = side === 'L' ? FIELD.x : FIELD.x + FIELD.w - boxW;
    const gx = side === 'L' ? FIELD.x : FIELD.x + FIELD.w - goalW;
    // penalty box (3 strokes open toward the touchline)
    fillRect(c, bx, boxY, boxW, lw, WHITE);
    fillRect(c, bx, boxY + boxH - lw, boxW, lw, WHITE);
    fillRect(c, side === 'L' ? bx + boxW - lw : bx, boxY, lw, boxH, WHITE);
    // goal area
    fillRect(c, gx, goalY, goalW, lw, WHITE);
    fillRect(c, gx, goalY + goalH - lw, goalW, lw, WHITE);
    fillRect(c, side === 'L' ? gx + goalW - lw : gx, goalY, lw, goalH, WHITE);
    // penalty spot
    fillDisc(c, side === 'L' ? FIELD.x + 62 : FIELD.x + FIELD.w - 62, Math.floor(PITCH_H / 2), 3, WHITE);
  }

  return c;
}

function paintBall() {
  const c = createCanvas(32, 32);
  const cx = 15.5;
  const cy = 15.5;
  const r = 13;

  // Radial-shaded white disc lit from the upper-left (manhattan light).
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r * r) continue;
      const dLight = Math.abs(x - 9) + Math.abs(y - 9);
      const shade = Math.max(185, 255 - dLight * 4);
      blendPx(c, x, y, [shade, shade, shade], 255);
    }
  }

  // Black pentagon dots (retro telstar hint): center + 5 around it.
  fillDisc(c, cx, cy, 3.2, BLACK);
  for (let k = 0; k < 5; k++) {
    const ang = (k * 2 * Math.PI) / 5 - Math.PI / 2;
    fillDisc(c, cx + Math.cos(ang) * 8.5, cy + Math.sin(ang) * 8.5, 2.4, BLACK);
  }

  return c;
}

function paintBallShadow() {
  const c = createCanvas(32, 16);
  // Semi-transparent black ellipse; alpha tapers toward the rim for softness.
  const cx = 15.5;
  const cy = 7.5;
  const rx = 13;
  const ry = 5.5;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      const a = Math.round(90 * (1 - d * 0.55));
      blendPx(c, x, y, BLACK, Math.min(a, 255));
    }
  }
  return c;
}

const PALETTES = {
  home: { shirt: '#d32f2f', shorts: '#ffffff', skin: '#f1c27d' },
  away: { shirt: '#1976d2', shorts: '#ffffff', skin: '#f1c27d' },
};

const FRAME_NAMES = ['idle', 'run', 'kick'];
const FRAME_W = 32;
const FRAME_H = 32;

/**
 * Paint one 32x32 player frame into the sheet at (ox, oy).
 * Rayman-style: round head, oval torso, floating hands and feet (no limbs).
 * pose: 'idle' | 'run' | 'kick'
 */
function paintPlayerFrame(sheet, ox, oy, palette, pose) {
  const skin = hexRgb(palette.skin);
  const shirt = hexRgb(palette.shirt);
  const shorts = hexRgb(palette.shorts);
  const boot = [40, 40, 40];

  // Pose offsets for floating extremities.
  const poses = {
    idle: { hands: [[7, 17], [24, 17]], feet: [[11, 29], [20, 29]], headY: 5 },
    run: { hands: [[5, 14], [26, 20]], feet: [[8, 28], [24, 26]], headY: 4 },
    kick: { hands: [[6, 13], [25, 16]], feet: [[7, 27], [27, 21]], headY: 5 },
  };
  const p = poses[pose];

  // Head (round, with a darker hair cap on top).
  fillDisc(sheet, ox + 16, oy + p.headY + 3, 5, skin);
  fillRect(sheet, ox + 12, oy + p.headY - 2, 9, 3, [70, 50, 30]);
  // Eyes.
  blendPx(sheet, ox + 14, oy + p.headY + 3, BLACK, 255);
  blendPx(sheet, ox + 18, oy + p.headY + 3, BLACK, 255);

  // Torso (oval, team shirt color).
  fillEllipse(sheet, ox + 16, oy + 16, 6.5, 7, shirt);
  // Shirt number stripe hint.
  fillRect(sheet, ox + 14, oy + 14, 5, 2, WHITE, 200);

  // Shorts band.
  fillRect(sheet, ox + 11, oy + 21, 11, 3, shorts);

  // Floating hands.
  for (const [hx, hy] of p.hands) fillDisc(sheet, ox + hx, oy + hy, 2.2, skin);
  // Floating feet (boots).
  for (const [fx, fy] of p.feet) fillEllipse(sheet, ox + fx, oy + fy, 2.8, 1.8, boot);
}

function paintPlayers() {
  const sheet = createCanvas(FRAME_W * 3, FRAME_H * 2);
  const teams = ['home', 'away'];
  teams.forEach((team, row) => {
    FRAME_NAMES.forEach((pose, col) => {
      paintPlayerFrame(sheet, col * FRAME_W, row * FRAME_H, PALETTES[team], pose);
    });
  });
  return sheet;
}

// ---------------------------------------------------------------------------
// Part C — Output + manifest
// ---------------------------------------------------------------------------

function main() {
  const outDir = path.join(__dirname, '..', 'public', 'assets');
  fs.mkdirSync(outDir, { recursive: true });

  const outputs = [
    ['pitch.png', paintPitch()],
    ['ball.png', paintBall()],
    ['ball-shadow.png', paintBallShadow()],
    ['players.png', paintPlayers()],
  ];

  for (const [name, canvas] of outputs) {
    fs.writeFileSync(path.join(outDir, name), encodePng(canvas));
  }

  const manifest = {
    files: ['pitch.png', 'ball.png', 'ball-shadow.png', 'players.png'],
    images: {
      pitch: { w: 960, h: 540 },
      ball: { w: 32, h: 32 },
      ballShadow: { w: 32, h: 16 },
    },
    spritesheets: {
      players: {
        frameW: 32,
        frameH: 32,
        frames: ['home-idle', 'home-run', 'home-kick', 'away-idle', 'away-run', 'away-kick'],
      },
    },
    palettes: PALETTES,
  };

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log('Generated assets:');
  for (const [name] of outputs) console.log(`  public/assets/${name}`);
  console.log('  public/assets/manifest.json');
}

main();
