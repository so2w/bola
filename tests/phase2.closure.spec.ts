import { describe, it, expect } from 'vitest';
import { FootballAI } from '../src/ai/FootballAI';
import { PlayerSelectionSystem } from '../src/match/PlayerSelectionSystem';
import { AIController } from '../src/input/AIController';
import { mulberry32 } from '../src/utils/rng';
import { BALANCE_CONFIG } from '../src/data/balance';
import type { EntitySnapshot, BallSnapshot, MatchContext } from '../src/ai/commands';

const AI = BALANCE_CONFIG.AI;
const GK = BALANCE_CONFIG.GK;
const INPUT = BALANCE_CONFIG.INPUT;
const PITCH_W = BALANCE_CONFIG.PHYSICS.PITCH_WIDTH;
const PITCH_H = BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT;

function snap(id: string, x: number, y: number, role: EntitySnapshot['role'] = 'FW'): EntitySnapshot {
  return { id, team: 'home', role, x, y, vx: 0, vy: 0 };
}

function ball(x: number, y: number): BallSnapshot {
  return { x, y, z: 0, vx: 0, vy: 0 };
}

function holderCtx(over: Partial<MatchContext> = {}): MatchContext {
  return {
    ball: ball(400, 270),
    possessorId: 'home-1',
    myTeamPossession: true,
    anchorX: 400,
    anchorY: 270,
    pressers: [],
    attackDir: 1,
    nowMs: 1000,
    opponents: [],
    teammates: [],
    ...over,
  };
}

describe('Phase2 closure A — AI field-player passing', () => {
  it('config exposes AI pass tendency + error knobs', () => {
    expect(typeof (AI as Record<string, unknown>).AI_PASS_TENDENCY).toBe('number');
    expect(typeof (AI as Record<string, unknown>).AI_PASS_ERROR_PX).toBe('number');
    const t = (AI as unknown as { AI_PASS_TENDENCY: number }).AI_PASS_TENDENCY;
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThanOrEqual(1);
  });

  it('holder passes when a teammate is open in the forward cone', () => {
    const ai = new FootballAI(mulberry32(7));
    const holder = snap('home-1', 400, 270);
    // Teammate ahead inside the INPUT cone and range: forward-most wins.
    const mate = snap('home-2', 520, 270);
    const c = holderCtx({ teammates: [holder, mate] });
    // Force tendency to always pass via injected cfg override.
    const aiAlways = new FootballAI(mulberry32(7), { ...BALANCE_CONFIG.AI, AI_PASS_TENDENCY: 1 });
    const cmd = aiAlways.tick(holder, c);
    expect(cmd.action).toBe('PASS');
    expect(cmd.power).toBeCloseTo(INPUT.PASS_POWER_PCT, 6);
    // Target near the teammate (bounded error: per-axis jitter, so hypot <= err*sqrt(2)).
    const err = (BALANCE_CONFIG.AI as unknown as { AI_PASS_ERROR_PX: number }).AI_PASS_ERROR_PX;
    expect(Math.hypot(cmd.targetX - mate.x, cmd.targetY - mate.y)).toBeLessThanOrEqual(err * Math.SQRT2 + 1e-6);
    void ai;
  });

  it('holder dribbles when no teammate is in the cone', () => {
    const ai = new FootballAI(mulberry32(7), { ...BALANCE_CONFIG.AI, AI_PASS_TENDENCY: 1 });
    const holder = snap('home-1', 400, 270);
    // Only a backward teammate: choosePassTarget never targets behind.
    const behind = snap('home-2', 300, 270);
    const c = holderCtx({ teammates: [holder, behind] });
    const cmd = ai.tick(holder, c);
    expect(cmd.action).toBe('MOVE');
    expect(cmd.dribble).toBe(true);
  });

  it('holder still shoots in range even with an open teammate (shoot priority)', () => {
    const ai = new FootballAI(mulberry32(7), { ...BALANCE_CONFIG.AI, AI_PASS_TENDENCY: 1 });
    const nearGoal = snap('home-1', PITCH_W - 60 - 50, 270);
    const mate = snap('home-2', PITCH_W - 60 - 20, 270);
    const c = holderCtx({
      ball: ball(PITCH_W - 110, 270),
      teammates: [nearGoal, mate],
    });
    const cmd = ai.tick(nearGoal, c);
    expect(cmd.action).toBe('SHOOT');
  });

  it('tendency 0 never passes (dribbles instead)', () => {
    const ai = new FootballAI(mulberry32(7), { ...BALANCE_CONFIG.AI, AI_PASS_TENDENCY: 0 });
    const holder = snap('home-1', 400, 270);
    const mate = snap('home-2', 520, 270);
    const c = holderCtx({ teammates: [holder, mate] });
    const cmd = ai.tick(holder, c);
    expect(cmd.action).toBe('MOVE');
  });
});

