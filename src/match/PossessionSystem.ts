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
  /** Pass-receiver hint (playtest round 3): widened capture radius, TTL. */
  private passHint: { x: number; y: number; expiresAtMs: number } | null = null;
  private timeMs = 0;

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
    this.timeMs += dtMs;
    if (this.passHint !== null && this.timeMs > this.passHint.expiresAtMs) {
      this.passHint = null;
    }

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
      // The intended pass receiver traps with the wider control radius so a
      // pass played to feet is actually received (possession hint).
      let hintedId: string | null = null;
      if (this.passHint !== null) {
        let hintDist = Infinity;
        for (const p of players) {
          const d = Math.hypot(p.x - this.passHint.x, p.y - this.passHint.y);
          if (d < hintDist || (d === hintDist && hintedId !== null && p.id < hintedId)) {
            hintDist = d;
            hintedId = p.id;
          }
        }
      }
      let best: EntitySnapshot | null = null;
      let bestDist = Infinity;
      for (const p of players) {
        const radius = p.id === hintedId ? this.controlRadiusPx : this.captureRadiusPx;
        const dist = Math.hypot(p.x - ball.x, p.y - ball.y);
        if (dist <= radius && dist < bestDist) {
          best = p;
          bestDist = dist;
        }
      }
      if (best !== null) {
        this.possessorId = best.id;
        if (best.id === hintedId) {
          this.passHint = null; // consumed by the intended receiver
        }
      }
    }

    return this.possessorId;
  }

  /**
   * Pass feel (playtest round 3): hints the receiver's position so the next
   * capture near the target uses the wider control radius. Auto-expires.
   */
  public setPassHint(target: { x: number; y: number }, ttlMs = BALANCE_CONFIG.INPUT.PASS_HINT_MS): void {
    this.passHint = { x: target.x, y: target.y, expiresAtMs: this.timeMs + ttlMs };
  }

  /** Clears possession without capture rules (external reset). */
  public clear(): void {
    this.possessorId = null;
  }

  /**
   * Assigns possession directly (BallCaptureSystem physical interception).
   * The next update() validates the holder is still within control radius.
   */
  public setPossessor(id: string): void {
    this.possessorId = id;
  }

  /** Called when the possessor shoots or passes: possession clears until a legal capture. */
  public onKick(): void {
    this.possessorId = null;
  }
}
