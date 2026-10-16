import type { TeamSide } from './TouchTracker';

/** Per-team counters for the halftime banner (Batch A). */
export interface TeamStats {
  goals: number;
  shots: number;
  passesCompleted: number;
  possessionMs: number;
}

export interface MatchStatsSnapshot {
  home: TeamStats;
  away: TeamStats;
}

function emptyTeam(): TeamStats {
  return { goals: 0, shots: 0, passesCompleted: 0, possessionMs: 0 };
}

/**
 * Minimal per-team match stats collector (Batch A).
 * Fed from existing hooks only: kicks/shots via the kick path, goals via
 * handleGoal, possession time via PossessionSystem possessor. No RNG, no
 * clock reads — the caller passes deltaMs explicitly.
 */
export class MatchStatsTracker {
  private home: TeamStats = emptyTeam();
  private away: TeamStats = emptyTeam();

  private teamRef(team: TeamSide): TeamStats {
    return team === 'home' ? this.home : this.away;
  }

  public recordShot(team: TeamSide): void {
    this.teamRef(team).shots += 1;
  }

  public recordPass(team: TeamSide): void {
    this.teamRef(team).passesCompleted += 1;
  }

  public recordGoal(team: TeamSide): void {
    this.teamRef(team).goals += 1;
  }

  /** Accumulates possession time for the current holder's team. */
  public addPossession(team: TeamSide, deltaMs: number): void {
    if (deltaMs <= 0) {
      return;
    }
    this.teamRef(team).possessionMs += deltaMs;
  }

  /** Share of tracked possession time; 50/50 when nothing tracked yet. */
  public possessionPct(team: TeamSide): number {
    const total = this.home.possessionMs + this.away.possessionMs;
    if (total <= 0) {
      return 50;
    }
    return (this.teamRef(team).possessionMs / total) * 100;
  }

  public snapshot(): MatchStatsSnapshot {
    return {
      home: { ...this.home },
      away: { ...this.away },
    };
  }

  public reset(): void {
    this.home = emptyTeam();
    this.away = emptyTeam();
  }
}
