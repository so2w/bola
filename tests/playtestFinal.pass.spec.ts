import { describe, expect, it, vi, beforeEach } from 'vitest';
import type Phaser from 'phaser';

// Playtest final, item 4 ("no he podido hacer pases... sería seleccionar a
// quién le paso"): the human pass must target by AIM direction — keyboard
// held-dir or touch stick vector picks the best receiver in an aim cone
// (wider than the 45° forward-only auto cone), weighted by distance +
// openness; neutral input falls back to the forward-cone auto-choice. Quick
// buffered taps must aim too. AI pass targeting stays untouched.

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
import { chooseAimedPassTarget } from '../src/input/passAim';
import { choosePassTarget } from '../src/input/passTarget';
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
    x: 500,
    y: 270,
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
    input: {
      keyboard: {
        createCursorKeys: vi.fn(() => cursor),
        addKey: vi.fn((code: number) => {
          if (!keys.has(code)) keys.set(code, new MockKey());
          return keys.get(code) as MockKey;
        }),
      },
    },
  } as unknown as Phaser.Scene & { time: { now: number } };
  return { scene, keys, cursor };
}

const PASS_RADIUS = BALANCE_CONFIG.INPUT.PASS_PICKUP_RADIUS_PX;

/** Context with the ball at the player's feet and configurable mates/foes. */
function makeContext(opts: {
  teammates?: Array<{ x: number; y: number }>;
  opponents?: Array<{ x: number; y: number }>;
}): PassContext {
  return {
    getBallPos: () => ({ x: 500 + PASS_RADIUS - 10, y: 270 }),
    getTeammates: () => opts.teammates ?? [],
    getOpponents: () => opts.opponents ?? [],
    attackDir: 1,
  };
}

/** Player sits at (500,270) — midfield, so backward = -x, forward = +x. */
function makeKeyboard() {
  const { scene, keys, cursor } = makeMockScene();
  const player = new Player(scene, 500, 270);
  const controller = new HumanInputController();
  controller.attach(scene, player);
  return { scene, keys, cursor, player, controller };
}

