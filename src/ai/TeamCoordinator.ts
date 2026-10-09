import { BALANCE_CONFIG } from '../data/balance';
import { anchorCoords, type FormationSlot } from '../data/formations';
import { PossessionSystem } from '../match/PossessionSystem';
import { FootballAI } from './FootballAI';
import { GoalkeeperAI } from './GoalkeeperAI';
import { mulberry32, type Rng } from '../utils/rng';
import type { AICommand, BallSnapshot, EntitySnapshot, TeamSide } from './commands';

/**
 * Team-level blackboard coordinator (AGENTS.md §11).
 *
 * - Field-player decisions run at the coordinator cadence (aiTickMs, ~150ms =
 *   6.7Hz); between ticks the SAME cached command instances are returned.
 * - Assigns at most PRESS_COUNT_MAX pressers (nearest, deterministic tie-break);
 *   the rest hold formation anchors.
 * - The GK is NOT ticked here: MatchScene calls tickGK(...) every frame
 *   (design 3.0 — dive reachability vs 600px/s shots requires per-frame
 *   evaluation; a 150ms cadence would eat the dive window).
 * - Snapshots must be built in the same order as formation anchors
 *   (positional correspondence snaps[i] ↔ anchors[i]).
 * - Deterministic: injected seeded RNG, no Math.random.
 */
export class TeamCoordinator {
  private lastTickMs = -Infinity;
  private readonly commands = new Map<string, AICommand>();
  private readonly fieldAIs = new Map<string, FootballAI>();
  private readonly gkAI = new GoalkeeperAI();
  private pressers: string[] = [];

  constructor(
    private readonly teamId: TeamSide,
    private readonly formation: FormationSlot[],
    private readonly rng: Rng = mulberry32(1),
  ) {}

  public update(
    nowMs: number,
    snaps: EntitySnapshot[],
    ball: BallSnapshot,
    possession: PossessionSystem,
  ): Map<string, AICommand> {
    if (nowMs - this.lastTickMs < BALANCE_CONFIG.AI.TICK_MS) {
      return this.commands; // cached, no recompute
    }
    this.lastTickMs = nowMs;
    this.tickInternal(nowMs, snaps, ball, possession);
    return this.commands;
  }

  /**
   * Per-frame GK evaluation (design 3.0 CRITICAL): called every frame by
   * MatchScene, NEVER inside the coordinator cadence. Updates the GK entry in
   * the commands map (same Map instance returned by update()).
   */
  public tickGK(
    dtMs: number,
    gk: EntitySnapshot,
    ctx: { ball: BallSnapshot; teammates: EntitySnapshot[]; opponents: EntitySnapshot[]; attackDir: 1 | -1 },
  ): AICommand {
    const cmd = this.gkAI.tick(dtMs, gk, ctx);
    this.commands.set(gk.id, cmd);
    return cmd;
  }

  private tickInternal(
    _nowMs: number,
    snaps: EntitySnapshot[],
    ball: BallSnapshot,
    possession: PossessionSystem,
  ): void {
    const cfg = BALANCE_CONFIG.AI;

    // Possession update (pure, idempotent — MatchScene also updates per frame)
    const possessorId = possession.update(cfg.TICK_MS, snaps, ball);
    const possessor = possessorId !== null ? snaps.find((s) => s.id === possessorId) : undefined;
    const myTeamPossession = possessor !== undefined && possessor.team === this.teamId;

    // Press assignment: at most PRESS_COUNT_MAX nearest field players
    const anchors = anchorCoords(this.formation, this.teamId, BALANCE_CONFIG.PHYSICS.PITCH_WIDTH, BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT);
    if (myTeamPossession) {
      this.pressers = [];
    } else {
      const candidates = snaps.filter((s) => s.role !== 'GK');
      const sorted = [...candidates].sort((a, b) => {
        const da = Math.hypot(a.x - ball.x, a.y - ball.y);
        const db = Math.hypot(b.x - ball.x, b.y - ball.y);
        if (da !== db) {
          return da - db;
        }
        return a.id.localeCompare(b.id); // deterministic tie-break
      });
      this.pressers = sorted.slice(0, cfg.PRESS_COUNT_MAX).map((s) => s.id);
    }

    // Per-player FSM ticks (GK excluded — tickGK handles it per frame)
    const attackDir: 1 | -1 = this.teamId === 'home' ? 1 : -1;
    snaps.forEach((snap, i) => {
      if (snap.role === 'GK') {
        return;
      }
      if (!this.fieldAIs.has(snap.id)) {
        this.fieldAIs.set(snap.id, new FootballAI(this.rng));
      }
      const ai = this.fieldAIs.get(snap.id) as FootballAI;
      const anchor = anchors[i];
      const cmd = ai.tick(snap, {
        ball,
        possessorId,
        myTeamPossession,
        anchorX: anchor.x,
        anchorY: anchor.y,
        pressers: this.pressers,
        attackDir,
      });
      this.commands.set(snap.id, cmd);
    });
  }
}
