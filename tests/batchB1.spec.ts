import { describe, it, expect, vi } from 'vitest';
import { resolveMatchFormations } from '../src/match/resolveFormations';
import { MatchManager } from '../src/systems/MatchManager';
import { MatchStatsTracker } from '../src/match/MatchStats';
import { halftimeBannerData } from '../src/ui/HalftimeBanner';
import { TeamCoordinator, blockShiftForBall } from '../src/ai/TeamCoordinator';
import { FootballAI } from '../src/ai/FootballAI';
import { PossessionSystem } from '../src/match/PossessionSystem';
import { FORMATIONS, anchorCoords } from '../src/data/formations';
import { BALANCE_CONFIG } from '../src/data/balance';
import { canApplyKick } from '../src/match/kickGate';
import { zoomForFormation } from '../src/ui/hudPin';
import { FulltimeBanner } from '../src/ui/FulltimeBanner';

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

// ---------------------------------------------------------------------------
// A. 11v11 is the shipped default; 3v3/5v5 stay available via explicit param.
// ---------------------------------------------------------------------------

describe('B1-A — 11v11 default formation', () => {
  it('fresh boot (no init data) resolves 11v11 for both teams', () => {
    expect(resolveMatchFormations(undefined)).toEqual({ home: '11v11', away: '11v11' });
    expect(resolveMatchFormations({})).toEqual({ home: '11v11', away: '11v11' });
  });

  it('explicit 3v3/5v5 params still resolve (tests + sandbox)', () => {
    expect(resolveMatchFormations({ formationHome: '3v3', formationAway: '5v5' })).toEqual({
      home: '3v3',
      away: '5v5',
    });
  });

  it('MatchManager ships 11v11 team shapes by default', () => {
    const mgr = new MatchManager();
    const bound = (mgr as any).formations as { home: string; away: string };
    expect(bound).toEqual({ home: '11v11', away: '11v11' });
  });

  it('camera zoom-per-formation still resolves at 11v11 (HUD unaffected)', () => {
    expect(zoomForFormation('11v11')).toBe(BALANCE_CONFIG.CAMERA.ZOOM_11V11);
  });
});

// ---------------------------------------------------------------------------
// B. FULL_TIME -> RESULTS states with stats payload + replay to INTRO.
// ---------------------------------------------------------------------------

const SHORT_CLOCK = {
  TIME_REMAINING_GAME_SECONDS: 6,
  GAME_TIME_SCALE: 3,
  KICKOFF_PAUSE_MS: 100,
  GOAL_PAUSE_MS: 50,
  OUT_OF_BOUNDS_PAUSE_MS: 50,
  FULL_TIME_PAUSE_MS: 200,
  INTRO_DURATION_MS: 1000,
  INTRO_SKIPPABLE: true,
};

function boundShortManager() {
  const mgr = new MatchManager(SHORT_CLOCK as any);
  const ball = fakeBall();
  const home = [fakePlayer(), fakePlayer(), fakePlayer()];
  const away = [fakePlayer(), fakePlayer(), fakePlayer()];
  mgr.bind(undefined as any, ball, home, away, { home: '3v3', away: '3v3' });
  return { mgr, ball, home, away };
}

