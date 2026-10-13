import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MatchManager } from '../src/systems/MatchManager';

// ---------------------------------------------------------------------------
// Phaser mock: chainable GameObjects so MatchScene.create() can run for real
// and we can capture the input handlers it registers (R key, Restart, Cancel).
// ---------------------------------------------------------------------------
vi.mock('phaser', () => {
  const chain = () => {
    const o: any = {
      visible: true,
      body: {
        setVelocity: vi.fn(),
        setAcceleration: vi.fn(),
        setImmovable: vi.fn(),
        velocity: { x: 0, y: 0 },
      },
    };
    for (const m of [
      'setOrigin',
      'setDepth',
      'setInteractive',
      'setVisible',
      'setTint',
      'setText',
      'setScale',
      'setAlpha',
      'setPadding',
      'setScrollFactor',
      'setFillStyle',
    ]) {
      o[m] = vi.fn(function (this: any, v?: unknown) {
        if (m === 'setVisible') {
          this.visible = v;
        }
        return o;
      });
    }
    o.on = vi.fn(() => o);
    o.add = vi.fn();
    return o;
  };
  return {
    default: {
      Scene: class {
        constructor(_key?: string) {
          this.add = {
            image: vi.fn(() => chain()),
            text: vi.fn(() => chain()),
            zone: vi.fn(() => chain()),
            rectangle: vi.fn(() => chain()),
            container: vi.fn(() => chain()),
          };
          this.physics = {
            world: { setBounds: vi.fn(), enable: vi.fn() },
            add: { overlap: vi.fn() },
          };
          this.cameras = { main: { shake: vi.fn() } };
          this.input = { keyboard: { on: vi.fn() } };
          this.tweens = { add: vi.fn() };
        }
        add: any;
        physics: any;
        cameras: any;
        input: any;
        tweens: any;
      },
      GameObjects: { Container: class {}, Text: class {} },
      Math: {
        Clamp: (v: number, a: number, b: number) => Math.max(a, Math.min(b, v)),
        Vector2: class {
          constructor(public x = 0, public y = 0) {}
          normalize() {
            return this;
          }
          lengthSq() {
            return this.x * this.x + this.y * this.y;
          }
        },
      },
    },
  };
});

// ---------------------------------------------------------------------------
// Heavy dependency mocks — MatchScene.create() must run in Node.
// ---------------------------------------------------------------------------
vi.mock('../src/entities/Player', () => ({
  Player: class {
    sprite = { x: 0, y: 0, setTint: vi.fn() };
    body = { setVelocity: vi.fn(), setAcceleration: vi.fn(), velocity: { x: 0, y: 0 } };
    preUpdate = vi.fn();
    updateAnimation = vi.fn();
    updateController = vi.fn();
    setPosition = vi.fn();
    shootWithPower = vi.fn();
    onShot = vi.fn();
    attachController = vi.fn();
    getPower = vi.fn(() => 0);
    isChargingNow = vi.fn(() => false);
    constructor(_scene?: unknown, _x?: number, _y?: number) {}
  },
}));

vi.mock('../src/entities/Ball', () => ({
  Ball: class {
    sprite = { x: 480, y: 270 };
    body = { setVelocity: vi.fn(), velocity: { x: 0, y: 0 } };
    z = 0;
    reset = vi.fn();
    applyKick = vi.fn();
    preUpdate = vi.fn();
    constructor(_scene?: unknown, _x?: number, _y?: number) {}
  },
}));

vi.mock('../src/match/CameraController', () => ({
  CameraController: class {
    update = vi.fn();
    constructor(_cam?: unknown) {}
  },
}));

vi.mock('../src/match/PlayerSelectionSystem', () => ({
  PlayerSelectionSystem: class {
    update = vi.fn(() => null);
  },
}));

vi.mock('../src/match/PossessionSystem', () => ({
  PossessionSystem: class {
    update = vi.fn();
    onKick = vi.fn();
  },
}));

vi.mock('../src/input/HumanInputController', () => ({
  HumanInputController: class {
    setContext(_ctx: unknown): void {}
  },
}));

