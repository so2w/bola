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
}
