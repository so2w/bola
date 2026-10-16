import { BALANCE_CONFIG } from '../data/balance';
import type { TeamSide } from './TouchTracker';

/**
 * Batch B2 — minimal foul rule (AGENTS.md section 7: "Faltas simples cuando
 * la entrada lo justifique. Penalti si corresponde. Sin fuera de juego. Sin
 * sistema complejo de tarjetas").
 *
 * RULE (documented, deterministic, no RNG):
 * A tackle challenge is a FOUL only when it comes from BEHIND a moving ball
 * carrier: the angle between the carrier's motion vector and the
 * carrier->tackler vector exceeds FOUL.BEHIND_ANGLE_DEG (180 = directly
 * behind, 90 = side, 0 = frontal). Rationale: frontal/side contact is a
 * clean arcade steal; contact from behind is the classic simple-foul shape
 * and reads instantly on screen.
 *
 * Clean by rule (no whistle ever):
 * - the carrier is near-stationary (below MIN_CARRIER_SPEED_PX_S);
 * - the challenger is the GK (claims are clean);
 * - the challenger is outside TACKLE_RADIUS_PX (no contact, no call).
 *
 * Location decides the award: a foul by the defending team inside its OWN
 * box is a PENALTY for the opponent, anywhere else a FREE_KICK for the
 * fouled team. No cards, no walls, no multi-kicker routines.
 *
 * Phaser-free and snapshot-driven (Vitest-testable). The scene feeds the
 * current possessor + nearby challengers each frame; the manager awards.
 */

export interface ChallengeSnap {
  id: string;
  team: TeamSide;
  role: 'GK' | 'DF' | 'MF' | 'FW';
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface FoulConfig {
  TACKLE_RADIUS_PX: number;
  MIN_CARRIER_SPEED_PX_S: number;
  BEHIND_ANGLE_DEG: number;
  BOX_DEPTH_PX: number;
  BOX_HALF_HEIGHT_PX: number;
  PENALTY_SPOT_OFFSET_PX: number;
  PITCH_WIDTH_PX: number;
  PITCH_HEIGHT_PX: number;
}

export const FOUL_RULE_CONFIG: FoulConfig = {
  TACKLE_RADIUS_PX: BALANCE_CONFIG.FOUL.TACKLE_RADIUS_PX,
  MIN_CARRIER_SPEED_PX_S: BALANCE_CONFIG.FOUL.MIN_CARRIER_SPEED_PX_S,
  BEHIND_ANGLE_DEG: BALANCE_CONFIG.FOUL.BEHIND_ANGLE_DEG,
  BOX_DEPTH_PX: BALANCE_CONFIG.FOUL.BOX_DEPTH_PX,
  BOX_HALF_HEIGHT_PX: BALANCE_CONFIG.FOUL.BOX_HALF_HEIGHT_PX,
  PENALTY_SPOT_OFFSET_PX: BALANCE_CONFIG.FOUL.PENALTY_SPOT_OFFSET_PX,
  PITCH_WIDTH_PX: BALANCE_CONFIG.PHYSICS.PITCH_WIDTH,
  PITCH_HEIGHT_PX: BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT,
};

export type ChallengeVerdict = 'clean' | 'foul';

/**
 * Classifies one challenger against the ball carrier. Pure: same inputs
 * always produce the same verdict.
 */
export function classifyChallenge(
  tackler: ChallengeSnap,
  carrier: ChallengeSnap,
  cfg: FoulConfig = FOUL_RULE_CONFIG,
): ChallengeVerdict {
  // GK claims are clean by rule (keeper FSM, never a foul).
  if (tackler.role === 'GK') {
    return 'clean';
  }
  const carrierSpeed = Math.hypot(carrier.vx, carrier.vy);
  if (carrierSpeed < cfg.MIN_CARRIER_SPEED_PX_S) {
    return 'clean';
  }
  const dx = tackler.x - carrier.x;
  const dy = tackler.y - carrier.y;
  const dist = Math.hypot(dx, dy);
  if (dist > cfg.TACKLE_RADIUS_PX) {
    return 'clean';
  }
  // Angle between carrier motion (vx,vy) and carrier->tackler (dx,dy).
  // dist > 0 and carrierSpeed > 0 here (guarded above); dist === 0 means
  // body-on-body contact with no behind component — clean steal.
  if (dist === 0) {
    return 'clean';
  }
  const cos = (carrier.vx * dx + carrier.vy * dy) / (carrierSpeed * dist);
  const angleDeg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
  return angleDeg > cfg.BEHIND_ANGLE_DEG ? 'foul' : 'clean';
}

export interface FoulEvent {
  tacklerId: string;
  foulingTeam: TeamSide;
}

/**
 * Scans challengers around the carrier and returns the foul event for the
 * nearest fouling tackler (ties break by lower id), or null when no
 * challenge is a foul. Deterministic, no RNG.
 */
export function detectFoul(
  carrier: ChallengeSnap,
  challengers: ChallengeSnap[],
  cfg: FoulConfig = FOUL_RULE_CONFIG,
): FoulEvent | null {
  let best: ChallengeSnap | null = null;
  let bestD = Infinity;
  for (const c of challengers) {
    if (c.team === carrier.team) {
      continue;
    }
    if (classifyChallenge(c, carrier, cfg) !== 'foul') {
      continue;
    }
    const d = (c.x - carrier.x) ** 2 + (c.y - carrier.y) ** 2;
    if (d < bestD || (d === bestD && best !== null && c.id < best.id)) {
      best = c;
      bestD = d;
    }
  }
  return best ? { tacklerId: best.id, foulingTeam: best.team } : null;
}

/** True when (x,y) lies inside the penalty box defending the given goal side. */
export function isInPenaltyBox(
  x: number,
  y: number,
  defendedSide: 'left' | 'right',
  cfg: FoulConfig = FOUL_RULE_CONFIG,
): boolean {
  const centerY = cfg.PITCH_HEIGHT_PX / BOX_HALF_DIVISOR;
  const inHeight = Math.abs(y - centerY) < cfg.BOX_HALF_HEIGHT_PX;
  if (!inHeight) {
    return false;
  }
  if (defendedSide === 'left') {
    return x < cfg.BOX_DEPTH_PX;
  }
  return x > cfg.PITCH_WIDTH_PX - cfg.BOX_DEPTH_PX;
}

/** Halving divisor for the vertical pitch center (arithmetic, not tuning). */
const BOX_HALF_DIVISOR = 2;

export interface FoulAward {
  kind: 'FREE_KICK' | 'PENALTY';
  /** Team that takes the set piece (the fouled side). */
  team: TeamSide;
}

/**
 * Maps a foul spot + fouling team to the set-piece award. A foul by the
 * defense inside its OWN box (home defends left, away defends right) is a
 * PENALTY; everything else is a FREE_KICK for the fouled team.
 */
export function awardForFoul(
  spot: { x: number; y: number },
  foulingTeam: TeamSide,
  cfg: FoulConfig = FOUL_RULE_CONFIG,
): FoulAward {
  const defendedSide: 'left' | 'right' = foulingTeam === 'home' ? 'left' : 'right';
  if (isInPenaltyBox(spot.x, spot.y, defendedSide, cfg)) {
    return { kind: 'PENALTY', team: otherSide(foulingTeam) };
  }
  return { kind: 'FREE_KICK', team: otherSide(foulingTeam) };
}

function otherSide(team: TeamSide): TeamSide {
  return team === 'home' ? 'away' : 'home';
}
