import Phaser from 'phaser';
import type { Player, IPlayerController } from '../entities/Player';
import { BALANCE_CONFIG } from '../data/balance';

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
  /** +1 when the human team attacks rightward. */
  attackDir?: 1 | -1;
}

/**
 * Human keyboard controller — WASD/arrows movement, contextual ACTION (J) and
 * charge SHOT (K, SPACE alias). Bindings are centralized here, never in Player.
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
      const actionKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.J);
      const shotKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.K);
      const shotAlias = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

      actionKey.on('down', () => {
        this.actionDownAt = this.nowMs();
        this.actionConsumed = false;
      });
      actionKey.on('up', () => {
        this.resolveBufferedAction();
      });

      const onShotDown = () => {
        this.player?.startCharge();
      };
      const onShotUp = () => {
        this.resolveShot();
      };
      shotKey.on('down', onShotDown);
      shotKey.on('up', onShotUp);
      shotAlias.on('down', onShotDown);
      shotAlias.on('up', onShotUp);

      this.shotListenersRegistered = true;
    }
  }

  private nowMs(): number {
    return this.scene?.time.now ?? 0;
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
      return;
    }
    const target = this.pickPassTarget();
    // MC-1-S2: empty cone -> no-op (EMPTY_CONE_FALLBACK === 'none').
    if (target) {
      player.passTo(target);
    }
  }

  /**
   * MC-1: forward-most teammate inside the forward pass cone and max range
   * around the attack direction. Deterministic (no RNG); first wins ties.
   */
  public pickPassTarget(): Point | null {
    const player = this.player;
    const ctx = this.context;
    if (!player || !ctx) {
      return null;
    }
    const cfg = BALANCE_CONFIG.INPUT;
    const attackDir = ctx.attackDir ?? 1;
    const halfAngleRad = ((cfg.PASS_CONE_DEG / 2) * Math.PI) / 180;
    const minDot = Math.cos(halfAngleRad);

    let best: Point | null = null;
    let bestForward = -Infinity;
    for (const mate of ctx.getTeammates()) {
      const dx = mate.x - player.sprite.x;
      const dy = mate.y - player.sprite.y;
      const forward = dx * attackDir;
      const dist = Math.hypot(dx, dy);
      if (forward <= 0 || dist > cfg.PASS_MAX_RANGE_PX || dist === 0) {
        continue;
      }
      const dot = (dx * attackDir) / dist; // cone axis is horizontal
      if (dot < minDot) {
        continue;
      }
      if (forward > bestForward) {
        bestForward = forward;
        best = mate;
      }
    }
    return best;
  }

  /** MC-2: shot release only fires when the ball is within pickup radius. */
  private resolveShot(): void {
    const player = this.player;
    if (!player || !player.isChargingNow()) {
      return;
    }
    // Back-compat: without an injected context, charge releases unconditionally.
    if (!this.context) {
      player.releaseCharge();
      return;
    }
    if (this.ballDistance() <= BALANCE_CONFIG.INPUT.PASS_PICKUP_RADIUS_PX) {
      player.releaseCharge();
    } else {
      player.cancelCharge();
    }
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
      player.move(inputVec);
    } else {
      player.move(new Phaser.Math.Vector2(0, 0));
    }
  }
}
