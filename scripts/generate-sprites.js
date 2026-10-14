/*
 * generate-sprites.js — Procedural asset generator for Retro Soccer 2D.
 *
 * Pure Node.js, zero native dependencies (ESM because package.json declares
 * "type": "module" for Vite; stdlib imports only). Emits into public/assets/:
 *   - pitch.png       960x540  two-tone striped pitch with white field lines
 *   - ball.png        16x16    cartoon ball: cream base, bold outline, tiny
 *                              pentagon + satellites, specular highlight
 *   - ball-shadow.png 16x8     soft semi-transparent ellipse (Z-axis shadow)
 *   - players.png     96x64    spritesheet, 32x32 frames — big-head cartoon
 *                              players (~45% head, bold silhouette outline)
 *                        row 0 = home [Idle, Run, Kick]
 *                        row 1 = away [Idle, Run, Kick]
 *   - manifest.json   single source of truth consumed by BootScene
 *
 * Rendering: every asset is painted at 4x supersampling and downsampled with
 * a premultiplied-alpha area-average, giving soft anti-aliased cartoon edges
 * (AGENTS.md §21 — no hard 90s pixel stair-steps).
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

// --- 4x supersampling pipeline ---------------------------------------------

/** Supersample factor: every asset is rendered 4x and area-averaged down. */
const SS = 4;

/**
 * Virtual-coordinate painter over a supersampled canvas: all arguments are in
 * FINAL pixels and multiplied by s before hitting the integer primitives, so
 * discs/ellipses/lines gain fractional coverage once downsampled.
 */
function makePainter(hi, s = SS) {
  return {
    px: (x, y, rgb, a = 255) => blendPx(hi, Math.round(x * s), Math.round(y * s), rgb, a),
    rect: (x, y, w, h, rgb, a = 255) =>
      fillRect(hi, Math.round(x * s), Math.round(y * s), Math.round(w * s), Math.round(h * s), rgb, a),
    disc: (cx, cy, r, rgb, a = 255) => fillDisc(hi, cx * s, cy * s, r * s, rgb, a),
    ellipse: (cx, cy, rx, ry, rgb, a = 255) => fillEllipse(hi, cx * s, cy * s, rx * s, ry * s, rgb, a),
    circle: (cx, cy, r, t, rgb, a = 255) => strokeCircle(hi, cx * s, cy * s, r * s, t * s, rgb, a),
  };
}

/** Thick line from (x1,y1) to (x2,y2) as a chain of discs (0.25px steps). */
function paintSegment(P, x1, y1, x2, y2, r, rgb, a = 255) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 4));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    P.disc(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, r, rgb, a);
  }
}

/**
 * Area-average downsample from a supersampled canvas to 1/s size, in
 * premultiplied-alpha space (no dark halos on transparent edges).
 * Deterministic: fixed SS x SS box, integer rounding.
 */
function downsample(hi, s = SS) {
  if (hi.w % s !== 0 || hi.h % s !== 0) {
    throw new Error(`Cannot downsample ${hi.w}x${hi.h} by factor ${s}`);
  }
  const w = hi.w / s;
  const h = hi.h / s;
  const out = createCanvas(w, h);
  const area = s * s;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < s; sy++) {
        for (let sx = 0; sx < s; sx++) {
          const i = ((y * s + sy) * hi.w + (x * s + sx)) * 4;
          const pa = hi.buf[i + 3];
          a += pa;
          r += hi.buf[i] * pa;
          g += hi.buf[i + 1] * pa;
          b += hi.buf[i + 2] * pa;
        }
      }
      if (a === 0) continue;
      const oi = (y * w + x) * 4;
      out.buf[oi] = Math.round(r / a);
      out.buf[oi + 1] = Math.round(g / a);
      out.buf[oi + 2] = Math.round(b / a);
      out.buf[oi + 3] = Math.round(a / area);
    }
  }
  return out;
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
  const hi = createCanvas(PITCH_W * SS, PITCH_H * SS);
  const P = makePainter(hi);
  const toneA = hexRgb('#3f9e4d');
  const toneB = hexRgb('#359144');

  // 8 vertical mow stripes, alternating tones.
  const stripeW = PITCH_W / 8;
  for (let s = 0; s < 8; s++) {
    P.rect(s * stripeW, 0, stripeW, PITCH_H, s % 2 === 0 ? toneA : toneB);
  }

  // White field markings.
  const lw = 3; // line width
  // Outer border
  P.rect(FIELD.x, FIELD.y, FIELD.w, lw, WHITE);
  P.rect(FIELD.x, FIELD.y + FIELD.h - lw, FIELD.w, lw, WHITE);
  P.rect(FIELD.x, FIELD.y, lw, FIELD.h, WHITE);
  P.rect(FIELD.x + FIELD.w - lw, FIELD.y, lw, FIELD.h, WHITE);
  // Halfway line
  P.rect(PITCH_W / 2 - lw / 2, FIELD.y, lw, FIELD.h, WHITE);
  // Center circle + spot
  P.circle(PITCH_W / 2, PITCH_H / 2, 55, lw, WHITE);
  P.disc(PITCH_W / 2, PITCH_H / 2, 4, WHITE);

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
    P.rect(bx, boxY, boxW, lw, WHITE);
    P.rect(bx, boxY + boxH - lw, boxW, lw, WHITE);
    P.rect(side === 'L' ? bx + boxW - lw : bx, boxY, lw, boxH, WHITE);
    // goal area
    P.rect(gx, goalY, goalW, lw, WHITE);
    P.rect(gx, goalY + goalH - lw, goalW, lw, WHITE);
    P.rect(side === 'L' ? gx + goalW - lw : gx, goalY, lw, goalH, WHITE);
    // penalty spot
    P.disc(side === 'L' ? FIELD.x + 62 : FIELD.x + FIELD.w - 62, PITCH_H / 2, 3, WHITE);
  }

  return downsample(hi);
}

