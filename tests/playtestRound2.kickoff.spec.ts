import { describe, expect, it } from 'vitest';
import { MatchManager } from '../src/systems/MatchManager';
import { TeamCoordinator } from '../src/ai/TeamCoordinator';
import { FootballAI } from '../src/ai/FootballAI';
import { PossessionSystem } from '../src/match/PossessionSystem';
import { anchorCoords, resolveFormation } from '../src/data/formations';
import { BALANCE_CONFIG } from '../src/data/balance';
import {
  aimsIntoOwnHalf,
  gateKickCommand,
  isKickoffGraceActive,
} from '../src/match/kickGate';
import { mulberry32 } from '../src/utils/rng';
import type { BallSnapshot, EntitySnapshot } from '../src/ai/commands';

// ---------------------------------------------------------------------------
// Playtest round 2 (fase 4): kickoff auto-goal + jitter repro harness.
//
// This mirrors MatchScene.update wiring headlessly with the REAL domain
// classes (MatchManager, TeamCoordinator, FootballAI, GoalkeeperAI via
// tickGK, PossessionSystem, kickGate). Physics are the Arcade semantics the
// game actually relies on: bodies keep `Player.maxSpeed` toward the command
// target (no arrival damping unless the controller provides it) and the ball
// keeps its impulse (no drag curve in Ball — friction only acts on contact).
//
// Instrumented: every applied kick and every handleGoal call is logged with
// the cause, so a future regression names the exact path instead of "weird".
// ---------------------------------------------------------------------------

const W = BALANCE_CONFIG.PHYSICS.PITCH_WIDTH;
const H = BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT;
const DT = 16;
const SPEED = BALANCE_CONFIG.PHYSICS.PLAYER_MAX_SPEED;

/** Goal zones exactly as MatchScene.create wires them. */
const GOAL = {
  left: { xMin: 0, xMax: 40, yMin: 200, yMax: 340, scorer: 'away' as const },
  right: { xMin: 920, xMax: 960, yMin: 200, yMax: 340, scorer: 'home' as const },
};

interface SimEntity extends EntitySnapshot {
  setPosition(x: number, y: number): void;
  sprite: { x: number; y: number };
}

interface KickLog {
  t: number;
  playerId: string;
  action: string;
  dirX: number;
  dirY: number;
}

interface GoalLog {
  t: number;
  scorer: 'home' | 'away';
  /** Seconds since the most recent transition into PLAYING. */
  sinceResumeMs: number;
  lastKick: KickLog | null;
}

function makeEntity(id: string, team: 'home' | 'away', role: EntitySnapshot['role'], x: number, y: number): SimEntity {
  const e: SimEntity = {
    id,
    team,
    role,
    x,
    y,
    vx: 0,
    vy: 0,
    sprite: { x, y },
    setPosition(nx: number, ny: number) {
      this.x = nx;
      this.y = ny;
      this.sprite.x = nx;
      this.sprite.y = ny;
    },
  };
  return e;
}

function makeBall() {
  const b: any = {
    x: W / 2,
    y: H / 2,
    z: 0,
    zTarget: 0,
    vx: 0,
    vy: 0,
    sprite: {
      x: W / 2,
      y: H / 2,
      setPosition(px: number, py: number) {
        b.sprite.x = px;
        b.sprite.y = py;
        b.x = px;
        b.y = py;
      },
    },
    body: { setVelocity: () => undefined },
    reset() {
      this.sprite.setPosition(W / 2, H / 2);
      this.z = 0;
      this.zTarget = 0;
      this.vx = 0;
      this.vy = 0;
    },
  };
  return b;
}

function snapOf(e: SimEntity): EntitySnapshot {
  return { id: e.id, team: e.team, role: e.role, x: e.x, y: e.y, vx: e.vx, vy: e.vy };
}

function ballSnapOf(b: ReturnType<typeof makeBall>): BallSnapshot {
  return { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy };
}

interface SimOptions {
  /** ms of simulated match time to run (includes the opening KICKOFF pause). */
  durationMs: number;
}

interface SimResult {
  goals: GoalLog[];
  kicks: KickLog[];
  /** Per-player count of horizontal velocity sign flips while PLAYING. */
  flipsX: Map<string, number>;
  playResumes: number[];
  finalState: string;
}

