import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type Phaser from 'phaser';

// Mock Phaser (same pattern as fase4.input.spec.ts) before entity imports.
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

import { buildFrameMap, resolveClipFrames } from '../src/entities/frameMap';
import { gkClipForState } from '../src/entities/gkAnim';
import { pickCelebrationIds } from '../src/match/celebration';
import { Player } from '../src/entities/Player';
import { HumanInputController, type PassContext } from '../src/input/HumanInputController';
import { TeamCoordinator } from '../src/ai/TeamCoordinator';
import { resolveFormation } from '../src/data/formations';
import { BALANCE_CONFIG } from '../src/data/balance';
import type { GKState } from '../src/ai/GoalkeeperAI';

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../public/assets/manifest.json', import.meta.url)), 'utf8'),
);

// ---------------------------------------------------------------------------
// A. Generator output: new clips land in the manifest + sheet at exact indices.
// ---------------------------------------------------------------------------

const EXPECTED_CLIPS = [
  'idle',
  'run',
  'kick',
  'tackle',
  'celebrate',
  'dive',
  'claim',
  'distribute',
] as const;

describe('Phase 4 Batch B — generator emits the new cartoon clips', () => {
  it('manifest declares 16 frames: 8 clips x 2 teams, row-major (home row first)', () => {
    const frames = manifest.spritesheets.players.frames as string[];
    expect(frames).toHaveLength(16);
    for (const team of ['home', 'away'] as const) {
      EXPECTED_CLIPS.forEach((clip, i) => {
        expect(frames).toContain(`${team}-${clip}`);
        expect(frames.indexOf(`${team}-${clip}`)).toBe(
          (team === 'home' ? 0 : EXPECTED_CLIPS.length) + i,
        );
      });
    }
  });

  it('players.png sheet grew to 256x64 (8 columns of 32px, 2 team rows)', () => {
    const buf = readFileSync(fileURLToPath(new URL('../public/assets/players.png', import.meta.url)));
    expect(buf.toString('ascii', 12, 16)).toBe('IHDR');
    expect(buf.readUInt32BE(16)).toBe(256);
    expect(buf.readUInt32BE(20)).toBe(64);
  });
});

// ---------------------------------------------------------------------------
// B. frameMap: every new clip resolves for both teams.
// ---------------------------------------------------------------------------

