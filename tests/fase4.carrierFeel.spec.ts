import { describe, it, expect } from 'vitest';
import {
  wobbleOffsetDeg,
  countPressure,
  laneIsClear,
  dribbleSpeedFactor,
  curvedGoalTarget,
} from '../src/ai/dribbleFeel';
import { FootballAI } from '../src/ai/FootballAI';
import { AIController } from '../src/input/AIController';
import { mulberry32 } from '../src/utils/rng';
import { BALANCE_CONFIG } from '../src/data/balance';
import type { EntitySnapshot, BallSnapshot, MatchContext } from '../src/ai/commands';

// ---------------------------------------------------------------------------
// Fase 4 carrier feel polish (W1 follow-up): the AI ball carrier ran perfect
// straight lines because tickHolder emitted a fixed goal target and
// AIController sought it directly. These knobs add, config-driven:
//   1. deterministic heading wobble (pure function of time + entity phase),
//   2. pressure-based speed modulation + open-lane boost (tick data only),
//   3. curved approach: goal target rotated away from the nearest defender.
// ---------------------------------------------------------------------------

const CFG = BALANCE_CONFIG.AI;
const PITCH_W = BALANCE_CONFIG.PHYSICS.PITCH_WIDTH;
const PITCH_H = BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT;
const GOAL = { x: PITCH_W - 60, y: PITCH_H / 2 };

function opp(id: string, x: number, y: number): EntitySnapshot {
  return { id, team: 'away', role: 'DF', x, y, vx: 0, vy: 0 };
}

// ===========================================================================
// 1. Heading wobble — smooth, bounded, deterministic
// ===========================================================================
describe('carrier feel / wobble (pure)', () => {
  it('never exceeds the amplitude bound and changes smoothly frame to frame', () => {
    const amp = CFG.DRIBBLE_WOBBLE_AMPLITUDE_DEG;
    let prev = wobbleOffsetDeg(0, 0.7, CFG);
    for (let t = 16; t <= 5000; t += 16) {
      const a = wobbleOffsetDeg(t, 0.7, CFG);
      expect(Math.abs(a)).toBeLessThanOrEqual(amp + 1e-9);
      // Smooth: per-16ms delta is tiny relative to amplitude (no snapping).
      expect(Math.abs(a - prev)).toBeLessThan(amp * 0.25);
      prev = a;
    }
  });

  it('is deterministic: same elapsedMs + phase → same angle', () => {
    expect(wobbleOffsetDeg(1234, 2.4, CFG)).toBe(wobbleOffsetDeg(1234, 2.4, CFG));
  });

  it('different entity phases decorrelate the oscillation', () => {
    const a = wobbleOffsetDeg(500, 0, CFG);
    const b = wobbleOffsetDeg(500, Math.PI, CFG);
    expect(a).not.toBeCloseTo(b, 6);
  });
});

