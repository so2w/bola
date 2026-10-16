import { describe, it, expect, vi } from 'vitest';
import type Phaser from 'phaser';

// ---------------------------------------------------------------------------
// Phaser mock — full Vector2 math for the real Ball; Scene stub so a bare
// `new MatchScene()` works headless (same pattern as ball.spec / tickGK spec).
// ---------------------------------------------------------------------------
vi.mock('phaser', () => ({
  default: {
    Scene: class {
      constructor(_key?: string) {}
    },
    GameObjects: { Sprite: class {}, Image: class {}, Container: class {}, Text: class {}, Zone: class {} },
    Input: { Keyboard: { KeyCodes: { W: 87, A: 65, S: 83, D: 68, J: 74, K: 75, SPACE: 32 } } },
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
          const Ctor = this.constructor as new (x: number, y: number) => this;
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
import { WeatherSystem } from '../src/match/WeatherSystem';
import { MatchScene } from '../src/scenes/MatchScene';
import { BALANCE_CONFIG } from '../src/data/balance';

const PHYS = BALANCE_CONFIG.PHYSICS;
const SURF = BALANCE_CONFIG.SURFACE;
const WEATHER = BALANCE_CONFIG.WEATHER;

const WEATHER_CFG = { SURFACE: BALANCE_CONFIG.SURFACE, WEATHER: BALANCE_CONFIG.WEATHER };

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Minimal Vector2 stand-in for Ball.applyKick (real math lives in Ball). */
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

interface MockBallScene {
  scene: Phaser.Scene;
  body: { velocity: { x: number; y: number }; setVelocity: (x: number, y: number) => void };
}

function makeMockBallScene(): MockBallScene {
  const velocity = { x: 0, y: 0 };
  const body = {
    velocity,
    setBounce: vi.fn(),
    setFriction: vi.fn(),
    setVelocity: (vx: number, vy: number): void => {
      velocity.x = vx;
      velocity.y = vy;
    },
  };
  const sprite = { x: 480, y: 270, body };
  const shadow = { x: 480, y: 270, setScale: vi.fn(), setAlpha: vi.fn() };
  const scene = {
    add: {
      image: vi.fn(() => shadow),
      sprite: vi.fn(() => sprite),
    },
    physics: { add: { existing: vi.fn() } },
  } as unknown as Phaser.Scene;
  return { scene, body };
}

/** Kicks a ball and rolls it out under a friction multiplier. */
function rollTrace(mult: number): { speeds: number[]; stopFrame: number } {
  const { scene } = makeMockBallScene();
  const ball = new Ball(scene, 480, 270);
  ball.applyKick(new (MockVec())(1, 0) as never, 0.3);
  const speeds: number[] = [];
  let stopFrame = -1;
  for (let i = 0; i < 600; i++) {
    ball.update(16, mult);
    const s = Math.hypot(ball.body.velocity.x, ball.body.velocity.y);
    speeds.push(s);
    if (stopFrame === -1 && s === 0) {
      stopFrame = i;
    }
  }
  return { speeds, stopFrame };
}

/** Headless MatchScene with two fake teams (no create() needed). */
function makeSceneWithTeams(): any {
  const scene = new MatchScene() as any;
  const mkPlayer = () => ({ maxSpeed: PHYS.PLAYER_MAX_SPEED, passPowerPct: 0 });
  scene.homeTeam = [mkPlayer(), mkPlayer(), mkPlayer()];
  scene.awayTeam = [mkPlayer(), mkPlayer(), mkPlayer()];
  scene.cameraController = undefined;
  return scene;
}

// ---------------------------------------------------------------------------
// WeatherSystem — config-driven surface/weather (Phase 4 Batch A)
// ---------------------------------------------------------------------------

describe('Phase 4 Batch A — WeatherSystem config wiring (section 13)', () => {
  it('holds every surface/weather number in BALANCE_CONFIG (moved out of the system)', () => {
    expect(SURF.LEVELS.DIRT.FRICTION_MULT).toBe(1.3);
    expect(SURF.LEVELS.DIRT.SPRINT_MULT).toBe(0.9);
    expect(SURF.LEVELS.DIRT.RECEPTION_DIFFICULTY).toBe(1.2);
    expect(SURF.LEVELS.PROFESSIONAL_GRASS.FRICTION_MULT).toBe(0.95);
    expect(SURF.LEVELS.PROFESSIONAL_GRASS.SPRINT_MULT).toBe(1.05);
    expect(WEATHER.TYPES.RAIN.FRICTION_MULT).toBe(0.85);
    expect(WEATHER.TYPES.SNOW.FRICTION_MULT).toBe(1.2);
    expect(SURF.DEFAULT_LEVEL).toBe('REGULAR_GRASS');
    expect(WEATHER.DEFAULT_TYPE).toBe('CLEAR_DAY');
  });

  it('declares section-13 clamps (bad pitch can never cripple play)', () => {
    expect(SURF.CLAMPS.FRICTION_MIN).toBeLessThan(SURF.CLAMPS.FRICTION_MAX);
    expect(SURF.CLAMPS.SPRINT_MIN).toBeLessThan(SURF.CLAMPS.SPRINT_MAX);
    expect(SURF.CLAMPS.RECEPTION_MIN).toBeLessThan(SURF.CLAMPS.RECEPTION_MAX);
    expect(SURF.CLAMPS.SPRINT_MIN).toBeGreaterThan(0);
  });

  it('instance composes surface × weather and stays inside the clamps', () => {
    const dirtRain = new WeatherSystem(WEATHER_CFG, 'DIRT', 'RAIN');
    expect(dirtRain.frictionMultiplier).toBeCloseTo(1.3 * 0.85, 9);
    expect(dirtRain.sprintSpeedMultiplier).toBeCloseTo(0.9, 9);
    expect(dirtRain.frictionMultiplier).toBeGreaterThanOrEqual(SURF.CLAMPS.FRICTION_MIN);
    expect(dirtRain.frictionMultiplier).toBeLessThanOrEqual(SURF.CLAMPS.FRICTION_MAX);
  });

  it('default construction is fully neutral (zero gameplay change by default)', () => {
    const ws = new WeatherSystem(WEATHER_CFG);
    expect(ws.pitchQuality).toBe('REGULAR_GRASS');
    expect(ws.weatherType).toBe('CLEAR_DAY');
    expect(ws.frictionMultiplier).toBe(1);
    expect(ws.sprintSpeedMultiplier).toBe(1);
    expect(ws.receptionDifficulty).toBe(1);
  });

  it('clamps out-of-bounds config values (section 13 guard at compose time)', () => {
    const extreme = {
      SURFACE: {
        DEFAULT_LEVEL: 'DIRT',
        LEVELS: {
          ...SURF.LEVELS,
          DIRT: { FRICTION_MULT: 10, SPRINT_MULT: 0.01, RECEPTION_DIFFICULTY: 5 },
        },
        CLAMPS: SURF.CLAMPS,
      },
      WEATHER: BALANCE_CONFIG.WEATHER,
    };
    const ws = new WeatherSystem(extreme, 'DIRT');
    expect(ws.frictionMultiplier).toBe(SURF.CLAMPS.FRICTION_MAX);
    expect(ws.sprintSpeedMultiplier).toBe(SURF.CLAMPS.SPRINT_MIN);
    expect(ws.receptionDifficulty).toBe(SURF.CLAMPS.RECEPTION_MAX);
  });

  it('HEAT branch: small sprint/reception cost, friction untouched (energy deferred to Phase 6)', () => {
    const heat = WeatherSystem.getSurfaceModifiers('REGULAR_GRASS', 'HEAT');
    expect(heat.sprintSpeedMultiplier).toBeLessThan(1);
    expect(heat.sprintSpeedMultiplier).toBeGreaterThanOrEqual(SURF.CLAMPS.SPRINT_MIN);
    expect(heat.receptionDifficulty).toBeGreaterThan(1);
    expect(heat.receptionDifficulty).toBeLessThanOrEqual(SURF.CLAMPS.RECEPTION_MAX);
    expect(heat.frictionMultiplier).toBe(1);
  });

  it('fails fast on unknown pitch quality (same rule as tactics)', () => {
    expect(() => new WeatherSystem(WEATHER_CFG, 'CONCRETE' as never)).toThrow();
    expect(() => WeatherSystem.getSurfaceModifiers('CONCRETE' as never, 'CLEAR_DAY')).toThrow();
  });

  it('back-compat static API keeps the original surface numbers', () => {
    const dirt = WeatherSystem.getSurfaceModifiers('DIRT', 'CLEAR_DAY');
    expect(dirt.frictionMultiplier).toBe(1.3);
    expect(dirt.sprintSpeedMultiplier).toBe(0.9);
    const clear = WeatherSystem.getSurfaceModifiers('REGULAR_GRASS', 'CLEAR_DAY');
    const rain = WeatherSystem.getSurfaceModifiers('REGULAR_GRASS', 'RAIN');
    expect(rain.frictionMultiplier).toBeLessThan(clear.frictionMultiplier);
  });
});

// ---------------------------------------------------------------------------
// Surface multiplier reaches the ball (existing update seam)
// ---------------------------------------------------------------------------

describe('Phase 4 Batch A — surface friction reaches the ball', () => {
  it('a dirt pitch decelerates the ball measurably more than professional grass', () => {
    const dirtMods = WeatherSystem.getSurfaceModifiers('DIRT', 'CLEAR_DAY');
    const proMods = WeatherSystem.getSurfaceModifiers('PROFESSIONAL_GRASS', 'CLEAR_DAY');
    const dirt = rollTrace(dirtMods.frictionMultiplier);
    const pro = rollTrace(proMods.frictionMultiplier);

    expect(dirt.stopFrame).not.toBe(-1);
    expect(pro.stopFrame).not.toBe(-1);
    expect(dirt.stopFrame).toBeLessThanOrEqual(pro.stopFrame);

    let measurablySlower = false;
    for (let i = 0; i < dirt.speeds.length; i++) {
      expect(Number.isFinite(dirt.speeds[i])).toBe(true);
      expect(Number.isFinite(pro.speeds[i])).toBe(true);
      expect(dirt.speeds[i]).toBeLessThanOrEqual(pro.speeds[i] + 1e-9);
      if (dirt.speeds[i] < pro.speeds[i] - 1e-9) {
        measurablySlower = true;
      }
    }
    expect(measurablySlower).toBe(true);
  });

  it('composed multipliers stay within the section-13 clamp bounds', () => {
    for (const pitch of ['DIRT', 'IRREGULAR_GRASS', 'REGULAR_GRASS', 'PROFESSIONAL_GRASS'] as const) {
      for (const weather of ['CLEAR_DAY', 'NIGHT', 'RAIN', 'HEAT', 'SNOW'] as const) {
        const m = WeatherSystem.getSurfaceModifiers(pitch, weather);
        expect(m.frictionMultiplier).toBeGreaterThanOrEqual(SURF.CLAMPS.FRICTION_MIN);
        expect(m.frictionMultiplier).toBeLessThanOrEqual(SURF.CLAMPS.FRICTION_MAX);
        expect(m.sprintSpeedMultiplier).toBeGreaterThanOrEqual(SURF.CLAMPS.SPRINT_MIN);
        expect(m.sprintSpeedMultiplier).toBeLessThanOrEqual(SURF.CLAMPS.SPRINT_MAX);
        expect(m.receptionDifficulty).toBeGreaterThanOrEqual(SURF.CLAMPS.RECEPTION_MIN);
        expect(m.receptionDifficulty).toBeLessThanOrEqual(SURF.CLAMPS.RECEPTION_MAX);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Sprint modifier reaches players — both teams equally (section 13)
// ---------------------------------------------------------------------------

describe('Phase 4 Batch A — sprint modifier reaches players (both teams)', () => {
  it('DIRT sprint penalty applies identically to home and away', () => {
    const scene = makeSceneWithTeams();
    scene.weatherSystem = new WeatherSystem(WEATHER_CFG, 'DIRT');
    scene.applySpeedAndPassTuning();
    const expected = PHYS.PLAYER_MAX_SPEED * SURF.LEVELS.DIRT.SPRINT_MULT;
    for (const p of [...scene.homeTeam, ...scene.awayTeam]) {
      expect(p.maxSpeed).toBeCloseTo(expected, 9);
    }
    expect(scene.homeTeam[0].maxSpeed).toBe(scene.awayTeam[2].maxSpeed);
  });

  it('default surface leaves the base config speed untouched', () => {
    const scene = makeSceneWithTeams();
    scene.weatherSystem = new WeatherSystem(WEATHER_CFG);
    scene.applySpeedAndPassTuning();
    for (const p of [...scene.homeTeam, ...scene.awayTeam]) {
      expect(p.maxSpeed).toBe(PHYS.PLAYER_MAX_SPEED);
    }
  });

  it('HEAT sprint cost stays inside the clamp bounds', () => {
    const scene = makeSceneWithTeams();
    scene.weatherSystem = new WeatherSystem(WEATHER_CFG, 'REGULAR_GRASS', 'HEAT');
    scene.applySpeedAndPassTuning();
    const speed = scene.homeTeam[0].maxSpeed;
    expect(speed).toBeLessThan(PHYS.PLAYER_MAX_SPEED);
    expect(speed).toBeGreaterThanOrEqual(PHYS.PLAYER_MAX_SPEED * SURF.CLAMPS.SPRINT_MIN);
  });

  it('live playerSpeed knob composes with the sprint modifier', () => {
    const scene = makeSceneWithTeams();
    scene.weatherSystem = new WeatherSystem(WEATHER_CFG, 'DIRT');
    scene.debugTuning.select('playerSpeed');
    scene.debugTuning.adjustSelected(2); // +0.10
    scene.applySpeedAndPassTuning();
    const expected = PHYS.PLAYER_MAX_SPEED * SURF.LEVELS.DIRT.SPRINT_MULT * 1.1;
    expect(scene.homeTeam[0].maxSpeed).toBeCloseTo(expected, 9);
  });

  it('live passPower knob reaches every player entity', () => {
    const scene = makeSceneWithTeams();
    scene.debugTuning.select('passPower');
    scene.debugTuning.adjustSelected(1); // 0.40 -> 0.45
    scene.applySpeedAndPassTuning();
    for (const p of [...scene.homeTeam, ...scene.awayTeam]) {
      expect(p.passPowerPct).toBeCloseTo(
        BALANCE_CONFIG.INPUT.PASS_POWER_PCT + 0.05,
        9,
      );
    }
  });

  it('ball friction composes surface multiplier × live knob', () => {
    const scene = makeSceneWithTeams();
    scene.weatherSystem = new WeatherSystem(WEATHER_CFG, 'DIRT');
    expect(scene.ballFrictionMultiplier()).toBeCloseTo(1.3, 9);
    scene.debugTuning.select('ballFriction');
    scene.debugTuning.adjustSelected(20); // clamp at knob MAX (2)
    expect(scene.ballFrictionMultiplier()).toBeCloseTo(1.3 * 2, 9);
  });
});

// ---------------------------------------------------------------------------
// Pitch visual evolution (cheap, config-driven)
// ---------------------------------------------------------------------------

describe('Phase 4 Batch A — pitch visual evolution', () => {
  it('clean surfaces draw nothing; DIRT/IRREGULAR draw config-driven patches', () => {
    expect(SURF.VISUALS.REGULAR_GRASS.PATCH_COUNT).toBe(0);
    expect(SURF.VISUALS.PROFESSIONAL_GRASS.PATCH_COUNT).toBe(0);
    expect(SURF.VISUALS.DIRT.PATCH_COUNT).toBeGreaterThan(0);
    expect(SURF.VISUALS.IRREGULAR_GRASS.PATCH_COUNT).toBeGreaterThan(0);
    expect(SURF.VISUALS.DIRT.TINT_ALPHA).toBeGreaterThan(0);
  });

  it('applySurfaceVisuals draws tint + deterministic patches for DIRT', () => {
    const scene = new MatchScene() as any;
    scene.weatherSystem = new WeatherSystem(WEATHER_CFG, 'DIRT');
    scene.add = { rectangle: vi.fn() };
    scene.applySurfaceVisuals();
    expect(scene.add.rectangle).toHaveBeenCalledTimes(
      1 + SURF.VISUALS.DIRT.PATCH_COUNT,
    );
  });

  it('applySurfaceVisuals is a no-op on professional grass', () => {
    const scene = new MatchScene() as any;
    scene.weatherSystem = new WeatherSystem(WEATHER_CFG, 'PROFESSIONAL_GRASS');
    scene.add = { rectangle: vi.fn() };
    scene.applySurfaceVisuals();
    expect(scene.add.rectangle).not.toHaveBeenCalled();
  });

  it('patch placement is deterministic (no RNG — same config, same layout)', () => {
    const scene = new MatchScene() as any;
    scene.weatherSystem = new WeatherSystem(WEATHER_CFG, 'DIRT');
    const calls: number[][] = [];
    scene.add = {
      rectangle: vi.fn((...args: number[]) => {
        calls.push(args);
        return undefined;
      }),
    };
    scene.applySurfaceVisuals();
    const again: number[][] = [];
    scene.add = {
      rectangle: vi.fn((...args: number[]) => {
        again.push(args);
        return undefined;
      }),
    };
    scene.applySurfaceVisuals();
    expect(calls).toEqual(again);
  });
});
