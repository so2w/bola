import { describe, it, expect } from 'vitest';
import { TeamCoordinator } from '../src/ai/TeamCoordinator';
import { PossessionSystem } from '../src/match/PossessionSystem';
import { FORMATIONS, anchorCoords, type FormationId } from '../src/data/formations';
import { mulberry32 } from '../src/utils/rng';
import { BALANCE_CONFIG } from '../src/data/balance';
import type { AICommand, EntitySnapshot, BallSnapshot } from '../src/ai/commands';

const AI = BALANCE_CONFIG.AI;
const PITCH_W = BALANCE_CONFIG.PHYSICS.PITCH_WIDTH;
const PITCH_H = BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT;

/** Snapshots in the same order as formation anchors (scene contract). */
function teamSnapshots(formationId: FormationId, side: 'home' | 'away'): EntitySnapshot[] {
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

function ballAt(x: number, y: number, z = 0, vx = 0, vy = 0): BallSnapshot {
  return { x, y, z, vx, vy };
}

function serialize(commands: Map<string, AICommand>): string {
  return JSON.stringify([...commands.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

describe('TeamCoordinator — tick cadence', () => {
  it('no recompute within the tick window; cached command instances returned', () => {
    const coord = new TeamCoordinator('home', FORMATIONS['3v3'], mulberry32(42));
    const snaps = teamSnapshots('3v3', 'home');
    const possession = new PossessionSystem();

    const map1 = coord.update(0, snaps, ballAt(100, 100), possession);
    const cmd1 = map1.get('home-1');

    const map2 = coord.update(50, snaps, ballAt(100, 100), possession);
    expect(map2).toBe(map1); // same Map instance
    expect(map2.get('home-1')).toBe(cmd1); // same command instance → no recompute

    const map3 = coord.update(150, snaps, ballAt(100, 100), possession);
    expect(map3.get('home-1')).not.toBe(cmd1); // recomputed after 150ms
  });

  it('ticks on the first update even at t=0', () => {
    const coord = new TeamCoordinator('home', FORMATIONS['3v3'], mulberry32(42));
    const commands = coord.update(0, teamSnapshots('3v3', 'home'), ballAt(100, 100), new PossessionSystem());
    expect(commands.size).toBeGreaterThan(0);
  });
});

describe('TeamCoordinator — press coordination (Fase 2 gate)', () => {
  it('5v3 ball at flank: ≤2 pressers every tick, rest within anchor tolerance over 10 sim-seconds', () => {
    const coord = new TeamCoordinator('home', FORMATIONS['5v5'], mulberry32(42));
    const snaps = teamSnapshots('5v5', 'home');
    const possession = new PossessionSystem();
    const anchors = anchorCoords(FORMATIONS['5v5'], 'home', PITCH_W, PITCH_H);

    let nowMs = 0;
    let ticks = 0;
    let maxPressers = 0;
    let maxAnchorDeviation = 0;

    for (let frame = 0; frame < Math.ceil(10_000 / 16); frame++) {
      nowMs += 16;
      const commands = coord.update(nowMs, snaps, ballAt(100, 100), possession);
      let pressers = 0;
      for (const [id, cmd] of commands) {
        if (cmd.action === 'PRESS') {
          pressers++;
        } else if (cmd.action === 'MOVE') {
          const idx = Number(id.split('-')[1]);
          const anchor = anchors[idx];
          const dev = Math.hypot(cmd.targetX - anchor.x, cmd.targetY - anchor.y);
          maxAnchorDeviation = Math.max(maxAnchorDeviation, dev);
        }
      }
      maxPressers = Math.max(maxPressers, pressers);
      ticks++;
    }

    expect(ticks).toBeGreaterThan(600);
    expect(maxPressers).toBeLessThanOrEqual(AI.PRESS_COUNT_MAX);
    expect(maxAnchorDeviation).toBeLessThanOrEqual(AI.ANCHOR_TOLERANCE_PX);
  });

  it('3v3: at most 2 pressers over 10 sim-seconds', () => {
    const coord = new TeamCoordinator('home', FORMATIONS['3v3'], mulberry32(42));
    const snaps = teamSnapshots('3v3', 'home');
    const possession = new PossessionSystem();

    let nowMs = 0;
    let maxPressers = 0;
    for (let frame = 0; frame < Math.ceil(10_000 / 16); frame++) {
      nowMs += 16;
      const commands = coord.update(nowMs, snaps, ballAt(100, 100), possession);
      let pressers = 0;
      for (const [, cmd] of commands) {
        if (cmd.action === 'PRESS') pressers++;
      }
      maxPressers = Math.max(maxPressers, pressers);
    }

    expect(maxPressers).toBeLessThanOrEqual(AI.PRESS_COUNT_MAX);
  });

  it('team possession → no pressers (structure holds)', () => {
    const coord = new TeamCoordinator('home', FORMATIONS['3v3'], mulberry32(42));
    const snaps = teamSnapshots('3v3', 'home');
    const possession = new PossessionSystem();

    // Ball right at the DF's feet → captured by home
    const commands = coord.update(0, snaps, ballAt(336, 270), possession);
    const pressers = [...commands.values()].filter((c) => c.action === 'PRESS');
    expect(pressers).toHaveLength(0);
  });
});

describe('TeamCoordinator — determinism (§29)', () => {
  it('10 runs with seed 42 and fixed inputs produce byte-identical command streams', () => {
    const streams: string[] = [];

    for (let run = 0; run < 10; run++) {
      const coord = new TeamCoordinator('home', FORMATIONS['5v5'], mulberry32(42));
      const possession = new PossessionSystem();
      // DF starts with the ball near the goal → SHOOT fires and consumes rng
      const snaps = teamSnapshots('5v5', 'home').map((s) =>
        s.role === 'DF' ? { ...s, x: 900 - 110, y: 270 } : s,
      );
      const parts: string[] = [];
      let nowMs = 0;
      for (let tick = 0; tick < 60; tick++) {
        nowMs += 150;
        const b = ballAt(nowMs === 150 ? 900 - 110 : 900 - 110 + tick * 10, 270, 0, 600, 0);
        const commands = coord.update(nowMs, snaps, b, possession);
        parts.push(serialize(commands));
      }
      streams.push(parts.join('|'));
    }

    expect(new Set(streams).size).toBe(1);
  });
});
