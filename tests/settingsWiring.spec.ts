import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type Phaser from 'phaser';

// ---------------------------------------------------------------------------
// Scene-level wiring for the settings/pause/Spanish batch (mocked Phaser,
// REAL domain — same harness style as playtestRound2.scene.spec.ts):
//   - chosen settings actually reach WeatherSystem / MatchManager clock /
//     AudioDirector master volume / resolveFormations.
//   - pause freezes updates via scene gating (no wedge from any state).
//   - kicks cannot move the ball while paused.
//   - SALIR AL MENÚ returns to MenuScene carrying the current settings.
// ---------------------------------------------------------------------------

// Hoisted so the vi.mock factory (hoisted above all imports) can use them.
const hoisted = vi.hoisted(() => {
  const fs = require('node:fs');
  const url = require('node:url');
  const manifestJson = JSON.parse(
    fs.readFileSync(url.fileURLToPath(new URL('../public/assets/manifest.json', import.meta.url)), 'utf8'),
  );

  class V2 {
    constructor(public x = 0, public y = 0) {}
    length(): number {
      return Math.hypot(this.x, this.y);
    }
    lengthSq(): number {
      return this.x * this.x + this.y * this.y;
    }
    clone(): this {
      return new (this.constructor as new (x: number, y: number) => this)(this.x, this.y);
    }
    normalize(): this {
      const len = this.length();
      if (len > 0) {
        this.x /= len;
        this.y /= len;
      }
      return this;
    }
    scale(s: number): this {
      this.x *= s;
      this.y *= s;
      return this;
    }
    setTo(x: number, y: number): this {
      this.x = x;
      this.y = y;
      return this;
    }
  }
  return { manifestJson, V2 };
});

const manifest = hoisted.manifestJson;
const Vec2 = hoisted.V2;

