import { BALANCE_CONFIG } from '../data/balance';

export type GoalFrameConfig = typeof BALANCE_CONFIG.GOAL_FRAME;
export type GoalBandConfig = typeof BALANCE_CONFIG.FEEDBACK;
export type GoalPitchConfig = typeof BALANCE_CONFIG.PHYSICS;

/** Center-based bar rect (posts, crossbar). */
export interface FrameBar {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** Edge-based net box (x1 < x2, top < bottom). */
export interface FrameNet {
  x1: number;
  x2: number;
  top: number;
  bottom: number;
}

export interface GoalFrameSide {
  /** Goal-mouth vertical span (must equal the detection zone height). */
  mouthTopY: number;
  mouthBottomY: number;
  /** Invisible detection-zone rect the frame must cover. */
  zone: { cx: number; cy: number; w: number; h: number };
  postTop: FrameBar;
  postBottom: FrameBar;
  crossbar: FrameBar;
  net: FrameNet;
}

export interface GoalFrameGeometry {
  left: GoalFrameSide;
  right: GoalFrameSide;
}

/**
 * Batch C — visible goal-frame geometry (Phaser-free, Vitest-testable).
 * Derives the drawn frame from the SAME config the detection zones and POST
 * bands use, so posts can never drift off the goal-mouth edges: the mouth
 * span is CENTER +/- HALF, posts center on the mouth edges (inside the POST
 * bands), and the cheap net protrudes NET_DEPTH_PX outward beyond each goal
 * line. MatchScene draws exactly these rects.
 */
export function goalFrameGeometry(
  frame: GoalFrameConfig = BALANCE_CONFIG.GOAL_FRAME,
  bands: GoalBandConfig = BALANCE_CONFIG.FEEDBACK,
): GoalFrameGeometry {
  const build = (goalX: number, outward: 1 | -1): GoalFrameSide => {
    const mouthTopY = bands.GOAL_MOUTH_CENTER_Y_PX - bands.GOAL_MOUTH_HALF_HEIGHT_PX;
    const mouthBottomY = bands.GOAL_MOUTH_CENTER_Y_PX + bands.GOAL_MOUTH_HALF_HEIGHT_PX;
    const mouthHeight = mouthBottomY - mouthTopY;
    const backX = goalX + outward * frame.NET_DEPTH_PX;
    const net: FrameNet =
      outward === 1
        ? { x1: goalX, x2: backX, top: mouthTopY, bottom: mouthBottomY }
        : { x1: backX, x2: goalX, top: mouthTopY, bottom: mouthBottomY };
    return {
      mouthTopY,
      mouthBottomY,
      zone: {
        cx: goalX,
        cy: bands.GOAL_MOUTH_CENTER_Y_PX,
        w: frame.GOAL_ZONE_WIDTH_PX,
        h: frame.GOAL_ZONE_HEIGHT_PX,
      },
      postTop: { cx: goalX, cy: mouthTopY, w: frame.POST_WIDTH_PX, h: frame.POST_WIDTH_PX },
      postBottom: { cx: goalX, cy: mouthBottomY, w: frame.POST_WIDTH_PX, h: frame.POST_WIDTH_PX },
      crossbar: {
        cx: backX,
        cy: bands.GOAL_MOUTH_CENTER_Y_PX,
        w: frame.POST_WIDTH_PX,
        h: mouthHeight,
      },
      net,
    };
  };
  // Left goal opens toward -x (net protrudes left), right goal toward +x.
  return { left: build(frame.LEFT_GOAL_X_PX, -1), right: build(frame.RIGHT_GOAL_X_PX, 1) };
}
