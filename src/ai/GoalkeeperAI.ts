export type GKState = 'POSITION' | 'TRACK' | 'CLAIM' | 'DIVE' | 'RECOVER';

export interface GKContext {
  x: number;
  y: number;
  goalY: number;
  minY: number;
  maxY: number;
}

export class GoalkeeperAI {
  public state: GKState = 'POSITION';
  private diveTimer = 0;

  public update(
    deltaMs: number,
    gk: GKContext,
    ballPos: { x: number; y: number },
    ballVel: { x: number; y: number }
  ): { targetX: number; targetY: number; action?: string } {
    const distToBall = Math.hypot(gk.x - ballPos.x, gk.y - ballPos.y);

    if (this.state === 'DIVE') {
      this.diveTimer -= deltaMs;
      if (this.diveTimer <= 0) {
        this.state = 'RECOVER';
      }
      return { targetX: gk.x, targetY: gk.y, action: 'DIVE' };
    }

    if (this.state === 'RECOVER') {
      this.state = 'POSITION';
    }

    // Goal line horizontal track
    const targetY = Math.max(gk.minY, Math.min(gk.maxY, ballPos.y));

    if (distToBall < 50 && Math.abs(ballVel.x) > 200) {
      this.state = 'DIVE';
      this.diveTimer = 400; // Dive duration
      return { targetX: gk.x, targetY, action: 'DIVE' };
    }

    if (distToBall < 80) {
      this.state = 'CLAIM';
      return { targetX: ballPos.x, targetY: ballPos.y, action: 'CLAIM' };
    }

    this.state = 'TRACK';
    return { targetX: gk.x, targetY, action: 'TRACK' };
  }
}
