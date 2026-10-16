import Phaser from 'phaser';
import { BALANCE_CONFIG } from '../data/balance';

/**
 * Ball — independent ball simulation (AGENTS.md section 10).
 *
 * Ground plane (x/y) runs on Arcade velocity; height (z) is a virtual axis
 * integrated here with vertical velocity (vz) under config gravity. Landing
 * bounces with config restitution (< 1, no infinite energy) and snaps to
 * rest below config thresholds. z never stays below zero.
 *
 * Rolling resistance on the ground is config drag scaled by an optional
 * surface friction multiplier (default neutral from config) — the seam a
 * future WeatherSystem plugs into. No weather logic lives here.
 *
 * All tuning numbers come from BALANCE_CONFIG; this file holds no physics
 * literals (only unit conversion and formula constants).
 */
export class Ball {
  public scene: Phaser.Scene;
  public body: Phaser.Physics.Arcade.Body;
  public sprite: Phaser.GameObjects.Sprite;
  public shadowSprite: Phaser.GameObjects.Image;
  public z = 0;
  /** Vertical velocity in px/s (positive = rising). */
  public vz = 0;
  /**
   * Legacy lift target (deprecated): MatchScene pass-lift and older callers
   * write zTarget directly. update() converts a pending zTarget into vz on
   * the next step, then clears it, so those paths keep working.
   */
  public zTarget = 0;
  public readonly maxZ = BALANCE_CONFIG.PHYSICS.BALL_MAX_Z;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    const phys = BALANCE_CONFIG.PHYSICS;
    this.scene = scene;
    this.shadowSprite = scene.add.image(x, y + phys.BALL_SHADOW_Y_OFFSET_PX, 'ballShadow');
    this.sprite = scene.add.sprite(x, y, 'ball');
    const physics = scene.physics;
    physics.add.existing(this.sprite);
    this.body = this.sprite.body as Phaser.Physics.Arcade.Body;
    this.body.setBounce(phys.BALL_BOUNCE);
    this.body.setFriction(phys.BALL_FRICTION);
    // World bounds intentionally NOT colliding: boundary exits are handled by
    // MatchManager's restart rules (RULE-1/RULE-2), not by wall bounces.
  }

  /**
   * Deterministic integration step (Phaser-free math, Vitest-testable).
   * @param dtMs frame delta in milliseconds.
   * @param surfaceFrictionMultiplier rolling-resistance scale from the
   *   surface/weather seam; defaults to the neutral config value.
   */
  public update(
    dtMs: number,
    surfaceFrictionMultiplier: number = BALANCE_CONFIG.PHYSICS.SURFACE_NEUTRAL_FRICTION,
  ): void {
    const phys = BALANCE_CONFIG.PHYSICS;
    const dtSec = Math.max(dtMs, 0) / MS_PER_SECOND;

    // Legacy seam: a pending zTarget becomes vertical velocity able to peak
    // at that height (v = sqrt(2*g*h)), then clears. Keeps pass-lift writes
    // working without spring code.
    if (this.zTarget > 0) {
      const liftVz = Math.sqrt(
        FORMULA_TWO * phys.BALL_GRAVITY_Z_PX_S2 * Math.max(this.zTarget, 0),
      );
      this.vz = Math.max(this.vz, liftVz);
      this.zTarget = 0;
    }

    // Vertical ballistics: gravity pulls vz down; landing bounces or rests.
    if (this.z > 0 || this.vz !== 0) {
      this.vz -= phys.BALL_GRAVITY_Z_PX_S2 * dtSec;
      this.z += this.vz * dtSec;
      if (this.z <= 0) {
        this.z = 0;
        if (Math.abs(this.vz) < phys.BALL_REST_VZ_PX_S) {
          this.vz = 0;
        } else {
          this.vz = -this.vz * phys.BALL_RESTITUTION_Z;
          if (Math.abs(this.vz) < phys.BALL_REST_VZ_PX_S) {
            this.vz = 0;
          }
        }
      }
      if (this.z < phys.BALL_REST_Z_PX && this.vz === 0) {
        this.z = 0;
      }
    }

    // Rolling resistance on the ground only; airborne balls keep momentum.
    if (this.z === 0) {
      const vel = this.body.velocity;
      const speed = Math.hypot(vel.x, vel.y);
      if (speed > 0) {
        const factor = Math.max(
          0,
          1 - phys.BALL_GROUND_DRAG_PER_S * surfaceFrictionMultiplier * dtSec,
        );
        const nextSpeed = speed * factor;
        if (nextSpeed < phys.BALL_ROLL_STOP_PX_S) {
          this.body.setVelocity(0, 0);
        } else {
          this.body.setVelocity(vel.x * factor, vel.y * factor);
        }
      }
    }

    this.syncShadow();
  }

  public preUpdate(
    time: number,
    delta: number,
    surfaceFrictionMultiplier: number = BALANCE_CONFIG.PHYSICS.SURFACE_NEUTRAL_FRICTION,
  ): void {
    void time;
    this.update(delta, surfaceFrictionMultiplier);
  }

  private syncShadow(): void {
    const phys = BALANCE_CONFIG.PHYSICS;
    if (!this.shadowSprite) {
      return;
    }
    this.shadowSprite.x = this.sprite.x;
    this.shadowSprite.y = this.sprite.y + phys.BALL_SHADOW_Y_OFFSET_PX;
    const norm = Phaser.Math.Clamp(this.z / this.maxZ, 0, 1);
    const scale = 1 - norm * phys.BALL_SHADOW_SCALE_SHRINK;
    const alpha = phys.BALL_SHADOW_ALPHA_BASE - norm * phys.BALL_SHADOW_ALPHA_FADE;
    this.shadowSprite.setScale(scale);
    this.shadowSprite.setAlpha(Math.max(phys.BALL_SHADOW_ALPHA_MIN, alpha));
  }

  public applyKick(impulse: Phaser.Math.Vector2, power: number): void {
    const phys = BALANCE_CONFIG.PHYSICS;
    const effectivePower = Math.max(power, 0);
    if (effectivePower < phys.BALL_MIN_KICK_THRESHOLD) {
      return;
    }
    const velocity = impulse.clone().normalize().scale(effectivePower * phys.BALL_MAX_IMPULSE);
    this.body.setVelocity(velocity.x, velocity.y);
    // Vertical launch proportional to power; peak ≈ vz²/2g.
    this.vz = effectivePower * phys.BALL_KICK_VZ_MAX_PX_S;
    this.zTarget = 0;
  }

  public reset(): void {
    const phys = BALANCE_CONFIG.PHYSICS;
    this.body.setVelocity(0, 0);
    this.sprite.setPosition(phys.PITCH_WIDTH / HALF_DIVISOR, phys.PITCH_HEIGHT / HALF_DIVISOR);
    this.z = 0;
    this.vz = 0;
    this.zTarget = 0;
  }
}

/** Milliseconds per second (unit conversion, not tuning). */
const MS_PER_SECOND = 1000;
/** Kinematic factor in v = sqrt(2·g·h) (formula constant, not tuning). */
const FORMULA_TWO = 2;
/** Halving divisor for pitch-center reset (arithmetic, not tuning). */
const HALF_DIVISOR = 2;
