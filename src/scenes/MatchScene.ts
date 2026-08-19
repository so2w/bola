import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { Ball } from '../entities/Ball';
import { SimpleAI } from '../systems/SimpleAI';
import { MatchManager } from '../systems/MatchManager';

/** Frame index inside the players sheet = position in manifest.spritesheets.players.frames. */
const HOME_RUN_FRAME = 1;

/**
 * MatchScene — Core gameplay wiring for Paso 2.
 * Renders pitch, instantiates Player and Ball entities, delegates preUpdate.
 */
export class MatchScene extends Phaser.Scene {
  private player!: Player;
  private ball!: Ball;
  private rival?: Player;
  private ai?: SimpleAI;
  private manager?: MatchManager;
  private clockText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;

  constructor() {
    super('MatchScene');
  }

  create(): void {
    // Static pitch backdrop.
    this.add.image(480, 270, 'pitch');

    // World bounds for Arcade physics
    this.physics.world.setBounds(0, 0, 960, 540);

    // Instantiate entities
    this.ball = new Ball(this, 480, 270);
    this.player = new Player(this, 560, 270);

    // Rival instantiation
    this.rival = new Player(this, 400, 270);
    this.rival.sprite.setTint(0x0000ff);
    this.ai = new SimpleAI();
    this.manager = new MatchManager();

    // Bind manager context for goal detection and reset
    this.manager.bind(this, this.ball, this.player, this.rival);

    // Invisible Arcade static goal zones
    const leftGoal = this.add.zone(20, 270, 40, 140);
    const rightGoal = this.add.zone(940, 270, 40, 140);
    this.physics.world.enable([leftGoal, rightGoal]);
    (leftGoal.body as Phaser.Physics.Arcade.Body).setImmovable(true);
    (rightGoal.body as Phaser.Physics.Arcade.Body).setImmovable(true);
    leftGoal.setVisible(false);
    rightGoal.setVisible(false);

    // Wire shot event from Player to Ball
    this.player.onShot((power, facing) => {
      this.ball.applyKick(facing, power);
      if (power > 0.6) {
        const magnitude = Phaser.Math.Clamp(power * 0.02, 0.008, 0.02);
        this.cameras.main.shake(100, magnitude);
      }
    });

    // Wire shot event from Rival to Ball
    if (this.rival) {
      this.rival.onShot((power, facing) => {
        this.ball.applyKick(facing, power);
        if (power > 0.6) {
          const magnitude = Phaser.Math.Clamp(power * 0.02, 0.008, 0.02);
          this.cameras.main.shake(100, magnitude);
        }
      });
    }

    // HUD
    this.clockText = this.add.text(20, 20, '03:00', {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: '#ffffff',
    }).setDepth(10);

    this.scoreText = this.add.text(480, 20, '0 - 0', {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: '#ffffff',
    }).setOrigin(0.5, 0).setDepth(10);
  }

  update(time: number, delta: number): void {
    // Manager update first
    if (this.manager) {
      this.manager.update(delta);
    }

    // AI update
    if (this.ai && this.rival && this.ball && this.manager) {
      this.ai.update(delta, this.rival, this.ball, this.manager);
    }

    // Gate player input and zero velocities when not PLAYING
    const isPlaying = this.manager?.state === 'PLAYING';
    if (!isPlaying) {
      this.player.body.setVelocity(0, 0);
      this.player.body.setAcceleration(0, 0);
    }

    // Entities preUpdate — only process player input when playing
    if (isPlaying) {
      this.player.preUpdate(time, delta);
    } else {
      // Still update animation based on velocity (which is zero)
      this.player['updateAnimation']?.();
    }
    this.ball.preUpdate(time, delta);

    // HUD update
    if (this.manager && this.clockText && this.scoreText) {
      const seconds = Math.max(0, Math.ceil(this.manager.getTime()));
      const minutes = Math.floor(seconds / 60);
      const secs = seconds % 60;
      const mmss = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      this.clockText.setText(mmss);
      this.scoreText.setText(`${this.manager.score.home} - ${this.manager.score.away}`);
    }
  }
}
