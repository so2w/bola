import { describe, it, expect, vi } from 'vitest';
import type Phaser from 'phaser';

// Mock Phaser (same pattern as fase4.input.spec.ts).
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
import { TouchInput } from '../src/input/TouchInput';
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

function makeMockScene(opts: { withKeyboard?: boolean } = {}) {
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
  const keys = new Map<number, MockKey>();
  const cursor = {
    left: new MockKey(),
    right: new MockKey(),
    up: new MockKey(),
    down: new MockKey(),
  };
  const scene = {
    add: { sprite: vi.fn(() => sprite) },
    physics: { add: { existing: vi.fn() }, world: {} },
    anims: { exists: vi.fn(() => false), create: vi.fn() },
    time: { now: 0 },
    ...(opts.withKeyboard
      ? {
          input: {
            keyboard: {
              createCursorKeys: vi.fn(() => cursor),
              addKey: vi.fn((code: number) => {
                if (!keys.has(code)) keys.set(code, new MockKey());
                return keys.get(code) as MockKey;
              }),
            },
          },
        }
      : {}),
  } as unknown as Phaser.Scene & { time: { now: number } };
  return { scene, keys, cursor, velocity };
}

const PASS_RADIUS = BALANCE_CONFIG.INPUT.PASS_PICKUP_RADIUS_PX;
const BUFFER = BALANCE_CONFIG.INPUT.BUFFER_MS;
const MAX_SPEED = BALANCE_CONFIG.PHYSICS.PLAYER_MAX_SPEED;
const MAX_CHARGE = BALANCE_CONFIG.PHYSICS.PLAYER_MAX_CHARGE_MS;
const TOUCH = BALANCE_CONFIG.INPUT_TOUCH;

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

function makeTouch() {
  const { scene } = makeMockScene();
  const player = new Player(scene, 100, 100);
  const touch = new TouchInput();
  touch.attach(scene, player);
  return { scene, player, touch };
}

/** Settles the EMA stick filter so the intent equals the held deflection. */
function settle(touch: TouchInput, frames = 60): void {
  for (let i = 0; i < frames; i++) {
    touch.update(16);
  }
}

describe('TouchInput stick: dead-zone + normalization', () => {
  it('neutral stick never writes velocity (keyboard-merge friendly)', () => {
    const { player, touch } = makeTouch();
    touch.setContext(makeContext({}));
    touch.setStick(0, 0);
    touch.update(16);
    expect(player.body.velocity.x).toBe(0);
    expect(player.body.velocity.y).toBe(0);
  });

  it('sub-dead-zone deflection writes nothing', () => {
    const { player, touch } = makeTouch();
    touch.setContext(makeContext({}));
    const small = TOUCH.STICK_DEAD_ZONE / 2;
    touch.setStick(small, 0);
    settle(touch);
    expect(player.body.velocity.x).toBe(0);
    expect(player.body.velocity.y).toBe(0);
  });

  it('full-right deflection drives max speed on +x', () => {
    const { player, touch } = makeTouch();
    touch.setContext(makeContext({}));
    touch.setStick(1, 0);
    settle(touch);
    expect(player.body.velocity.x).toBeCloseTo(MAX_SPEED, 4);
    expect(player.body.velocity.y).toBeCloseTo(0, 4);
  });

  it('diagonal deflection is normalized like the keyboard', () => {
    const { player, touch } = makeTouch();
    touch.setContext(makeContext({}));
    touch.setStick(1, 1);
    settle(touch);
    const expected = MAX_SPEED / Math.SQRT2;
    expect(player.body.velocity.x).toBeCloseTo(expected, 4);
    expect(player.body.velocity.y).toBeCloseTo(expected, 4);
  });
});

describe('TouchInput stick filtering (stable control)', () => {
  it('an abrupt reversal does not snap: one update still leans forward', () => {
    const { player, touch } = makeTouch();
    touch.setContext(makeContext({}));
    touch.setStick(1, 0);
    settle(touch);
    expect(player.body.velocity.x).toBeCloseTo(MAX_SPEED, 4);

    touch.setStick(-1, 0);
    touch.update(16);
    // Raw stick would snap to -MAX_SPEED; the EMA filter must still be
    // inside the dead-zone (no write, velocity keeps the old forward value).
    expect(player.body.velocity.x).toBeCloseTo(MAX_SPEED, 4);
  });

  it('the filter converges to the reversal after settling', () => {
    const { player, touch } = makeTouch();
    touch.setContext(makeContext({}));
    touch.setStick(1, 0);
    settle(touch);
    touch.setStick(-1, 0);
    settle(touch);
    expect(player.body.velocity.x).toBeCloseTo(-MAX_SPEED, 3);
    expect(player.body.velocity.y).toBeCloseTo(0, 3);
  });
});

