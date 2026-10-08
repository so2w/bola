import Phaser from 'phaser';

export class CameraController {
  private camera: Phaser.Cameras.Scene2D.Camera;
  private lerpFactor: number;
  private lookAheadWeight: number;

  constructor(camera: Phaser.Cameras.Scene2D.Camera, lerpFactor = 0.08, lookAheadWeight = 0.15) {
    this.camera = camera;
    this.lerpFactor = lerpFactor;
    this.lookAheadWeight = lookAheadWeight;
  }

  public update(
    playerPos: { x: number; y: number },
    ballPos: { x: number; y: number },
    ballVel: { x: number; y: number }
  ): void {
    // Target position weighted between player and ball
    const midX = playerPos.x * 0.4 + ballPos.x * 0.6;
    const midY = playerPos.y * 0.4 + ballPos.y * 0.6;

    // Apply look-ahead vector based on ball velocity
    const targetX = midX + ballVel.x * this.lookAheadWeight;
    const targetY = midY + ballVel.y * this.lookAheadWeight;

    // Smoothly scroll camera
    const currentScrollX = this.camera.scrollX + this.camera.width / 2;
    const currentScrollY = this.camera.scrollY + this.camera.height / 2;

    const newX = currentScrollX + (targetX - currentScrollX) * this.lerpFactor;
    const newY = currentScrollY + (targetY - currentScrollY) * this.lerpFactor;

    this.camera.centerOn(newX, newY);
  }
}
