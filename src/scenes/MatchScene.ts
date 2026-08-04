import Phaser from 'phaser';

/** Frame index inside the players sheet = position in manifest.spritesheets.players.frames. */
const HOME_RUN_FRAME = 1;

/**
 * MatchScene — RENDER-ONLY STUB for Paso 1.
 *
 * Deliberately free of gameplay logic (input handling, body motion, opponent
 * logic, scoring are all out of scope here). It only proves the asset pipeline
 * end-to-end by rendering the generated pitch, ball, one running player, and
 * an "assets OK" HUD line. Real match behavior lands in later changes (see
 * AGENTS.md subsystems 1/2/4 and the TODO stubs under src/entities +
 * src/systems).
 */
export class MatchScene extends Phaser.Scene {
  constructor() {
    super('MatchScene');
  }

  create(): void {
    // Static pitch backdrop.
    this.add.image(480, 270, 'pitch');

    // Static centered ball with its shadow (no Z-axis physics yet).
    this.add.image(480, 270, 'ballShadow');
    this.add.image(480, 268, 'ball');

    // One home player looping the Run frame pair feel: for the stub, a simple
    // two-frame run flicker built from the spritesheet (home row frames).
    this.anims.create({
      key: 'run',
      frames: [{ key: 'players', frame: HOME_RUN_FRAME }],
      frameRate: 6,
      repeat: -1,
    });
    this.add.sprite(560, 270, 'players', HOME_RUN_FRAME).play('run');

    // HUD proof-of-life text.
    this.add
      .text(480, 24, 'assets OK', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffffff',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(10);
  }
}
