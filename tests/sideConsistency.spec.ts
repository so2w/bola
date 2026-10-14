import { describe, expect, it, vi } from 'vitest';
import { anchorCoords, resolveFormation } from '../src/data/formations';
import { FormationSystem } from '../src/match/FormationSystem';
import { TeamCoordinator } from '../src/ai/TeamCoordinator';
import { PossessionSystem } from '../src/match/PossessionSystem';
import { MatchManager, type MatchClockConfig } from '../src/systems/MatchManager';
import { canApplyKick, gateKickCommand, kickHasBall } from '../src/match/kickGate';
import { BALANCE_CONFIG } from '../src/data/balance';
import type { BallSnapshot, EntitySnapshot } from '../src/ai/commands';

// ---------------------------------------------------------------------------
// Playtest remediation (fase 4): side consistency + kick gating.
//
// Ground truth (AGENTS.md + MatchScene overlap wiring):
// - home defends the LEFT goal (x≈0..40) and attacks RIGHT (scores past 920).
// - away defends RIGHT and attacks LEFT.
// The AI chain anchors -> coordinator commands (SHOOT targetX) -> controller
// facing must agree with that on every restart. The playtest "me marcan gol
// automáticamente" was traced to UNGATED kicks (stale commands firing outside
// PLAYING / with the ball nowhere near the kicker), not to an x-axis mirror
// in the anchor chain — these tests lock BOTH properties.
// ---------------------------------------------------------------------------

const W = BALANCE_CONFIG.PHYSICS.PITCH_WIDTH; // 960
const H = BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT; // 540

describe('side consistency — formation anchors', () => {
  it.each(['3v3', '5v5', '11v11'] as const)('%s: home GK defends left (x < 200), away GK defends right (x > 760)', (id) => {
    const home = FormationSystem.anchors(id, 'home');
    const away = FormationSystem.anchors(id, 'away');
    const homeGk = home.find((a) => a.role === 'GK');
    const awayGk = away.find((a) => a.role === 'GK');
    expect(homeGk).toBeDefined();
    expect(awayGk).toBeDefined();
    expect(homeGk!.x).toBeLessThan(200);
    expect(awayGk!.x).toBeGreaterThan(760);
  });

  it('MatchScene spawn conversion and MatchManager reset conversion are the SAME function outputs', () => {
    // MatchScene.create uses anchorCoords(resolveFormation(...)); MatchManager
    // resetPositions uses FormationSystem.anchors(...). Both must agree.
    for (const id of ['3v3', '11v11'] as const) {
      for (const side of ['home', 'away'] as const) {
        const spawn = anchorCoords(resolveFormation(id), side, W, H);
        const reset = FormationSystem.anchors(id, side, W, H);
        expect(reset.map((a) => [a.x, a.y])).toEqual(spawn.map((a) => [a.x, a.y]));
      }
    }
  });
});

function snapAt(id: string, team: 'home' | 'away', x: number, y: number, role: EntitySnapshot['role'] = 'FW'): EntitySnapshot {
  return { id, team, role, x, y, vx: 0, vy: 0 };
}

function ballAt(x: number, y: number): BallSnapshot {
  return { x, y, z: 0, vx: 0, vy: 0 };
}

describe('side consistency — coordinator attack direction', () => {
  it('home ball holder SHOOT command targets the RIGHT goal (targetX > 480)', () => {
    const coordinator = new TeamCoordinator('home', resolveFormation('3v3'));
    const possession = new PossessionSystem();
    // Holder next to the ball, inside shooting range of the right goal.
    const snaps = [
      snapAt('home-0', 'home', 57.6, 270, 'GK'),
      snapAt('home-1', 'home', 336, 270, 'DF'),
      snapAt('home-2', 'home', 850, 270, 'FW'),
    ];
    const cmds = coordinator.update(1000, snaps, ballAt(850, 270), possession);
    const shoot = cmds.get('home-2');
    expect(shoot?.action).toBe('SHOOT');
    expect(shoot!.targetX).toBeGreaterThan(480);
    expect(shoot!.targetX).toBeGreaterThan(W / 2);
  });

  it('away ball holder SHOOT command targets the LEFT goal (targetX < 480)', () => {
    const coordinator = new TeamCoordinator('away', resolveFormation('3v3'));
    const possession = new PossessionSystem();
    const snaps = [
      snapAt('away-0', 'away', 902.4, 270, 'GK'),
      snapAt('away-1', 'away', 624, 270, 'DF'),
      snapAt('away-2', 'away', 110, 270, 'FW'),
    ];
    const cmds = coordinator.update(1000, snaps, ballAt(110, 270), possession);
    const shoot = cmds.get('away-2');
    expect(shoot?.action).toBe('SHOOT');
    expect(shoot!.targetX).toBeLessThan(480);
  });
});

