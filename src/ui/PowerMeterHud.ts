import Phaser from 'phaser';
import { BALANCE_CONFIG } from '../data/balance';
import { pinHudObject } from './hudPin';

/** PM-1-S3: power clamps to [0,1] and scales into meter bounds. Pure helper. */
export function meterFillWidth(power: number, widthPx: number): number {
  const clamped = Math.max(0, Math.min(1, power));
  return clamped * widthPx;
}

/**
 * Fase 4 Slice 1 (PM-1): charge power meter HUD.
 *
 *   Two rectangles (bg + fill) at a fixed bottom-center slot; position/geometry/colors
 * come from BALANCE_CONFIG.POWER_METER. Visible only while the controlled
 * player is charging (PM-1-S2).
 *
 * Zoom handling (playtest HUD fix): the meter is a screen-pinned HUD object,
 * never a world object — the simplest reliable clamp against rendering
 * offscreen. MatchScene calls pinToScreen() with the active zoom so the meter
 * never leaves its bottom-center slot at any zoom level.
 */
export class PowerMeterHud {
  private readonly container: Phaser.GameObjects.Container;
  private readonly fill: Phaser.GameObjects.Rectangle;
  private readonly cfg: typeof BALANCE_CONFIG.POWER_METER;

  constructor(scene: Phaser.Scene, cfg = BALANCE_CONFIG.POWER_METER) {
    this.cfg = cfg;
    // Children live in container-local coords so pinToScreen() can counter-scale
    // the whole container without displacing them (bg centered, fill left-anchored).
    const bg = scene.add.rectangle(0, 0, cfg.WIDTH_PX, cfg.HEIGHT_PX, 0x222222, 0.8);
    // Fill anchored at the left edge so width scaling grows rightward.
    this.fill = scene.add
      .rectangle(-cfg.WIDTH_PX / 2, 0, 0, cfg.HEIGHT_PX, cfg.COLOR_LOW)
      .setOrigin(0, 0.5);

    this.container = scene.add.container(0, 0, [bg, this.fill]);
    this.container.setScrollFactor(0);
    this.container.setDepth(20);
    this.container.setVisible(false);
  }

  /** Pins the meter to its screen slot under the active camera zoom. */
  public pinToScreen(zoom: number, viewW: number, viewH: number): void {
    const centerX = BALANCE_CONFIG.PHYSICS.PITCH_WIDTH / 2;
    const y = BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT + this.cfg.Y_OFFSET_PX;
    pinHudObject(this.container, centerX, y, zoom, viewW, viewH);
  }

  /** Called each frame after the controlled player's preUpdate. */
  public update(power: number, charging: boolean): void {
    this.container.setVisible(charging);
    if (!charging) {
      return;
    }
    const width = meterFillWidth(power, this.cfg.WIDTH_PX);
    this.fill.width = width;
    // Green -> red lerp across the configured stops.
    const low = Phaser.Display.Color.IntegerToColor(this.cfg.COLOR_LOW);
    const high = Phaser.Display.Color.IntegerToColor(this.cfg.COLOR_HIGH);
    const color = Phaser.Display.Color.Interpolate.ColorWithColor(
      low,
      high,
      100,
      Math.round(meterFillWidth(power, 100)),
    );
    this.fill.setFillStyle((color.r << 16) | (color.g << 8) | color.b);
  }
}