/** Ball: 16x16, body radius 6.5 (playtest: the old 32px sprite dwarfed players). */
const BALL = { W: 16, H: 16, R: 6.5 };

function paintBall() {
  const hi = createCanvas(BALL.W * SS, BALL.H * SS);
  const P = makePainter(hi);
  const cx = BALL.W / 2;
  const cy = BALL.H / 2;
  const r = BALL.R;
  const ink = hexRgb('#1c1c24'); // bold cartoon outline
  const base = hexRgb('#fff8ec'); // warm-cream white

  // Bold dark outline ring (~1px), then the cream base inside it.
  P.disc(cx, cy, r, ink);
  P.disc(cx, cy, r - 1, base);

  // Two soft radial tints, painted directly on the supersampled canvas:
  // (1) warm amber toward the rim, (2) tighter light bloom toward upper-left.
  for (let y = 0; y < hi.h; y++) {
    for (let x = 0; x < hi.w; x++) {
      const vx = (x + 0.5) / SS - cx;
      const vy = (y + 0.5) / SS - cy;
      const d = Math.hypot(vx, vy);
      if (d > r - 1) continue;
      const t = d / (r - 1);
      const rimA = Math.round(72 * t * t);
      if (rimA > 0) blendPx(hi, x, y, [214, 193, 168], rimA);
      const dl = Math.hypot(vx + 2.2, vy + 2.2);
      const lightA = Math.round(Math.max(0, 110 - dl * 34));
      if (lightA > 0) blendPx(hi, x, y, [255, 255, 255], lightA);
    }
  }

  // Tiny black pentagon: center + 5 satellites.
  P.disc(cx, cy, 1.6, BLACK);
  for (let k = 0; k < 5; k++) {
    const ang = (k * 2 * Math.PI) / 5 - Math.PI / 2;
    P.disc(cx + Math.cos(ang) * 4.2, cy + Math.sin(ang) * 4.2, 1.3, BLACK);
  }

  // Soft specular highlight, upper-left.
  P.disc(cx - 2.6, cy - 2.6, 1.5, [255, 255, 255], 190);

  return downsample(hi);
}