describe('side consistency — goal + reset keeps sides', () => {
  const CLOCK: MatchClockConfig = {
    TIME_REMAINING_GAME_SECONDS: 60,
    GAME_TIME_SCALE: 3,
    KICKOFF_PAUSE_MS: 100,
    GOAL_PAUSE_MS: 50,
    OUT_OF_BOUNDS_PAUSE_MS: 50,
  };

  function fakePlayer(x: number, y: number) {
    return {
      sprite: { x, y },
      setPosition: vi.fn(function (this: any, px: number, py: number) {
        this.sprite.x = px;
        this.sprite.y = py;
      }),
      body: { setVelocity: vi.fn() },
    } as any;
  }

  it('after GOAL -> resetMatch every player lands on its spawn anchor (no side flip)', () => {
    const mgr = new MatchManager(CLOCK);
    const spawnHome = anchorCoords(resolveFormation('3v3'), 'home', W, H);
    const spawnAway = anchorCoords(resolveFormation('3v3'), 'away', W, H);
    const home = spawnHome.map((a) => fakePlayer(a.x, a.y));
    const away = spawnAway.map((a) => fakePlayer(a.x, a.y));
    const ball: any = {
      sprite: { x: 940, y: 270, setPosition: vi.fn() },
      body: { setVelocity: vi.fn() },
      z: 5,
      zTarget: 5,
      reset: vi.fn(),
    };
    mgr.bind(undefined as any, ball, home, away, { home: '3v3', away: '3v3' });

    mgr.update(CLOCK.KICKOFF_PAUSE_MS); // KICKOFF -> PLAYING
    expect(mgr.state).toBe('PLAYING');

    // Scramble positions as mid-play would.
    home.forEach((p, i) => p.setPosition(100 + i * 30, 100 + i * 20));
    away.forEach((p, i) => p.setPosition(700 + i * 30, 300 + i * 20));

    mgr.handleGoal('home'); // home scored in the RIGHT goal
    expect(mgr.state).toBe('GOAL');
    mgr.update(CLOCK.GOAL_PAUSE_MS); // -> resetMatch -> KICKOFF
    expect(mgr.state).toBe('KICKOFF');

    for (const [i, p] of home.entries()) {
      expect([p.sprite.x, p.sprite.y]).toEqual([spawnHome[i].x, spawnHome[i].y]);
    }
    for (const [i, p] of away.entries()) {
      expect([p.sprite.x, p.sprite.y]).toEqual([spawnAway[i].x, spawnAway[i].y]);
    }
    expect(ball.reset).toHaveBeenCalled();
  });
});

describe('kick gate — nothing moves the ball outside PLAYING', () => {
  it('canApplyKick is true only for PLAYING', () => {
    expect(canApplyKick('PLAYING')).toBe(true);
    for (const s of ['KICKOFF', 'GOAL', 'THROW_IN', 'GOAL_KICK', 'CORNER', 'GAME_OVER', 'STOPPAGE', undefined]) {
      expect(canApplyKick(s)).toBe(false);
    }
  });

  it('kickHasBall enforces the pickup radius', () => {
    const r = BALANCE_CONFIG.INPUT.PASS_PICKUP_RADIUS_PX;
    expect(kickHasBall(100, 100, 100 + r - 1, 100)).toBe(true);
    expect(kickHasBall(100, 100, 100 + r + 1, 100)).toBe(false);
  });

  it('gateKickCommand blocks kicks during KICKOFF even with ball at feet', () => {
    const facing = gateKickCommand('KICKOFF', { targetX: 900, targetY: 270 }, { x: 480, y: 270 }, { x: 480, y: 270 });
    expect(facing).toBeNull();
  });

  it('gateKickCommand blocks kicks when the ball is far (stale restart command)', () => {
    // A GK DISTRIBUTE stale after a restart: kicker at the goal line, ball at center.
    const facing = gateKickCommand('PLAYING', { targetX: 336, targetY: 300 }, { x: 57, y: 270 }, { x: 480, y: 270 });
    expect(facing).toBeNull();
  });

  it('gateKickCommand returns a normalized facing toward the target when legal', () => {
    const facing = gateKickCommand('PLAYING', { targetX: 900, targetY: 270 }, { x: 480, y: 270 }, { x: 490, y: 270 });
    expect(facing).not.toBeNull();
    expect(facing!.x).toBeCloseTo(1);
    expect(facing!.y).toBeCloseTo(0);
  });
});
