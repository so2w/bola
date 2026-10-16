import { describe, it, expect, vi } from 'vitest';
import { BALANCE_CONFIG } from '../src/data/balance';
import {
  awardForFoul,
  classifyChallenge,
  detectFoul,
  isInPenaltyBox,
  type ChallengeSnap,
} from '../src/match/foulRule';
import {
  freeKickPlacement,
  penaltyPlacement,
  RESTART_PLACEMENT_CONFIG,
} from '../src/match/restartPlacement';
import { MatchManager } from '../src/systems/MatchManager';
import { canApplyKick } from '../src/match/kickGate';
import { AudioDirector } from '../src/audio/AudioDirector';
import { WebAudioSynth } from '../src/audio/WebAudioSynth';
import { FrameTimeTracker } from '../src/utils/FrameTimeTracker';

// ---------------------------------------------------------------------------
// Batch B2 — simple fouls + reachable set pieces, procedural audio fallback,
// frame-time measurement. Failing-first TDD slice.
// ---------------------------------------------------------------------------

const W = BALANCE_CONFIG.PHYSICS.PITCH_WIDTH; // 960
const H = BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT; // 540
const FOUL = BALANCE_CONFIG.FOUL;

function snap(partial: Partial<ChallengeSnap> & { id: string }): ChallengeSnap {
  return {
    team: 'home',
    role: 'MF',
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    ...partial,
  };
}

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

function fakeBall(x = W / 2, y = H / 2) {
  return {
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
    vz: 0,
    zTarget: 0,
    reset: vi.fn(),
  } as any;
}

function boundManager() {
  const mgr = new MatchManager();
  const ball = fakeBall();
  const home = [fakePlayer(100, 100), fakePlayer(200, 200), fakePlayer(300, 300)];
  const away = [fakePlayer(800, 100), fakePlayer(700, 200), fakePlayer(600, 300)];
  mgr.bind(undefined as any, ball, home, away, { home: '3v3', away: '3v3' });
  return { mgr, ball, home, away };
}

function shapes(n: number, x0: number, y0: number) {
  return Array.from({ length: n }, (_, i) => ({ x: x0 + i * 40, y: y0 + (i % 3) * 30 }));
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && x <= W && y >= 0 && y <= H;
}

// ---------------------------------------------------------------------------
// B2-A: minimal foul rule (tackle from behind)
// ---------------------------------------------------------------------------

