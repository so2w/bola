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
  private leftGoal!: Phaser.GameObjects.Zone;
  private rightGoal!: Phaser.GameObjects.Zone;
  private gameOverGroup!: Phaser.GameObjects.Container;
  private resultOverlayGroup!: Phaser.GameObjects.Container;
  private cancelButton?: Phaser.GameObjects.Text;

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

    // Scoring orientation: left zone = away scores, right zone = home scores
    // Invisible Arcade static goal zones
    this.leftGoal = this.add.zone(20, 270, 40, 140);
    this.rightGoal = this.add.zone(940, 270, 40, 140);
    this.physics.world.enable([this.leftGoal, this.rightGoal]);
    (this.leftGoal.body as Phaser.Physics.Arcade.Body).setImmovable(true);
    (this.rightGoal.body as Phaser.Physics.Arcade.Body).setImmovable(true);
    this.leftGoal.setVisible(false);
    this.rightGoal.setVisible(false);

    // Wire Arcade overlap for goal detection
    this.physics.add.overlap(this.ball.sprite, this.leftGoal, () => {
      if (this.manager?.state === 'PLAYING') {
        this.manager.handleGoal('away');
      }
    }, undefined, this);

    this.physics.add.overlap(this.ball.sprite, this.rightGoal, () => {
      if (this.manager?.state === 'PLAYING') {
        this.manager.handleGoal('home');
      }
    }, undefined, this);

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

    // Cancel button to show result overlay
    this.cancelButton = this.add.text(900, 20, 'Cancel', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#ffffff',
      backgroundColor: '#000000',
      padding: { left: 8, right: 8, top: 4, bottom: 4 },
    }).setOrigin(1, 0).setDepth(10).setInteractive();
    this.cancelButton.on('pointerdown', () => {
      if (this.resultOverlayGroup) {
        this.resultOverlayGroup.setVisible(!this.resultOverlayGroup.visible);
      }
    });

    // Game Over group
    this.gameOverGroup = this.add.container(480, 270).setDepth(30);
    const goBg = this.add.rectangle(0, 0, 600, 240, 0x000000, 0.7).setOrigin(0.5);
    const goTitle = this.add.text(0, -60, 'GAME OVER', {
      fontFamily: 'monospace',
      fontSize: '48px',
      color: '#ffffff',
    }).setOrigin(0.5);
    const goScore = this.add.text(0, 0, '0 - 0', {
      fontFamily: 'monospace',
      fontSize: '36px',
      color: '#ffffff',
    }).setOrigin(0.5);
    const goRestart = this.add.text(0, 60, 'Restart (R)', {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: '#ffff00',
      backgroundColor: '#000000',
      padding: { left: 12, right: 12, top: 6, bottom: 6 },
    }).setOrigin(0.5).setInteractive();
    goRestart.on('pointerdown', () => {
      this.manager?.restart();
      this.gameOverGroup.setVisible(false);
    });
    this.gameOverGroup.add([goBg, goTitle, goScore, goRestart]);
    this.gameOverGroup.setVisible(false);
    // Store references for updates
    (this.gameOverGroup as any).scoreText = goScore;

    // Result overlay group
    this.resultOverlayGroup = this.add.container(480, 270).setDepth(25);
    const roBg = this.add.rectangle(0, 0, 400, 200, 0x000000, 0.8).setOrigin(0.5);
    const roTitle = this.add.text(0, -60, 'Resultado', {
      fontFamily: 'monospace',
      fontSize: '32px',
      color: '#ffffff',
    }).setOrigin(0.5);
    const roScore = this.add.text(0, 0, '0 - 0', {
      fontFamily: 'monospace',
      fontSize: '40px',
      color: '#ffffff',
    }).setOrigin(0.5);
    const roClose = this.add.text(0, 70, 'Cerrar', {
      fontFamily: 'monospace',
      fontSize: '22px',
      color: '#ffff00',
      backgroundColor: '#000000',
      padding: { left: 12, right: 12, top: 6, bottom: 6 },
    }).setOrigin(0.5).setInteractive();
    roClose.on('pointerdown', () => {
      this.resultOverlayGroup.setVisible(false);
    });
    this.resultOverlayGroup.add([roBg, roTitle, roScore, roClose]);
    this.resultOverlayGroup.setVisible(false);
    (this.resultOverlayGroup as any).scoreText = roScore;

    // R key listener for restart
    this.input.keyboard?.on('keydown-R', () => {
      if (this.manager?.state === 'GAME_OVER') {
        this.manager.restart();
        this.gameOverGroup.setVisible(false);
      }
    });
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

    const isPlaying = this.manager?.state === 'PLAYING';
    const resultOverlayVisible = this.resultOverlayGroup?.visible ?? false;

    // Gate player input and zero velocities when not PLAYING or overlay visible
    const canPlay = isPlaying && !resultOverlayVisible;
    if (!canPlay) {
      this.player.body.setVelocity(0, 0);
      this.player.body.setAcceleration(0, 0);
    }

    // Entities preUpdate — only process player input when playing and no overlay
    if (canPlay) {
      this.player.preUpdate(time, delta);
    } else {
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

    // Game Over overlay visibility and score sync
    if (this.manager && this.gameOverGroup) {
      const goScoreText = (this.gameOverGroup as any).scoreText as Phaser.GameObjects.Text;
      if (this.manager.state === 'GAME_OVER') {
        this.gameOverGroup.setVisible(true);
        if (goScoreText) {
          goScoreText.setText(`${this.manager.score.home} - ${this.manager.score.away}`);
        }
      } else {
        this.gameOverGroup.setVisible(false);
      }
    }

    // Result overlay score sync
    if (this.resultOverlayGroup && this.manager) {
      const roScoreText = (this.resultOverlayGroup as any).scoreText as Phaser.GameObjects.Text;
      if (roScoreText && this.resultOverlayGroup.visible) {
        roScoreText.setText(`${this.manager.score.home} - ${this.manager.score.away}`);
      }
    }
  }
}


