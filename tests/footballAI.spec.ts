import { describe, it, expect } from 'vitest';
import { FootballAI } from '../src/ai/FootballAI';
import { mulberry32 } from '../src/utils/rng';
import { BALANCE_CONFIG } from '../src/data/balance';
import type { EntitySnapshot, BallSnapshot, MatchContext } from '../src/ai/commands';

const PITCH_W = BALANCE_CONFIG.PHYSICS.PITCH_WIDTH;
const PITCH_H = BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT;

function dfSnap(x = 336, y = 270): EntitySnapshot {
  return { id: 'home-1', team: 'home', role: 'DF', x, y, vx: 0, vy: 0 };
}

function ball(x: number, y: number, z = 0, vx = 0, vy = 0): BallSnapshot {
  return { x, y, z, vx, vy };
}

function ctx(overrides: Partial<MatchContext> = {}): MatchContext {
  return {
    ball: ball(100, 100),
    possessorId: null,
    myTeamPossession: false,
    anchorX: 336,
    anchorY: 270,
    pressers: [],
    attackDir: 1,
    ...overrides,
  };
}

describe('FootballAI — per-player FSM', () => {
  it('BALL_HOLDER transition: possessor assigned → state becomes BALL_HOLDER', () => {
    const ai = new FootballAI(mulberry32(42));
    ai.state = 'DEFENDING';

    const c = ctx({ possessorId: 'home-1', myTeamPossession: true });
    ai.tick(dfSnap(), c);

    expect(ai.state).toBe('BALL_HOLDER');
  });

  it('team possession without personal possession → ATTACKING and seeks anchor', () => {
    const ai = new FootballAI(mulberry32(42));
    ai.state = 'DEFENDING';

    const c = ctx({ possessorId: 'home-2', myTeamPossession: true });
    const cmd = ai.tick(dfSnap(), c);

    expect(ai.state).toBe('ATTACKING');
    expect(cmd.action).toBe('MOVE');
    // Anchor-seek: command target at the formation anchor
    expect(cmd.targetX).toBe(336);
    expect(cmd.targetY).toBe(270);
  });

  it('defending presser chases the ball', () => {
    const ai = new FootballAI(mulberry32(42));
    ai.state = 'DEFENDING';

    const c = ctx({ pressers: ['home-1'] });
    const cmd = ai.tick(dfSnap(), c);

    expect(ai.state).toBe('DEFENDING');
    expect(cmd.action).toBe('PRESS');
    expect(cmd.targetX).toBe(100);
    expect(cmd.targetY).toBe(100);
  });

  it('defending non-presser holds formation anchor (Fase 2 gate core)', () => {
    const ai = new FootballAI(mulberry32(42));
    ai.state = 'DEFENDING';

    const c = ctx({ pressers: ['home-2'] });
    const cmd = ai.tick(dfSnap(), c);

    expect(cmd.action).toBe('MOVE');
    expect(cmd.targetX).toBe(336);
    expect(cmd.targetY).toBe(270);
  });

  it('ball holder advances toward the attacking goal and shoots within range', () => {
    const ai = new FootballAI(mulberry32(42));
    ai.state = 'BALL_HOLDER';

    // Holder near the right goal (home attacks right): goal at (PITCH_W - 60, 270)
    const nearGoal = dfSnap(PITCH_W - 60 - 50, 270);
    const c = ctx({ possessorId: 'home-1', myTeamPossession: true, ball: ball(PITCH_W - 110, 270) });
    const cmd = ai.tick(nearGoal, c);

    expect(cmd.action).toBe('SHOOT');
    expect(cmd.power).toBeGreaterThan(0);
    expect(cmd.power).toBeLessThanOrEqual(1);
    // Shot aimed at the goal
    expect(cmd.targetX).toBe(PITCH_W - 60);
    expect(cmd.targetY).toBe(270);
  });

  it('ball holder far from goal dribbles forward (MOVE toward goal)', () => {
    const ai = new FootballAI(mulberry32(42));
    ai.state = 'BALL_HOLDER';

    const mid = dfSnap(400, 270);
    const c = ctx({ possessorId: 'home-1', myTeamPossession: true });
    const cmd = ai.tick(mid, c);

    expect(cmd.action).toBe('MOVE');
    expect(cmd.targetX).toBeGreaterThan(400);
  });

  it('applyLocomotion returns velocity toward command target at max speed', () => {
    const ai = new FootballAI(mulberry32(42));
    const snap = dfSnap(400, 270);
    const cmd = { targetX: 100, targetY: 270, action: 'MOVE' as const };

    const v = ai.applyLocomotion(cmd, snap);

    expect(v.vx).toBeLessThan(0);
    expect(v.vy).toBe(0);
    const speed = Math.hypot(v.vx, v.vy);
    expect(speed).toBeCloseTo(BALANCE_CONFIG.PHYSICS.PLAYER_MAX_SPEED, 6);
  });

  it('deterministic: same seed and inputs produce identical command', () => {
    const a = new FootballAI(mulberry32(42));
    const b = new FootballAI(mulberry32(42));
    const c = ctx({ possessorId: 'home-1', myTeamPossession: true, ball: ball(PITCH_W - 110, 270) });

    const cmdA = a.tick(dfSnap(PITCH_W - 110, 270), c);
    const cmdB = b.tick(dfSnap(PITCH_W - 110, 270), c);

    expect(cmdA).toEqual(cmdB);
  });
});
