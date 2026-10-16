import { BALANCE_CONFIG } from '../data/balance';
import { UI_TEXT } from '../data/uiText';
import type { FormationId } from '../data/formations';
import type { PitchQuality, WeatherType } from './WeatherSystem';
import type { MatchSceneInitData } from './resolveFormations';

/**
 * Pre-match settings model (settings/pause/Spanish-UI batch) — pure and
 * Phaser-free so the menu navigation, defaults and scene-data resolution
 * are unit-testable headless (AGENTS.md section 28).
 *
 * Option orders and defaults come from BALANCE_CONFIG.SETTINGS; every label
 * comes from UI_TEXT. Zero copy or tuning literals live in this module.
 * Session-only by design: persisting settings per profile is a Phase 6
 * SaveGame OPEN QUESTION (specs/settings_menus_spanish_ui.md).
 */

export interface MatchSettings {
  surface: PitchQuality;
  weather: WeatherType;
  formation: FormationId;
  /** Real minutes (3 or 5, AGENTS.md section 7). */
  durationMinutes: number;
  /** Master volume in [0, 1]. */
  volume: number;
}

export type SettingsRowId = 'surface' | 'weather' | 'formation' | 'duration' | 'volume' | 'play';

export interface SettingsRow {
  id: SettingsRowId;
  label: string;
  /** Raw option values (ids for enums, strings for numbers). */
  options: readonly string[];
  /** Spanish labels parallel to `options`. */
  optionLabels: readonly string[];
}

export interface SettingsMenuModel {
  readonly rows: readonly SettingsRow[];
  /** Selected option index per setting row (play row has none). */
  values: number[];
  cursor: number;
}

/** Renders a volume step (0 -> Spanish mute label, otherwise a percentage). */
export function volumeLabel(step: number): string {
  return step <= 0
    ? UI_TEXT.MENU.VOLUME_MUTE_LABEL
    : `${Math.round(step * 100)}${UI_TEXT.MENU.VOLUME_PCT_SUFFIX}`;
}

function buildRows(): SettingsRow[] {
  const S = BALANCE_CONFIG.SETTINGS;
  const surfaceLabels = S.SURFACE_ORDER.map(
    (s) => (UI_TEXT.MENU.SURFACE_OPTIONS as Record<string, string>)[s],
  );
  const weatherLabels = S.WEATHER_ORDER.map(
    (w) => (UI_TEXT.MENU.WEATHER_OPTIONS as Record<string, string>)[w],
  );
  const formationLabels = S.FORMATION_ORDER.map(
    (f) => UI_TEXT.MENU.FORMATION_OPTIONS[f as keyof typeof UI_TEXT.MENU.FORMATION_OPTIONS],
  );
  const durationLabels = S.DURATION_OPTIONS_MINUTES.map(
    (m) => `${m}${UI_TEXT.MENU.DURATION_SUFFIX}`,
  );
  const volumeLabels = S.VOLUME_STEPS.map((v) => volumeLabel(v));
  return [
    {
      id: 'surface',
      label: UI_TEXT.MENU.ROWS.SURFACE,
      options: S.SURFACE_ORDER,
      optionLabels: surfaceLabels,
    },
    {
      id: 'weather',
      label: UI_TEXT.MENU.ROWS.WEATHER,
      options: S.WEATHER_ORDER,
      optionLabels: weatherLabels,
    },
    {
      id: 'formation',
      label: UI_TEXT.MENU.ROWS.FORMATION,
      options: S.FORMATION_ORDER,
      optionLabels: formationLabels,
    },
    {
      id: 'duration',
      label: UI_TEXT.MENU.ROWS.DURATION,
      options: S.DURATION_OPTIONS_MINUTES.map(String),
      optionLabels: durationLabels,
    },
    {
      id: 'volume',
      label: UI_TEXT.MENU.ROWS.VOLUME,
      options: S.VOLUME_STEPS.map(String),
      optionLabels: volumeLabels,
    },
    {
      id: 'play',
      label: UI_TEXT.MENU.ROWS.PLAY,
      options: [],
      optionLabels: [],
    },
  ];
}

function settingRows(rows: readonly SettingsRow[]): SettingsRow[] {
  return rows.filter((r) => r.id !== 'play');
}

function indexOfOrThrow(list: readonly string[], value: string, what: string): number {
  const i = list.indexOf(value);
  if (i < 0) {
    throw new Error(
      `MatchSettings: unknown ${what} '${value}'. Registered: ${list.join(', ')}`,
    );
  }
  return i;
}

/**
 * Defaults that mirror the pre-menu hardcoded behavior bit-for-bit:
 * REGULAR_GRASS / CLEAR_DAY / 11v11 / 3 real minutes / full volume.
 */
export function defaultMatchSettings(): MatchSettings {
  const S = BALANCE_CONFIG.SETTINGS;
  return {
    surface: S.SURFACE_ORDER[S.DEFAULTS.SURFACE_INDEX],
    weather: S.WEATHER_ORDER[S.DEFAULTS.WEATHER_INDEX],
    formation: S.FORMATION_ORDER[S.DEFAULTS.FORMATION_INDEX],
    durationMinutes: S.DURATION_OPTIONS_MINUTES[S.DEFAULTS.DURATION_INDEX],
    volume: S.VOLUME_STEPS[S.DEFAULTS.VOLUME_INDEX],
  };
}

