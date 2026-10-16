import Phaser from 'phaser';

/**
 * Presentation tuning for the follow camera (PRES-1). All fields optional;
 * when `zoom`/`worldWidth`/`worldHeight` are omitted the controller keeps the
 * legacy behavior (no zoom call, unclamped scroll) so existing hosts/tests are
 * unaffected.
 */
export interface CameraOptions {
  /** Zoom applied once at construction (no per-frame zoom animation). */
  zoom?: number;
  /** Weight of the controlled player position in the follow target. */
  playerWeight?: number;
  /** Weight of the ball position in the follow target. */
  ballWeight?: number;
  /** Visible dead space allowed beyond the pitch edge, in px. */
  clampMargin?: number;
  /** World bounds used to clamp the view (omit to disable clamping). */
  worldWidth?: number;
  worldHeight?: number;
}

export class CameraController {
  private camera: Phaser.Cameras.Scene2D.Camera;
  private lerpFactor: number;
  private lookAheadWeight: number;
  private playerWeight: number;
  private ballWeight: number;
  private clampMargin: number;
  private worldWidth?: number;
  private worldHeight?: number;
  private zoom: number;

  constructor(
    camera: Phaser.Cameras.Scene2D.Camera,
    lerpFactor = 0.08,
    lookAheadWeight = 0.15,
    options: CameraOptions = {},
  ) {
    this.camera = camera;
    this.lerpFactor = lerpFactor;
    this.lookAheadWeight = lookAheadWeight;
    this.playerWeight = options.playerWeight ?? 0.4;
    this.ballWeight = options.ballWeight ?? 0.6;
    this.clampMargin = options.clampMargin ?? 0;
    this.worldWidth = options.worldWidth;
    this.worldHeight = options.worldHeight;
    this.zoom = options.zoom ?? 1;
    if (options.zoom !== undefined && typeof (camera as any).setZoom === 'function') {
      (camera as any).setZoom(options.zoom);
    }
  }

  /**
   * Phase 4 Batch A (section 30): live lerp override for the debug tuning
   * knob. Non-finite or non-positive factors are ignored (never NaN).
   */
  public setLerp(factor: number): void {
    if (Number.isFinite(factor) && factor > 0) {
      this.lerpFactor = factor;
    }
  }

  public update(
    playerPos: { x: number; y: number },
    ballPos: { x: number; y: number },
    ballVel: { x: number; y: number }
  ): void {
    // Target position weighted between player and ball
    const midX = playerPos.x * this.playerWeight + ballPos.x * this.ballWeight;
    const midY = playerPos.y * this.playerWeight + ballPos.y * this.ballWeight;

    // Apply look-ahead vector based on ball velocity
    const targetX = midX + ballVel.x * this.lookAheadWeight;
    const targetY = midY + ballVel.y * this.lookAheadWeight;

    // Smoothly scroll camera (lerp window: no snap on player switch)
    const currentScrollX = this.camera.scrollX + this.camera.width / 2;
    const currentScrollY = this.camera.scrollY + this.camera.height / 2;

    const newX = currentScrollX + (targetX - currentScrollX) * this.lerpFactor;
    const newY = currentScrollY + (targetY - currentScrollY) * this.lerpFactor;

    const [clampedX, clampedY] = this.clampToWorld(newX, newY);
    this.camera.centerOn(clampedX, clampedY);
  }

  /**
   * PRES-1 edge scenario: the camera center must stay within
   * [viewHalf - margin, world - viewHalf + margin] so the view never shows
   * more than `clampMargin` px of out-of-bounds dead space. Degenerate case
   * (view wider than the world) pins the view to the world center.
   */
  private clampToWorld(x: number, y: number): [number, number] {
    if (this.worldWidth === undefined || this.worldHeight === undefined) {
      return [x, y];
    }
    const halfW = this.camera.width / (2 * this.zoom);
    const halfH = this.camera.height / (2 * this.zoom);
    const clampAxis = (v: number, half: number, world: number): number => {
      if (half * 2 >= world + 2 * this.clampMargin) {
        return world / 2;
      }
      return Math.min(Math.max(v, half - this.clampMargin), world - half + this.clampMargin);
    };
    return [clampAxis(x, halfW, this.worldWidth), clampAxis(y, halfH, this.worldHeight)];
  }
}
