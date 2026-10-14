import Phaser from 'phaser';
import { BALANCE_CONFIG } from '../data/balance';
import { resolveClipFrames, type ClubTeam } from './frameMap';

type AnimState = 'Idle' | 'Run' | 'Kick';
type ShotKind = 'KICK' | 'PASS';

/**
 * Controller contract: one controller per Player instance.
 * Player entity contains NO input code — controllers drive it via move/charge APIs.
 */
export interface IPlayerController {
  attach(scene: Phaser.Scene, player: Player): void;
  /** Called every frame by the scene; sets body velocity / triggers kicks via player APIs. */
  update(dtMs: number): void;
}

export interface PlayerOptions {
  /** Dressing side; drives manifest frame selection. Defaults to 'home'. */
  team?: ClubTeam;
  /** Manifest frame registry (name -> sheet index) built by the scene. */
  frames?: ReadonlyMap<string, number>;
}

const AWAY_TINT_FALLBACK = 0x0000ff;

export class Player {
  public scene: Phaser.Scene;
  public body: Phaser.Physics.Arcade.Body;
  public sprite: Phaser.GameObjects.Sprite;
  public animState: AnimState = 'Idle';
  public chargeTimer = 0;
  public maxSpeed = 220;
  public readonly team: ClubTeam;
  private readonly frames?: ReadonlyMap<string, number>;
  private readonly animKeys: { idle: string; run: string; kick: string };
  private maxCharge = BALANCE_CONFIG.PHYSICS.PLAYER_MAX_CHARGE_MS;
  private kickDuration = BALANCE_CONFIG.PHYSICS.PLAYER_KICK_DURATION_MS;
  private kickTimer = 0;
  private isCharging = false;
  private controller?: IPlayerController;
  private shotCallback?: (power: number, facing: Phaser.Math.Vector2, kind?: ShotKind) => void;

  constructor(scene: Phaser.Scene, x: number, y: number, options: PlayerOptions = {}) {
    this.scene = scene;
    this.team = options.team ?? 'home';
    this.frames = options.frames;
    this.animKeys = {
      idle: `player_idle_${this.team}`,
      run: `player_run_${this.team}`,
      kick: `player_kick_${this.team}`,
    };
    // Kit regression fix (playtest round 2): the sprite is born on the TEAM's
    // idle frame, not frame 0 — frame 0 is always home-idle (red), so any away
    // frame-0 fallback window (e.g. a missed updateAnimation) showed the wrong
    // kit even before animations ran.
    const resolved = resolveClipFrames(this.frames ?? new Map(), this.team);
    this.sprite = scene.add.sprite(x, y, 'players', resolved.idle[0]);
    const physics = scene.physics;
    physics.add.existing(this.sprite);
    this.body = this.sprite.body as Phaser.Physics.Arcade.Body;
    this.body.setCollideWorldBounds(true);
    this.body.setDrag(BALANCE_CONFIG.PHYSICS.PLAYER_DRAG);

    this.createAnimations(resolved);
  }

  /** Attaches exactly one controller. Replaces any previous one. */
  public attachController(controller: IPlayerController): void {
    this.controller = controller;
    controller.attach(this.scene, this);
  }

  public hasController(): boolean {
    return this.controller !== undefined;
  }

  /** Updates the attached controller (called every frame by the scene). */
  public updateController(dtMs: number): void {
    this.controller?.update(dtMs);
  }

  /**
   * PA-1: animations resolve frame indices through the manifest registry;
   * away clip missing -> home frames + team tint fallback (PA-1-S3).
   */
  private createAnimations(resolved = resolveClipFrames(this.frames ?? new Map(), this.team)): void {
    const defs: Array<[string, number[], number, number | undefined]> = [
      [this.animKeys.idle, resolved.idle, 1, undefined],
      [this.animKeys.run, resolved.run, 8, -1],
      [this.animKeys.kick, resolved.kick, 1, undefined],
    ];
    for (const [key, frames, frameRate, repeat] of defs) {
      if (!this.scene.anims.exists(key)) {
        this.scene.anims.create({
          key,
          frames: frames.map((frame) => ({ key: 'players', frame })),
          frameRate,
          ...(repeat !== undefined ? { repeat } : {}),
        });
      }
    }
    if (resolved.needsTint) {
      this.sprite.setTint(AWAY_TINT_FALLBACK);
    }
  }

  /** Runs charge progress + animation. Called every frame by the scene. */
  public preUpdate(time: number, delta: number): void {
    void time;
    this.updateCharge(delta);
    this.updateAnimation(delta);
  }