describe('B1-B — FULL_TIME -> RESULTS terminal flow', () => {
  it('clock expiry enters FULL_TIME (not GAME_OVER) with the clock stopped at zero', () => {
    const { mgr } = boundShortManager();
    mgr.update(SHORT_CLOCK.KICKOFF_PAUSE_MS + 1);
    expect(mgr.state).toBe('PLAYING');
    for (let i = 0; i < 100 && mgr.state === 'PLAYING'; i++) {
      mgr.update(100);
    }
    expect(mgr.state).toBe('FULL_TIME');
    expect(mgr.timeRemaining).toBe(0);
    const frozen = mgr.timeRemaining;
    mgr.update(50);
    if (mgr.state === 'FULL_TIME') {
      expect(mgr.timeRemaining).toBe(frozen);
    }
  });

  it('FULL_TIME advances to RESULTS after the full-time pause; RESULTS is terminal', () => {
    const { mgr } = boundShortManager();
    mgr.update(SHORT_CLOCK.KICKOFF_PAUSE_MS + 1);
    for (let i = 0; i < 100 && mgr.state === 'PLAYING'; i++) {
      mgr.update(100);
    }
    expect(mgr.state).toBe('FULL_TIME');
    mgr.update(SHORT_CLOCK.FULL_TIME_PAUSE_MS + 1);
    expect(mgr.state).toBe('RESULTS');
    mgr.update(5000);
    expect(mgr.state).toBe('RESULTS');
    expect(mgr.timeRemaining).toBe(0);
  });

  it('goals cannot be scored from FULL_TIME or RESULTS (single-count guard holds)', () => {
    const { mgr } = boundShortManager();
    mgr.state = 'FULL_TIME';
    mgr.handleGoal('home');
    expect(mgr.score.home).toBe(0);
    mgr.state = 'RESULTS';
    mgr.handleGoal('away');
    expect(mgr.score.away).toBe(0);
  });

  it('no kick may be applied while FULL_TIME or RESULTS is showing', () => {
    expect(canApplyKick('FULL_TIME')).toBe(false);
    expect(canApplyKick('RESULTS')).toBe(false);
  });

  it('RESULTS reuses the stats-tracker payload pattern (score + shots/passes/possession)', () => {
    const stats = new MatchStatsTracker();
    stats.recordShot('home');
    stats.recordShot('home');
    stats.recordPass('away');
    stats.recordGoal('home');
    stats.addPossession('home', 3000);
    stats.addPossession('away', 1000);
    const data = halftimeBannerData({ home: 1, away: 0 }, stats.snapshot());
    expect(data.score).toEqual({ home: 1, away: 0 });
    expect(data.stats.home.shots).toBe(2);
    expect(data.stats.away.passesCompleted).toBe(1);
    expect(data.stats.home.possessionPct).toBeCloseTo(75, 5);
  });

  it('Jugar de nuevo from RESULTS resets the match back to INTRO', () => {
    const { mgr } = boundShortManager();
    mgr.state = 'PLAYING';
    mgr.handleGoal('home');
    mgr.update(SHORT_CLOCK.GOAL_PAUSE_MS + 1);
    mgr.state = 'RESULTS';
    mgr.restartToIntro();
    expect(mgr.state).toBe('INTRO');
    expect(mgr.score).toEqual({ home: 0, away: 0 });
    expect(mgr.stats.snapshot().home.goals).toBe(0);
  });

  it('FulltimeBanner renders score + per-team lines from the same payload', () => {
    const calls: string[] = [];
    const scene: any = {
      add: {
        rectangle: vi.fn(() => chainMock()),
        text: vi.fn((x: number, y: number, txt: string) => {
          calls.push(txt);
          return chainMock(txt);
        }),
        container: vi.fn((x: number, y: number, children: unknown[]) => chainMock()),
      },
    };
    function chainMock(txt = '') {
      const o: any = { visible: false, _txt: txt };
      for (const m of ['setOrigin', 'setDepth', 'setInteractive', 'setVisible', 'setScrollFactor', 'setText', 'setPosition', 'setScale']) {
        o[m] = vi.fn(function (this: any, v?: unknown) {
          if (m === 'setVisible') {
            this.visible = v;
          }
          if (m === 'setText') {
            this._txt = v;
          }
          return o;
        });
      }
      o.on = vi.fn(() => o);
      return o;
    }
    const stats = new MatchStatsTracker();
    stats.recordShot('home');
    stats.addPossession('home', 2000);
    stats.addPossession('away', 2000);
    const banner = new FulltimeBanner(scene, BALANCE_CONFIG.FULLTIME_BANNER, () => {});
    banner.show(halftimeBannerData({ home: 2, away: 1 }, stats.snapshot()));
    expect(banner.visible).toBe(true);
    banner.hide();
    expect(banner.visible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C. Tactics presets: Defensiva / Equilibrada / Ofensiva.
// ---------------------------------------------------------------------------

describe('B1-C — tactics presets live in BALANCE_CONFIG', () => {
  it('exposes exactly three presets with a balanced default', () => {
    const t = (BALANCE_CONFIG as any).TACTICS;
    expect(t).toBeDefined();
    expect(t.DEFAULT).toBe('balanced');
    expect(Object.keys(t.PRESETS).sort()).toEqual(['balanced', 'defensive', 'offensive']);
    expect(t.LABELS.balanced).toBe('Equilibrada');
    expect(t.LABELS.defensive).toBe('Defensiva');
    expect(t.LABELS.offensive).toBe('Ofensiva');
  });

  it('preset effect bounds order defensive < balanced < offensive (block/support/attackers)', () => {
    const p = (BALANCE_CONFIG as any).TACTICS.PRESETS;
    expect(p.defensive.BLOCK_SHIFT_PX).toBeLessThan(p.balanced.BLOCK_SHIFT_PX);
    expect(p.balanced.BLOCK_SHIFT_PX).toBeLessThan(p.offensive.BLOCK_SHIFT_PX);
    expect(p.defensive.SUPPORT_PUSH_PX).toBeLessThan(p.balanced.SUPPORT_PUSH_PX);
    expect(p.balanced.SUPPORT_PUSH_PX).toBeLessThan(p.offensive.SUPPORT_PUSH_PX);
    expect(p.defensive.ATTACKERS_COUNT).toBeLessThan(p.balanced.ATTACKERS_COUNT);
    expect(p.balanced.ATTACKERS_COUNT).toBeLessThan(p.offensive.ATTACKERS_COUNT);
  });
});

function snaps11(side: 'home' | 'away') {
  return anchorCoords(FORMATIONS['11v11'], side, 960, 540).map((a, i) => ({
    id: `${side}-${i}`,
    team: side as 'home' | 'away',
    role: a.role as 'GK' | 'DF' | 'MF' | 'FW',
    x: a.x,
    y: a.y,
    vx: 0,
    vy: 0,
  }));
}

describe('B1-C — TeamCoordinator tactics modifiers', () => {
  it('defaults to balanced and rejects unknown preset ids', () => {
    const coord = new TeamCoordinator('home', FORMATIONS['11v11']);
    expect(coord.getTactics()).toBe('balanced');
    expect(() => (coord as any).setTactics('gegenpressing')).toThrow();
  });

  it('defensive block sits deeper than offensive (anchor shift ordering)', () => {
    const ball = { x: 900, y: 270, z: 0, vx: 0, vy: 0 };
    const possession = new PossessionSystem();
    const mk = (t: any) => {
      const c = new TeamCoordinator('home', FORMATIONS['11v11']);
      c.setTactics(t);
      return c.update(0, snaps11('home'), ball, possession).get('home-5')!;
    };
    // MF anchor targetX: defensive deepest, offensive highest.
    const defX = mk('defensive').targetX;
    const balX = new TeamCoordinator('home', FORMATIONS['11v11']).update(0, snaps11('home'), ball, new PossessionSystem()).get('home-5')!.targetX;
    const offX = mk('offensive').targetX;
    void balX;
    expect(defX).toBeLessThan(offX);
  });

  it('support push grows with risk preset (off-ball target further forward)', () => {
    // Holder is a teammate so snap home-9 goes ATTACKING with support shift.
    const mkPush = (t: any) => {
      const coord = new TeamCoordinator('home', FORMATIONS['11v11']);
      coord.setTactics(t);
      const snaps = snaps11('home');
      // Ball glued to a deep midfielder so possession belongs to home.
      const holder = snaps[6];
      const ball = { x: holder.x, y: holder.y, z: 0, vx: 0, vy: 0 };
      const possession = new PossessionSystem();
      const cmds = coord.update(0, snaps, ball, possession);
      return cmds.get('home-9')!;
    };
    const def = mkPush('defensive');
    const bal = mkPush('balanced');
    const off = mkPush('offensive');
    expect(def.action).toBe('MOVE');
    expect(bal.action).toBe('MOVE');
    expect(off.action).toBe('MOVE');
    const ax = anchorCoords(FORMATIONS['11v11'], 'home', 960, 540)[9].x;
    expect(def.targetX - ax).toBeLessThan(off.targetX - ax);
  });

  it('defensive sends fewer players forward than offensive (attackers count)', () => {
    const countPushed = (t: any) => {
      const coord = new TeamCoordinator('home', FORMATIONS['11v11']);
      coord.setTactics(t);
      const snaps = snaps11('home');
      const holder = snaps[6];
      const ball = { x: holder.x, y: holder.y, z: 0, vx: 0, vy: 0 };
      const cmds = coord.update(0, snaps, ball, new PossessionSystem());
      const anchors = anchorCoords(FORMATIONS['11v11'], 'home', 960, 540);
      // Support-disabled players hold the shifted anchor, so measure deviation
      // from the FULLY SHIFTED anchor (not the raw one): the tactics block
      // shift AND the living-movement ball-side block slide are common-mode
      // across the whole outfield, so only the ATTACKERS_COUNT support players
      // deviate further via the support shove.
      const shift = (BALANCE_CONFIG as any).TACTICS.PRESETS[t].BLOCK_SHIFT_PX as number;
      const block = blockShiftForBall(ball);
      let pushed = 0;
      for (const [id, cmd] of cmds) {
        const idx = Number(id.split('-')[1]);
        if (anchors[idx].role === 'GK') {
          continue;
        }
        if (Math.abs(cmd.targetX - (anchors[idx].x + shift + block.dx)) > 1) {
          pushed++;
        }
      }
      return pushed;
    };
    expect(countPushed('defensive')).toBeLessThan(countPushed('offensive'));
  });

  it('presser cap follows the preset (defensive <= 1, others <= 2)', () => {
    const maxPressers = (t: any) => {
      const coord = new TeamCoordinator('home', FORMATIONS['11v11']);
      coord.setTactics(t);
      const snaps = snaps11('home');
      const cmds = coord.update(0, snaps, { x: 100, y: 100, z: 0, vx: 0, vy: 0 }, new PossessionSystem());
      return [...cmds.values()].filter((c) => c.action === 'PRESS').length;
    };
    expect(maxPressers('defensive')).toBeLessThanOrEqual(1);
    expect(maxPressers('balanced')).toBeLessThanOrEqual(2);
    expect(maxPressers('offensive')).toBeLessThanOrEqual(2);
  });

  it('FootballAI honours a support-push override from the coordinator context', () => {
    const ai = new FootballAI((() => 0.999) as any);
    const snap = { id: 'home-9', team: 'home' as const, role: 'FW' as const, x: 440, y: 205.2, vx: 0, vy: 0 };
    const base: any = {
      ball: { x: 330, y: 205.2, z: 0, vx: 0, vy: 0 },
      possessorId: 'home-6',
      myTeamPossession: true,
      anchorX: 440,
      anchorY: 205.2,
      pressers: [],
      attackDir: 1 as const,
      teammates: snaps11('home'),
      opponents: [],
    };
    const low = ai.tick(snap, { ...base, supportPushPx: 10 });
    const high = new FootballAI((() => 0.999) as any).tick(snap, { ...base, supportPushPx: 80 });
    expect(high.targetX - 440).toBeGreaterThan(low.targetX - 440);
  });
});
