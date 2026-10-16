import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BALANCE_CONFIG } from '../src/data/balance';
import { isGoalCrossing } from '../src/match/goalFrame';
import { UI_TEXT } from '../src/data/uiText';
import { FootballAI, aimShotTarget } from '../src/ai/FootballAI';
import { mulberry32 } from '../src/utils/rng';
import { buildFrameMap, resolveClipFrames } from '../src/entities/frameMap';
import type { EntitySnapshot, BallSnapshot, MatchContext } from '../src/ai/commands';

// Plain-JS generator module (side-effect-free import, same as goalGeometry.spec).
// @ts-expect-error — JS module without declarations
const { pitchMarkingsGeometry } = await import('../scripts/generate-sprites.js');

const shared = JSON.parse(
  readFileSync(fileURLToPath(new URL('../src/data/goalGeometry.json', import.meta.url)), 'utf8'),
) as Record<string, number>;

const CENTER = BALANCE_CONFIG.FEEDBACK.GOAL_MOUTH_CENTER_Y_PX;
const HALF = BALANCE_CONFIG.FEEDBACK.GOAL_MOUTH_HALF_HEIGHT_PX;
const LEFT_X = shared.GOAL_LINE_LEFT_X_PX;
const RIGHT_X = shared.GOAL_LINE_RIGHT_X_PX;

