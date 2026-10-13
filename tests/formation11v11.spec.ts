import { describe, it, expect } from 'vitest';
import { FORMATIONS, anchorCoords, resolveFormation } from '../src/data/formations';
import { FormationSystem } from '../src/match/FormationSystem';
import { resolveMatchFormations } from '../src/match/resolveFormations';

/**
 * FORM-1 — Data-driven 11v11 formation (S1 RED tests, failing-first).
 *
 * Scenarios from SDD spec (obs #1385):
 *  1. Construct 11v11 match — 11 slots/team, exactly 1 GK per side,
 *     away formation is a horizontal mirror of home.
 *  2. Legacy formations unchanged — 3v3/5v5 entries keep green.
 *  3. Unknown formation rejected — descriptive error before spawn.
 */
describe('FORMATIONS[\'11v11\']', () => {
  it('has exactly 11 slots with 1 GK and DF/MF/FW lines', () => {
    const slots = resolveFormation('11v11');
    expect(slots).toHaveLength(11);
    expect(slots.filter((s) => s.role === 'GK')).toHaveLength(1);
    expect(slots.filter((s) => s.role === 'DF').length).toBeGreaterThanOrEqual(3);
    expect(slots.filter((s) => s.role === 'MF').length).toBeGreaterThanOrEqual(2);
    expect(slots.filter((s) => s.role === 'FW').length).toBeGreaterThanOrEqual(1);
    // slot ids are unique
    expect(new Set(slots.map((s) => s.id)).size).toBe(slots.length);
  });

  it('normalized anchors stay within [0..1] on both axes', () => {
    for (const s of resolveFormation('11v11')) {
      expect(s.nx).toBeGreaterThanOrEqual(0);
      expect(s.nx).toBeLessThanOrEqual(1);
      expect(s.ny).toBeGreaterThanOrEqual(0);
      expect(s.ny).toBeLessThanOrEqual(1);
    }
  });

  it('is numerically equivalent to the legacy 4-4-2 absolute positions (960x540)', () => {
    const home = anchorCoords(resolveFormation('11v11'), 'home', 960, 540);
    // Legacy FormationSystem.getPositions('4-4-2','home') literals:
    const expected: Array<[number, number, string]> = [
      [60, 270, 'GK'],
      [200, 108, 'DF'],
      [180, 216, 'DF'],
      [180, 324, 'DF'],
      [200, 432, 'DF'],
      [340, 97.2, 'MF'],
      [330, 205.2, 'MF'],
      [330, 334.8, 'MF'],
      [340, 442.8, 'MF'],
      [440, 205.2, 'FW'],
      [440, 334.8, 'FW'],
    ];
    expect(home).toHaveLength(expected.length);
    expected.forEach(([x, y, role], i) => {
      expect(home[i].x).toBeCloseTo(x, 4);
      expect(home[i].y).toBeCloseTo(y, 4);
      expect(home[i].role).toBe(role);
    });
  });

  it('mirrors the away formation horizontally from home', () => {
    const home = anchorCoords(resolveFormation('11v11'), 'home', 960, 540);
    const away = anchorCoords(resolveFormation('11v11'), 'away', 960, 540);
    expect(away).toHaveLength(home.length);
    home.forEach((h, i) => {
      expect(away[i].x).toBeCloseTo(960 - h.x, 6);
      expect(away[i].y).toBeCloseTo(h.y, 6);
      expect(away[i].role).toBe(h.role);
    });
    // away GK defends the right goal; away FW attacks left
    expect(away[0].role).toBe('GK');
    expect(away[0].x).toBeGreaterThan(away[away.length - 1].x);
  });
});

describe('resolveFormation', () => {
  it('returns the legacy 3v3/5v5 entries unchanged (FORM-1 scenario 2)', () => {
    expect(resolveFormation('3v3')).toBe(FORMATIONS['3v3']);
    expect(resolveFormation('5v5')).toBe(FORMATIONS['5v5']);
    expect(resolveFormation('3v3').map((s) => s.role)).toEqual(['GK', 'DF', 'FW']);
    expect(resolveFormation('5v5').map((s) => s.role)).toEqual(['GK', 'DF', 'DF', 'MF', 'FW']);
  });

  it('throws a descriptive error for an unknown formation id', () => {
    expect(() => resolveFormation('7v7' as never)).toThrow(/[Uu]nknown formation.*7v7/);
    expect(() => FormationSystem.anchors('7v7' as never, 'home')).toThrow(/[Uu]nknown formation/);
  });
});

describe('resolveMatchFormations (MatchScene init-data params)', () => {
  it('defaults to 3v3/3v3 when scene receives no init data (no gameplay regression)', () => {
    expect(resolveMatchFormations(undefined)).toEqual({ home: '3v3', away: '3v3' });
    expect(resolveMatchFormations({})).toEqual({ home: '3v3', away: '3v3' });
  });

  it('honours explicit formationHome/formationAway', () => {
    expect(resolveMatchFormations({ formationHome: '11v11', formationAway: '11v11' })).toEqual({
      home: '11v11',
      away: '11v11',
    });
    expect(resolveMatchFormations({ formationHome: '11v11' })).toEqual({ home: '11v11', away: '3v3' });
  });

  it('rejects unknown ids with a descriptive error before spawn (FORM-1 scenario 3)', () => {
    expect(() => resolveMatchFormations({ formationHome: '7v7' as never })).toThrow(/[Uu]nknown formation/);
    expect(() => resolveMatchFormations({ formationAway: 'futsal' as never })).toThrow(/[Uu]nknown formation/);
  });
});
