import { describe, it, expect, beforeEach } from 'vitest';
import { EconomySystem, Footballer } from '../src/club/EconomySystem';
import { ExperienceSystem } from '../src/progression/ExperienceSystem';
import { LocalSaveRepository } from '../src/persistence/LocalSaveRepository';

describe('EconomySystem', () => {
  it('deducts coins and adds player to roster if affordable and space available', () => {
    const economy = new EconomySystem(1000);
    const roster: Footballer[] = [];
    const newPlayer: Footballer = {
      id: 'p1',
      name: 'Carlitos',
      position: 'FW',
      level: 1,
      xp: 0,
      energy: 100,
      price: 300,
    };

    const success = economy.buyPlayer(roster, newPlayer);
    expect(success).toBe(true);
    expect(economy.getBalance()).toBe(700);
    expect(roster).toHaveLength(1);
  });

  it('rejects purchase when roster reaches max 22 players limit', () => {
    const economy = new EconomySystem(10000);
    const roster: Footballer[] = Array.from({ length: 22 }, (_, i) => ({
      id: `p${i}`,
      name: `Player ${i}`,
      position: 'MF',
      level: 1,
      xp: 0,
      energy: 100,
      price: 100,
    }));

    const extraPlayer: Footballer = {
      id: 'p23',
      name: 'Extra',
      position: 'FW',
      level: 1,
      xp: 0,
      energy: 100,
      price: 100,
    };

    const success = economy.buyPlayer(roster, extraPlayer);
    expect(success).toBe(false);
    expect(roster).toHaveLength(22);
  });
});

describe('ExperienceSystem MVP', () => {
  it('selects highest performing player as MVP', () => {
    const stats = [
      { id: 'p1', goals: 1, assists: 0, saves: 0, tackles: 2 },
      { id: 'p2', goals: 2, assists: 1, saves: 0, tackles: 1 },
    ];

    const mvpId = ExperienceSystem.calculateMVP(stats);
    expect(mvpId).toBe('p2');
  });
});

describe('LocalSaveRepository', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  it('saves and loads versioned game data', () => {
    const repo = new LocalSaveRepository();
    const data = {
      schemaVersion: 1,
      clubName: 'Barrio Unido',
      coins: 1200,
      rosterIds: ['p1', 'p2'],
    };

    repo.save(data);
    const loaded = repo.load();

    expect(loaded).toEqual(data);
  });
});
