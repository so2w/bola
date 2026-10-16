import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type Phaser from 'phaser';

// ---------------------------------------------------------------------------
// Playtest round 2 — scene-level integration (mocked Phaser, REAL domain):
//   Player, Ball, MatchScene, MatchManager, coordinators, kickGate.
//
// Covers:
//   TASK 1: kickoff grace at the wireShots + handleAIKick code paths.
//   TASK 2: away kit — spawn frame per team + updateAnimation for ALL players.
//   TASK 4: 3v3 spawn sanity — 6 players, GK per side, on-pitch, reset equality.
// ---------------------------------------------------------------------------

// Hoisted so the vi.mock factory (hoisted above all imports) can reference them.
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
    const o: any = { x: x ?? 0, y: y ?? 0, visible: true };
    for (const m of ['setOrigin', 'setDepth', 'setInteractive', 'setVisible', 'setText', 'setScale', 'setAlpha', 'setScrollFactor', 'setPosition', 'setFillStyle', 'setPadding', 'clear', 'lineStyle', 'strokeCircle', 'fillStyle', 'fillTriangle']) {
      o[m] = vi.fn(function (this: any, v?: unknown) {
        if (m === 'setVisible') o.visible = v as boolean;
        return o;
      });
    }
    o.on = vi.fn(() => o);
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
import { Player } from '../src/entities/Player';
import { buildFrameMap } from '../src/entities/frameMap';
import { kickoffAnchors } from '../src/match/restartPlacement';
import { BALANCE_CONFIG } from '../src/data/balance';

const W = BALANCE_CONFIG.PHYSICS.PITCH_WIDTH;
const H = BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT;

function buildScene() {
  const scene = new MatchScene();
  // TASK 4 is an explicit 3v3 spawn sanity check; the shipped default is
  // 11v11 (Batch B1), so small-sided scenes pass their formation explicitly.
  scene.init({ formationHome: '3v3', formationAway: '3v3' });
  scene.create();
  return scene as any;
}

/** Steps the scene until the manager reaches PLAYING (through KICKOFF pause). */
function stepToPlaying(scene: any): number {
  let t = 0;
  while (scene.manager.state !== 'PLAYING' && t < 10000) {
    t += 16;
    scene.update(t, 16);
  }
  expect(scene.manager.state).toBe('PLAYING');
  return t;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TASK 4 — 3v3 spawn sanity with real entities on pitch', () => {
  it('create() spawns exactly 6 players: 3 home + 3 away, one GK each', () => {
    const scene = buildScene();
    expect(scene.homeTeam).toHaveLength(3);
    expect(scene.awayTeam).toHaveLength(3);
    expect(scene.homeTeam.filter((p: Player) => p.team === 'home')).toHaveLength(3);
    expect(scene.awayTeam.filter((p: Player) => p.team === 'away')).toHaveLength(3);
    expect(scene.roles.home).toContain('GK');
    expect(scene.roles.away).toContain('GK');
  });

  it('all players and the ball spawn inside the pitch bounds, ball at center', () => {
    const scene = buildScene();
    // Batch A (INTRO): teams walk in from the off-pitch tunnel — the entrance
    // completes (skip) onto the same inside-pitch kickoff spots as before.
    expect(scene.manager.state).toBe('INTRO');
    scene.manager.skipIntro();
    expect(scene.manager.state).toBe('KICKOFF');
    for (const p of [...scene.homeTeam, ...scene.awayTeam] as Player[]) {
      expect(p.sprite.x).toBeGreaterThanOrEqual(0);
      expect(p.sprite.x).toBeLessThanOrEqual(W);
      expect(p.sprite.y).toBeGreaterThanOrEqual(0);
      expect(p.sprite.y).toBeLessThanOrEqual(H);
    }
    expect(scene.ball.sprite.x).toBe(480);
    expect(scene.ball.sprite.y).toBe(270);
    // GK is on the pitch for BOTH sides (playtest: GK invisible/off-frame).
    const homeGk = (scene.homeTeam as Player[])[scene.roles.home.indexOf('GK')];
    const awayGk = (scene.awayTeam as Player[])[scene.roles.away.indexOf('GK')];
    for (const gk of [homeGk, awayGk]) {
      expect(gk.sprite.x).toBeGreaterThanOrEqual(0);
      expect(gk.sprite.x).toBeLessThanOrEqual(W);
    }
  });

  it('GOAL -> reset restores the SAME kickoff coordinates (no drift, no side flip)', () => {
    const scene = buildScene();
    // Batch 5: spawn and reset both use own-half kickoffAnchors.
    const spawnHome = kickoffAnchors('3v3', 'home');
    const spawnAway = kickoffAnchors('3v3', 'away');

    const mgr = scene.manager;
    mgr.state = 'PLAYING';
    mgr.handleGoal('home');
    expect(mgr.state).toBe('GOAL');

    let t = 0;
    while (mgr.state !== 'KICKOFF' && t < 10000) {
      t += 16;
      scene.update(t, 16);
    }
    expect(mgr.state).toBe('KICKOFF');

    (scene.homeTeam as Player[]).forEach((p, i) => {
      expect([p.sprite.x, p.sprite.y]).toEqual([spawnHome[i].x, spawnHome[i].y]);
    });
    (scene.awayTeam as Player[]).forEach((p, i) => {
      expect([p.sprite.x, p.sprite.y]).toEqual([spawnAway[i].x, spawnAway[i].y]);
    });
    expect([scene.ball.sprite.x, scene.ball.sprite.y]).toEqual([480, 270]);
  });
});