/**
 * Headless kickoff sim. Human is idle: no human kicks, no selection effects.
 * Reproduces MatchScene update order: manager first, coordinators + possession
 * every frame, per-frame GK tick, command application only when PLAYING, ball
 * integration, goal-zone overlap check, kick-gate hygiene on ->KICKOFF.
 */
function simulateKickoff({ durationMs }: SimOptions): SimResult {
  const slots = resolveFormation('3v3');
  const homeCoords = anchorCoords(slots, 'home', W, H);
  const awayCoords = anchorCoords(slots, 'away', W, H);
  const home = homeCoords.map((a, i) => makeEntity(`home-${i}`, 'home', a.role, a.x, a.y));
  const away = awayCoords.map((a, i) => makeEntity(`away-${i}`, 'away', a.role, a.x, a.y));

  const mgr = new MatchManager();
  const ball = makeBall();
  // Bind real manager to the same mutable position stores (reset moves them).
  mgr.bind(undefined as any, ball, home, away, { home: '3v3', away: '3v3' });

  const possession = new PossessionSystem();
  const coordHome = new TeamCoordinator('home', slots, mulberry32(11));
  const coordAway = new TeamCoordinator('away', slots, mulberry32(22));

  const goals: GoalLog[] = [];
  const kicks: KickLog[] = [];
  const playResumes: number[] = [];
  const flipsX = new Map<string, number>();
  const prevSignX = new Map<string, number>();
  let playResumedAt: number | null = null;
  let prevState = mgr.state;

  // MatchScene mirrors: attempt a kick through the SAME gate helpers.
  // Phase 2 closure: production Player.shootWithPower ignores re-kicks within
  // PLAYER_KICK_DURATION_MS (kickTimer guard) — the harness models the same
  // cooldown so a cached PASS command does not machine-gun every frame.
  const lastKickAt = new Map<string, number>();
  const tryKick = (e: SimEntity, cmd: { targetX: number; targetY: number; action: string; power?: number }) => {
    if (cmd.action !== 'SHOOT' && cmd.action !== 'PASS' && cmd.action !== 'DISTRIBUTE') {
      return;
    }
    const attackDir: 1 | -1 = e.team === 'home' ? 1 : -1;
    // Kickoff grace (playtest round 2): own-half SHOOTs fizzle into a HOLD.
    if (
      cmd.action === 'SHOOT' &&
      isKickoffGraceActive(playResumedAt, nowMs) &&
      aimsIntoOwnHalf(attackDir, cmd.targetX - e.x)
    ) {
      return;
    }
    const facing = gateKickCommand(mgr.state, cmd, { x: e.x, y: e.y }, ballSnapOf(ball));
    if (!facing) {
      return;
    }
    const lastAt = lastKickAt.get(e.id) ?? -Infinity;
    if (nowMs - lastAt < BALANCE_CONFIG.PHYSICS.PLAYER_KICK_DURATION_MS) {
      return;
    }
    lastKickAt.set(e.id, nowMs);
    const power = Math.max(cmd.power ?? 0.3, 0);
    if (power < BALANCE_CONFIG.PHYSICS.BALL_MIN_KICK_THRESHOLD) {
      return;
    }
    // Ball.applyKick semantics: velocity = facing * power * BALL_MAX_IMPULSE.
    ball.vx = facing.x * power * BALANCE_CONFIG.PHYSICS.BALL_MAX_IMPULSE;
    ball.vy = facing.y * power * BALANCE_CONFIG.PHYSICS.BALL_MAX_IMPULSE;
    ball.zTarget = power * BALANCE_CONFIG.PHYSICS.BALL_MAX_Z;
    possession.onKick();
    kicks.push({ t: nowMs, playerId: e.id, action: cmd.action, dirX: facing.x, dirY: facing.y });
  };

  let nowMs = 0;
  while (nowMs < durationMs && mgr.state !== 'GAME_OVER') {
    nowMs += DT;
    mgr.update(DT);

    if (prevState !== 'PLAYING' && mgr.state === 'PLAYING') {
      playResumedAt = nowMs;
      playResumes.push(nowMs);
    }
    prevState = mgr.state;

    const homeSnaps = home.map(snapOf);
    const awaySnaps = away.map(snapOf);
    const bSnap = ballSnapOf(ball);

    possession.update(DT, [...homeSnaps, ...awaySnaps], bSnap);
    const homeCmds = coordHome.update(nowMs, homeSnaps, bSnap, possession);
    const awayCmds = coordAway.update(nowMs, awaySnaps, bSnap, possession);

    // Per-frame GK evaluation (same as MatchScene).
    for (const [snaps, opp, coord, dir] of [
      [homeSnaps, awaySnaps, coordHome, 1],
      [awaySnaps, homeSnaps, coordAway, -1],
    ] as const) {
      const gk = snaps.find((s) => s.role === 'GK');
      if (gk) {
        coord.tickGK(DT, gk, {
          ball: bSnap,
          teammates: snaps.filter((s) => s.role !== 'GK'),
          opponents: opp,
          attackDir: dir as 1 | -1,
        });
      }
    }

    // Command application — only during live play (canPlay equivalent).
    if (mgr.state === 'PLAYING') {
      for (const e of [...home, ...away]) {
        const cmd = (e.team === 'home' ? homeCmds : awayCmds).get(e.id);
        if (!cmd) {
          e.vx = 0;
          e.vy = 0;
          continue;
        }
        const dx = cmd.targetX - e.x;
        const dy = cmd.targetY - e.y;
        const len = Math.hypot(dx, dy);
        // Phase 2 closure: production AIController damps inside
        // ARRIVAL_RADIUS_PX and wanders at-target instead of overrunning.
        // The harness models arrival as a stop so support-shift targets
        // (anchor + ~50px) do not oscillate through the target every frame.
        if (len <= BALANCE_CONFIG.AI.ARRIVAL_RADIUS_PX) {
          e.vx = 0;
          e.vy = 0;
        } else if (len > 0) {
          e.vx = (dx / len) * SPEED;
          e.vy = (dy / len) * SPEED;
        } else {
          e.vx = 0;
          e.vy = 0;
        }
        const step = SPEED * (DT / 1000);
        e.x += e.vx * (DT / 1000);
        e.y += e.vy * (DT / 1000);
        e.sprite.x = e.x;
        e.sprite.y = e.y;
        void step;
        tryKick(e, cmd);

        // Jitter measurement: velocity direction sign flips (x axis).
        const sign = Math.abs(e.vx) > 1 ? Math.sign(e.vx) : 0;
        const prev = prevSignX.get(e.id) ?? 0;
        if (sign !== 0 && prev !== 0 && sign !== prev) {
          flipsX.set(e.id, (flipsX.get(e.id) ?? 0) + 1);
        }
        if (sign !== 0) {
          prevSignX.set(e.id, sign);
        }
      }

      // Ball integration (frictionless between contacts, as Ball bodies are).
      ball.x += ball.vx * (DT / 1000);
      ball.y += ball.vy * (DT / 1000);
      ball.sprite.x = ball.x;
      ball.sprite.y = ball.y;
      ball.zTarget = ball.zTarget > 0 ? ball.zTarget * 0.92 : 0;
      ball.z = Math.max(0, ball.z + (ball.zTarget - ball.z) * 0.15);

      // Goal-zone overlap BEFORE out-of-bounds classification (stabilityHarness order).
      const inMouth = ball.y >= GOAL.left.yMin && ball.y <= GOAL.left.yMax;
      if (inMouth && ball.x >= GOAL.left.xMin && ball.x <= GOAL.left.xMax) {
        goals.push({
          t: nowMs,
          scorer: 'away',
          sinceResumeMs: playResumedAt === null ? Infinity : nowMs - playResumedAt,
          lastKick: kicks.length > 0 ? kicks[kicks.length - 1] : null,
        });
        mgr.handleGoal('away');
      } else if (inMouth && ball.x >= GOAL.right.xMin && ball.x <= GOAL.right.xMax) {
        goals.push({
          t: nowMs,
          scorer: 'home',
          sinceResumeMs: playResumedAt === null ? Infinity : nowMs - playResumedAt,
          lastKick: kicks.length > 0 ? kicks[kicks.length - 1] : null,
        });
        mgr.handleGoal('home');
      }
    }
  }

  return { goals, kicks, flipsX, playResumes, finalState: mgr.state };
}

