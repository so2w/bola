import { BALANCE_CONFIG } from '../data/balance';
import { UI_TEXT } from '../data/uiText';
import type { MatchState } from '../systems/MatchManager';
import type { WeatherType } from './WeatherSystem';
import type { MatchSettings } from './settingsModel';
import { volumeLabel } from './settingsModel';

/**
 * Pause state machine (settings/pause/Spanish-UI batch) — pure and
 * Phaser-free. Pause is SCENE GATING, never a MatchManager state: while
 * paused the scene stops calling manager.update(), so every clock/timer
 * freezes and the match resumes from the exact same state (no wedge).
 */

/** Terminal states: the results panel is already final, pausing is rejected. */
const TERMINAL_MATCH_STATES: readonly MatchState[] = ['FULL_TIME', 'RESULTS', 'GAME_OVER'];

/** Whether the match may be paused from this state (any non-terminal one). */
export function canPauseMatch(state: MatchState | undefined): boolean {
  return state !== undefined && !TERMINAL_MATCH_STATES.includes(state);
}

export type PauseMainRow = 'resume' | 'restart' | 'settings' | 'quit';
export type PauseSettingsRow = 'volume' | 'weather' | 'back';
export type PauseRow = PauseMainRow | PauseSettingsRow;

/** Result of confirm(): what the scene must do (null = value row cycled). */
export type PauseAction = PauseMainRow | 'back' | null;

/** Live-adjustment change reported by adjust() for the scene to apply. */
export interface PauseAdjustChange {
  volume?: number;
  weather?: WeatherType;
}

const MAIN_ROWS: readonly PauseMainRow[] = ['resume', 'restart', 'settings', 'quit'];
const SETTINGS_ROWS: readonly PauseSettingsRow[] = ['volume', 'weather', 'back'];

/**
 * Pause overlay menu model: a main page (4 actions) and a settings page with
 * the two live-adjustable values (volume + clima — terreno/formación are
 * pre-match only, communicated via UI hint). All labels come from UI_TEXT.
 */
export class PauseMenuModel {
  public page: 'main' | 'settings' = 'main';
  public cursor = 0;
  private volumeIndex: number;
  private weatherIndex: number;

  constructor(settings: MatchSettings) {
    const S = BALANCE_CONFIG.SETTINGS;
    this.volumeIndex = Math.max(0, S.VOLUME_STEPS.indexOf(settings.volume));
    this.weatherIndex = Math.max(0, S.WEATHER_ORDER.indexOf(settings.weather));
  }

  /** Rows of the current page. */
  public rows(): readonly PauseRow[] {
    return this.page === 'main' ? MAIN_ROWS : SETTINGS_ROWS;
  }

  /** Moves the cursor with wrap-around within the current page. */
  public move(delta: number): void {
    const n = this.rows().length;
    this.cursor = ((this.cursor + delta) % n + n) % n;
  }

  /** Opens the live-adjustments page (AJUSTES). */
  public openSettings(): void {
    this.page = 'settings';
    this.cursor = 0;
  }

  /** Closes the live-adjustments page (VOLVER). */
  public closeSettings(): void {
    this.page = 'main';
    this.cursor = 0;
  }

  /**
   * Adjusts the selected settings-page row (volume/weather) and reports the
   * change for the scene to apply live. Anything else is a no-op.
   */
  public adjust(delta: number): PauseAdjustChange | null {
    const row = this.rows()[this.cursor];
    if (row === 'volume') {
      const steps = BALANCE_CONFIG.SETTINGS.VOLUME_STEPS;
      const n = steps.length;
      this.volumeIndex = ((this.volumeIndex + delta) % n + n) % n;
      return { volume: steps[this.volumeIndex] };
    }
    if (row === 'weather') {
      const order = BALANCE_CONFIG.SETTINGS.WEATHER_ORDER;
      const n = order.length;
      this.weatherIndex = ((this.weatherIndex + delta) % n + n) % n;
      return { weather: order[this.weatherIndex] };
    }
    return null;
  }

  /**
   * Activates the selected row: action rows return their action; value rows
   * (volume/weather) cycle forward and return null — Enter behaves as
   * "adjust" there, mirroring the pre-match menu.
   */
  public confirm(): PauseAction {
    const row = this.rows()[this.cursor];
    if (row === 'volume' || row === 'weather') {
      this.adjust(1);
      return null;
    }
    if (row === 'back') {
      this.closeSettings();
      return 'back';
    }
    return row;
  }

  /** Current volume step value (rendered by the overlay). */
  public volumeValue(): number {
    return BALANCE_CONFIG.SETTINGS.VOLUME_STEPS[this.volumeIndex];
  }

  /** Current weather type (rendered by the overlay). */
  public weatherValue(): WeatherType {
    return BALANCE_CONFIG.SETTINGS.WEATHER_ORDER[this.weatherIndex];
  }

  /** Spanish label of a row (action rows and value rows alike). */
  public rowLabel(row: PauseRow): string {
    switch (row) {
      case 'resume':
        return UI_TEXT.PAUSE.RESUME;
      case 'restart':
        return UI_TEXT.PAUSE.RESTART;
      case 'settings':
        return UI_TEXT.PAUSE.SETTINGS;
      case 'quit':
        return UI_TEXT.PAUSE.QUIT;
      case 'back':
        return UI_TEXT.PAUSE.BACK;
      case 'volume':
        return UI_TEXT.PAUSE.ROWS.VOLUME;
      case 'weather':
        return UI_TEXT.PAUSE.ROWS.WEATHER;
    }
  }

  /** Value suffix for the settings-page rows ('50%' / 'Lluvia'), or ''. */
  public rowValueLabel(row: PauseRow): string {
    if (row === 'volume') {
      return volumeLabel(this.volumeValue());
    }
    if (row === 'weather') {
      return (UI_TEXT.MENU.WEATHER_OPTIONS as Record<string, string>)[this.weatherValue()];
    }
    return '';
  }
}
