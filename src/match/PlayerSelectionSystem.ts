import { BALANCE_CONFIG } from '../data/balance';

export interface CandidatePlayer {
  id: string;
  x: number;
  y: number;
  role?: string;
  isEngaged?: boolean;
}

interface SelectionConfig {
  W1: number;
  W2: number;
  HYSTERESIS_PX: number;
  COOLDOWN_MS: number;
  DIST_MAX_PX: number;
  ENGAGED_PENALTY: number;
  INTERCEPT_RADIUS_PX: number;
}

/**
 * Automatic player selection (AGENTS.md §8): scores candidates by distance AND
 * alignment with the ball velocity line (interception quality), with
 * hysteresis/cooldown stability and GK exclusion.
 *
 * Hysteresis semantics: HYSTERESIS_PX is a px-equivalent advantage — the current
 * holder scores as if it were HYSTERESIS_PX closer (W1 * HYSTERESIS_PX /
 * DIST_MAX score units). This preserves the legacy anti-oscillation ratio
 * (150 bonus on a 1000-distance span ≈ 15% of the score spread) while keeping
 * switching possible for candidates that are dramatically better positioned.
 */
export class PlayerSelectionSystem {
  private currentSelectedId: string | null = null;
  private switchCooldownMs = 0;
  private readonly minCooldown: number;
  private readonly cfg: SelectionConfig;

  constructor(minCooldownMs: number = BALANCE_CONFIG.SELECTION.COOLDOWN_MS, cfg: SelectionConfig = BALANCE_CONFIG.SELECTION) {
    this.minCooldown = minCooldownMs;
    this.cfg = cfg;
  }

  public getSelectedId(): string | null {
    return this.currentSelectedId;
  }

  public update(
    deltaMs: number,
    candidates: CandidatePlayer[],
    ballPos: { x: number; y: number },
    ballVel: { x: number; y: number }
  ): string | null {
    if (this.switchCooldownMs > 0) {
      this.switchCooldownMs -= deltaMs;
    }

    // GK pre-filter: the keeper is never a selection candidate (§8/design)
    const eligible = candidates.filter((c) => c.role !== 'GK');

    if (eligible.length === 0) {
      this.currentSelectedId = null;
      return null;
    }

    const hysteresisScore = this.cfg.W1 * (this.cfg.HYSTERESIS_PX / this.cfg.DIST_MAX_PX);
    const velLen = Math.hypot(ballVel.x, ballVel.y);

    let bestId = eligible[0].id;
    let bestScore = -Infinity;

    for (const c of eligible) {
      const dist = Math.hypot(c.x - ballPos.x, c.y - ballPos.y);

      // Distance term: normalized to [0, 1], higher is closer
      let score = this.cfg.W1 * (1 - Math.min(dist, this.cfg.DIST_MAX_PX) / this.cfg.DIST_MAX_PX);

      // Interception term: perpendicular distance from the candidate to the
      // ball velocity line through the ball; 0 when the ball is stationary
      if (velLen > 0) {
        const cross = (c.x - ballPos.x) * ballVel.y - (c.y - ballPos.y) * ballVel.x;
        const perpDist = Math.abs(cross) / velLen;
        const interceptQuality = Math.max(
          0,
          Math.min(1, 1 - perpDist / this.cfg.INTERCEPT_RADIUS_PX)
        );
        score += this.cfg.W2 * interceptQuality;
      }

      // Hysteresis bonus if already selected to avoid constant frame toggling
      if (c.id === this.currentSelectedId) {
        score += hysteresisScore;
      }

      // Penalize if another teammate is already engaged
      if (c.isEngaged && c.id !== this.currentSelectedId) {
        score -= this.cfg.ENGAGED_PENALTY;
      }

      if (score > bestScore) {
        bestScore = score;
        bestId = c.id;
      }
    }

    // Switch only if cooldown expired or no selection yet
    if (this.currentSelectedId !== bestId) {
      if (this.switchCooldownMs <= 0 || this.currentSelectedId === null) {
        this.currentSelectedId = bestId;
        this.switchCooldownMs = this.minCooldown;
      }
    }

    return this.currentSelectedId;
  }
}