describe('TASK 2 — away kit rendering', () => {
  it('players spawn on their team idle frame (home=home-idle, away=away-idle)', () => {
    const scene = buildScene();
    const map = buildFrameMap(manifest);
    for (const p of scene.homeTeam as Player[]) {
      expect(p.sprite.frame, `home player ${p.sprite.x} born on wrong frame`).toBe(map.get('home-idle'));
    }
    for (const p of scene.awayTeam as Player[]) {
      expect(p.sprite.frame, `away player ${p.sprite.x} born on wrong frame`).toBe(map.get('away-idle'));
    }
  });

  it('update() animates ALL players with their team clips, not only the controlled one', () => {
    const scene = buildScene();
    scene.update(16, 16); // KICKOFF: controllers gated, animation must still run
    for (const p of scene.homeTeam as Player[]) {
      const plays = (p.sprite.anims.play as any).mock.calls.map((c: any[]) => c[0]);
      expect(plays).toContain('player_idle_home');
    }
    for (const p of scene.awayTeam as Player[]) {
      const plays = (p.sprite.anims.play as any).mock.calls.map((c: any[]) => c[0]);
      expect(plays).toContain('player_idle_away');
    }
  });

  it('a moving away player plays away-run (mid-play kit stays visible)', () => {
    const scene = buildScene();
    const away = scene.awayTeam[1] as Player;
    away.body.setVelocity(100, 0); // simulate locomotion
    away.updateAnimation(16);
    expect(away.sprite.anims.play).toHaveBeenCalledWith('player_run_away', true);
    expect(away.sprite.anims.play).not.toHaveBeenCalledWith('player_run_home', true);
  });
});

describe('TASK 1 — kickoff own-goal guard at the real scene paths', () => {
  it('human KICK facing the own half DURING the kickoff grace window is suppressed', () => {
    const scene = buildScene();
    stepToPlaying(scene); // playResumedAtMs recorded by update()
    const human = scene.player as Player;
    human.setPosition(490, 270); // adjacent to the center-spot ball
    const applyKick = vi.spyOn(scene.ball, 'applyKick');

    human.shootWithPower(0.8, new Vec2(-1, 0) as unknown as Phaser.Math.Vector2);
    expect(applyKick).not.toHaveBeenCalled();
  });

  it('human KICK facing the attacking half during grace IS allowed (no over-blocking)', () => {
    const scene = buildScene();
    stepToPlaying(scene);
    const human = scene.player as Player;
    human.setPosition(490, 270);
    const applyKick = vi.spyOn(scene.ball, 'applyKick');

    human.shootWithPower(0.8, new Vec2(1, 0) as unknown as Phaser.Math.Vector2);
    expect(applyKick).toHaveBeenCalledTimes(1);
  });

  it('the same own-half KICK fires once the grace window has elapsed', () => {
    const scene = buildScene();
    const t0 = stepToPlaying(scene);
    const human = scene.player as Player;
    human.setPosition(490, 270);

    const t1 = t0 + BALANCE_CONFIG.MATCH.KICKOFF_GRACE_MS + 100;
    scene.update(t1, 16); // advance scene clock past the grace window
    const applyKick = vi.spyOn(scene.ball, 'applyKick');
    human.shootWithPower(0.8, new Vec2(-1, 0) as unknown as Phaser.Math.Vector2);
    expect(applyKick).toHaveBeenCalledTimes(1);
  });

  it('AI own-half SHOOT during grace is downgraded (no applyKick) via handleAIKick', () => {
    const scene = buildScene();
    stepToPlaying(scene);
    const awayFw = scene.awayTeam[2] as Player;
    awayFw.setPosition(470, 270); // next to the ball
    const applyKick = vi.spyOn(scene.ball, 'applyKick');

    // Away attacks LEFT (attackDir -1): a SHOOT targeting its own half (x>kicker)
    // during the grace window must be downgraded to HOLD.
    scene.handleAIKick(awayFw, { action: 'SHOOT', targetX: 900, targetY: 270, power: 0.9 });
    expect(applyKick).not.toHaveBeenCalled();

    // Attacking SHOOT (toward x=60, away's attacking goal) still goes through.
    scene.handleAIKick(awayFw, { action: 'SHOOT', targetX: 60, targetY: 270, power: 0.9 });
    expect(applyKick).toHaveBeenCalledTimes(1);
  });
});
