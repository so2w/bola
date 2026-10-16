import { describe, it, expect } from 'vitest';
import { BALANCE_CONFIG } from '../src/data/balance';
import { goalFrameGeometry } from '../src/match/goalFrame';

// Batch C-A: visible goal frames must match the invisible detection zones in
// MatchScene (left zone x=20, right zone x=940, 40x140) and the FEEDBACK
// post bands. TDD RED: goalFrameGeometry does not exist yet.
const FB = BALANCE_CONFIG.FEEDBACK;
const CENTER = FB.GOAL_MOUTH_CENTER_Y_PX;
const HALF = FB.GOAL_MOUTH_HALF_HEIGHT_PX;
const BAND = FB.POST_BAND_HEIGHT_PX;

describe('goal frames — config carries all frame tuning (no literals in scene)', () => {
  it('exposes goal-frame geometry/visual keys through BALANCE_CONFIG', () => {
    const rec = BALANCE_CONFIG as unknown as Record<string, Record<string, unknown>>;
    const gf = rec['GOAL_FRAME'];
    expect(gf, 'BALANCE_CONFIG.GOAL_FRAME').toBeDefined();
    for (const k of [
      'LEFT_GOAL_X_PX',
      'RIGHT_GOAL_X_PX',
      'GOAL_ZONE_WIDTH_PX',
      'GOAL_ZONE_HEIGHT_PX',
      'POST_WIDTH_PX',
      'POST_COLOR',
      'NET_DEPTH_PX',
      'NET_COLOR',
      'NET_ALPHA',
      'NET_MESH_LINES',
      'FRAME_DEPTH',
    ]) {
      expect(typeof gf[k], `GOAL_FRAME.${k}`).not.toBe('undefined');
    }
  });
});

describe('goal frames — geometry matches detection zones', () => {
  it('mouth rect equals the goal-zone rect (x=20/940, 40 wide, 140 tall)', () => {
    const g = goalFrameGeometry();
    expect(g.left.mouthTopY).toBe(CENTER - HALF);
    expect(g.left.mouthBottomY).toBe(CENTER + HALF);
    expect(g.right.mouthTopY).toBe(CENTER - HALF);
    expect(g.right.mouthBottomY).toBe(CENTER + HALF);
    // Zone match: 40 wide centered on the goal line, 140 tall on the mouth.
    expect(g.left.zone.w).toBe(40);
    expect(g.left.zone.h).toBe(HALF * 2);
    expect(g.left.zone.cx).toBe(20);
    expect(g.right.zone.cx).toBe(940);
    expect(g.right.zone.w).toBe(40);
    expect(g.right.zone.h).toBe(HALF * 2);
  });

  it('drawn posts sit on the mouth edges, overlapping the POST bands', () => {
    const g = goalFrameGeometry();
    const upperBand = { top: CENTER - HALF - BAND, bottom: CENTER - HALF };
    const lowerBand = { top: CENTER + HALF, bottom: CENTER + HALF + BAND };
    for (const side of [g.left, g.right]) {
      // Post centers exactly on the mouth edges.
      expect(side.postTop.cy).toBe(CENTER - HALF);
      expect(side.postBottom.cy).toBe(CENTER + HALF);
      // Post rects overlap their detection band (not floating elsewhere).
      expect(side.postTop.cy).toBeGreaterThanOrEqual(upperBand.top);
      expect(side.postTop.cy).toBeLessThanOrEqual(upperBand.bottom);
      expect(side.postBottom.cy).toBeGreaterThanOrEqual(lowerBand.top);
      expect(side.postBottom.cy).toBeLessThanOrEqual(lowerBand.bottom);
    }
  });

  it('cheap net extends outward beyond each goal line at mouth height', () => {
    const g = goalFrameGeometry();
    expect(g.left.net.x2).toBeLessThanOrEqual(20);
    expect(g.left.net.x1).toBeLessThan(g.left.net.x2);
    expect(g.right.net.x1).toBeGreaterThanOrEqual(940);
    expect(g.right.net.x2).toBeGreaterThan(g.right.net.x1);
    expect(g.left.net.top).toBe(CENTER - HALF);
    expect(g.left.net.bottom).toBe(CENTER + HALF);
    expect(g.right.net.top).toBe(CENTER - HALF);
    expect(g.right.net.bottom).toBe(CENTER + HALF);
  });
});
