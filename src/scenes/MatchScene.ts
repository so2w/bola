import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { Ball } from '../entities/Ball';

/** Frame index inside the players sheet = position in manifest.spritesheets.players.frames. */
const HOME_RUN_FRAME = 1;

/**
 * MatchScene — Core gameplay wiring for Paso 2.
 * Renders pitch, instantiates Player and Ball entities, delegates preUpdate.
 */
export class MatchScene extends Phaser.Scene {
  private player!: Player;
  private ball!: Ball;

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

    // Wire shot event from Player to Ball
    this.player.onShot((power, facing) => {
      this.ball.applyKick(facing, power);
      if (power > 0.6) {
        const magnitude = Phaser.Math.Clamp(power * 0.02, 0.008, 0.02);
        this.cameras.main.shake(100, magnitude);
      }
    });

    // HUD proof-of-life text.
    this.add
      .text(480, 24, 'Gameplay OK', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffffff',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(10);
  }

  update(time: number, delta: number): void {
    // Delegate to entities
    this.player.preUpdate(time, delta);
    this.ball.preUpdate(time, delta);
  }
}
