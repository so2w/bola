import { BALANCE_CONFIG } from '../data/balance';

/**
 * Phase 4 Batch B (AGENTS.md section 22 layer 3): dynamic stadium crowd.
 *
 * Pure, Phaser-free level math consumed by MatchScene at a low cadence
 * (SAMPLE_INTERVAL_MS — never per frame). The crowd bed's gain follows the
 * ball position (danger rises inside the attacking thirds, more near the
 * box), peaks on GOAL and decays back; the home crowd is louder when the
 * home team leads. Every level, zone and rate lives in
 * BALANCE_CONFIG.AUDIO.CROWD_DYNAMICS — zero literals here.
 */

const CD = BALANCE_CONFIG.AUDIO.CROWD_DYNAMICS;

export interface CrowdIntensityInput {
  ballX: number;
  scoreHome: number;
  scoreAway: number;
}

function clampLevel(level: number): number {
  return Math.min(Math.max(level, CD.MIN_LEVEL), CD.MAX_LEVEL);
}

/** Distance from the ball to the nearest goal line (never negative). */
function distanceFromGoalLine(ballX: number): number {
  const left = BALANCE_CONFIG.GOAL_FRAME.LEFT_GOAL_X_PX;
  const right = BALANCE_CONFIG.GOAL_FRAME.RIGHT_GOAL_X_PX;
  return Math.max(0, Math.min(ballX - left, right - ballX));
}

/**
 * Target crowd level (gain in [MIN_LEVEL, MAX_LEVEL]) for the ball zone and
 * the score differential: baseline in midfield, THIRD_LEVEL inside an
 * attacking third, BOX_LEVEL near a box, +LEAD_BONUS while the home team leads
 * (clamped to MAX_LEVEL). Deterministic and symmetric over both flanks.
 */
export function computeCrowdIntensity(input: CrowdIntensityInput): number {
  const dist = distanceFromGoalLine(input.ballX);
  let level: number;
  if (dist <= CD.BOX_ZONE_PX) {
    level = CD.BOX_LEVEL;
  } else if (dist <= CD.ATTACKING_THIRD_PX) {
    level = CD.THIRD_LEVEL;
  } else {
    level = CD.NEUTRAL_LEVEL;
  }
  if (input.scoreHome > input.scoreAway) {
    level += CD.LEAD_BONUS;
  }
  return clampLevel(level);
}

/**
 * One bounded interpolation step toward the target: rise at ATTACK_PER_MS,
 * fall at RELEASE_PER_MS (small decay back), never overshoot, always finite
 * and inside the clamp window. `current`/`target` are pre-clamped so the
 * result can never drift out of bounds even with hostile inputs.
 */
export function nextCrowdLevel(current: number, target: number, dtMs: number): number {
  const from = clampLevel(current);
  const to = clampLevel(target);
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(dtMs) || dtMs <= 0) {
    return clampLevel(Number.isFinite(from) ? from : CD.NEUTRAL_LEVEL);
  }
  const rate = to > from ? CD.ATTACK_PER_MS : CD.RELEASE_PER_MS;
  const step = rate * dtMs;
  const next = to > from ? Math.min(from + step, to) : Math.max(from - step, to);
  return clampLevel(next);
}

/**
 * Cadence gate: accumulates frame deltas and emits a new smoothed level only
 * when the sampling interval elapsed (MatchScene then pushes exactly one
 * gain write per sample — no per-frame writes, no zipper noise).
 */
export class CrowdIntensitySampler {
  private accumMs = 0;
  private level = CD.NEUTRAL_LEVEL;

  /** Returns the new level when the cadence elapsed, null otherwise. */
  public update(dtMs: number, input: CrowdIntensityInput): number | null {
    this.accumMs += dtMs;
    if (this.accumMs < CD.SAMPLE_INTERVAL_MS) {
      return null;
    }
    this.accumMs -= CD.SAMPLE_INTERVAL_MS;
    this.level = nextCrowdLevel(this.level, computeCrowdIntensity(input), CD.SAMPLE_INTERVAL_MS);
    return this.level;
  }

  /** Jumps immediately (goal peak); the next samples decay from here. */
  public forceLevel(level: number): void {
    this.level = clampLevel(level);
  }

  public getLevel(): number {
    return this.level;
  }
}
