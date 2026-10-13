import { BALANCE_CONFIG } from '../data/balance';

export type TeamSide = 'home' | 'away';

export interface TouchRecord {
  team: TeamSide;
  playerId: string;
  x: number;
  y: number;
}

export interface ExitClassification {
  line: 'touchline' | 'byline';
  side: 'top' | 'bottom' | 'left' | 'right';
  /** Exit point clamped onto the boundary line the ball crossed. */
  exitPoint: { x: number; y: number };
  /** True when the ball left through both axes near a corner. */
  cornerDiagonal: boolean;
}

export const otherTeam = (team: TeamSide): TeamSide => (team === 'home' ? 'away' : 'home');

/**
 * Last-touch attribution + boundary exit classification (RULE-1).
 * Phaser-free: MatchScene/MatchManager feed contacts; MatchManager consumes
 * lastTouchTeam + classifyExit() to award THROW_IN / CORNER / GOAL_KICK.
 *
 * Determinism: a diagonal corner exit resolves as byline whenever the
 * byline-parallel excess stays within CORNER_EPSILON_PX; otherwise it is a
 * touchline exit. No randomness involved.
 */
export class TouchTracker {
  private last: TouchRecord | null = null;

  constructor(
    private readonly cfg: {
      PITCH_WIDTH: number;
      PITCH_HEIGHT: number;
      CORNER_EPSILON_PX: number;
    } = { ...BALANCE_CONFIG.PHYSICS, ...BALANCE_CONFIG.RESTART },
  ) {}

  public recordTouch(team: TeamSide, playerId: string, x: number, y: number): void {
    this.last = { team, playerId, x, y };
  }

  public get lastTouch(): TouchRecord | null {
    return this.last;
  }

  public get lastTouchTeam(): TeamSide | null {
    return this.last?.team ?? null;
  }

  /** Clears attribution (called on every restart placement / kickoff reset). */
  public reset(): void {
    this.last = null;
  }

  public classifyExit(x: number, y: number): ExitClassification | null {
    const { PITCH_WIDTH: w, PITCH_HEIGHT: h, CORNER_EPSILON_PX: eps } = this.cfg;
    const outLeft = x < 0;
    const outRight = x > w;
    const outTop = y < 0;
    const outBottom = y > h;
    if (!outLeft && !outRight && !outTop && !outBottom) {
      return null;
    }

    const clamped = {
      x: Math.max(0, Math.min(w, x)),
      y: Math.max(0, Math.min(h, y)),
    };
    const horizontal = outLeft || outRight;
    const vertical = outTop || outBottom;

    if (horizontal && vertical) {
      // Exact corner tolerance (RULE-1): within epsilon → byline semantics.
      const yExcess = outTop ? -y : y - h;
      const asByline = yExcess <= eps;
      return asByline
        ? { line: 'byline', side: outLeft ? 'left' : 'right', exitPoint: clamped, cornerDiagonal: true }
        : { line: 'touchline', side: outTop ? 'top' : 'bottom', exitPoint: clamped, cornerDiagonal: true };
    }
    if (horizontal) {
      return { line: 'byline', side: outLeft ? 'left' : 'right', exitPoint: clamped, cornerDiagonal: false };
    }
    return { line: 'touchline', side: outTop ? 'top' : 'bottom', exitPoint: clamped, cornerDiagonal: false };
  }
}
