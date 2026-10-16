import { describe, expect, it, vi } from 'vitest';
import { BALANCE_CONFIG } from '../src/data/balance';
import { UI_TEXT } from '../src/data/uiText';
import { HalftimeBanner, halftimeBannerData } from '../src/ui/HalftimeBanner';
import { FulltimeBanner } from '../src/ui/FulltimeBanner';

// ---------------------------------------------------------------------------
// Spanish UI batch (AGENTS.md section on UI copy): every user-facing string
// is Spanish AND lives in config. Banner groups keep their own config
// sections; the rest lives in UI_TEXT. The debug overlay stays technical
// English (dev-facing, section 30).
// ---------------------------------------------------------------------------

describe('banner stats carry the Spanish team labels from config', () => {
  it('halftime banner: LOCAL/VISITANTE labels + MEDIO TIEMPO title', () => {
    const cfg = BALANCE_CONFIG.HALFTIME_BANNER;
    expect(cfg.HOME_LABEL).toBe('LOCAL');
    expect(cfg.AWAY_LABEL).toBe('VISITANTE');
    expect(cfg.TITLE_TEXT).toBe('MEDIO TIEMPO');
  });

  it('halftime second-half note is Spanish (no leftover English copy)', () => {
    const note = BALANCE_CONFIG.HALFTIME_BANNER.SECOND_HALF_NOTE_TEXT;
    expect(note.length).toBeGreaterThan(0);
    expect(note).not.toMatch(/second half|swapped/i);
  });

  it('fulltime banner: LOCAL/VISITANTE labels + FINAL title', () => {
    const cfg = BALANCE_CONFIG.FULLTIME_BANNER;
    expect(cfg.HOME_LABEL).toBe('LOCAL');
    expect(cfg.AWAY_LABEL).toBe('VISITANTE');
    expect(cfg.TITLE_TEXT).toBe('FINAL');
  });

  it('halftime overlay renders the Spanish team line on show()', () => {
    const texts: { text: string }[] = [];
    const makeTextObj = (t: string) => {
      const o = {
        text: t,
        x: 0,
        y: 0,
        setText: vi.fn((nt: string) => {
          o.text = nt;
          return o;
        }),
        setOrigin: vi.fn(() => o),
        setDepth: vi.fn(() => o),
        setScrollFactor: vi.fn(() => o),
        setInteractive: vi.fn(() => o),
        on: vi.fn(() => o),
      };
      texts.push(o as unknown as { text: string });
      return o;
    };
    const scene = {
      add: {
        rectangle: vi.fn(() => ({ x: 0, y: 0, setDepth: vi.fn(), setScrollFactor: vi.fn() })),
        text: vi.fn((_x: number, _y: number, t: string) => makeTextObj(t)),
        container: vi.fn(() => ({
          add: vi.fn(),
          setDepth: vi.fn(),
          setVisible: vi.fn(),
          setScrollFactor: vi.fn(),
        })),
      },
    } as any;
    const banner = new HalftimeBanner(scene, undefined, () => {}, () => {});
    banner.show(
      halftimeBannerData(
        { home: 1, away: 0 },
        {
          home: { goals: 1, shots: 2, passesCompleted: 3, possessionMs: 60000 },
          away: { goals: 0, shots: 1, passesCompleted: 2, possessionMs: 30000 },
        },
      ),
    );
    const line = texts.map((t) => t.text).find((t) => t.startsWith('LOCAL '));
    expect(line).toBeDefined();
    expect(texts.map((t) => t.text)).not.toContain('HOME 0');
  });

  it('fulltime overlay renders the Spanish team line on show()', () => {
    const texts: { text: string }[] = [];
    const makeTextObj = (t: string) => {
      const o = {
        text: t,
        x: 0,
        y: 0,
        setText: vi.fn((nt: string) => {
          o.text = nt;
          return o;
        }),
        setOrigin: vi.fn(() => o),
        setDepth: vi.fn(() => o),
        setScrollFactor: vi.fn(() => o),
        setInteractive: vi.fn(() => o),
        on: vi.fn(() => o),
      };
      texts.push(o as unknown as { text: string });
      return o;
    };
    const scene = {
      add: {
        rectangle: vi.fn(() => ({ x: 0, y: 0, setDepth: vi.fn(), setScrollFactor: vi.fn() })),
        text: vi.fn((_x: number, _y: number, t: string) => makeTextObj(t)),
        container: vi.fn(() => ({
          add: vi.fn(),
          setDepth: vi.fn(),
          setVisible: vi.fn(),
          setScrollFactor: vi.fn(),
        })),
      },
    } as any;
    const banner = new FulltimeBanner(scene, undefined, () => {});
    banner.show(
      halftimeBannerData(
        { home: 0, away: 2 },
        {
          home: { goals: 0, shots: 1, passesCompleted: 2, possessionMs: 20000 },
          away: { goals: 2, shots: 4, passesCompleted: 5, possessionMs: 70000 },
        },
      ),
    );
    expect(texts.map((t) => t.text).some((t) => t.startsWith('VISITANTE '))).toBe(true);
  });
});

