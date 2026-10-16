import { describe, it, expect } from 'vitest';
import { FootballAI } from '../src/ai/FootballAI';
import { TeamCoordinator, blockShiftForBall } from '../src/ai/TeamCoordinator';
import { PossessionSystem } from '../src/match/PossessionSystem';
import { FORMATIONS, anchorCoords } from '../src/data/formations';
import { mulberry32 } from '../src/utils/rng';
import { BALANCE_CONFIG } from '../src/data/balance';
import type { EntitySnapshot, BallSnapshot, MatchContext } from '../src/ai/commands';

// Living movement batch (AGENTS.md section 11 — shape preserved):
// ball-side block shift, recovery/attack runs on turnovers, idle sway and
// defensive tracking. Every behavior is config-bounded; the team shape
// (relative positions) must survive them all.
const AI = BALANCE_CONFIG.AI;
const PITCH_W = BALANCE_CONFIG.PHYSICS.PITCH_WIDTH;
const PITCH_H = BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT;

type AiCfg = typeof AI & Record<string, number>;

function snap(id: string, x: number, y: number, role: EntitySnapshot['role'] = 'DF'): EntitySnapshot {
  return { id, team: 'home', role, x, y, vx: 0, vy: 0 };
}

function ballAt(x: number, y: number): BallSnapshot {
  return { x, y, z: 0, vx: 0, vy: 0 };
}

function defCtx(over: Partial<MatchContext> = {}): MatchContext {
  return {
    ball: ballAt(480, 270),
    possessorId: null,
    myTeamPossession: false,
    anchorX: 336,
    anchorY: 270,
    pressers: [],
    attackDir: 1,
    nowMs: 1000,
    opponents: [],
    teammates: [],
    ...over,
  };
}

function snaps11(side: 'home' | 'away'): EntitySnapshot[] {
  return anchorCoords(FORMATIONS['11v11'], side, PITCH_W, PITCH_H).map((a, i) => ({
    id: `${side}-${i}`,
    team: side,
    role: a.role,
    x: a.x,
    y: a.y,
    vx: 0,
    vy: 0,
  }));
}

// ---------------------------------------------------------------------------
// A. Ball-side block shift — whole outfield slides with the ball, bounded.
// ---------------------------------------------------------------------------

describe('living movement A — block-shift config knobs', () => {
  it('exposes per-axis weights, per-axis maxima and the DF goal-side margin', () => {
    const rec = AI as AiCfg;
    for (const k of [
      'AI_BLOCK_SHIFT_X_WEIGHT',
      'AI_BLOCK_SHIFT_Y_WEIGHT',
      'AI_BLOCK_SHIFT_MAX_X_PX',
      'AI_BLOCK_SHIFT_MAX_Y_PX',
      'AI_BLOCK_SHIFT_GOAL_SIDE_MARGIN_PX',
    ]) {
      expect(typeof rec[k], `AI.${k}`).toBe('number');
      expect(rec[k] > 0, `AI.${k} positive`).toBe(true);
    }
    expect(AI.AI_BLOCK_SHIFT_X_WEIGHT).toBeLessThanOrEqual(1);
    expect(AI.AI_BLOCK_SHIFT_Y_WEIGHT).toBeLessThanOrEqual(1);
  });
});

