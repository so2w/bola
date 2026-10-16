import { describe, expect, it } from 'vitest';
import { BALANCE_CONFIG } from '../src/data/balance';
import { MatchManager } from '../src/systems/MatchManager';
import { defaultMatchSettings } from '../src/match/settingsModel';
import { canPauseMatch, PauseMenuModel } from '../src/match/pauseState';

// ---------------------------------------------------------------------------
// Pause state machine (pure + real-manager no-wedge). TDD RED: pauseState
// module does not exist yet. Pause is SCENE gating, never a MatchManager
// state: while paused the manager must not receive update() at all, so its
// clocks/timers freeze and resume from the exact same state.
// ---------------------------------------------------------------------------

describe('canPauseMatch — pausable in every non-terminal state', () => {
  it('allows pausing during live play, kickoff, entrance and stoppages', () => {
    for (const state of [
      'BOOT',
      'INTRO',
      'KICKOFF',
      'PLAYING',
      'STOPPAGE',
      'THROW_IN',
      'GOAL_KICK',
      'CORNER',
      'FREE_KICK',
      'PENALTY',
      'GOAL',
      'OUT_OF_BOUNDS',
      'HALF',
    ] as const) {
      expect(canPauseMatch(state), `state ${state}`).toBe(true);
    }
  });

  it('rejects pausing in terminal states (the results panel is already final)', () => {
    expect(canPauseMatch('RESULTS')).toBe(false);
    expect(canPauseMatch('FULL_TIME')).toBe(false);
    expect(canPauseMatch('GAME_OVER')).toBe(false);
    expect(canPauseMatch(undefined)).toBe(false);
  });
});

describe('PauseMenuModel — main page actions', () => {
  it('main page exposes CONTINUAR / REINICIAR / AJUSTES / SALIR in order', () => {
    const m = new PauseMenuModel(defaultMatchSettings());
    expect(m.page).toBe('main');
    expect(m.rows()).toEqual(['resume', 'restart', 'settings', 'quit']);
  });

  it('confirm on each row returns the matching action', () => {
    const m = new PauseMenuModel(defaultMatchSettings());
    expect(m.confirm()).toBe('resume');
    m.move(1);
    expect(m.confirm()).toBe('restart');
    m.move(1);
    expect(m.confirm()).toBe('settings');
    m.move(1);
    expect(m.confirm()).toBe('quit');
  });

  it('move wraps within the page', () => {
    const m = new PauseMenuModel(defaultMatchSettings());
    m.move(-1);
    expect(m.cursor).toBe(3);
    m.move(1);
    expect(m.cursor).toBe(0);
  });
});

describe('PauseMenuModel — settings page (live-adjustable volume/weather)', () => {
  it('openSettings switches to the volume/weather/back rows', () => {
    const m = new PauseMenuModel(defaultMatchSettings());
    m.openSettings();
    expect(m.page).toBe('settings');
    expect(m.rows()).toEqual(['volume', 'weather', 'back']);
    expect(m.cursor).toBe(0);
  });

  it('adjust on the volume row steps through configured volume steps and reports the value', () => {
    const m = new PauseMenuModel(defaultMatchSettings());
    m.openSettings();
    const change = m.adjust(-1);
    expect(change?.volume).toBeLessThanOrEqual(1);
    expect(change?.volume).toBeGreaterThanOrEqual(0);
    expect(change?.volume).not.toBe(defaultMatchSettings().volume);
  });

  it('adjust on the weather row cycles configured weather types and reports the type', () => {
    const m = new PauseMenuModel(defaultMatchSettings());
    m.openSettings();
    m.move(1); // weather row (default CLEAR_DAY)
    const change = m.adjust(1);
    expect(change?.weather).toBe('RAIN');
    const next = m.adjust(1);
    expect(next?.weather).toBe('SNOW');
  });

  it('confirm on the back row closes the settings page and returns to main', () => {
    const m = new PauseMenuModel(defaultMatchSettings());
    m.openSettings();
    m.move(2); // back
    expect(m.confirm()).toBe('back');
    expect(m.page).toBe('main');
    expect(m.rows()).toEqual(['resume', 'restart', 'settings', 'quit']);
  });

  it('confirm on volume/weather rows cycles forward instead of acting (Enter == adjust)', () => {
    const m = new PauseMenuModel(defaultMatchSettings());
    m.openSettings();
    expect(m.confirm()).toBeNull();
    expect(m.volumeValue()).toBeLessThan(defaultMatchSettings().volume);
  });
});

describe('pause never wedges the real MatchManager (freeze contract)', () => {
  it('skipping manager.update while paused freezes the clock; resume continues from the same state', () => {
    const mgr = new MatchManager();
    // advance into PLAYING
    while (mgr.state !== 'PLAYING') {
      mgr.update(16);
    }
    const before = mgr.getTime();

    // PAUSED: scene must NOT call manager.update — simulate exactly that.
    // (No update calls here; nothing may advance.)
    expect(mgr.state).toBe('PLAYING');
    expect(mgr.getTime()).toBe(before);

    // RESUME: clock advances again from where it froze.
    mgr.update(16);
    expect(mgr.getTime()).toBeLessThan(before);
    expect(mgr.state).toBe('PLAYING');
  });

  it('pausing during a set piece state keeps the state intact across the pause', () => {
    const mgr = new MatchManager();
    (mgr as unknown as { state: string }).state = 'FREE_KICK';
    // paused: no updates
    // resumed:
    mgr.update(BALANCE_CONFIG.FOUL.SET_PIECE_MAX_WAIT_MS + 16);
    expect(mgr.state).toBe('PLAYING');
  });

  it('pausing during HALF keeps the halftime pause intact across the pause', () => {
    const mgr = new MatchManager();
    (mgr as unknown as { state: string }).state = 'HALF';
    // Arm the halftime countdown like enterHalf() does (state was forced).
    mgr.resetTimer = BALANCE_CONFIG.MATCH.HALF_PAUSE_MS;
    mgr.update(16);
    // HALF timer only elapses through update; a short resumed tick must keep
    // us in HALF — pause must not skip or wedge the halftime pause.
    expect(mgr.state).toBe('HALF');
  });

  it('a paused FULL_TIME/RESULTS match never enters the pause flow (guard)', () => {
    const mgr = new MatchManager();
    (mgr as unknown as { state: string }).state = 'RESULTS';
    expect(canPauseMatch(mgr.state)).toBe(false);
  });
});
