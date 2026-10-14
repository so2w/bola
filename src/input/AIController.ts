import type Phaser from 'phaser';
import type { Player, IPlayerController } from '../entities/Player';
import type { AICommand } from '../ai/commands';

/**
 * AI controller stub — consumes coordinator commands and applies locomotion
 * toward the command target. Action semantics (PASS/SHOOT/DIVE...) are
 * completed in slice 3 with FootballAI/TeamCoordinator wiring.
 */
export class AIController implements IPlayerController {
  private player?: Player;
  private command?: AICommand;
  private readonly onAction?: (cmd: AICommand) => void;

  constructor(onAction?: (cmd: AICommand) => void) {
    this.onAction = onAction;
  }

  public setCommand(cmd: AICommand | undefined): void {
    this.command = cmd;
  }

  public attach(_scene: Phaser.Scene, player: Player): void {
    this.player = player;
  }

  public update(dtMs: number): void {
    const player = this.player;
    if (!player || !this.command) {
      return;
    }

    const dx = this.command.targetX - player.sprite.x;
    const dy = this.command.targetY - player.sprite.y;
    const dist = Math.hypot(dx, dy);

    // Arrival damping (playtest round 2 anti-jitter): if the frame step would
    // overshoot the target, snap to it and stop. Without this, Player.move
    // always applies FULL speed, so a player within one step of its target
    // overruns and reverses direction every frame ("de un lado al otro").
    const step = player.maxSpeed * (dtMs / 1000);
    if (dist <= step) {
      player.setPosition(this.command.targetX, this.command.targetY);
      player.move({ x: 0, y: 0 });
    } else {
      player.move({ x: dx, y: dy });
    }

    if (this.command.action !== 'MOVE' && this.command.action !== 'IDLE' && this.onAction) {
      this.onAction(this.command);
    }
  }
}
