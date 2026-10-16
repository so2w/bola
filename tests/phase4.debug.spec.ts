import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Phaser mock — playtestFinal.control.spec harness pattern so a REAL
// MatchScene.create() runs headless with real domain classes (proven mock).
// ---------------------------------------------------------------------------
const hoisted = vi.hoisted(() => {
  class V2 {
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
  }
  return { V2 };
});

vi.mock('phaser', () => {
  function makeBody() {
    const velocity = new hoisted.V2();
    return {
      velocity,
      setVelocity: vi.fn((x: number, y: number) => {
        velocity.x = x;
        velocity.y = y;
      }),
      setAcceleration: vi.fn(),
      setCollideWorldBounds: vi.fn(),
      setDrag: vi.fn(),
      setBounce: vi.fn(),
      setFriction: vi.fn(),
      setImmovable: vi.fn(),
    };
  }

  function makeSprite(x: number, y: number, key?: string, frame?: number) {
    const s: any = {
      x,
      y,
      textureKey: key,
      frame,
      body: undefined as any,
      anims: {
        isPlaying: false,
        currentAnim: undefined as any,
        play: vi.fn(function (animKey: string) {
          s.anims.currentAnim = { key: animKey };
          s.anims.isPlaying = true;
        }),
      },
      setPosition: vi.fn(function (nx: number, ny: number) {
        s.x = nx;
        s.y = ny;
        return s;
      }),
    };
    for (const m of ['setOrigin', 'setDepth', 'setInteractive', 'setVisible', 'setTint', 'setScale', 'setAlpha', 'setScrollFactor']) {
      s[m] = vi.fn(() => s);
    }
    s.on = vi.fn(() => s);
    return s;
  }

  function makeChain(x?: number, y?: number) {
    const o: any = { x: x ?? 0, y: y ?? 0, visible: true };
    for (const m of ['setOrigin', 'setDepth', 'setInteractive', 'setVisible', 'setText', 'setScale', 'setAlpha', 'setScrollFactor', 'setPosition', 'setFillStyle', 'setPadding', 'clear', 'lineStyle', 'strokeCircle', 'fillStyle', 'fillTriangle']) {
      o[m] = vi.fn(function (this: any, v?: unknown) {
        if (m === 'setVisible') o.visible = v as boolean;
        return o;
      });
    }
    o.on = vi.fn(() => o);
    o.add = vi.fn(() => o);
    return o;
  }

  return {
    default: {
      Scene: class {
        constructor(_key?: string) {
          this.add = {
            image: vi.fn((x: number, y: number) => makeChain(x, y)),
            text: vi.fn((x: number, y: number) => makeChain(x, y)),
            zone: vi.fn((x: number, y: number) => makeChain(x, y)),
            rectangle: vi.fn((x: number, y: number) => makeChain(x, y)),
            container: vi.fn((x: number, y: number) => makeChain(x, y)),
            graphics: vi.fn(() => makeChain()),
            sprite: vi.fn((x: number, y: number, key?: string, frame?: number) => makeSprite(x, y, key, frame)),
          };
          this.physics = {
            world: {
              setBounds: vi.fn(),
              enable: vi.fn((objs: unknown) => {
                const list = Array.isArray(objs) ? objs : [objs];
                for (const o of list as any[]) {
                  if (o && !o.body) o.body = makeBody();
                }
              }),
            },
            add: {
              existing: vi.fn((sprite: any) => {
                sprite.body = makeBody();
              }),
              overlap: vi.fn(),
            },
          };
          this.cameras = { main: { width: 960, height: 540, scrollX: 0, scrollY: 0, setZoom: vi.fn(), centerOn: vi.fn(), shake: vi.fn() } };
          this.input = {
            keyboard: {
              on: vi.fn(),
              createCursorKeys: vi.fn(() => ({})),
              addKey: vi.fn(() => ({ on: vi.fn(), isDown: false })),
            },
          };
          this.tweens = { add: vi.fn() };
          this.cache = { json: { get: vi.fn(() => undefined) }, audio: { exists: vi.fn(() => false) } };
          this.registry = { get: vi.fn(() => undefined) };
          this.sound = { play: vi.fn() };
          this.time = {
            now: 0,
            delayedCall: vi.fn(() => ({ remove: vi.fn() })),
          };
        }
        add: any;
        physics: any;
        cameras: any;
        input: any;
        tweens: any;
        cache: any;
        registry: any;
        sound: any;
        time: any;
        anims = { exists: vi.fn(() => false), create: vi.fn() };
      },
      GameObjects: { Container: class {}, Text: class {}, Sprite: class {} },
      Math: {
        Clamp: (v: number, a: number, b: number) => Math.max(a, Math.min(b, v)),
        Vector2: hoisted.V2,
      },
      Input: { Keyboard: { KeyCodes: { W: 87, A: 65, S: 83, D: 68, J: 74, K: 75, SPACE: 32 } } },
    },
  };
});