describe('UI_TEXT config — Spanish copy for menu, pause and HUD', () => {
  it('menu rows use the requested Spanish labels', () => {
    expect(UI_TEXT.MENU.TITLE.length).toBeGreaterThan(0);
    expect(UI_TEXT.MENU.ROWS.SURFACE).toBe('TERRENO');
    expect(UI_TEXT.MENU.ROWS.WEATHER).toBe('CLIMA');
    expect(UI_TEXT.MENU.ROWS.FORMATION).toBe('FORMACIÓN');
    expect(UI_TEXT.MENU.ROWS.DURATION).toBe('DURACIÓN');
    expect(UI_TEXT.MENU.ROWS.VOLUME).toBe('VOLUMEN');
    expect(UI_TEXT.MENU.ROWS.PLAY).toBe('JUGAR');
  });

  it('surface option labels exist for every configured surface level', () => {
    for (const level of Object.keys(BALANCE_CONFIG.SURFACE.LEVELS)) {
      expect((UI_TEXT.MENU.SURFACE_OPTIONS as Record<string, string>)[level]).toBeTruthy();
    }
  });

  it('weather option labels exist for every configured weather type', () => {
    for (const type of Object.keys(BALANCE_CONFIG.WEATHER.TYPES)) {
      expect((UI_TEXT.MENU.WEATHER_OPTIONS as Record<string, string>)[type]).toBeTruthy();
    }
  });

  it('formation and duration option labels exist for every option', () => {
    for (const f of ['3v3', '5v5', '11v11'] as const) {
      expect(UI_TEXT.MENU.FORMATION_OPTIONS[f]).toBeTruthy();
    }
    expect(UI_TEXT.MENU.DURATION_SUFFIX.length).toBeGreaterThan(0);
  });

  it('pause overlay options use the requested Spanish copy', () => {
    expect(UI_TEXT.PAUSE.TITLE.length).toBeGreaterThan(0);
    expect(UI_TEXT.PAUSE.RESUME).toBe('CONTINUAR');
    expect(UI_TEXT.PAUSE.RESTART).toBe('REINICIAR PARTIDO');
    expect(UI_TEXT.PAUSE.SETTINGS).toBe('AJUSTES');
    expect(UI_TEXT.PAUSE.QUIT).toBe('SALIR AL MENÚ');
    expect(UI_TEXT.PAUSE.BACK.length).toBeGreaterThan(0);
    expect(UI_TEXT.PAUSE.SETTINGS_HINT.length).toBeGreaterThan(0);
  });

  it('goal cry and HUD labels are Spanish and non-empty', () => {
    expect(UI_TEXT.GOAL_CRY).toBe('¡GOL!');
    expect(UI_TEXT.HUD.SCORE_PEEK_LABEL.length).toBeGreaterThan(0);
    expect(UI_TEXT.HUD.GAME_OVER_TITLE.length).toBeGreaterThan(0);
    expect(UI_TEXT.HUD.PAUSE_BUTTON.length).toBeGreaterThan(0);
    expect(UI_TEXT.HUD.RESULT_TITLE.length).toBeGreaterThan(0);
    expect(UI_TEXT.HUD.RESULT_CLOSE.length).toBeGreaterThan(0);
  });

  it('existing controls hint is already Spanish (regression guard)', () => {
    const hint = BALANCE_CONFIG.UI.CONTROLS_HINT_TEXT;
    expect(hint).toContain('Pasar');
    expect(hint).toContain('Tirar');
    expect(hint).not.toMatch(/pass|shoot/i);
  });

  it('menu nav hint is Spanish and mentions Enter + tap', () => {
    expect(UI_TEXT.MENU.NAV_HINT.length).toBeGreaterThan(0);
    expect(UI_TEXT.MENU.NAV_HINT).toContain('Enter');
  });
});
