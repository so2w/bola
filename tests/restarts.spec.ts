import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TouchTracker } from '../src/match/TouchTracker';
import {
  throwInPlacement,
  cornerPlacement,
  goalKickPlacement,
  freeKickPlacement,
  penaltyPlacement,
} from '../src/match/restartPlacement';
import { MatchManager } from '../src/systems/MatchManager';
import { BALANCE_CONFIG } from '../src/data/balance';

const W = BALANCE_CONFIG.PHYSICS.PITCH_WIDTH; // 960
const H = BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT; // 540
const EPS = BALANCE_CONFIG.RESTART.CORNER_EPSILON_PX;

// ---------------------------------------------------------------------------
// Fakes (headless, Phaser-free)
// ---------------------------------------------------------------------------

function fakePlayer(x = 0, y = 0) {
  return {
    x,
    y,
    sprite: { x, y } as any,
    setPosition: vi.fn(function (this: any, px: number, py: number) {
      this.x = px;
      this.y = py;
      if (this.sprite) {
        this.sprite.x = px;
        this.sprite.y = py;
      }
    }),
    body: { setVelocity: vi.fn(), setAcceleration: vi.fn() },
  } as any;
}

function fakeBall(x = 480, y = 270) {
  return {
    sprite: { x, y, setPosition: vi.fn(function (this: any, px: number, py: number) {
      this.x = px;
      this.y = py;
    }) },
    body: { setVelocity: vi.fn() },
    z: 0,
    zTarget: 0,
    reset: vi.fn(),
  } as any;
}

function boundManager(opts: { ballX?: number; ballY?: number } = {}) {
  const mgr = new MatchManager();
  const ball = fakeBall(opts.ballX ?? 480, opts.ballY ?? 270);
  const home = [fakePlayer(100, 100), fakePlayer(200, 200), fakePlayer(300, 300)];
  const away = [fakePlayer(800, 100), fakePlayer(700, 200), fakePlayer(600, 300)];
  mgr.bind(undefined as any, ball, home, away, { home: '3v3', away: '3v3' });
  return { mgr, ball, home, away };
}

/** Drive a PLAYING manager out of bounds and through the restart countdown. */
function runRestart(mgr: MatchManager) {
  mgr.state = 'PLAYING';
  mgr.update(16); // detect exit
  const stateAfterExit = mgr.state;
  mgr.update(BALANCE_CONFIG.MATCH.OUT_OF_BOUNDS_PAUSE_MS + 1); // restart countdown
  return stateAfterExit;
}

// ---------------------------------------------------------------------------
// TouchTracker units (S2.2)
// ---------------------------------------------------------------------------

describe('TouchTracker (S2.2)', () => {
  it('records last touch with team/player/position', () => {
    const tt = new TouchTracker();
    expect(tt.lastTouch).toBeNull();
    expect(tt.lastTouchTeam).toBeNull();
    tt.recordTouch('home', 'home-2', 320, 200);
    tt.recordTouch('away', 'away-5', 480, 270);
    expect(tt.lastTouchTeam).toBe('away');
    expect(tt.lastTouch).toEqual({ team: 'away', playerId: 'away-5', x: 480, y: 270 });
  });

  it('classifies touchline exits with clamped exit point', () => {
    const tt = new TouchTracker();
    const top = tt.classifyExit(500, -5);
    expect(top).toMatchObject({ line: 'touchline', side: 'top', exitPoint: { x: 500, y: 0 } });
    const bottom = tt.classifyExit(500, H + 5);
    expect(bottom).toMatchObject({ line: 'touchline', side: 'bottom', exitPoint: { x: 500, y: H } });
  });

  it('classifies byline exits with clamped exit point', () => {
    const tt = new TouchTracker();
    const left = tt.classifyExit(-6, 120);
    expect(left).toMatchObject({ line: 'byline', side: 'left', exitPoint: { x: 0, y: 120 } });
    const right = tt.classifyExit(W + 6, 400);
    expect(right).toMatchObject({ line: 'byline', side: 'right', exitPoint: { x: W, y: 400 } });
  });

  it('returns null for an in-bounds ball', () => {
    expect(new TouchTracker().classifyExit(480, 270)).toBeNull();
  });

  it('exact corner exit within CORNER_EPSILON_PX resolves as byline (deterministic, RULE-1)', () => {
    const tt = new TouchTracker();
    for (const dy of [0, EPS / 2, EPS]) {
      const exit = tt.classifyExit(W + 4, H + dy);
      expect(exit?.line).toBe('byline');
      expect(exit?.side).toBe('right');
    }
    const touchline = tt.classifyExit(W + 4, H + EPS + 1);
    expect(touchline?.line).toBe('touchline');
  });
});