// ===========================================================================
// 2. Pressure speed modulation — tick-data metric, corridor-aware boost
// ===========================================================================
describe('carrier feel / pressure + lane (pure)', () => {
  it('zero defenders near → speed multiplier is the open-lane boost (lane clear)', () => {
    const count = countPressure(400, 270, [], CFG.DRIBBLE_PRESSURE_SLOW_PX);
    expect(count).toBe(0);
    expect(laneIsClear(400, 270, 1, 0, [], CFG.DRIBBLE_CORRIDOR_HALF_WIDTH_PX)).toBe(true);
    const f = dribbleSpeedFactor(count, true, CFG);
    expect(f).toBeCloseTo(CFG.DRIBBLE_OPEN_LANE_BOOST, 6);
  });

  it('3 defenders inside the radius with a blocked lane → SLOW_FACTOR', () => {
    const opps = [
      opp('a', 450, 270), // dead ahead (blocks corridor)
      opp('b', 430, 300),
      opp('c', 430, 240),
    ];
    const count = countPressure(400, 270, opps, CFG.DRIBBLE_PRESSURE_SLOW_PX);
    expect(count).toBe(3);
    expect(laneIsClear(400, 270, 1, 0, opps, CFG.DRIBBLE_CORRIDOR_HALF_WIDTH_PX)).toBe(false);
    const f = dribbleSpeedFactor(count, false, CFG);
    expect(f).toBeCloseTo(CFG.DRIBBLE_PRESSURE_SLOW_FACTOR, 6);
  });

  it('corridor: defender ahead but outside the half-width does NOT block the lane', () => {
    // 100px ahead, 80px to the side — outside the corridor half-width.
    const opps = [opp('a', 500, 270 + CFG.DRIBBLE_CORRIDOR_HALF_WIDTH_PX + 40)];
    expect(laneIsClear(400, 270, 1, 0, opps, CFG.DRIBBLE_CORRIDOR_HALF_WIDTH_PX)).toBe(true);
  });

  it('corridor follows the facing: a defender beside the run line blocks it when behind-facing flips', () => {
    // Facing left (-1, 0): the defender at x=350 is now AHEAD inside the corridor.
    const opps = [opp('a', 350, 270)];
    expect(laneIsClear(400, 270, -1, 0, opps, CFG.DRIBBLE_CORRIDOR_HALF_WIDTH_PX)).toBe(false);
    // Facing right (+1, 0): the same defender is behind — lane clear.
    expect(laneIsClear(400, 270, 1, 0, opps, CFG.DRIBBLE_CORRIDOR_HALF_WIDTH_PX)).toBe(true);
  });

  it('a defender outside the pressure radius does not slow the carrier', () => {
    const opps = [opp('a', 400 + CFG.DRIBBLE_PRESSURE_SLOW_PX + 50, 270)];
    expect(countPressure(400, 270, opps, CFG.DRIBBLE_PRESSURE_SLOW_PX)).toBe(0);
  });
});

// ===========================================================================
// 3. Curved approach — target rotated away from the nearest defender
// ===========================================================================
describe('carrier feel / curved approach (pure)', () => {
  it('free run (no defenders) → target is exactly the goal (curve 0)', () => {
    const t = curvedGoalTarget(400, 270, GOAL.x, GOAL.y, [], CFG);
    expect(t.x).toBeCloseTo(GOAL.x, 6);
    expect(t.y).toBeCloseTo(GOAL.y, 6);
  });

  it('defender ahead-above the run line → target rotated down (away), bounded by MAX_DEG', () => {
    const opps = [opp('a', 500, 270 - 100)]; // ahead-left of a +x run
    const t = curvedGoalTarget(400, 270, GOAL.x, GOAL.y, opps, CFG);
    // Rotated perpendicular-ish: pulls the Y target away from the defender.
    expect(t.y).toBeGreaterThan(GOAL.y + 1);
    // Angle from the carrier between (goal - pos) and (target - pos) <= MAX_DEG.
    const ang =
      (Math.atan2(t.y - 270, t.x - 400) - Math.atan2(GOAL.y - 270, GOAL.x - 400)) * (180 / Math.PI);
    expect(Math.abs(ang)).toBeLessThanOrEqual(CFG.DRIBBLE_CURVE_MAX_DEG + 1e-9);
    expect(Math.abs(ang)).toBeGreaterThan(0);
  });

  it('closer defender → larger curve angle (monotonic up to the cap)', () => {
    const angleFor = (dx: number): number => {
      const t = curvedGoalTarget(400, 270, GOAL.x, GOAL.y, [opp('a', 400 + dx, 190)], CFG);
      return Math.abs(
        (Math.atan2(t.y - 270, t.x - 400) - Math.atan2(GOAL.y - 270, GOAL.x - 400)) * (180 / Math.PI),
      );
    };
    expect(angleFor(60)).toBeGreaterThan(angleFor(140));
  });
});

