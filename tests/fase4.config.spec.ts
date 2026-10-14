import { describe, it, expect } from 'vitest';
import { BALANCE_CONFIG } from '../src/data/balance';

/**
 * Fase 4 Slice 1 — GOLPE LEGIBLE, task 1.1 (RED).
 * BALANCE_CONFIG must expose INPUT, POWER_METER and FEEDBACK groups with the
 * design values (cross-cutting constants; no RNG, no Date.now).
 */
describe('Fase 4 — BALANCE_CONFIG groups (1.1)', () => {
  it('exposes INPUT group with buffer + contextual pass values', () => {
    const INPUT = (BALANCE_CONFIG as Record<string, unknown>).INPUT as Record<string, unknown>;
    expect(INPUT).toBeDefined();
    expect(INPUT.BUFFER_MS).toBe(150);
    expect(INPUT.PASS_PICKUP_RADIUS_PX).toBe(28);
    expect(INPUT.PASS_CONE_DEG).toBe(45);
    expect(INPUT.PASS_MAX_RANGE_PX).toBe(260);
    // Playtest round 3: empty pass cone falls back to a forward teammate.
    expect(INPUT.EMPTY_CONE_FALLBACK).toBe('forward');
  });

  it('exposes POWER_METER bounds and colors', () => {
    const PM = (BALANCE_CONFIG as Record<string, unknown>).POWER_METER as Record<string, unknown>;
    expect(PM).toBeDefined();
    expect(PM.WIDTH_PX).toBe(120);
    expect(PM.HEIGHT_PX).toBe(10);
    expect(PM.Y_OFFSET_PX).toBe(-40);
    expect(PM.COLOR_LOW).toBe(0x4caf50);
    expect(PM.COLOR_HIGH).toBe(0xf44336);
  });

  it('exposes FEEDBACK post band + net flash + boundary rule', () => {
    const FB = (BALANCE_CONFIG as Record<string, unknown>).FEEDBACK as Record<string, unknown>;
    expect(FB).toBeDefined();
    expect(FB.NET_FLASH_MS).toBe(600);
    expect(FB.POST_BAND_HEIGHT_PX).toBe(24);
    expect(FB.POST_BOUNDARY_INCLUSIVE).toBe(true);
  });
});
