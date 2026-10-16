import Phaser from 'phaser';
import type { Player, IPlayerController } from '../entities/Player';
import { BALANCE_CONFIG } from '../data/balance';
import { choosePassTarget } from './passTarget';
import { chooseAimedPassTarget } from './passAim';

/** Point-ish positions consumed by the contextual action logic. */
export interface Point {
  x: number;
  y: number;
}

/**
 * MC-1/MC-2 injection seam: the scene provides ball position and teammate
 * positions so the controller never reaches into Phaser or the match graph.
 */
export interface PassContext {
  getBallPos(): Point | null;
  getTeammates(): Point[];
  /** Opponent positions for the directional pass openness score (optional). */
  getOpponents?(): Point[];
  /** +1 when the human team attacks rightward. */
  attackDir?: 1 | -1;
}

export { choosePassTarget } from './passTarget';

/**
 * Human keyboard controller — WASD/arrows movement, contextual ACTION (A/J)
 * and charge SHOT (S/K, SPACE alias) per AGENTS.md section 8. A doubles as
 * move-left + action and S doubles as move-down + shoot (few-buttons console
 * feel); a tap that ends inside INPUT.BUFFER_MS resolves the contextual
 * action. Bindings are centralized here, never in Player.
 */
export class HumanInputController implements IPlayerController {
  private player?: Player;
  private scene?: Phaser.Scene;
  private context?: PassContext;
  private keys?: Phaser.Types.Input.Keyboard.CursorKeys & {
    w?: Phaser.Input.Keyboard.Key;
    a?: Phaser.Input.Keyboard.Key;
    s?: Phaser.Input.Keyboard.Key;
    d?: Phaser.Input.Keyboard.Key;
  };
  private shotListenersRegistered = false;
  /** MC-1 input buffer: action press timestamp, consumed once per press. */
  private actionDownAt: number | null = null;
  private actionConsumed = false;
  /**
   * Shot input buffer (game-feel): shot-key down timestamp plus whether the
   * ball was inside the pickup radius at press time. A quick tap within
   * INPUT.BUFFER_MS fires when the ball was in radius at EITHER press or
   * release, tolerating a few frames of timing/position jitter. Longer holds
   * (charged shots) keep the strict release-time proximity gate.
   */
  private shotDownAt: number | null = null;
  private shotDownInRadius = false;
  /**
   * Playtest final (directional passing): the movement direction held at the
   * last processed frame (null when neutral) plus the snapshot taken at
   * action-press time — quick buffered taps aim with the direction held when
   * the button went down even if the keys release first.
   */
  private lastAim: Point | null = null;
  private aimAtPress: Point | null = null;

  /** MatchScene wires ball/teammate providers once in create. */
  public setContext(context: PassContext): void {
    this.context = context;
  }

  public attach(scene: Phaser.Scene, player: Player): void {
    this.player = player;
    this.scene = scene;
    if (!scene.input || !scene.input.keyboard) {
      throw new Error('Keyboard plugin is not enabled or available in scene');
    }
    const keyboard = scene.input.keyboard;
    this.keys = keyboard.createCursorKeys();
    // WASD fallback
    this.keys.w = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keys.a = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keys.s = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keys.d = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);

