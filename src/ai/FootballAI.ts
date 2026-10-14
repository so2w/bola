import { BALANCE_CONFIG } from '../data/balance';
import type { AICommand, EntitySnapshot, MatchContext } from './commands';
import type { Rng } from '../utils/rng';

/** Per-player FSM states for field players (AGENTS.md §11: utility + light FSM). */
export type FieldState = 'DEFENDING' | 'ATTACKING' | 'BALL_HOLDER';

interface AICfg {
  SHOOT_RANGE_PX: number;
  /**
   * Anti-jitter hysteresis: how long a ball holder keeps the dribble intent
   * after a transient possession-null window (PossessionSystem drops the
   * holder a few frames after CONTROL_RADIUS is exceeded while the ball
   * stays behind). Matches BALANCE_CONFIG.AI.BALL_HOLDER_GRACE_MS.
   */
  BALL_HOLDER_GRACE_MS: number;
}

const PHYSICS = BALANCE_CONFIG.PHYSICS;

/**
 * Per-player football AI (Phaser-free): runs on plain snapshots at the
 * coordinator cadence; locomotion is applied per frame from the last command.
 *
 * Behaviors:
 * - BALL_HOLDER: dribble toward the attacking goal; shoot when within range.
 * - ATTACKING (team possession, not holder): hold formation anchor / pass line.
 * - DEFENDING: press when assigned (max 1-2 via coordinator); otherwise hold anchor.
 */
export class FootballAI {
  public state: FieldState = 'DEFENDING';

  /** Hysteresis deadline: until nowMs passes it, a lost-ball window keeps BALL_HOLDER. */
  private holderGraceUntilMs = -Infinity;

  constructor(
    public readonly rng: Rng,
    private readonly cfg: AICfg = BALANCE_CONFIG.AI,
  ) {}

  public tick(snap: EntitySnapshot, ctx: MatchContext): AICommand {
    // State transitions (deterministic, snapshot-driven).
    if (ctx.possessorId === snap.id) {
      this.state = 'BALL_HOLDER';
      if (ctx.nowMs !== undefined) {
        this.holderGraceUntilMs = ctx.nowMs + this.cfg.BALL_HOLDER_GRACE_MS;
      }
    } else if (
      this.state === 'BALL_HOLDER' &&
      ctx.possessorId === null &&
      ctx.nowMs !== undefined &&
      ctx.nowMs < this.holderGraceUntilMs
    ) {
      // Anti-jitter grace: the ball is loose only because the dribbler stepped
      // past CONTROL_RADIUS for a few frames — keep the dribble target instead
      // of flipping BALL_HOLDER -> PRESS/anchor every coordinator tick.
    } else if (ctx.myTeamPossession) {
      this.state = 'ATTACKING';
    } else {
      this.state = 'DEFENDING';
    }

    const isPresser = ctx.pressers.includes(snap.id);

    if (this.state === 'BALL_HOLDER') {
      return this.tickHolder(snap, ctx);
    }

    if (this.state === 'DEFENDING' && isPresser) {
      return { targetX: ctx.ball.x, targetY: ctx.ball.y, action: 'PRESS' };
    }

    // Hold formation anchor (ATTACKING or defending non-presser)
    return { targetX: ctx.anchorX, targetY: ctx.anchorY, action: 'MOVE' };
  }

  private tickHolder(snap: EntitySnapshot, ctx: MatchContext): AICommand {
    const goalX = ctx.attackDir === 1 ? PHYSICS.PITCH_WIDTH - 60 : 60;
    const goalY = PHYSICS.PITCH_HEIGHT / 2;
    const distToGoal = Math.hypot(goalX - snap.x, goalY - snap.y);

    if (distToGoal < this.cfg.SHOOT_RANGE_PX) {
      return {
        targetX: goalX,
        targetY: goalY,
        action: 'SHOOT',
        // Deterministic power variation via injected seeded RNG
        power: 0.7 + this.rng() * 0.3,
      };
    }

    // Dribble forward toward the goal
    return { targetX: goalX, targetY: goalY, action: 'MOVE' };
  }

  /**
   * Pure locomotion helper: velocity toward the command target at player max
   * speed. AIController applies the same math through Player.move per frame.
   */
  public applyLocomotion(cmd: AICommand, snap: EntitySnapshot): { vx: number; vy: number } {
    const dx = cmd.targetX - snap.x;
    const dy = cmd.targetY - snap.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) {
      return { vx: 0, vy: 0 };
    }
    const speed = PHYSICS.PLAYER_MAX_SPEED;
    return { vx: (dx / len) * speed, vy: (dy / len) * speed };
  }
}