describe('TouchInput stick discretization', () => {
  it('a 10-degree deflection snaps to the nearest axis (16 directions)', () => {
    const { player, touch } = makeTouch();
    touch.setContext(makeContext({}));
    const rad = (10 * Math.PI) / 180;
    touch.setStick(Math.cos(rad), Math.sin(rad));
    settle(touch);
    // Nearest of 16 directions to 10deg is 0deg: full +x, ~zero y.
    expect(player.body.velocity.x).toBeCloseTo(MAX_SPEED, 2);
    expect(player.body.velocity.y).toBeCloseTo(0, 2);
  });

  it('a 45-degree deflection stays diagonal (multiple of the 22.5deg step)', () => {
    const { player, touch } = makeTouch();
    touch.setContext(makeContext({}));
    touch.setStick(1, 1);
    settle(touch);
    const expected = MAX_SPEED / Math.SQRT2;
    expect(player.body.velocity.x).toBeCloseTo(expected, 3);
    expect(player.body.velocity.y).toBeCloseTo(expected, 3);
  });
});

describe('TouchInput Button A contextual (pass with ball / pressure without)', () => {
  it('with ball: fires pass to the forward-most teammate in cone/range', () => {
    const { player, touch } = makeTouch();
    const passSpy = vi.spyOn(player, 'passTo');
    touch.setContext(makeContext({ teammates: [{ x: 200, y: 100 }, { x: 150, y: 100 }] }));
    touch.pressActionDown(1000);
    touch.pressActionUp(1050);
    expect(passSpy).toHaveBeenCalledTimes(1);
    expect(passSpy).toHaveBeenCalledWith({ x: 200, y: 100 });
  });

  it('without ball: no pass, pressure intent drives the player toward the ball', () => {
    const { player, touch } = makeTouch();
    const passSpy = vi.spyOn(player, 'passTo');
    touch.setContext(makeContext({ ballDx: PASS_RADIUS + 60 }));
    touch.setStick(0, 0);
    touch.pressActionDown(1000);
    expect(touch.isPressing()).toBe(true);
    touch.update(16);
    expect(passSpy).not.toHaveBeenCalled();
    expect(player.body.velocity.x).toBeGreaterThan(0);
    expect(player.body.velocity.y).toBeCloseTo(0, 6);
    touch.pressActionUp(1050);
    expect(touch.isPressing()).toBe(false);
    expect(passSpy).not.toHaveBeenCalled();
  });

  it('Phase 4 Batch B: A tap without the ball plays the tackle clip (keyboard parity)', () => {
    const { player, touch } = makeTouch();
    touch.setContext(makeContext({ ballDx: PASS_RADIUS * 4 }));
    touch.pressActionDown(1000);
    touch.pressActionUp(1050);
    expect(player.animState).toBe('Tackle');
  });

  it('stick deflection wins over pressure chase while A is held without ball', () => {
    const { player, touch } = makeTouch();
    touch.setContext(makeContext({ ballDx: PASS_RADIUS + 60 }));
    touch.setStick(0, -1);
    settle(touch);
    touch.pressActionDown(1000);
    touch.update(16);
    // Ball is at +x but the stick points up: the stick intent must win.
    expect(player.body.velocity.y).toBeLessThan(0);
  });

  it('release at exactly BUFFER_MS fires once; later release fires nothing', () => {
    const { player, touch } = makeTouch();
    const passSpy = vi.spyOn(player, 'passTo');
    touch.setContext(makeContext({ teammates: [{ x: 220, y: 110 }] }));
    touch.pressActionDown(2000);
    touch.pressActionUp(2000 + BUFFER);
    touch.pressActionUp(2000 + BUFFER); // must not re-fire
    expect(passSpy).toHaveBeenCalledTimes(1);

    passSpy.mockClear();
    touch.pressActionDown(3000);
    touch.pressActionUp(3000 + BUFFER + 1);
    expect(passSpy).not.toHaveBeenCalled();
  });
});

describe('TouchInput Button B charge (same caps as keyboard)', () => {
  it('hold charges and release fires with proportional power', () => {
    const { player, touch } = makeTouch();
    touch.setContext(makeContext({}));
    const shotSpy = vi.fn();
    player.onShot(shotSpy);
    touch.pressShotDown(1000);
    player.preUpdate(0, 500);
    touch.pressShotUp(1500);
    expect(shotSpy).toHaveBeenCalledTimes(1);
    expect(shotSpy.mock.calls[0][0]).toBeCloseTo(500 / MAX_CHARGE, 6);
  });

  it('over-long holds clamp to power 1 (PLAYER_MAX_CHARGE_MS cap)', () => {
    const { player, touch } = makeTouch();
    touch.setContext(makeContext({}));
    const shotSpy = vi.fn();
    player.onShot(shotSpy);
    touch.pressShotDown(1000);
    player.preUpdate(0, 5000);
    touch.pressShotUp(6000);
    expect(shotSpy).toHaveBeenCalledTimes(1);
    expect(shotSpy.mock.calls[0][0]).toBe(1);
  });

  it('without ball the charge is cancelled silently', () => {
    const { player, touch } = makeTouch();
    touch.setContext(makeContext({ ballDx: PASS_RADIUS + 60 }));
    const shotSpy = vi.fn();
    player.onShot(shotSpy);
    touch.pressShotDown(1000);
    player.preUpdate(0, 300);
    expect(player.isChargingNow()).toBe(true);
    touch.pressShotUp(1300);
    expect(shotSpy).not.toHaveBeenCalled();
    expect(player.isChargingNow()).toBe(false);
    expect(player.getPower()).toBe(0);
  });
});

