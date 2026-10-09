import { describe, it, expect } from 'vitest';
import { PossessionSystem } from '../src/match/PossessionSystem';
import { BALANCE_CONFIG } from '../src/data/balance';
import type { EntitySnapshot, BallSnapshot } from '../src/ai/commands';

function snap(id: string, x: number, y: number): EntitySnapshot {
  return { id, team: 'home', role: 'FW', x, y, vx: 0, vy: 0 };
}

function ballAt(x: number, y: number, z = 0, vx = 0, vy = 0): BallSnapshot {
  return { x, y, z, vx, vy };
}

const CAPTURE = BALANCE_CONFIG.AI.CAPTURE_RADIUS_PX;

describe('PossessionSystem', () => {
  it('captures on ground: z < possessableZ within capture radius', () => {
    const sys = new PossessionSystem();
    const players = [snap('p1', 100, 100), snap('p2', 400, 400)];

    const result = sys.update(16, players, ballAt(100 + CAPTURE - 1, 100, 0));

    expect(result).toBe('p1');
    expect(sys.possessorId).toBe('p1');
  });

  it('high ball not capturable: z > possessableZ', () => {
    const sys = new PossessionSystem();
    const players = [snap('p1', 100, 100)];
    const zHigh = BALANCE_CONFIG.AI.POSSESSABLE_Z + 1;

    const result = sys.update(16, players, ballAt(100, 100, zHigh));

    expect(result).toBeNull();
    expect(sys.possessorId).toBeNull();
  });

  it('no capture when no player within capture radius', () => {
    const sys = new PossessionSystem();
    const players = [snap('p1', 100, 100)];

    const result = sys.update(16, players, ballAt(100 + CAPTURE + 5, 100, 0));

    expect(result).toBeNull();
  });

  it('possession lost when ball leaves control radius', () => {
    const sys = new PossessionSystem();
    const players = [snap('p1', 100, 100)];

    sys.update(16, players, ballAt(100, 100, 0));
    expect(sys.possessorId).toBe('p1');

    // Ball drifts beyond CONTROL_RADIUS_PX from the holder
    const far = BALANCE_CONFIG.AI.CONTROL_RADIUS_PX + 5;
    const result = sys.update(16, players, ballAt(100 + far, 100, 0));

    expect(result).toBeNull();
    expect(sys.possessorId).toBeNull();
  });

  it('possession lost when possessor kicks (onKick clears)', () => {
    const sys = new PossessionSystem();
    const players = [snap('p1', 100, 100)];

    sys.update(16, players, ballAt(100, 100, 0));
    expect(sys.possessorId).toBe('p1');

    sys.onKick();

    expect(sys.possessorId).toBeNull();
    // Kicked ball keeps flying (z rises above possessable) → no immediate recapture
    const result = sys.update(16, players, ballAt(100, 100, BALANCE_CONFIG.AI.POSSESSABLE_Z + 10));
    expect(result).toBeNull();
  });

  it('exactly one possessor: nearest player wins a contested capture', () => {
    const sys = new PossessionSystem();
    const players = [snap('p1', 100 + 3, 100), snap('p2', 100, 100)];

    const result = sys.update(16, players, ballAt(100, 100, 0));

    expect(result).toBe('p2');
    expect(sys.possessorId).toBe('p2');
  });

  it('re-captures after a legal ground capture follows a loss', () => {
    const sys = new PossessionSystem();
    const players = [snap('p1', 100, 100)];

    sys.update(16, players, ballAt(100, 100, 0));
    sys.onKick();
    // Ball lands back within capture radius at ground level
    const result = sys.update(16, players, ballAt(100 + 2, 100, 0));

    expect(result).toBe('p1');
  });
});
