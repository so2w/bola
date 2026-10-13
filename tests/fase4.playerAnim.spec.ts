import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type Phaser from 'phaser';

// Mock Phaser (same pattern as playerController.spec.ts) before Player import.
vi.mock('phaser', () => ({
  default: {
    Scene: class {
      constructor(_key?: string) {}
    },
    GameObjects: { Sprite: class {} },
    Math: {
      Clamp: (v: number, a: number, b: number) => Math.max(a, Math.min(b, v)),
      Vector2: class {
        constructor(public x = 0, public y = 0) {}
        length(): number {
          return Math.hypot(this.x, this.y);
        }
        lengthSq(): number {
          return this.x * this.x + this.y * this.y;
        }
        clone(): this {
          return new (this.constructor as new (x: number, y: number) => this)(this.x, this.y);
        }
        normalize(): this {
          const len = this.length();
          if (len > 0) {
            this.x /= len;
            this.y /= len;
          }
          return this;
        }
      },
    },
  },
}));

import { buildFrameMap, resolveClipFrames } from '../src/entities/frameMap';
import { Player } from '../src/entities/Player';
import { BALANCE_CONFIG } from '../src/data/balance';

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../public/assets/manifest.json', import.meta.url)), 'utf8'),
);

describe('PA-1 buildFrameMap + resolveClipFrames (2.1)', () => {
  const map = buildFrameMap(manifest);

  it('maps manifest names to array indices', () => {
    expect(map.get('home-idle')).toBe(0);
    expect(map.get('home-run')).toBe(1);
    expect(map.get('home-kick')).toBe(2);
    expect(map.get('away-idle')).toBe(3);
    expect(map.get('away-run')).toBe(4);
    expect(map.get('away-kick')).toBe(5);
  });

  it('PA-1-S1: run clip contains ONLY run frames (no kick)', () => {
    const home = resolveClipFrames(map, 'home');
    expect(home.run).toEqual([map.get('home-run')]);
    expect(home.kick).toEqual([map.get('home-kick')]);
    expect(home.idle).toEqual([map.get('home-idle')]);
  });

  it('PA-1-S2: away frames preferred, no tint fallback', () => {
    const away = resolveClipFrames(map, 'away');
    expect(away.run).toEqual([map.get('away-run')]);
    expect(away.needsTint).toBe(false);
  });

  it('PA-1-S3: missing away-kick → home-kick frames + tint flag', () => {
    const partial = new Map(map);
    partial.delete('away-kick');
    const away = resolveClipFrames(partial, 'away');
    expect(away.kick).toEqual([map.get('home-kick')]);
    expect(away.needsTint).toBe(true);
  });
});

function makeMockScene() {
  const velocity = { x: 0, y: 0, lengthSq: () => 0, length: () => 0 };
  const body = {
    setCollideWorldBounds: vi.fn(),
    setDrag: vi.fn(),
    setVelocity: (x: number, y: number) => {
      velocity.x = x;
      velocity.y = y;
    },
    velocity,
  };
  const sprite = {
    x: 100,
    y: 100,
    body,
    anims: { isPlaying: false, currentAnim: { key: '' }, play: vi.fn() },
    setPosition(x: number, y: number) {
      this.x = x;
      this.y = y;
    },
    setTint: vi.fn(),
  };
  const scene = {
    add: { sprite: vi.fn(() => sprite) },
    physics: { add: { existing: vi.fn() }, world: {} },
    anims: { exists: vi.fn(() => false), create: vi.fn() },
    game: { loop: { delta: 9999 } }, // hostile: must NOT be used by kick window
  } as unknown as Phaser.Scene;
  return { scene, sprite };
}

describe('PA-2 kick window driven by preUpdate delta (2.2)', () => {
  it('kick anim persists until PLAYER_KICK_DURATION_MS of accumulated delta, then reverts', () => {
    const { scene } = makeMockScene();
    const player = new Player(scene, 100, 100);
    player.onShot(vi.fn());
    player.shootWithPower(0.5, {
      x: 1,
      y: 0,
      clone: () => ({ x: 1, y: 0 }),
    } as unknown as Phaser.Math.Vector2);
    expect(player.animState).toBe('Kick');

    const step = 16;
    // Frames needed for accumulated delta to REACH the configured window.
    const steps = Math.floor(BALANCE_CONFIG.PHYSICS.PLAYER_KICK_DURATION_MS / step) + 1;
    for (let i = 0; i < steps - 1; i++) {
      player.preUpdate(i * step, step);
      expect(player.animState).toBe('Kick');
    }
    // 200ms total reached (loop.delta 9999 would have ended it on frame 1).
    player.preUpdate(steps * step, step);
    expect(player.animState).not.toBe('Kick');
  });
});
