import { BALANCE_CONFIG } from '../data/balance';
import type { MatchState } from '../systems/MatchManager';
import type { AICommand } from '../ai/commands';

/**
 * Playtest remediation (fase 4, golpe legible): central guard for anything
 * that can send the ball flying.
 *
 * Root cause of the playtest report "me marcan gol automáticamente" /
 * "se cambian de portería solos": AI kicks (SHOOT/PASS/DISTRIBUTE) and the
 * human charge release were NOT gated by the match state nor by ball
 * proximity. A stale command surviving a restart (e.g. a GK DISTRIBUTE
 * commanded while the ball sat inside a goal during the GOAL freeze, or a
 * SHOOT cached at the 150ms AI cadence) fired ball.applyKick from the center
 * spot toward whichever target the AI had last picked — sending the ball
 * toward the kicker's own half. Every kick now flows through this gate:
 * kicks may ONLY be applied while the match is PLAYING and only by a kicker
 * whose body is next to the ball.
 */

/**
 * Kicks are legal during live play AND from set pieces (Batch B2 resume on
 * kick: the taker's kick in FREE_KICK/PENALTY is what returns the match to
 * PLAYING via MatchManager.notifySetPieceKick). Every other stoppage still
 * blocks kicks so stale commands can never move a frozen ball.
 */
export function canApplyKick(state: MatchState | string | undefined): boolean {
  return state === 'PLAYING' || state === 'FREE_KICK' || state === 'PENALTY';
}

/** The kicker must be within reach of the ball to affect it at all. */
export function kickHasBall(
  kickerX: number,
  kickerY: number,
  ballX: number,
  ballY: number,
  radiusPx: number = BALANCE_CONFIG.INPUT.PASS_PICKUP_RADIUS_PX,
): boolean {
  return Math.hypot(ballX - kickerX, ballY - kickerY) <= radiusPx;
}

/**
 * Full kick gate for AI commands (SHOOT/PASS/DISTRIBUTE) and human releases.
 * Returns the normalized facing vector when the kick may be applied,
 * otherwise null.
 */
export function gateKickCommand(
  state: MatchState | string | undefined,
  cmd: Pick<AICommand, 'targetX' | 'targetY'>,
  kicker: { x: number; y: number },
  ball: { x: number; y: number },
  radiusPx?: number,
): { x: number; y: number } | null {
  if (!canApplyKick(state)) {
    return null;
  }
  if (!kickHasBall(kicker.x, kicker.y, ball.x, ball.y, radiusPx)) {
    return null;
  }
  const dx = cmd.targetX - kicker.x;
  const dy = cmd.targetY - kicker.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) {
    return null;
  }
  return { x: dx / len, y: dy / len };
}

/**
 * Playtest round 2 kickoff grace: true while `nowMs` is within
 * MATCH.KICKOFF_GRACE_MS of the last transition into PLAYING. During the
 * grace window own-half kicks are suppressed (the "apenas hago el saque me
 * hacen gol" guard: a release while sprinting toward the ball from behind can
 * no longer blast the ball into the own net off the kickoff).
 */
export function isKickoffGraceActive(
  playResumedAtMs: number | null | undefined,
  nowMs: number,
): boolean {
  if (playResumedAtMs === null || playResumedAtMs === undefined) {
    return false;
  }
  return nowMs - playResumedAtMs < BALANCE_CONFIG.MATCH.KICKOFF_GRACE_MS;
}

/** True when the kick direction's horizontal component points at the own half. */
export function aimsIntoOwnHalf(attackDir: 1 | -1, dirX: number): boolean {
  return dirX * attackDir < 0;
}

/**
 * Playtest round 3 (kickoff free-goal): during the grace window a KICK's
 * charge is capped at MATCH.KICKOFF_GRACE_SHOT_CAP so a kickoff blast is
 * always interceptable; after the window power is untouched.
 */
export function applyKickoffGracePowerCap(
  power: number,
  playResumedAtMs: number | null | undefined,
  nowMs: number,
): number {
  if (!isKickoffGraceActive(playResumedAtMs, nowMs)) {
    return power;
  }
  return Math.min(power, BALANCE_CONFIG.MATCH.KICKOFF_GRACE_SHOT_CAP);
}