function paintBallShadow() {
  const W = 16;
  const H = 8;
  const hi = createCanvas(W * SS, H * SS);
  // Semi-transparent black ellipse; alpha tapers superlinearly toward the rim.
  const cx = W / 2;
  const cy = H / 2;
  const rx = 6.5;
  const ry = 3;
  for (let y = 0; y < hi.h; y++) {
    for (let x = 0; x < hi.w; x++) {
      const dx = ((x + 0.5) / SS - cx) / rx;
      const dy = ((y + 0.5) / SS - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      const a = Math.round(115 * Math.pow(1 - d, 1.4));
      blendPx(hi, x, y, BLACK, Math.min(Math.max(a, 0), 255));
    }
  }
  return downsample(hi);
}

const PALETTES = {
  home: { shirt: '#d32f2f', shorts: '#ffffff', skin: '#f1c27d' },
  away: { shirt: '#1976d2', shorts: '#ffffff', skin: '#f1c27d' },
};

const FRAME_NAMES = ['idle', 'run', 'kick'];
const FRAME_W = 32;
const FRAME_H = 32;

/** UI/silhouette ink for outlines (head, torso, arms). */
const OUTLINE = hexRgb('#202020');
const HAIR = hexRgb('#5a3a1f'); // darker hair cap
const BOOT = [40, 40, 40];

/** Darken an rgb by a factor (belly shading). */
function shade(rgb, f) {
  return [Math.round(rgb[0] * f), Math.round(rgb[1] * f), Math.round(rgb[2] * f)];
}

/**
 * Paint one 32x32 player frame into the supersampled sheet at virtual (ox, oy).
 * Cartoon direction (AGENTS.md §21): oversized head (~45% of figure height),
 * chunky oval torso in the team shirt, bold 1px dark outline around head +
 * torso for silhouette readability, visible legs and small dark boots, arms
 * hugging the torso, plus a tiny smile for charm.
 * All coordinates are final-frame pixels (scaled internally).
 */
function paintPlayerFrame(P, ox, oy, palette, pose) {
  const skin = hexRgb(palette.skin);
  const shirt = hexRgb(palette.shirt);
  const shorts = hexRgb(palette.shorts);

  // Pose offsets (final pixels, relative to the frame origin).
  const poses = {
    idle: {
      headCy: 8.4,
      arms: [[8.5, 18.5, 2.0], [23.5, 18.5, 2.0]],
      legs: [[13.4, 25, 13.4, 28.2], [18.6, 25, 18.6, 28.2]],
      boots: [[13.9, 29], 0, [18.1, 29], 0],
    },
    run: {
      headCy: 7.8,
      arms: [[7.5, 17, 2.0], [24.5, 20, 2.0]],
      legs: [[14, 25, 9.4, 28.4], [18, 25, 22.6, 27.2]], // wide exaggerated split
      boots: [[9.4, 28.8], 0, [22.6, 27.6], 0],
    },
    kick: {
      headCy: 8.4,
      arms: [[7.5, 17.5, 2.0], [24, 18.5, 2.0]],
      legs: [[13.5, 25, 13.5, 28.2], [18.8, 25, 24.4, 22.2]], // follow-through
      boots: [[14, 29], 0, [26, 21.6], 1],
    },
  };
  const p = poses[pose];
  const cx = ox + 16; // figure center x
  const headCy = oy + p.headCy;

  // 1. Legs (skin, ~2.6px wide segments) — behind the shorts band.
  for (const [x1, y1, x2, y2] of p.legs) {
    paintSegment(P, ox + x1, oy + y1, ox + x2, oy + y2, 1.3, skin);
  }

  // 2. Small dark boots at each ankle.
  for (let i = 0; i < p.boots.length; i += 2) {
    const [bx, by] = p.boots[i];
    const tilted = p.boots[i + 1] === 1;
    P.ellipse(ox + bx, oy + by, tilted ? 1.5 : 2.1, tilted ? 2.1 : 1.4, BOOT);
    P.ellipse(ox + bx, oy + by, tilted ? 1.0 : 1.6, tilted ? 1.6 : 0.9, [80, 80, 80]);
  }

  // 3. Torso: bold outline ellipse, then shirt fill, then belly shading.
  P.ellipse(cx, oy + 20.5, 9, 8, OUTLINE);
  P.ellipse(cx, oy + 20.5, 8, 7, shirt);
  P.ellipse(cx, oy + 24.2, 6.4, 2.4, shade(shirt, 0.78), 220);

  // 4. Shorts band (2-color hint kept subtle).
  P.rect(cx - 5.5, oy + 23.5, 11, 2.6, shorts);

  // 5. Arms: small circles hugging the torso, outlined for readability.
  for (const [ax, ay, ar] of p.arms) {
    P.disc(ox + ax, oy + ay, ar + 1, OUTLINE);
    P.disc(ox + ax, oy + ay, ar, skin);
  }

  // 6. Oversized head: outline ring, darker hair cap, skin face.
  P.disc(cx, headCy, 8.2, OUTLINE);
  P.disc(cx, headCy - 2.2, 7.2, HAIR);
  P.disc(cx, headCy, 7.2, skin);

  // 7. Face: two eyes + a tiny 3-px smile.
  P.disc(cx - 2.4, headCy - 0.2, 1.1, OUTLINE);
  P.disc(cx + 2.4, headCy - 0.2, 1.1, OUTLINE);
  P.rect(cx - 1.5, headCy + 2.7, 3, 1, WHITE, 230);
}

function paintPlayers() {
  const hi = createCanvas(FRAME_W * 3 * SS, FRAME_H * 2 * SS);
  const P = makePainter(hi);
  const teams = ['home', 'away'];
  teams.forEach((team, row) => {
    FRAME_NAMES.forEach((pose, col) => {
      paintPlayerFrame(P, col * FRAME_W, row * FRAME_H, PALETTES[team], pose);
    });
  });
  return downsample(hi);
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
      ball: { w: 16, h: 16 },
      ballShadow: { w: 16, h: 8 },
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
