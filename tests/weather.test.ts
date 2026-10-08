import { describe, it, expect } from 'vitest';
import { WeatherSystem } from '../src/match/WeatherSystem';

describe('WeatherSystem', () => {
  it('applies friction and sprint penalties for dirt pitch', () => {
    const mods = WeatherSystem.getSurfaceModifiers('DIRT', 'CLEAR_DAY');
    expect(mods.frictionMultiplier).toBe(1.3);
    expect(mods.sprintSpeedMultiplier).toBe(0.9);
  });

  it('reduces friction during rain due to wet surface sliding', () => {
    const modsClear = WeatherSystem.getSurfaceModifiers('REGULAR_GRASS', 'CLEAR_DAY');
    const modsRain = WeatherSystem.getSurfaceModifiers('REGULAR_GRASS', 'RAIN');

    expect(modsRain.frictionMultiplier).toBeLessThan(modsClear.frictionMultiplier);
  });
});
