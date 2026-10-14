import { BALANCE_CONFIG } from '../data/balance';
import type { BallSnapshot, EntitySnapshot } from '../ai/commands';

/**
 * Physical ball interception (playtest round 3): the ball must NEVER visually
 * cross a player's sprite without an event. PossessionSystem captures only a
 * standing ball inside a tight radius; this system instead evaluates the
 * ball's motion segment each frame and traps it on a player's body.
 *
 * Rules (all values from BALANCE_CONFIG):
 * - Balls above AI.INTERCEPT_MAX_Z fly over players and are never trapped.
 * - Field players trap only balls arriving slower than AI.TRAP_MAX_SPEED_PX_S
 *   (hard shots beat outfielders — that is what the keeper is for).
 * - The GK claims ANY ball whose segment passes within GK.CLAIM_RADIUS_PX,
 *   regardless of speed (CLAIM/BLOCK in the keeper FSM).
 * - Deterministic: the player whose body comes closest to the flight segment
 *   wins; ties break by entity id.
 *
 * Phaser-free, snapshot-driven, Vitest-testable.
 */
export interface CaptureEvent {
  playerId: string;
  /** True when the trap kills the ball's momentum (sticky trap / GK claim). */
  stopBall: boolean;
}

export class BallCaptureSystem {
  private readonly trapMaxSpeed: number;
  private readonly interceptMaxZ: number;
  private readonly fieldRadiusPx: number;
  private readonly gkRadiusPx: number;

  constructor(
    cfg: { TRAP_MAX_SPEED_PX_S: number; INTERCEPT_MAX_Z: number; CAPTURE_RADIUS_PX: number } = BALANCE_CONFIG.AI,
    gkCfg: { CLAIM_RADIUS_PX: number } = BALANCE_CONFIG.GK,
  ) {
    this.trapMaxSpeed = cfg.TRAP_MAX_SPEED_PX_S;
    this.interceptMaxZ = cfg.INTERCEPT_MAX_Z;
    this.fieldRadiusPx = cfg.CAPTURE_RADIUS_PX;
    this.gkRadiusPx = gkCfg.CLAIM_RADIUS_PX;
  }

  /**
   * Evaluates the ball's travel segment this frame (prev -> now) against
   * every player. Returns the capture event for the closest interception,
   * or null when the ball flies clean.
   */
  public evaluate(
    players: EntitySnapshot[],
    prev: BallSnapshot,
    now: BallSnapshot,
  ): CaptureEvent | null {
    if (now.z > this.interceptMaxZ) {
      return null;
    }
    const speed = Math.hypot(now.vx, now.vy);

    let best: EntitySnapshot | null = null;
    let bestDist = Infinity;
    for (const p of players) {
      const d = segmentPointDistance(prev.x, prev.y, now.x, now.y, p.x, p.y);
      const radius = p.role === 'GK' ? this.gkRadiusPx : this.fieldRadiusPx;
      if (d > radius) {
        continue;
      }
      if (p.role !== 'GK' && speed > this.trapMaxSpeed) {
        // Too hot for an outfielder — it deflects past (only the GK blocks it).
        continue;
      }
      if (d < bestDist || (d === bestDist && best !== null && p.id < best.id)) {
        best = p;
        bestDist = d;
      }
    }
    if (best === null) {
      return null;
    }
    return { playerId: best.id, stopBall: true };
  }
}

/** Distance from point (px,py) to the segment (x1,y1)->(x2,y2). */
function segmentPointDistance(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  px: number,
  py: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return Math.hypot(px - x1, py - y1);
  }
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
