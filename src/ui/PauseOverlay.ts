import type Phaser from 'phaser';
import { BALANCE_CONFIG } from '../data/balance';
import { UI_TEXT } from '../data/uiText';
import type { PauseMenuModel, PauseRow } from '../match/pauseState';
import { pinHudObject } from './hudPin';

export type PauseOverlayConfig = typeof BALANCE_CONFIG.PAUSE;

/** Tap routing for the overlay rows (the scene drives the shared model). */
export interface PauseOverlayActions {
  /** A row was tapped: the scene moves the model cursor there and confirms. */
  onRowTap: (row: PauseRow) => void;
}

/**
 * In-match pause overlay (settings/pause batch) in the HalftimeBanner
 * overlay pattern: config-driven geometry/colors, screen-pinned, depth above
 * every gameplay banner. Two pages rendered from the shared PauseMenuModel —
 * main actions (CONTINUAR / REINICIAR PARTIDO / AJUSTES / SALIR AL MENÚ) and
 * the live-adjustments page (VOLUMEN + CLIMA, with the pre-match-only hint
 * for terreno/formación). Dumb view: all state lives in the model.
 */
export class PauseOverlay {
  private readonly cfg: PauseOverlayConfig;
  private readonly container: Phaser.GameObjects.Container;
  private readonly title: Phaser.GameObjects.Text;
  private readonly hint: Phaser.GameObjects.Text;
  private readonly rowTexts = new Map<PauseRow, Phaser.GameObjects.Text>();

  constructor(
    private readonly scene: Phaser.Scene,
    cfg: PauseOverlayConfig = BALANCE_CONFIG.PAUSE,
    private readonly actions?: PauseOverlayActions,
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
      .text(cfg.PANEL_CENTER_X_PX, cfg.PANEL_CENTER_Y_PX + cfg.TITLE_Y_PX, UI_TEXT.PAUSE.TITLE, {
        fontFamily: cfg.FONT_FAMILY,
        fontSize: cfg.TITLE_FONT_SIZE_PX,
        color: cfg.TEXT_COLOR,
      })
      .setOrigin(cfg.CENTER_ORIGIN, cfg.CENTER_ORIGIN);
    this.hint = scene.add
      .text(cfg.PANEL_CENTER_X_PX, cfg.PANEL_CENTER_Y_PX + cfg.HINT_Y_PX, UI_TEXT.PAUSE.SETTINGS_HINT, {
        fontFamily: cfg.FONT_FAMILY,
        fontSize: cfg.HINT_FONT_SIZE_PX,
        color: cfg.TEXT_COLOR,
      })
      .setOrigin(cfg.CENTER_ORIGIN, cfg.CENTER_ORIGIN)
      .setVisible(false);
    this.container = scene.add.container(cfg.PANEL_CENTER_X_PX, cfg.PANEL_CENTER_Y_PX, [
      bg,
      this.title,
      this.hint,
    ]);
    // Children carry absolute coords; recenter them into container space so
    // pinHudObject can move the whole overlay as one screen-pinned unit.
    for (const child of [bg, this.title, this.hint]) {
      child.x -= cfg.PANEL_CENTER_X_PX;
      child.y -= cfg.PANEL_CENTER_Y_PX;
    }
    this.container.setDepth(cfg.DEPTH);
    this.container.setVisible(false);
    this.container.setScrollFactor(cfg.SCROLL_FACTOR);
  }

  /**
   * Lazily materializes a row's text on first render (the row set is stable
   * per page, so widgets are created once and reused across pauses).
   */
  private ensureRow(row: PauseRow, index: number): Phaser.GameObjects.Text {
    const existing = this.rowTexts.get(row);
    if (existing) {
      return existing;
    }
    const cfg = this.cfg;
    const y = cfg.ROW_Y_START_PX + index * cfg.ROW_SPACING_PX;
    const text = this.scene.add
      .text(cfg.PANEL_CENTER_X_PX, cfg.PANEL_CENTER_Y_PX + y, '', {
        fontFamily: cfg.FONT_FAMILY,
        fontSize: cfg.ROW_FONT_SIZE_PX,
        color: cfg.TEXT_COLOR,
      })
      .setOrigin(cfg.CENTER_ORIGIN, cfg.CENTER_ORIGIN)
      .setInteractive();
    text.x -= cfg.PANEL_CENTER_X_PX;
    text.y -= cfg.PANEL_CENTER_Y_PX;
    text.on('pointerdown', () => this.actions?.onRowTap(row));
    this.container.add(text);
    this.rowTexts.set(row, text);
    return text;
  }

  /** Syncs every visible row's text/color to the model (transition-safe). */
  public render(model: PauseMenuModel): void {
    const rows = model.rows();
    for (const [i, row] of rows.entries()) {
      const text = this.ensureRow(row, i);
      const selected = i === model.cursor;
      const value = model.rowValueLabel(row);
      const label = selected
        ? `${this.cfg.SELECTED_MARKER}${model.rowLabel(row)}`
        : model.rowLabel(row);
      text.setText(value.length > 0 ? `${label}: ${value}` : label);
      text.setColor(selected ? this.cfg.SELECTED_COLOR : this.cfg.TEXT_COLOR);
      text.setVisible(true);
    }
    // Rows of the other page hide.
    for (const [row, text] of this.rowTexts) {
      if (!rows.includes(row)) {
        text.setVisible(false);
      }
    }
    this.hint.setVisible(model.page === 'settings');
  }

  public show(model: PauseMenuModel): void {
    this.render(model);
    this.container.setVisible(true);
  }

  public hide(): void {
    this.container.setVisible(false);
  }

  public get visible(): boolean {
    return this.container.visible;
  }

  /** Pins the overlay to the screen slot under the active camera zoom. */
  public pinToScreen(zoom: number, viewW: number, viewH: number): void {
    pinHudObject(this.container, this.cfg.PANEL_CENTER_X_PX, this.cfg.PANEL_CENTER_Y_PX, zoom, viewW, viewH);
  }
}
