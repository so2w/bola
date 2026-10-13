import { describe, it, expect, vi } from 'vitest';
import { CameraController } from '../src/match/CameraController';
import { AudioDirector } from '../src/audio/AudioDirector';
import { MatchManager, type MatchClockConfig } from '../src/systems/MatchManager';

// ---------------------------------------------------------------------------
// PRES-1: CameraController — config-driven weights/zoom, edge clamp, switch lerp
// ---------------------------------------------------------------------------

function mockCamera(width = 960, height = 540) {
  const cam = {
    scrollX: 0,
    scrollY: 0,
    width,
    height,
    zoom: 1,
    setZoom: vi.fn(function (this: any, z: number) {
      this.zoom = z;
      return this;
    }),
    centerOn: vi.fn(function (this: any, x: number, y: number) {
      this.scrollX = x - this.width / 2;
      this.scrollY = y - this.height / 2;
    }),
  };
  return cam as any;
}

describe('CameraController — PRES-1 config + clamp', () => {
  it('applies config zoom to the camera once (no per-frame zoom animation)', () => {
    const cam = mockCamera();
    new CameraController(cam, 0.1, 0.15, { zoom: 1.5, worldWidth: 960, worldHeight: 540 });
    expect(cam.setZoom).toHaveBeenCalledWith(1.5);
  });

  it('clamps the view inside world bounds so no out-of-bounds dead space shows (PRES-1 edge scenario)', () => {
    const cam = mockCamera(960, 540);
    // zoom 2 -> visible span 480x270 -> center must stay within
    // [240, 720] x [135, 405] for a 960x540 world.
    const ctl = new CameraController(cam, 1.0, 0, {
      zoom: 2,
      worldWidth: 960,
      worldHeight: 540,
    });
    const corner = { x: 0, y: 0 };
    const still = { x: 0, y: 0 };
    for (let i = 0; i < 60; i++) {
      ctl.update(corner, corner, still);
    }
    const [cx, cy] = cam.centerOn.mock.calls.at(-1)!;
    expect(cx).toBeCloseTo(240);
    expect(cy).toBeCloseTo(135);
    // right/bottom edges
    const far = { x: 960, y: 540 };
    for (let i = 0; i < 60; i++) {
      ctl.update(far, far, still);
    }
    const [cx2, cy2] = cam.centerOn.mock.calls.at(-1)!;
    expect(cx2).toBeCloseTo(720);
    expect(cy2).toBeCloseTo(405);
  });

  it('interpolates over the lerp window on player switch — no snap (PRES-1)', () => {
    const cam = mockCamera();
    cam.centerOn(200, 270); // settle camera on player A
    const ctl = new CameraController(cam, 0.5, 0);
    const ball = { x: 200, y: 270 };
    const still = { x: 0, y: 0 };

    // Settle fully on player A
    const playerA = { x: 200, y: 270 };
    for (let i = 0; i < 60; i++) {
      ctl.update(playerA, ball, still);
    }
    const [settledX] = cam.centerOn.mock.calls.at(-1)!;

    // Selector switches to a far player: target = 0.4*800 + 0.6*200 = 440.
    // With lerp 0.5 the very next center must be 200 + 0.5*240 = 320, NOT 440.
    const playerB = { x: 800, y: 270 };
    ctl.update(playerB, ball, still);
    const [nextX] = cam.centerOn.mock.calls.at(-1)!;
    expect(settledX).toBeCloseTo(200);
    expect(nextX).toBeCloseTo(320);
    expect(nextX).toBeLessThan(440);
  });

  it('honours configured player/ball weights over the hardcoded 40/60', () => {
    const cam = mockCamera();
    cam.centerOn(0, 0);
    const ctl = new CameraController(cam, 1.0, 0, { playerWeight: 1, ballWeight: 0 });
    const player = { x: 500, y: 300 };
    const ball = { x: 900, y: 500 };
    ctl.update(player, ball, { x: 0, y: 0 });
    const [cx, cy] = cam.centerOn.mock.calls.at(-1)!;
    expect(cx).toBeCloseTo(500);
    expect(cy).toBeCloseTo(300);
  });
});

