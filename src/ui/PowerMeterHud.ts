import Phaser from 'phaser';
import { BALANCE_CONFIG } from '../data/balance';

/** PM-1-S3: power clamps to [0,1] and scales into meter bounds. Pure helper. */
export function meterFillWidth(power: number, widthPx: number): number {
  const clamped = Math.max(0, Math.min(1, power));
  return clamped * widthPx;
}

/**
 * Fase 4 Slice 1 (PM-1): charge power meter HUD.
 *
 * Two rectangles (bg + fill) pinned to the screen (scrollFactor 0) at a fixed
 * bottom-center slot; position/geometry/colors come from BALANCE_CONFIG.POWER_METER.
 * Visible only while the controlled player is charging (PM-1-S2).
 */
export class PowerMeterHud {
  private readonly container: Phaser.GameObjects.Container;
  private readonly fill: Phaser.GameObjects.Rectangle;
  private readonly cfg: typeof BALANCE_CONFIG.POWER_METER;

  constructor(scene: Phaser.Scene, cfg = BALANCE_CONFIG.POWER_METER) {
    this.cfg = cfg;
    const centerX = BALANCE_CONFIG.PHYSICS.PITCH_WIDTH / 2;
    const y = BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT + cfg.Y_OFFSET_PX;

    const bg = scene.add.rectangle(centerX, y, cfg.WIDTH_PX, cfg.HEIGHT_PX, 0x222222, 0.8);
    // Fill anchored at the left edge so width scaling grows rightward.
    this.fill = scene.add
      .rectangle(centerX - cfg.WIDTH_PX / 2, y, 0, cfg.HEIGHT_PX, cfg.COLOR_LOW)
      .setOrigin(0, 0.5);

    this.container = scene.add.container(0, 0, [bg, this.fill]);
    this.container.setScrollFactor(0);
    this.container.setDepth(20);
    this.container.setVisible(false);
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
    const color = Phaser.Display.Color.Interpolate.ColorWithColor(
      { r: (this.cfg.COLOR_LOW >> 16) & 0xff, g: (this.cfg.COLOR_LOW >> 8) & 0xff, b: this.cfg.COLOR_LOW & 0xff },
      {
        r: (this.cfg.COLOR_HIGH >> 16) & 0xff,
        g: (this.cfg.COLOR_HIGH >> 8) & 0xff,
        b: this.cfg.COLOR_HIGH & 0xff,
      },
      100,
      Math.round(meterFillWidth(power, 100)),
    );
    this.fill.setFillStyle((color.r << 16) | (color.g << 8) | color.b);
  }
}
