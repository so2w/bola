import { describe, it, expect } from 'vitest';
import { TeamCoordinator } from '../src/ai/TeamCoordinator';
import { FootballAI } from '../src/ai/FootballAI';
import { PossessionSystem } from '../src/match/PossessionSystem';
import { FORMATIONS, anchorCoords } from '../src/data/formations';
import { mulberry32 } from '../src/utils/rng';
import { BALANCE_CONFIG } from '../src/data/balance';
import type { BallSnapshot, EntitySnapshot, MatchContext } from '../src/ai/commands';

// Batch C-E: 1-2 teammates visibly help without breaking shape.
// TDD RED: lane-offer / excluded-press / forced-lane-pass do not exist yet.
const AI = BALANCE_CONFIG.AI;
const PITCH_W = BALANCE_CONFIG.PHYSICS.PITCH_WIDTH;
const PITCH_H = BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT;

function teamSnapshots(formationId: '3v3' | '5v5', side: 'home' | 'away'): EntitySnapshot[] {
  return anchorCoords(FORMATIONS[formationId], side, PITCH_W, PITCH_H).map((a, i) => ({
    id: `${side}-${i}`,
    team: side,
    role: a.role,
    x: a.x,
    y: a.y,
    vx: 0,
    vy: 0,
  }));
}

function ballAt(x: number, y: number): BallSnapshot {
  return { x, y, z: 0, vx: 0, vy: 0 };
}

function holderCtx(over: Partial<MatchContext> = {}): MatchContext {
  return {
    ball: ballAt(400, 270),
    possessorId: 'away-1',
    myTeamPossession: false,
    anchorX: 400,
    anchorY: 270,
    pressers: [],
    attackDir: -1,
    nowMs: 1000,
    opponents: [],
    teammates: [],
    ...over,
  };
}

describe('teammate help — config knobs for every frequency/distance', () => {
  it('exposes lane-offer + holder-lane tuning through BALANCE_CONFIG.AI', () => {
    const rec = AI as unknown as Record<string, unknown>;
    for (const k of [
      'AI_LANE_OFFER_EXTRA_PUSH_PX',
      'AI_LANE_OPEN_RADIUS_PX',
      'AI_HOLDER_LANE_RANGE_PX',
      'AI_HOLDER_LANE_CORRIDOR_PX',
    ]) {
      expect(typeof rec[k], `AI.${k}`).toBe('number');
      expect((rec[k] as number) > 0, `AI.${k} positive`).toBe(true);
    }
  });
});

describe('teammate help — loose-ball chase is never wasted on the human', () => {
  it('excluded (human-controlled) nearest never takes the press slot; another teammate chases', () => {
    const coord = new TeamCoordinator('home', FORMATIONS['3v3'], mulberry32(11));
    const snaps = teamSnapshots('3v3', 'home');
    // Loose ball glued to home-1: without exclusion home-1 must press it.
    const near = snaps.find((s) => s.id === 'home-1') as EntitySnapshot;
    const ball = ballAt(near.x + 30, near.y);
    const possession = new PossessionSystem();
    const plain = coord.update(0, snaps, ball, possession);
    expect(plain.get('home-1')?.action).toBe('PRESS');

    // Same tick data, human holds home-1: the slot moves to a teammate.
    const coord2 = new TeamCoordinator('home', FORMATIONS['3v3'], mulberry32(11));
    const pressed = coord2.update(0, snaps, ball, new PossessionSystem(), undefined, new Set(['home-1']));
    expect(pressed.get('home-1')?.action).not.toBe('PRESS');
    const chasers = [...pressed.entries()].filter(([, c]) => c.action === 'PRESS');
    expect(chasers.length).toBeGreaterThan(0);
    expect(chasers.length).toBeLessThanOrEqual(AI.PRESS_COUNT_MAX);
    expect(chasers.every(([id]) => id !== 'home-1')).toBe(true);
    expect(chasers[0][1].targetX).toBe(ball.x);
    expect(chasers[0][1].targetY).toBe(ball.y);
  });
});