// ---------------------------------------------------------------------------
// PRES-2: AudioDirector — missing-asset fallback (skip + debug warn, never throw)
// ---------------------------------------------------------------------------

describe('AudioDirector — PRES-2 missing-asset fallback', () => {
  it('skips playback and logs a debug warning when the asset is absent (missing whistle scenario)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = { play: vi.fn(), has: vi.fn(() => false) };
    const audio = new AudioDirector(adapter, { debug: true });

    expect(() => audio.playEvent('WHISTLE')).not.toThrow();
    expect(adapter.has).toHaveBeenCalledWith('sfx_whistle');
    expect(adapter.play).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('plays normally when the adapter exposes no has() (backward compatible)', () => {
    const adapter = { play: vi.fn() };
    const audio = new AudioDirector(adapter, { debug: true });
    audio.playEvent('KICK');
    expect(adapter.play).toHaveBeenCalledWith('sfx_kick', expect.anything());
  });

  it('warns once per missing key (no per-frame log spam for repeated kicks)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = { play: vi.fn(), has: vi.fn(() => false) };
    const audio = new AudioDirector(adapter, { debug: true });

    audio.playEvent('KICK');
    audio.playEvent('KICK');
    audio.playEvent('KICK');
    expect(adapter.play).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('never throws without an adapter, even in debug mode', () => {
    const audio = new AudioDirector(undefined, { debug: true });
    expect(() => audio.playEvent('GOAL')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// CONF-1: clock constants centralized — MatchManager consumes injected config
// ---------------------------------------------------------------------------

function fakeBallMgr() {
  return {
    sprite: {
      x: 480,
      y: 270,
      setPosition: vi.fn(function (this: any, px: number, py: number) {
        this.x = px;
        this.y = py;
      }),
    },
    body: { setVelocity: vi.fn() },
    z: 0,
    zTarget: 0,
    reset: vi.fn(),
  } as any;
}

function fakePlayerMgr() {
  return {
    sprite: { x: 0, y: 0 },
    setPosition: vi.fn(),
    body: { setVelocity: vi.fn() },
  } as any;
}

const SHORT_CLOCK: MatchClockConfig = {
  TIME_REMAINING_GAME_SECONDS: 60,
  GAME_TIME_SCALE: 3,
  KICKOFF_PAUSE_MS: 1000,
  GOAL_PAUSE_MS: 500,
  OUT_OF_BOUNDS_PAUSE_MS: 500,
};

describe('MatchManager — CONF-1 config-driven clock', () => {
  it('defaults to BALANCE_CONFIG.MATCH values (540 game-seconds, 1500ms kickoff)', () => {
    const mgr = new MatchManager();
    expect(mgr.getTime()).toBe(540);
    expect(mgr.kickoffTimer).toBe(1500);
  });

  it('accepts an injected clock and starts from it', () => {
    const mgr = new MatchManager(SHORT_CLOCK);
    expect(mgr.getTime()).toBe(60);
    expect(mgr.kickoffTimer).toBe(1000);
  });

  it('runs a 60s/3x match in ~20 real seconds then hits GAME_OVER (CONF-1 scenario)', () => {
    const mgr = new MatchManager(SHORT_CLOCK);
    const ball = fakeBallMgr();
    const home = [fakePlayerMgr(), fakePlayerMgr(), fakePlayerMgr()];
    const away = [fakePlayerMgr(), fakePlayerMgr(), fakePlayerMgr()];
    mgr.bind(undefined as any, ball, home, away, { home: '3v3', away: '3v3' });

    // KICKOFF pause is 1000ms in this config
    mgr.update(1000);
    expect(mgr.state).toBe('PLAYING');

    // ~200 real-time steps of 100ms = 20s real = 60 game-seconds at 3x
    for (let i = 0; i < 210; i++) {
      mgr.update(100);
      if (mgr.state === 'GAME_OVER') {
        break;
      }
    }
    expect(mgr.getTime()).toBeLessThan(1e-6);
    expect(mgr.state).toBe('GAME_OVER');
  });
});