// ---------------------------------------------------------------------------
// Award matrix through MatchManager (S2.4, RULE-1 scenarios)
// ---------------------------------------------------------------------------

describe('MatchManager — last-touch award matrix (RULE-1)', () => {
  it('touchline out after home touch → THROW_IN awarded to away at exit point', () => {
    const { mgr } = boundManager({ ballX: 500, ballY: H + 4 });
    mgr.touchTracker.recordTouch('home', 'home-0', 480, 500);
    const stateAfterExit = runRestart(mgr);
    expect(stateAfterExit).toBe('THROW_IN');
    expect(mgr.state).toBe('PLAYING');
    expect((mgr as any).pendingRestartAward ?? null).toBeNull();
    // away thrower placed at the exit point on the touchline
    const awayThrower = (mgr as any).lastRestartAward;
    expect(awayThrower.team).toBe('away');
  });

  it('GK save (defense last touch) over defending byline → CORNER to attack, never GOAL_KICK', () => {
    const { mgr } = boundManager({ ballX: -5, ballY: 400 });
    mgr.touchTracker.recordTouch('home', 'home-0', 30, 380); // home GK = defense on left
    const stateAfterExit = runRestart(mgr);
    expect(stateAfterExit).toBe('CORNER');
    expect((mgr as any).lastRestartAward.team).toBe('away');
  });

  it('attacker last touch before defending byline → GOAL_KICK to defense', () => {
    const { mgr } = boundManager({ ballX: -5, ballY: 400 });
    mgr.touchTracker.recordTouch('away', 'away-2', 60, 390);
    const stateAfterExit = runRestart(mgr);
    expect(stateAfterExit).toBe('GOAL_KICK');
    expect((mgr as any).lastRestartAward.team).toBe('home');
  });

  it('right byline mirrored: away defense touch → CORNER to home', () => {
    const { mgr } = boundManager({ ballX: W + 5, ballY: 100 });
    mgr.touchTracker.recordTouch('away', 'away-0', 940, 90);
    expect(runRestart(mgr)).toBe('CORNER');
    expect((mgr as any).lastRestartAward.team).toBe('home');
  });
});

// ---------------------------------------------------------------------------
// Goal latch + restart guard (RULE-2)
// ---------------------------------------------------------------------------