describe('living movement A — block slides toward the ball side', () => {
  it('ball on the bottom wing drags every outfield target down (+y), bounded by MAX_Y', () => {
    const coord = new TeamCoordinator('home', FORMATIONS['11v11'], mulberry32(1));
    const snaps = snaps11('home');
    const cmds = coord.update(0, snaps, ballAt(480, 500), new PossessionSystem());
    const anchors = anchorCoords(FORMATIONS['11v11'], 'home', PITCH_W, PITCH_H);
    // Pressers leave the block to chase the ball (press discipline); the
    // slide assertion covers the players holding the shape.
    for (const [id, cmd] of cmds) {
      const idx = Number(id.split('-')[1]);
      if (anchors[idx].role === 'GK' || cmd.action === 'PRESS') {
        continue;
      }
      const dy = cmd.targetY - anchors[idx].y;
      expect(dy, `${id} slides down`).toBeGreaterThan(0);
      expect(dy, `${id} bounded`).toBeLessThanOrEqual(AI.AI_BLOCK_SHIFT_MAX_Y_PX + AI.AI_IDLE_SWAY_RADIUS_PX + 1e-6);
    }
  });

  it('ball on the top wing drags every outfield target up (-y)', () => {
    const coord = new TeamCoordinator('home', FORMATIONS['11v11'], mulberry32(1));
    const snaps = snaps11('home');
    const cmds = coord.update(0, snaps, ballAt(480, 40), new PossessionSystem());
    const anchors = anchorCoords(FORMATIONS['11v11'], 'home', PITCH_W, PITCH_H);
    for (const [id, cmd] of cmds) {
      const idx = Number(id.split('-')[1]);
      if (anchors[idx].role === 'GK' || cmd.action === 'PRESS') {
        continue;
      }
      expect(cmd.targetY - anchors[idx].y, `${id} slides up`).toBeLessThan(0);
    }
  });

  it('block shift matches the exported pure helper and preserves lines (common-mode within sway diameter)', () => {
    const b = ballAt(480, 500);
    const shift = blockShiftForBall(b);
    expect(Math.abs(shift.dx)).toBeLessThanOrEqual(AI.AI_BLOCK_SHIFT_MAX_X_PX + 1e-6);
    expect(Math.abs(shift.dy)).toBeLessThanOrEqual(AI.AI_BLOCK_SHIFT_MAX_Y_PX + 1e-6);
    // Deterministic pure helper: same ball always yields the same shift.
    expect(blockShiftForBall(b)).toEqual(shift);

    const coord = new TeamCoordinator('home', FORMATIONS['11v11'], mulberry32(1));
    const cmds = coord.update(0, snaps11('home'), b, new PossessionSystem());
    const anchors = anchorCoords(FORMATIONS['11v11'], 'home', PITCH_W, PITCH_H);
    const shifts: Array<{ x: number; y: number }> = [];
    for (const [id, cmd] of cmds) {
      const idx = Number(id.split('-')[1]);
      if (anchors[idx].role === 'GK' || cmd.action === 'PRESS') {
        continue;
      }
      shifts.push({ x: cmd.targetX - anchors[idx].x, y: cmd.targetY - anchors[idx].y });
    }
    const meanX = shifts.reduce((a, s) => a + s.x, 0) / shifts.length;
    const meanY = shifts.reduce((a, s) => a + s.y, 0) / shifts.length;
    // Lines stay compact: individual spots differ from the common slide only
    // by per-player life (sway/tracking), never by a second tactical shift.
    const swayD = AI.AI_IDLE_SWAY_RADIUS_PX * 2 + AI.AI_TRACK_MAX_SHIFT_PX;
    for (const s of shifts) {
      expect(Math.abs(s.x - meanX)).toBeLessThanOrEqual(swayD + 1e-6);
      expect(Math.abs(s.y - meanY)).toBeLessThanOrEqual(swayD + 1e-6);
    }
    // The common slide follows the ball side.
    expect(meanY).toBeGreaterThan(0);
  });

  it('defenders never cross to the attacking side of the ball while shifting', () => {
    const coord = new TeamCoordinator('home', FORMATIONS['11v11'], mulberry32(1));
    const b = ballAt(120, 270);
    const cmds = coord.update(0, snaps11('home'), b, new PossessionSystem());
    const anchors = anchorCoords(FORMATIONS['11v11'], 'home', PITCH_W, PITCH_H);
    const margin = AI.AI_BLOCK_SHIFT_GOAL_SIDE_MARGIN_PX;
    // Pressers chase the ball carrier by design (they leave the block); the
    // rail governs the shape-holding defenders. Sway breathes around the
    // railed spot, so the bound carries the sway radius.
    for (const [id, cmd] of cmds) {
      const idx = Number(id.split('-')[1]);
      if (anchors[idx].role !== 'DF' || cmd.action === 'PRESS') {
        continue;
      }
      // attackDir 1 attacks +x, so goal-side means smaller x than the ball.
      expect(cmd.targetX, `${id} stays goal-side`).toBeLessThanOrEqual(
        b.x - margin + AI.AI_IDLE_SWAY_RADIUS_PX + 1e-6,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// B. Recovery runs on loss, attack runs in behind on win.
// ---------------------------------------------------------------------------

describe('living movement B — turnover config knobs', () => {
  it('exposes recovery/attack-run windows, counts, depths and speeds', () => {
    const rec = AI as AiCfg;
    for (const k of [
      'AI_RECOVERY_WINDOW_MS',
      'AI_RECOVERY_COUNT',
      'AI_RECOVERY_DEPTH_PX',
      'AI_RECOVERY_SPEED_FACTOR',
      'AI_ATTACK_RUN_WINDOW_MS',
      'AI_ATTACK_RUN_COUNT',
      'AI_ATTACK_RUN_EXTRA_PUSH_PX',
    ]) {
      expect(typeof rec[k], `AI.${k}`).toBe('number');
      expect(rec[k] > 0, `AI.${k} positive`).toBe(true);
    }
    expect(AI.AI_RECOVERY_SPEED_FACTOR).toBeGreaterThan(1);
  });
});

describe('living movement B — recovery sprint on possession loss', () => {
  it('FootballAI: recoveryRun targets goal-side of the anchor at sprint pace', () => {
    const ai = new FootballAI(mulberry32(5));
    const me = snap('home-2', 336, 270);
    const cmd = ai.tick(me, defCtx({ recoveryRun: true }));
    // attackDir 1: own goal is -x, so goal-side means behind the anchor.
    expect(cmd.targetX).toBeLessThan(336);
    const depth = 336 - cmd.targetX;
    expect(depth).toBeLessThanOrEqual(AI.AI_RECOVERY_DEPTH_PX + AI.AI_IDLE_SWAY_RADIUS_PX + 1e-6);
    expect(depth).toBeGreaterThan(0);
    expect(cmd.speedFactor).toBeCloseTo(AI.AI_RECOVERY_SPEED_FACTOR, 6);
  });

  it('coordinator: losing possession sends the nearest non-pressers goal-side, press cap holds', () => {
    const coord = new TeamCoordinator('home', FORMATIONS['11v11'], mulberry32(9));
    const snaps = snaps11('home');
    const holder = snaps[6];
    // Tick 1: ball glued to a home midfielder -> home possession.
    coord.update(0, snaps, ballAt(holder.x, holder.y), new PossessionSystem());
    // Tick 2+3: ball far from every home shirt -> possession lost.
    const possession = new PossessionSystem();
    coord.update(150, snaps, ballAt(100, 100), possession);
    const cmds = coord.update(300, snaps, ballAt(100, 100), possession);

    const anchors = anchorCoords(FORMATIONS['11v11'], 'home', PITCH_W, PITCH_H);
    const pressers = new Set([...cmds.entries()].filter(([, c]) => c.action === 'PRESS').map(([id]) => id));
    expect(pressers.size).toBeLessThanOrEqual(2);
    // Recovery pace is exactly RECOVERY_SPEED_FACTOR; the holder-grace
    // dribble (1.1 boost) never matches it, so equality identifies runners.
    const runners = [...cmds.entries()].filter(
      ([, c]) => Math.abs((c.speedFactor ?? 1) - AI.AI_RECOVERY_SPEED_FACTOR) < 1e-9,
    );
    expect(runners.length).toBeGreaterThanOrEqual(1);
    expect(runners.length).toBeLessThanOrEqual(AI.AI_RECOVERY_COUNT);
    for (const [id, cmd] of runners) {
      expect(pressers.has(id), `${id} is not a presser`).toBe(false);
      const idx = Number(id.split('-')[1]);
      expect(cmd.targetX, `${id} sprints goal-side`).toBeLessThan(anchors[idx].x);
    }
  });
});

describe('living movement B — attackers break in behind on possession win', () => {
  it('FootballAI: attackRun pushes visibly further forward, still MAX_SHIFT clamped', () => {
    const me = snap('home-9', 440, 205.2, 'FW');
    const holder = snap('home-6', 330, 205.2, 'MF');
    const base = defCtx({
      possessorId: 'home-6',
      myTeamPossession: true,
      anchorX: 440,
      anchorY: 205.2,
      teammates: [holder, me],
      opponents: [],
    });
    const plain = new FootballAI(mulberry32(3)).tick(me, base);
    const plainDev = Math.hypot(plain.targetX - 440, plain.targetY - 205.2);
    const run = new FootballAI(mulberry32(3)).tick(me, { ...base, attackRun: true });
    const runDev = Math.hypot(run.targetX - 440, run.targetY - 205.2);
    expect(runDev).toBeGreaterThan(plainDev);
    expect(runDev).toBeLessThanOrEqual(AI.AI_SUPPORT_MAX_SHIFT_PX + 1e-6);
    expect(run.targetX).toBeGreaterThan(440);
  });

  it('coordinator: winning possession produces a bounded forward break (no shape collapse)', () => {
    const coord = new TeamCoordinator('home', FORMATIONS['11v11'], mulberry32(9));
    const snaps = snaps11('home');
    const holder = snaps[6];
    const possession = new PossessionSystem();
    // Tick 1: loose ball, no possession. Tick 2: ball glued home -> won.
    coord.update(0, snaps, ballAt(100, 100), possession);
    const cmds = coord.update(150, snaps, ballAt(holder.x, holder.y), possession);

    const anchors = anchorCoords(FORMATIONS['11v11'], 'home', PITCH_W, PITCH_H);
    let maxDev = 0;
    for (const [id, cmd] of cmds) {
      const idx = Number(id.split('-')[1]);
      if (anchors[idx].role === 'GK') {
        continue;
      }
      const dev = Math.hypot(cmd.targetX - anchors[idx].x, cmd.targetY - anchors[idx].y);
      maxDev = Math.max(maxDev, dev);
      expect(dev, `${id} stays in shape`).toBeLessThanOrEqual(
        AI.AI_SUPPORT_MAX_SHIFT_PX + AI.AI_BLOCK_SHIFT_MAX_X_PX + AI.AI_BLOCK_SHIFT_MAX_Y_PX + 1e-6,
      );
    }
    // Visible break: someone pushes beyond the base support shove.
    expect(maxDev).toBeGreaterThan(AI.AI_SUPPORT_PUSH_PX);
  });
});

// ---------------------------------------------------------------------------
// C. Idle life — bounded sway, never statues, never drifting out of shape.
// ---------------------------------------------------------------------------

describe('living movement C — idle-sway config knobs', () => {
  it('exposes sway radius + period', () => {
    expect(typeof AI.AI_IDLE_SWAY_RADIUS_PX).toBe('number');
    expect(AI.AI_IDLE_SWAY_RADIUS_PX).toBeGreaterThan(0);
    expect(typeof AI.AI_IDLE_SWAY_PERIOD_MS).toBe('number');
    expect(AI.AI_IDLE_SWAY_PERIOD_MS).toBeGreaterThan(0);
  });
});

describe('living movement C — nobody statuesque, nobody lost', () => {
  it('idle targets breathe within the sway radius over N seconds and stay alive', () => {
    const ai = new FootballAI(mulberry32(5));
    const me = snap('home-2', 336, 270);
    const seen = new Set<string>();
    let maxDev = 0;
    for (let t = 0; t < 4000; t += 150) {
      const cmd = ai.tick(me, defCtx({ nowMs: t }));
      seen.add(`${cmd.targetX.toFixed(3)},${cmd.targetY.toFixed(3)}`);
      maxDev = Math.max(maxDev, Math.hypot(cmd.targetX - 336, cmd.targetY - 270));
    }
    // Alive: the spot moves over time instead of freezing on the anchor.
    expect(seen.size).toBeGreaterThan(1);
    // Bounded: never drifts out of shape.
    expect(maxDev).toBeLessThanOrEqual(AI.AI_IDLE_SWAY_RADIUS_PX + 1e-6);
  });

  it('sway is deterministic: same player + same instant -> identical target', () => {
    const a = new FootballAI(mulberry32(5)).tick(snap('home-2', 336, 270), defCtx({ nowMs: 1234 }));
    const b = new FootballAI(mulberry32(99)).tick(snap('home-2', 336, 270), defCtx({ nowMs: 1234 }));
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// D. Defensive tracking — goal-side of the mark, positioning only.
// ---------------------------------------------------------------------------

describe('living movement D — tracking config knobs', () => {
  it('exposes blend weight, goal-side offset, sense radius and max shift', () => {
    const rec = AI as AiCfg;
    for (const k of ['AI_TRACK_WEIGHT', 'AI_TRACK_GOAL_SIDE_PX', 'AI_TRACK_RADIUS_PX', 'AI_TRACK_MAX_SHIFT_PX']) {
      expect(typeof rec[k], `AI.${k}`).toBe('number');
      expect(rec[k] > 0, `AI.${k} positive`).toBe(true);
    }
    expect(AI.AI_TRACK_WEIGHT).toBeGreaterThan(0);
    expect(AI.AI_TRACK_WEIGHT).toBeLessThanOrEqual(1);
  });
});

describe('living movement D — non-pressers shade goal-side of threats', () => {
  it('DF with a threat ahead tucks between anchor and goal-side-of-mark, bounded', () => {
    const ai = new FootballAI(mulberry32(5));
    const me = snap('home-2', 336, 270);
    const threat: EntitySnapshot = { id: 'away-9', team: 'away', role: 'FW', x: 400, y: 270, vx: 0, vy: 0 };
    const cmd = ai.tick(me, defCtx({ opponents: [threat] }));
    // Pulled toward the threat but never past its goal-side point.
    expect(cmd.targetX).toBeGreaterThan(336);
    expect(cmd.targetX).toBeLessThanOrEqual(400 - AI.AI_TRACK_GOAL_SIDE_PX + AI.AI_IDLE_SWAY_RADIUS_PX + 1e-6);
    const dev = Math.hypot(cmd.targetX - 336, cmd.targetY - 270);
    expect(dev).toBeLessThanOrEqual(AI.AI_TRACK_MAX_SHIFT_PX + AI.AI_IDLE_SWAY_RADIUS_PX + 1e-6);
  });

  it('distant threats do not drag the defender out of shape (sense radius)', () => {
    const ai = new FootballAI(mulberry32(5));
    const me = snap('home-2', 336, 270);
    const far: EntitySnapshot = { id: 'away-9', team: 'away', role: 'FW', x: 800, y: 100, vx: 0, vy: 0 };
    const cmd = ai.tick(me, defCtx({ opponents: [far] }));
    const dev = Math.hypot(cmd.targetX - 336, cmd.targetY - 270);
    expect(dev).toBeLessThanOrEqual(AI.AI_IDLE_SWAY_RADIUS_PX + 1e-6);
  });
});

// ---------------------------------------------------------------------------
// E. Invariants — spread never collapses, spots never oscillate.
// ---------------------------------------------------------------------------

describe('living movement E — no convergence at 11v11', () => {
  it('10 sim-seconds: team spread holds and at most 2 sit near the ball', () => {
    const coord = new TeamCoordinator('home', FORMATIONS['11v11'], mulberry32(42));
    const possession = new PossessionSystem();
    const locomotor = new FootballAI(mulberry32(1));
    const snaps = snaps11('home').map((s) => ({ ...s }));
    const b = ballAt(100, 100);
    const anchors = anchorCoords(FORMATIONS['11v11'], 'home', PITCH_W, PITCH_H).filter((a) => a.role !== 'GK');
    const anchorBoxW =
      Math.max(...anchors.map((a) => a.x)) - Math.min(...anchors.map((a) => a.x));
    const anchorBoxH =
      Math.max(...anchors.map((a) => a.y)) - Math.min(...anchors.map((a) => a.y));

    let maxNearBall = 0;
    let minBoxAreaRatio = Infinity;
    for (let frame = 0; frame < Math.ceil(10_000 / 16); frame++) {
      const nowMs = (frame + 1) * 16;
      const commands = coord.update(nowMs, snaps, b, possession);
      let nearBall = 0;
      for (const s of snaps) {
        if (s.role !== 'GK' && Math.hypot(s.x - b.x, s.y - b.y) <= 40) {
          nearBall++;
        }
      }
      maxNearBall = Math.max(maxNearBall, nearBall);
      const outfield = snaps.filter((s) => s.role !== 'GK');
      const boxW = Math.max(...outfield.map((s) => s.x)) - Math.min(...outfield.map((s) => s.x));
      const boxH = Math.max(...outfield.map((s) => s.y)) - Math.min(...outfield.map((s) => s.y));
      minBoxAreaRatio = Math.min(minBoxAreaRatio, (boxW * boxH) / (anchorBoxW * anchorBoxH));
      for (const [id, cmd] of commands) {
        const s = snaps.find((x) => x.id === id);
        if (!s) {
          continue;
        }
        const v = locomotor.applyLocomotion(cmd, s);
        s.x += (v.vx * 16) / 1000;
        s.y += (v.vy * 16) / 1000;
      }
    }
    expect(maxNearBall).toBeLessThanOrEqual(2);
    // Shape never collapses: the block keeps at least a quarter of its box.
    expect(minBoxAreaRatio).toBeGreaterThan(0.25);
  });
});

describe('living movement E — no oscillation frame-to-frame', () => {
  it('static scene: consecutive-tick spot targets move at most the sway radius', () => {
    const coord = new TeamCoordinator('home', FORMATIONS['11v11'], mulberry32(3));
    const snaps = snaps11('home');
    const possession = new PossessionSystem();
    const b = ballAt(480, 270);
    let prev = new Map([...coord.update(0, snaps, b, possession).entries()].map(([k, v]) => [k, { ...v }]));
    for (let tick = 1; tick <= 10; tick++) {
      const nowMs = tick * 150;
      const cur = coord.update(nowMs, snaps, b, possession);
      for (const [id, cmd] of cur) {
        const p = prev.get(id);
        if (!p) {
          continue;
        }
        const delta = Math.hypot(cmd.targetX - p.targetX, cmd.targetY - p.targetY);
        expect(delta, `${id} stable tick ${tick}`).toBeLessThanOrEqual(AI.AI_IDLE_SWAY_RADIUS_PX + 1e-6);
      }
      prev = new Map([...cur.entries()].map(([k, v]) => [k, { ...v }]));
    }
  });
});
