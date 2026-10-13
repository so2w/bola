import { BALANCE_CONFIG } from '../data/balance';

/**
 * Fase 4 Slice 1 — MF-1/MF-2 goal-mouth feedback helpers (Phaser-free).
 * MatchScene wires its Arcade overlap zones to these pure functions/guards.
 */

export type GoalLineClassification = 'GOAL' | 'POST' | 'WIDE';

export interface GoalBandConfig {
  GOAL_MOUTH_CENTER_Y_PX: number;
  GOAL_MOUTH_HALF_HEIGHT_PX: number;
  POST_BAND_HEIGHT_PX: number;
  POST_BOUNDARY_INCLUSIVE: boolean;
}

/**
 * MF-1: classify a goal-line crossing by y-band. GOAL inside the goal mouth,
 * POST in the adjacent edge band, WIDE beyond. Boundary behavior follows the
 * configured inclusive/exclusive rule; within one crossing a single
 * classification is returned (goal band wins ties because it is checked first).
 */
export function classifyGoalLineEntry(
  y: number,
  cfg: GoalBandConfig = BALANCE_CONFIG.FEEDBACK,
): GoalLineClassification {
  const d = Math.abs(y - cfg.GOAL_MOUTH_CENTER_Y_PX);
  if (cfg.POST_BOUNDARY_INCLUSIVE) {
    if (d <= cfg.GOAL_MOUTH_HALF_HEIGHT_PX) {
      return 'GOAL';
    }
    if (d <= cfg.GOAL_MOUTH_HALF_HEIGHT_PX + cfg.POST_BAND_HEIGHT_PX) {
      return 'POST';
    }
    return 'WIDE';
  }
  if (d < cfg.GOAL_MOUTH_HALF_HEIGHT_PX) {
    return 'GOAL';
  }
  if (d < cfg.GOAL_MOUTH_HALF_HEIGHT_PX + cfg.POST_BAND_HEIGHT_PX) {
    return 'POST';
  }
  return 'WIDE';
}

export type GoalTransitionEvent = 'CROWD_CHEER' | 'NET_FLASH';

/**
 * MF-2 guards: CROWD_CHEER fires exactly once on the PLAYING -> GOAL edge
 * (restart transitions cannot re-fire it), and POST fires once per shot while
 * play is live (guard resets on a new kick or on resuming PLAYING).
 */
export class GoalFeedback {
  private postFiredThisShot = false;

  /** Emits the one-shot goal stinger on the PLAYING -> GOAL transition only. */
  public onStateTransition(prevState: string | undefined, nextState: string): GoalTransitionEvent[] {
    const events: GoalTransitionEvent[] = [];
    if (prevState !== 'GOAL' && nextState === 'GOAL') {
      events.push('CROWD_CHEER', 'NET_FLASH');
    }
    if (nextState === 'PLAYING' && prevState !== 'PLAYING') {
      // Resume from a restart: a fresh shot may hit the post again.
      this.postFiredThisShot = false;
    }
    return events;
  }

  /** MF-1-S2/S3: true when POST audio should fire (once per shot). */
  public onPostBandOverlap(matchState: string): boolean {
    if (matchState !== 'PLAYING' || this.postFiredThisShot) {
      return false;
    }
    this.postFiredThisShot = true;
    return true;
  }

  /** Possession hook: a new kick re-arms the post guard. */
  public onKick(): void {
    this.postFiredThisShot = false;
  }
}
