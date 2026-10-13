import { describe, it, expect, vi } from 'vitest';

// PowerMeterHud imports Phaser for the HUD class; the helper under test is pure.
vi.mock('phaser', () => ({ default: {} }));

import { meterFillWidth } from '../src/ui/PowerMeterHud';
import { BALANCE_CONFIG } from '../src/data/balance';

const { WIDTH_PX } = BALANCE_CONFIG.POWER_METER;

/**
 * Fase 4 Slice 1 — PM-1 pure fill-width helper (3.1 RED).
 */
describe('PM-1 meter fill width (3.1)', () => {
  it('PM-1-S1: power 0.5 fills half the configured width', () => {
    expect(meterFillWidth(0.5, WIDTH_PX)).toBe(WIDTH_PX / 2);
  });

  it('PM-1-S3: power clamps below 0 and above 1 — never overflows bounds', () => {
    expect(meterFillWidth(2, WIDTH_PX)).toBe(WIDTH_PX);
    expect(meterFillWidth(-0.5, WIDTH_PX)).toBe(0);
  });

  it('full charge fills exactly the meter width', () => {
    expect(meterFillWidth(1, WIDTH_PX)).toBe(WIDTH_PX);
  });
});
