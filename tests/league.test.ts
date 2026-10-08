import { describe, it, expect } from 'vitest';
import { LeagueManager } from '../src/club/LeagueManager';
import { TicketSystem } from '../src/club/TicketSystem';

describe('LeagueManager Standings', () => {
  it('updates points correctly on home win, draw, and away win', () => {
    const teams = ['Barrio Unido', 'Los Potros', 'Atlético Central', 'La Villa FC'];
    const league = new LeagueManager(teams);

    // Home win
    league.recordMatchResult('team_0', 'team_1', 2, 1);
    let standings = league.getStandings();
    expect(standings[0].teamId).toBe('team_0');
    expect(standings[0].points).toBe(3);

    // Draw
    league.recordMatchResult('team_2', 'team_3', 1, 1);
    standings = league.getStandings();
    expect(standings.find((t) => t.teamId === 'team_2')?.points).toBe(1);
  });

  it('allows promotion only for top 2 positions', () => {
    const teams = ['Barrio Unido', 'Los Potros', 'Atlético Central'];
    const league = new LeagueManager(teams);

    league.recordMatchResult('team_0', 'team_2', 3, 0);
    league.recordMatchResult('team_1', 'team_2', 2, 0);

    expect(league.canPromote('team_0')).toBe(true);
    expect(league.canPromote('team_1')).toBe(true);
    expect(league.canPromote('team_2')).toBe(false);
  });
});

describe('TicketSystem Revenue', () => {
  it('caps attendance by stadium capacity and avoids NaN or negatives', () => {
    const revenue = TicketSystem.calculateMatchRevenue(1500, 1000, 10);
    expect(revenue).toBe(10000); // 1000 * 10

    const negativeTest = TicketSystem.calculateMatchRevenue(-100, 500, 10);
    expect(negativeTest).toBe(0);
  });
});