vi.mock('../src/input/AIController', () => ({
  AIController: class {
    setCommand = vi.fn();
    constructor(_cb?: unknown) {}
  },
}));

vi.mock('../src/ai/TeamCoordinator', () => ({
  TeamCoordinator: class {
    update = vi.fn(() => new Map());
    tickGK = vi.fn();
    constructor(_side?: string, _formations?: unknown) {}
  },
}));

import { MatchScene } from '../src/scenes/MatchScene';

/** Builds a real MatchScene via create() and exposes captured UI handles. */
function buildScene() {
  const scene: any = new MatchScene();
  scene.create();
  const texts: any[] = (scene.add.text as any).mock.results.map((r: any) => r.value);
  const containers: any[] = (scene.add.container as any).mock.results.map(
    (r: any) => r.value,
  );
  return { scene, texts, containers };
}

/** First registered pointerdown handler of a mocked text object. */
function pointerHandler(text: any): () => void {
  const call = (text.on as any).mock.calls.find((c: any[]) => c[0] === 'pointerdown');
  expect(call, 'expected a pointerdown handler').toBeDefined();
  return call![1] as () => void;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// MatchManager — real class, no Phaser needed
// ---------------------------------------------------------------------------

describe('MatchManager.restart (team arrays)', () => {
  it('resets score/time/state via formation anchors', () => {
    const mgr = new MatchManager();
    mgr.state = 'GAME_OVER';
    mgr.timeRemaining = 120;
    mgr.score = { home: 3, away: 2 };
    mgr.kickoffTimer = 0;
    mgr.resetTimer = 500;

    const ball = { reset: vi.fn() };
    const mk = () => ({ setPosition: vi.fn(), body: { setVelocity: vi.fn() } });
    const home = [mk(), mk(), mk()];
    const away = [mk(), mk(), mk()];
    mgr.bind({} as any, ball as any, home as any, away as any, { home: '3v3', away: '3v3' });

    mgr.restart();

    expect(mgr.state).toBe('KICKOFF');
    expect(mgr.timeRemaining).toBe(540);
    expect(mgr.score).toEqual({ home: 0, away: 0 });
    expect(mgr.kickoffTimer).toBe(1500);
    expect(mgr.resetTimer).toBe(0);
    expect(ball.reset).toHaveBeenCalled();
  });
});

describe('MatchManager GAME_OVER time zero transition (REQ-GO-1 / R-MGR-1)', () => {
  it('transitions PLAYING → GAME_OVER when the clock hits zero and never goes negative', () => {
    const mgr = new MatchManager();
    mgr.state = 'PLAYING';
    mgr.timeRemaining = 1; // 1 game second left

    // 334ms real * 3 = 1.002 game seconds → clamped to 0
    mgr.update(334);

    expect(mgr.state).toBe('GAME_OVER');
    expect(mgr.timeRemaining).toBe(0);

    // GAME_OVER is terminal: further updates are no-ops
    mgr.update(1000);
    expect(mgr.state).toBe('GAME_OVER');
    expect(mgr.timeRemaining).toBe(0);
    expect(mgr.getTime()).toBe(0);
  });
});

describe('MatchManager kickoff → playing transition and 3x clock (R-MGR-1)', () => {
  it('transitions KICKOFF → PLAYING after the kickoff timer and runs the clock at 3x', () => {
    const mgr = new MatchManager();
    expect(mgr.state).toBe('KICKOFF');

    mgr.update(1000);
    expect(mgr.state).toBe('KICKOFF'); // 500ms of kickoff pause left

    mgr.update(500); // total 1500ms
    expect(mgr.state).toBe('PLAYING');

    // PLAYING: 1000ms real → 3 game seconds elapsed
    mgr.update(1000);
    expect(mgr.timeRemaining).toBe(537);
  });
});

// ---------------------------------------------------------------------------
// MatchScene — real create()/update() against mocked Phaser
// ---------------------------------------------------------------------------

describe('MatchScene Game Over visibility', () => {
  it('shows gameOverGroup when state is GAME_OVER and hides otherwise', () => {
    const scene = new MatchScene() as any;
    const manager = new MatchManager();
    const gameOverGroup = {
      visible: false,
      setVisible: vi.fn(function (v: boolean) {
        this.visible = v;
      }),
    };
    const scoreText = { setText: vi.fn() };
    (gameOverGroup as any).scoreText = scoreText;

    scene.manager = manager;
    scene.gameOverGroup = gameOverGroup;
    scene.resultOverlayGroup = {
      visible: false,
      setVisible: vi.fn(function (v: boolean) {
        this.visible = v;
      }),
    };
    scene.player = {
      body: { setVelocity: vi.fn(), setAcceleration: vi.fn() },
      preUpdate: vi.fn(),
      updateAnimation: vi.fn(),
    };
    scene.ball = { preUpdate: vi.fn() };
    scene.clockText = { setText: vi.fn() };
    scene.scoreText = { setText: vi.fn() };
    scene.ai = undefined;
    scene.rival = undefined;

    manager.state = 'GAME_OVER';
    manager.score = { home: 1, away: 2 };
    scene.update(0, 16);

    expect(gameOverGroup.setVisible).toHaveBeenCalledWith(true);
    expect(scoreText.setText).toHaveBeenCalledWith('1 - 2');

    manager.state = 'PLAYING';
    scene.update(0, 16);
    expect(gameOverGroup.setVisible).toHaveBeenCalledWith(false);
  });
});

describe('MatchScene R key restart (GO-SCREEN-2)', () => {
  it('R keydown restarts the match and hides the game over overlay', () => {
    const { scene, containers } = buildScene();
    const mgr: MatchManager = scene.manager;
    const gameOverGroup = containers[0];

    mgr.state = 'GAME_OVER';
    mgr.score = { home: 2, away: 1 };

    const keyCalls = (scene.input.keyboard.on as any).mock.calls as Array<[string, () => void]>;
    const rCall = keyCalls.find((c) => c[0] === 'keydown-R');
    expect(rCall, 'keydown-R handler must be registered').toBeDefined();
    const rHandler = rCall![1];

    rHandler();

    expect(mgr.state).toBe('KICKOFF');
    expect(mgr.timeRemaining).toBe(540);
    expect(mgr.score).toEqual({ home: 0, away: 0 });
    expect((gameOverGroup.setVisible as any).mock.calls.at(-1)).toEqual([false]);
  });

  it('R key is ignored unless the match is GAME_OVER (guard)', () => {
    const { scene, containers } = buildScene();
    const mgr: MatchManager = scene.manager;

    mgr.state = 'PLAYING';
    (containers[0].setVisible as any).mockClear();

    const keyCalls = (scene.input.keyboard.on as any).mock.calls as Array<[string, () => void]>;
    const rHandler = keyCalls.find((c) => c[0] === 'keydown-R')![1];
    rHandler();

    expect(mgr.state).toBe('PLAYING'); // no restart mid-match
    expect(containers[0].setVisible).not.toHaveBeenCalled();
  });
});

describe('MatchScene Restart button click (GO-SCREEN-2)', () => {
  it('clicking Restart resets the match and hides the overlay', () => {
    const { scene, texts, containers } = buildScene();
    const mgr: MatchManager = scene.manager;

    mgr.state = 'GAME_OVER';
    mgr.score = { home: 1, away: 0 };

    // add.text call order: clock, score, cancel, goTitle, goScore, goRestart, ...
    const restartBtn = texts[5];
    const handler = pointerHandler(restartBtn);
    handler();

    expect(mgr.state).toBe('KICKOFF');
    expect(mgr.timeRemaining).toBe(540);
    expect(mgr.score).toEqual({ home: 0, away: 0 });
    expect((containers[0].setVisible as any).mock.calls.at(-1)).toEqual([false]);
  });
});

describe('MatchScene Cancel button (RESULT-1 / REQ-UI-2)', () => {
  it('Cancel toggles the result overlay open and closed while PLAYING', () => {
    const { scene, texts, containers } = buildScene();
    const overlay = containers[1];
    const cancelBtn = texts[2];
    const handler = pointerHandler(cancelBtn);

    (scene.manager as MatchManager).state = 'PLAYING';
    expect(overlay.visible).toBe(false); // starts hidden

    handler();
    expect(overlay.visible).toBe(true);

    handler();
    expect(overlay.visible).toBe(false);
  });
});

describe('MatchScene Cancel state guard (verify WARNING-1 resolution)', () => {
  it('Cancel is ignored unless the match is PLAYING', () => {
    const { scene, texts, containers } = buildScene();
    const mgr: MatchManager = scene.manager;
    const overlay = containers[1];
    const handler = pointerHandler(texts[2]);

    mgr.state = 'KICKOFF';
    handler();
    expect(overlay.visible).toBe(false);

    mgr.state = 'GAME_OVER';
    handler();
    expect(overlay.visible).toBe(false); // game-over panel already shows the score

    mgr.state = 'PLAYING';
    handler();
    expect(overlay.visible).toBe(true);
    handler();
    expect(overlay.visible).toBe(false);
  });
});

describe('MatchScene result overlay auto-hide at GAME_OVER', () => {
  it('hides a stale result overlay once the match reaches GAME_OVER', () => {
    const { scene, containers } = buildScene();
    const mgr: MatchManager = scene.manager;
    const overlay = containers[1];

    mgr.state = 'PLAYING';
    overlay.visible = true;
    scene.update(0, 16);
    expect(overlay.visible).toBe(true);

    mgr.state = 'GAME_OVER';
    scene.update(0, 16);
    expect(overlay.visible).toBe(false); // never stacked under the game-over panel
  });
});

describe('MatchScene result overlay close (RESULT-1)', () => {
  it('shows the current score while open and Close restores input', () => {
    const { scene, texts, containers } = buildScene();
    const mgr: MatchManager = scene.manager;
    const overlay = containers[1];

    mgr.state = 'PLAYING';
    mgr.score = { home: 2, away: 3 };

    // Overlay open → update() syncs its score text
    overlay.visible = true;
    scene.update(0, 16);
    const roScoreText = texts[7];
    expect(roScoreText.setText).toHaveBeenCalledWith('2 - 3');

    // Close via the "Cerrar" button
    const closeBtn = texts[8];
    const handler = pointerHandler(closeBtn);
    handler();
    expect(overlay.visible).toBe(false);

    // Input restored: controlled player preUpdate runs again
    const controlled = scene.player;
    (controlled.preUpdate as any).mockClear();
    scene.update(0, 16);
    expect(controlled.preUpdate).toHaveBeenCalled();
  });
});

describe('MatchScene result overlay toggles canPlay', () => {
  it('disables player update when overlay visible or not playing', () => {
    const scene = new MatchScene() as any;
    const manager = new MatchManager();
    manager.state = 'PLAYING';

    const resultOverlayGroup = { visible: false };
    const gameOverGroup = { setVisible: vi.fn() };

    const playerBody = { setVelocity: vi.fn(), setAcceleration: vi.fn() };
    scene.player = {
      body: playerBody,
      preUpdate: vi.fn(),
      updateAnimation: vi.fn(),
    };
    scene.ball = { preUpdate: vi.fn() };
    scene.manager = manager;
    scene.gameOverGroup = gameOverGroup;
    scene.resultOverlayGroup = resultOverlayGroup;
    scene.clockText = { setText: vi.fn() };
    scene.scoreText = { setText: vi.fn() };
    scene.ai = undefined;
    scene.rival = undefined;

    // overlay hidden, playing -> canPlay true
    scene.update(0, 16);
    expect(playerBody.setVelocity).not.toHaveBeenCalled();
    expect(scene.player.preUpdate).toHaveBeenCalled();

    // overlay visible -> canPlay false, velocity zeroed
    resultOverlayGroup.visible = true;
    scene.player.preUpdate.mockClear();
    scene.update(0, 16);
    expect(playerBody.setVelocity).toHaveBeenCalledWith(0, 0);
    expect(scene.player.preUpdate).not.toHaveBeenCalled();
    expect(scene.player.updateAnimation).toHaveBeenCalled();

    // not playing -> canPlay false
    resultOverlayGroup.visible = false;
    manager.state = 'KICKOFF';
    scene.player.preUpdate.mockClear();
    scene.update(0, 16);
    expect(playerBody.setVelocity).toHaveBeenCalledWith(0, 0);
  });
});
