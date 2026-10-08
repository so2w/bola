export interface TeamStandings {
  teamId: string;
  teamName: string;
  points: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
}

export class LeagueManager {
  private standings: TeamStandings[] = [];

  constructor(teamNames: string[]) {
    this.standings = teamNames.map((name, index) => ({
      teamId: `team_${index}`,
      teamName: name,
      points: 0,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
    }));
  }

  public getStandings(): TeamStandings[] {
    return [...this.standings].sort((a, b) => b.points - a.points);
  }

  public recordMatchResult(homeId: string, awayId: string, homeGoals: number, awayGoals: number): void {
    const home = this.standings.find((t) => t.teamId === homeId);
    const away = this.standings.find((t) => t.teamId === awayId);

    if (!home || !away) {
      return;
    }

    home.played += 1;
    away.played += 1;

    if (homeGoals > awayGoals) {
      home.points += 3;
      home.won += 1;
      away.lost += 1;
    } else if (awayGoals > homeGoals) {
      away.points += 3;
      away.won += 1;
      home.lost += 1;
    } else {
      home.points += 1;
      away.points += 1;
      home.drawn += 1;
      away.drawn += 1;
    }
  }

  public canPromote(userTeamId: string): boolean {
    const sorted = this.getStandings();
    const rank = sorted.findIndex((t) => t.teamId === userTeamId);
    return rank >= 0 && rank <= 1; // Top 2 qualify for optional promotion
  }
}
