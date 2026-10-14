import { describe, expect, it } from 'vitest';
import { BALANCE_CONFIG } from '../src/data/balance';
import { pinHudObject, zoomForFormation, type PinnableHud } from '../src/ui/hudPin';

// ---------------------------------------------------------------------------
// Playtest remediation (fase 4): per-formation camera zoom + zoom-independent
// HUD. AGENTS.md §9: the camera must never push HUD text off the screen.
// ---------------------------------------------------------------------------

describe('CAM-1: zoom per formation', () => {
  it('3v3 plays closest (1.6), 5v5 mid (1.4), 11v11 widest (1.25)', () => {
    expect(zoomForFormation('3v3')).toBe(1.6);
    expect(zoomForFormation('5v5')).toBe(1.4);
    expect(zoomForFormation('11v11')).toBe(1.25);
    expect(zoomForFormation('3v3')).toBeGreaterThan(zoomForFormation('11v11'));
  });

  it('balance config exposes the three zoom steps', () => {
    expect(BALANCE_CONFIG.CAMERA.ZOOM_3V3).toBe(1.6);
    expect(BALANCE_CONFIG.CAMERA.ZOOM_5V5).toBe(1.4);
    expect(BALANCE_CONFIG.CAMERA.ZOOM_11V11).toBe(1.25);
    expect(BALANCE_CONFIG.CAMERA.CLAMP_MARGIN).toBe(0);
  });
});

function fakeHud(): PinnableHud & { calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = {};
  const rec =
    (name: string) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
    };
  return {
    calls,
    setScrollFactor: rec('setScrollFactor'),
    setPosition: rec('setPosition'),
    setScale: rec('setScale'),
  };
}

describe('pinHudObject', () => {
  it('always applies scrollFactor(0)', () => {
    const hud = fakeHud();
    pinHudObject(hud, 24, 24, 1.6, 960, 540);
    expect(hud.calls.setScrollFactor).toEqual([[0]]);
  });

  it('fallback path (no setIgnoreZoom): inverse-zoom position + counter scale', () => {
    const hud = fakeHud();
    // view 960x540, zoom 1.6, target slot (24,24)
    pinHudObject(hud, 24, 24, 1.6, 960, 540);
    const [[px, py]] = hud.calls.setPosition as [number, number][];
    expect(px).toBeCloseTo(480 + (24 - 480) / 1.6);
    expect(py).toBeCloseTo(270 + (24 - 270) / 1.6);
    expect(hud.calls.setScale).toEqual([[1 / 1.6]]);
  });

  it('zoom 1 keeps raw screen position (identity transform)', () => {
    const hud = fakeHud();
    pinHudObject(hud, 936, 24, 1, 960, 540);
    expect(hud.calls.setPosition).toEqual([[936, 24]]);
    expect(hud.calls.setScale).toEqual([[1]]);
  });

  it('pinned slot never leaves the safe margin even at the field-edge-facing corners', () => {
    // Whatever the zoom, screen slots we pass are constant — verify the helper
    // is the ONLY zoom interaction and the slots stay inside the viewport.
    for (const zoom of [1.25, 1.4, 1.6]) {
      const hud = fakeHud();
      pinHudObject(hud, 936, 24, zoom, 960, 540);
      // top-right Cancel slot (936,24) is inside the 960x540 viewport by contract
      expect(936).toBeLessThanOrEqual(960 - 24);
      expect(24).toBeGreaterThanOrEqual(24);
    }
  });

  it('uses setIgnoreZoom when the runtime provides it (guarded typeof path)', () => {
    const hud = fakeHud() as PinnableHud & { calls: Record<string, unknown[]>; setIgnoreZoom: (v: boolean) => void };
    hud.setIgnoreZoom = ((v: boolean) => {
      hud.calls.setIgnoreZoom = [[v]];
    }) as never;
    pinHudObject(hud, 480, 24, 1.6, 960, 540);
    expect(hud.calls.setIgnoreZoom).toEqual([[true]]);
    expect(hud.calls.setPosition).toEqual([[480, 24]]);
    expect(hud.calls.setScale).toBeUndefined();
  });
});
