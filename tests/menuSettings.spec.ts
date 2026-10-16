import { describe, expect, it } from 'vitest';
import { BALANCE_CONFIG } from '../src/data/balance';
import { UI_TEXT } from '../src/data/uiText';
import {
  createSettingsMenu,
  currentSettings,
  adjustSelected,
  defaultMatchSettings,
  menuRowCount,
  moveCursor,
  resolveClockSeconds,
  resolveMatchInitData,
  resolveMatchSettings,
  volumeLabel,
  type SettingsMenuModel,
} from '../src/match/settingsModel';

// ---------------------------------------------------------------------------
// Pre-match settings menu model (pure, Phaser-free). TDD RED: the module does
// not exist yet. All option lists/defaults come from BALANCE_CONFIG.SETTINGS,
// all labels from UI_TEXT — zero copy/tuning literals in the model.
// ---------------------------------------------------------------------------

describe('defaultMatchSettings — zero behavior change without scene data', () => {
  it('defaults match the shipped behavior: REGULAR_GRASS / CLEAR_DAY / 11v11 / 3 min / full volume', () => {
    const s = defaultMatchSettings();
    expect(s.surface).toBe(BALANCE_CONFIG.SURFACE.DEFAULT_LEVEL);
    expect(s.weather).toBe(BALANCE_CONFIG.WEATHER.DEFAULT_TYPE);
    expect(s.formation).toBe('11v11');
    expect(s.durationMinutes).toBe(BALANCE_CONFIG.MATCH.DURATION_REAL_MINUTES);
    expect(s.volume).toBe(BALANCE_CONFIG.AUDIO.MASTER_VOLUME);
  });
});

describe('settings menu model — navigation and adjustment', () => {
  it('exposes exactly the six rows: terreno, clima, formación, duración, volumen, jugar', () => {
    const m = createSettingsMenu();
    expect(menuRowCount(m)).toBe(6);
    expect(m.rows.map((r) => r.id)).toEqual([
      'surface',
      'weather',
      'formation',
      'duration',
      'volume',
      'play',
    ]);
    expect(m.rows.map((r) => r.label)).toEqual([
      UI_TEXT.MENU.ROWS.SURFACE,
      UI_TEXT.MENU.ROWS.WEATHER,
      UI_TEXT.MENU.ROWS.FORMATION,
      UI_TEXT.MENU.ROWS.DURATION,
      UI_TEXT.MENU.ROWS.VOLUME,
      UI_TEXT.MENU.ROWS.PLAY,
    ]);
  });

  it('row option lists mirror BALANCE_CONFIG.SETTINGS orders with Spanish labels', () => {
    const m = createSettingsMenu();
    expect(m.rows[0].options).toEqual(BALANCE_CONFIG.SETTINGS.SURFACE_ORDER);
    expect(m.rows[1].options).toEqual(BALANCE_CONFIG.SETTINGS.WEATHER_ORDER);
    expect(m.rows[2].options).toEqual(BALANCE_CONFIG.SETTINGS.FORMATION_ORDER);
    expect(m.rows[3].options).toEqual(BALANCE_CONFIG.SETTINGS.DURATION_OPTIONS_MINUTES.map(String));
    expect(m.rows[4].options).toEqual(BALANCE_CONFIG.SETTINGS.VOLUME_STEPS.map(String));
    // Spanish label for the default surface option
    const defaultSurface = m.rows[0].options[m.values[0]];
    expect(m.rows[0].optionLabels[m.values[0]]).toBe(
      (UI_TEXT.MENU.SURFACE_OPTIONS as Record<string, string>)[defaultSurface],
    );
  });

  it('moveCursor moves and wraps both ways', () => {
    const m = createSettingsMenu();
    expect(m.cursor).toBe(0);
    moveCursor(m, 1);
    expect(m.cursor).toBe(1);
    moveCursor(m, -1);
    expect(m.cursor).toBe(0);
    moveCursor(m, -1); // wraps backwards off the first row
    expect(m.cursor).toBe(menuRowCount(m) - 1);
    moveCursor(m, 1); // wraps forward off the last row
    expect(m.cursor).toBe(0);
  });

  it('adjustSelected cycles the surfaced row without going out of bounds', () => {
    const m = createSettingsMenu(); // cursor 0 = surface, default REGULAR_GRASS (index 2)
    adjustSelected(m, 1);
    expect(m.values[0]).toBe(3); // PROFESSIONAL_GRASS
    adjustSelected(m, 1);
    expect(m.values[0]).toBe(0); // wraps to DIRT
    adjustSelected(m, -1);
    expect(m.values[0]).toBe(3); // wraps back
  });

  it('adjustSelected on the JUGAR row is a no-op', () => {
    const m = createSettingsMenu();
    moveCursor(m, 5);
    const before = currentSettings(m);
    adjustSelected(m, 1);
    expect(currentSettings(m)).toEqual(before);
  });

  it('volume row steps through the configured volumes and renders Spanish labels', () => {
    const m = createSettingsMenu();
    const volumeRow = 4;
    m.cursor = volumeRow;
    // default index 4 (1.0) -> +1 wraps to 0 (mute)
    adjustSelected(m, 1);
    expect(currentSettings(m).volume).toBe(0);
    expect(volumeLabel(0)).toBe(UI_TEXT.MENU.VOLUME_MUTE_LABEL);
    expect(volumeLabel(0.5)).toBe('50%');
    adjustSelected(m, 1);
    expect(currentSettings(m).volume).toBe(BALANCE_CONFIG.SETTINGS.VOLUME_STEPS[1]);
  });

  it('currentSettings reflects an adjusted selection (weather)', () => {
    const m = createSettingsMenu();
    m.cursor = 1; // weather
    adjustSelected(m, 1); // CLEAR_DAY -> RAIN
    const s = currentSettings(m);
    expect(s.weather).toBe('RAIN');
    expect(s.surface).toBe(BALANCE_CONFIG.SURFACE.DEFAULT_LEVEL);
  });

  it('createSettingsMenu accepts current settings so returning from a match restores them', () => {
    const s: ReturnType<typeof defaultMatchSettings> = {
      ...defaultMatchSettings(),
      surface: 'DIRT',
      weather: 'SNOW',
      formation: '5v5',
      durationMinutes: 5,
      volume: 0.5,
    };
    const m = createSettingsMenu(s);
    expect(currentSettings(m)).toEqual(s);
  });
});

