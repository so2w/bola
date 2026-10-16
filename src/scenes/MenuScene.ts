import Phaser from 'phaser';
import { BALANCE_CONFIG } from '../data/balance';
import { UI_TEXT } from '../data/uiText';
import {
  adjustSelected,
  createSettingsMenu,
  currentSettings,
  moveCursor,
  resolveMatchInitData,
  type MatchSettings,
  type SettingsMenuModel,
} from '../match/settingsModel';

/**
 * MenuScene — lightweight pre-match settings menu (settings/pause batch).
 * BootScene lands here instead of starting the match cold: the player picks
 * TERRENO / CLIMA / FORMACIÓN / DURACIÓN / VOLUMEN and presses JUGAR, which
 * starts MatchScene with the resolved scene data. Navigation works with
 * keyboard (arrows + Enter) AND touch taps (every row is interactive).
 * Session-only: incoming init data may restore a previous session's settings
 * (e.g. coming back from the pause menu's SALIR AL MENÚ); persistence is a
 * Phase 6 SaveGame OPEN QUESTION.
 */
export class MenuScene extends Phaser.Scene {
  private model!: SettingsMenuModel;
  private rowTexts: Phaser.GameObjects.Text[] = [];
  private initialSettings: MatchSettings | undefined;

  constructor() {
    super('MenuScene');
  }

  public init(data?: { settings?: MatchSettings }): void {
    this.initialSettings = data?.settings;
  }

  public create(): void {
    const cfg = BALANCE_CONFIG.MENU;
    this.model = createSettingsMenu(this.initialSettings ?? undefined);

    this.add
      .text(cfg.TITLE_X_PX, cfg.TITLE_Y_PX, UI_TEXT.MENU.TITLE, {
        fontFamily: cfg.FONT_FAMILY,
        fontSize: cfg.TITLE_FONT_SIZE_PX,
        color: cfg.TITLE_COLOR,
      })
      .setOrigin(0.5)
      .setDepth(cfg.DEPTH);

    this.rowTexts = this.model.rows.map((row) => {
      const isPlay = row.id === 'play';
      const text = this.add
        .text(cfg.ROW_X_PX, cfg.ROW_Y_START_PX + this.model.rows.indexOf(row) * cfg.ROW_SPACING_PX, row.label, {
          fontFamily: cfg.FONT_FAMILY,
          fontSize: isPlay ? cfg.PLAY_FONT_SIZE_PX : cfg.ROW_FONT_SIZE_PX,
          color: isPlay ? cfg.PLAY_TEXT_COLOR : cfg.ROW_COLOR,
          ...(isPlay ? { backgroundColor: cfg.PLAY_BG_COLOR, padding: cfg.BUTTON_PADDING } : {}),
        })
        .setOrigin(0.5)
        .setDepth(cfg.DEPTH)
        .setInteractive();
      text.on('pointerdown', () => this.onRowTap(row.id));
      return text;
    });

    this.add
      .text(cfg.ROW_X_PX, cfg.HINT_Y_PX, UI_TEXT.MENU.NAV_HINT, {
        fontFamily: cfg.FONT_FAMILY,
        fontSize: cfg.HINT_FONT_SIZE_PX,
        color: cfg.HINT_COLOR,
        backgroundColor: cfg.HINT_BG_COLOR,
      })
      .setOrigin(0.5)
      .setDepth(cfg.DEPTH);

    // Keyboard navigation: arrows move/adjust, Enter plays from JUGAR.
    this.input.keyboard?.on('keydown-UP', () => this.navigate(-1));
    this.input.keyboard?.on('keydown-DOWN', () => this.navigate(1));
    this.input.keyboard?.on('keydown-LEFT', () => this.adjust(-1));
    this.input.keyboard?.on('keydown-RIGHT', () => this.adjust(1));
    this.input.keyboard?.on('keydown-ENTER', () => this.confirmKeyboard());

    this.refresh();
  }

  /** Keyboard: move the cursor (refresh only — no value change). */
  private navigate(delta: number): void {
    moveCursor(this.model, delta);
    this.refresh();
  }

  /** Keyboard/touch value cycling on the selected row. */
  private adjust(delta: number): void {
    adjustSelected(this.model, delta);
    this.refresh();
  }

  /** Enter: play only from the JUGAR row; otherwise cycle the row value. */
  private confirmKeyboard(): void {
    if (this.model.rows[this.model.cursor]?.id === 'play') {
      this.startMatch();
    } else {
      this.adjust(1);
    }
  }

  /** Tap: jump the cursor to the row, then cycle it (JUGAR starts instead). */
  private onRowTap(rowId: string): void {
    const index = this.model.rows.findIndex((r) => r.id === rowId);
    if (index < 0) {
      return;
    }
    this.model.cursor = index;
    if (rowId === 'play') {
      this.startMatch();
      return;
    }
    this.adjust(1);
  }

  /** Starts MatchScene with the chosen settings (formation for both teams). */
  private startMatch(): void {
    this.scene.start('MatchScene', resolveMatchInitData(currentSettings(this.model)));
  }

  /** Repaints every row: cursor marker, selection color, current value. */
  private refresh(): void {
    const cfg = BALANCE_CONFIG.MENU;
    for (const [i, text] of this.rowTexts.entries()) {
      const row = this.model.rows[i];
      const selected = i === this.model.cursor;
      const settingIdx = this.settingIndexOf(row.id);
      const value =
        row.id === 'play'
          ? ''
          : settingIdx >= 0
          ? row.optionLabels[this.model.values[settingIdx]] ?? ''
          : '';
      const base = value.length > 0 ? `${row.label}: ${value}` : row.label;
      text.setText(selected ? `${cfg.CURSOR_PREFIX}${base}` : base);
      if (row.id !== 'play') {
        text.setColor(selected ? cfg.SELECTED_COLOR : cfg.ROW_COLOR);
      }
    }
  }

  /** Index of a setting row among the setting rows (values[] parallel). */
  private settingIndexOf(rowId: string): number {
    return this.model.rows.filter((r) => r.id !== 'play').findIndex((r) => r.id === rowId);
  }
}
