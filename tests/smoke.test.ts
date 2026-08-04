import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNGS = ['pitch.png', 'ball.png', 'ball-shadow.png', 'players.png'];

interface Ihdr {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
}

function parseIhdr(file: string): Ihdr {
  const buf = fs.readFileSync(path.join(ASSETS, file));
  expect(
    [...buf.subarray(0, 8)],
    `${file} must start with the PNG magic signature`,
  ).toEqual(PNG_MAGIC);
  expect(buf.toString('ascii', 12, 16), `${file} first chunk must be IHDR`).toBe('IHDR');
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colorType: buf[25],
  };
}

describe('procedural asset pipeline — smoke', () => {
  it.each(PNGS)('%s has valid PNG magic bytes', (file) => {
    parseIhdr(file);
  });

  it('pitch.png IHDR declares 960x540 8-bit RGBA', () => {
    const ihdr = parseIhdr('pitch.png');
    expect(ihdr).toMatchObject({ width: 960, height: 540, bitDepth: 8, colorType: 6 });
  });

  it('players.png dimensions are whole 32px frames (96x64)', () => {
    const ihdr = parseIhdr('players.png');
    expect(ihdr.width % 32).toBe(0);
    expect(ihdr.height % 32).toBe(0);
    expect([ihdr.width, ihdr.height]).toEqual([96, 64]);
  });

  it('manifest.json declares files, frame dims and palettes', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ASSETS, 'manifest.json'), 'utf8'));
    expect(manifest.files).toEqual(PNGS);
    expect(manifest.spritesheets.players.frameW).toBe(32);
    expect(manifest.spritesheets.players.frameH).toBe(32);
    expect(manifest.spritesheets.players.frames).toHaveLength(6);
    expect(manifest.palettes.home.shirt).toBe('#d32f2f');
    expect(manifest.palettes.away.shirt).toBe('#1976d2');
    // Manifest image dims must agree with actual IHDR dims for static images.
    for (const [key, file] of [
      ['pitch', 'pitch.png'],
      ['ball', 'ball.png'],
      ['ballShadow', 'ball-shadow.png'],
    ] as const) {
      const ihdr = parseIhdr(file);
      expect({ w: ihdr.width, h: ihdr.height }).toEqual(manifest.images[key]);
    }
  });
});
