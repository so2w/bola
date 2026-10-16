import { describe, it, expect, vi } from 'vitest';
import { MatchManager } from '../src/systems/MatchManager';
import { MatchStatsTracker } from '../src/match/MatchStats';
import {
  EntranceWalk,
  entranceStarts,
  type EntranceWalkConfig,
} from '../src/match/EntranceSystem';
import { halftimeBannerData } from '../src/ui/HalftimeBanner';
import { kickoffAnchors } from '../src/match/restartPlacement';
import { BALANCE_CONFIG } from '../src/data/balance';

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
    b.sprite.x = 480;
    b.sprite.y = 270;
    b.z = 0;
    b.zTarget = 0;
  });
  return b;
}

const INTRO_CLOCK = {
  TIME_REMAINING_GAME_SECONDS: 60,
  GAME_TIME_SCALE: 3,
  KICKOFF_PAUSE_MS: 100,
  GOAL_PAUSE_MS: 50,
  OUT_OF_BOUNDS_PAUSE_MS: 50,
  HALF_PAUSE_MS: 500,
  INTRO_DURATION_MS: 1000,
  INTRO_SKIPPABLE: true,
};

function boundIntroManager(clock = INTRO_CLOCK) {
  const mgr = new MatchManager(clock);
  const ball = fakeBall();
  const home = [fakePlayer(), fakePlayer(), fakePlayer()];
  const away = [fakePlayer(), fakePlayer(), fakePlayer()];
  mgr.bind(undefined as any, ball, home, away, { home: '3v3', away: '3v3' });
  return { mgr, ball, home, away };
}

describe('batchA — INTRO state: enter, timeout, skip', () => {
  it('enterIntro puts the manager in INTRO; timeout advances to KICKOFF', () => {
    const { mgr } = boundIntroManager();
    mgr.enterIntro();
    expect(mgr.state).toBe('INTRO');
    mgr.update(INTRO_CLOCK.INTRO_DURATION_MS + 1);
    expect(mgr.state).toBe('KICKOFF');
  });

  it('skipIntro jumps to KICKOFF when skippable', () => {
    const { mgr } = boundIntroManager();
    mgr.enterIntro();
    const skipped = mgr.skipIntro();
    expect(skipped).toBe(true);
    expect(mgr.state).toBe('KICKOFF');
  });

  it('skipIntro is ignored when INTRO_SKIPPABLE is false', () => {
    const { mgr } = boundIntroManager({ ...INTRO_CLOCK, INTRO_SKIPPABLE: false });
    mgr.enterIntro();
    const skipped = mgr.skipIntro();
    expect(skipped).toBe(false);
    expect(mgr.state).toBe('INTRO');
  });

  it('default manager stays KICKOFF (legacy clocks unaffected)', () => {
    const mgr = new MatchManager();
    expect(mgr.state).toBe('KICKOFF');
  });
});

describe('batchA — entrance walk arrives within budget', () => {
  it('off-pitch starts reach kickoff anchors before the INTRO timeout', () => {
    const E = BALANCE_CONFIG.ENTRANCE;
    const W = BALANCE_CONFIG.PHYSICS.PITCH_WIDTH;
    const H = BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT;
    const targets = kickoffAnchors('3v3', 'home').map((a) => ({ x: a.x, y: a.y }));
    const starts = entranceStarts(targets.length, W, H, E.ENTRANCE_Y_OFFSET_PX);
    // Starts are off-pitch (below the sideline).
    for (const s of starts) {
      expect(s.y).toBeGreaterThan(H);
    }
    const cfg: EntranceWalkConfig = {
      WALK_SPEED_PX_S: E.ENTRANCE_WALK_SPEED_PX_S,
      ARRIVE_RADIUS_PX: E.ENTRANCE_ARRIVE_RADIUS_PX,
    };
    const walk = new EntranceWalk(starts, targets, cfg);
    const stepMs = 16;
    let elapsed = 0;
    while (!walk.allArrived() && elapsed < E.INTRO_TIMEOUT_MS) {
      walk.update(stepMs);
      elapsed += stepMs;
    }
    expect(walk.allArrived()).toBe(true);
    expect(elapsed).toBeLessThanOrEqual(E.INTRO_TIMEOUT_MS);
  });
});

