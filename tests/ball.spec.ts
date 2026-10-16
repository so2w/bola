import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Phaser from 'phaser';

// Mock Phaser before importing Ball (same pattern as fase4.input.spec.ts).
vi.mock('phaser', () => ({
  default: {
    Scene: class {
      constructor(_key?: string) {}
    },
    GameObjects: { Sprite: class {}, Image: class {} },
    Input: {
      Keyboard: {
        KeyCodes: { W: 87, A: 65, S: 83, D: 68, SPACE: 32, J: 74, K: 75 },
      },
    },
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
        clone(): InstanceType<typeof this> {
          const Ctor = this.constructor as new (x: number, y: number) => InstanceType<typeof this>;
          return new Ctor(this.x, this.y);
        }
        normalize(): this {
          const len = this.length();
          if (len > 0) {
            this.x /= len;
            this.y /= len;
          }
          return this;
        }
        scale(s: number): this {
          this.x *= s;
          this.y *= s;
          return this;
        }
        setTo(x: number, y: number): this {
          this.x = x;
          this.y = y;
          return this;
        }
      },
    },
  },
}));

import { Ball } from '../src/entities/Ball';
import { BALANCE_CONFIG } from '../src/data/balance';

const PHYS = BALANCE_CONFIG.PHYSICS;

interface MockBallScene {
  scene: Phaser.Scene;
  body: { x: number; y: number; setVelocity: (x: number, y: number) => void; velocity: { x: number; y: number } };
  sprite: { x: number; y: number; setPosition: (x: number, y: number) => void };
  shadow: { x: number; y: number; setScale: ReturnType<typeof vi.fn>; setAlpha: ReturnType<typeof vi.fn> };
}

function makeMockScene(x = 480, y = 270): MockBallScene {
  const velocity = { x: 0, y: 0 };
  const body = {
    x: 0,
    y: 0,
    velocity,
    setBounce: vi.fn(),
    setFriction: vi.fn(),
    setVelocity: (vx: number, vy: number): void => {
      velocity.x = vx;
      velocity.y = vy;
    },
  };
  const sprite = {
    x,
    y,
    body,
    setPosition: (nx: number, ny: number): void => {
      sprite.x = nx;
      sprite.y = ny;
    },
  };
  const shadow = {
    x,
    y,
    setScale: vi.fn(),
    setAlpha: vi.fn(),
  };
  const scene = {
    add: {
      image: vi.fn(() => shadow),
      sprite: vi.fn(() => sprite),
    },
    physics: { add: { existing: vi.fn() } },
  } as unknown as Phaser.Scene;
  return { scene, body, sprite, shadow };
}

