import { BALANCE_CONFIG } from '../data/balance';

/** Point-ish positions consumed by the aimed-pass logic. */
export interface AimPoint {
  x: number;
  y: number;
}

export type PassAimConfig = typeof BALANCE_CONFIG.INPUT.PASS_AIM;

/**
 * Playtest final — directional pass target selection.
 *
 * The human pass targets by AIM direction: the input direction (keyboard
 * held-dir or touch stick vector at pass time) picks the best receiver
 * inside a cone around that direction — ANY heading (backward and lateral
 * passes included), wider than the 45° forward-only auto cone. Receivers
 * are scored by distance + openness (nearest-opponent clearance), so an
 * unmarked run beats a marked one and a closer offer beats a stretched one
 * at equal openness.
 *
 * Neutral aim (no direction held) returns null — the caller falls back to
 * the forward-cone auto-choice (passTarget.choosePassTarget). Fewer than
 * MIN_CANDIDATES receivers inside the cone also falls back.
 *
 * Pure + deterministic (no RNG, no Phaser); ties keep the first candidate.
 * AI pass targeting does NOT use this module.
 */
export function chooseAimedPassTarget(
  from: AimPoint,
  aim: { x: number; y: number },
  teammates: AimPoint[],
  opponents: AimPoint[],
  cfg: PassAimConfig = BALANCE_CONFIG.INPUT.PASS_AIM,
  maxRangePx: number = BALANCE_CONFIG.INPUT.PASS_MAX_RANGE_PX,
): AimPoint | null {
  const aimLen = Math.hypot(aim.x, aim.y);
  if (aimLen === 0) {
    return null;
  }
  const halfCos = Math.cos(((cfg.CONE_DEG / 2) * Math.PI) / 180);

  const inCone: { mate: AimPoint; dist: number }[] = [];
  for (const mate of teammates) {
    const dx = mate.x - from.x;
    const dy = mate.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0 || dist > maxRangePx) {
      continue;
    }
    const dot = (dx * aim.x + dy * aim.y) / (dist * aimLen);
    if (dot < halfCos) {
      continue;
    }
    inCone.push({ mate, dist });
  }
  if (inCone.length < cfg.MIN_CANDIDATES) {
    return null;
  }

  let best: AimPoint | null = null;
  let bestScore = -Infinity;
  for (const { mate, dist } of inCone) {
    const openness = opennessOf(mate, opponents, cfg.OPENNESS_RADIUS_PX);
    const score =
      cfg.DISTANCE_WEIGHT * (1 - dist / maxRangePx) + cfg.OPENNESS_WEIGHT * openness;
    if (score > bestScore) {
      bestScore = score;
      best = mate;
    }
  }
  return best;
}

/** 0..1 clearance: 1 = no opponent within OPENNESS_RADIUS_PX of the receiver. */
function opennessOf(mate: AimPoint, opponents: AimPoint[], radiusPx: number): number {
  if (opponents.length === 0) {
    return 1;
  }
  let nearest = Infinity;
  for (const opp of opponents) {
    const d = Math.hypot(opp.x - mate.x, opp.y - mate.y);
    if (d < nearest) {
      nearest = d;
    }
  }
  return Math.min(1, nearest / radiusPx);
}