describe('B2-A foul rule — tackle from behind', () => {
  it('exposes all foul/audio/perf tuning through BALANCE_CONFIG (no hidden literals)', () => {
    for (const k of [
      'TACKLE_RADIUS_PX',
      'MIN_CARRIER_SPEED_PX_S',
      'BEHIND_ANGLE_DEG',
      'COOLDOWN_MS',
      'BOX_DEPTH_PX',
      'BOX_HALF_HEIGHT_PX',
      'PENALTY_SPOT_OFFSET_PX',
      'FREE_KICK_SUPPORT_COUNT',
      'FREE_KICK_SUPPORT_RADIUS_PX',
      'FREE_KICK_DEFENDER_DISTANCE_PX',
      'PENALTY_CLEAR_RADIUS_PX',
      'SET_PIECE_MAX_WAIT_MS',
      'SET_PIECE_AI_DELAY_MS',
      'SET_PIECE_AI_POWER',
    ] as const) {
      expect(typeof FOUL[k], `FOUL.${k}`).toBe('number');
      expect(Number.isFinite(FOUL[k]), `FOUL.${k} finite`).toBe(true);
    }
    expect(BALANCE_CONFIG.AUDIO.MASTER_VOLUME).toBeGreaterThan(0);
    expect(BALANCE_CONFIG.PERF.FRAME_TIME_WINDOW).toBeGreaterThan(0);
  });

  it('a tackle from directly behind a moving carrier is a foul (deterministic)', () => {
    // Carrier dribbling right (+x) at speed; tackler behind (to the left).
    const carrier = snap({ id: 'home-9', team: 'home', x: 500, y: 270, vx: 150, vy: 0 });
    const behind = snap({ id: 'away-4', team: 'away', x: 480, y: 270, vx: 160, vy: 0 });
    expect(classifyChallenge(behind, carrier)).toBe('foul');
    expect(classifyChallenge(behind, carrier)).toBe(classifyChallenge(behind, carrier));
  });

  it('a frontal tackle (meeting the carrier) is clean', () => {
    const carrier = snap({ id: 'home-9', team: 'home', x: 500, y: 270, vx: 150, vy: 0 });
    const front = snap({ id: 'away-4', team: 'away', x: 520, y: 270, vx: -160, vy: 0 });
    expect(classifyChallenge(front, carrier)).toBe('clean');
  });

  it('a side tackle at 90 degrees is clean (outside the behind cone)', () => {
    const carrier = snap({ id: 'home-9', team: 'home', x: 500, y: 270, vx: 150, vy: 0 });
    const side = snap({ id: 'away-4', team: 'away', x: 500, y: 250, vx: 0, vy: 160 });
    expect(classifyChallenge(side, carrier)).toBe('clean');
  });

  it('contact on a stationary carrier is never a foul (clean steal)', () => {
    const carrier = snap({ id: 'home-9', team: 'home', x: 500, y: 270, vx: 0, vy: 0 });
    const behind = snap({ id: 'away-4', team: 'away', x: 480, y: 270, vx: 160, vy: 0 });
    expect(classifyChallenge(behind, carrier)).toBe('clean');
  });

  it('a GK challenge is never a foul (claims are clean by rule)', () => {
    const carrier = snap({ id: 'home-9', team: 'home', x: 100, y: 270, vx: 150, vy: 0 });
    const gk = snap({ id: 'away-0', team: 'away', role: 'GK', x: 80, y: 270, vx: 60, vy: 0 });
    expect(classifyChallenge(gk, carrier)).toBe('clean');
  });

  it('detectFoul returns the nearest fouling challenger (ties break by lower id)', () => {
    const carrier = snap({ id: 'home-9', team: 'home', x: 500, y: 270, vx: 150, vy: 0 });
    const foulA = snap({ id: 'away-2', team: 'away', x: 484, y: 270 });
    const foulB = snap({ id: 'away-1', team: 'away', x: 484, y: 270 });
    const clean = snap({ id: 'away-3', team: 'away', x: 520, y: 270 });
    const found = detectFoul(carrier, [foulA, foulB, clean]);
    expect(found?.tacklerId).toBe('away-1');
  });

  it('detectFoul ignores challengers outside the tackle radius', () => {
    const carrier = snap({ id: 'home-9', team: 'home', x: 500, y: 270, vx: 150, vy: 0 });
    const far = snap({ id: 'away-4', team: 'away', x: 0, y: 0 });
    expect(detectFoul(carrier, [far])).toBeNull();
  });

  it('detectFoul returns null when every challenge is clean', () => {
    const carrier = snap({ id: 'home-9', team: 'home', x: 500, y: 270, vx: 150, vy: 0 });
    const front = snap({ id: 'away-4', team: 'away', x: 520, y: 270 });
    expect(detectFoul(carrier, [front])).toBeNull();
  });
});

describe('B2-A penalty box + award mapping', () => {
  it('detects the box on both ends from config geometry', () => {
    expect(isInPenaltyBox(FOUL.BOX_DEPTH_PX - 1, H / 2, 'left')).toBe(true);
    expect(isInPenaltyBox(FOUL.BOX_DEPTH_PX + 1, H / 2, 'left')).toBe(false);
    expect(isInPenaltyBox(W - FOUL.BOX_DEPTH_PX + 1, H / 2, 'right')).toBe(true);
    expect(isInPenaltyBox(W - FOUL.BOX_DEPTH_PX - 1, H / 2, 'right')).toBe(false);
    expect(isInPenaltyBox(10, 0, 'left')).toBe(false);
  });

  it('a foul by the defense inside its own box is a PENALTY for the opponent', () => {
    expect(awardForFoul({ x: 60, y: H / 2 }, 'home')).toEqual({ kind: 'PENALTY', team: 'away' });
    expect(awardForFoul({ x: W - 60, y: H / 2 }, 'away')).toEqual({ kind: 'PENALTY', team: 'home' });
  });

  it('a midfield foul is a FREE_KICK for the fouled team', () => {
    expect(awardForFoul({ x: W / 2, y: H / 2 }, 'away')).toEqual({ kind: 'FREE_KICK', team: 'home' });
  });

  it('a foul inside the ATTACKING box (not the fouling own box) stays a FREE_KICK', () => {
    expect(awardForFoul({ x: W - 60, y: H / 2 }, 'home')).toEqual({ kind: 'FREE_KICK', team: 'away' });
  });
});

