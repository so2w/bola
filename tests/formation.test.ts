import { describe, it, expect } from 'vitest';
import { FormationSystem } from '../src/match/FormationSystem';

describe('FormationSystem.getPositions (deprecated adapter over FORMATIONS[\'11v11\'])', () => {
  it('returns 11 role-aligned positions numerically equal to the legacy 4-4-2 coords', () => {
    const homePositions = FormationSystem.getPositions('4-4-2', 'home');
    const awayPositions = FormationSystem.getPositions('4-4-2', 'away');

    expect(homePositions).toHaveLength(11);
    expect(homePositions.map((p) => p.role)).toEqual([
      'GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW',
    ]);
    expect(homePositions[0].x).toBe(60);
    expect(homePositions[0].y).toBe(270);

    expect(awayPositions[0].role).toBe('GK');
    expect(awayPositions[0].x).toBe(900);

    // away is an exact horizontal mirror of home
    homePositions.forEach((h, i) => {
      expect(awayPositions[i].x).toBeCloseTo(960 - h.x, 6);
      expect(awayPositions[i].y).toBeCloseTo(h.y, 6);
    });
  });

  it('4-3-3 and 3-5-2 remain documented stubs falling back to 4-4-2 (out of scope)', () => {
    expect(FormationSystem.getPositions('4-3-3', 'home')).toEqual(
      FormationSystem.getPositions('4-4-2', 'home'),
    );
    expect(FormationSystem.getPositions('3-5-2', 'away')).toEqual(
      FormationSystem.getPositions('4-4-2', 'away'),
    );
  });
});