describe('teammate help — closest open teammate offers a visible lane', () => {
  it('lane-offer target pushes visibly further off the anchor than the base support', () => {
    const me = { id: 'home-2', team: 'home', role: 'MF', x: 336, y: 270, vx: 0, vy: 0 } as EntitySnapshot;
    const holder = { id: 'home-1', team: 'home', role: 'FW', x: 400, y: 270, vx: 0, vy: 0 } as EntitySnapshot;
    const base = { ...holderCtx(), possessorId: 'home-1', myTeamPossession: true, teammates: [holder, me], anchorX: 336, anchorY: 270 };
    const aiBase = new FootballAI(mulberry32(3));
    const baseCmd = aiBase.tick(me, base);
    const baseDev = Math.hypot(baseCmd.targetX - 336, baseCmd.targetY - 270);

    const aiOffer = new FootballAI(mulberry32(3));
    const offerCmd = aiOffer.tick(me, { ...base, laneOfferId: 'home-2' });
    const offerDev = Math.hypot(offerCmd.targetX - 336, offerCmd.targetY - 270);
    expect(offerDev).toBeGreaterThan(baseDev);
    const maxShift = (AI as unknown as { AI_SUPPORT_MAX_SHIFT_PX: number }).AI_SUPPORT_MAX_SHIFT_PX;
    expect(offerDev).toBeLessThanOrEqual(maxShift + 1e-6);
  });
});

describe('teammate help — holder passes when the lane is clearly best', () => {
  it('forced lane target converts a hold into a PASS even with tendency 0', () => {
    const ai = new FootballAI(mulberry32(9), { ...BALANCE_CONFIG.AI, AI_PASS_TENDENCY: 0 });
    const holder: EntitySnapshot = { id: 'away-1', team: 'away', role: 'MF', x: 600, y: 270, vx: 0, vy: 0 };
    const cmd = ai.tick(
      holder,
      holderCtx({
        teammates: [holder],
        forcedPassTarget: { x: 480, y: 270 },
      }),
    );
    expect(cmd.action).toBe('PASS');
    expect(cmd.power).toBeCloseTo(BALANCE_CONFIG.INPUT.PASS_POWER_PCT, 6);
    const err = BALANCE_CONFIG.AI.AI_PASS_ERROR_PX;
    expect(Math.hypot(cmd.targetX - 480, cmd.targetY - 270)).toBeLessThanOrEqual(err * Math.SQRT2 + 1e-6);
  });

  it('open lane + holding holder: coordinator forces the pass within one tick', () => {
    // rng always holds (1 >= 0.65): only the forced-lane path can produce PASS.
    const coord = new TeamCoordinator('away', FORMATIONS['5v5'], () => 1);
    const snaps = teamSnapshots('5v5', 'away').map((s) => ({ ...s }));
    const holder = snaps.find((s) => s.team === 'away' && s.role !== 'GK') as EntitySnapshot;
    holder.x = 600;
    holder.y = 270;
    const mate = snaps.filter((s) => s.id !== holder.id && s.role !== 'GK')[0];
    mate.x = 480;
    mate.y = 270;
    const commands = coord.update(0, snaps, ballAt(holder.x, holder.y), new PossessionSystem(), []);
    expect(commands.get(holder.id)?.action).toBe('PASS');
  });

  it('press discipline survives the help: still at most PRESS_COUNT_MAX pressers', () => {
    const coord = new TeamCoordinator('home', FORMATIONS['5v5'], mulberry32(42));
    const snaps = teamSnapshots('5v5', 'home');
    let maxPressers = 0;
    let nowMs = 0;
    for (let frame = 0; frame < Math.ceil(2000 / 16); frame++) {
      nowMs += 16;
      const commands = coord.update(nowMs, snaps, ballAt(100, 100), new PossessionSystem(), [], new Set(['home-0']));
      let pressers = 0;
      for (const [, c] of commands) {
        if (c.action === 'PRESS') pressers++;
      }
      maxPressers = Math.max(maxPressers, pressers);
    }
    expect(maxPressers).toBeLessThanOrEqual(AI.PRESS_COUNT_MAX);
  });
});