describe('Phase 4 Batch B — frameMap resolves every new clip for both teams', () => {
  const map = buildFrameMap(manifest);

  it('resolves the single-frame clips (tackle/dive/claim/distribute) per team', () => {
    for (const team of ['home', 'away'] as const) {
      const resolved = resolveClipFrames(map, team);
      expect(resolved.tackle).toEqual([map.get(`${team}-tackle`)]);
      expect(resolved.dive).toEqual([map.get(`${team}-dive`)]);
      expect(resolved.claim).toEqual([map.get(`${team}-claim`)]);
      expect(resolved.distribute).toEqual([map.get(`${team}-distribute`)]);
      expect(resolved.needsTint).toBe(false);
    }
  });

  it('celebration clip is the arms-up/idle bounce pair', () => {
    for (const team of ['home', 'away'] as const) {
      const resolved = resolveClipFrames(map, team);
      expect(resolved.celebrate).toEqual([
        map.get(`${team}-celebrate`),
        map.get(`${team}-idle`),
      ]);
    }
  });

  it('missing away clip falls back to the home frame + tint flag', () => {
    const partial = new Map(map);
    partial.delete('away-tackle');
    const away = resolveClipFrames(partial, 'away');
    expect(away.tackle).toEqual([map.get('home-tackle')]);
    expect(away.needsTint).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C. GK FSM state -> clip mapping is complete (AGENTS.md section 11/21).
// ---------------------------------------------------------------------------

describe('Phase 4 Batch B — GK FSM state to clip mapping', () => {
  const ALL_GK_STATES: GKState[] = [
    'POSITION',
    'TRACK',
    'CLAIM',
    'DIVE',
    'HOLD',
    'DISTRIBUTE',
    'RECOVER',
  ];

  it('maps every GK state to a defined clip', () => {
    for (const state of ALL_GK_STATES) {
      expect(gkClipForState(state)).toBeDefined();
    }
  });

  it('specialty states pick their own clips; positioning reuses idle/run', () => {
    expect(gkClipForState('DIVE')).toBe('dive');
    expect(gkClipForState('CLAIM')).toBe('claim');
    expect(gkClipForState('HOLD')).toBe('claim');
    expect(gkClipForState('DISTRIBUTE')).toBe('distribute');
    expect(gkClipForState('POSITION')).toBe('idle');
    expect(gkClipForState('TRACK')).toBe('run');
    expect(gkClipForState('RECOVER')).toBe('run');
  });

  it('TeamCoordinator exposes the live keeper state for the scene', () => {
    const coordinator = new TeamCoordinator('home', resolveFormation('5v5'));
    expect(coordinator.gkState()).toBe('POSITION');
    coordinator.tickGK(16, { id: 'home-0', team: 'home', role: 'GK', x: 40, y: 270, vx: 0, vy: 0 }, {
      ball: { x: 480, y: 270, z: 0, vx: 0, vy: 0 },
      teammates: [],
      opponents: [],
      attackDir: 1,
    });
    expect(coordinator.gkState()).toBe('POSITION');
    coordinator.tickGK(16, { id: 'home-0', team: 'home', role: 'GK', x: 40, y: 270, vx: 0, vy: 0 }, {
      ball: { x: 120, y: 270, z: 0, vx: 0, vy: 0 },
      teammates: [],
      opponents: [],
      attackDir: 1,
    });
    expect(coordinator.gkState()).toBe('TRACK');
  });
});

// ---------------------------------------------------------------------------
// D. Player override clips: fire on action, bounded duration, never wedge.
// ---------------------------------------------------------------------------

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
  const keys = new Map<number, MockKey>();
  const scene = {
    add: { sprite: vi.fn(() => sprite) },
    physics: { add: { existing: vi.fn() }, world: {} },
    anims: { exists: vi.fn(() => false), create: vi.fn() },
    game: { loop: { delta: 16 } },
    input: {
      keyboard: {
        createCursorKeys: vi.fn(() => ({
          left: new MockKey(),
          right: new MockKey(),
          up: new MockKey(),
          down: new MockKey(),
        })),
        addKey: vi.fn((code: number) => {
          if (!keys.has(code)) keys.set(code, new MockKey());
          return keys.get(code) as MockKey;
        }),
      },
    },
    time: { now: 0 },
  } as unknown as Phaser.Scene & { time: { now: number } };
  return { scene, sprite, keys };
}

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

function advance(player: Player, totalMs: number, stepMs = 16): void {
  for (let t = 0; t < totalMs; t += stepMs) {
    player.updateAnimation(stepMs);
  }
}

describe('Phase 4 Batch B — Player override clips (tackle/celebration/GK)', () => {
  it('tackle fires on the action and is bounded by ANIM.TACKLE_DURATION_MS', () => {
    const { scene, sprite } = makeMockScene();
    const player = new Player(scene, 100, 100);
    player.startTackle();
    expect(player.animState).toBe('Tackle');
    expect(sprite.anims.play).toHaveBeenCalledWith('player_tackle_home', true);

    advance(player, BALANCE_CONFIG.ANIM.TACKLE_DURATION_MS - 1, 1);
    expect(player.animState).toBe('Tackle');
    advance(player, 2, 1);
    expect(player.animState).not.toBe('Tackle');
  });

  it('startTackle is a no-op while another action clip is in flight (no restart)', () => {
    const { scene } = makeMockScene();
    const player = new Player(scene, 100, 100);
    const duration = BALANCE_CONFIG.ANIM.TACKLE_DURATION_MS;
    player.startTackle();
    advance(player, duration / 2);
    player.startTackle(); // mid-window: must NOT restart the window
    advance(player, duration / 2);
    expect(player.animState).not.toBe('Tackle');
  });

  it('celebration is bounded by ANIM.CELEBRATION_DURATION_MS and reset kills it', () => {
    const { scene } = makeMockScene();
    const bounded = new Player(scene, 100, 100);
    bounded.startCelebration();
    expect(bounded.animState).toBe('Celebrate');
    advance(bounded, BALANCE_CONFIG.ANIM.CELEBRATION_DURATION_MS + 1);
    expect(bounded.animState).not.toBe('Celebrate');

    const reset = new Player(scene, 100, 100);
    reset.startCelebration();
    reset.resetAnimation();
    expect(['Idle', 'Run']).toContain(reset.animState);
    reset.updateAnimation(16);
    expect(reset.animState).not.toBe('Celebrate');
  });

  it.each([
    { clip: 'dive' as const, state: 'Dive', duration: () => BALANCE_CONFIG.GK.DIVE_DURATION_MS },
    { clip: 'claim' as const, state: 'Claim', duration: () => BALANCE_CONFIG.ANIM.GK_CLAIM_DURATION_MS },
    {
      clip: 'distribute' as const,
      state: 'Distribute',
      duration: () => BALANCE_CONFIG.ANIM.GK_DISTRIBUTE_DURATION_MS,
    },
  ])('GK clip $clip is bounded and re-armable while the FSM stays in state', ({ clip, state, duration }) => {
    const { scene } = makeMockScene();
    const player = new Player(scene, 100, 100);
    player.applyGkClip(clip);
    expect(player.animState).toBe(state);

    const d = duration();
    advance(player, d - 10, 1);
    player.applyGkClip(clip); // scene re-arms every frame while the FSM holds
    expect(player.animState).toBe(state);
    advance(player, d + 20, 1);
    expect(['Idle', 'Run']).toContain(player.animState);
  });

  it('no override clip can wedge: every one of them returns to Idle/Run', () => {
    const { scene } = makeMockScene();
    const player = new Player(scene, 100, 100);
    const durations = [
      ['tackle', BALANCE_CONFIG.ANIM.TACKLE_DURATION_MS],
      ['celebration', BALANCE_CONFIG.ANIM.CELEBRATION_DURATION_MS],
      ['gk dive', BALANCE_CONFIG.GK.DIVE_DURATION_MS],
      ['gk claim', BALANCE_CONFIG.ANIM.GK_CLAIM_DURATION_MS],
      ['gk distribute', BALANCE_CONFIG.ANIM.GK_DISTRIBUTE_DURATION_MS],
    ] as const;
    for (const [label, duration] of durations) {
      if (label === 'tackle') {
        player.startTackle();
      } else if (label === 'celebration') {
        player.startCelebration();
      } else {
        player.applyGkClip(label.replace('gk ', '') as 'dive' | 'claim' | 'distribute');
      }
      advance(player, duration + 1000, 50);
      expect(['Idle', 'Run'], `${label} must never wedge`).toContain(player.animState);
    }
  });
});

// ---------------------------------------------------------------------------
// E. Human action button: pressure/tackle attempt without the ball.
// ---------------------------------------------------------------------------

describe('Phase 4 Batch B — action button without ball plays the tackle clip', () => {
  const PASS_RADIUS = BALANCE_CONFIG.INPUT.PASS_PICKUP_RADIUS_PX;

  function makeContext(ballDx: number): PassContext {
    return {
      getBallPos: () => ({ x: 100 + ballDx, y: 100 }),
      getTeammates: () => [],
      getOpponents: () => [],
    };
  }

  it('action tap far from the ball starts the tackle (pressure) clip', () => {
    const { scene, keys } = makeMockScene();
    const player = new Player(scene, 100, 100);
    const controller = new HumanInputController();
    controller.attach(scene, player);
    controller.setContext(makeContext(PASS_RADIUS * 4));

    const action = keys.get(74) as MockKey; // J
    action.press('down');
    action.press('up');
    expect(player.animState).toBe('Tackle');
  });

  it('action tap WITH the ball still passes (kick clip, not tackle)', () => {
    const { scene, keys } = makeMockScene();
    const player = new Player(scene, 100, 100);
    player.onShot(vi.fn());
    const controller = new HumanInputController();
    controller.attach(scene, player);
    controller.setContext({
      getBallPos: () => ({ x: 100 + PASS_RADIUS - 10, y: 100 }),
      getTeammates: () => [],
      getOpponents: () => [],
    });

    const action = keys.get(74) as MockKey;
    action.press('down');
    action.press('up');
    expect(player.animState).not.toBe('Tackle');
  });
});

// ---------------------------------------------------------------------------
// F. Celebration selection: scorer + nearest non-GK teammates (pure).
// ---------------------------------------------------------------------------

describe('Phase 4 Batch B — celebration player selection', () => {
  const candidates = [
    { id: 'home-0', x: 0, y: 0, isGk: true },   // GK: never celebrates
    { id: 'home-1', x: 100, y: 0, isGk: false }, // nearest
    { id: 'home-2', x: 200, y: 0, isGk: false }, // scorer (far)
    { id: 'home-3', x: 300, y: 0, isGk: false },
    { id: 'home-4', x: 150, y: 0, isGk: false },
  ];

  it('picks the scorer plus the N nearest non-GK teammates', () => {
    const chosen = pickCelebrationIds(candidates, { x: 0, y: 0 }, 'home-2', 2);
    expect(chosen).toEqual(['home-2', 'home-1', 'home-4']);
  });

  it('own-goal (toucher not on the scoring side) falls back to nearest players', () => {
    const chosen = pickCelebrationIds(candidates, { x: 0, y: 0 }, 'away-7', 2);
    expect(chosen).toEqual(['home-1', 'home-4']);
  });

  it('tie on distance breaks deterministically by id', () => {
    const tied = [
      { id: 'home-b', x: 10, y: 0, isGk: false },
      { id: 'home-a', x: 10, y: 0, isGk: false },
    ];
    expect(pickCelebrationIds(tied, { x: 0, y: 0 }, null, 1)).toEqual(['home-a']);
  });
});