/** Builds the menu model, optionally restoring a previous session's values. */
export function createSettingsMenu(settings: MatchSettings = defaultMatchSettings()): SettingsMenuModel {
  const rows = buildRows();
  const find = (id: SettingsRowId) => rows.find((r) => r.id === id)!;
  const values = settingRows(rows).map((row) => {
    switch (row.id) {
      case 'surface':
        return indexOfOrThrow(row.options, settings.surface, 'pitch quality');
      case 'weather':
        return indexOfOrThrow(row.options, settings.weather, 'weather type');
      case 'formation':
        return indexOfOrThrow(row.options, settings.formation, 'formation');
      case 'duration':
        return indexOfOrThrow(row.options, String(settings.durationMinutes), 'duration');
      case 'volume':
        return indexOfOrThrow(row.options, String(settings.volume), 'volume');
      default:
        return 0;
    }
  });
  return { rows, values, cursor: 0 };
}

export function menuRowCount(model: SettingsMenuModel): number {
  return model.rows.length;
}

/** Moves the cursor with wrap-around across all rows (settings + JUGAR). */
export function moveCursor(model: SettingsMenuModel, delta: number): void {
  const n = model.rows.length;
  if (n === 0) {
    return;
  }
  model.cursor = ((model.cursor + delta) % n + n) % n;
}

/** Cycles the selected setting row (JUGAR is a no-op — it only starts). */
export function adjustSelected(model: SettingsMenuModel, delta: number): void {
  const row = model.rows[model.cursor];
  if (!row || row.options.length === 0) {
    return;
  }
  const n = row.options.length;
  // values[] parallels the setting rows (the play row is excluded), so map
  // the row to its index among the setting rows only.
  const valueIndex = settingRows(model.rows).indexOf(row);
  model.values[valueIndex] = ((model.values[valueIndex] + delta) % n + n) % n;
}

/** Current concrete settings derived from the model's selected indexes. */
export function currentSettings(model: SettingsMenuModel): MatchSettings {
  const rows = settingRows(model.rows);
  const value = (id: SettingsRowId): string => {
    const index = rows.findIndex((r) => r.id === id);
    const row = rows[index];
    const v = row?.options[model.values[index]];
    if (v === undefined) {
      throw new Error(`MatchSettings: no selected option for row '${id}'`);
    }
    return v;
  };
  return {
    surface: value('surface') as PitchQuality,
    weather: value('weather') as WeatherType,
    formation: value('formation') as FormationId,
    durationMinutes: Number(value('duration')),
    volume: Number(value('volume')),
  };
}

/**
 * Real minutes -> game seconds on the match clock (CONF-1 scale). Fails fast
 * on any duration outside SETTINGS.DURATION_OPTIONS_MINUTES — a wrong clock
 * must never silently ship (3 -> 540, 5 -> 900 at GAME_TIME_SCALE 3).
 */
export function resolveClockSeconds(minutes: number): number {
  if (!BALANCE_CONFIG.SETTINGS.DURATION_OPTIONS_MINUTES.includes(minutes)) {
    throw new Error(
      `MatchSettings: unknown duration '${String(minutes)}' minutes. Registered: ${BALANCE_CONFIG.SETTINGS.DURATION_OPTIONS_MINUTES.join(', ')}`,
    );
  }
  return minutes * 60 * BALANCE_CONFIG.MATCH.GAME_TIME_SCALE;
}

/**
 * Fail-fast resolution of raw scene init data into validated settings
 * (same convention as resolveMatchFormations / resolveTactics). Non-finite
 * volume falls back to the default so audio can never be poisoned by NaN.
 */
export function resolveMatchSettings(data?: MatchSceneInitData): MatchSettings {
  const base = defaultMatchSettings();
  const settings: MatchSettings = {
    surface: data?.surface ?? base.surface,
    weather: data?.weather ?? base.weather,
    formation: data?.formationHome ?? base.formation,
    durationMinutes: data?.durationRealMinutes ?? base.durationMinutes,
    volume: data?.volume ?? base.volume,
  };
  // Validate against the FULL registered sets (the menu offers a curated
  // subset, but direct scene starts may use any configured value, e.g. NIGHT).
  const registeredSurfaces = Object.keys(BALANCE_CONFIG.SURFACE.LEVELS);
  const registeredWeather = Object.keys(BALANCE_CONFIG.WEATHER.TYPES);
  if (!registeredSurfaces.includes(settings.surface)) {
    throw new Error(
      `MatchSettings: unknown pitch quality '${String(settings.surface)}'. Registered: ${registeredSurfaces.join(', ')}`,
    );
  }
  if (!registeredWeather.includes(settings.weather)) {
    throw new Error(
      `MatchSettings: unknown weather type '${String(settings.weather)}'. Registered: ${registeredWeather.join(', ')}`,
    );
  }
  if (!BALANCE_CONFIG.SETTINGS.DURATION_OPTIONS_MINUTES.includes(settings.durationMinutes)) {
    throw new Error(
      `MatchSettings: unknown duration '${String(settings.durationMinutes)}' minutes. Registered: ${BALANCE_CONFIG.SETTINGS.DURATION_OPTIONS_MINUTES.join(', ')}`,
    );
  }
  if (!Number.isFinite(settings.volume)) {
    settings.volume = base.volume;
  }
  settings.volume = Math.max(0, Math.min(settings.volume, 1));
  return settings;
}

/** Maps settings onto the full MatchScene init payload (formation for both teams). */
export function resolveMatchInitData(settings: MatchSettings): MatchSceneInitData {
  return {
    formationHome: settings.formation,
    formationAway: settings.formation,
    surface: settings.surface,
    weather: settings.weather,
    durationRealMinutes: settings.durationMinutes,
    volume: settings.volume,
  };
}
