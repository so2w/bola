import { BALANCE_CONFIG } from '../data/balance';
import type { EntitySnapshot, BallSnapshot } from '../ai/commands';

/**
 * Explicit possession tracking (AGENTS.md §11): exactly one possessor or none.
 * Phaser-free: operates on plain snapshots, Vitest-testable.
 *
 * Rules:
 * - Capture only when ball.z <= possessableZ (high balls are not capturable)
 *   and a player is within captureRadiusPx.
 * - Possession is lost when the ball leaves controlRadiusPx of the holder or
 *   when the holder kicks (onKick), until a legal capture.
 */
export class PossessionSystem {
  public possessorId: string | null = null;

  private readonly captureRadiusPx: number;
  private readonly possessableZ: number;
  private readonly controlRadiusPx: number;

  constructor(cfg: {
    CAPTURE_RADIUS_PX: number;
    POSSESSABLE_Z: number;
    CONTROL_RADIUS_PX: number;
  } = BALANCE_CONFIG.AI) {
    this.captureRadiusPx = cfg.CAPTURE_RADIUS_PX;
    this.possessableZ = cfg.POSSESSABLE_Z;
    this.controlRadiusPx = cfg.CONTROL_RADIUS_PX;
  }

  /**
   * Updates possession state. Returns the current possessor id or null.
   */
  public update(dtMs: number, players: EntitySnapshot[], ball: BallSnapshot): string | null {
    void dtMs;

    // Validate current holder
    if (this.possessorId !== null) {
      const holder = players.find((p) => p.id === this.possessorId);
      if (!holder) {
        this.possessorId = null;
      } else {
        const dist = Math.hypot(holder.x - ball.x, holder.y - ball.y);
        if (dist > this.controlRadiusPx) {
          this.possessorId = null;
        }
      }
    }

    // Attempt capture when none and ball is possessable
    if (this.possessorId === null && ball.z <= this.possessableZ) {
      let best: EntitySnapshot | null = null;
      let bestDist = Infinity;
      for (const p of players) {
        const dist = Math.hypot(p.x - ball.x, p.y - ball.y);
        if (dist <= this.captureRadiusPx && dist < bestDist) {
          best = p;
          bestDist = dist;
        }
      }
      if (best !== null) {
        this.possessorId = best.id;
      }
    }

    return this.possessorId;
  }

  /** Clears possession without capture rules (external reset). */
  public clear(): void {
    this.possessorId = null;
  }

  /** Called when the possessor shoots or passes: possession clears until a legal capture. */
  public onKick(): void {
    this.possessorId = null;
  }
}
