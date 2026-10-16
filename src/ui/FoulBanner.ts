import type Phaser from 'phaser';
import { BALANCE_CONFIG } from '../data/balance';
import { pinHudObject } from './hudPin';

export type FoulBannerConfig = typeof BALANCE_CONFIG.FOUL_BANNER;
export type FoulBannerKind = 'FREE_KICK' | 'PENALTY';

export interface FoulBannerPayload {
  text: string;
  durationMs: number;
}

/**
 * Pure banner payload (Batch C, headless-testable): the transient copy for a
 * foul award plus its on-screen lifetime. FREE_KICK -> FALTA, PENALTY -> PENAL.
 */
export function foulBannerData(
  kind: FoulBannerKind,
  cfg: FoulBannerConfig = BALANCE_CONFIG.FOUL_BANNER,
): FoulBannerPayload {
  return {
    text: kind === 'PENALTY' ? cfg.PENALTY_TEXT : cfg.FREE_KICK_TEXT,
    durationMs: cfg.DURATION_MS,
  };
}

/**
 * Phaser overlay for the foul whistle (Batch C): a small transient banner in
 * the HalftimeBanner overlay pattern (config-driven geometry/colors/copy,
 * screen-pinned, depth-sorted). show() replaces any live banner so rapid
 * whistles never stack; the banner auto-hides after DURATION_MS.
 */
export class FoulBanner {
  private readonly container: Phaser.GameObjects.Container;
  private readonly label: Phaser.GameObjects.Text;
  private readonly cfg: FoulBannerConfig;
  private timer: Phaser.Time.TimerEvent | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    cfg: FoulBannerConfig = BALANCE_CONFIG.FOUL_BANNER,
  ) {
    this.cfg = cfg;
    const bg = scene.add.rectangle(
      cfg.CENTER_X_PX,
      cfg.CENTER_Y_PX,
      cfg.PANEL_W_PX,
      cfg.PANEL_H_PX,
      cfg.BG_COLOR,
      cfg.BG_ALPHA,
    );
    this.label = scene.add
      .text(cfg.CENTER_X_PX, cfg.CENTER_Y_PX, cfg.FREE_KICK_TEXT, {
        fontFamily: cfg.FONT_FAMILY,
        fontSize: cfg.FONT_SIZE_PX,
        color: cfg.TEXT_COLOR,
      })
      .setOrigin(cfg.CENTER_ORIGIN, cfg.CENTER_ORIGIN);
    this.container = scene.add.container(cfg.CENTER_X_PX, cfg.CENTER_Y_PX, [bg, this.label]);
    // Children carry absolute coords; recenter them into container space so
    // pinHudObject can move the whole banner as one screen-pinned unit.
    for (const child of [bg, this.label]) {
      child.x -= cfg.CENTER_X_PX;
      child.y -= cfg.CENTER_Y_PX;
    }
    this.container.setDepth(cfg.DEPTH);
    this.container.setVisible(false);
    this.container.setScrollFactor(cfg.SCROLL_FACTOR);
  }

  public show(kind: FoulBannerKind): void {
    const payload = foulBannerData(kind, this.cfg);
    this.timer?.remove();
    this.label.setText(payload.text);
    this.container.setVisible(true);
    this.timer = this.scene.time.delayedCall(payload.durationMs, () => this.hide());
  }

  public hide(): void {
    this.timer?.remove();
    this.timer = null;
    this.container.setVisible(false);
  }

  public get visible(): boolean {
    return this.container.visible;
  }

  /** Pins the banner to the screen slot under the active camera zoom. */
  public pinToScreen(zoom: number, viewW: number, viewH: number): void {
    pinHudObject(this.container, this.cfg.CENTER_X_PX, this.cfg.CENTER_Y_PX, zoom, viewW, viewH);
  }
}