vi.mock('phaser', () => {
  function makeBody() {
    const velocity = new hoisted.V2();
    return {
      velocity,
      setVelocity: vi.fn((x: number, y: number) => {
        velocity.x = x;
        velocity.y = y;
      }),
      setAcceleration: vi.fn(),
      setCollideWorldBounds: vi.fn(),
      setDrag: vi.fn(),
      setBounce: vi.fn(),
      setFriction: vi.fn(),
      setImmovable: vi.fn(),
    };
  }

  function makeSprite(x: number, y: number, key?: string, frame?: number) {
    const s: any = {
      x,
      y,
      textureKey: key,
      frame,
      body: undefined as any,
      anims: {
        isPlaying: false,
        currentAnim: undefined as any,
        play: vi.fn(function (animKey: string) {
          s.anims.currentAnim = { key: animKey };
          s.anims.isPlaying = true;
        }),
      },
      setPosition: vi.fn(function (nx: number, ny: number) {
        s.x = nx;
        s.y = ny;
        return s;
      }),
    };
    for (const m of ['setOrigin', 'setDepth', 'setInteractive', 'setVisible', 'setTint', 'setScale', 'setAlpha', 'setScrollFactor']) {
      s[m] = vi.fn(() => s);
    }
    s.on = vi.fn(() => s);
    return s;
  }

  function makeChain(x?: number, y?: number) {
    const o: any = { x: x ?? 0, y: y ?? 0, visible: true, handlers: {} as Record<string, Array<() => void>> };
    for (const m of ['setOrigin', 'setDepth', 'setInteractive', 'setVisible', 'setText', 'setScale', 'setAlpha', 'setScrollFactor', 'setPosition', 'setFillStyle', 'setPadding', 'setColor', 'clear', 'lineStyle', 'strokeCircle', 'fillStyle', 'fillTriangle']) {
      o[m] = vi.fn(function (this: any, v?: unknown) {
        if (m === 'setVisible') o.visible = v as boolean;
        return o;
      });
    }
    o.on = vi.fn((ev: string, cb: () => void) => {
      (o.handlers[ev] ??= []).push(cb);
      return o;
    });
    o.add = vi.fn(() => o);
    return o;
  }

  return {
    default: {
      Scene: class {
        constructor(_key?: string) {
          this.add = {
            image: vi.fn((x: number, y: number) => makeChain(x, y)),
            text: vi.fn((x: number, y: number) => makeChain(x, y)),
            zone: vi.fn((x: number, y: number) => makeChain(x, y)),
            rectangle: vi.fn((x: number, y: number) => makeChain(x, y)),
            container: vi.fn((x: number, y: number) => makeChain(x, y)),
            graphics: vi.fn(() => makeChain()),
            sprite: vi.fn((x: number, y: number, key?: string, frame?: number) => makeSprite(x, y, key, frame)),
          };
          this.physics = {
            world: {
              setBounds: vi.fn(),
              enable: vi.fn((objs: unknown) => {
                const list = Array.isArray(objs) ? objs : [objs];
                for (const o of list as any[]) {
                  if (o && !o.body) o.body = makeBody();
                }
              }),
            },
            add: {
              existing: vi.fn((sprite: any) => {
                sprite.body = makeBody();
              }),
              overlap: vi.fn(),
            },
          };
          this.cameras = { main: { width: 960, height: 540, scrollX: 0, scrollY: 0, setZoom: vi.fn(), centerOn: vi.fn(), shake: vi.fn() } };
          this.input = {
            keyboard: {
              on: vi.fn(),
              createCursorKeys: vi.fn(() => ({})),
              addKey: vi.fn(() => ({ on: vi.fn(), isDown: false })),
            },
          };
          this.tweens = { add: vi.fn() };
          this.cache = { json: { get: vi.fn((k: string) => (k === 'manifest' ? hoisted.manifestJson : undefined)) }, audio: { exists: vi.fn(() => false) } };
          this.registry = { get: vi.fn(() => undefined) };
          this.sound = { play: vi.fn() };
          this.time = { now: 0 };
          this.scene = { start: vi.fn() };
        }
        add: any;
        physics: any;
        cameras: any;
        input: any;
        tweens: any;
        cache: any;
        registry: any;
        sound: any;
        time: any;
        scene: any;
        anims = { exists: vi.fn(() => false), create: vi.fn() };
      },
      GameObjects: { Container: class {}, Text: class {}, Sprite: class {} },
      Math: {
        Clamp: (v: number, a: number, b: number) => Math.max(a, Math.min(b, v)),
        Vector2: hoisted.V2,
      },
      Input: { Keyboard: { KeyCodes: { W: 87, A: 65, S: 83, D: 68, J: 74, K: 75, SPACE: 32 } } },
    },
  };
});

import { MatchScene } from '../src/scenes/MatchScene';
import { MenuScene } from '../src/scenes/MenuScene';
import { BALANCE_CONFIG } from '../src/data/balance';
import { UI_TEXT } from '../src/data/uiText';
import { defaultMatchSettings, currentSettings, createSettingsMenu, resolveMatchInitData } from '../src/match/settingsModel';
import { canPauseMatch } from '../src/match/pauseState';

function buildMatchScene(initData?: Record<string, unknown>) {
  const scene = new MatchScene();
  scene.init(initData as any);
  scene.create();
  return scene as any;
}