// ---------------------------------------------------------------------------
// 1. Pitch markings: every expected line painted from shared geometry.
// ---------------------------------------------------------------------------
describe('remediation — pitch markings enumeration', () => {
  it('exposes all 9 marking kinds so a regen can never silently drop one', () => {
    const m = pitchMarkingsGeometry();
    const kinds: string[] = m.kinds;
    for (const k of [
      'outer',
      'halfway',
      'center-circle',
      'center-spot',
      'penalty-box',
      'small-box',
      'penalty-spot',
      'penalty-arc',
      'corner-arc',
    ]) {
      expect(kinds, `missing marking kind ${k}`).toContain(k);
    }
  });

  it('paints boxes/arcs/spots on BOTH ends and corner arcs in all 4 corners', () => {
    const m = pitchMarkingsGeometry();
    expect(m.boxes.map((b: { side: string }) => b.side).sort()).toEqual(['L', 'R']);
    expect(m.corners).toHaveLength(4);
  });

  it('derives every marking size from shared goalGeometry.json (no literals)', () => {
    const m = pitchMarkingsGeometry();
    for (const b of m.boxes as Array<{
      depth: number;
      halfHeight: number;
      smallDepth: number;
      smallHalfHeight: number;
      spotOffset: number;
      arcR: number;
    }>) {
      expect(b.depth).toBe(shared.PENALTY_BOX_DEPTH_PX);
      expect(b.halfHeight).toBe(shared.PENALTY_BOX_HALF_HEIGHT_PX);
      expect(b.smallDepth).toBe(shared.SMALL_BOX_DEPTH_PX);
      expect(b.smallHalfHeight).toBe(shared.SMALL_BOX_HALF_HEIGHT_PX);
      expect(b.spotOffset).toBe(shared.PENALTY_SPOT_OFFSET_PX);
      expect(b.arcR).toBe(shared.PENALTY_ARC_RADIUS_PX);
    }
    for (const c of m.corners as Array<{ r: number }>) {
      expect(c.r).toBe(shared.CORNER_ARC_RADIUS_PX);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Goal-line crossing: the ball must cross the meta line.
// ---------------------------------------------------------------------------
describe('remediation — goal requires crossing the meta line', () => {
  it('1px inside the line is NO goal, 1px past IS a goal (left goal)', () => {
    expect(isGoalCrossing('left', LEFT_X + 1, CENTER, 0)).toBe(false);
    expect(isGoalCrossing('left', LEFT_X - 1, CENTER, 0)).toBe(true);
  });

  it('1px inside the line is NO goal, 1px past IS a goal (right goal)', () => {
    expect(isGoalCrossing('right', RIGHT_X - 1, CENTER, 0)).toBe(false);
    expect(isGoalCrossing('right', RIGHT_X + 1, CENTER, 0)).toBe(true);
  });

  it('only counts between the posts (outside the mouth = no goal)', () => {
    expect(isGoalCrossing('left', LEFT_X - 1, CENTER + HALF + 1, 0)).toBe(false);
    expect(isGoalCrossing('right', RIGHT_X + 1, CENTER - HALF - 1, 0)).toBe(false);
    expect(isGoalCrossing('left', LEFT_X - 1, CENTER + HALF, 0)).toBe(true);
  });

  it('a ball over the crossbar height is NO goal', () => {
    const maxZ = (BALANCE_CONFIG.GOAL_FRAME as Record<string, number>).GOAL_MAX_Z_PX;
    expect(maxZ).toBeGreaterThan(0);
    expect(isGoalCrossing('left', LEFT_X - 1, CENTER, maxZ + 1)).toBe(false);
    expect(isGoalCrossing('left', LEFT_X - 1, CENTER, maxZ)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Abandon affordance: one clear Spanish behavior (quit to menu).
// ---------------------------------------------------------------------------
describe('remediation — abandon button copy lives in UI_TEXT + config', () => {
  it('exposes a Spanish abandon label', () => {
    expect(UI_TEXT.HUD.ABANDON_LABEL.length).toBeGreaterThan(0);
  });

  it('carries the button geometry in BALANCE_CONFIG.HUD (zero literals)', () => {
    const hud = (BALANCE_CONFIG as unknown as Record<string, Record<string, unknown>>).HUD;
    expect(hud, 'BALANCE_CONFIG.HUD').toBeDefined();
    expect(typeof hud.ABANDON_BUTTON_X_PX).toBe('number');
    expect(typeof hud.ABANDON_BUTTON_Y_PX).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// 4. Pacing: ~15-20% slower via config, clock untouched.
// ---------------------------------------------------------------------------
describe('remediation — pacing tuning (feel via config only)', () => {
  it('slows players, keeper and recovery pace; clock scale is untouched', () => {
    expect(BALANCE_CONFIG.PHYSICS.PLAYER_MAX_SPEED).toBe(185);
    expect(BALANCE_CONFIG.ENTRANCE.ENTRANCE_WALK_SPEED_PX_S).toBe(185);
    expect(BALANCE_CONFIG.GK.GK_MAX_SPEED_PX_S).toBe(170);
    expect(BALANCE_CONFIG.GK.GK_ACCEL_PX_S2).toBe(1200);
    expect(BALANCE_CONFIG.AI.AI_RECOVERY_SPEED_FACTOR).toBe(1.05);
    expect(BALANCE_CONFIG.AI.DRIBBLE_OPEN_LANE_BOOST).toBe(1.02);
    expect(BALANCE_CONFIG.MATCH.GAME_TIME_SCALE).toBe(3);
  });

  it('slows passes and widens carrier/receiver windows', () => {
    expect(BALANCE_CONFIG.INPUT.PASS_POWER_PCT).toBe(0.32);
    expect(BALANCE_CONFIG.AI.CONTROL_RADIUS_PX).toBe(26);
    expect(BALANCE_CONFIG.AI.CAPTURE_RADIUS_PX).toBe(16);
    expect(BALANCE_CONFIG.INPUT.PASS_HINT_MS).toBe(1100);
  });
});

// ---------------------------------------------------------------------------
// 5. Shot placement: corners reachable, misses possible, no auto-center.
// ---------------------------------------------------------------------------
function holderCtx(overrides: Partial<MatchContext> = {}): MatchContext {
  const b: BallSnapshot = { x: 0, y: 0, z: 0, vx: 0, vy: 0 };
  return {
    ball: b,
    possessorId: 'home-1',
    myTeamPossession: true,
    anchorX: 0,
    anchorY: 0,
    pressers: [],
    attackDir: 1,
    ...overrides,
  };
}

describe('remediation — shots respect aim, reach corners, can miss', () => {
  it('aimShotTarget spreads across the mouth plus a bounded miss margin', () => {
    const margin = (BALANCE_CONFIG.AI as Record<string, number>).SHOT_MISS_MARGIN_PX;
    expect(margin).toBeGreaterThan(0);
    const rng = mulberry32(7);
    const ys = Array.from({ length: 200 }, () => aimShotTarget(rng, CENTER, HALF, margin));
    // Corners reachable: some finishes land near the posts.
    expect(Math.max(...ys.map((y) => Math.abs(y - CENTER)))).toBeGreaterThan(HALF - 20);
    // Misses possible: some finishes land outside the frame.
    expect(ys.some((y) => Math.abs(y - CENTER) > HALF)).toBe(true);
    // Bounded: never wildly off.
    expect(ys.every((y) => Math.abs(y - CENTER) <= HALF + margin)).toBe(true);
  });

  it('holder SHOOT commands vary across seeds (no auto-center)', () => {
    const PITCH_W = BALANCE_CONFIG.PHYSICS.PITCH_WIDTH;
    const targets = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) {
      const ai = new FootballAI(mulberry32(seed));
      const snap: EntitySnapshot = {
        id: 'home-1',
        team: 'home',
        role: 'FW',
        x: PITCH_W - 60 - 50,
        y: 270,
        vx: 0,
        vy: 0,
      };
      const cmd = ai.tick(snap, holderCtx());
      expect(cmd.action).toBe('SHOOT');
      targets.add(Math.round(cmd.targetY));
    }
    expect(targets.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// 6. Animation: run/idle variation frames resolve from the manifest.
// ---------------------------------------------------------------------------
describe('remediation — animation variation frames', () => {
  it('manifest carries second run/idle frames per team (20 frames total)', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../public/assets/manifest.json', import.meta.url)), 'utf8'),
    );
    const frames = manifest.spritesheets.players.frames as string[];
    expect(frames).toHaveLength(20);
    expect(frames).toContain('home-run-2');
    expect(frames).toContain('home-idle-2');
    expect(frames).toContain('away-run-2');
    expect(frames).toContain('away-idle-2');
  });

  it('run/idle clips resolve to frame pairs (variation actually plays)', () => {
    const map = buildFrameMap({
      spritesheets: {
        players: {
          frames: [
            'home-idle',
            'home-idle-2',
            'home-run',
            'home-run-2',
            'home-kick',
            'home-tackle',
            'home-celebrate',
            'home-dive',
            'home-claim',
            'home-distribute',
            'away-idle',
            'away-idle-2',
            'away-run',
            'away-run-2',
            'away-kick',
            'away-tackle',
            'away-celebrate',
            'away-dive',
            'away-claim',
            'away-distribute',
          ],
        },
      },
    });
    const home = resolveClipFrames(map, 'home');
    expect(home.run).toHaveLength(2);
    expect(home.idle).toHaveLength(2);
    const away = resolveClipFrames(map, 'away');
    expect(away.run).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 3b. Abandon behavior: pointerdown quits to MenuScene with settings.
// ---------------------------------------------------------------------------
vi.mock('phaser', () => {
  const chain = () => {
    const o: any = {
      visible: true,
      body: {
        setVelocity: vi.fn(),
        setAcceleration: vi.fn(),
        setImmovable: vi.fn(),
        velocity: { x: 0, y: 0 },
      },
    };
    for (const m of [
      'setOrigin',
      'setDepth',
      'setInteractive',
      'setVisible',
      'setTint',
      'setText',
      'setScale',
      'setAlpha',
      'setPadding',
      'setScrollFactor',
      'setFillStyle',
      'setPosition',
      'clear',
      'lineStyle',
      'strokeCircle',
      'fillStyle',
      'fillTriangle',
    ]) {
      o[m] = vi.fn(function (this: any, v?: unknown) {
        if (m === 'setVisible') {
          this.visible = v;
        }
        return o;
      });
    }
    o.on = vi.fn(() => o);
    o.add = vi.fn();
    return o;
  };
  return {
    default: {
      Scene: class {
        constructor(_key?: string) {
          this.add = {
            image: vi.fn(() => chain()),
            text: vi.fn(() => chain()),
            zone: vi.fn(() => chain()),
            rectangle: vi.fn(() => chain()),
            container: vi.fn(() => chain()),
            graphics: vi.fn(() => chain()),
          };
          this.physics = {
            world: { setBounds: vi.fn(), enable: vi.fn() },
            add: { overlap: vi.fn() },
          };
          this.cameras = { main: { shake: vi.fn(), width: 960, height: 540 } };
          this.input = { keyboard: { on: vi.fn() } };
          this.tweens = { add: vi.fn() };
        }
        add: any;
        physics: any;
        cameras: any;
        input: any;
        tweens: any;
      },
      GameObjects: { Container: class {}, Text: class {} },
      Math: {
        Clamp: (v: number, a: number, b: number) => Math.max(a, Math.min(b, v)),
        Vector2: class {
          constructor(public x = 0, public y = 0) {}
          normalize() {
            return this;
          }
          clone() {
            return new (this.constructor as new (x: number, y: number) => this)(this.x, this.y);
          }
          lengthSq() {
            return this.x * this.x + this.y * this.y;
          }
        },
      },
    },
  };
});

vi.mock('../src/entities/Player', () => ({
  Player: class {
    sprite = { x: 0, y: 0, setTint: vi.fn() };
    body = { setVelocity: vi.fn(), setAcceleration: vi.fn(), velocity: { x: 0, y: 0 } };
    preUpdate = vi.fn();
    updateAnimation = vi.fn();
    updateController = vi.fn();
    setPosition = vi.fn();
    shootWithPower = vi.fn();
    onShot = vi.fn();
    attachController = vi.fn();
    getPower = vi.fn(() => 0);
    isChargingNow = vi.fn(() => false);
    cancelCharge = vi.fn();
    resetAnimation = vi.fn();
    startTackle = vi.fn();
    startCelebration = vi.fn();
    applyGkClip = vi.fn();
    constructor(_scene?: unknown, _x?: number, _y?: number) {}
  },
}));

vi.mock('../src/entities/Ball', () => ({
  Ball: class {
    sprite = { x: 480, y: 270 };
    body = { setVelocity: vi.fn(), velocity: { x: 0, y: 0 } };
    z = 0;
    reset = vi.fn();
    applyKick = vi.fn();
    preUpdate = vi.fn();
    constructor(_scene?: unknown, _x?: number, _y?: number) {}
  },
}));

vi.mock('../src/match/CameraController', () => ({
  CameraController: class {
    update = vi.fn();
    constructor(_cam?: unknown) {}
  },
}));

vi.mock('../src/match/PlayerSelectionSystem', () => ({
  PlayerSelectionSystem: class {
    update = vi.fn(() => null);
  },
}));

vi.mock('../src/match/PossessionSystem', () => ({
  PossessionSystem: class {
    update = vi.fn();
    onKick = vi.fn();
  },
}));

vi.mock('../src/input/HumanInputController', () => ({
  HumanInputController: class {
    setContext(_ctx: unknown): void {}
  },
}));

vi.mock('../src/input/AIController', () => ({
  AIController: class {
    setCommand = vi.fn();
    constructor(_cb?: unknown) {}
  },
}));

vi.mock('../src/ai/TeamCoordinator', () => ({
  TeamCoordinator: class {
    update = vi.fn(() => new Map());
    tickGK = vi.fn();
    gkState = vi.fn(() => 'POSITION');
    setTactics = vi.fn();
    getTactics = vi.fn(() => 'balanced');
    setSidesSwapped = vi.fn();
    constructor(_side?: string, _formations?: unknown) {}
  },
}));

import { MatchScene } from '../src/scenes/MatchScene';

describe('remediation — abandon button quits to the menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('the top-right button is labeled Abandonar and starts MenuScene on tap', () => {
    const scene: any = new MatchScene();
    scene.create();
    const texts: any[] = (scene.add.text as any).mock.results.map((r: any) => r.value);
    const calls: any[][] = (scene.add.text as any).mock.calls;
    const idx = calls.findIndex((c) => c[2] === UI_TEXT.HUD.ABANDON_LABEL);
    expect(idx, 'abandon button text created').toBeGreaterThanOrEqual(0);
    const btn = texts[idx];
    const call = (btn.on as any).mock.calls.find((c: any[]) => c[0] === 'pointerdown');
    expect(call, 'abandon pointerdown handler').toBeDefined();
    scene.scene = { start: vi.fn() };
    (call[1] as () => void)();
    expect(scene.scene.start).toHaveBeenCalledWith('MenuScene', expect.anything());
  });
});