describe('batchA — stats tracker + banner data', () => {
  it('records shots, passes, goals and possession with correct percentages', () => {
    const stats = new MatchStatsTracker();
    stats.recordShot('home');
    stats.recordShot('home');
    stats.recordPass('away');
    stats.recordGoal('home');
    stats.addPossession('home', 3000);
    stats.addPossession('away', 1000);
    const snap = stats.snapshot();
    expect(snap.home.shots).toBe(2);
    expect(snap.away.passesCompleted).toBe(1);
    expect(snap.home.goals).toBe(1);
    expect(stats.possessionPct('home')).toBeCloseTo(75, 5);
    expect(stats.possessionPct('away')).toBeCloseTo(25, 5);
  });

  it('reset clears every counter', () => {
    const stats = new MatchStatsTracker();
    stats.recordShot('home');
    stats.recordGoal('away');
    stats.addPossession('home', 500);
    stats.reset();
    const snap = stats.snapshot();
    expect(snap.home.shots).toBe(0);
    expect(snap.away.goals).toBe(0);
    expect(stats.possessionPct('home')).toBe(50);
  });

  it('halftimeBannerData carries score + stats for the banner', () => {
    const stats = new MatchStatsTracker();
    stats.recordShot('home');
    stats.recordPass('home');
    stats.addPossession('home', 2000);
    stats.addPossession('away', 2000);
    const data = halftimeBannerData({ home: 2, away: 1 }, stats.snapshot());
    expect(data.score.home).toBe(2);
    expect(data.score.away).toBe(1);
    expect(data.stats.home.shots).toBe(1);
    expect(data.stats.home.passesCompleted).toBe(1);
    expect(data.stats.home.possessionPct).toBe(50);
  });

  it('manager stats reset on restart; goals flow through handleGoal', () => {
    const { mgr } = boundIntroManager();
    mgr.state = 'PLAYING';
    mgr.handleGoal('home');
    expect(mgr.stats.snapshot().home.goals).toBe(1);
    expect(mgr.score.home).toBe(1);
    // RULE-2: restart is ignored during the GOAL celebration — let it settle.
    mgr.update(INTRO_CLOCK.GOAL_PAUSE_MS + 1);
    expect(mgr.state).toBe('KICKOFF');
    mgr.recordShot('away');
    mgr.restart();
    expect(mgr.score.home).toBe(0);
    expect(mgr.stats.snapshot().home.goals).toBe(0);
    expect(mgr.stats.snapshot().away.shots).toBe(0);
  });
});

describe('batchA — HALF resume still swaps (existing contract)', () => {
  it('resumeSecondHalf swaps sides and resumes KICKOFF', () => {
    const mgr = new MatchManager({
      TIME_REMAINING_GAME_SECONDS: 60,
      GAME_TIME_SCALE: 3,
      KICKOFF_PAUSE_MS: 100,
      GOAL_PAUSE_MS: 50,
      OUT_OF_BOUNDS_PAUSE_MS: 50,
      HALF_PAUSE_MS: 500,
    });
    const ball = fakeBall();
    const home = [fakePlayer(), fakePlayer(), fakePlayer()];
    const away = [fakePlayer(), fakePlayer(), fakePlayer()];
    mgr.bind(undefined as any, ball, home, away, { home: '3v3', away: '3v3' });
    mgr.update(101);
    for (let i = 0; i < 500 && mgr.state !== 'HALF'; i++) {
      mgr.update(100);
    }
    expect(mgr.state).toBe('HALF');
    mgr.resumeSecondHalf();
    expect(mgr.state).toBe('KICKOFF');
    expect(mgr.sidesSwapped).toBe(true);
  });

  it('restartToIntro performs a full reset back to INTRO', () => {
    const { mgr } = boundIntroManager();
    mgr.state = 'PLAYING';
    mgr.handleGoal('away');
    mgr.recordShot('home');
    mgr.sidesSwapped = true;
    mgr.restartToIntro();
    expect(mgr.score.home).toBe(0);
    expect(mgr.score.away).toBe(0);
    expect(mgr.sidesSwapped).toBe(false);
    expect(mgr.state).toBe('INTRO');
    expect(mgr.stats.snapshot().home.shots).toBe(0);
  });
});