  /**
   * Sets body velocity toward the input vector, normalized to maxSpeed.
   * Shared by HumanInputController and AIController.
   */
  public move(vec: { x: number; y: number }): void {
    const lenSq = vec.x * vec.x + vec.y * vec.y;
    if (lenSq > 0) {
      const len = Math.sqrt(lenSq);
      this.body.setVelocity((vec.x / len) * this.maxSpeed, (vec.y / len) * this.maxSpeed);
    } else {
      this.body.setVelocity(0, 0);
    }
  }

  /** Begins charge accumulation (controller calls on shot-key down). */
  public startCharge(): void {
    this.isCharging = true;
    this.chargeTimer = 0;
  }

  /** Cancels an in-flight charge without firing (MC-2: shot gated by ball proximity). */
  public cancelCharge(): void {
    this.isCharging = false;
    this.chargeTimer = 0;
  }

  /** Public charging flag for the power meter HUD (PM-1). */
  public isChargingNow(): boolean {
    return this.isCharging;
  }

  /**
   * Releases the charge (controller calls on shot-key up): computes power and
   * facing, starts the kick animation and fires the shot callback.
   */
  public releaseCharge(): void {
    if (!this.isCharging) {
      return;
    }
    const power = Phaser.Math.Clamp(this.chargeTimer / this.maxCharge, 0, 1);
    const facing = this.getFacing();
    this.startKick();
    this.chargeTimer = 0;
    this.isCharging = false;
    this.shotCallback?.(power, facing, 'KICK');
  }

  /**
   * MC-1: contextual pass — kicks toward a teammate at pass power.
   */
  public passTo(target: { x: number; y: number }): void {
    const dx = target.x - this.sprite.x;
    const dy = target.y - this.sprite.y;
    const facing = new Phaser.Math.Vector2(dx, dy);
    if (facing.lengthSq() > 0) {
      facing.normalize();
    } else {
      facing.setTo(1, 0);
    }
    this.shootWithPower(BALANCE_CONFIG.INPUT.PASS_POWER_PCT, facing, 'PASS');
  }

  private updateCharge(delta: number): void {
    if (this.isCharging) {
      this.chargeTimer = Math.min(this.chargeTimer + delta, this.maxCharge);
    }
  }

  public updateAnimation(delta: number): void {
    // PA-2: kick window counts down on the preUpdate delta — never scene loop.
    if (this.kickTimer > 0) {
      this.kickTimer -= delta;
      if (this.kickTimer <= 0) {
        this.animState = this.body.velocity.length() > 0 ? 'Run' : 'Idle';
      }
    }

    if (this.animState === 'Kick') {
      if (!this.sprite.anims.isPlaying || this.sprite.anims.currentAnim?.key !== this.animKeys.kick) {
        this.sprite.anims.play(this.animKeys.kick, true);
      }
      return;
    }

    const moving = this.body.velocity.lengthSq() > 0;
    if (moving) {
      this.animState = 'Run';
      if (!this.sprite.anims.isPlaying || this.sprite.anims.currentAnim?.key !== this.animKeys.run) {
        this.sprite.anims.play(this.animKeys.run, true);
      }
    } else {
      this.animState = 'Idle';
      if (!this.sprite.anims.isPlaying || this.sprite.anims.currentAnim?.key !== this.animKeys.idle) {
        this.sprite.anims.play(this.animKeys.idle, true);
      }
    }
  }

  private startKick(): void {
    this.animState = 'Kick';
    this.kickTimer = this.kickDuration;
    this.sprite.anims.play(this.animKeys.kick, true);
  }

  private getFacing(): Phaser.Math.Vector2 {
    const vel = this.body.velocity;
    if (vel.lengthSq() > 0) {
      return vel.clone().normalize();
    }
    // Default right
    return new Phaser.Math.Vector2(1, 0);
  }

  public onShot(cb: (power: number, facing: Phaser.Math.Vector2, kind?: ShotKind) => void): void {
    this.shotCallback = cb;
  }

  public getPower(): number {
    return Phaser.Math.Clamp(this.chargeTimer / this.maxCharge, 0, 1);
  }

  public setPosition(x: number, y: number): void {
    this.sprite.setPosition(x, y);
  }

  public shootWithPower(power: number, facing: Phaser.Math.Vector2, kind: ShotKind = 'KICK'): void {
    if (this.kickTimer > 0) {
      return;
    }
    this.startKick();
    this.shotCallback?.(Phaser.Math.Clamp(power, 0, 1), facing.clone(), kind);
  }
}
