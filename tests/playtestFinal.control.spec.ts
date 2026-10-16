import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type Phaser from 'phaser';

// ---------------------------------------------------------------------------
// Playtest final — items 2 & 3 (control handoff):
//   2. "Cuando me marcan gol, el jugador que saca es aleatorio y quedo en
//      desventaja" — after conceding, control must go to the kickoff taker
//      (nearest home player to the ball at kickoff anchors) and HOLD through
//      KICKOFF into PLAYING until the first kick.
//   3. "Cuando me hacen falta, un compañero toma el balón pero no lo
//      controlo" — when the opponent fouls the user's team, control must go
//      to the free-kick taker and hold through the resume.
//
// Scene-level integration with the REAL domain classes and mocked Phaser
// (same harness pattern as playtestRound2.scene.spec.ts).
// ---------------------------------------------------------------------------

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
          this.time = {
            now: 0,
            delayedCall: vi.fn(() => ({ remove: vi.fn() })),
          };
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
import { BALANCE_CONFIG } from '../src/data/balance';
import { goalFrameGeometry } from '../src/match/goalFrame';

/** 11v11 default scene (the shipped formation). */
function buildScene() {
  const scene = new MatchScene();
  scene.create();
  return scene as any;
}

/** Steps the scene until the manager reaches PLAYING (INTRO + KICKOFF pause). */
function stepToPlaying(scene: any, t0 = 0): number {
  let t = t0;
  while (scene.manager.state !== 'PLAYING' && t < 20000) {
    t += 16;
    scene.update(t, 16);
  }
  expect(scene.manager.state).toBe('PLAYING');
  return t;
}

/** Steps the scene until the manager reaches the given state. */
function stepUntilState(scene: any, state: string, t0 = 0, maxMs = 20000): number {
  let t = t0;
  while (scene.manager.state !== state && t < t0 + maxMs) {
    t += 16;
    scene.update(t, 16);
  }
  expect(scene.manager.state).toBe(state);
  return t;
}

/**
 * White-box stale-selection injection: simulates the human having settled on
 * `id` right before the stoppage (the selector's internal state the scene
 * currently never syncs on external handoffs — the item 2/3 root cause).
 */
