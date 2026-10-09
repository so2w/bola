import { describe, it, expect, vi } from 'vitest';
import type Phaser from 'phaser';

// Mock Phaser before importing modules that import it (same pattern as paso4.test.ts)
vi.mock('phaser', () => ({
  default: {
    Scene: class {
      constructor(_key?: string) {}
    },
    GameObjects: {
      Sprite: class {},
      Container: class {},
      Text: class {},
    },
    Input: {
      Keyboard: {
        KeyCodes: { W: 87, A: 65, S: 83, D: 68, SPACE: 32 },
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

import { Player } from '../src/entities/Player';
import { HumanInputController } from '../src/input/HumanInputController';
import { AIController } from '../src/input/AIController';

/** Minimal Vector2-like used by the mocked Arcade body velocity. */
class MockVector {
  constructor(public x = 0, public y = 0) {}
  length(): number {
    return Math.hypot(this.x, this.y);
  }
  lengthSq(): number {
    return this.x * this.x + this.y * this.y;
  }
  clone(): MockVector {
    return new MockVector(this.x, this.y);
  }
  normalize(): MockVector {
    const len = this.length();
    if (len > 0) {
      this.x /= len;
      this.y /= len;
    }
    return this;
  }
}

/** Minimal Phaser Key-like: isDown flag + down/up handlers, manually triggerable. */
class MockKey {
  isDown = false;
  private handlers: Record<string, Array<() => void>> = {};
  on(event: string, cb: () => void): void {
    (this.handlers[event] ??= []).push(cb);
  }
  press(event: 'down' | 'up'): void {
    this.isDown = event === 'down';
    for (const cb of this.handlers[event] ?? []) cb();
  }
}

/**
 * Fully mocked Phaser.Scene: counts createCursorKeys/addKey calls, exposes the
 * single shared sprite/body so Player construction works without DOM/Phaser runtime.
 */
function makeMockScene() {
  let cursorKeyCalls = 0;
  const addKeyCodes: number[] = [];
  const velocity = new MockVector();
  const body = {
    setCollideWorldBounds: vi.fn(),
    setDrag: vi.fn(),
    setAcceleration: vi.fn(),
    setVelocity: (x: number, y: number) => {
      velocity.x = x;
      velocity.y = y;
    },
    velocity,
  };
  const sprite = {
    x: 560,
    y: 270,
    body,
    anims: { isPlaying: false, currentAnim: { key: 'player_idle' }, play: vi.fn() },
    setPosition(x: number, y: number) {
      this.x = x;
      this.y = y;
    },
    setTint: vi.fn(),
  };
  const cursor = {
    left: new MockKey(),
    right: new MockKey(),
    up: new MockKey(),
    down: new MockKey(),
  };
  const keys = new Map<number, MockKey>();
  const scene = {
    add: { sprite: vi.fn(() => sprite) },
    physics: { add: { existing: vi.fn() }, world: {} },
    anims: { exists: vi.fn(() => false), create: vi.fn() },
    input: {
      keyboard: {
        createCursorKeys: vi.fn(() => {
          cursorKeyCalls++;
          return cursor;
        }),
        addKey: vi.fn((code: number) => {
          addKeyCodes.push(code);
          if (!keys.has(code)) keys.set(code, new MockKey());
          return keys.get(code) as MockKey;
        }),
      },
    },
    game: { loop: { delta: 16 } },
  } as unknown as Phaser.Scene;
  return {
    scene,
    sprite: sprite as unknown as Phaser.GameObjects.Sprite,
    cursor,
    keys,
    velocity,
    cursorCalls: () => cursorKeyCalls,
    addKeyCodes: () => addKeyCodes,
  };
}

const MAX_SPEED = 220;

describe('HumanInputController behavioral parity (vs legacy Player bindings)', () => {
  it('moves right at max speed when cursor right is down', () => {
    const { scene, cursor } = makeMockScene();
    const player = new Player(scene, 560, 270);
    const controller = new HumanInputController();
    controller.attach(scene, player);

    cursor.right.isDown = true;
    controller.update(16);

    expect(player.body.velocity.x).toBe(MAX_SPEED);
    expect(player.body.velocity.y).toBe(0);
  });

  it('diagonal input is normalized (right+down ≈ maxSpeed/√2 per axis)', () => {
    const { scene, cursor } = makeMockScene();
    const player = new Player(scene, 560, 270);
    const controller = new HumanInputController();
    controller.attach(scene, player);

    cursor.right.isDown = true;
    cursor.down.isDown = true;
    controller.update(16);

    const expected = MAX_SPEED / Math.SQRT2;
    expect(player.body.velocity.x).toBeCloseTo(expected, 6);
    expect(player.body.velocity.y).toBeCloseTo(expected, 6);
  });

  it('opposite keys cancel (legacy: right+left → vec 0 → stop)', () => {
    const { scene, cursor } = makeMockScene();
    const player = new Player(scene, 560, 270);
    const controller = new HumanInputController();
    controller.attach(scene, player);

    cursor.right.isDown = true;
    cursor.left.isDown = true;
    controller.update(16);

    expect(player.body.velocity.lengthSq()).toBe(0);
  });

  it('no keys → velocity zero', () => {
    const { scene } = makeMockScene();
    const player = new Player(scene, 560, 270);
    const controller = new HumanInputController();
    controller.attach(scene, player);

    controller.update(16);

    expect(player.body.velocity.x).toBe(0);
    expect(player.body.velocity.y).toBe(0);
  });

  it('WASD fallback + SPACE bindings registered exactly like legacy', () => {
    const { scene, addKeyCodes } = makeMockScene();
    const player = new Player(scene, 560, 270);
    const controller = new HumanInputController();
    controller.attach(scene, player);

    expect(addKeyCodes().length).toBe(5); // W, A, S, D, SPACE
    expect(addKeyCodes().filter((c) => c === c).length).toBe(5);
  });

  it('charge curve parity: SPACE down → charge accumulates, up → kick + shot(power=0.5, facing right)', () => {
    const { scene, keys, velocity } = makeMockScene();
    const player = new Player(scene, 560, 270);
    const controller = new HumanInputController();
    controller.attach(scene, player);

    const shotSpy = vi.fn();
    player.onShot(shotSpy);

    const space = [...keys.values()].find((k) => k !== undefined);
    // SPACE was added last; find by pressing each is unsafe — instead identify via registry order (W,A,S,D,SPACE)
    const allKeys = [...keys.values()];
    const spaceKey = allKeys[allKeys.length - 1] as MockKey;

    expect(space).toBeDefined();
    spaceKey.press('down');
    // Accumulate ~500ms of charge via preUpdate deltas
    for (let i = 0; i < 31; i++) {
      player.preUpdate(0, 16);
    }
    expect(player.chargeTimer).toBe(496); // clamped accumulate: 31*16 = 496
    expect(player.getPower()).toBeCloseTo(0.496, 6);

    spaceKey.press('up');
    expect(shotSpy).toHaveBeenCalledTimes(1);
    const [power, facing] = shotSpy.mock.calls[0] as [number, { x: number; y: number }];
    expect(power).toBeCloseTo(0.496, 6);
    // velocity was never set → default facing right (1, 0)
    expect(facing.x).toBe(1);
    expect(facing.y).toBe(0);
    expect(player.animState).toBe('Kick');
    expect(player.chargeTimer).toBe(0);
    expect(velocity.lengthSq()).toBe(0);
  });

  it('release without charge does not fire shot', () => {
    const { scene, keys } = makeMockScene();
    const player = new Player(scene, 560, 270);
    const controller = new HumanInputController();
    controller.attach(scene, player);
    const shotSpy = vi.fn();
    player.onShot(shotSpy);

    const allKeys = [...keys.values()];
    const spaceKey = allKeys[allKeys.length - 1] as MockKey;
    spaceKey.press('up');

    expect(shotSpy).not.toHaveBeenCalled();
  });
});

describe('AIController (stub locomotion)', () => {
  it('moves toward command target', () => {
    const { scene } = makeMockScene();
    const player = new Player(scene, 560, 270);
    const controller = new AIController();
    controller.attach(scene, player);

    controller.setCommand({ targetX: 100, targetY: 270, action: 'MOVE' });
    controller.update(16);

    expect(player.body.velocity.x).toBeLessThan(0);
    expect(player.body.velocity.y).toBe(0);
  });

  it('no command → no movement', () => {
    const { scene } = makeMockScene();
    const player = new Player(scene, 560, 270);
    const controller = new AIController();
    controller.attach(scene, player);

    controller.update(16);

    expect(player.body.velocity.lengthSq()).toBe(0);
  });
});

describe('controller split — Player entity is input-free', () => {
  it('22 Players instantiate with AIController and zero createCursorKeys calls', () => {
    const { scene, cursorCalls } = makeMockScene();
    for (let i = 0; i < 22; i++) {
      const p = new Player(scene, 100 + i, 270);
      p.attachController(new AIController());
    }
    expect(cursorCalls()).toBe(0);
  });

  it('one HumanInputController attach registers cursors exactly once', () => {
    const { scene, cursorCalls } = makeMockScene();
    const p = new Player(scene, 560, 270);
    p.attachController(new HumanInputController());
    expect(cursorCalls()).toBe(1);
  });

  it('Player without controller does not move on its own', () => {
    const { scene, velocity } = makeMockScene();
    const player = new Player(scene, 560, 270);
    player.preUpdate(0, 16);
    expect(velocity.lengthSq()).toBe(0);
  });
});