// ===========================================================================
// 4. Integration — FootballAI emits dribble metadata, AIController applies it
// ===========================================================================
describe('carrier feel / FootballAI + AIController integration', () => {
  function holderCtx(opponents: EntitySnapshot[], nowMs: number): MatchContext {
    const ball: BallSnapshot = { x: 400, y: 270, z: 0, vx: 0, vy: 0 };
    return {
      ball,
      possessorId: 'home-1',
      myTeamPossession: true,
      anchorX: 400,
      anchorY: 270,
      pressers: [],
      attackDir: 1,
      nowMs,
      opponents,
    };
  }

  const holderSnap: EntitySnapshot = {
    id: 'home-1', team: 'home', role: 'FW', x: 400, y: 270, vx: 0, vy: 0,
  };

  it('holder tick emits a dribble MOVE command with a speedFactor', () => {
    const ai = new FootballAI(mulberry32(7));
    const cmd = ai.tick(holderSnap, holderCtx([], 1000));
    expect(cmd.action).toBe('MOVE');
    expect(cmd.dribble).toBe(true);
    expect(cmd.speedFactor).toBeGreaterThan(0);
    // No defenders, lane clear → boost.
    expect(cmd.speedFactor).toBeCloseTo(CFG.DRIBBLE_OPEN_LANE_BOOST, 6);
  });

  it('wobble bends the carrier path without exceeding the amplitude bound', () => {
    const ctrl = new AIController(undefined, BALANCE_CONFIG.AI, 0.7);
    const cmd = { targetX: GOAL.x, targetY: GOAL.y, action: 'MOVE' as const, dribble: true, speedFactor: 1 };
    let prevAngle: number | null = null;
    for (let t = 0; t <= 2000; t += 16) {
      const v = ctrl.computeMovement({ x: 400, y: 270 }, cmd, 16);
      const base = Math.atan2(0, GOAL.x - 400); // straight line: 0 rad
      const ang = Math.atan2(v.vy, v.vx) - base;
      const deg = Math.abs(ang * (180 / Math.PI));
      expect(deg).toBeLessThanOrEqual(CFG.DRIBBLE_WOBBLE_AMPLITUDE_DEG + 1e-9);
      if (prevAngle !== null) {
        expect(Math.abs(ang - prevAngle)).toBeLessThan(0.05); // smooth, no snapping
      }
      prevAngle = ang;
    }
  });

  it('non-dribble MOVE is untouched (no wobble, no factor)', () => {
    const ctrl = new AIController(undefined, BALANCE_CONFIG.AI, 0.7);
    const cmd = { targetX: GOAL.x, targetY: GOAL.y, action: 'MOVE' as const };
    const v = ctrl.computeMovement({ x: 400, y: 270 }, cmd, 16);
    expect(v.vy).toBe(0); // dead straight toward the goal
    expect(Math.hypot(v.vx, v.vy)).toBeCloseTo(BALANCE_CONFIG.PHYSICS.PLAYER_MAX_SPEED, 6);
  });

  it('2s dribble sim: defended lane yields larger lateral displacement than a free lane', () => {
    const runSim = (withDefender: boolean): number => {
      const ai = new FootballAI(mulberry32(11));
      const ctrl = new AIController(undefined, BALANCE_CONFIG.AI, 0);
      const pos = { x: 300, y: 270 };
      let cmd = ai.tick({ ...holderSnap, x: pos.x, y: pos.y }, holderCtx([], 0));
      const DT = 1000 / 60;
      for (let t = 0; t <= 2000; t += DT) {
        if (withDefender) {
          // Defender shadows the run: always ahead-left of the carrier.
          const def = opp('away-1', pos.x + 110, pos.y - 70);
          cmd = ai.tick(
            { ...holderSnap, x: pos.x, y: pos.y, vx: 0, vy: 0 },
            holderCtx([def], t),
          );
        } else {
          cmd = ai.tick({ ...holderSnap, x: pos.x, y: pos.y, vx: 0, vy: 0 }, holderCtx([], t));
        }
        const v = ctrl.computeMovement(pos, cmd, DT);
        pos.x += (v.vx * DT) / 1000;
        pos.y += (v.vy * DT) / 1000;
      }
      return Math.abs(pos.y - 270);
    };

    const free = runSim(false);
    const defended = runSim(true);
    // The curved approach bends persistently to one side; the wobble alone is
    // a symmetric oscillation around the lane, so defended must dominate.
    expect(defended).toBeGreaterThan(free + 10);
  });
});
