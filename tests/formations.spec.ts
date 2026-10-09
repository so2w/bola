import { describe, it, expect } from 'vitest';
import { FORMATIONS } from '../src/data/formations';
import { FormationSystem } from '../src/match/FormationSystem';
import { BALANCE_CONFIG } from '../src/data/balance';

describe('formation data', () => {
  it('3v3 has GK+DF+FW', () => {
    const slots = FORMATIONS['3v3'];
    expect(slots).toHaveLength(3);
    expect(slots.map((s) => s.role)).toEqual(['GK', 'DF', 'FW']);
  });

  it('5v5 has GK+2DF+MF+FW', () => {
    const slots = FORMATIONS['5v5'];
    expect(slots).toHaveLength(5);
    expect(slots.map((s) => s.role)).toEqual(['GK', 'DF', 'DF', 'MF', 'FW']);
  });

  it('normalized anchors stay within [0..1] on both axes', () => {
    for (const slots of Object.values(FORMATIONS)) {
      for (const s of slots) {
        expect(s.nx).toBeGreaterThanOrEqual(0);
        expect(s.nx).toBeLessThanOrEqual(1);
        expect(s.ny).toBeGreaterThanOrEqual(0);
        expect(s.ny).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('FormationSystem.anchors', () => {
  it('converts 5v5 to 5 role-aligned anchors on home side', () => {
    const anchors = FormationSystem.anchors('5v5', 'home');
    expect(anchors).toHaveLength(5);
    expect(anchors.map((a) => a.role)).toEqual(['GK', 'DF', 'DF', 'MF', 'FW']);
    for (const a of anchors) {
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x).toBeLessThanOrEqual(960);
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(a.y).toBeLessThanOrEqual(540);
    }
    // GK sits nearest the own goal line (home attacks right)
    expect(anchors[0].x).toBeLessThan(anchors[1].x);
  });

  it('mirrors away side horizontally', () => {
    const home = FormationSystem.anchors('3v3', 'home');
    const away = FormationSystem.anchors('3v3', 'away');
    expect(away[0].x).toBeCloseTo(960 - home[0].x, 6);
    expect(away[0].y).toBeCloseTo(home[0].y, 6);
    // away FW (attacking left) sits nearer the home goal line than the away GK
    expect(away[2].x).toBeLessThan(away[0].x);
  });

  it('supports explicit pitch dimensions', () => {
    const anchors = FormationSystem.anchors('3v3', 'home', 100, 100);
    expect(anchors[0].x).toBeCloseTo(6, 6);
    expect(anchors[0].y).toBeCloseTo(50, 6);
  });

  it('keeps legacy getPositions working for 4-4-2', () => {
    expect(FormationSystem.getPositions('4-4-2', 'home')).toHaveLength(11);
  });
});

describe('balance config groups (compile test)', () => {
  it('exposes AI, SELECTION and GK groups with sane values', () => {
    expect(BALANCE_CONFIG.AI.TICK_MS).toBe(150);
    expect(BALANCE_CONFIG.AI.PRESS_COUNT_MAX).toBe(2);
    expect(BALANCE_CONFIG.AI.ANCHOR_TOLERANCE_PX).toBeGreaterThan(0);
    expect(BALANCE_CONFIG.AI.POSSESSABLE_Z).toBeLessThan(BALANCE_CONFIG.PHYSICS.BALL_MAX_Z);
    expect(BALANCE_CONFIG.AI.CAPTURE_RADIUS_PX).toBeGreaterThan(0);
    expect(BALANCE_CONFIG.AI.CONTROL_RADIUS_PX).toBeGreaterThan(0);

    expect(BALANCE_CONFIG.SELECTION.COOLDOWN_MS).toBe(300);
    expect(BALANCE_CONFIG.SELECTION.HYSTERESIS_PX).toBe(150);
    expect(BALANCE_CONFIG.SELECTION.W1).toBeGreaterThan(0);
    expect(BALANCE_CONFIG.SELECTION.W2).toBeGreaterThan(0);
    expect(BALANCE_CONFIG.SELECTION.DIST_MAX_PX).toBeGreaterThan(0);
    expect(BALANCE_CONFIG.SELECTION.INTERCEPT_RADIUS_PX).toBeGreaterThan(0);

    expect(BALANCE_CONFIG.GK.DIVE_TRIGGER_SPEED).toBeGreaterThan(0);
    expect(BALANCE_CONFIG.GK.DIVE_RADIUS_PX).toBeLessThan(BALANCE_CONFIG.GK.TRACK_RADIUS_PX);
    expect(BALANCE_CONFIG.GK.DIVE_DURATION_MS).toBeGreaterThan(0);
    expect(BALANCE_CONFIG.GK.GK_HOLD_MS).toBeGreaterThan(0);
    expect(BALANCE_CONFIG.GK.CLAIM_RADIUS_PX).toBeGreaterThan(0);
  });
});