describe('resolution into scene init data and match clock', () => {
  it('resolveMatchInitData maps settings to the full MatchScene init payload', () => {
    const init = resolveMatchInitData({
      surface: 'DIRT',
      weather: 'RAIN',
      formation: '5v5',
      durationMinutes: 5,
      volume: 0.5,
    });
    expect(init.formationHome).toBe('5v5');
    expect(init.formationAway).toBe('5v5');
    expect(init.surface).toBe('DIRT');
    expect(init.weather).toBe('RAIN');
    expect(init.durationRealMinutes).toBe(5);
    expect(init.volume).toBe(0.5);
  });

  it('resolveClockSeconds: 3 real minutes -> 540 game seconds, 5 -> 900 (GAME_TIME_SCALE)', () => {
    const scale = BALANCE_CONFIG.MATCH.GAME_TIME_SCALE;
    expect(resolveClockSeconds(3)).toBe(3 * 60 * scale);
    expect(resolveClockSeconds(3)).toBe(540);
    expect(resolveClockSeconds(5)).toBe(900);
  });

  it('resolveClockSeconds rejects unlisted durations (fail-fast, no silent defaults)', () => {
    expect(() => resolveClockSeconds(4 as number)).toThrow();
  });

  it('resolveMatchSettings defaults on empty data and accepts explicit values', () => {
    expect(resolveMatchSettings()).toEqual(defaultMatchSettings());
    const s = resolveMatchSettings({
      surface: 'PROFESSIONAL_GRASS',
      weather: 'HEAT',
      durationRealMinutes: 5,
      volume: 0.25,
      formationHome: '3v3',
      formationAway: '3v3',
    });
    expect(s.surface).toBe('PROFESSIONAL_GRASS');
    expect(s.weather).toBe('HEAT');
    expect(s.formation).toBe('3v3');
    expect(s.durationMinutes).toBe(5);
    expect(s.volume).toBe(0.25);
  });

  it('resolveMatchSettings fails fast on unknown surface/weather/duration', () => {
    expect(() => resolveMatchSettings({ surface: 'CONCRETE' as never })).toThrow();
    expect(() => resolveMatchSettings({ weather: 'STORM' as never })).toThrow();
    expect(() => resolveMatchSettings({ durationRealMinutes: 7 })).toThrow();
  });

  it('resolveMatchSettings clamps non-finite volume inputs instead of poisoning audio', () => {
    const s = resolveMatchSettings({ volume: Number.NaN });
    expect(Number.isFinite(s.volume)).toBe(true);
  });
});

describe('menu model rows stay consistent with config (spec contract)', () => {
  it('SETTINGS config exposes orders + defaults used by the model', () => {
    const S = BALANCE_CONFIG.SETTINGS;
    expect(S.SURFACE_ORDER).toHaveLength(4);
    expect(S.WEATHER_ORDER).toContain('RAIN');
    expect(S.FORMATION_ORDER).toEqual(['3v3', '5v5', '11v11']);
    expect(S.DURATION_OPTIONS_MINUTES).toEqual([3, 5]);
    expect(S.VOLUME_STEPS[0]).toBe(0);
    expect(S.VOLUME_STEPS.at(-1)).toBe(1);
    for (let i = 1; i < S.VOLUME_STEPS.length; i++) {
      expect(S.VOLUME_STEPS[i]).toBeGreaterThan(S.VOLUME_STEPS[i - 1]);
    }
  });

  it('defaults resolve to the exact same values the old hardcoded paths used', () => {
    const m: SettingsMenuModel = createSettingsMenu();
    const s = currentSettings(m);
    expect(s).toEqual(defaultMatchSettings());
  });
});
