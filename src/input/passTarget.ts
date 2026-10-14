import { BALANCE_CONFIG } from '../data/balance';

/** Point-ish positions consumed by the contextual action logic. */
export interface TargetPoint {
  x: number;
  y: number;
}

type PassCfg = typeof BALANCE_CONFIG.INPUT;

/**
 * Pass target selection (playtest round 3 — "no sé cómo hacer pases"):
 * forward-most teammate inside the forward cone and max range; when the cone
 * is empty and EMPTY_CONE_FALLBACK is 'forward', falls back to the furthest
 * FORWARD teammate ignoring the cone (range still applies). Backward
 * teammates are never auto-targeted. Pure + deterministic; first wins ties.
 *
 * Phaser-free so headless tests can exercise it directly.
 */
export function choosePassTarget(
  from: TargetPoint,
  teammates: TargetPoint[],
  attackDir: 1 | -1,
  cfg: PassCfg,
): TargetPoint | null {
  const halfAngleRad = ((cfg.PASS_CONE_DEG / 2) * Math.PI) / 180;
  const minDot = Math.cos(halfAngleRad);

  let best: TargetPoint | null = null;
  let bestForward = -Infinity;
  for (const mate of teammates) {
    const dx = mate.x - from.x;
    const dy = mate.y - from.y;
    const fwd = dx * attackDir;
    const dist = Math.hypot(dx, dy);
    if (fwd <= 0 || dist > cfg.PASS_MAX_RANGE_PX || dist === 0) {
      continue;
    }
    const dot = (dx * attackDir) / dist; // cone axis is horizontal
    if (dot < minDot) {
      continue;
    }
    if (fwd > bestForward) {
      bestForward = fwd;
      best = mate;
    }
  }
  if (best !== null || cfg.EMPTY_CONE_FALLBACK !== 'forward') {
    return best;
  }

  // Fallback: furthest forward teammate regardless of the cone.
  let fallback: TargetPoint | null = null;
  let fallbackForward = -Infinity;
  for (const mate of teammates) {
    const dx = mate.x - from.x;
    const dy = mate.y - from.y;
    const fwd = dx * attackDir;
    const dist = Math.hypot(dx, dy);
    if (fwd <= 0 || dist > cfg.PASS_MAX_RANGE_PX || dist === 0) {
      continue;
    }
    if (fwd > fallbackForward) {
      fallbackForward = fwd;
      fallback = mate;
    }
  }
  return fallback;
}
