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
}
