import { describe, it, expect, vi } from 'vitest';
import { MatchManager, type MatchClockConfig } from '../src/systems/MatchManager';
import { FormationSystem } from '../src/match/FormationSystem';
import { throwInPlacement } from '../src/match/restartPlacement';
import { kickoffAnchors } from '../src/match/restartPlacement';
import { ControlledIndicatorModel, indicatorFrame } from '../src/ui/ControlledIndicator';
import { canApplyKick } from '../src/match/kickGate';
import { BALANCE_CONFIG } from '../src/data/balance';

const W = BALANCE_CONFIG.PHYSICS.PITCH_WIDTH;
const H = BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT;

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

// ---------------------------------------------------------------------------
// A. Controlled-player indicator model (headless part; visuals verified manually)
// ---------------------------------------------------------------------------

describe('batch5 — A: controlled-player indicator model', () => {
  it('tracks the selected player id through switches', () => {
    const model = new ControlledIndicatorModel();
    expect(model.getSelectedId()).toBeNull();
    model.setSelectedId('home-2');
    expect(model.getSelectedId()).toBe('home-2');
    model.setSelectedId('home-1');
    expect(model.getSelectedId()).toBe('home-1');
    model.setSelectedId(null);
    expect(model.getSelectedId()).toBeNull();
  });

  it('indicatorFrame puts a floating marker above the player with config geometry', () => {
    const IND = BALANCE_CONFIG.INDICATOR;
    const frame = indicatorFrame(IND, 100, 200, 0);
    expect(frame.ring.x).toBe(100);
    expect(frame.ring.y).toBe(200);
    expect(frame.ring.radius).toBe(IND.RING_RADIUS_PX);
    // Marker floats above the player by the configured offset (plus bob).
    expect(frame.marker.x).toBe(100);
    expect(frame.marker.y).toBeLessThan(200);
    expect(frame.marker.y).toBeGreaterThanOrEqual(200 + IND.MARKER_Y_OFFSET_PX - IND.BOB_AMPLITUDE_PX);
  });

  it('indicatorFrame bob stays within the configured amplitude over a full period', () => {
    const IND = BALANCE_CONFIG.INDICATOR;
    const ys: number[] = [];
    for (let t = 0; t <= IND.BOB_PERIOD_MS; t += 50) {
      ys.push(indicatorFrame(IND, 100, 200, t).marker.y);
    }
    const base = 200 + IND.MARKER_Y_OFFSET_PX;
    for (const y of ys) {
      expect(Math.abs(y - base)).toBeLessThanOrEqual(IND.BOB_AMPLITUDE_PX + 1e-6);
    }
    // The marker visibly moves (not frozen).
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// B. Throw-in: placement must be strictly inside the pitch (repro)
// ---------------------------------------------------------------------------

describe('batch5 — B: throw-in placement strictly inside the pitch', () => {
  const home = Array.from({ length: 3 }, (_, i) => ({ x: 100 + i * 50, y: 200 + i * 40 }));
  const away = Array.from({ length: 3 }, (_, i) => ({ x: 700 - i * 40, y: 300 }));

  it('thrower + ball step INSIDE from the touchline (never exactly on the line)', () => {
    for (const exit of [{ x: 340, y: 0 }, { x: 340, y: H }]) {
      const placement = throwInPlacement(exit, 'away', home, away);
      const thrower = placement.players.find((p) => p.role === 'thrower');
      expect(thrower).toBeDefined();
      expect(thrower!.x).toBeGreaterThan(0);
      expect(thrower!.x).toBeLessThan(W);
      expect(thrower!.y).toBeGreaterThan(0);
      expect(thrower!.y).toBeLessThan(H);
      expect(placement.ball.x).toBeGreaterThan(0);
      expect(placement.ball.x).toBeLessThan(W);
      expect(placement.ball.y).toBeGreaterThan(0);
      expect(placement.ball.y).toBeLessThan(H);
    }
  });

  it('full path: touchline exit awards the opponent, places inside, resumes PLAYING', () => {
    const mgr = new MatchManager();
    const ball = fakeBall(340, H + 3);
    const hm = [fakePlayer(100, 100), fakePlayer(200, 200), fakePlayer(300, 300)];
    const aw = [fakePlayer(800, 100), fakePlayer(700, 200), fakePlayer(600, 300)];
    mgr.bind(undefined as any, ball, hm, aw, { home: '3v3', away: '3v3' });
    mgr.touchTracker.recordTouch('home', 'home-1', 330, 500);
    mgr.state = 'PLAYING';
    mgr.update(16);
    expect(mgr.state).toBe('THROW_IN');
    expect(mgr.lastRestartAward?.team).toBe('away');
    mgr.update(BALANCE_CONFIG.MATCH.OUT_OF_BOUNDS_PAUSE_MS + 1);
    expect(mgr.state).toBe('PLAYING');
    // Every moved entity strictly inside the pitch.
    for (const p of [...hm, ...aw]) {
      expect(p.sprite.x).toBeGreaterThan(0);
      expect(p.sprite.x).toBeLessThan(W);
      expect(p.sprite.y).toBeGreaterThan(0);
      expect(p.sprite.y).toBeLessThan(H);
    }
    expect(ball.sprite.x).toBeGreaterThan(0);
    expect(ball.sprite.x).toBeLessThan(W);
    expect(ball.sprite.y).toBeGreaterThan(0);
    expect(ball.sprite.y).toBeLessThan(H);
  });
});

// ---------------------------------------------------------------------------
// C. Kickoff: every team starts on its OWN half
// ---------------------------------------------------------------------------

describe('batch5 — C: kickoff placement keeps every team on its own half', () => {
  it.each(['3v3', '5v5', '11v11'] as const)('%s kickoffAnchors: home left of center, away right of center', (id) => {
    const margin = BALANCE_CONFIG.RESTART.KICKOFF_HALF_MARGIN_PX;
    for (const p of kickoffAnchors(id, 'home')) {
      expect(p.x).toBeLessThanOrEqual(W / 2 - margin);
    }
    for (const p of kickoffAnchors(id, 'away')) {
      expect(p.x).toBeGreaterThanOrEqual(W / 2 + margin);
    }
  });

  it('MatchManager resetPositions uses own-half kickoff spots (3v3 FW no longer leaks)', () => {
    const mgr = new MatchManager();
    mgr.state = 'GAME_OVER';
    const home = FormationSystem.anchors('3v3', 'home').map(() => fakePlayer());
    const away = FormationSystem.anchors('3v3', 'away').map(() => fakePlayer());
    const ball = fakeBall();
    (ball as any).reset = vi.fn();
    mgr.bind(undefined as any, ball, home, away, { home: '3v3', away: '3v3' });
    mgr.restart();
    const margin = BALANCE_CONFIG.RESTART.KICKOFF_HALF_MARGIN_PX;
    for (const p of home) {
      expect(p.sprite.x).toBeLessThanOrEqual(W / 2 - margin);
    }
    for (const p of away) {
      expect(p.sprite.x).toBeGreaterThanOrEqual(W / 2 + margin);
    }
  });
});

// ---------------------------------------------------------------------------
// D+E. Halftime + side swap (MatchManager, deterministic)
// ---------------------------------------------------------------------------

const HALF_CLOCK: MatchClockConfig = {
  TIME_REMAINING_GAME_SECONDS: 60,
  GAME_TIME_SCALE: 3,
  KICKOFF_PAUSE_MS: 100,
  GOAL_PAUSE_MS: 50,
  OUT_OF_BOUNDS_PAUSE_MS: 50,
  HALF_PAUSE_MS: 500,
};

function boundHalfManager() {
  const mgr = new MatchManager(HALF_CLOCK);
  const ball = fakeBall();
  const home = FormationSystem.anchors('3v3', 'home').map((a) => fakePlayer(a.x, a.y));
  const away = FormationSystem.anchors('3v3', 'away').map((a) => fakePlayer(a.x, a.y));
  mgr.bind(undefined as any, ball, home, away, { home: '3v3', away: '3v3' });
  return { mgr, ball, home, away };
}

describe('batch5 — D+E: halftime pause, side swap, second-half kickoff', () => {
  it('PLAYING crossing mid-duration pauses into HALF with a stopped clock', () => {
    const { mgr } = boundHalfManager();
    mgr.update(HALF_CLOCK.KICKOFF_PAUSE_MS + 1);
    expect(mgr.state).toBe('PLAYING');
    // 60 game-s at 3x: 100ms real = 0.3 game-s. Run to just past the 30 half-point.
    for (let i = 0; i < 105; i++) {
      mgr.update(100);
      if (mgr.state === 'HALF') {
        break;
      }
    }
    expect(mgr.state).toBe('HALF');
    const frozen = mgr.timeRemaining;
    expect(frozen).toBeLessThanOrEqual(30);
    expect(frozen).toBeGreaterThan(0);
    mgr.update(100);
    if (mgr.state === 'HALF') {
      expect(mgr.timeRemaining).toBe(frozen);
    }
  });

  it('HALF countdown swaps sides and resumes with a KICKOFF on opposite halves', () => {
    const { mgr, home, away } = boundHalfManager();
    mgr.update(HALF_CLOCK.KICKOFF_PAUSE_MS + 1);
    // Fast-forward to HALF.
    for (let i = 0; i < 500 && mgr.state !== 'HALF'; i++) {
      mgr.update(100);
    }
    expect(mgr.state).toBe('HALF');
    mgr.update((HALF_CLOCK.HALF_PAUSE_MS ?? 500) + 1);
    expect(mgr.state).toBe('KICKOFF');
    expect(mgr.sidesSwapped).toBe(true);
    // Sides exchanged: home now defending/standing right, away left.
    for (const p of home) {
      expect(p.sprite.x).toBeGreaterThan(W / 2);
    }
    for (const p of away) {
      expect(p.sprite.x).toBeLessThan(W / 2);
    }
    // Attack directions flipped with the swap.
    expect(mgr.attackDirection('home')).toBe(-1);
    expect(mgr.attackDirection('away')).toBe(1);
    // Second half completes to RESULTS (via FULL_TIME) with no second HALF.
    mgr.update(HALF_CLOCK.KICKOFF_PAUSE_MS + 1);
    expect(mgr.state).toBe('PLAYING');
    for (let i = 0; i < 500 && mgr.state !== 'RESULTS'; i++) {
      mgr.update(100);
    }
    expect(mgr.state).toBe('RESULTS');
  });

  it('halftime happens exactly once; restart() clears it', () => {
    const { mgr } = boundHalfManager();
    mgr.update(HALF_CLOCK.KICKOFF_PAUSE_MS + 1);
    let halves = 0;
    let prev = mgr.state;
    for (let i = 0; i < 600 && mgr.state !== 'RESULTS'; i++) {
      mgr.update(100);
      if (mgr.state === 'HALF' && prev !== 'HALF') {
        halves++;
      }
      prev = mgr.state;
    }
    expect(mgr.state).toBe('RESULTS');
    expect(halves).toBe(1);
    mgr.restart();
    expect(mgr.sidesSwapped).toBe(false);
    expect(mgr.state).toBe('KICKOFF');
  });

  it('no kick may be applied while HALF is showing', () => {
    expect(canApplyKick('HALF')).toBe(false);
  });

  it('matches without HALF_PAUSE_MS never enter HALF (legacy clocks unaffected)', () => {
    const mgr = new MatchManager({
      TIME_REMAINING_GAME_SECONDS: 60,
      GAME_TIME_SCALE: 3,
      KICKOFF_PAUSE_MS: 100,
      GOAL_PAUSE_MS: 50,
      OUT_OF_BOUNDS_PAUSE_MS: 50,
    });
    const ball = fakeBall();
    const home = [fakePlayer(), fakePlayer(), fakePlayer()];
    const away = [fakePlayer(), fakePlayer(), fakePlayer()];
    mgr.bind(undefined as any, ball, home, away, { home: '3v3', away: '3v3' });
    mgr.update(101);
    for (let i = 0; i < 300 && mgr.state !== 'RESULTS'; i++) {
      mgr.update(100);
    }
    expect(mgr.state).toBe('RESULTS');
  });
});
