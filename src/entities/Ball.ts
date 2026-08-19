import Phaser from 'phaser';

export class Ball {
  public scene: Phaser.Scene;
  public body: Phaser.Physics.Arcade.Body;
  public sprite: Phaser.GameObjects.Sprite;
  public shadowSprite: Phaser.GameObjects.Image;
  public z = 0;
  public zTarget = 0;
  public maxZ = 60;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.scene = scene;
    this.shadowSprite = scene.add.image(x, y + 8, 'ballShadow');
    this.sprite = scene.add.sprite(x, y, 'ball');
    const physics = scene.physics;
    physics.add.existing(this.sprite);
    this.body = this.sprite.body as Phaser.Physics.Arcade.Body;
    this.body.setBounce(0.8);
    this.body.setFriction(0.1);
    this.body.setCollideWorldBounds(true);
  }

  public preUpdate(time: number, delta: number): void {
    // Z model with spring decay
    const spring = 0.15;
    if (this.zTarget > 0) {
      this.zTarget *= 0.92;
    }
    this.z += (this.zTarget - this.z) * spring;
    this.z = Math.max(0, this.z);

    // Sync shadow scale/alpha to Z
    if (this.shadowSprite) {
      this.shadowSprite.x = this.sprite.x;
      this.shadowSprite.y = this.sprite.y + 8;
      const norm = Phaser.Math.Clamp(this.z / this.maxZ, 0, 1);
      const scale = 1 - norm * 0.6;
      const alpha = 0.6 - norm * 0.5;
      this.shadowSprite.setScale(scale);
      this.shadowSprite.setAlpha(Math.max(0.1, alpha));
    }
  }

  public applyKick(impulse: Phaser.Math.Vector2, power: number): void {
    const maxImpulse = 600;
    const minThreshold = 0.15;
    const effectivePower = Math.max(power, 0);
    if (effectivePower < minThreshold) {
      return;
    }
    const velocity = impulse.clone().normalize().scale(effectivePower * maxImpulse);
    this.body.setVelocity(velocity.x, velocity.y);
    // Z peak proportional to power
    this.zTarget = power * this.maxZ;
  }

  public reset(): void {
    this.body.setVelocity(0, 0);
    this.body.setPosition(480, 270);
    this.z = 0;
    this.zTarget = 0;
  }
}
