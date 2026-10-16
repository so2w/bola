import Phaser from 'phaser';
import { BALANCE_CONFIG } from '../data/balance';
import { resolveClipFrames, type ClubTeam } from './frameMap';
import type { GkOverrideClip } from './gkAnim';

type AnimState =
  | 'Idle'
  | 'Run'
  | 'Kick'
  | 'Tackle'
  | 'Celebrate'
  | 'Dive'
  | 'Claim'
  | 'Distribute';
/** Lower-case clip keys (frameMap names) the anim keys are built from. */
type ClipKey = 'idle' | 'run' | 'kick' | 'tackle' | 'celebrate' | 'dive' | 'claim' | 'distribute';
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
  public maxSpeed = BALANCE_CONFIG.PHYSICS.PLAYER_MAX_SPEED;
  public readonly team: ClubTeam;
  private readonly frames?: ReadonlyMap<string, number>;
  private readonly animKeys: Record<ClipKey, string>;
  private maxCharge = BALANCE_CONFIG.PHYSICS.PLAYER_MAX_CHARGE_MS;
  private kickDuration = BALANCE_CONFIG.PHYSICS.PLAYER_KICK_DURATION_MS;
  /**
   * Phase 4 Batch B: the bounded override window (kick and the new action
   * clips). Counts down on updateAnimation deltas; expiry always returns the
   * state machine to Idle/Run — no clip can wedge.
   */
  private overrideTimer = 0;
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
      tackle: `player_tackle_${this.team}`,
      celebrate: `player_celebrate_${this.team}`,
      dive: `player_dive_${this.team}`,
      claim: `player_claim_${this.team}`,
      distribute: `player_distribute_${this.team}`,
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
    const defs: Array<[string, number[], number, number | undefined, boolean | undefined]> = [
      [this.animKeys.idle, resolved.idle, 1, undefined, undefined],
      [this.animKeys.run, resolved.run, 8, -1, undefined],
      [this.animKeys.kick, resolved.kick, 1, undefined, undefined],
      [this.animKeys.tackle, resolved.tackle, 1, undefined, undefined],
      // Celebration: arms-up <-> idle yoyo pair (bounce), looped while the
      // bounded window runs; the expiry always returns to idle/run.
      [
        this.animKeys.celebrate,
        resolved.celebrate,
        BALANCE_CONFIG.ANIM.CELEBRATION_FRAME_RATE,
        -1,
        true,
      ],
      [this.animKeys.dive, resolved.dive, 1, undefined, undefined],
      [this.animKeys.claim, resolved.claim, 1, undefined, undefined],
      [this.animKeys.distribute, resolved.distribute, 1, undefined, undefined],
    ];
    for (const [key, frames, frameRate, repeat, yoyo] of defs) {
      if (!this.scene.anims.exists(key)) {
        this.scene.anims.create({
          key,
          frames: frames.map((frame) => ({ key: 'players', frame })),
          frameRate,
          ...(repeat !== undefined ? { repeat } : {}),
          ...(yoyo !== undefined ? { yoyo } : {}),
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

  /** Last pass destination (MatchScene uses it to hint the receiver). */
  public lastPassTarget: { x: number; y: number } | null = null;

  /**
   * Phase 4 Batch A: pass power lives on the entity so the surface/session
   * tuning path (MatchScene.applySpeedAndPassTuning) can adjust it without
   * touching BALANCE_CONFIG. Config value is the default.
   */
  public passPowerPct = BALANCE_CONFIG.INPUT.PASS_POWER_PCT;

  /**
   * MC-1: contextual pass — kicks toward a teammate at pass power.
   */
  public passTo(target: { x: number; y: number }): void {
    this.lastPassTarget = { x: target.x, y: target.y };
    const dx = target.x - this.sprite.x;
    const dy = target.y - this.sprite.y;
    const facing = new Phaser.Math.Vector2(dx, dy);
    if (facing.lengthSq() > 0) {
      facing.normalize();
    } else {
      facing.setTo(1, 0);
    }
    this.shootWithPower(this.passPowerPct, facing, 'PASS');
  }

  private updateCharge(delta: number): void {
    if (this.isCharging) {
      this.chargeTimer = Math.min(this.chargeTimer + delta, this.maxCharge);
    }
  }

  public updateAnimation(delta: number): void {
    // PA-2 + Batch B: the override window counts down on the preUpdate delta —
    // never the scene loop. Every action clip (kick, tackle, celebration, GK
    // clips) is bounded here and always falls back to Idle/Run on expiry.
    if (this.overrideTimer > 0) {
      this.overrideTimer -= delta;
      if (this.overrideTimer <= 0) {
        this.overrideTimer = 0;
        this.animState = this.locomotionState();
      }
    }

    if (this.animState !== 'Idle' && this.animState !== 'Run') {
      const key = this.animKeys[OVERRIDE_STATE_CLIP[this.animState]];
      if (!this.sprite.anims.isPlaying || this.sprite.anims.currentAnim?.key !== key) {
        this.sprite.anims.play(key, true);
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

  private startOverride(state: Exclude<AnimState, 'Idle' | 'Run'>, durationMs: number): void {
    this.animState = state;
    this.overrideTimer = durationMs;
    this.sprite.anims.play(this.animKeys[OVERRIDE_STATE_CLIP[state]], true);
  }

  /** Idle/Run by current body velocity (override fallback state). */
  private locomotionState(): AnimState {
    return this.body.velocity.length() > 0 ? 'Run' : 'Idle';
  }

  /**
   * Phase 4 Batch B: slide tackle clip on the pressure/tackle action. No-op
   * while another action clip is in flight (the window never restarts).
   */
  public startTackle(): void {
    if (this.overrideTimer > 0) {
      return;
    }
    this.startOverride('Tackle', BALANCE_CONFIG.ANIM.TACKLE_DURATION_MS);
  }

  /**
   * Phase 4 Batch B: short arms-up celebration bounce (bounded window; the
   * kickoff hygiene resets it early through resetAnimation()).
   */
  public startCelebration(): void {
    this.startOverride('Celebrate', BALANCE_CONFIG.ANIM.CELEBRATION_DURATION_MS);
  }

  /**
   * Phase 4 Batch B: GK clip picked by the keeper FSM. MatchScene re-arms
   * every frame while the FSM holds the state, so the window only starts
   * expiring once the state moves on — and it ALWAYS expires (no wedge).
   */
  public applyGkClip(clip: GkOverrideClip): void {
    const durationMs =
      clip === 'dive'
        ? BALANCE_CONFIG.GK.DIVE_DURATION_MS
        : clip === 'claim'
          ? BALANCE_CONFIG.ANIM.GK_CLAIM_DURATION_MS
          : BALANCE_CONFIG.ANIM.GK_DISTRIBUTE_DURATION_MS;
    this.startOverride(clip === 'dive' ? 'Dive' : clip === 'claim' ? 'Claim' : 'Distribute', durationMs);
  }

  /** Clears any in-flight override clip immediately (kickoff hygiene). */
  public resetAnimation(): void {
    this.overrideTimer = 0;
    this.animState = this.locomotionState();
  }

  private startKick(): void {
    this.startOverride('Kick', this.kickDuration);
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
    // Kick spam guard: a new kick may not fire while a kick/tackle clip is in
    // its window. GK clips (dive/claim/distribute) never block the keeper's
    // own distribute/kick path (claim -> distribute must release the ball).
    if (
      (this.animState === 'Kick' || this.animState === 'Tackle') &&
      this.overrideTimer > 0
    ) {
      return;
    }
    this.startKick();
    this.shotCallback?.(Phaser.Math.Clamp(power, 0, 1), facing.clone(), kind);
  }
}

/** Override states -> the clip key their animation is built from. */
const OVERRIDE_STATE_CLIP: Record<Exclude<AnimState, 'Idle' | 'Run'>, ClipKey> = {
  Kick: 'kick',
  Tackle: 'tackle',
  Celebrate: 'celebrate',
  Dive: 'dive',
  Claim: 'claim',
  Distribute: 'distribute',
};
