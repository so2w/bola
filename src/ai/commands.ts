/** AI command DTOs shared between the coordinator, controllers and MatchScene. */

export type AIAction =
  | 'MOVE'
  | 'PRESS'
  | 'PASS'
  | 'SHOOT'
  | 'TACKLE'
  | 'DIVE'
  | 'CLAIM'
  | 'HOLD'
  | 'TRACK'
  | 'DISTRIBUTE'
  | 'IDLE';

export interface AICommand {
  targetX: number;
  targetY: number;
  action: AIAction;
  power?: number;
  /**
   * Carrier feel (fase 4): true on BALL_HOLDER dribble MOVE commands. Tells
   * the locomotion layer to apply the deterministic heading wobble.
   */
  dribble?: boolean;
  /**
   * Carrier feel: per-tick speed multiplier from the pressure metric and
   * open-lane boost (defaults to 1 when absent).
   */
  speedFactor?: number;
}

export type TeamSide = 'home' | 'away';

export interface EntitySnapshot {
  id: string;
  team: TeamSide;
  role: 'GK' | 'DF' | 'MF' | 'FW';
  x: number;
  y: number;
  vx: number;
  vy: number;
  state?: string;
}

export interface BallSnapshot {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
}

/** Blackboard context passed to FootballAI.tick by the TeamCoordinator. */
export interface MatchContext {
  ball: BallSnapshot;
  possessorId: string | null;
  myTeamPossession: boolean;
  anchorX: number;
  anchorY: number;
  pressers: string[];
  attackDir: 1 | -1;
  /**
   * Coordinator tick timestamp (ms). Drives the BALL_HOLDER grace hysteresis
   * (playtest round 2 anti-jitter). Optional for legacy call sites: without
   * it the FSM reverts instantly on possession loss (no hysteresis).
   */
  nowMs?: number;
  /**
   * Carrier feel (fase 4): opponent snapshots, provided by the coordinator at
   * its regular tick so the ball holder can derive the pressure metric,
   * lane-clear check and curved approach without any per-frame O(n^2).
   */
  opponents?: EntitySnapshot[];
  /**
   * Phase 2 closure: same-team snapshots (including self) for AI pass-target
   * selection (choosePassTarget cone, same gates as human passes) and off-ball
   * support spacing. Optional for legacy call sites: without it the holder
   * dribbles and attackers hold anchors (pre-closure behavior).
   */
  teammates?: EntitySnapshot[];
  /**
   * Batch B1 (tactics presets): coordinator-provided support-push override
   * (px) for this tick. Absent = the AI group default (legacy behavior).
   */
  supportPushPx?: number;
  /**
   * Batch B1: false pins this player to its anchor even with team possession
   * (only ATTACKERS_COUNT join the attack). Absent = everyone supports.
   */
  supportEnabled?: boolean;
  /**
   * Batch C (visible help): id of the support-eligible teammate offering the
   * open lane this tick — it gets AI_LANE_OFFER_EXTRA_PUSH_PX on top of the
   * base push so the offer reads on screen. Absent = base support for all.
   */
  laneOfferId?: string;
  /**
   * Batch C (visible help): coordinator-computed clearly-best pass target
   * for the holder (inside HOLDER_LANE_RANGE with a clear HOLDER_LANE
   * corridor). When set the holder passes at once, bypassing the tendency
   * dice; legacy call sites without it keep tendency behavior.
   */
  forcedPassTarget?: { x: number; y: number };
  /**
   * Living movement batch: coordinator-set per-player turnover flags.
   * recoveryRun pins a defending non-presser to a goal-side recovery spot
   * (sprint pace); attackRun gives an attacker the extra forward break push.
   * Absent = legacy behavior (hold/track/support as usual).
   */
  recoveryRun?: boolean;
  attackRun?: boolean;
}