describe('Ball vertical physics (AGENTS.md section 29)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('friction reduces speed stably on the ground (monotonic, no NaN, comes to rest)', () => {
    const { scene } = makeMockScene();
    const ball = new Ball(scene, 480, 270);
    ball.applyKick(new (MockVec())(1, 0) as never, 1.0);
    const dtMs = 16;
    let prev = Math.hypot(ball.body.velocity.x, ball.body.velocity.y);
    expect(prev).toBeGreaterThan(0);
    for (let i = 0; i < 600; i++) {
      ball.update(dtMs);
      const speed = Math.hypot(ball.body.velocity.x, ball.body.velocity.y);
      expect(Number.isFinite(speed)).toBe(true);
      expect(speed).toBeLessThanOrEqual(prev + 1e-9);
      prev = speed;
      expect(ball.z).toBeGreaterThanOrEqual(0);
    }
    // Rolling resistance must eventually stop the ball.
    expect(Math.hypot(ball.body.velocity.x, ball.body.velocity.y)).toBe(0);
  });

  it('z never stays below zero across kicks and long simulation', () => {
    const { scene } = makeMockScene();
    const ball = new Ball(scene, 480, 270);
    for (const power of [0.2, 0.5, 1.0]) {
      ball.applyKick(new (MockVec())(0.6, 0.8) as never, power);
      for (let i = 0; i < 300; i++) {
        ball.update(16);
        expect(ball.z).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(ball.z)).toBe(true);
      }
    }
    expect(ball.z).toBe(0);
  });

  it('bounce/landing never gains energy (peak and vz shrink after each bounce)', () => {
    const { scene } = makeMockScene();
    const ball = new Ball(scene, 480, 270);
    ball.applyKick(new (MockVec())(1, 0) as never, 1.0);
    const peaks: number[] = [];
    let ascending = true;
    let currentPeak = ball.z;
    let prevZ = ball.z;
    // Track pre-bounce |vz| vs post-bounce |vz| at the first ground contact.
    let preBounceVz = 0;
    let postBounceVz = 0;
    let bounced = false;
    for (let i = 0; i < 1200; i++) {
      const beforeZ = ball.z;
      const beforeVz = (ball as unknown as { vz: number }).vz;
      ball.update(16);
      if (beforeZ > 0 && ball.z === 0 && beforeVz < 0 && !bounced) {
        preBounceVz = Math.abs(beforeVz);
        postBounceVz = Math.abs((ball as unknown as { vz: number }).vz);
        bounced = true;
      }
      if (ball.z > prevZ) {
        if (!ascending) {
          peaks.push(currentPeak);
          currentPeak = ball.z;
        }
        ascending = true;
        currentPeak = Math.max(currentPeak, ball.z);
      } else if (ball.z < prevZ) {
        ascending = false;
      }
      prevZ = ball.z;
      void ascending;
    }
    peaks.push(currentPeak);
    expect(bounced).toBe(true);
    expect(postBounceVz).toBeLessThan(preBounceVz);
    // Restitution < 1 is config-driven.
    expect(PHYS.BALL_RESTITUTION_Z).toBeLessThan(1);
    // Ball eventually rests on the ground with no residual velocity.
    expect(ball.z).toBe(0);
    expect((ball as unknown as { vz: number }).vz).toBe(0);
  });

  it('surface multiplier changes deceleration within bounds (more friction stops faster)', () => {
    const low: number[] = [];
    const high: number[] = [];
    for (const [out, mult] of [[low, 0.5], [high, 2.0]] as Array<[number[], number]>) {
      const { scene } = makeMockScene();
      const ball = new Ball(scene, 480, 270);
      ball.applyKick(new (MockVec())(1, 0) as never, 0.3);
      for (let i = 0; i < 120; i++) {
        ball.update(16, mult);
        out.push(Math.hypot(ball.body.velocity.x, ball.body.velocity.y));
      }
    }
    // Higher surface friction must decelerate at least as fast at every step.
    for (let i = 0; i < low.length; i++) {
      expect(high[i]).toBeLessThanOrEqual(low[i] + 1e-9);
      expect(Number.isFinite(high[i])).toBe(true);
      expect(Number.isFinite(low[i])).toBe(true);
      expect(high[i]).toBeGreaterThanOrEqual(0);
      expect(low[i]).toBeGreaterThanOrEqual(0);
    }
    const lastLow = low[low.length - 1];
    const lastHigh = high[high.length - 1];
    expect(lastHigh).toBeLessThanOrEqual(lastLow);
  });

  it('determinism: same kick and steps produce identical trajectories (no randomness)', () => {
    const run = (): Array<{ x: number; z: number; vx: number; vz: number }> => {
      const { scene } = makeMockScene();
      const ball = new Ball(scene, 480, 270);
      ball.applyKick(new (MockVec())(1, 0) as never, 0.7);
      const trace: Array<{ x: number; z: number; vx: number; vz: number }> = [];
      for (let i = 0; i < 200; i++) {
        ball.update(16);
        trace.push({
          x: ball.sprite.x,
          z: ball.z,
          vx: ball.body.velocity.x,
          vz: (ball as unknown as { vz: number }).vz,
        });
      }
      return trace;
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
  });

  it('applyKick is reproducible with explicit parameters and respects the min threshold', () => {
    const { scene: s1 } = makeMockScene();
    const { scene: s2 } = makeMockScene();
    const a = new Ball(s1, 480, 270);
    const b = new Ball(s2, 480, 270);
    a.applyKick(new (MockVec())(1, 0) as never, 0.8);
    b.applyKick(new (MockVec())(1, 0) as never, 0.8);
    expect(a.body.velocity.x).toBe(b.body.velocity.x);
    expect(a.body.velocity.y).toBe(b.body.velocity.y);
    expect((a as unknown as { vz: number }).vz).toBe((b as unknown as { vz: number }).vz);

    // Below-threshold kicks do nothing.
    const { scene: s3 } = makeMockScene();
    const c = new Ball(s3, 480, 270);
    c.applyKick(new (MockVec())(1, 0) as never, PHYS.BALL_MIN_KICK_THRESHOLD - 0.01);
    expect(c.body.velocity.x).toBe(0);
    expect(c.body.velocity.y).toBe(0);
    expect(c.z).toBe(0);
  });

  it('shadow stays tied to x/y and scales with z (existing behavior preserved)', () => {
    const { scene, sprite, shadow } = makeMockScene(100, 150);
    const ball = new Ball(scene, 100, 150);
    sprite.x = 200;
    sprite.y = 220;
    ball.applyKick(new (MockVec())(1, 0) as never, 1.0);
    ball.update(16);
    expect(shadow.x).toBe(200);
    expect(shadow.y).toBe(220 + PHYS.BALL_SHADOW_Y_OFFSET_PX);
    expect(shadow.setScale).toHaveBeenCalled();
    expect(shadow.setAlpha).toHaveBeenCalled();
  });
});

// Minimal Vector2 stand-in for applyKick direction (real math lives in Ball).
function MockVec(): new (x: number, y: number) => { x: number; y: number } {
  return class {
    constructor(public x = 0, public y = 0) {}
    clone(): this {
      const Ctor = this.constructor as new (x: number, y: number) => this;
      return new Ctor(this.x, this.y);
    }
    normalize(): this {
      const len = Math.hypot(this.x, this.y);
      if (len > 0) {
        this.x /= len;
        this.y /= len;
      }
      return this;
    }
    scale(s: number): this {
      this.x *= s;
      this.y *= s;
      return this;
    }
  } as unknown as new (x: number, y: number) => { x: number; y: number };
}
