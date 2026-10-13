import { describe, it, expect, vi } from 'vitest';
import { MatchManager, type MatchClockConfig, type MatchState } from '../src/systems/MatchManager';
import { PlayerSelectionSystem } from '../src/match/PlayerSelectionSystem';
import { FormationSystem } from '../src/match/FormationSystem';
import { BALANCE_CONFIG } from '../src/data/balance';
import { mulberry32 } from '../src/utils/rng';

// ---------------------------------------------------------------------------
// STAB-1: headless seeded 11v11 harness — 10 matches, no soft-lock,
// players in bounds after restarts, goals count exactly once.
// Time-compressed: fixed 100ms steps (≈10x vs a 100ms-cadence 60fps frame).
// ---------------------------------------------------------------------------

const W = BALANCE_CONFIG.PHYSICS.PITCH_WIDTH; // 960
const H = BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT; // 540
const DT = 100;
/** Longest configured pause is 2000ms; allow generous slack at DT=100. */
const MAX_STATE_FRAMES = 40;
const MATCHES = 10;
const BASE_SEED = 20240307;

const CLOCK: MatchClockConfig = {
  TIME_REMAINING_GAME_SECONDS: 60, // 60 game-s at 3x scale = 20 real-s = 200 steps
  GAME_TIME_SCALE: 3,
  KICKOFF_PAUSE_MS: 500,
  GOAL_PAUSE_MS: 300,
  OUT_OF_BOUNDS_PAUSE_MS: 300,
};