// ---------------------------------------------------------------------------
// B2-A: reachable set-piece placement
// ---------------------------------------------------------------------------

describe('B2-A free-kick placement', () => {
  it('places the ball at the spot with the nearest attacker as kicker', () => {
    const home = shapes(11, 400, 200);
    const away = shapes(11, 600, 200);
    const spot = { x: 500, y: 270 };
    const p = freeKickPlacement(spot, 'home', home, away, RESTART_PLACEMENT_CONFIG);
    expect(p.ball).toEqual(spot);
    const kicker = p.players.find((t) => t.role === 'kicker');
    expect(kicker?.team).toBe('home');
    expect(kicker).toBeDefined();
    // Nearest home shape to the spot takes the kick.
    let best = 0;
    let bestD = Infinity;
    home.forEach((s, i) => {
      const d = (s.x - spot.x) ** 2 + (s.y - spot.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    expect(kicker?.index).toBe(best);
    expect(kicker?.x).toBe(spot.x);
    expect(kicker?.y).toBe(spot.y);
  });

  it('stages support teammates at the config radius and keeps defenders at distance', () => {
    const home = shapes(11, 480, 250);
    const away = shapes(11, 520, 250);
    const spot = { x: 500, y: 270 };
    const p = freeKickPlacement(spot, 'home', home, away, RESTART_PLACEMENT_CONFIG);
    const supports = p.players.filter((t) => t.role === 'support');
    expect(supports.length).toBe(FOUL.FREE_KICK_SUPPORT_COUNT);
    for (const s of supports) {
      const d = Math.hypot(s.x - spot.x, s.y - spot.y);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(FOUL.FREE_KICK_SUPPORT_RADIUS_PX + 1);
    }
    for (const t of p.players) {
      expect(inBounds(t.x, t.y)).toBe(true);
      if (t.team === 'away') {
        expect(Math.hypot(t.x - spot.x, t.y - spot.y)).toBeGreaterThanOrEqual(
          FOUL.FREE_KICK_DEFENDER_DISTANCE_PX - 1,
        );
      }
    }
  });
});

describe('B2-A penalty placement', () => {
  it('spots the ball, posts a shooter behind it and the GK on the line', () => {
    const home = shapes(11, 700, 200);
    const away = shapes(11, 200, 200);
    const p = penaltyPlacement('home', home, away, RESTART_PLACEMENT_CONFIG);
    // Home attacks right: spot offset from the right goal line, centered.
    expect(p.ball.x).toBe(W - FOUL.PENALTY_SPOT_OFFSET_PX);
    expect(p.ball.y).toBe(H / 2);
    const shooter = p.players.find((t) => t.role === 'shooter');
    expect(shooter?.team).toBe('home');
    expect(shooter!.x).toBeLessThan(p.ball.x);
    const gk = p.players.find((t) => t.role === 'gk');
    expect(gk?.team).toBe('away');
    expect(gk?.index).toBe(0);
    expect(gk?.y).toBe(H / 2);
  });

  it('mirrors for the away side and clears everyone else from the spot', () => {
    const home = shapes(11, 700, 200);
    const away = shapes(11, 200, 200);
    const p = penaltyPlacement('away', home, away, RESTART_PLACEMENT_CONFIG);
    expect(p.ball.x).toBe(FOUL.PENALTY_SPOT_OFFSET_PX);
    const gk = p.players.find((t) => t.role === 'gk');
    expect(gk?.team).toBe('home');
    for (const t of p.players) {
      expect(inBounds(t.x, t.y)).toBe(true);
      if (t.role !== 'shooter' && t.role !== 'gk') {
        expect(Math.hypot(t.x - p.ball.x, t.y - p.ball.y)).toBeGreaterThanOrEqual(
          FOUL.PENALTY_CLEAR_RADIUS_PX - 1,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// B2-A: MatchManager set-piece states
// ---------------------------------------------------------------------------

describe('B2-A MatchManager FREE_KICK / PENALTY', () => {
  it('awards a midfield foul as FREE_KICK with ball + kicker placed', () => {
    const { mgr, ball } = boundManager();
    mgr.state = 'PLAYING';
    const award = mgr.awardFoul('away', W / 2, H / 2);
    expect(award).toEqual({ kind: 'FREE_KICK', team: 'home' });
    expect(mgr.state).toBe('FREE_KICK');
    expect(mgr.lastRestartAward).toEqual({ kind: 'FREE_KICK', team: 'home' });
    expect(ball.sprite.x).toBe(W / 2);
    expect(ball.sprite.y).toBe(H / 2);
    expect(mgr.lastSetPiece?.kickerTeam).toBe('home');
  });

  it('awards a box foul as PENALTY for the opponent', () => {
    const { mgr } = boundManager();
    mgr.state = 'PLAYING';
    const award = mgr.awardFoul('home', 60, H / 2);
    expect(award?.kind).toBe('PENALTY');
    expect(mgr.state).toBe('PENALTY');
    expect(mgr.lastSetPiece?.team).toBe('away');
  });

  it('ignores fouls outside PLAYING (no state corruption, no double award)', () => {
    const { mgr } = boundManager();
    mgr.state = 'KICKOFF';
    expect(mgr.awardFoul('away', W / 2, H / 2)).toBeNull();
    expect(mgr.state).toBe('KICKOFF');
  });

  it('enforces the foul cooldown (no whistle spam from one challenge)', () => {
    const { mgr } = boundManager();
    mgr.state = 'PLAYING';
    expect(mgr.awardFoul('away', W / 2, H / 2)?.kind).toBe('FREE_KICK');
    mgr.notifySetPieceKick();
    expect(mgr.state).toBe('PLAYING');
    // Immediate second challenge is swallowed by the cooldown.
    expect(mgr.awardFoul('away', W / 2, H / 2)).toBeNull();
    expect(mgr.state).toBe('PLAYING');
    // After the cooldown window it is a foul again.
    mgr.update(FOUL.COOLDOWN_MS + 100);
    expect(mgr.state).toBe('PLAYING');
    expect(mgr.awardFoul('away', W / 2, H / 2)?.kind).toBe('FREE_KICK');
  });

  it('resumes on kick: notifySetPieceKick returns to PLAYING', () => {
    const { mgr } = boundManager();
    mgr.state = 'PLAYING';
    mgr.awardFoul('away', W / 2, H / 2);
    expect(mgr.notifySetPieceKick()).toBe(true);
    expect(mgr.state).toBe('PLAYING');
    expect(mgr.notifySetPieceKick()).toBe(false);
  });

  it('freezes the clock during the set piece and safety-resumes on timeout', () => {
    const { mgr } = boundManager();
    mgr.state = 'PLAYING';
    mgr.awardFoul('away', W / 2, H / 2);
    const frozen = mgr.getTime();
    mgr.update(1000);
    expect(mgr.state).toBe('FREE_KICK');
    expect(mgr.getTime()).toBe(frozen);
    mgr.update(FOUL.SET_PIECE_MAX_WAIT_MS);
    expect(mgr.state).toBe('PLAYING');
  });
});

describe('B2-A kick gate covers set pieces', () => {
  it('allows kicks in FREE_KICK / PENALTY (resume on kick), still blocks the rest', () => {
    expect(canApplyKick('FREE_KICK')).toBe(true);
    expect(canApplyKick('PENALTY')).toBe(true);
    expect(canApplyKick('PLAYING')).toBe(true);
    expect(canApplyKick('THROW_IN')).toBe(false);
    expect(canApplyKick('GOAL')).toBe(false);
    expect(canApplyKick(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B2-B: procedural audio fallback (no external assets)
// ---------------------------------------------------------------------------

describe('B2-B AudioDirector synth fallback', () => {
  it('falls back to synthesis when the asset is missing (files win when present)', () => {
    const adapter = { play: vi.fn(), has: () => false };
    const synth = { play: vi.fn(), has: () => true };
    const director = new AudioDirector(adapter, { synth });
    director.playEvent('KICK');
    expect(adapter.play).not.toHaveBeenCalled();
    expect(synth.play).toHaveBeenCalledWith('sfx_kick', expect.objectContaining({ volume: expect.any(Number) }));
  });

  it('prefers the asset file when present (synth stays silent)', () => {
    const adapter = { play: vi.fn(), has: () => true };
    const synth = { play: vi.fn() };
    const director = new AudioDirector(adapter, { synth });
    director.playEvent('GOAL');
    expect(adapter.play).toHaveBeenCalled();
    expect(synth.play).not.toHaveBeenCalled();
  });

  it('never throws without adapter or synth (headless safe)', () => {
    const director = new AudioDirector();
    expect(() => director.playEvent('WHISTLE')).not.toThrow();
    expect(() => director.playEvent('GOAL')).not.toThrow();
  });

  it('cycles volume/rate variants deterministically from config', () => {
    const synth = { play: vi.fn() };
    const a = new AudioDirector({ play: vi.fn(), has: () => false }, { synth });
    const b = new AudioDirector({ play: vi.fn(), has: () => false }, { synth: { play: vi.fn() } });
    for (let i = 0; i < 6; i++) {
      a.playEvent('KICK');
    }
    const rates = (synth.play.mock.calls as Array<[{ volume?: number; rate?: number }]>).map(
      ([, cfg]) => cfg?.rate,
    );
    // Variants repeat with the configured period and stay within the spread.
    expect(rates[0]).toBe(rates[3]);
    for (const r of rates) {
      expect(Math.abs((r ?? 1) - BALANCE_CONFIG.AUDIO.KICK.RATE)).toBeLessThanOrEqual(0.2);
    }
    void b;
  });
});

describe('B2-B WebAudioSynth (original synthesis, headless-guarded)', () => {
  it('advertises the synthesized keys and never throws without AudioContext', () => {
    const synth = new WebAudioSynth();
    expect(synth.has!('sfx_kick')).toBe(true);
    expect(synth.has!('nope')).toBe(false);
    expect(() => synth.play('sfx_kick')).not.toThrow();
    expect(() => synth.play('sfx_goal', { volume: 0.5, rate: 1.2 })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// B2-C: frame-time tracker
// ---------------------------------------------------------------------------

describe('B2-C FrameTimeTracker math', () => {
  it('tracks rolling avg/max over the configured window', () => {
    const t = new FrameTimeTracker(4);
    t.push(16);
    t.push(16);
    t.push(16);
    expect(t.avg).toBeCloseTo(16, 6);
    expect(t.max).toBeCloseTo(16, 6);
    t.push(32);
    expect(t.avg).toBeCloseTo(20, 6);
    expect(t.max).toBeCloseTo(32, 6);
    // Window rolls: the oldest 16 drops out.
    t.push(16);
    expect(t.avg).toBeCloseTo(20, 6);
    expect(t.count).toBe(4);
  });

  it('resets cleanly and ignores non-finite samples', () => {
    const t = new FrameTimeTracker(4);
    t.push(16);
    t.push(Number.NaN);
    t.push(Infinity);
    t.push(-5);
    expect(t.count).toBe(1);
    t.reset();
    expect(t.count).toBe(0);
    expect(t.avg).toBe(0);
    expect(t.max).toBe(0);
  });

  it('defaults the window from BALANCE_CONFIG.PERF', () => {
    const t = new FrameTimeTracker();
    expect(t.window).toBe(BALANCE_CONFIG.PERF.FRAME_TIME_WINDOW);
    expect(t.toLogString()).toContain('frame');
  });
});
