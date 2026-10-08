export type LeagueTier = 'AMATEUR' | 'SEGUNDA' | 'PRIMERA';

export interface AIDifficultyProfile {
  passAccuracy: number;      // 0.0 - 1.0
  reactionMs: number;        // ms before AI makes decision
  positioningError: number;  // max pixel offset from ideal position
}

export class AIDifficultyScaler {
  public static getProfile(tier: LeagueTier): AIDifficultyProfile {
    switch (tier) {
      case 'AMATEUR':
        return { passAccuracy: 0.65, reactionMs: 400, positioningError: 60 };
      case 'SEGUNDA':
        return { passAccuracy: 0.85, reactionMs: 150, positioningError: 30 };
      case 'PRIMERA':
        return { passAccuracy: 0.95, reactionMs: 80, positioningError: 12 };
    }
  }
}
