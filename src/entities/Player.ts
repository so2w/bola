import Phaser from 'phaser';

type AnimState = 'Idle' | 'Run' | 'Kick';

export class Player {
  public scene: Phaser.Scene;
  public body: Phaser.Physics.Arcade.Body;
  public sprite: Phaser.GameObjects.Sprite;
  public inputKeys: Phaser.Types.Input.Keyboard.CursorKeys & { w?: Phaser.Input.Keyboard.Key; a?: Phaser.Input.Keyboard.Key; s?: Phaser.Input.Keyboard.Key; d?: Phaser.Input.Keyboard.Key };
  public animState: AnimState = 'Idle';
  public chargeTimer = 0;
  public maxSpeed = 220;
  private maxCharge = 1000;
  private kickDuration = 200;
  private kickTimer = 0;
  private isCharging = false;
  private shotCallback?: (power: number, facing: Phaser.Math.Vector2) => void;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.scene = scene;
    this.sprite = scene.add.sprite(x, y, 'players', 0);
    const physics = scene.physics;
    physics.add.existing(this.sprite);
    this.body = this.sprite.body as Phaser.Physics.Arcade.Body;
    this.body.setCollideWorldBounds(true);
    this.body.setDrag(0.8);

    if (!scene.input || !scene.input.keyboard) {
      throw new Error('Keyboard plugin is not enabled or available in scene');
    }
    this.inputKeys = scene.input.keyboard.createCursorKeys();
    // WASD fallback
    this.inputKeys.w = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.inputKeys.a = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.inputKeys.s = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.inputKeys.d = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);

    // Shot key
    const shotKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    
    shotKey.on('down', () => {
      this.isCharging = true;
      this.chargeTimer = 0;
    });
    shotKey.on('up', () => {
      if (this.isCharging) {
        const power = Phaser.Math.Clamp(this.chargeTimer / this.maxCharge, 0, 1);
        const facing = this.getFacing();
        this.startKick();
        this.chargeTimer = 0;
        this.isCharging = false;
        this.shotCallback?.(power, facing);
      }
    });

    this.createAnimations();
  }

  private createAnimations(): void {
    if (!this.scene.anims.exists('player_idle')) {
      this.scene.anims.create({
        key: 'player_idle',
        frames: [{ key: 'players', frame: 0 }],
        frameRate: 1,
      });
    }
    if (!this.scene.anims.exists('player_run')) {
      this.scene.anims.create({
        key: 'player_run',
        frames: [
          { key: 'players', frame: 1 },
          { key: 'players', frame: 2 },
        ],
        frameRate: 8,
        repeat: -1,
      });
    }
    if (!this.scene.anims.exists('player_kick')) {
      this.scene.anims.create({
        key: 'player_kick',
        frames: [{ key: 'players', frame: 3 }],
        frameRate: 1,
      });
    }
  }

  public preUpdate(time: number, delta: number): void {
    this.updateInput();
    this.updateMovement();
    this.updateCharge(delta);
    this.updateAnimation();
  }

  private updateInput(): void {
    const keys = this.inputKeys;
    const left = keys.left?.isDown || keys.a?.isDown;
    const right = keys.right?.isDown || keys.d?.isDown;
    const up = keys.up?.isDown || keys.w?.isDown;
    const down = keys.down?.isDown || keys.s?.isDown;

    const inputVec = new Phaser.Math.Vector2(
      (right ? 1 : 0) - (left ? 1 : 0),
      (down ? 1 : 0) - (up ? 1 : 0)
    );

    if (inputVec.lengthSq() > 0) {
      inputVec.normalize();
      this.body.setVelocity(inputVec.x * this.maxSpeed, inputVec.y * this.maxSpeed);
    } else {
      this.body.setVelocity(0, 0);
    }
  }

  private updateMovement(): void {
    // Velocity already set in updateInput via Arcade body
  }

  private updateCharge(delta: number): void {
    if (this.isCharging) {
      this.chargeTimer = Math.min(this.chargeTimer + delta, this.maxCharge);
    }
  }

  private updateAnimation(): void {
    if (this.kickTimer > 0) {
      this.kickTimer -= this.scene.game.loop.delta;
      if (this.kickTimer <= 0) {
        this.animState = this.body.velocity.length() > 0 ? 'Run' : 'Idle';
      }
    }

    if (this.animState === 'Kick') {
      if (!this.sprite.anims.isPlaying || this.sprite.anims.currentAnim?.key !== 'player_kick') {
        this.sprite.anims.play('player_kick', true);
      }
      return;
    }

    const moving = this.body.velocity.lengthSq() > 0;
    if (moving) {
      this.animState = 'Run';
      if (this.sprite.anims.currentAnim?.key !== 'player_run') {
        this.sprite.anims.play('player_run', true);
      }
    } else {
      this.animState = 'Idle';
      if (this.sprite.anims.currentAnim?.key !== 'player_idle') {
        this.sprite.anims.play('player_idle', true);
      }
    }
  }

  private startKick(): void {
    this.animState = 'Kick';
    this.kickTimer = this.kickDuration;
    this.sprite.anims.play('player_kick', true);
  }

  private getFacing(): Phaser.Math.Vector2 {
    const vel = this.body.velocity;
    if (vel.lengthSq() > 0) {
      return vel.clone().normalize();
    }
    // Default right
    return new Phaser.Math.Vector2(1, 0);
  }

  public onShot(cb: (power: number, facing: Phaser.Math.Vector2) => void): void {
    this.shotCallback = cb;
  }

  public getPower(): number {
    return Phaser.Math.Clamp(this.chargeTimer / this.maxCharge, 0, 1);
  }

  public setPosition(x: number, y: number): void {
    this.sprite.setPosition(x, y);
  }

  public shootWithPower(power: number, facing: Phaser.Math.Vector2): void {
    if (this.kickTimer > 0) {
      return;
    }
    this.startKick();
    this.shotCallback?.(Phaser.Math.Clamp(power, 0, 1), facing.clone());
  }
}