describe('MatchManager — double-goal guard and GOAL-phase restart (RULE-2)', () => {
  it('a second goal event before KICKOFF does not score (exactly once)', () => {
    const { mgr } = boundManager();
    mgr.state = 'PLAYING';
    mgr.handleGoal('home');
    expect(mgr.score.home).toBe(1);
    expect(mgr.state).toBe('GOAL');
    mgr.handleGoal('home');
    mgr.handleGoal('away');
    expect(mgr.score).toEqual({ home: 1, away: 0 });
    // After celebration → KICKOFF: latch cleared, next goal counts
    mgr.update(BALANCE_CONFIG.MATCH.GOAL_PAUSE_MS + 1);
    expect(mgr.state).toBe('KICKOFF');
    mgr.update(BALANCE_CONFIG.MATCH.KICKOFF_PAUSE_MS + 1);
    expect(mgr.state).toBe('PLAYING');
    mgr.handleGoal('away');
    expect(mgr.score).toEqual({ home: 1, away: 1 });
  });

  it('restart input during GOAL countdown is ignored', () => {
    const { mgr } = boundManager();
    mgr.state = 'PLAYING';
    mgr.handleGoal('home');
    mgr.restart();
    expect(mgr.state).toBe('GOAL');
    expect(mgr.score.home).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// restartPlacement units (S2.3, RULE-2 placement scenarios)
// ---------------------------------------------------------------------------

describe('restartPlacement (S2.3)', () => {
  const home = Array.from({ length: 11 }, (_, i) => ({ x: 100 + i * 20, y: 200 }));
  const away = Array.from({ length: 11 }, (_, i) => ({ x: 700 - i * 15, y: 300 }));

  it('THROW_IN: thrower at exit point on touchline, support within configured radius+bound', () => {
    const exit = { x: 500, y: 0 };
    const placement = throwInPlacement(exit, 'home', home, away);
    // Batch 5: the throw mark steps THROW_IN_INSET_PX inside so neither the
    // thrower nor the ball spawns exactly on the boundary line.
    const inset = BALANCE_CONFIG.RESTART.THROW_IN_INSET_PX;
    expect(placement.ball).toEqual({ x: exit.x, y: inset });
    const thrower = placement.players.find((p) => p.team === 'home');
    expect(thrower).toBeDefined();
    expect(thrower!.x).toBe(500);
    expect(thrower!.y).toBe(inset);
    const mark = { x: exit.x, y: inset };
    const support = placement.players.filter((p) => p.team === 'home' && p.index !== thrower!.index);
    expect(support.length).toBe(BALANCE_CONFIG.RESTART.THROW_IN_SUPPORT_COUNT);
    for (const s of support) {
      const d = Math.hypot(s.x - mark.x, s.y - mark.y);
      expect(d).toBeLessThanOrEqual(BALANCE_CONFIG.RESTART.THROW_IN_SUPPORT_RADIUS_PX * 1.5);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(W);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(H);
    }
    // Opponents untouched by the placement plan
    expect(placement.players.some((p) => p.team === 'away')).toBe(false);
  });

  it('CORNER: kicker at corner arc inset, ball at corner spot, box groups stay in pitch', () => {
    const exit = { line: 'byline', side: 'left', exitPoint: { x: 0, y: 20 } } as const;
    const placement = cornerPlacement(exit, 'away', home, away);
    const kicker = placement.players.find((p) => p.team === 'away' && p.role === 'kicker');
    const arc = BALANCE_CONFIG.RESTART.CORNER_ARC_OFFSET_PX;
    expect(kicker).toBeDefined();
    expect(kicker!.x).toBe(arc);
    expect(kicker!.y).toBe(arc);
    expect(placement.ball).toEqual({ x: arc, y: arc });
    for (const p of placement.players) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(W);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(H);
    }
  });

  it('GOAL_KICK: GK (index 0) at own goal center, ball at 6yd spot', () => {
    const exit = { line: 'byline', side: 'right', exitPoint: { x: W, y: 400 } } as const;
    const placement = goalKickPlacement(exit, 'away', home, away);
    const gk = placement.players.find((p) => p.team === 'away' && p.index === 0);
    expect(gk).toBeDefined();
    expect(gk!.x).toBe(W - 20);
    expect(gk!.y).toBe(H / 2);
    expect(placement.ball).toEqual({ x: W - BALANCE_CONFIG.RESTART.GOAL_KICK_SPOT_X_PX, y: H / 2 });
  });

  it('FREE_KICK / PENALTY place reachable set pieces (Batch B2, stubs shipped)', () => {
    const fk = freeKickPlacement({ x: 500, y: 270 }, 'home', home, away);
    expect(fk.ball).toEqual({ x: 500, y: 270 });
    expect(fk.players.some((p) => p.role === 'kicker' && p.team === 'home')).toBe(true);
    const pen = penaltyPlacement('away', home, away);
    expect(pen.ball.x).toBe(BALANCE_CONFIG.FOUL.PENALTY_SPOT_OFFSET_PX);
    expect(pen.players.some((p) => p.role === 'shooter' && p.team === 'away')).toBe(true);
    expect(pen.players.some((p) => p.role === 'gk' && p.team === 'home')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration: full restart flow places entities and resumes play (S2.4)
// ---------------------------------------------------------------------------

describe('MatchManager — contextual restart integration (RULE-2)', () => {
  it('THROW_IN places thrower at exit point and every entity stays in bounds', () => {
    const { mgr, home, away } = boundManager({ ballX: 340, ballY: H + 3 });
    mgr.touchTracker.recordTouch('home', 'home-1', 330, 500);
    expect(runRestart(mgr)).toBe('THROW_IN');
    expect(mgr.state).toBe('PLAYING');
    const allPlayers = [...home, ...away];
    for (const p of allPlayers) {
      expect(p.sprite.x).toBeGreaterThanOrEqual(0);
      expect(p.sprite.x).toBeLessThanOrEqual(W);
      expect(p.sprite.y).toBeGreaterThanOrEqual(0);
      expect(p.sprite.y).toBeLessThanOrEqual(H);
    }
    // An away player (opponent of last touch) was moved onto the throw mark
    // just inside the touchline (batch 5 inset, not exactly on the line).
    const inset = BALANCE_CONFIG.RESTART.THROW_IN_INSET_PX;
    const thrower = away.find((p) => p.sprite.x === 340 && p.sprite.y === H - inset);
    expect(thrower).toBeDefined();
  });

  it('GOAL still does a full anchor reset → KICKOFF (existing behavior preserved)', () => {
    const { mgr, ball } = boundManager();
    mgr.state = 'PLAYING';
    mgr.handleGoal('home');
    mgr.update(BALANCE_CONFIG.MATCH.GOAL_PAUSE_MS + 1);
    expect(mgr.state).toBe('KICKOFF');
    expect(ball.reset).toHaveBeenCalled();
  });

  it('clock is untouched by restarts: 3-minute countdown only runs during PLAYING', () => {
    const { mgr } = boundManager({ ballX: -5, ballY: 100 });
    mgr.state = 'PLAYING';
    mgr.timeRemaining = 540;
    mgr.touchTracker.recordTouch('away', 'away-2', 60, 90);
    mgr.update(16); // exit detected
    const beforePause = mgr.timeRemaining;
    mgr.update(1000); // inside restart countdown — clock frozen
    expect(mgr.timeRemaining).toBe(beforePause);
    expect(mgr.state).not.toBe('PLAYING');
    mgr.update(BALANCE_CONFIG.MATCH.OUT_OF_BOUNDS_PAUSE_MS); // countdown ends → PLAYING
    expect(mgr.state).toBe('PLAYING');
    expect(mgr.timeRemaining).toBe(beforePause);
    mgr.update(1000); // PLAYING at 3x → 3 game-seconds
    expect(mgr.timeRemaining).toBe(beforePause - 3);
  });
});

// ---------------------------------------------------------------------------
// Regression: 3v3/legacy behaviors
// ---------------------------------------------------------------------------

describe('regression — legacy suite invariants', () => {
  let mgr: MatchManager;
  beforeEach(() => {
    ({ mgr } = boundManager());
  });

  it('KICKOFF → PLAYING after kickoff pause; restart() from GAME_OVER still anchors', () => {
    expect(mgr.state).toBe('KICKOFF');
    mgr.update(BALANCE_CONFIG.MATCH.KICKOFF_PAUSE_MS + 1);
    expect(mgr.state).toBe('PLAYING');
    mgr.state = 'GAME_OVER';
    mgr.score = { home: 3, away: 2 };
    mgr.restart();
    expect(mgr.state).toBe('KICKOFF');
    expect(mgr.score).toEqual({ home: 0, away: 0 });
    expect(mgr.timeRemaining).toBe(540);
  });
});