describe('Phase2 closure B — off-ball attack support shift', () => {
  it('config exposes support distances/weights', () => {
    const rec = AI as unknown as Record<string, unknown>;
    for (const k of ['AI_SUPPORT_PUSH_PX', 'AI_SUPPORT_SPACING_PX', 'AI_SUPPORT_AVOID_RADIUS_PX', 'AI_SUPPORT_MAX_SHIFT_PX']) {
      expect(typeof rec[k]).toBe('number');
    }
  });

  it('attacking teammate shifts forward off the anchor but stays bounded', () => {
    const ai = new FootballAI(mulberry32(3));
    const me = snap('home-2', 336, 270, 'MF');
    const holder = snap('home-1', 400, 270);
    const c = holderCtx({
      possessorId: 'home-1',
      teammates: [holder, me],
      opponents: [{ id: 'away-1', team: 'away', role: 'DF', x: 500, y: 200, vx: 0, vy: 0 }],
      anchorX: 336,
      anchorY: 270,
    });
    const cmd = ai.tick(me, c);
    expect(cmd.action).toBe('MOVE');
    const maxShift = (AI as unknown as { AI_SUPPORT_MAX_SHIFT_PX: number }).AI_SUPPORT_MAX_SHIFT_PX;
    const dev = Math.hypot(cmd.targetX - 336, cmd.targetY - 270);
    expect(dev).toBeGreaterThan(0);
    expect(dev).toBeLessThanOrEqual(maxShift + 1e-6);
    // Forward push for attackDir 1: target is ahead of the anchor.
    expect(cmd.targetX).toBeGreaterThan(336);
  });

  it('defending non-presser shades goal-side of its mark (living movement D)', () => {
    // Living-movement spec change: non-presser DFs no longer freeze on the
    // exact anchor — they blend toward goal-side of the nearest threat
    // inside TRACK_RADIUS_PX (positioning only), bounded by TRACK_MAX_SHIFT
    // plus idle sway. Distant threats leave the line on its spot.
    const ai = new FootballAI(mulberry32(3));
    const me = snap('home-2', 336, 270, 'DF');
    const near: EntitySnapshot = { id: 'away-1', team: 'away', role: 'FW', x: 400, y: 270, vx: 0, vy: 0 };
    const c: MatchContext = {
      ball: ball(100, 100),
      possessorId: null,
      myTeamPossession: false,
      anchorX: 336,
      anchorY: 270,
      pressers: ['home-1'],
      attackDir: 1,
      nowMs: 1000,
      opponents: [near],
      teammates: [snap('home-1', 300, 270, 'DF'), me],
    };
    const cmd = ai.tick(me, c);
    expect(cmd.action).toBe('MOVE');
    // Pulled toward the threat but never past its goal-side point (+ sway).
    expect(cmd.targetX).toBeGreaterThan(336);
    expect(cmd.targetX).toBeLessThanOrEqual(
      400 - AI.AI_TRACK_GOAL_SIDE_PX + AI.AI_IDLE_SWAY_RADIUS_PX + 1e-6,
    );
    const dev = Math.hypot(cmd.targetX - 336, cmd.targetY - 270);
    expect(dev).toBeLessThanOrEqual(AI.AI_TRACK_MAX_SHIFT_PX + AI.AI_IDLE_SWAY_RADIUS_PX + 1e-6);
  });

  it('defending non-presser ignores threats beyond the sense radius (sway only)', () => {
    const ai = new FootballAI(mulberry32(3));
    const me = snap('home-2', 336, 270, 'DF');
    const far: EntitySnapshot = { id: 'away-1', team: 'away', role: 'FW', x: 120, y: 110, vx: 0, vy: 0 };
    const c: MatchContext = {
      ball: ball(100, 100),
      possessorId: null,
      myTeamPossession: false,
      anchorX: 336,
      anchorY: 270,
      pressers: ['home-1'],
      attackDir: 1,
      nowMs: 1000,
      opponents: [far],
      teammates: [snap('home-1', 300, 270, 'DF'), me],
    };
    const cmd = ai.tick(me, c);
    expect(cmd.action).toBe('MOVE');
    const dev = Math.hypot(cmd.targetX - 336, cmd.targetY - 270);
    expect(dev).toBeLessThanOrEqual(AI.AI_IDLE_SWAY_RADIUS_PX + 1e-6);
  });
});

