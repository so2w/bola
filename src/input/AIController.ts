import type Phaser from 'phaser';
import type { Player, IPlayerController } from '../entities/Player';
import type { AICommand } from '../ai/commands';
import { BALANCE_CONFIG } from '../data/balance';
import { wobbleOffsetDeg, type DribbleFeelCfg } from '../ai/dribbleFeel';

/** Locomotion tuning consumed from BALANCE_CONFIG.AI (playtest round 3). */
export interface LocomotionCfg extends DribbleFeelCfg {
  ARRIVAL_RADIUS_PX: number;
  ARRIVAL_MIN_SPEED_PCT: number;
  IDLE_WANDER_RADIUS_PX: number;
  IDLE_WANDER_SPEED: number;
}

let nextPhase = 0;
/** Golden angle spreads co-targeting players around the wander circle. */
const GOLDEN_ANGLE = 2.399963229728653;

/**
 * AI controller — consumes coordinator commands and applies smoothed
 * locomotion toward the command target.
 *
 * Playtest round 3 ("straight line robot" feel): pure seek produced players
 * sprinting full-speed and snapping to a dead stop on the anchor. Now:
 * - inside ARRIVAL_RADIUS_PX speed decays linearly toward
 *   ARRIVAL_MIN_SPEED_PCT (arrival damping; also kills the overrun-reverse
 *   jitter the old snap fix was patching);
 * - once at the target the player keeps drifting on a small deterministic
 *   wander orbit (per-instance phase) instead of freezing;
 * - action commands that need the body to ARRIVE (DIVE/PRESS/TRACK/CLAIM)
 *   also damp on arrival, but only MOVE/IDLE wander.
 */
export class AIController implements IPlayerController {
  private player?: Player;
  private command?: AICommand;
  private readonly onAction?: (cmd: AICommand) => void;
  private readonly cfg: LocomotionCfg;
  private readonly wanderPhase: number;
  private elapsedMs = 0;

  constructor(
    onAction?: (cmd: AICommand) => void,
    cfg: LocomotionCfg = BALANCE_CONFIG.AI,
    wanderPhase?: number,
  ) {
    this.onAction = onAction;
    this.cfg = cfg;
    // Deterministic default: creation order assigns a unique orbit phase.
    this.wanderPhase = wanderPhase ?? nextPhase++ * GOLDEN_ANGLE;
  }

  public setCommand(cmd: AICommand | undefined): void {
    this.command = cmd;
  }

  public attach(_scene: Phaser.Scene, player: Player): void {
    this.player = player;
  }

  /**
   * Pure movement math for a command (Phaser-free, unit-testable). Returns
   * the velocity to apply this frame, or null when there is no command.
   * Advances the internal wander clock by dtMs (deterministic given the
   * frame deltas).
   */
  public computeMovement(
    pos: { x: number; y: number },
    cmd: AICommand,
    dtMs: number,
  ): { vx: number; vy: number } {
    this.elapsedMs += dtMs;

    let tx = cmd.targetX;
    let ty = cmd.targetY;
    const dist = Math.hypot(tx - pos.x, ty - pos.y);

    // At-target idle wander: orbit a small offset around the anchor so the
    // player never freezes nor walks a perfect straight line.
    if (
      dist <= this.cfg.ARRIVAL_RADIUS_PX * 0.5 &&
      (cmd.action === 'MOVE' || cmd.action === 'IDLE')
    ) {
      const angle = this.elapsedMs * this.cfg.IDLE_WANDER_SPEED + this.wanderPhase;
      tx += Math.cos(angle) * this.cfg.IDLE_WANDER_RADIUS_PX;
      ty += Math.sin(angle) * this.cfg.IDLE_WANDER_RADIUS_PX;
    }

    let dx = tx - pos.x;
    let dy = ty - pos.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) {
      return { vx: 0, vy: 0 };
    }

    // Carrier feel (fase 4): heading wobble bends the dribble path. It only
    // applies to dribble commands beyond the anchor tolerance, so it never
    // fights the idle wander (wander owns the at-target zone above).
    let speedFactor = 1;
    if (cmd.dribble && dist > this.cfg.ARRIVAL_RADIUS_PX * 0.5) {
      const wob = (wobbleOffsetDeg(this.elapsedMs, this.wanderPhase, this.cfg) * Math.PI) / 180;
      const cos = Math.cos(wob);
      const sin = Math.sin(wob);
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;
      dx = rx;
      dy = ry;
      speedFactor = cmd.speedFactor ?? 1;
    }

    // Arrival damping: full speed beyond ARRIVAL_RADIUS_PX, linear decay to
    // ARRIVAL_MIN_SPEED_PCT inside it. Dribble pressure/boost composes on top.
    const maxSpeed = this.player?.maxSpeed ?? BALANCE_CONFIG.PHYSICS.PLAYER_MAX_SPEED;
    const scale = Math.min(1, Math.max(len / this.cfg.ARRIVAL_RADIUS_PX, this.cfg.ARRIVAL_MIN_SPEED_PCT));
    const speed = maxSpeed * scale * speedFactor;
    const wlen = Math.hypot(dx, dy);
    return { vx: (dx / wlen) * speed, vy: (dy / wlen) * speed };
  }

  public update(dtMs: number): void {
    const player = this.player;
    if (!player || !this.command) {
      return;
    }

    const v = this.computeMovement(
      { x: player.sprite.x, y: player.sprite.y },
      this.command,
      dtMs,
    );
    player.body.setVelocity(v.vx, v.vy);

    if (this.command.action !== 'MOVE' && this.command.action !== 'IDLE' && this.onAction) {
      this.onAction(this.command);
    }
  }
}
