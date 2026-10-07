/**
 * TODO: SimpleAI — implement in a later change per AGENTS.md Subsystem 2
 * (Rival AI — "Chasing & Shooting AI").
 *
 * Planned responsibilities (NOT implemented in Paso 1):
 * - Defensive mode (without ball): chase the ball's X/Y to press the carrier.
 * - Offensive mode (with ball): advance toward the rival goal; shoot when
 *   distance to goal < 120 px.
 */
export type AIState = 'DEFENSIVE' | 'OFFENSIVE';

export class SimpleAI {
  public state: AIState = 'DEFENSIVE';
  public readonly possessionRadius = 28;
  public readonly shootCooldownMs = 400;
  private lastShotTime = 0;
  private lastStateChangeTime = 0;
  private readonly stateDebounceMs = 150;

  constructor() {}

  public update(delta: number, rival: any, ball: any, matchManager: any): void {
    if (!rival?.body || !ball?.sprite || !matchManager) {
      return;
    }

    const now = rival.scene?.time?.now ?? Date.now();
    const matchState = matchManager.state;

    if (matchState !== 'PLAYING' && matchState !== 'KICKOFF') {
      rival.body.setVelocity(0, 0);
      return;
    }

    const rx = rival.sprite.x;
    const ry = rival.sprite.y;
    const bx = ball.sprite.x;
    const by = ball.sprite.y;

    const distToBall = Phaser.Math.Distance.Between(rx, ry, bx, by);
    const hasPossession = distToBall < this.possessionRadius;

    const desiredState: AIState = hasPossession ? 'OFFENSIVE' : 'DEFENSIVE';

    if (desiredState !== this.state && now - this.lastStateChangeTime > this.stateDebounceMs) {
      this.state = desiredState;
      this.lastStateChangeTime = now;
      // Reset cooldown on state change to avoid immediate spam
      this.lastShotTime = now;
    }

    // Target selection
    let targetX: number;
    let targetY: number;

    if (this.state === 'DEFENSIVE') {
      targetX = bx;
      targetY = by;
    } else {
      // Rival attacks left goal
      targetX = 80;
      targetY = 270;
    }

    const vec = new Phaser.Math.Vector2(targetX - rx, targetY - ry);
    if (vec.lengthSq() > 0) {
      vec.normalize();
    }

    const speed = rival.maxSpeed * 0.9;
    rival.body.setVelocity(vec.x * speed, vec.y * speed);

    // Shooting logic in OFFENSIVE state
    if (this.state === 'OFFENSIVE') {
      const goalX = 80;
      const goalY = 270;
      const distToGoal = Phaser.Math.Distance.Between(rx, ry, goalX, goalY);

      if (distToGoal < 120 && now - this.lastShotTime > this.shootCooldownMs) {
        const facing = new Phaser.Math.Vector2(goalX - rx, goalY - ry);
        if (facing.lengthSq() > 0) {
          facing.normalize();
        }
        const power = 0.7 + Math.random() * 0.3;
        if (typeof rival.shootWithPower === 'function') {
          rival.shootWithPower(power, facing);
          this.lastShotTime = now;
        }
      }
    }
  }
}
