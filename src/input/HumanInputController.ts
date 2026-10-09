import Phaser from 'phaser';
import type { Player, IPlayerController } from '../entities/Player';

/**
 * Human keyboard controller — bindings moved 1:1 from the legacy Player
 * constructor (cursors + WASD movement, SPACE charge/release shot).
 */
export class HumanInputController implements IPlayerController {
  private player?: Player;
  private keys?: Phaser.Types.Input.Keyboard.CursorKeys & {
    w?: Phaser.Input.Keyboard.Key;
    a?: Phaser.Input.Keyboard.Key;
    s?: Phaser.Input.Keyboard.Key;
    d?: Phaser.Input.Keyboard.Key;
  };
  private shotListenersRegistered = false;

  public attach(scene: Phaser.Scene, player: Player): void {
    this.player = player;
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

    // Shot key — listeners registered once; re-attach only rebinds the player
    if (!this.shotListenersRegistered) {
      const shotKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
      shotKey.on('down', () => {
        this.player?.startCharge();
      });
      shotKey.on('up', () => {
        this.player?.releaseCharge();
      });
      this.shotListenersRegistered = true;
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
