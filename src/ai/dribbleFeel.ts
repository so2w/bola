import type { EntitySnapshot } from './commands';

/**
 * Carrier feel knobs (fase 4, W1 follow-up): pure, Phaser-free helpers that
 * give the AI ball carrier an organic dribble instead of a straight-line seek.
 *
 * - Heading wobble: deterministic perpendicular oscillation — a pure function
 *   of elapsed time + a per-entity phase (never Math.random).
 * - Pressure speed modulation: per-tick defender count slows the carrier; a
 *   clear forward corridor grants a small boost.
 * - Curved approach: the goal target is rotated around the carrier, away from
 *   the nearest ahead defender; angle grows as the defender closes and is 0
 *   when nobody contests the lane.
 *
 * All metrics are computed at the coordinator tick cadence from snapshot data
 * (no new per-frame O(n^2)); only the wobble runs per frame.
 */
export interface DribbleFeelCfg {
  DRIBBLE_WOBBLE_AMPLITUDE_DEG: number;
  DRIBBLE_WOBBLE_PERIOD_MS: number;
  DRIBBLE_PRESSURE_SLOW_PX: number;
  DRIBBLE_PRESSURE_SLOW_FACTOR: number;
  DRIBBLE_PRESSURE_REF_COUNT: number;
  DRIBBLE_OPEN_LANE_BOOST: number;
  DRIBBLE_CURVE_MAX_DEG: number;
  DRIBBLE_CURVE_RANGE_PX: number;
  DRIBBLE_CORRIDOR_HALF_WIDTH_PX: number;
}

const DEG2RAD = Math.PI / 180;

/**
 * Deterministic heading wobble: sinusoid in degrees, bounded by
 * DRIBBLE_WOBBLE_AMPLITUDE_DEG. `phaseRad` decorrelates team-mates.
 */
export function wobbleOffsetDeg(elapsedMs: number, phaseRad: number, cfg: DribbleFeelCfg): number {
  return (
    cfg.DRIBBLE_WOBBLE_AMPLITUDE_DEG *
    Math.sin((2 * Math.PI * elapsedMs) / cfg.DRIBBLE_WOBBLE_PERIOD_MS + phaseRad)
  );
}

/** Opponents within radiusPx of (x, y) — the per-tick pressure metric. */
export function countPressure(
  x: number,
  y: number,
  opponents: readonly EntitySnapshot[],
  radiusPx: number,
): number {
  const r2 = radiusPx * radiusPx;
  let n = 0;
  for (const o of opponents) {
    const dx = o.x - x;
    const dy = o.y - y;
    if (dx * dx + dy * dy <= r2) {
      n++;
    }
  }
  return n;
}

/**
 * Forward corridor check along the carrier's facing: an opponent blocks the
 * lane when it is AHEAD (dot > 0) and inside the corridor half-width
 * (|perpendicular| <= corridorHalfWidthPx).
 */
export function laneIsClear(
  x: number,
  y: number,
  facingX: number,
  facingY: number,
  opponents: readonly EntitySnapshot[],
  corridorHalfWidthPx: number,
): boolean {
  const len = Math.hypot(facingX, facingY);
  if (len === 0) {
    return true;
  }
  const fx = facingX / len;
  const fy = facingY / len;
  for (const o of opponents) {
    const dx = o.x - x;
    const dy = o.y - y;
    const ahead = dx * fx + dy * fy;
    if (ahead <= 0) {
      continue;
    }
    const perp = Math.abs(dx * fy - dy * fx);
    if (perp <= corridorHalfWidthPx) {
      return false;
    }
  }
  return true;
}

/**
 * Speed factor: lerps 1 → DRIBBLE_PRESSURE_SLOW_FACTOR over
 * DRIBBLE_PRESSURE_REF_COUNT defenders; an open lane multiplies by
 * DRIBBLE_OPEN_LANE_BOOST.
 */
export function dribbleSpeedFactor(
  pressureCount: number,
  laneOpen: boolean,
  cfg: DribbleFeelCfg,
): number {
  const t = Math.min(1, pressureCount / cfg.DRIBBLE_PRESSURE_REF_COUNT);
  const slow = 1 - t * (1 - cfg.DRIBBLE_PRESSURE_SLOW_FACTOR);
  const boost = laneOpen && pressureCount === 0 ? cfg.DRIBBLE_OPEN_LANE_BOOST : 1;
  return slow * boost;
}

/**
 * Curved approach: rotates the goal target around the carrier, away from the
 * nearest defender that is ahead within DRIBBLE_CURVE_RANGE_PX. Angle scales
 * from 0 (at range edge / free run) up to DRIBBLE_CURVE_MAX_DEG (point blank).
 * Rotation direction is away from the defender (deterministic; an exactly
 * centered defender pushes to the carrier's left by convention).
 */
export function curvedGoalTarget(
  x: number,
  y: number,
  goalX: number,
  goalY: number,
  opponents: readonly EntitySnapshot[],
  cfg: DribbleFeelCfg,
): { x: number; y: number } {
  const dx = goalX - x;
  const dy = goalY - y;
  const len = Math.hypot(dx, dy);
  if (len === 0) {
    return { x: goalX, y: goalY };
  }
  const fx = dx / len;
  const fy = dy / len;

  let bestDist = Infinity;
  let bestSide = 0;
  for (const o of opponents) {
    const ox = o.x - x;
    const oy = o.y - y;
    const dist = Math.hypot(ox, oy);
    if (dist === 0 || dist >= cfg.DRIBBLE_CURVE_RANGE_PX) {
      continue;
    }
    const ahead = ox * fx + oy * fy;
    if (ahead <= 0) {
      continue;
    }
    if (dist < bestDist) {
      bestDist = dist;
      // Screen coords (y down): cross > 0 means the defender is ABOVE the run
      // line (screen-left of travel), so we rotate POSITIVE to bend the
      // target below/away. 0 cross → default bend down-field.
      bestSide = ox * fy - oy * fx;
    }
  }

  if (bestDist === Infinity) {
    return { x: goalX, y: goalY };
  }

  const closeness = 1 - bestDist / cfg.DRIBBLE_CURVE_RANGE_PX;
  const sign = bestSide > 0 ? 1 : -1;
  const rad = sign * closeness * cfg.DRIBBLE_CURVE_MAX_DEG * DEG2RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: x + dx * cos - dy * sin,
    y: y + dx * sin + dy * cos,
  };
}