function fakePlayer(x: number, y: number) {
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

function fakeBall(x = W / 2, y = H / 2) {
  const b: any = {
    sprite: {
      x,
      y,
      setPosition: vi.fn(function (this: any, px: number, py: number) {
        this.x = px;
        this.y = py;
      }),
    },
    body: { setVelocity: vi.fn() },
    z: 0,
    zTarget: 0,
  };
  b.reset = vi.fn(() => {
    b.sprite.x = W / 2;
    b.sprite.y = H / 2;
    b.z = 0;
    b.zTarget = 0;
  });
  return b;
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && x <= W && y >= 0 && y <= H;
}

interface MatchResult {
  steps: number;
  maxFramesInState: number;
  score: { home: number; away: number };
  restarts: number;
  trace: string;
}

/**
 * Drives one full 11v11 match: synthetic seeded ball physics (random-walk
 * kicks with last-touch attribution), goal-mouth detection, and invariant
 * assertions on every step. Returns a summary for determinism comparison.
 */
function simulateMatch(seed: number): MatchResult {
  const rng = mulberry32(seed);
  const mgr = new MatchManager(CLOCK);
  const ball = fakeBall();
  const homeAnchors = FormationSystem.anchors('11v11', 'home');
  const awayAnchors = FormationSystem.anchors('11v11', 'away');
  const home = homeAnchors.map((a) => fakePlayer(a.x, a.y));
  const away = awayAnchors.map((a) => fakePlayer(a.x, a.y));
  mgr.bind(undefined as any, ball, home, away, { home: '11v11', away: '11v11' });

  expect(mgr.getTime()).toBe(CLOCK.TIME_REMAINING_GAME_SECONDS);

  let vel = { x: 0, y: 0 };
  let prevState: MatchState = mgr.state;
  let framesInState = 0;
  let maxFramesInState = 0;
  let lastTotalScore = 0;
  let restarts = 0;
  const trace: string[] = [];

  let steps = 0;
  while (mgr.state !== 'GAME_OVER' && steps < 5000) {
    steps++;

    if (mgr.state === 'PLAYING') {
      // Synthetic play: seeded random-walk kicks + last touch attribution.
      if (rng() < 0.25) {
        vel = { x: (rng() * 2 - 1) * 9, y: (rng() * 2 - 1) * 9 };
        mgr.touchTracker.recordTouch(
          rng() < 0.5 ? 'home' : 'away',
          'harness',
          ball.sprite.x,
          ball.sprite.y,
        );
      }
      ball.sprite.x += vel.x;
      ball.sprite.y += vel.y;

      // Goal-mouth detection BEFORE out-of-bounds classification.
      const inMouth = Math.abs(ball.sprite.y - H / 2) < 70;
      if (inMouth && ball.sprite.x < 20) {
        const before = mgr.score.away;
        mgr.handleGoal('away');
        expect(mgr.score.away - before).toBeLessThanOrEqual(1);
        ball.sprite.x = 8; // keep in-bounds; GOAL state freezes anyway
      } else if (inMouth && ball.sprite.x > W - 20) {
        const before = mgr.score.home;
        mgr.handleGoal('home');
        expect(mgr.score.home - before).toBeLessThanOrEqual(1);
        ball.sprite.x = W - 8;
      }
    }

    mgr.update(DT);

    // STAB-1: no state may be stuck beyond the frame budget (GAME_OVER is terminal).
    if (mgr.state === prevState) {
      framesInState++;
      maxFramesInState = Math.max(maxFramesInState, framesInState);
    } else {
      framesInState = 0;
      trace.push(`${prevState}->${mgr.state}`);
    }

    // STAB-1: after any restart/kickoff everyone (and the ball) is in bounds.
    if (prevState !== 'PLAYING' && (mgr.state === 'PLAYING' || mgr.state === 'KICKOFF')) {
      for (const [i, p] of [...home, ...away].entries()) {
        expect(inBounds(p.sprite.x, p.sprite.y)).toBe(true);
        void i;
      }
      expect(inBounds(ball.sprite.x, ball.sprite.y)).toBe(true);
      if (prevState !== 'KICKOFF') {
        restarts++;
      }
    }

    // STAB-1: the scoreboard never jumps by more than one goal in a step.
    const total = mgr.score.home + mgr.score.away;
    expect(total - lastTotalScore).toBeLessThanOrEqual(1);
    lastTotalScore = total;

    prevState = mgr.state;
  }

  // No soft-lock: the match must have terminated.
  expect(mgr.state).toBe('GAME_OVER');
  expect(maxFramesInState).toBeLessThanOrEqual(MAX_STATE_FRAMES);

  return {
    steps,
    maxFramesInState,
    score: { ...mgr.score },
    restarts,
    trace: trace.join(';'),
  };
}

describe('STAB-1 — 10 seeded 11v11 matches without soft-lock', () => {
  it('runs 10 full matches; all invariants hold every match', () => {
    for (let m = 0; m < MATCHES; m++) {
      const result = simulateMatch(BASE_SEED + m);
      expect(result.score.home + result.score.away).toBeGreaterThanOrEqual(0);
      expect(result.steps).toBeGreaterThan(0);
    }
  });

  it('is deterministic: same seed reproduces identical summary', () => {
    const a = simulateMatch(BASE_SEED + 42);
    const b = simulateMatch(BASE_SEED + 42);
    expect(a).toEqual(b);
  });

  it('a second goal event before the next KICKOFF never double-counts (RULE-2 guard)', () => {
    const mgr = new MatchManager(CLOCK);
    const ball = fakeBall();
    const home = FormationSystem.anchors('11v11', 'home').map((a) => fakePlayer(a.x, a.y));
    const away = FormationSystem.anchors('11v11', 'away').map((a) => fakePlayer(a.x, a.y));
    mgr.bind(undefined as any, ball, home, away, { home: '11v11', away: '11v11' });

    mgr.update(CLOCK.KICKOFF_PAUSE_MS); // KICKOFF -> PLAYING
    expect(mgr.state).toBe('PLAYING');

    mgr.handleGoal('home');
    mgr.handleGoal('home');
    mgr.handleGoal('home');
    expect(mgr.score.home).toBe(1);
  });

  it('selector does not oscillate frame-to-frame beyond the hysteresis/cooldown budget', () => {
    const rng = mulberry32(9001);
    const sel = new PlayerSelectionSystem();
    const candidates = Array.from({ length: 11 }, (_, i) => ({
      id: `home-${i}`,
      x: rng() * W,
      y: rng() * H,
      role: i === 0 ? 'GK' : 'MF',
    }));
    const ball = { x: W / 2, y: H / 2 };
    const vel = { x: 40, y: 0 };

    const FRAMES = 600;
    const dt = 16;
    const cooldown = BALANCE_CONFIG.SELECTION.COOLDOWN_MS;
    let prevId: string | null = null;
    let lastSwitchTime = -Infinity;
    let switches = 0;

    for (let f = 0; f < FRAMES; f++) {
      ball.x += vel.x * dt * 0.06 + (rng() * 2 - 1) * 4;
      ball.y += vel.y * dt * 0.1 + (rng() * 2 - 1) * 4;
      const id = sel.update(dt, candidates, { x: ball.x, y: ball.y }, vel);
      if (id !== prevId) {
        if (prevId !== null) {
          switches++;
          const t = f * dt;
          expect(t - lastSwitchTime).toBeGreaterThanOrEqual(cooldown - dt - 1);
          lastSwitchTime = t;
        } else {
          lastSwitchTime = f * dt;
        }
        prevId = id;
      }
    }

    // Hysteresis budget: at most one switch per cooldown window.
    expect(switches).toBeLessThanOrEqual(Math.ceil((FRAMES * dt) / cooldown));
  });
});