    // ACTION/SHOT listeners registered once; re-attach only rebinds the player.
    if (!this.shotListenersRegistered) {
      const moveKeys = this.keys;
      const actionKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.J);
      // A is move-left AND the action alias (AGENTS.md section 8: A/J act).
      // Reuses the movement Key object, so no extra registration is needed.
      const actionAlias = moveKeys.a;
      const shotKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.K);
      // S is move-down AND the shoot alias (AGENTS.md section 8: S/K shoot).
      const shotAliasS = moveKeys.s;
      const shotAlias = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

      const onActionDown = () => {
        this.actionDownAt = this.nowMs();
        this.actionConsumed = false;
        this.aimAtPress = this.lastAim ? { ...this.lastAim } : null;
      };
      const onActionUp = () => {
        this.resolveBufferedAction();
      };
      actionKey.on('down', onActionDown);
      actionKey.on('up', onActionUp);
      actionAlias?.on('down', onActionDown);
      actionAlias?.on('up', onActionUp);

      const onShotDown = () => {
        this.shotDownAt = this.nowMs();
        this.shotDownInRadius =
          this.ballDistance() <= BALANCE_CONFIG.INPUT.PASS_PICKUP_RADIUS_PX;
        this.player?.startCharge();
      };
      const onShotUp = () => {
        this.resolveShot();
      };
      shotKey.on('down', onShotDown);
      shotKey.on('up', onShotUp);
      shotAliasS?.on('down', onShotDown);
      shotAliasS?.on('up', onShotUp);
      shotAlias.on('down', onShotDown);
      shotAlias.on('up', onShotUp);

      this.shotListenersRegistered = true;
    }
  }

  private nowMs(): number {
    return (this.scene as { time?: { now?: number } } | undefined)?.time?.now ?? 0;
  }

  /** Distance from the controlled player to the ball, or Infinity if unknown. */
  private ballDistance(): number {
    const player = this.player;
    const ball = this.context?.getBallPos();
    if (!player || !ball) {
      return Infinity;
    }
    return Math.hypot(ball.x - player.sprite.x, ball.y - player.sprite.y);
  }

  /**
   * MC-1-S3: buffered action fires exactly once when release lands inside the
   * inclusive INPUT_BUFFER_MS window.
   */
  private resolveBufferedAction(): void {
    if (this.actionDownAt === null || this.actionConsumed) {
      return;
    }
    const elapsed = this.nowMs() - this.actionDownAt;
    this.actionDownAt = null;
    if (elapsed > BALANCE_CONFIG.INPUT.BUFFER_MS) {
      return;
    }
    this.actionConsumed = true;

    const cfg = BALANCE_CONFIG.INPUT;
    const player = this.player;
    if (!player) {
      return;
    }
    if (this.ballDistance() > cfg.PASS_PICKUP_RADIUS_PX) {
      // AGENTS.md section 8: without the ball the action button is the
      // pressure/tackle attempt — Batch B plays the slide-tackle clip. Purely
      // cosmetic here: the steal itself resolves through the possession and
      // capture systems, the button adds no hidden mechanics.
      player.startTackle();
      return;
    }
    const target = this.pickAimedPassTarget() ?? this.pickPassTarget();
    if (target) {
      player.passTo(target);
    }
  }

  /**
   * Playtest final: directional pass — the best receiver inside the aim cone
   * around the held direction (press-time snapshot for buffered taps),
   * weighted by distance + openness. Returns null for neutral aim or an empty
   * cone so the caller falls back to the forward-cone auto-choice.
   */
  public pickAimedPassTarget(): Point | null {
    const player = this.player;
    const ctx = this.context;
    if (!player || !ctx) {
      return null;
    }
    const aim = this.lastAim ?? this.aimAtPress;
    if (!aim) {
      return null;
    }
    return chooseAimedPassTarget(
      { x: player.sprite.x, y: player.sprite.y },
      aim,
      ctx.getTeammates(),
      ctx.getOpponents?.() ?? [],
    );
  }

  /**
   * MC-1: forward-most teammate inside the forward pass cone and max range;
   * empty cone falls back per EMPTY_CONE_FALLBACK (default 'forward').
   */
  public pickPassTarget(): Point | null {
    const player = this.player;
    const ctx = this.context;
    if (!player || !ctx) {
      return null;
    }
    return choosePassTarget(
      { x: player.sprite.x, y: player.sprite.y },
      ctx.getTeammates(),
      ctx.attackDir ?? 1,
      BALANCE_CONFIG.INPUT,
    );
  }

  /**
   * MC-2: shot release only fires when the ball is within pickup radius,
   * with a small input buffer on the release path: quick taps (press to
   * release within INPUT.BUFFER_MS) also fire when the ball was in radius
   * at press time, so a few frames of jitter never eat the player's shot.
   */
  private resolveShot(): void {
    const player = this.player;
    if (!player || !player.isChargingNow()) {
      this.shotDownAt = null;
      return;
    }
    // Back-compat: without an injected context, charge releases unconditionally.
    if (!this.context) {
      this.shotDownAt = null;
      player.releaseCharge();
      return;
    }
    const inRadiusNow = this.ballDistance() <= BALANCE_CONFIG.INPUT.PASS_PICKUP_RADIUS_PX;
    const elapsed = this.shotDownAt === null ? Infinity : this.nowMs() - this.shotDownAt;
    this.shotDownAt = null;
    const bufferedTap =
      elapsed <= BALANCE_CONFIG.INPUT.BUFFER_MS && (inRadiusNow || this.shotDownInRadius);
    if (inRadiusNow || bufferedTap) {
      player.releaseCharge();
    } else {
      player.cancelCharge();
    }
    this.shotDownInRadius = false;
  }

  public update(_dtMs: number): void {
    const player = this.player;
    const keys = this.keys;
    if (!player || !keys) {
      return;
    }

    const left = keys.left?.isDown || keys.a?.isDown;
    const right = keys.right?.isDown || keys.d?.isDown;
    const up = keys.up?.isDown || keys.w?.isDown;
    const down = keys.down?.isDown || keys.s?.isDown;

    const inputVec = new Phaser.Math.Vector2(
      (right ? 1 : 0) - (left ? 1 : 0),
      (down ? 1 : 0) - (up ? 1 : 0),
    );

    if (inputVec.lengthSq() > 0) {
      inputVec.normalize();
      this.lastAim = { x: inputVec.x, y: inputVec.y };
      player.move(inputVec);
    } else {
      this.lastAim = null;
      player.move(new Phaser.Math.Vector2(0, 0));
    }
  }
}
