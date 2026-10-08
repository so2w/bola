export interface CandidatePlayer {
  id: string;
  x: number;
  y: number;
  role?: string;
  isEngaged?: boolean;
}

export class PlayerSelectionSystem {
  private currentSelectedId: string | null = null;
  private switchCooldownMs = 0;
  private minCooldown: number;

  constructor(minCooldownMs = 300) {
    this.minCooldown = minCooldownMs;
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

    if (candidates.length === 0) {
      this.currentSelectedId = null;
      return null;
    }

    let bestId = candidates[0].id;
    let bestScore = -Infinity;

    for (const c of candidates) {
      const dist = Math.hypot(c.x - ballPos.x, c.y - ballPos.y);

      // Higher score is better
      let score = 1000 - dist;

      // Hysteresis bonus if already selected to avoid constant frame toggling
      if (c.id === this.currentSelectedId) {
        score += 150;
      }

      // Penalize if another teammate is already engaged
      if (c.isEngaged && c.id !== this.currentSelectedId) {
        score -= 100;
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
