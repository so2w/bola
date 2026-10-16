import type Phaser from 'phaser';
import { BALANCE_CONFIG } from '../data/balance';
import type { MatchStatsSnapshot } from '../match/MatchStats';
import { pinHudObject } from './hudPin';

export type HalftimeBannerConfig = typeof BALANCE_CONFIG.HALFTIME_BANNER;

export interface HalftimeBannerData {
  score: { home: number; away: number };
  stats: {
    home: { goals: number; shots: number; passesCompleted: number; possessionPct: number };
    away: { goals: number; shots: number; passesCompleted: number; possessionPct: number };
  };
}

/**
 * Pure banner payload (Batch A, headless-testable): score plus per-team
 * goals/shots/passes and possession shares derived from the stats snapshot.
 */
export function halftimeBannerData(
  score: { home: number; away: number },
  stats: MatchStatsSnapshot,
): HalftimeBannerData {
  const total = stats.home.possessionMs + stats.away.possessionMs;
  const pct = (ms: number): number => (total <= 0 ? 50 : (ms / total) * 100);
  return {
    score: { ...score },
    stats: {
      home: {
        goals: stats.home.goals,
        shots: stats.home.shots,
        passesCompleted: stats.home.passesCompleted,
        possessionPct: pct(stats.home.possessionMs),
      },
      away: {
        goals: stats.away.goals,
        shots: stats.away.shots,
        passesCompleted: stats.away.passesCompleted,
        possessionPct: pct(stats.away.possessionMs),
      },
    },
  };
}

function teamLine(
  cfg: HalftimeBannerConfig,
  label: string,
  s: { goals: number; shots: number; passesCompleted: number; possessionPct: number },
): string {
  return `${label} ${cfg.GOALS_ABBR}:${s.goals} ${cfg.SHOTS_ABBR}:${s.shots} ${cfg.PASSES_ABBR}:${s.passesCompleted} ${Math.round(s.possessionPct)}%`;
}

/**
 * Phaser overlay for the HALF pause (Batch A): big score, second-half note,
 * per-team stats, and Continuar / Reiniciar buttons. All geometry, colors
 * and copy come from BALANCE_CONFIG.HALFTIME_BANNER — no literals here.
 */
export class HalftimeBanner {
  private readonly container: Phaser.GameObjects.Container;
  private readonly title: Phaser.GameObjects.Text;
  private readonly score: Phaser.GameObjects.Text;
  private readonly note: Phaser.GameObjects.Text;
  private readonly homeLine: Phaser.GameObjects.Text;
  private readonly awayLine: Phaser.GameObjects.Text;
  private readonly cfg: HalftimeBannerConfig;

  constructor(
    private readonly scene: Phaser.Scene,
    cfg: HalftimeBannerConfig = BALANCE_CONFIG.HALFTIME_BANNER,
    onContinue?: () => void,
    onRestart?: () => void,
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
    this.title = scene.add
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
    this.note = scene.add
      .text(cfg.PANEL_CENTER_X_PX, cfg.NOTE_Y_PX, cfg.SECOND_HALF_NOTE_TEXT, {
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
    const continueBtn = scene.add
      .text(cfg.PANEL_CENTER_X_PX, cfg.CONTINUE_Y_PX, cfg.CONTINUE_LABEL, {
        fontFamily: cfg.FONT_FAMILY,
        fontSize: cfg.BUTTON_FONT_SIZE_PX,
        color: cfg.BUTTON_TEXT_COLOR,
        backgroundColor: cfg.BUTTON_BG_COLOR,
        padding: cfg.BUTTON_PADDING,
      })
      .setOrigin(cfg.CENTER_ORIGIN, cfg.CENTER_ORIGIN)
      .setInteractive();
    continueBtn.on('pointerdown', () => onContinue?.());
    const restartBtn = scene.add
      .text(cfg.PANEL_CENTER_X_PX, cfg.RESTART_Y_PX, cfg.RESTART_LABEL, {
        fontFamily: cfg.FONT_FAMILY,
        fontSize: cfg.BUTTON_FONT_SIZE_PX,
        color: cfg.BUTTON_TEXT_COLOR,
        backgroundColor: cfg.BUTTON_BG_COLOR,
        padding: cfg.BUTTON_PADDING,
      })
      .setOrigin(cfg.CENTER_ORIGIN, cfg.CENTER_ORIGIN)
      .setInteractive();
    restartBtn.on('pointerdown', () => onRestart?.());
    this.container = scene.add.container(cfg.PANEL_CENTER_X_PX, cfg.PANEL_CENTER_Y_PX, [
      bg,
      this.title,
      this.score,
      this.note,
      this.homeLine,
      this.awayLine,
      continueBtn,
      restartBtn,
    ]);
    // Children carry absolute coords; recenter them into container space so
    // pinHudObject can move the whole panel as one screen-pinned unit.
    for (const child of [bg, this.title, this.score, this.note, this.homeLine, this.awayLine, continueBtn, restartBtn]) {
      child.x -= cfg.PANEL_CENTER_X_PX;
      child.y -= cfg.PANEL_CENTER_Y_PX;
    }
    this.container.setDepth(cfg.DEPTH);
    this.container.setVisible(false);
    this.container.setScrollFactor(cfg.SCROLL_FACTOR);
  }

  public show(data: HalftimeBannerData): void {
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
