import { BALANCE_CONFIG } from '../data/balance';
import type { AICommand, EntitySnapshot, MatchContext } from './commands';
import type { Rng } from '../utils/rng';
import { choosePassTarget } from '../input/passTarget';
import {
  countPressure,
  curvedGoalTarget,
  dribbleSpeedFactor,
  laneIsClear,
  type DribbleFeelCfg,
} from './dribbleFeel';

/** Per-player FSM states for field players (AGENTS.md §11: utility + light FSM). */
export type FieldState = 'DEFENDING' | 'ATTACKING' | 'BALL_HOLDER';

interface AICfg extends DribbleFeelCfg {
  SHOOT_RANGE_PX: number;
  /** Remediation: bounded vertical aim spread around the mouth (miss margin). */
  SHOT_MISS_MARGIN_PX: number;
  /**
   * Anti-jitter hysteresis: how long a ball holder keeps the dribble intent
   * after a transient possession-null window (PossessionSystem drops the
   * holder a few frames after CONTROL_RADIUS is exceeded while the ball
   * stays behind). Matches BALANCE_CONFIG.AI.BALL_HOLDER_GRACE_MS.
   */
  BALL_HOLDER_GRACE_MS: number;
  /** Phase 2 closure: pass tendency (probability) + bounded target error. */
  AI_PASS_TENDENCY: number;
  AI_PASS_ERROR_PX: number;
  /** Phase 2 closure: off-ball attack support distances/weights + bound. */
  AI_SUPPORT_PUSH_PX: number;
  AI_SUPPORT_SPACING_PX: number;
  AI_SUPPORT_AVOID_RADIUS_PX: number;
  AI_SUPPORT_MAX_SHIFT_PX: number;
  /** Batch C (visible help): extra forward shove for the lane-offer teammate. */
  AI_LANE_OFFER_EXTRA_PUSH_PX: number;
  /** Living movement batch: ball-side block-slide bounds are coordinator-side
   * (anchors arrive pre-shifted); the per-player knobs below drive recovery
   * sprints, idle sway and defensive tracking. */
  AI_RECOVERY_DEPTH_PX: number;
  AI_RECOVERY_SPEED_FACTOR: number;
  AI_IDLE_SWAY_RADIUS_PX: number;
  AI_IDLE_SWAY_PERIOD_MS: number;
  AI_TRACK_WEIGHT: number;
  AI_TRACK_GOAL_SIDE_PX: number;
  AI_TRACK_RADIUS_PX: number;
  AI_TRACK_MAX_SHIFT_PX: number;
  AI_ATTACK_RUN_EXTRA_PUSH_PX: number;
}

const PHYSICS = BALANCE_CONFIG.PHYSICS;

/**
 * Remediation (shot placement): AI aim spreads across the goal mouth plus a
 * bounded miss margin, so corner finishes are reachable and shots can miss
 * the frame entirely (TouchTracker byline rules award corner/goal kick).
 * Pure and deterministic: uniform in
 * [center - (half + miss), center + (half + miss)] from the seeded rng.
 */
