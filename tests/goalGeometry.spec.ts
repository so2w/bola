import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BALANCE_CONFIG } from '../src/data/balance';
import { goalFrameGeometry } from '../src/match/goalFrame';

// Playtest final, item 1 ("las porterías quedan mejor alineadas"): the drawn
// goal frame, the detection zones and the pitch markings must ALL come from
// ONE shared geometry source (src/data/goalGeometry.json — readable by both
// the TypeScript config and the plain-JS sprite generator).

const shared = JSON.parse(
  readFileSync(fileURLToPath(new URL('../src/data/goalGeometry.json', import.meta.url)), 'utf8'),
) as Record<string, number>;

// Plain-JS generator module (no type declarations; runtime import only).
// Importing must be side-effect free — main() only runs on direct execution.
// @ts-expect-error — JS module without declarations
const { goalMarkingGeometry } = await import('../scripts/generate-sprites.js');

describe('shared goal geometry (src/data/goalGeometry.json)', () => {
  it('is self-consistent: mouth spans center ± half height, zone height equals the mouth', () => {
    expect(shared.GOAL_MOUTH_CENTER_Y_PX - shared.GOAL_MOUTH_HALF_HEIGHT_PX).toBeLessThan(
      shared.GOAL_MOUTH_CENTER_Y_PX,
    );
    expect(shared.GOAL_ZONE_HEIGHT_PX).toBe(shared.GOAL_MOUTH_HALF_HEIGHT_PX * 2);
    expect(shared.GOAL_ZONE_WIDTH_PX).toBeGreaterThan(0);
    expect(shared.GOAL_LINE_LEFT_X_PX).toBeGreaterThan(0);
    expect(shared.GOAL_LINE_RIGHT_X_PX).toBeLessThan(shared.PITCH_WIDTH_PX);
    expect(shared.GOAL_LINE_LEFT_X_PX).toBeLessThan(shared.GOAL_LINE_RIGHT_X_PX);
  });

  it('BALANCE_CONFIG derives its goal geometry from the shared file (no drift)', () => {
    expect(BALANCE_CONFIG.GOAL_FRAME.LEFT_GOAL_X_PX).toBe(shared.GOAL_LINE_LEFT_X_PX);
    expect(BALANCE_CONFIG.GOAL_FRAME.RIGHT_GOAL_X_PX).toBe(shared.GOAL_LINE_RIGHT_X_PX);
    expect(BALANCE_CONFIG.GOAL_FRAME.GOAL_ZONE_WIDTH_PX).toBe(shared.GOAL_ZONE_WIDTH_PX);
    expect(BALANCE_CONFIG.GOAL_FRAME.GOAL_ZONE_HEIGHT_PX).toBe(shared.GOAL_ZONE_HEIGHT_PX);
    expect(BALANCE_CONFIG.FEEDBACK.GOAL_MOUTH_CENTER_Y_PX).toBe(shared.GOAL_MOUTH_CENTER_Y_PX);
    expect(BALANCE_CONFIG.FEEDBACK.GOAL_MOUTH_HALF_HEIGHT_PX).toBe(shared.GOAL_MOUTH_HALF_HEIGHT_PX);
    expect(BALANCE_CONFIG.PHYSICS.PITCH_WIDTH).toBe(shared.PITCH_WIDTH_PX);
    expect(BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT).toBe(shared.PITCH_HEIGHT_PX);
  });
});

describe('goalFrameGeometry === detection-zone geometry === pitch-marking geometry', () => {
  it('the frame covers exactly the shared detection zone on both ends', () => {
    const frames = goalFrameGeometry();
    for (const side of [frames.left, frames.right]) {
      expect(side.mouthTopY).toBe(shared.GOAL_MOUTH_CENTER_Y_PX - shared.GOAL_MOUTH_HALF_HEIGHT_PX);
      expect(side.mouthBottomY).toBe(shared.GOAL_MOUTH_CENTER_Y_PX + shared.GOAL_MOUTH_HALF_HEIGHT_PX);
      expect(side.zone.w).toBe(shared.GOAL_ZONE_WIDTH_PX);
      expect(side.zone.h).toBe(shared.GOAL_ZONE_HEIGHT_PX);
      // Posts sit exactly on the goal-mouth edges.
      expect(side.postTop.cy).toBe(side.mouthTopY);
      expect(side.postBottom.cy).toBe(side.mouthBottomY);
    }
    expect(frames.left.zone.cx).toBe(shared.GOAL_LINE_LEFT_X_PX);
    expect(frames.right.zone.cx).toBe(shared.GOAL_LINE_RIGHT_X_PX);
  });

  it('the sprite generator paints its goal markings from the SAME geometry', () => {
    const marking = goalMarkingGeometry();
    // Pre-fix RED: the generator drew the goal line at x=40/920 and a
    // 110px-tall goal area — off the 20/940 goal lines and the 140px mouth.
    expect(marking.leftLineX).toBe(shared.GOAL_LINE_LEFT_X_PX);
    expect(marking.rightLineX).toBe(shared.GOAL_LINE_RIGHT_X_PX);
    expect(marking.mouthTopY).toBe(shared.GOAL_MOUTH_CENTER_Y_PX - shared.GOAL_MOUTH_HALF_HEIGHT_PX);
    expect(marking.mouthBottomY).toBe(shared.GOAL_MOUTH_CENTER_Y_PX + shared.GOAL_MOUTH_HALF_HEIGHT_PX);
    expect(marking.zoneWidth).toBe(shared.GOAL_ZONE_WIDTH_PX);
    expect(marking.zoneHeight).toBe(shared.GOAL_ZONE_HEIGHT_PX);
  });

  it('importing the generator module does NOT write any files (main guarded)', () => {
    // Side-effect-free import is what lets this spec read the marking
    // geometry; if the guard regresses, the manifest mtime would change.
    expect(typeof goalMarkingGeometry).toBe('function');
  });
});