function stepToPlaying(scene: any, maxMs = 20000): number {
  let t = 0;
  while (scene.manager.state !== 'PLAYING' && t < maxMs) {
    t += 16;
    scene.update(t, 16);
  }
  expect(scene.manager.state).toBe('PLAYING');
  return t;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('settings reach the match systems on create()', () => {
  it('surface + weather flow into WeatherSystem, duration into the clock, volume into AudioDirector', () => {
    const scene = buildMatchScene({
      surface: 'DIRT',
      weather: 'RAIN',
      durationRealMinutes: 5,
      volume: 0.5,
    });
    expect(scene.weatherSystem.pitchQuality).toBe('DIRT');
    expect(scene.weatherSystem.weatherType).toBe('RAIN');
    expect(scene.manager.timeRemaining).toBe(900); // 5 real minutes at GAME_TIME_SCALE 3
    expect(scene.audio.getMasterVolume()).toBe(0.5);
  });

  it('without init data the match behaves exactly as before (zero-change guard)', () => {
    const scene = buildMatchScene();
    expect(scene.weatherSystem.pitchQuality).toBe(BALANCE_CONFIG.SURFACE.DEFAULT_LEVEL);
    expect(scene.weatherSystem.weatherType).toBe(BALANCE_CONFIG.WEATHER.DEFAULT_TYPE);
    expect(scene.manager.timeRemaining).toBe(BALANCE_CONFIG.MATCH.TIME_REMAINING_GAME_SECONDS);
    expect(scene.audio.getMasterVolume()).toBe(BALANCE_CONFIG.AUDIO.MASTER_VOLUME);
    expect(scene.formations).toEqual({ home: '11v11', away: '11v11' });
  });

  it('formation setting resolves through the existing resolveMatchFormations seam', () => {
    const scene = buildMatchScene({
      formationHome: '5v5',
      formationAway: '5v5',
    });
    expect(scene.formations).toEqual({ home: '5v5', away: '5v5' });
    expect(scene.homeTeam).toHaveLength(5);
    expect(scene.awayTeam).toHaveLength(5);
  });
});

describe('pause wiring — Esc key + on-screen button + frozen updates', () => {
  it('MatchScene registers the Esc pause handler and a visible PAUSA button', () => {
    const scene = buildMatchScene();
    const keyCalls = (scene.input.keyboard.on as any).mock.calls as Array<[string, () => void]>;
    expect(keyCalls.some((c) => c[0] === 'keydown-ESC')).toBe(true);
    const textCalls = (scene.add.text as any).mock.calls as Array<[number, number, string]>;
    expect(textCalls.some((c) => c[2] === UI_TEXT.HUD.PAUSE_BUTTON)).toBe(true);
  });

  it('pausing freezes the match clock; resuming continues from the same second', () => {
    const scene = buildMatchScene();
    stepToPlaying(scene);
    const before = scene.manager.getTime();

    scene.togglePause();
    expect(scene.isPaused).toBe(true);
    // Simulate frames while paused — the clock must NOT move.
    for (let i = 0; i < 30; i++) {
      scene.update(16 * i, 16);
    }
    expect(scene.manager.getTime()).toBe(before);

    scene.togglePause();
    expect(scene.isPaused).toBe(false);
    scene.update(16 * 40, 16);
    expect(scene.manager.getTime()).toBeLessThan(before);
  });

  it('Esc is ignored in terminal states (results panel is already final)', () => {
    const scene = buildMatchScene();
    scene.manager.state = 'RESULTS';
    scene.togglePause();
    expect(scene.isPaused).toBe(false);
  });

  it('a charged/human kick cannot move the ball while paused', () => {
    const scene = buildMatchScene({ formationHome: '3v3', formationAway: '3v3' });
    stepToPlaying(scene);
    const human = scene.player;
    human.setPosition(490, 270); // adjacent to the center ball
    const applyKick = vi.spyOn(scene.ball, 'applyKick');

    scene.togglePause();
    human.shootWithPower(0.8, new Vec2(1, 0) as unknown as Phaser.Math.Vector2);
    expect(applyKick).not.toHaveBeenCalled();

    scene.togglePause();
    // The first attempt armed the kick-clip spam guard (200ms window in real
    // gameplay); reset the pose so the same action can repeat immediately.
    human.resetAnimation();
    human.shootWithPower(0.8, new Vec2(1, 0) as unknown as Phaser.Math.Vector2);
    expect(applyKick).toHaveBeenCalledTimes(1);
  });

  it('pausing during a set piece never wedges the restart (resume -> safety timer -> PLAYING)', () => {
    const scene = buildMatchScene({ formationHome: '3v3', formationAway: '3v3' });
    stepToPlaying(scene);
    scene.manager.state = 'FREE_KICK';

    scene.togglePause();
    expect(scene.isPaused).toBe(true);
    scene.update(16, 16);
    expect(scene.manager.state).toBe('FREE_KICK');

    scene.togglePause();
    let t = 0;
    while (scene.manager.state !== 'PLAYING' && t < BALANCE_CONFIG.FOUL.SET_PIECE_MAX_WAIT_MS * 2) {
      t += 16;
      scene.update(t, 16);
    }
    expect(scene.manager.state).toBe('PLAYING');
  });

  it('pausing during HALF keeps the halftime pause; resume still swaps sides to KICKOFF', () => {
    const scene = buildMatchScene({ formationHome: '3v3', formationAway: '3v3' });
    stepToPlaying(scene);
    scene.manager.state = 'HALF';

    scene.togglePause();
    scene.update(16, 16);
    expect(scene.manager.state).toBe('HALF');

    scene.togglePause();
    let t = 0;
    while (scene.manager.state === 'HALF' && t < 10000) {
      t += 16;
      scene.update(t, 16);
    }
    expect(scene.manager.state).toBe('KICKOFF');
    expect(scene.manager.sidesSwapped).toBe(true);
  });
});

describe('pause menu actions — CONTINUAR / REINICIAR / AJUSTES / SALIR', () => {
  it('REINICIAR PARTIDO restarts to INTRO honoring the CURRENT duration setting', () => {
    const scene = buildMatchScene({ durationRealMinutes: 5 });
    stepToPlaying(scene);
    scene.togglePause();

    (scene as any).handlePauseAction('restart');
    expect(scene.isPaused).toBe(false);
    expect(scene.manager.state).toBe('INTRO');
    expect(scene.manager.timeRemaining).toBe(900);
    expect(scene.manager.score).toEqual({ home: 0, away: 0 });
  });

  it('AJUSTES adjusts volume live through AudioDirector', () => {
    const scene = buildMatchScene();
    stepToPlaying(scene);
    scene.togglePause();

    (scene as any).handlePauseAction('settings');
    (scene as any).applyPauseAdjust({ volume: 0.25 });
    expect(scene.audio.getMasterVolume()).toBe(0.25);
    expect((scene as any).matchSettings.volume).toBe(0.25);

    (scene as any).handlePauseAction('back');
    (scene as any).handlePauseAction('resume');
    expect(scene.isPaused).toBe(false);
  });

  it('AJUSTES adjusts weather live: WeatherSystem swaps and modifiers recompose', () => {
    const scene = buildMatchScene(); // REGULAR_GRASS + CLEAR_DAY
    stepToPlaying(scene);
    const frictionBefore = scene.ballFrictionMultiplier();
    scene.togglePause();

    (scene as any).handlePauseAction('settings');
    (scene as any).applyPauseAdjust({ weather: 'SNOW' });
    expect(scene.weatherSystem.weatherType).toBe('SNOW');
    expect(scene.ballFrictionMultiplier()).not.toBe(frictionBefore);
    expect((scene as any).matchSettings.weather).toBe('SNOW');
  });

  it('SALIR AL MENÚ starts MenuScene carrying the current settings', () => {
    const scene = buildMatchScene({ surface: 'DIRT', weather: 'RAIN', durationRealMinutes: 5, volume: 0.5 });
    stepToPlaying(scene);
    scene.togglePause();

    (scene as any).handlePauseAction('quit');
    expect(scene.scene.start).toHaveBeenCalledWith('MenuScene', {
      settings: {
        surface: 'DIRT',
        weather: 'RAIN',
        formation: '11v11',
        durationMinutes: 5,
        volume: 0.5,
      },
    });
  });

  it('restart from pause is blocked in a terminal state by the pause guard itself', () => {
    const scene = buildMatchScene();
    scene.manager.state = 'RESULTS';
    expect(canPauseMatch(scene.manager.state)).toBe(false);
    scene.togglePause(); // no-op
    expect(scene.isPaused).toBe(false);
  });
});

describe('MenuScene — pre-match settings flow (keyboard + touch)', () => {
  function buildMenuScene(initData?: { settings?: unknown }) {
    const scene = new MenuScene();
    (scene as any).init(initData);
    scene.create();
    return scene as any;
  }

  it('renders the six Spanish rows + title + hint from config', () => {
    const scene = buildMenuScene();
    const textCalls = (scene.add.text as any).mock.calls as Array<[number, number, string]>;
    const texts = textCalls.map((c) => c[2]);
    expect(texts).toContain(UI_TEXT.MENU.TITLE);
    expect(texts).toContain(UI_TEXT.MENU.NAV_HINT);
    for (const row of Object.values(UI_TEXT.MENU.ROWS)) {
      expect(texts.some((t) => typeof t === 'string' && t.includes(row))).toBe(true);
    }
  });

  it('keyboard: arrows move/adjust, Enter on JUGAR starts the match with chosen settings', () => {
    const scene = buildMenuScene();
    const keyCalls = (scene.input.keyboard.on as any).mock.calls as Array<[string, () => void]>;
    const handler = (key: string) => {
      const call = keyCalls.find((c) => c[0] === key);
      expect(call, `${key} handler must be registered`).toBeDefined();
      call![1]();
    };

    // adjust CLIMA (row 1) to RAIN, move to JUGAR, Enter.
    handler('keydown-DOWN');
    handler('keydown-RIGHT');
    handler('keydown-DOWN');
    handler('keydown-DOWN');
    handler('keydown-DOWN');
    handler('keydown-DOWN'); // cursor on JUGAR (5)
    handler('keydown-ENTER');

    expect(scene.scene.start).toHaveBeenCalledWith('MatchScene', resolveMatchInitData(currentSettings(scene.model)));
    const init = (scene.scene.start as any).mock.calls[0][1];
    expect(init.weather).toBe('RAIN');
  });

  it('returning from a match restores the previous settings into the menu', () => {
    const settings = {
      ...defaultMatchSettings(),
      surface: 'DIRT' as const,
      weather: 'SNOW' as const,
      formation: '5v5' as const,
      durationMinutes: 5,
      volume: 0.25,
    };
    const scene = buildMenuScene({ settings });
    expect(currentSettings(scene.model)).toEqual(settings);
  });

  it('tap on a settings row cycles it; tap on JUGAR starts the match', () => {
    const scene = buildMenuScene();
    const rowTexts = scene.rowTexts as Array<{ handlers: Record<string, Array<() => void>> }>;
    // TERRENO row tap cycles the surface off its default.
    const surfaceBefore = currentSettings(scene.model).surface;
    rowTexts[0].handlers.pointerdown[0]();
    expect(currentSettings(scene.model).surface).not.toBe(surfaceBefore);
    // JUGAR tap starts the match.
    rowTexts[5].handlers.pointerdown[0]();
    expect(scene.scene.start).toHaveBeenCalledWith(
      'MatchScene',
      expect.objectContaining({ surface: currentSettings(scene.model).surface }),
    );
  });
});

describe('menu model ↔ scene data round-trip', () => {
  it('default menu produces the exact default MatchScene behavior payload', () => {
    const m = createSettingsMenu();
    const init = resolveMatchInitData(currentSettings(m));
    expect(init.surface).toBe(BALANCE_CONFIG.SURFACE.DEFAULT_LEVEL);
    expect(init.weather).toBe(BALANCE_CONFIG.WEATHER.DEFAULT_TYPE);
    expect(init.formationHome).toBe('11v11');
    expect(init.formationAway).toBe('11v11');
    expect(init.durationRealMinutes).toBe(BALANCE_CONFIG.MATCH.DURATION_REAL_MINUTES);
    expect(init.volume).toBe(BALANCE_CONFIG.AUDIO.MASTER_VOLUME);
  });
});