export function aimShotTarget(
  rng: Rng,
  centerY: number,
  halfHeight: number,
  missMargin: number,
): number {
  return centerY + (rng() * 2 - 1) * (halfHeight + missMargin);
}

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

    // Off-ball attack support (Phase 2 closure, arcade-y): possessing-team
    // teammates shift off the anchor toward open support spots. Defending
    // non-pressers fall through to recovery/tracking below (shape preserved,
    // max pressers capped by the coordinator).
    if (this.state === 'ATTACKING') {
      return this.supportCommand(snap, ctx);
    }

    // Defending non-presser (living movement): a turnover recovery sprint
    // owns the target while active; otherwise DF-role players shade
    // goal-side of their nearest threat; every other role holds the anchor.
    // All three breathe through the same deterministic sway.
    if (ctx.recoveryRun === true) {
      return this.recoveryCommand(snap, ctx);
    }
    if (snap.role === 'DF') {
      return this.trackCommand(snap, ctx);
    }
    return this.holdCommand(snap, ctx);
  }

  private tickHolder(snap: EntitySnapshot, ctx: MatchContext): AICommand {
    // Remediation: the aim line sits on shared geometry (no 60px literal —
    // the offset mirrors FOUL.SET_PIECE_AI_GOAL_OFFSET_PX) and the vertical
    // aim spreads across the mouth via aimShotTarget (no auto-center).
    const goalOffset = BALANCE_CONFIG.FOUL.SET_PIECE_AI_GOAL_OFFSET_PX;
    const goalX = ctx.attackDir === 1 ? PHYSICS.PITCH_WIDTH - goalOffset : goalOffset;
    const mouthCenter = BALANCE_CONFIG.FEEDBACK.GOAL_MOUTH_CENTER_Y_PX;
    const mouthHalf = BALANCE_CONFIG.FEEDBACK.GOAL_MOUTH_HALF_HEIGHT_PX;
    const distToGoal = Math.hypot(goalX - snap.x, mouthCenter - snap.y);

    if (distToGoal < this.cfg.SHOOT_RANGE_PX) {
      return {
        targetX: goalX,
        targetY: aimShotTarget(this.rng, mouthCenter, mouthHalf, this.cfg.SHOT_MISS_MARGIN_PX),
        action: 'SHOOT',
        // Deterministic power variation via injected seeded RNG
        power: 0.7 + this.rng() * 0.3,
      };
    }

    // Phase 2 closure: holder utility SHOOT > PASS > DRIBBLE. Same cone and
    // range gates as human passes (choosePassTarget + INPUT config) so AI and
    // human feel are identical; tendency + error come from the AI group.
    const pass = this.tryPass(snap, ctx);
    if (pass !== null) {
      return pass;
    }

    // Dribble forward — but not on rails (fase 4 carrier feel): pressure
    // modulates speed, an open lane grants a small boost, and the goal target
    // bends away from the nearest ahead defender. All metrics come from the
    // tick's snapshot data (no per-frame O(n^2)); the per-frame heading wobble
    // lives in AIController.
    const opponents = ctx.opponents ?? [];
    const dirX = distToGoal > 0 ? (goalX - snap.x) / distToGoal : 1;
    const dirY = distToGoal > 0 ? (mouthCenter - snap.y) / distToGoal : 0;
    const pressure = countPressure(snap.x, snap.y, opponents, this.cfg.DRIBBLE_PRESSURE_SLOW_PX);
    const laneOpen = laneIsClear(
      snap.x,
      snap.y,
      dirX,
      dirY,
      opponents,
      this.cfg.DRIBBLE_CORRIDOR_HALF_WIDTH_PX,
    );
    const speedFactor = dribbleSpeedFactor(pressure, laneOpen, this.cfg);
    const target = curvedGoalTarget(snap.x, snap.y, goalX, mouthCenter, opponents, this.cfg);
    return { targetX: target.x, targetY: target.y, action: 'MOVE', dribble: true, speedFactor };
  }

  /**
   * Phase 2 closure: holder pass option reusing the human pass-target logic.
   * Batch C: a coordinator-flagged clearly-best lane (ctx.forcedPassTarget)
   * converts straight to a PASS — the visible help the user asked for — while
   * legacy call sites without the flag keep the tendency dice. Power matches
   * the human pass path (INPUT.PASS_POWER_PCT); error is a bounded symmetric
   * jitter from the seeded rng (deterministic, no Math.random).
   */
  private tryPass(snap: EntitySnapshot, ctx: MatchContext): AICommand | null {
    if (ctx.forcedPassTarget !== undefined) {
      return this.passAt(snap, ctx.forcedPassTarget);
    }
    const mates = (ctx.teammates ?? []).filter((m) => m.id !== snap.id);
    if (mates.length === 0) {
      return null;
    }
    const target = choosePassTarget(
      { x: snap.x, y: snap.y },
      mates,
      ctx.attackDir,
      BALANCE_CONFIG.INPUT,
    );
    if (target === null) {
      return null;
    }
    if (this.rng() >= this.cfg.AI_PASS_TENDENCY) {
      return null;
    }
    return this.passAt(snap, target);
  }

  /** Builds the PASS command for a target with bounded seeded error. */
  private passAt(snap: EntitySnapshot, target: { x: number; y: number }): AICommand {
    const err = this.cfg.AI_PASS_ERROR_PX;
    const ex = (this.rng() * 2 - 1) * err;
    const ey = (this.rng() * 2 - 1) * err;
    return {
      targetX: target.x + ex,
      targetY: target.y + ey,
      action: 'PASS',
      power: BALANCE_CONFIG.INPUT.PASS_POWER_PCT,
    };
  }

  /**
   * Phase 2 closure: minimal off-ball attack support (arcade-y, no tactics
   * presets). Legacy call sites without teammates data keep holding the exact
   * anchor; with team data the target shifts forward plus away from the
   * nearest opponent inside the avoid radius, bounded by MAX_SHIFT and
   * clamped to the pitch. Defending shape is untouched (caller only routes
   * ATTACKING here; defenders keep anchor + max 2 pressers).
   *
   * Batch B1 (tactics): the coordinator may override the push distance via
   * ctx.supportPushPx and pin players to anchors via ctx.supportEnabled.
   * Batch C (visible help): the lane-offer teammate (ctx.laneOfferId) adds
   * AI_LANE_OFFER_EXTRA_PUSH_PX so the offer reads on screen — still clamped
   * by MAX_SHIFT so shape never breaks.
   */
  private supportCommand(snap: EntitySnapshot, ctx: MatchContext): AICommand {
    if (ctx.supportEnabled === false) {
      return { targetX: ctx.anchorX, targetY: ctx.anchorY, action: 'MOVE' };
    }
    const mates = ctx.teammates;
    if (mates === undefined || mates.length === 0) {
      return { targetX: ctx.anchorX, targetY: ctx.anchorY, action: 'MOVE' };
    }
    const opponents = ctx.opponents ?? [];
    const basePush = ctx.supportPushPx ?? this.cfg.AI_SUPPORT_PUSH_PX;
    let pushPx = ctx.laneOfferId === snap.id ? basePush + this.cfg.AI_LANE_OFFER_EXTRA_PUSH_PX : basePush;
    // Living movement: attackers breaking in behind on a won turnover add
    // the extra run push on top — still clamped by MAX_SHIFT below.
    if (ctx.attackRun === true) {
      pushPx += this.cfg.AI_ATTACK_RUN_EXTRA_PUSH_PX;
    }
    const pushX = ctx.attackDir * pushPx;
    let spaceX = 0;
    let spaceY = 0;
    let bestD2 = this.cfg.AI_SUPPORT_AVOID_RADIUS_PX * this.cfg.AI_SUPPORT_AVOID_RADIUS_PX;
    let found = false;
    let foundDx = 0;
    let foundDy = 0;
    for (const o of opponents) {
      const dx = snap.x - o.x;
      const dy = snap.y - o.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2 && d2 > 0) {
        bestD2 = d2;
        foundDx = dx;
        foundDy = dy;
        found = true;
      }
    }
    if (found) {
      const len = Math.hypot(foundDx, foundDy);
      if (len > 0) {
        spaceX = (foundDx / len) * this.cfg.AI_SUPPORT_SPACING_PX;
        spaceY = (foundDy / len) * this.cfg.AI_SUPPORT_SPACING_PX;
      }
    }
    let offX = pushX + spaceX;
    let offY = spaceY;
    const offLen = Math.hypot(offX, offY);
    const maxShift = this.cfg.AI_SUPPORT_MAX_SHIFT_PX;
    if (offLen > maxShift && offLen > 0) {
      offX = (offX / offLen) * maxShift;
      offY = (offY / offLen) * maxShift;
    }
    const tx = Math.max(0, Math.min(PHYSICS.PITCH_WIDTH, ctx.anchorX + offX));
    const ty = Math.max(0, Math.min(PHYSICS.PITCH_HEIGHT, ctx.anchorY + offY));
    return { targetX: tx, targetY: ty, action: 'MOVE' };
  }

  /**
   * Living movement: deterministic idle breathing, a pure function of the
   * player id and the coordinator tick time (same pattern as the dribble
   * wobble — no Math.random, no RNG-stream consumption, so determinism
   * tests are unaffected). Gated on nowMs so legacy call sites without a
   * clock keep exact-anchor behavior; per-id phase comes from a small
   * string hash so teammates never sway in lockstep.
   */
  private swayOffset(id: string, nowMs: number | undefined): { x: number; y: number } {
    const radius = this.cfg.AI_IDLE_SWAY_RADIUS_PX;
    if (nowMs === undefined || radius <= 0) {
      return { x: 0, y: 0 };
    }
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    }
    const phase = (hash % 360) * (Math.PI / 180);
    const angle = (nowMs / this.cfg.AI_IDLE_SWAY_PERIOD_MS) * Math.PI * 2 + phase;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  }

  /** Idle hold: anchor plus breathing, clamped to the pitch. */
  private holdCommand(snap: EntitySnapshot, ctx: MatchContext): AICommand {
    const sway = this.swayOffset(snap.id, ctx.nowMs);
    return {
      targetX: Math.max(0, Math.min(PHYSICS.PITCH_WIDTH, ctx.anchorX + sway.x)),
      targetY: Math.max(0, Math.min(PHYSICS.PITCH_HEIGHT, ctx.anchorY + sway.y)),
      action: 'MOVE',
    };
  }

  /**
   * Living movement: recovery sprint after a lost turnover. The target sits
   * RECOVERY_DEPTH_PX goal-side of the (block-shifted) anchor at sprint
   * pace; breathing applies on top so the runner still reads alive.
   */
  private recoveryCommand(snap: EntitySnapshot, ctx: MatchContext): AICommand {
    const sway = this.swayOffset(snap.id, ctx.nowMs);
    const tx = ctx.anchorX - ctx.attackDir * this.cfg.AI_RECOVERY_DEPTH_PX + sway.x;
    return {
      targetX: Math.max(0, Math.min(PHYSICS.PITCH_WIDTH, tx)),
      targetY: Math.max(0, Math.min(PHYSICS.PITCH_HEIGHT, ctx.anchorY + sway.y)),
      action: 'MOVE',
      speedFactor: this.cfg.AI_RECOVERY_SPEED_FACTOR,
    };
  }

  /**
   * Living movement: defensive tracking (positioning only — no tackling
   * changes). Blends the anchor toward a point TRACK_GOAL_SIDE_PX behind
   * (goal-side of) the nearest threat sensed from the ANCHOR — anchor-based
   * sensing keeps the target stable tick-to-tick (no chase feedback loop).
   * Threats beyond TRACK_RADIUS_PX are ignored, so distant play never drags
   * the line out of shape; the blend is bounded by TRACK_MAX_SHIFT_PX.
   */
  private trackCommand(snap: EntitySnapshot, ctx: MatchContext): AICommand {
    const opponents = ctx.opponents ?? [];
    const senseR2 = this.cfg.AI_TRACK_RADIUS_PX * this.cfg.AI_TRACK_RADIUS_PX;
    let goalX = ctx.anchorX;
    let goalY = ctx.anchorY;
    let bestD2 = senseR2;
    let found = false;
    for (const o of opponents) {
      const dx = o.x - ctx.anchorX;
      const dy = o.y - ctx.anchorY;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        goalX = o.x - ctx.attackDir * this.cfg.AI_TRACK_GOAL_SIDE_PX;
        goalY = o.y;
        found = true;
      }
    }
    let offX = 0;
    let offY = 0;
    if (found) {
      const w = this.cfg.AI_TRACK_WEIGHT;
      offX = (goalX - ctx.anchorX) * w;
      offY = (goalY - ctx.anchorY) * w;
      const offLen = Math.hypot(offX, offY);
      const maxShift = this.cfg.AI_TRACK_MAX_SHIFT_PX;
      if (offLen > maxShift && offLen > 0) {
        offX = (offX / offLen) * maxShift;
        offY = (offY / offLen) * maxShift;
      }
    }
    const sway = this.swayOffset(snap.id, ctx.nowMs);
    return {
      targetX: Math.max(0, Math.min(PHYSICS.PITCH_WIDTH, ctx.anchorX + offX + sway.x)),
      targetY: Math.max(0, Math.min(PHYSICS.PITCH_HEIGHT, ctx.anchorY + offY + sway.y)),
      action: 'MOVE',
    };
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
