export interface PlayerMatchStats {
  id: string;
  goals: number;
  assists: number;
  saves: number;
  tackles: number;
}

export class ExperienceSystem {
  public static calculateMVP(stats: PlayerMatchStats[]): string | null {
    if (stats.length === 0) {
      return null;
    }

    let bestId = stats[0].id;
    let bestScore = -1;

    for (const s of stats) {
      const score = s.goals * 100 + s.assists * 50 + s.saves * 40 + s.tackles * 20;
      if (score > bestScore) {
        bestScore = score;
        bestId = s.id;
      }
    }

    return bestId;
  }
}