function injectStaleSelection(scene: any, id: string): void {
  scene.swapToHuman(id);
  const selector = scene.selectionSystem as any;
  selector.currentSelectedId = id;
  selector.switchCooldownMs = 0;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('item 1 — scene detection zones derive from the shared goal geometry', () => {
  it('goal + post-band + net-flash zones are created exactly at goalFrameGeometry values', () => {
    const scene = buildScene();
    const frames = goalFrameGeometry();
    const FB = BALANCE_CONFIG.FEEDBACK;
    const zoneCalls = (scene.add.zone.mock.calls as number[][]).map((c) => c.slice(0, 4));
    for (const side of [frames.left, frames.right]) {
      expect(zoneCalls).toContainEqual([side.zone.cx, side.zone.cy, side.zone.w, side.zone.h]);
      const bandOffset = FB.GOAL_MOUTH_HALF_HEIGHT_PX + FB.POST_BAND_HEIGHT_PX / 2;
      for (const dir of [-1, 1]) {
        expect(zoneCalls).toContainEqual([
          side.zone.cx,
          FB.GOAL_MOUTH_CENTER_Y_PX + dir * bandOffset,
          side.zone.w,
          FB.POST_BAND_HEIGHT_PX,
        ]);
      }
    }
    const rectCalls = (scene.add.rectangle.mock.calls as number[][]).map((c) => c.slice(0, 4));
    for (const side of [frames.left, frames.right]) {
      expect(rectCalls).toContainEqual([side.zone.cx, side.zone.cy, side.zone.w, side.zone.h]);
    }
  });
});

describe('item 2 — conceded kickoff: control goes to the taker and holds until the first kick', () => {
  it('RED->GREEN: away scores -> home kickoff -> the taker (nearest home to the ball) is controlled and STAYS', () => {
    const scene = buildScene();
    const t = stepToPlaying(scene);

    // The human was settled on home-7 (cm2, anchor 330,334.8 — 163px from the
    // center ball, inside the hysteresis margin of the taker's 76px) when the
    // goal was conceded.
    injectStaleSelection(scene, 'home-7');

    // Concede: away scores.
    scene.manager.handleGoal('away');
    expect(scene.manager.kickoffTeam).toBe('home'); // conceding team kicks off

    // GOAL pause -> KICKOFF -> PLAYING.
    const t2 = stepToPlaying(scene, t);
    expect(t2).toBeGreaterThan(t);

    // Taker = nearest home player to the center ball at kickoff anchors.
    // 11v11 home anchors: st1 home-9 (440,205.2) and st2 home-10 (440,334.8)
    // tie at ~76px; ties resolve to the lower index -> home-9.
    expect(scene.humanPlayerId).toBe('home-9');

    // The selector must be SYNCED with the scene handoff (root-cause check).
    expect(scene.selectionSystem.getSelectedId()).toBe(scene.humanPlayerId);

    // Hold: further PLAYING frames must not steal control while the ball is
    // untouched (no kick yet).
    let t3 = t2;
    for (let i = 0; i < 20; i++) {
      t3 += 16;
      scene.update(t3, 16);
      expect(scene.humanPlayerId).toBe('home-9');
    }

    // First kick releases the hold: normal auto-selection resumes.
    const taker = scene.homeTeam[9] as Player;
    taker.setPosition(490, 270); // walk to the ball (mocked physics do not move bodies)
    taker.shootWithPower(0.5, new Vec2(1, 0) as unknown as Phaser.Math.Vector2);
    expect(scene.manager.state).toBe('PLAYING');

    // Ball now near home-1 (moved to it; the taker walked far away): the
    // selector must be free to follow the ball again.
    taker.setPosition(900, 100);
    scene.ball.sprite.setPosition(150, 270);
    scene.ball.body.setVelocity(0, 0);
    (scene.homeTeam[1] as Player).setPosition(160, 270);
    let t4 = t3;
    for (let i = 0; i < 40; i++) {
      t4 += 16;
      scene.update(t4, 16);
    }
    expect(scene.humanPlayerId).not.toBe('home-9');
    expect(scene.humanPlayerId).toBe(scene.selectionSystem.getSelectedId());
  });

  it("own goal (home scores) does NOT claim control — away's kickoff leaves auto-selection free", () => {
    const scene = buildScene();
    const t = stepToPlaying(scene);
    injectStaleSelection(scene, 'home-7');

    scene.manager.handleGoal('home');
    expect(scene.manager.kickoffTeam).toBe('away');
    const t2 = stepToPlaying(scene, t);

    // No handoff: the selector drives control freely (it stays synced with
    // itself by definition, and no hold is active).
    expect(scene.humanPlayerId).toBe(scene.selectionSystem.getSelectedId());
    let t3 = t2;
    for (let i = 0; i < 5; i++) {
      t3 += 16;
      scene.update(t3, 16);
    }
    expect(scene.humanPlayerId).toBe(scene.selectionSystem.getSelectedId());
  });
});

describe('item 3 — opponent foul on the user team: control goes to the free-kick taker', () => {
  function awardHomeFreeKick(scene: any, t: number): number {
    // The human is settled on home-7; the FOULED carrier is the AI teammate
    // home-9 (st1) dribbling at (600,100); away-9 slides in from behind.
    injectStaleSelection(scene, 'home-7');
    (scene.homeTeam[7] as Player).setPosition(500, 100); // near the ball, not possessing
    (scene.homeTeam[9] as Player).setPosition(600, 100);
    (scene.homeTeam[9] as Player).body.setVelocity(150, 0); // moving +x (tackled from behind)
    (scene.awayTeam[9] as Player).setPosition(580, 100); // 20px behind the carrier
    scene.ball.sprite.setPosition(600, 100);
    scene.ball.body.setVelocity(0, 0);

    scene.update(t, 16);
    expect(scene.manager.state).toBe('FREE_KICK');
    expect(scene.manager.lastSetPiece.kickerTeam).toBe('home');
    return scene.manager.lastSetPiece.kickerIndex as number;
  }

  it('RED->GREEN: FREE_KICK for home -> the taker is controlled immediately and survives the resume', () => {
    const scene = buildScene();
    const t = stepToPlaying(scene);
    const kickerIndex = awardHomeFreeKick(scene, t + 16);
    const takerId = `home-${kickerIndex}`;
    expect(takerId).toBe('home-9'); // nearest home player to the spot = the fouled carrier

    // The SAME update() frame must not steal the taker back (the pre-fix
    // selection block ran with a stale canPlay computed before the award).
    expect(scene.humanPlayerId).toBe(takerId);
    expect(scene.selectionSystem.getSelectedId()).toBe(takerId);

    // The freeze keeps the taker; the user takes the kick (resume on kick).
    const taker = scene.homeTeam[kickerIndex] as Player;
    let t2 = t;
    for (let i = 0; i < 10; i++) {
      t2 += 16;
      scene.update(t2, 16);
      expect(scene.humanPlayerId).toBe(takerId);
    }
    taker.shootWithPower(0.5, new Vec2(1, 0) as unknown as Phaser.Math.Vector2);
    expect(scene.manager.state).toBe('PLAYING');

    // Held through the resume: control does not jump away on the kick edge.
    for (let i = 0; i < 10; i++) {
      t2 += 16;
      scene.update(t2, 16);
      expect(scene.humanPlayerId).toBe(takerId);
    }
    expect(scene.humanPlayerId).toBe(scene.selectionSystem.getSelectedId());
  });

  it('a foul committed BY the user team never hands control to anyone (away set piece)', () => {
    const scene = buildScene();
    const t = stepToPlaying(scene);
    injectStaleSelection(scene, 'home-7');

    // Away carrier fouled from behind by home-2: FREE_KICK for away.
    (scene.awayTeam[9] as Player).setPosition(600, 100);
    (scene.awayTeam[9] as Player).body.setVelocity(150, 0);
    (scene.homeTeam[2] as Player).setPosition(580, 100);
    scene.ball.sprite.setPosition(600, 100);
    scene.ball.body.setVelocity(0, 0);

    scene.update(t + 16, 16);
    expect(scene.manager.state).toBe('FREE_KICK');
    expect(scene.manager.lastSetPiece.kickerTeam).toBe('away');
    // No handoff is claimed on opponent set pieces: the selector stays in
    // sync with whatever it freely picks (never a forced taker).
    expect(scene.humanPlayerId).toBe(scene.selectionSystem.getSelectedId());
  });
});
