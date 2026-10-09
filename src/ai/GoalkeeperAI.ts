import { BALANCE_CONFIG } from '../data/balance';
import type { AICommand, BallSnapshot, EntitySnapshot } from './commands';
import { mulberry32, type Rng } from '../utils/rng';

/** Full keeper FSM (AGENTS.md §11). */
export type GKState = 'POSITION' | 'TRACK' | 'CLAIM' | 'DIVE' | 'HOLD' | 'DISTRIBUTE' | 'RECOVER';

export interface GKContext {
  ball: BallSnapshot;
  teammates: EntitySnapshot[];
  opponents: EntitySnapshot[];
  attackDir: 1 | -1;
}

export interface GKConfig {
  TRACK_RADIUS_PX: number;
  CLAIM_RADIUS_PX: number;
  DIVE_RADIUS_PX: number;
  DIVE_TRIGGER_SPEED: number;
  DIVE_DURATION_MS: number;
  GK_HOLD_MS: number;
}

/**
 * Goalkeeper AI (Phaser-free, pure FSM): POSITION → TRACK → CLAIM/DIVE →
 * HOLD → DISTRIBUTE → RECOVER → POSITION. All radii/timers from
 * BALANCE_CONFIG.GK. Tick is cheap enough to run EVERY frame (design 3.0:
 * dive reachability vs 600px/s shots requires per-frame evaluation).
 */
export class GoalkeeperAI {
  public state: GKState = 'POSITION';

  private diveTimer = 0;
  private holdTimer = 0;
  private readonly rng: Rng;
  private readonly cfg: GKConfig;

  constructor(rng: Rng = mulberry32(1), cfg: GKConfig = BALANCE_CONFIG.GK) {
    this.rng = rng;
    this.cfg = cfg;
  }

  public tick(dtMs: number, gk: EntitySnapshot, ctx: GKContext): AICommand {
    const dist = Math.hypot(gk.x - ctx.ball.x, gk.y - ctx.ball.y);
    const ballSpeed = Math.hypot(ctx.ball.vx, ctx.ball.vy);
    const centerY = BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT / 2;

    switch (this.state) {
      case 'DIVE': {
        this.diveTimer -= dtMs;
        if (this.diveTimer <= 0) {
          if (dist < this.cfg.CLAIM_RADIUS_PX) {
            this.state = 'HOLD';
            this.holdTimer = this.cfg.GK_HOLD_MS;
          } else {
            this.state = 'RECOVER';
          }
        }
        return { targetX: gk.x, targetY: gk.y, action: 'DIVE' };
      }

      case 'HOLD': {
        this.holdTimer -= dtMs;
        if (this.holdTimer <= 0) {
          this.state = 'DISTRIBUTE';
        }
        return { targetX: gk.x, targetY: gk.y, action: 'HOLD' };
      }

      case 'DISTRIBUTE': {
        // Pass toward the most open teammate (max distance from nearest opponent).
        // Strict comparison keeps the first on ties — deterministic without rng.
        let best = ctx.teammates[0];
        let bestOpen = -Infinity;
        for (const t of ctx.teammates) {
          let nearestOpp = Infinity;
          for (const o of ctx.opponents) {
            nearestOpp = Math.min(nearestOpp, Math.hypot(t.x - o.x, t.y - o.y));
          }
          if (nearestOpp > bestOpen) {
            bestOpen = nearestOpp;
            best = t;
          }
        }
        this.state = 'RECOVER';
        return { targetX: best.x, targetY: best.y, action: 'DISTRIBUTE' };
      }

      case 'RECOVER': {
        // Walk back to the goal line; next tick returns to POSITION.
        this.state = 'POSITION';
        return { targetX: gk.x, targetY: centerY, action: 'MOVE' };
      }

      default:
        break;
    }

    // Fast ball inside dive radius → DIVE (checked before CLAIM: dive radius covers claim area)
    if (dist < this.cfg.DIVE_RADIUS_PX && Math.abs(ctx.ball.vx) > this.cfg.DIVE_TRIGGER_SPEED) {
      this.state = 'DIVE';
      this.diveTimer = this.cfg.DIVE_DURATION_MS;
      return { targetX: gk.x, targetY: gk.y, action: 'DIVE' };
    }

    // Slow/stationary ball inside claim radius → CLAIM
    if (dist < this.cfg.CLAIM_RADIUS_PX && ballSpeed <= this.cfg.DIVE_TRIGGER_SPEED) {
      if (dist < 10) {
        // Ball secured
        this.state = 'HOLD';
        this.holdTimer = this.cfg.GK_HOLD_MS;
        return { targetX: gk.x, targetY: gk.y, action: 'HOLD' };
      }
      this.state = 'CLAIM';
      return { targetX: ctx.ball.x, targetY: ctx.ball.y, action: 'CLAIM' };
    }

    // Ball within track radius → track its y along the goal line
    if (dist < this.cfg.TRACK_RADIUS_PX) {
      this.state = 'TRACK';
      const targetY = Math.max(60, Math.min(BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT - 60, ctx.ball.y));
      return { targetX: gk.x, targetY, action: 'TRACK' };
    }

    // Otherwise hold the goal-line position
    this.state = 'POSITION';
    return { targetX: gk.x, targetY: centerY, action: 'MOVE' };
  }
}
