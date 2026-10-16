import type Phaser from 'phaser';
import { BALANCE_CONFIG } from '../data/balance';
import type { HalftimeBannerData } from './HalftimeBanner';
import { pinHudObject } from './hudPin';

export type FulltimeBannerConfig = typeof BALANCE_CONFIG.FULLTIME_BANNER;

/** Batch B1: full-time payload reuses the halftime stats shape. */
export type FulltimeBannerData = HalftimeBannerData;

function teamLine(
  cfg: FulltimeBannerConfig,
  label: string,
  s: { goals: number; shots: number; passesCompleted: number; possessionPct: number },
): string {
  return `${label} ${cfg.GOALS_ABBR}:${s.goals} ${cfg.SHOTS_ABBR}:${s.shots} ${cfg.PASSES_ABBR}:${s.passesCompleted} ${Math.round(s.possessionPct)}%`;
}

/**
 * Phaser overlay for the terminal RESULTS state (Batch B1): big score,
 * per-team stats lines, and a single "Jugar de nuevo" replay action back to
 * INTRO. All geometry, colors and copy come from BALANCE_CONFIG.FULLTIME_BANNER.
 */
export class FulltimeBanner {
  private readonly container: Phaser.GameObjects.Container;
  private readonly score: Phaser.GameObjects.Text;
  private readonly homeLine: Phaser.GameObjects.Text;
  private readonly awayLine: Phaser.GameObjects.Text;
  private readonly cfg: FulltimeBannerConfig;

  constructor(
    private readonly scene: Phaser.Scene,
    cfg: FulltimeBannerConfig = BALANCE_CONFIG.FULLTIME_BANNER,
    onReplay?: () => void,
  ) {
    this.cfg = cfg;
    const bg = scene.add.rectangle(
      cfg.PANEL_CENTER_X_PX,
      cfg.PANEL_CENTER_Y_PX,
      cfg.PANEL_W_PX,
      cfg.PANEL_H_PX,
      cfg.BG_COLOR,
      cfg.BG_ALPHA,
    );
    const title = scene.add
      .text(cfg.PANEL_CENTER_X_PX, cfg.TITLE_Y_PX, cfg.TITLE_TEXT, {
        fontFamily: cfg.FONT_FAMILY,
        fontSize: cfg.TITLE_FONT_SIZE_PX,
        color: cfg.TEXT_COLOR,
      })
      .setOrigin(cfg.CENTER_ORIGIN, cfg.TITLE_ORIGIN_Y);
    this.score = scene.add
      .text(cfg.PANEL_CENTER_X_PX, cfg.SCORE_Y_PX, cfg.SCORE_PLACEHOLDER, {
        fontFamily: cfg.FONT_FAMILY,
        fontSize: cfg.SCORE_FONT_SIZE_PX,
        color: cfg.TEXT_COLOR,
      })
      .setOrigin(cfg.CENTER_ORIGIN, cfg.CENTER_ORIGIN);
    const note = scene.add
      .text(cfg.PANEL_CENTER_X_PX, cfg.NOTE_Y_PX, cfg.NOTE_TEXT, {
        fontFamily: cfg.FONT_FAMILY,
        fontSize: cfg.BODY_FONT_SIZE_PX,
        color: cfg.ACCENT_COLOR,
      })
      .setOrigin(cfg.CENTER_ORIGIN, cfg.CENTER_ORIGIN);
    this.homeLine = scene.add
      .text(cfg.PANEL_CENTER_X_PX, cfg.HOME_LINE_Y_PX, cfg.SCORE_PLACEHOLDER, {
        fontFamily: cfg.FONT_FAMILY,
        fontSize: cfg.BODY_FONT_SIZE_PX,
        color: cfg.TEXT_COLOR,
      })
      .setOrigin(cfg.CENTER_ORIGIN, cfg.CENTER_ORIGIN);
    this.awayLine = scene.add
      .text(cfg.PANEL_CENTER_X_PX, cfg.AWAY_LINE_Y_PX, cfg.SCORE_PLACEHOLDER, {
        fontFamily: cfg.FONT_FAMILY,
        fontSize: cfg.BODY_FONT_SIZE_PX,
        color: cfg.TEXT_COLOR,
      })
      .setOrigin(cfg.CENTER_ORIGIN, cfg.CENTER_ORIGIN);
    const replayBtn = scene.add
      .text(cfg.PANEL_CENTER_X_PX, cfg.REPLAY_Y_PX, cfg.REPLAY_LABEL, {
        fontFamily: cfg.FONT_FAMILY,
        fontSize: cfg.BUTTON_FONT_SIZE_PX,
        color: cfg.BUTTON_TEXT_COLOR,
        backgroundColor: cfg.BUTTON_BG_COLOR,
        padding: cfg.BUTTON_PADDING,
      })
      .setOrigin(cfg.CENTER_ORIGIN, cfg.CENTER_ORIGIN)
      .setInteractive();
    replayBtn.on('pointerdown', () => onReplay?.());
    this.container = scene.add.container(cfg.PANEL_CENTER_X_PX, cfg.PANEL_CENTER_Y_PX, [
      bg,
      title,
      this.score,
      note,
      this.homeLine,
      this.awayLine,
      replayBtn,
    ]);
    for (const child of [bg, title, this.score, note, this.homeLine, this.awayLine, replayBtn]) {
      child.x -= cfg.PANEL_CENTER_X_PX;
      child.y -= cfg.PANEL_CENTER_Y_PX;
    }
    this.container.setDepth(cfg.DEPTH);
    this.container.setVisible(false);
    this.container.setScrollFactor(cfg.SCROLL_FACTOR);
  }

  public show(data: FulltimeBannerData): void {
    this.score.setText(`${data.score.home}${this.cfg.SCORE_SEPARATOR}${data.score.away}`);
    this.homeLine.setText(teamLine(this.cfg, this.cfg.HOME_LABEL, data.stats.home));
    this.awayLine.setText(teamLine(this.cfg, this.cfg.AWAY_LABEL, data.stats.away));
    this.container.setVisible(true);
  }

  public hide(): void {
    this.container.setVisible(false);
  }

  public get visible(): boolean {
    return this.container.visible;
  }

  /** Pins the banner to the screen slot under the active camera zoom. */
  public pinToScreen(zoom: number, viewW: number, viewH: number): void {
    pinHudObject(this.container, this.cfg.PANEL_CENTER_X_PX, this.cfg.PANEL_CENTER_Y_PX, zoom, viewW, viewH);
  }
}