describe('keyboard-vs-touch intent parity (AGENTS.md section 33)', () => {
  it('move parity: keyboard right+down equals stick (1,1)', () => {
    const kb = makeMockScene({ withKeyboard: true });
    const kbPlayer = new Player(kb.scene, 100, 100);
    const kbController = new HumanInputController();
    kbController.attach(kb.scene, kbPlayer);
    kb.cursor.right.isDown = true;
    kb.cursor.down.isDown = true;
    kbController.update(16);

    const { player: touchPlayer, touch } = makeTouch();
    touch.setContext(makeContext({}));
    touch.setStick(1, 1);
    settle(touch);

    expect(touchPlayer.body.velocity.x).toBeCloseTo(kbPlayer.body.velocity.x, 6);
    expect(touchPlayer.body.velocity.y).toBeCloseTo(kbPlayer.body.velocity.y, 6);
  });

  it('action parity: J-release and touch-A-release pick the same pass target', () => {
    const kb = makeMockScene({ withKeyboard: true });
    const kbPlayer = new Player(kb.scene, 100, 100);
    const kbController = new HumanInputController();
    kbController.attach(kb.scene, kbPlayer);
    const kbPass = vi.spyOn(kbPlayer, 'passTo');
    const mates = [
      { x: 200, y: 100 },
      { x: 150, y: 100 },
    ];
    kbController.setContext(makeContext({ teammates: mates }));
    const actionKey = kb.keys.get(74) as MockKey; // J
    kb.scene.time.now = 5000;
    actionKey.press('down');
    kb.scene.time.now += 50;
    actionKey.press('up');

    const { player: touchPlayer, touch } = makeTouch();
    const touchPass = vi.spyOn(touchPlayer, 'passTo');
    touch.setContext(makeContext({ teammates: mates }));
    touch.pressActionDown(5000);
    touch.pressActionUp(5050);

    expect(kbPass).toHaveBeenCalledTimes(1);
    expect(touchPass).toHaveBeenCalledTimes(1);
    expect(touchPass.mock.calls[0][0]).toEqual(kbPass.mock.calls[0][0]);
  });

  it('shot parity: identical 400ms holds produce identical power', () => {
    const kb = makeMockScene({ withKeyboard: true });
    const kbPlayer = new Player(kb.scene, 100, 100);
    const kbController = new HumanInputController();
    kbController.attach(kb.scene, kbPlayer);
    kbController.setContext(makeContext({}));
    const kbShot = vi.fn();
    kbPlayer.onShot(kbShot);
    const shotKey = kb.keys.get(75) as MockKey; // K
    kb.scene.time.now = 8000;
    shotKey.press('down');
    kbPlayer.preUpdate(0, 400);
    kb.scene.time.now += 400;
    shotKey.press('up');

    const { player: touchPlayer, touch } = makeTouch();
    touch.setContext(makeContext({}));
    const touchShot = vi.fn();
    touchPlayer.onShot(touchShot);
    touch.pressShotDown(8000);
    touchPlayer.preUpdate(0, 400);
    touch.pressShotUp(8400);

    expect(kbShot).toHaveBeenCalledTimes(1);
    expect(touchShot).toHaveBeenCalledTimes(1);
    expect(touchShot.mock.calls[0][0]).toBeCloseTo(kbShot.mock.calls[0][0], 9);
  });
});

describe('TouchInput controller interface conformance', () => {
  it('satisfies the IPlayerController contract (attach/update/setContext)', () => {
    const { scene, player, touch } = makeTouch();
    expect(typeof touch.attach).toBe('function');
    expect(typeof touch.update).toBe('function');
    expect(typeof touch.setContext).toBe('function');
    expect(() => touch.update(16)).not.toThrow();
    expect(player.hasController()).toBe(false);
    void scene;
  });

  it('attaches on a touch-only scene without a keyboard plugin', () => {
    const { scene } = makeMockScene(); // no input.keyboard
    const player = new Player(scene, 100, 100);
    const touch = new TouchInput();
    expect(() => touch.attach(scene, player)).not.toThrow();
    touch.setContext(makeContext({}));
    touch.setStick(1, 0);
    settle(touch);
    expect(player.body.velocity.x).toBeCloseTo(MAX_SPEED, 4);
  });
});
