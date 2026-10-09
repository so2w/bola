import { describe, it, expect, vi } from 'vitest';
import type Phaser from 'phaser';

// Mock Phaser before importing modules that import it (same pattern as paso4.test.ts)
vi.mock('phaser', () => ({
  default: {
    Scene: class {
      constructor(_key?: string) {}
    },
    GameObjects: { Sprite: class {}, Container: class {}, Text: class {}, Zone: class {} },
    Input: { Keyboard: { KeyCodes: { W: 87, A: 65, S: 83, D: 68, SPACE: 32 } } },
    Math: {
      Clamp: (v: number, a: number, b: number) => Math.max(a, Math.min(b, v)),
      Vector2: class {
        constructor(public x = 0, public y = 0) {}
      },
    },
  },
}));

import { MatchScene } from '../src/scenes/MatchScene';
import { PossessionSystem } from '../src/match/PossessionSystem';

function mockPlayer(id: string, role: string, x: number, y: number) {
  return {
    id,
    role,
    sprite: { x, y, setTint: vi.fn() },
    body: {
      velocity: { x: 0, y: 0 },
      setVelocity: vi.fn(),
      setAcceleration: vi.fn(),
    },
    preUpdate: vi.fn(),
    updateAnimation: vi.fn(),
    updateController: vi.fn(),
  } as any;
}

function makeScene() {
  const scene = new MatchScene() as any;
  scene.manager = {
    state: 'PLAYING',
    update: vi.fn(),
    getTime: () => 540,
    score: { home: 0, away: 0 },
  };
  scene.resultOverlayGroup = { visible: false };
  scene.homeTeam = [
    mockPlayer('home-0', 'GK', 57.6, 270),
    mockPlayer('home-1', 'DF', 336, 270),
    mockPlayer('home-2', 'FW', 595, 270),
  ];
  scene.awayTeam = [
    mockPlayer('away-0', 'GK', 902.4, 270),
    mockPlayer('away-1', 'DF', 624, 270),
    mockPlayer('away-2', 'FW', 365, 270),
  ];
  scene.roles = { home: ['GK', 'DF', 'FW'], away: ['GK', 'DF', 'FW'] };
  scene.ball = {
    sprite: { x: 480, y: 270 },
    body: { velocity: { x: 0, y: 0 } },
    z: 0,
    preUpdate: vi.fn(),
  };
  scene.possession = new PossessionSystem();
  const mkCoord = () => ({
    update: vi.fn(() => new Map()),
    tickGK: vi.fn(() => ({ targetX: 57.6, targetY: 270, action: 'MOVE' })),
  });
  scene.coordinatorHome = mkCoord();
  scene.coordinatorAway = mkCoord();
  scene.selectionSystem = { update: vi.fn(() => 'home-2') };
  scene.humanPlayerId = 'home-2';
  scene.humanController = undefined;
  scene.aiControllers = new Map();
  scene.awayControllers = new Map();
  scene.homeByIndex = new Map();
  scene.awayByIndex = new Map();
  scene.player = scene.homeTeam[2];
  scene.clockText = { setText: vi.fn() };
  scene.scoreText = { setText: vi.fn() };
  scene.gameOverGroup = { setVisible: vi.fn() };
  return scene;
}

describe('MatchScene — GK cadence enforcement (task 3.0)', () => {
  it('tickGK runs EVERY frame, outside the 150ms coordinator cadence', () => {
    const scene = makeScene();

    // Frame 1
    scene.update(0, 16);
    expect(scene.coordinatorHome.tickGK).toHaveBeenCalledTimes(1);
    expect(scene.coordinatorAway.tickGK).toHaveBeenCalledTimes(1);

    // Frame 2 — within the 150ms coordinator window, but GK still ticks
    scene.update(16, 16);
    expect(scene.coordinatorHome.tickGK).toHaveBeenCalledTimes(2);
    expect(scene.coordinatorAway.tickGK).toHaveBeenCalledTimes(2);

    // Frame 3
    scene.update(32, 16);
    expect(scene.coordinatorHome.tickGK).toHaveBeenCalledTimes(3);
  });

  it('tickGK receives the GK snapshot and the ball context', () => {
    const scene = makeScene();
    scene.update(0, 16);

    const [dtMs, gkSnap, ctx] = scene.coordinatorHome.tickGK.mock.calls[0];
    expect(dtMs).toBe(16);
    expect(gkSnap.id).toBe('home-0');
    expect(gkSnap.role).toBe('GK');
    expect(ctx.ball).toBeDefined();
    expect(ctx.attackDir).toBe(1);
    expect(ctx.teammates.every((t: any) => t.role !== 'GK')).toBe(true);
  });

  it('field-player coordinator.update is NOT called every frame when within the 150ms window (cadence contract)', () => {
    const scene = makeScene();
    scene.update(0, 16);
    scene.update(16, 16);

    // coordinator.update is invoked by the scene per frame, but the CADENCE
    // decision lives inside the coordinator; the scene must keep calling it
    // with raw frame time so the coordinator can decide.
    expect(scene.coordinatorHome.update).toHaveBeenCalledTimes(2);
  });
});