describe('playtest round 2 — kickoff auto-goal (TASK 1)', () => {
  it('no goal within the first 2000ms of PLAYING after kickoff with teams at anchors and idle human', () => {
    const result = simulateKickoff({ durationMs: 20000 });
    expect(result.finalState).not.toBe('BOOT');
    // The exact regression: right after the kickoff whistle, nobody may score.
    const early = result.goals.filter((g) => g.sinceResumeMs <= 2000);
    expect(
      early.map((g) => `${g.scorer} at ${g.sinceResumeMs}ms via ${g.lastKick?.playerId ?? 'no-kick'} ${g.lastKick?.action ?? ''}`),
    ).toEqual([]);
    // Stronger: with an idle human, no SHOOT/DISTRIBUTE should be applied in
    // the window. Phase 2 closure: AI PASS is expected (holder utility
    // SHOOT > PASS > DRIBBLE) — short passes do not score directly and the
    // no-early-goal assertion above guards the real regression.
    const kicksEarly = result.kicks.filter((k) => k.t - result.playResumes[0] <= 2000);
    expect(kicksEarly.filter((k) => k.action !== 'PASS')).toEqual([]);
  });

  it('no goal in the 2000ms window after ANY resume (kickoff or restart)', () => {
    const result = simulateKickoff({ durationMs: 20000 });
    for (const g of result.goals) {
      expect(g.sinceResumeMs).toBeGreaterThan(2000);
    }
  });

  it('identical runs are deterministic (no new RNG sources)', () => {
    const a = simulateKickoff({ durationMs: 8000 });
    const b = simulateKickoff({ durationMs: 8000 });
    expect(a.goals).toEqual(b.goals);
    expect(a.kicks).toEqual(b.kicks);
  });

  it('kickGate helpers: grace blocks own-half SHOOT, allows attacking SHOOT', () => {
    const resumedAt = 1500;
    expect(isKickoffGraceActive(resumedAt, resumedAt + 500)).toBe(true);
    expect(isKickoffGraceActive(resumedAt, resumedAt + BALANCE_CONFIG.MATCH.KICKOFF_GRACE_MS + 1)).toBe(false);
    expect(isKickoffGraceActive(null, 5000)).toBe(false);

    // A home kick toward x<kicker (own half, left) is flagged; a forward one is not.
    expect(aimsIntoOwnHalf(1, -50)).toBe(true);
    expect(aimsIntoOwnHalf(1, 50)).toBe(false);
    expect(aimsIntoOwnHalf(-1, 50)).toBe(true);
    expect(aimsIntoOwnHalf(-1, -50)).toBe(false);
  });
});