import { MatchScene } from '../src/scenes/MatchScene';
import { DebugTuning } from '../src/debug/DebugTuning';
import { buildDebugPayload, formatDebugPayload } from '../src/debug/DebugMonitor';
import { PlayerSelectionSystem } from '../src/match/PlayerSelectionSystem';
import { BALANCE_CONFIG } from '../src/data/balance';

const DBG = BALANCE_CONFIG.DEBUG;

/** Real MatchScene via create() (heavy mock — same as playtestFinal harness). */
function buildScene(): any {
  const scene = new MatchScene();
  scene.create();
  return scene as any;
}

function keyHandler(scene: any, eventName: string): () => void {
  const call = (scene.input.keyboard.on as any).mock.calls.find(
    (c: any[]) => c[0] === eventName,
  );
  expect(call, `expected a ${eventName} handler`).toBeDefined();
  return call![1] as () => void;
}

// ---------------------------------------------------------------------------
// DebugTuning — live knobs (section 30, session-only, never persisted)
// ---------------------------------------------------------------------------

describe('Phase 4 Batch A — DebugTuning knobs', () => {
  it('config knobs are well-formed (MIN < MAX, STEP > 0, DEFAULT in range)', () => {
    for (const k of DBG.TUNING.KNOBS) {
      expect(k.MIN).toBeLessThan(k.MAX);
      expect(k.STEP).toBeGreaterThan(0);
      expect(k.DEFAULT).toBeGreaterThanOrEqual(k.MIN);
      expect(k.DEFAULT).toBeLessThanOrEqual(k.MAX);
    }
  });

  it('defaults mirror the live config values (zero-drift guard)', () => {
    const passPower = DBG.TUNING.KNOBS.find((k) => k.KEY === 'passPower')!;
    const cameraLerp = DBG.TUNING.KNOBS.find((k) => k.KEY === 'cameraLerp')!;
    expect(passPower.DEFAULT).toBe(BALANCE_CONFIG.INPUT.PASS_POWER_PCT);
    expect(cameraLerp.DEFAULT).toBe(BALANCE_CONFIG.CAMERA.LERP);
  });

  it('returns config defaults and throws fail-fast on unknown knobs', () => {
    const tuning = new DebugTuning();
    expect(tuning.getValue('playerSpeed')).toBe(1);
    expect(tuning.getValue('ballFriction')).toBe(1);
    expect(tuning.getValue('shotPower')).toBe(1);
    expect(tuning.getValue('passPower')).toBe(BALANCE_CONFIG.INPUT.PASS_POWER_PCT);
    expect(() => tuning.getValue('nonexistent')).toThrow();
  });

  it('adjustSelected clamps at MIN and MAX and bumps version only on change', () => {
    const tuning = new DebugTuning();
    tuning.select('playerSpeed');
    const v0 = tuning.version;
    tuning.adjustSelected(1000);
    expect(tuning.getValue('playerSpeed')).toBe(1.5);
    expect(tuning.version).toBe(v0 + 1);
    tuning.adjustSelected(1000); // already at MAX: no change, no version bump
    expect(tuning.getValue('playerSpeed')).toBe(1.5);
    expect(tuning.version).toBe(v0 + 1);
    tuning.select('cameraLerp');
    tuning.adjustSelected(-1000);
    expect(tuning.getValue('cameraLerp')).toBe(0.01);
  });

  it('never produces NaN: non-finite steps are ignored', () => {
    const tuning = new DebugTuning();
    tuning.select('ballFriction');
    tuning.adjustSelected(NaN);
    tuning.adjustSelected(Infinity);
    tuning.adjustSelected(-Infinity);
    for (const k of DBG.TUNING.KNOBS) {
      expect(Number.isFinite(tuning.getValue(k.KEY))).toBe(true);
    }
    expect(tuning.version).toBe(0);
  });

  it('cycle wraps around the knob list and describe marks the selection', () => {
    const tuning = new DebugTuning();
    expect(tuning.selectedKey).toBe(DBG.TUNING.KNOBS[0].KEY);
    tuning.select('cameraLerp'); // last knob
    tuning.cycle();
    expect(tuning.selectedKey).toBe(DBG.TUNING.KNOBS[0].KEY);
    const lines = tuning.describe();
    expect(lines).toHaveLength(DBG.TUNING.KNOBS.length);
    expect(lines[0]).toContain('playerSpeed');
    expect(lines.filter((l) => l.startsWith('>')).length).toBe(1);
  });

  it('rejects malformed knob configs at construction (fail fast)', () => {
    const base = { KEY: 'x', LABEL: 'x', MIN: 1, MAX: 2, STEP: 0.1, DEFAULT: 1 };
    expect(() => new DebugTuning([{ ...base, MIN: 5, MAX: 1 }])).toThrow();
    expect(() => new DebugTuning([{ ...base, STEP: 0 }])).toThrow();
    expect(() => new DebugTuning([{ ...base, DEFAULT: NaN }])).toThrow();
    expect(() => new DebugTuning([])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// DebugMonitor — payload content (section 30) and formatting
// ---------------------------------------------------------------------------

describe('Phase 4 Batch A — DebugMonitor payload', () => {
  const input = {
    frameStats: { avg: 16.6667, max: 21.3, count: 60 },
    matchState: 'PLAYING',
    possessionHomePct: 52,
    controlledPlayerId: 'home-3',
    selectionCandidates: [
      { id: 'home-3', score: 1.42 },
      { id: 'home-5', score: 1.1 },
      { id: 'home-8', score: 0.87 },
      { id: 'home-9', score: 0.5 },
    ],
    pressersHome: 2,
    pressersAway: 1,
    holderId: 'away-4',
    ballX: 512,
    ballY: 280,
    ballZ: 3,
    ballSpeed: 302.6,
    surface: {
      level: 'DIRT',
      weather: 'RAIN',
      frictionMultiplier: 1.105,
      sprintSpeedMultiplier: 0.9,
      receptionDifficulty: 1.2,
    },
    rngSeed: 1,
  };

  it('carries every section-30 field', () => {
    const p = buildDebugPayload(input);
    expect(p.fps).toBeCloseTo(60, 0);
    expect(p.frameAvgMs).toBeCloseTo(16.6667, 3);
    expect(p.frameMaxMs).toBe(21.3);
    expect(p.frameCount).toBe(60);
    expect(p.matchState).toBe('PLAYING');
    expect(p.possessionHomePct).toBe(52);
    expect(p.possessionAwayPct).toBe(48);
    expect(p.controlledPlayerId).toBe('home-3');
    expect(p.pressersHome).toBe(2);
    expect(p.pressersAway).toBe(1);
    expect(p.holderId).toBe('away-4');
    expect(p.ballX).toBe(512);
    expect(p.ballY).toBe(280);
    expect(p.ballZ).toBe(3);
    expect(p.ballSpeed).toBeCloseTo(302.6, 3);
    expect(p.surface.level).toBe('DIRT');
    expect(p.surface.weather).toBe('RAIN');
    expect(p.surface.frictionMultiplier).toBeCloseTo(1.105, 9);
    expect(p.surface.sprintSpeedMultiplier).toBe(0.9);
    expect(p.surface.receptionDifficulty).toBe(1.2);
    expect(p.rngSeed).toBe(1);
  });

  it('caps selection candidates at the configured top-3', () => {
    const p = buildDebugPayload(input);
    expect(p.selectionCandidates).toHaveLength(3);
    expect(p.selectionCandidates[0]).toEqual({ id: 'home-3', score: 1.42 });
    expect(p.selectionCandidates[2]).toEqual({ id: 'home-8', score: 0.87 });
  });

  it('sanitizes non-finite inputs — the payload can never contain NaN', () => {
    const p = buildDebugPayload({
      ...input,
      frameStats: { avg: NaN, max: NaN, count: NaN },
      ballSpeed: NaN,
      possessionHomePct: NaN,
    });
    expect(p.fps).toBe(0);
    expect(p.frameAvgMs).toBe(0);
    expect(p.frameMaxMs).toBe(0);
    expect(p.ballSpeed).toBe(0);
    expect(Number.isFinite(p.possessionHomePct)).toBe(true);
    expect(JSON.stringify(p)).not.toContain('NaN');
  });

  it('fps falls back to 0 when no frames were sampled', () => {
    const p = buildDebugPayload({
      ...input,
      frameStats: { avg: 0, max: 0, count: 0 },
    });
    expect(p.fps).toBe(0);
  });

  it('formatDebugPayload renders every debug line NaN-free', () => {
    const p = buildDebugPayload(input);
    const text = formatDebugPayload(p, new DebugTuning());
    expect(text).toContain('FPS');
    expect(text).toContain('PLAYING');
    expect(text).toContain('home-3');
    expect(text).toContain('away-4');
    expect(text).toContain('DIRT');
    expect(text).toContain('RAIN');
    expect(text).toContain('playerSpeed');
    expect(text).toContain('seed');
    expect(text).not.toContain('NaN');
  });
});

// ---------------------------------------------------------------------------
// PlayerSelectionSystem — top-3 candidate scores (section 30)
// ---------------------------------------------------------------------------

describe('Phase 4 Batch A — selection exposes top-3 candidates', () => {
  it('returns up to three candidates sorted by score desc, GK excluded', () => {
    const sel = new PlayerSelectionSystem();
    sel.update(
      0,
      [
        { id: 'home-1', x: 100, y: 270, role: 'DF' },
        { id: 'home-2', x: 480, y: 270, role: 'FW' },
        { id: 'home-3', x: 465, y: 270, role: 'FW' },
        { id: 'home-4', x: 430, y: 270, role: 'MF' },
        { id: 'home-0', x: 470, y: 270, role: 'GK' }, // closest but ineligible
      ],
      { x: 470, y: 270 },
      { x: 0, y: 0 },
    );
    const top = sel.getTopCandidates(3);
    expect(top.map((t) => t.id)).toEqual(['home-3', 'home-2', 'home-4']);
    expect(top[0].score).toBeGreaterThanOrEqual(top[1].score);
    expect(top[1].score).toBeGreaterThanOrEqual(top[2].score);
    expect(top.every((t) => t.id !== 'home-0')).toBe(true);
  });

  it('returns an empty list when no candidates were scored', () => {
    const sel = new PlayerSelectionSystem();
    sel.update(0, [], { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(sel.getTopCandidates(3)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// MatchScene — debug overlay wiring (section 30)
// ---------------------------------------------------------------------------

describe('Phase 4 Batch A — MatchScene debug overlay', () => {
  it('is OFF by default and update() never touches it', () => {
    const scene = new MatchScene() as any;
    expect(scene.debugVisible).toBe(false);
    scene.debugText = { setText: vi.fn() };
    scene.updateDebugOverlay(10_000);
    expect(scene.debugText.setText).not.toHaveBeenCalled();
  });

  it('refreshes at the config cadence with a complete, NaN-free payload', () => {
    const scene = new MatchScene() as any;
    scene.debugVisible = true;
    scene.debugText = { setText: vi.fn() };
    scene.manager = { state: 'PLAYING', stats: { possessionPct: () => 52 } };
    scene.humanPlayerId = 'home-3';
    scene.selectionSystem = {
      getTopCandidates: () => [{ id: 'home-3', score: 1.42 }],
    };
    scene.coordinatorHome = { getPresserIds: () => ['home-1', 'home-2'] };
    scene.coordinatorAway = { getPresserIds: () => [] };
    scene.possession = { possessorId: 'away-4' };
    scene.ball = {
      sprite: { x: 512, y: 280 },
      body: { velocity: { x: 300, y: -40 } },
      z: 3,
    };

    // Below the cadence: no refresh yet.
    scene.updateDebugOverlay(DBG.UPDATE_INTERVAL_MS - 1);
    expect(scene.debugText.setText).not.toHaveBeenCalled();

    scene.updateDebugOverlay(1); // crosses the cadence threshold
    expect(scene.debugText.setText).toHaveBeenCalledTimes(1);
    const text = scene.debugText.setText.mock.calls[0][0] as string;
    expect(text).toContain('FPS');
    expect(text).toContain('PLAYING');
    expect(text).toContain('home-3');
    expect(text).toContain('away-4');
    expect(text).toContain('seed');
    expect(text).toContain('REGULAR_GRASS');
    expect(text).not.toContain('NaN');
  });

  it('registers the config-driven toggle and tuning keys in create()', () => {
    const scene = buildScene();
    const registered = (scene.input.keyboard.on as any).mock.calls.map(
      (c: any[]) => c[0],
    );
    expect(registered).toContain(`keydown-${DBG.TOGGLE_KEY}`);
    expect(registered).toContain(`keydown-${DBG.ADJUST_DOWN_KEY}`);
    expect(registered).toContain(`keydown-${DBG.ADJUST_UP_KEY}`);
    expect(registered).toContain(`keydown-${DBG.CYCLE_KNOB_KEY}`);
  });

  it('toggle key flips the overlay; adjust keys only act while visible', () => {
    const scene = buildScene();
    expect(scene.debugVisible).toBe(false);

    const toggle = keyHandler(scene, `keydown-${DBG.TOGGLE_KEY}`);
    const down = keyHandler(scene, `keydown-${DBG.ADJUST_DOWN_KEY}`);

    down(); // hidden: ignored
    expect(scene.debugTuning.getValue('playerSpeed')).toBe(1);

    toggle();
    expect(scene.debugVisible).toBe(true);
    const debugText = (scene.add.text as any).mock.results.at(-1).value;
    expect((debugText.setVisible as any).mock.calls.at(-1)).toEqual([true]);

    down(); // visible: adjusts the selected knob one step down
    expect(scene.debugTuning.getValue('playerSpeed')).toBeCloseTo(0.95, 10);

    toggle(); // hide again
    expect(scene.debugVisible).toBe(false);
    down();
    expect(scene.debugTuning.getValue('playerSpeed')).toBeCloseTo(0.95, 10);
  });
});
