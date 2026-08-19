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

  constructor() {}

  public update(delta: number, rival: any, ball: any, matchManager: any): void {
    // Foundation skeleton: no logic yet, keep build passing
  }
}