describe('playtest round 2 — jitter (TASK 3)', () => {
  it('no player flips horizontal velocity more than 3 times/sec after kickoff', () => {
    const WINDOW = 3000;
    const result = simulateKickoff({ durationMs: BALANCE_CONFIG.MATCH.KICKOFF_PAUSE_MS + WINDOW + 200 });
    const report = [...result.flipsX.entries()].map(([id, flips]) => `${id}:${flips}`);
    for (const [, flips] of result.flipsX) {
      expect(flips, `flips per player over ${WINDOW}ms [${report.join(', ')}]`).toBeLessThanOrEqual(
        3 * (WINDOW / 1000),
      );
    }
  });
});

describe('playtest round 2 — jitter sources (unit level)', () => {
  function snapAt(id: string, team: 'home' | 'away', x: number, y: number): EntitySnapshot {
    return { id, team, role: 'FW', x, y, vx: 0, vy: 0 };
  }
  const ballSnap = (x: number, y: number): BallSnapshot => ({ x, y, z: 0, vx: 0, vy: 0 });

  it('BALL_HOLDER keeps dribbling target through a transient possession-null window (grace)', () => {
    const ai = new FootballAI(mulberry32(1));
    const snap = snapAt('home-2', 'home', 600, 270);
    const ball = ballSnap(600, 270);
    // Capture: holder.
    const c1 = ai.tick(snap, {
      ball, possessorId: 'home-2', myTeamPossession: true,
      anchorX: 595, anchorY: 270, pressers: [], attackDir: 1, nowMs: 0,
    });
    expect(c1.targetX).toBeGreaterThan(800); // attacking goal target
    // Transient null possession (holder stepped out of control radius for a few frames).
    const c2 = ai.tick(
      { ...snap, x: 610 },
      {
        ball, possessorId: null, myTeamPossession: false,
        anchorX: 595, anchorY: 270, pressers: ['home-2'], attackDir: 1, nowMs: 100,
      },
    );
    // Without grace this flips to PRESS(target=ball) — a 180° direction flip.
    expect(c2.targetX).toBeGreaterThan(800);
    expect(c2.targetY).toBe(270);
  });

  it('BALL_HOLDER grace ends: after BALL_HOLDER_GRACE_MS without possession, normal FSM resumes', () => {
    const ai = new FootballAI(mulberry32(1));
    const snap = snapAt('home-2', 'home', 600, 270);
    const ball = ballSnap(600, 270);
    ai.tick(snap, {
      ball, possessorId: 'home-2', myTeamPossession: true,
      anchorX: 595, anchorY: 270, pressers: [], attackDir: 1, nowMs: 0,
    });
    const grace = BALANCE_CONFIG.AI.BALL_HOLDER_GRACE_MS;
    const c2 = ai.tick(
      { ...snap, x: 610 },
      {
        ball, possessorId: null, myTeamPossession: false,
        anchorX: 595, anchorY: 270, pressers: ['home-2'], attackDir: 1, nowMs: grace + 1,
      },
    );
    expect(c2.action).toBe('PRESS'); // back to chasing the loose ball
    expect(c2.targetX).toBe(600);
  });

  it('coordinator keeps a current presser unless the challenger beats it by PRESS_SWITCH_MARGIN_PX', () => {
    const slots = resolveFormation('5v5');
    const coord = new TeamCoordinator('away', slots, mulberry32(3));
    const possession = new PossessionSystem();
    const ball = ballSnap(500, 270);
    const base: EntitySnapshot[] = [
      { id: 'away-0', team: 'away', role: 'GK', x: 902, y: 270, vx: 0, vy: 0 },
      { id: 'away-1', team: 'away', role: 'DF', x: 550, y: 270, vx: 0, vy: 0 },
      { id: 'away-2', team: 'away', role: 'DF', x: 560, y: 270, vx: 0, vy: 0 },
      { id: 'away-3', team: 'away', role: 'MF', x: 700, y: 270, vx: 0, vy: 0 },
      { id: 'away-4', team: 'away', role: 'FW', x: 720, y: 270, vx: 0, vy: 0 },
    ];
    // Tick 1: away-1 (50px) closest field player, away-2 (60px) second.
    coord.update(0, base, ball, possession);
    const press1 = coord.update(BALANCE_CONFIG.AI.TICK_MS + 1, base, ball, possession);
    expect(press1.get('away-1')?.action).toBe('PRESS');
    expect(press1.get('away-2')?.action).toBe('PRESS');
    // Tick 2: away-3 moves to 48px (closer than away-1) but NOT by more than the
    // switch margin — the presser set must stay stable (no PRESS <-> anchor flip).
    const moved: EntitySnapshot[] = base.map((s) =>
      s.id === 'away-3' ? { ...s, x: 548 } : s,
    );
    const press2 = coord.update(BALANCE_CONFIG.AI.TICK_MS * 2 + 2, moved, ball, possession);
    expect(press2.get('away-1')?.action).toBe('PRESS');
    expect(press2.get('away-2')?.action).toBe('PRESS');
    expect(press2.get('away-3')?.action).not.toBe('PRESS');
    // Tick 3: away-3 decisively closest (beyond margin) -> it MAY swap in.
    const decisive: EntitySnapshot[] = base.map((s) =>
      s.id === 'away-3' ? { ...s, x: 520 } : s, // dist 20: beats worst presser (60) beyond the margin
    );
    const press3 = coord.update(BALANCE_CONFIG.AI.TICK_MS * 3 + 3, decisive, ball, possession);
    expect(press3.get('away-3')?.action).toBe('PRESS');
  });
});