function makeTouch() {
  const { scene } = makeMockScene();
  const player = new Player(scene, 500, 270);
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('chooseAimedPassTarget (pure, deterministic)', () => {
  const from = { x: 500, y: 270 };

  it('picks the receiver inside the aim cone around the input direction (backward works)', () => {
    const target = chooseAimedPassTarget(
      from,
      { x: -1, y: 0 },
      [
        { x: 400, y: 270 }, // backward — the aimed receiver
        { x: 700, y: 270 }, // forward — old auto-cone favorite, out of aim
      ],
      [],
    );
    expect(target).toEqual({ x: 400, y: 270 });
  });

  it('lateral aim picks the lateral receiver over the forward-most one', () => {
    const target = chooseAimedPassTarget(
      from,
      { x: 0, y: 1 },
      [
        { x: 700, y: 270 }, // forward-most (old auto pick)
        { x: 520, y: 470 }, // down-lateral, inside a 75° cone around +y
      ],
      [],
    );
    expect(target).toEqual({ x: 520, y: 470 });
  });

  it('openness breaks ties: the unmarked receiver wins over an equally open-aimed marked one', () => {
    const target = chooseAimedPassTarget(
      from,
      { x: 1, y: 0 },
      [
        { x: 560, y: 270 }, // on-axis, but an opponent sits 51px away
        { x: 540, y: 300 }, // slightly off-axis, unmarked
      ],
      [{ x: 610, y: 280 }],
    );
    expect(target).toEqual({ x: 540, y: 300 });
  });

  it('distance weighting prefers the closer of two equally open receivers', () => {
    const target = chooseAimedPassTarget(
      from,
      { x: 1, y: 0 },
      [
        { x: 560, y: 270 },
        { x: 740, y: 270 },
      ],
      [],
    );
    expect(target).toEqual({ x: 560, y: 270 });
  });

  it('neutral aim returns null (caller falls back to the forward cone)', () => {
    expect(chooseAimedPassTarget(from, { x: 0, y: 0 }, [{ x: 600, y: 270 }], [])).toBeNull();
  });

  it('empty aim cone returns null (no receiver in that direction)', () => {
    expect(
      chooseAimedPassTarget(from, { x: 0, y: -1 }, [{ x: 600, y: 270 }], []),
    ).toBeNull();
  });

  it('respects MIN_CANDIDATES: a cone with too few receivers returns null', () => {
    expect(
      chooseAimedPassTarget(
        from,
        { x: 1, y: 0 },
        [{ x: 560, y: 270 }],
        [],
        { ...BALANCE_CONFIG.INPUT.PASS_AIM, MIN_CANDIDATES: 2 },
      ),
    ).toBeNull();
  });

  it('receivers beyond PASS_MAX_RANGE_PX are never aimed at', () => {
    const far = 500 + BALANCE_CONFIG.INPUT.PASS_MAX_RANGE_PX + 40;
    expect(chooseAimedPassTarget(from, { x: 1, y: 0 }, [{ x: far, y: 270 }], [])).toBeNull();
  });

  it('AI pass targeting is unchanged: choosePassTarget still forward-cone only', () => {
    // Explicitly documents that the AI keeps using passTarget.choosePassTarget
    // (forward-most in cone); the aim layer is human-input-only.
    const target = choosePassTarget(
      from,
      [
        { x: 400, y: 270 }, // backward — ignored by the auto cone
        { x: 650, y: 270 },
      ],
      1,
      BALANCE_CONFIG.INPUT,
    );
    expect(target).toEqual({ x: 650, y: 270 });
  });
});

describe('keyboard aimed pass (held direction at tap time)', () => {
  it('RED->GREEN: holding UP and tapping J passes to the up receiver, not the forward-most', () => {
    const { scene, cursor, player, controller } = makeKeyboard();
    const passSpy = vi.spyOn(player, 'passTo');
    controller.setContext(
      makeContext({
        teammates: [
          { x: 700, y: 270 }, // forward-most (old auto pick)
          { x: 500, y: 190 }, // up receiver
        ],
      }),
    );

    cursor.up.isDown = true;
    controller.update(16); // samples the held direction
    // J is registered through addKey(74).
    const j = getRegisteredKey(scene, 74);
    scene.time.now = 1000;
    j.press('down');
    scene.time.now += 50;
    j.press('up');

    expect(passSpy).toHaveBeenCalledTimes(1);
    expect(passSpy).toHaveBeenCalledWith({ x: 500, y: 190 });
  });

  it('RED->GREEN: a buffered tap aims with the direction held at press time', () => {
    const { scene, cursor, player, controller } = makeKeyboard();
    const passSpy = vi.spyOn(player, 'passTo');
    controller.setContext(
      makeContext({ teammates: [{ x: 500, y: 190 }, { x: 700, y: 270 }] }),
    );

    cursor.up.isDown = true;
    controller.update(16); // aim sampled
    const j = getRegisteredKey(scene, 74);
    scene.time.now = 2000;
    j.press('down'); // aim snapshot taken here (UP held)
    cursor.up.isDown = false;
    controller.update(16); // keys released — current aim goes neutral
    scene.time.now += 50; // quick buffered tap
    j.press('up');

    expect(passSpy).toHaveBeenCalledTimes(1);
    expect(passSpy).toHaveBeenCalledWith({ x: 500, y: 190 });
  });

  it('neutral input keeps the forward-cone auto-choice (existing behavior)', () => {
    const { scene, player, controller } = makeKeyboard();
    const passSpy = vi.spyOn(player, 'passTo');
    controller.setContext(
      makeContext({ teammates: [{ x: 200, y: 270 }, { x: 700, y: 270 }] }),
    );
    const j = getRegisteredKey(scene, 74);
    scene.time.now = 3000;
    j.press('down');
    scene.time.now += 50;
    j.press('up');

    expect(passSpy).toHaveBeenCalledTimes(1);
    expect(passSpy).toHaveBeenCalledWith({ x: 700, y: 270 });
  });
});

describe('touch aimed pass (stick vector at pass time IS the aim)', () => {
  it('RED->GREEN: stick pointing UP + A tap passes to the up receiver', () => {
    const { player, touch } = makeTouch();
    const passSpy = vi.spyOn(player, 'passTo');
    touch.setContext(
      makeContext({ teammates: [{ x: 700, y: 270 }, { x: 500, y: 190 }] }),
    );

    touch.setStick(0, -1);
    settle(touch);
    touch.pressActionDown(1000);
    touch.pressActionUp(1050);

    expect(passSpy).toHaveBeenCalledTimes(1);
    expect(passSpy).toHaveBeenCalledWith({ x: 500, y: 190 });
  });

  it('stick pointing DOWN passes backward-down, ignoring the forward cone', () => {
    const { player, touch } = makeTouch();
    const passSpy = vi.spyOn(player, 'passTo');
    touch.setContext(
      makeContext({ teammates: [{ x: 700, y: 270 }, { x: 460, y: 380 }] }),
    );

    touch.setStick(-0.5, 0.85); // down-left-ish heading
    settle(touch);
    touch.pressActionDown(2000);
    touch.pressActionUp(2050);

    expect(passSpy).toHaveBeenCalledTimes(1);
    expect(passSpy).toHaveBeenCalledWith({ x: 460, y: 380 });
  });

  it('neutral stick keeps the forward-cone auto-choice (existing behavior)', () => {
    const { player, touch } = makeTouch();
    const passSpy = vi.spyOn(player, 'passTo');
    touch.setContext(makeContext({ teammates: [{ x: 200, y: 270 }, { x: 700, y: 270 }] }));
    touch.setStick(0, 0);
    touch.pressActionDown(3000);
    touch.pressActionUp(3050);

    expect(passSpy).toHaveBeenCalledTimes(1);
    expect(passSpy).toHaveBeenCalledWith({ x: 700, y: 270 });
  });
});

/** The keyboard mock registers keys via addKey(code); fetch by code. */
function getRegisteredKey(scene: Phaser.Scene & { time: { now: number } }, code: number): MockKey {
  const keyboard = (scene as unknown as {
    input: { keyboard: { addKey: (code: number) => MockKey } };
  }).input.keyboard;
  return keyboard.addKey(code);
}
