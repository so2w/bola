import type Phaser from 'phaser';
import { BALANCE_CONFIG } from '../data/balance';

export type IndicatorConfig = typeof BALANCE_CONFIG.INDICATOR;

/**
 * Headless selection-mirror for the controlled-player indicator
 * (AGENTS.md sections 8 + 34). MatchScene feeds it on every selection swap;
 * the Phaser view follows whatever id is stored here, so the marker can
 * never lag behind the actual controlled player.
 */
export class ControlledIndicatorModel {
  private selectedId: string | null = null;

  public setSelectedId(id: string | null): void {
    this.selectedId = id;
  }

  public getSelectedId(): string | null {
    return this.selectedId;
  }
}

export interface IndicatorFrame {
  ring: { x: number; y: number; radius: number };
  /** Down-pointing triangle vertices (tip first, then base corners). */
  marker: { x: number; y: number; halfWidth: number; height: number };
}

const FULL_CIRCLE_RADIANS = Math.PI * 2;

/**
 * Pure geometry for one indicator frame: ground ring centered on the player
 * plus a floating triangle above that bobs deterministically with scene time
 * (no randomness, no Date.now — the caller passes the clock).
 */
export function indicatorFrame(
  cfg: IndicatorConfig,
  x: number,
  y: number,
  timeMs: number,
): IndicatorFrame {
  const phase = (timeMs / cfg.BOB_PERIOD_MS) * FULL_CIRCLE_RADIANS;
  const bob = Math.sin(phase) * cfg.BOB_AMPLITUDE_PX;
  return {
    ring: { x, y, radius: cfg.RING_RADIUS_PX },
    marker: {
      x,
      y: y + cfg.MARKER_Y_OFFSET_PX + bob,
      halfWidth: cfg.MARKER_WIDTH_PX / MARKER_HALF_DIVISOR,
      height: cfg.MARKER_HEIGHT_PX,
    },
  };
}

/** Halving divisor for marker half-width (arithmetic, not tuning). */
const MARKER_HALF_DIVISOR = 2;

/**
 * Phaser view: a single Graphics object redrawn every frame from
 * indicatorFrame(). Bright ring + marker with a dark outline pass underneath
 * so the marker reads on any kit color (AGENTS.md section 34).
 */
export class ControlledPlayerIndicator {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly cfg: IndicatorConfig;
  private target: { x: number; y: number } | null = null;

  constructor(scene: Phaser.Scene, cfg: IndicatorConfig = BALANCE_CONFIG.INDICATOR) {
    this.cfg = cfg;
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(cfg.DEPTH);
  }

  public setTarget(target: { x: number; y: number } | null): void {
    this.target = target;
  }

  public update(timeMs: number): void {
    const g = this.graphics;
    g.clear();
    if (!this.target) {
      return;
    }
    const frame = indicatorFrame(this.cfg, this.target.x, this.target.y, timeMs);
    // Dark outline passes first (contrast on any kit), bright passes on top.
    g.lineStyle(
      this.cfg.RING_WIDTH_PX + this.cfg.OUTLINE_WIDTH_PX,
      this.cfg.OUTLINE_COLOR,
      this.cfg.OUTLINE_ALPHA,
    );
    g.strokeCircle(frame.ring.x, frame.ring.y, frame.ring.radius);
    g.lineStyle(this.cfg.RING_WIDTH_PX, this.cfg.RING_COLOR, this.cfg.RING_ALPHA);
    g.strokeCircle(frame.ring.x, frame.ring.y, frame.ring.radius);
    const tip = { x: frame.marker.x, y: frame.marker.y + frame.marker.height };
    const left = { x: frame.marker.x - frame.marker.halfWidth, y: frame.marker.y };
    const right = { x: frame.marker.x + frame.marker.halfWidth, y: frame.marker.y };
    g.fillStyle(this.cfg.OUTLINE_COLOR, this.cfg.OUTLINE_ALPHA);
    g.fillTriangle(
      tip.x,
      tip.y + this.cfg.OUTLINE_WIDTH_PX,
      left.x - this.cfg.OUTLINE_WIDTH_PX,
      left.y,
      right.x + this.cfg.OUTLINE_WIDTH_PX,
      right.y,
    );
    g.fillStyle(this.cfg.MARKER_COLOR, this.cfg.MARKER_ALPHA);
    g.fillTriangle(tip.x, tip.y, left.x, left.y, right.x, right.y);
  }
}