describe('Phase2 closure C — engaged penalty from scene-built candidates', () => {
  it('scene-style candidates carry isEngaged from PRESS commands and the selector honors it', () => {
    // Simulate MatchScene wiring: PRESS command -> isEngaged true.
    const homeCmds = new Map([
      ['home-1', { targetX: 100, targetY: 100, action: 'PRESS' as const }],
      ['home-2', { targetX: 336, targetY: 270, action: 'MOVE' as const }],
    ]);
    const snaps: EntitySnapshot[] = [
      { id: 'home-1', team: 'home', role: 'DF', x: 120, y: 100, vx: 0, vy: 0 },
      { id: 'home-2', team: 'home', role: 'DF', x: 130, y: 110, vx: 0, vy: 0 },
    ];
    const candidates = snaps.map((s) => ({
      id: s.id,
      x: s.x,
      y: s.y,
      role: s.role,
      isEngaged: homeCmds.get(s.id)?.action === 'PRESS',
    }));
    expect(candidates.find((c) => c.id === 'home-1')?.isEngaged).toBe(true);
    expect(candidates.find((c) => c.id === 'home-2')?.isEngaged).toBe(false);

    // Near-tied pair: without the penalty home-1 (closer) wins; with it home-2 wins.
    const sel = new PlayerSelectionSystem(BALANCE_CONFIG.SELECTION.COOLDOWN_MS);
    const picked = sel.update(16, candidates, { x: 100, y: 100 }, { x: 0, y: 0 });
    // home-1 is 20px closer but carries ENGAGED_PENALTY 0.3; W1 distance term
    // spread over DIST_MAX 720: 20px ~= 0.028 — penalty dominates, so home-2 wins.
    expect(picked).toBe('home-2');
  });
});

describe('Phase2 closure D — GK movement profile from config', () => {
  it('config exposes GK max-speed + accel keys distinct from field speed', () => {
    const rec = GK as unknown as Record<string, unknown>;
    expect(typeof rec.GK_MAX_SPEED_PX_S).toBe('number');
    expect(typeof rec.GK_ACCEL_PX_S2).toBe('number');
    const max = rec.GK_MAX_SPEED_PX_S as number;
    expect(max).toBeGreaterThan(0);
    expect(max).not.toBe(BALANCE_CONFIG.PHYSICS.PLAYER_MAX_SPEED);
  });

  it('GK controller caps speed to the GK profile, field controller uses field speed', () => {
    const cmd = { targetX: 500, targetY: 270, action: 'MOVE' as const };
    const gkCtrl = new AIController(undefined, BALANCE_CONFIG.AI, 0, true);
    const fieldCtrl = new AIController(undefined, BALANCE_CONFIG.AI, 0, false);
    const vGk = gkCtrl.computeMovement({ x: 100, y: 270 }, cmd, 16);
    const vField = fieldCtrl.computeMovement({ x: 100, y: 270 }, cmd, 16);
    const gkMax = (GK as unknown as { GK_MAX_SPEED_PX_S: number }).GK_MAX_SPEED_PX_S;
    expect(Math.hypot(vGk.vx, vGk.vy)).toBeLessThanOrEqual(gkMax + 1e-6);
    expect(Math.hypot(vField.vx, vField.vy)).toBeCloseTo(BALANCE_CONFIG.PHYSICS.PLAYER_MAX_SPEED, 1);
    expect(Math.hypot(vGk.vx, vGk.vy)).not.toBeCloseTo(Math.hypot(vField.vx, vField.vy), 1);
  });

  it('GK accel limits per-frame velocity change', () => {
    const gkMax = (GK as unknown as { GK_MAX_SPEED_PX_S: number }).GK_MAX_SPEED_PX_S;
    const accel = (GK as unknown as { GK_ACCEL_PX_S2: number }).GK_ACCEL_PX_S2;
    // Player already moving full GK speed left; command wants full speed right:
    // accel cap allows at most accel*dt change this frame.
    const fakePlayer = {
      maxSpeed: BALANCE_CONFIG.PHYSICS.PLAYER_MAX_SPEED,
      body: { velocity: { x: -gkMax, y: 0 } },
      sprite: { x: 200, y: 270 },
    } as unknown as import('../src/entities/Player').Player;
    const gkCtrl = new AIController(undefined, BALANCE_CONFIG.AI, 0, true);
    gkCtrl.attach({} as never, fakePlayer);
    const cmd = { targetX: 600, targetY: 270, action: 'MOVE' as const };
    const v = gkCtrl.computeMovement({ x: 200, y: 270 }, cmd, 16);
    const dv = Math.hypot(v.vx - -gkMax, v.vy - 0);
    expect(dv).toBeLessThanOrEqual((accel * 16) / 1000 + 1e-6);
  });
});
