import { describe, it, expect, vi } from 'vitest';
import type Phaser from 'phaser';

// Mock Phaser (same pattern as playerController.spec.ts).
vi.mock('phaser', () => ({
  default: {
    Scene: class {
      constructor(_key?: string) {}
    },
    GameObjects: { Sprite: class {} },
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
        setTo(x: number, y: number): this {
          this.x = x;
          this.y = y;
          return this;
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
import { HumanInputController, type PassContext } from '../src/input/HumanInputController';
import { BALANCE_CONFIG } from '../src/data/balance';

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

function makeMockScene() {
  const velocity = { x: 0, y: 0, lengthSq: () => 0, length: () => 0, clone() { return { ...this }; }, normalize() { return this; } };
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
  const keys = new Map<number, MockKey>();
  const scene = {
    add: { sprite: vi.fn(() => sprite) },
    physics: { add: { existing: vi.fn() }, world: {} },
    anims: { exists: vi.fn(() => false), create: vi.fn() },
    game: { loop: { delta: 16 } },
    input: {
      keyboard: {
        createCursorKeys: vi.fn(() => ({ left: new MockKey(), right: new MockKey(), up: new MockKey(), down: new MockKey() })),
        addKey: vi.fn((code: number) => {
          if (!keys.has(code)) keys.set(code, new MockKey());
          return keys.get(code) as MockKey;
        }),
      },
    },
    time: { now: 0 },
  } as unknown as Phaser.Scene & { time: { now: number } };
  return {
    scene,
    keys,
    actionKey: () => keys.get(74) as MockKey, // J
    shotKey: () => keys.get(75) as MockKey, // K
  };
}

const PASS_RADIUS = BALANCE_CONFIG.INPUT.PASS_PICKUP_RADIUS_PX;
const BUFFER = BALANCE_CONFIG.INPUT.BUFFER_MS;

function makeContext(opts: {
  ballDx?: number;
  teammates?: Array<{ x: number; y: number }>;
}): PassContext {
  const ballDx = opts.ballDx ?? PASS_RADIUS - 10; // within radius by default
  return {
    getBallPos: () => ({ x: 100 + ballDx, y: 100 }),
    getTeammates: () => opts.teammates ?? [],
    attackDir: 1,
  };
}

describe('MC-1 contextual pass with input buffer (4.1)', () => {
  it('MC-1-S1: pass fires to forward-most teammate inside cone/range', () => {
    const { scene, actionKey } = makeMockScene();
    const player = new Player(scene, 100, 100);
    const controller = new HumanInputController();
    controller.attach(scene, player);
    const passSpy = vi.spyOn(player, 'passTo');

    // One teammate far-forward inside cone, one closer: forward-most must win.
    controller.setContext(makeContext({ teammates: [{ x: 200, y: 100 }, { x: 150, y: 100 }] }));
    actionKey().press('down');
    scene.time.now += 50;
    actionKey().press('up');
    controller.update(16);

    expect(passSpy).toHaveBeenCalledTimes(1);
    expect(passSpy).toHaveBeenCalledWith({ x: 200, y: 100 });
  });

  it('MC-1-S2: empty cone (only backward teammates) fires no pass', () => {
    const { scene, actionKey } = makeMockScene();
    const player = new Player(scene, 100, 100);
    const controller = new HumanInputController();
    controller.attach(scene, player);
    const passSpy = vi.spyOn(player, 'passTo');

    controller.setContext(makeContext({ teammates: [{ x: 50, y: 100 }] }));
    actionKey().press('down');
    scene.time.now += 50;
    actionKey().press('up');
    controller.update(16);

    expect(passSpy).not.toHaveBeenCalled();
  });

  it('MC-1-S3: release at exactly INPUT_BUFFER_MS fires once (inclusive boundary), later fires nothing', () => {
    const { scene, actionKey } = makeMockScene();
    const player = new Player(scene, 100, 100);
    const controller = new HumanInputController();
    controller.attach(scene, player);
    const passSpy = vi.spyOn(player, 'passTo');

    controller.setContext(makeContext({ teammates: [{ x: 220, y: 110 }] }));
    actionKey().press('down');
    scene.time.now += BUFFER; // exactly at boundary
    actionKey().press('up');
    controller.update(16);
    controller.update(16); // must not re-fire
    expect(passSpy).toHaveBeenCalledTimes(1);

    // Beyond the buffer: no pass.
    const passSpy2 = vi.spyOn(player, 'passTo');
    passSpy2.mockClear();
    actionKey().press('down');
    scene.time.now += BUFFER + 1;
    actionKey().press('up');
    controller.update(16);
    expect(passSpy2).not.toHaveBeenCalled();
  });

  it('ball beyond pickup radius: no pass even with teammate in cone', () => {
    const { scene, actionKey } = makeMockScene();
    const player = new Player(scene, 100, 100);
    const controller = new HumanInputController();
    controller.attach(scene, player);
    const passSpy = vi.spyOn(player, 'passTo');

    controller.setContext(makeContext({ ballDx: PASS_RADIUS + 30, teammates: [{ x: 200, y: 100 }] }));
    actionKey().press('down');
    scene.time.now += 50;
    actionKey().press('up');
    controller.update(16);

    expect(passSpy).not.toHaveBeenCalled();
  });
});

describe('MC-2 shot gated by ball proximity (4.1)', () => {
  it('MC-2-S1: shot with ball in radius releases charge and fires', () => {
    const { scene, shotKey } = makeMockScene();
    const player = new Player(scene, 100, 100);
    const controller = new HumanInputController();
    controller.attach(scene, player);
    controller.setContext(makeContext({}));
    const shotSpy = vi.fn();
    player.onShot(shotSpy);

    shotKey().press('down');
    player.preUpdate(0, 200);
    shotKey().press('up');

    expect(shotSpy).toHaveBeenCalledTimes(1);
  });

  it('MC-2-S2: shot without ball cancels the charge silently', () => {
    const { scene, shotKey } = makeMockScene();
    const player = new Player(scene, 100, 100);
    const controller = new HumanInputController();
    controller.attach(scene, player);
    controller.setContext(makeContext({ ballDx: PASS_RADIUS + 60 }));
    const shotSpy = vi.fn();
    player.onShot(shotSpy);

    shotKey().press('down');
    player.preUpdate(0, 300);
    expect(player.isChargingNow()).toBe(true);
    shotKey().press('up');

    expect(shotSpy).not.toHaveBeenCalled();
    expect(player.isChargingNow()).toBe(false);
    expect(player.getPower()).toBe(0);
  });
});
