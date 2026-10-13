import { BALANCE_CONFIG } from '../data/balance';
import type { ExitClassification, TeamSide } from './TouchTracker';

export interface TeamShape {
  x: number;
  y: number;
}

export interface PlacementTarget {
  team: TeamSide;
  index: number;
  x: number;
  y: number;
  /** Cosmetic tag for debugging/telemetry (e.g. 'kicker'). */
  role?: string;
}

export interface RestartPlacement {
  players: PlacementTarget[];
  ball: { x: number; y: number };
}

export interface RestartPlacementConfig {
  PITCH_WIDTH_PX: number;
  PITCH_HEIGHT_PX: number;
  THROW_IN_SUPPORT_COUNT: number;
  THROW_IN_SUPPORT_RADIUS_PX: number;
  CORNER_ARC_OFFSET_PX: number;
  CORNER_BOX_ATTACKERS: number;
  CORNER_BOX_DEFENDERS: number;
  GOAL_KICK_SPOT_X_PX: number;
}

export const RESTART_PLACEMENT_CONFIG: RestartPlacementConfig = {
  PITCH_WIDTH_PX: BALANCE_CONFIG.PHYSICS.PITCH_WIDTH,
  PITCH_HEIGHT_PX: BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT,
  THROW_IN_SUPPORT_COUNT: BALANCE_CONFIG.RESTART.THROW_IN_SUPPORT_COUNT,
  THROW_IN_SUPPORT_RADIUS_PX: BALANCE_CONFIG.RESTART.THROW_IN_SUPPORT_RADIUS_PX,
  CORNER_ARC_OFFSET_PX: BALANCE_CONFIG.RESTART.CORNER_ARC_OFFSET_PX,
  CORNER_BOX_ATTACKERS: BALANCE_CONFIG.RESTART.CORNER_BOX_ATTACKERS,
  CORNER_BOX_DEFENDERS: BALANCE_CONFIG.RESTART.CORNER_BOX_DEFENDERS,
  GOAL_KICK_SPOT_X_PX: BALANCE_CONFIG.RESTART.GOAL_KICK_SPOT_X_PX,
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** Index of the nearest player to a point; ties resolve to the lower index. */
function nearestIndex(shapes: TeamShape[], x: number, y: number, exclude: Set<number> = new Set()): number {
  let best = -1;
  let bestD = Infinity;
  shapes.forEach((s, i) => {
    if (exclude.has(i)) {
      return;
    }
    const d = (s.x - x) ** 2 + (s.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/**
 * THROW_IN (RULE-2 SHOULD clause): only the thrower + a bounded support
 * bubble move — everyone else stays frozen where play stopped. The thrower
 * stands exactly on the touchline exit point; support teammates step inward.
 */
export function throwInPlacement(
  exitPoint: { x: number; y: number },
  throwTeam: TeamSide,
  home: TeamShape[],
  away: TeamShape[],
  cfg: RestartPlacementConfig = RESTART_PLACEMENT_CONFIG,
): RestartPlacement {
  const shapes = throwTeam === 'home' ? home : away;
  const throwerIdx = nearestIndex(shapes, exitPoint.x, exitPoint.y);
  const inward = exitPoint.y <= cfg.PITCH_HEIGHT_PX / 2 ? 1 : -1; // toward field center

  const players: PlacementTarget[] = [
    { team: throwTeam, index: throwerIdx, x: exitPoint.x, y: exitPoint.y, role: 'thrower' },
  ];
  const exclude = new Set([throwerIdx]);
  for (let k = 1; k <= cfg.THROW_IN_SUPPORT_COUNT; k++) {
    const idx = nearestIndex(shapes, exitPoint.x, exitPoint.y, exclude);
    if (idx < 0) {
      break;
    }
    exclude.add(idx);
    const lateral = (k % 2 === 0 ? -1 : 1) * Math.ceil(k / 2) * cfg.THROW_IN_SUPPORT_RADIUS_PX * 0.6;
    players.push({
      team: throwTeam,
      index: idx,
      x: clamp(exitPoint.x + lateral, 0, cfg.PITCH_WIDTH_PX),
      y: clamp(exitPoint.y + inward * cfg.THROW_IN_SUPPORT_RADIUS_PX, 0, cfg.PITCH_HEIGHT_PX),
      role: 'support',
    });
  }
  return { players, ball: { x: exitPoint.x, y: exitPoint.y } };
}

/**
 * CORNER set-piece table (RULE-2 SHALL clause): kicker at the corner arc
 * inset, attackers zonal in the box, defenders zonal on the box edge.
 */
export function cornerPlacement(
  exit: Pick<ExitClassification, 'side' | 'exitPoint'>,
  attackTeam: TeamSide,
  home: TeamShape[],
  away: TeamShape[],
  cfg: RestartPlacementConfig = RESTART_PLACEMENT_CONFIG,
): RestartPlacement {
  const arc = cfg.CORNER_ARC_OFFSET_PX;
  const w = cfg.PITCH_WIDTH_PX;
  const h = cfg.PITCH_HEIGHT_PX;
  const leftCorner = exit.side === 'left';
  const topCorner = exit.exitPoint.y <= h / 2;
  const cornerX = leftCorner ? arc : w - arc;
  const cornerY = topCorner ? arc : h - arc;

  const attackShapes = attackTeam === 'home' ? home : away;
  const defenseShapes = attackTeam === 'home' ? away : home;
  const defenseTeam: TeamSide = attackTeam === 'home' ? 'away' : 'home';

  const players: PlacementTarget[] = [];
  const kickerIdx = nearestIndex(attackShapes, cornerX, cornerY);
  players.push({ team: attackTeam, index: kickerIdx, x: cornerX, y: cornerY, role: 'kicker' });

  // Box zone in front of the defending goal on this byline.
  const boxX = leftCorner ? 60 : w - 60;
  const edgeX = leftCorner ? 120 : w - 120;
  const rowOffsets = [-40, 0, 40];
  const excludeAtk = new Set([kickerIdx]);
  for (let k = 0; k < cfg.CORNER_BOX_ATTACKERS; k++) {
    const idx = nearestIndex(attackShapes, boxX, h / 2 + rowOffsets[k % rowOffsets.length], excludeAtk);
    if (idx < 0) {
      break;
    }
    excludeAtk.add(idx);
    players.push({ team: attackTeam, index: idx, x: clamp(boxX, 0, w), y: clamp(h / 2 + rowOffsets[k % rowOffsets.length], 0, h), role: 'box-attack' });
  }
  const excludeDef = new Set<number>();
  for (let k = 0; k < cfg.CORNER_BOX_DEFENDERS; k++) {
    const idx = nearestIndex(defenseShapes, edgeX, h / 2 + rowOffsets[k % rowOffsets.length], excludeDef);
    if (idx < 0) {
      break;
    }
    excludeDef.add(idx);
    players.push({ team: defenseTeam, index: idx, x: clamp(edgeX, 0, w), y: clamp(h / 2 + rowOffsets[k % rowOffsets.length], 0, h), role: 'box-defense' });
  }
  return { players, ball: { x: cornerX, y: cornerY } };
}

/** GOAL_KICK: GK (index 0) at own goal center, ball on the 6yd spot. */
export function goalKickPlacement(
  exit: Pick<ExitClassification, 'side'>,
  defenseTeam: TeamSide,
  home: TeamShape[],
  away: TeamShape[],
  cfg: RestartPlacementConfig = RESTART_PLACEMENT_CONFIG,
): RestartPlacement {
  void home;
  void away;
  const w = cfg.PITCH_WIDTH_PX;
  const h = cfg.PITCH_HEIGHT_PX;
  const leftGoal = exit.side === 'left';
  const gkX = leftGoal ? 20 : w - 20;
  const spotX = leftGoal ? cfg.GOAL_KICK_SPOT_X_PX : w - cfg.GOAL_KICK_SPOT_X_PX;
  return {
    players: [{ team: defenseTeam, index: 0, x: gkX, y: h / 2, role: 'gk' }],
    ball: { x: spotX, y: h / 2 },
  };
}

/**
 * FREE_KICK / PENALTY — documented stubs only (spec: "Out of Scope").
 * States exist in MatchState; placement ships in a later slice.
 */
export function freeKickPlacement(): never {
  throw new Error('FREE_KICK placement: documented stub — out of MVP scope (spec Out of Scope)');
}
export function penaltyPlacement(): never {
  throw new Error('PENALTY placement: documented stub — out of MVP scope (spec Out of Scope)');
}
