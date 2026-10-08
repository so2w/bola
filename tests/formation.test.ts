import { describe, it, expect } from 'vitest';
import { FormationSystem } from '../src/match/FormationSystem';

describe('FormationSystem', () => {
  it('generates 11 valid player positions for 4-4-2 formation', () => {
    const homePositions = FormationSystem.getPositions('4-4-2', 'home');
    const awayPositions = FormationSystem.getPositions('4-4-2', 'away');

    expect(homePositions).toHaveLength(11);
    expect(awayPositions).toHaveLength(11);

    // GK check
    expect(homePositions[0].role).toBe('GK');
    expect(homePositions[0].x).toBe(60);

    expect(awayPositions[0].role).toBe('GK');
    expect(awayPositions[0].x).toBe(900);
  });
});
