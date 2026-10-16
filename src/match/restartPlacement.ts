import { BALANCE_CONFIG } from '../data/balance';
import { anchorCoords, resolveFormation, type AnchorCoord, type FormationId } from '../data/formations';
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
  THROW_IN_INSET_PX: number;
  CORNER_ARC_OFFSET_PX: number;
  CORNER_BOX_ATTACKERS: number;
  CORNER_BOX_DEFENDERS: number;
  GOAL_KICK_SPOT_X_PX: number;
  /** Batch B2: free-kick support bubble + defender clearance (no wall). */
  FREE_KICK_SUPPORT_COUNT: number;
  FREE_KICK_SUPPORT_RADIUS_PX: number;
  FREE_KICK_DEFENDER_DISTANCE_PX: number;
  /** Batch B2: penalty spot offset, shooter offset, exclusion radius. */
  PENALTY_SPOT_OFFSET_PX: number;
  PENALTY_GK_LINE_OFFSET_PX: number;
  PENALTY_SHOOTER_OFFSET_PX: number;
  PENALTY_CLEAR_RADIUS_PX: number;
}

export const RESTART_PLACEMENT_CONFIG: RestartPlacementConfig = {
  PITCH_WIDTH_PX: BALANCE_CONFIG.PHYSICS.PITCH_WIDTH,
  PITCH_HEIGHT_PX: BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT,
  THROW_IN_SUPPORT_COUNT: BALANCE_CONFIG.RESTART.THROW_IN_SUPPORT_COUNT,
  THROW_IN_SUPPORT_RADIUS_PX: BALANCE_CONFIG.RESTART.THROW_IN_SUPPORT_RADIUS_PX,
  THROW_IN_INSET_PX: BALANCE_CONFIG.RESTART.THROW_IN_INSET_PX,
  CORNER_ARC_OFFSET_PX: BALANCE_CONFIG.RESTART.CORNER_ARC_OFFSET_PX,
  CORNER_BOX_ATTACKERS: BALANCE_CONFIG.RESTART.CORNER_BOX_ATTACKERS,
  CORNER_BOX_DEFENDERS: BALANCE_CONFIG.RESTART.CORNER_BOX_DEFENDERS,
  GOAL_KICK_SPOT_X_PX: BALANCE_CONFIG.RESTART.GOAL_KICK_SPOT_X_PX,
  FREE_KICK_SUPPORT_COUNT: BALANCE_CONFIG.FOUL.FREE_KICK_SUPPORT_COUNT,
  FREE_KICK_SUPPORT_RADIUS_PX: BALANCE_CONFIG.FOUL.FREE_KICK_SUPPORT_RADIUS_PX,
  FREE_KICK_DEFENDER_DISTANCE_PX: BALANCE_CONFIG.FOUL.FREE_KICK_DEFENDER_DISTANCE_PX,
  PENALTY_SPOT_OFFSET_PX: BALANCE_CONFIG.FOUL.PENALTY_SPOT_OFFSET_PX,
  PENALTY_GK_LINE_OFFSET_PX: BALANCE_CONFIG.FOUL.PENALTY_GK_LINE_OFFSET_PX,
  PENALTY_SHOOTER_OFFSET_PX: BALANCE_CONFIG.FOUL.PENALTY_SHOOTER_OFFSET_PX,
  PENALTY_CLEAR_RADIUS_PX: BALANCE_CONFIG.FOUL.PENALTY_CLEAR_RADIUS_PX,
};

export interface KickoffConfig {
  PITCH_WIDTH_PX: number;
  PITCH_HEIGHT_PX: number;
  KICKOFF_HALF_MARGIN_PX: number;
}

export const KICKOFF_PLACEMENT_CONFIG: KickoffConfig = {
  PITCH_WIDTH_PX: BALANCE_CONFIG.PHYSICS.PITCH_WIDTH,
  PITCH_HEIGHT_PX: BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT,
  KICKOFF_HALF_MARGIN_PX: BALANCE_CONFIG.RESTART.KICKOFF_HALF_MARGIN_PX,
};

/**
 * Batch 5 (kickoff placement): own-half formation anchors for a kickoff.
 * Raw data anchors describe an attacking shape — small-sided forwards sit
 * past midfield (3v3 FW at 0.62 * width). At every kickoff each team must
 * start on its OWN half, so any anchor crossing the halfway line clamps to
 * KICKOFF_HALF_MARGIN_PX on the team's own side. y is untouched.
 */
export function kickoffAnchors(
  formationId: FormationId,
  side: TeamSide,
  cfg: KickoffConfig = KICKOFF_PLACEMENT_CONFIG,
): AnchorCoord[] {
  const centerX = cfg.PITCH_WIDTH_PX / KICKOFF_HALF_DIVISOR;
  const anchors = anchorCoords(
    resolveFormation(formationId),
    side,
    cfg.PITCH_WIDTH_PX,
    cfg.PITCH_HEIGHT_PX,
  );
  return anchors.map((a) => {
    if (side === 'home') {
      return { ...a, x: Math.min(a.x, centerX - cfg.KICKOFF_HALF_MARGIN_PX) };
    }
    return { ...a, x: Math.max(a.x, centerX + cfg.KICKOFF_HALF_MARGIN_PX) };
  });
}

/** Halving divisor for the halfway line (arithmetic, not tuning). */
const KICKOFF_HALF_DIVISOR = 2;

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

/** Halving divisor for midfield comparisons (arithmetic, not tuning). */
const RESTART_HALF_DIVISOR = 2;

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
  const inward = exitPoint.y <= cfg.PITCH_HEIGHT_PX / RESTART_HALF_DIVISOR ? 1 : -1; // toward field center
  // Batch 5: the throw mark sits THROW_IN_INSET_PX inside the pitch so neither
  // the thrower (Arcade collideWorldBounds) nor the ball spawns on the line.
  const mark = {
    x: clamp(exitPoint.x, 0, cfg.PITCH_WIDTH_PX),
    y: clamp(exitPoint.y + inward * cfg.THROW_IN_INSET_PX, 0, cfg.PITCH_HEIGHT_PX),
  };

  const players: PlacementTarget[] = [
    { team: throwTeam, index: throwerIdx, x: mark.x, y: mark.y, role: 'thrower' },
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
      x: clamp(mark.x + lateral, 0, cfg.PITCH_WIDTH_PX),
      y: clamp(mark.y + inward * cfg.THROW_IN_SUPPORT_RADIUS_PX, 0, cfg.PITCH_HEIGHT_PX),
      role: 'support',
    });
  }
  return { players, ball: { x: mark.x, y: mark.y } };
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
 * FREE_KICK (Batch B2, arcade-minimal): ball at the spot, the nearest
 * attacker takes it, a bounded support bubble stages behind the ball, and
 * any defender inside FREE_KICK_DEFENDER_DISTANCE_PX is pushed radially out
 * to it. No walls, no multi-kicker routines — everyone else stays frozen.
 */
export function freeKickPlacement(
  spot: { x: number; y: number },
  attackTeam: TeamSide,
  home: TeamShape[],
  away: TeamShape[],
  cfg: RestartPlacementConfig = RESTART_PLACEMENT_CONFIG,
): RestartPlacement {
  const mark = {
    x: clamp(spot.x, 0, cfg.PITCH_WIDTH_PX),
    y: clamp(spot.y, 0, cfg.PITCH_HEIGHT_PX),
  };
  const attackShapes = attackTeam === 'home' ? home : away;
  const defenseShapes = attackTeam === 'home' ? away : home;
  const defenseTeam: TeamSide = attackTeam === 'home' ? 'away' : 'home';
  // Attack direction: home shoots right (+1), away shoots left (-1).
  const dir: 1 | -1 = attackTeam === 'home' ? 1 : -1;

  const players: PlacementTarget[] = [];
  const kickerIdx = nearestIndex(attackShapes, mark.x, mark.y);
  players.push({ team: attackTeam, index: kickerIdx, x: mark.x, y: mark.y, role: 'kicker' });

  // Support bubble: staged behind the ball toward the attackers' own half.
  const exclude = new Set([kickerIdx]);
  const r = cfg.FREE_KICK_SUPPORT_RADIUS_PX;
  for (let k = 0; k < cfg.FREE_KICK_SUPPORT_COUNT; k++) {
    const idx = nearestIndex(attackShapes, mark.x, mark.y, exclude);
    if (idx < 0) {
      break;
    }
    exclude.add(idx);
    const lateral = k === 0 ? r / SUPPORT_LATERAL_DIVISOR : -r / SUPPORT_LATERAL_DIVISOR;
    players.push({
      team: attackTeam,
      index: idx,
      x: clamp(mark.x - dir * r * SUPPORT_BEHIND_FACTOR, 0, cfg.PITCH_WIDTH_PX),
      y: clamp(mark.y + lateral, 0, cfg.PITCH_HEIGHT_PX),
      role: 'support',
    });
  }

  // Defenders too close to the spot back off radially to the clearance ring.
  defenseShapes.forEach((s, i) => {
    const d = Math.hypot(s.x - mark.x, s.y - mark.y);
    if (d < cfg.FREE_KICK_DEFENDER_DISTANCE_PX) {
      const out = pushOut(s.x, s.y, mark.x, mark.y, cfg.FREE_KICK_DEFENDER_DISTANCE_PX);
      players.push({
        team: defenseTeam,
        index: i,
        x: clamp(out.x, 0, cfg.PITCH_WIDTH_PX),
        y: clamp(out.y, 0, cfg.PITCH_HEIGHT_PX),
        role: 'set-piece',
      });
    }
  });
  return { players, ball: { x: mark.x, y: mark.y } };
}

/** Support-lateral divisor and behind factor (geometry fractions, not tuning). */
const SUPPORT_LATERAL_DIVISOR = 2;
const SUPPORT_BEHIND_FACTOR = 0.8;

/**
 * PENALTY (Batch B2, arcade-minimal): shooter vs GK from the spot, everyone
 * else cleared outside PENALTY_CLEAR_RADIUS_PX. The spot sits
 * PENALTY_SPOT_OFFSET_PX from the attacked goal line, centered; the GK (index
 * 0) holds the line; the shooter stands PENALTY_SHOOTER_OFFSET_PX behind the
 * ball toward midfield.
 */
export function penaltyPlacement(
  attackTeam: TeamSide,
  home: TeamShape[],
  away: TeamShape[],
  cfg: RestartPlacementConfig = RESTART_PLACEMENT_CONFIG,
): RestartPlacement {
  const attacksRight = attackTeam === 'home';
  const spot = {
    x: attacksRight ? cfg.PITCH_WIDTH_PX - cfg.PENALTY_SPOT_OFFSET_PX : cfg.PENALTY_SPOT_OFFSET_PX,
    y: cfg.PITCH_HEIGHT_PX / RESTART_HALF_DIVISOR,
  };
  const dir: 1 | -1 = attacksRight ? 1 : -1;
  const defenseTeam: TeamSide = attacksRight ? 'away' : 'home';
  const attackShapes = attackTeam === 'home' ? home : away;
  const defenseShapes = attackTeam === 'home' ? away : home;

  const players: PlacementTarget[] = [];
  const shooterIdx = nearestIndex(attackShapes, spot.x, spot.y);
  players.push({
    team: attackTeam,
    index: shooterIdx,
    x: clamp(spot.x - dir * cfg.PENALTY_SHOOTER_OFFSET_PX, 0, cfg.PITCH_WIDTH_PX),
    y: spot.y,
    role: 'shooter',
  });
  const gkX = attacksRight
    ? cfg.PITCH_WIDTH_PX - cfg.PENALTY_GK_LINE_OFFSET_PX
    : cfg.PENALTY_GK_LINE_OFFSET_PX;
  players.push({ team: defenseTeam, index: 0, x: gkX, y: spot.y, role: 'gk' });

  // Everyone else inside the exclusion ring steps radially out to it.
  const placed = new Set([`${attackTeam}:${shooterIdx}`, `${defenseTeam}:0`]);
  const clear = (team: TeamSide, shapes: TeamShape[]): void => {
    shapes.forEach((s, i) => {
      if (placed.has(`${team}:${i}`)) {
        return;
      }
      const d = Math.hypot(s.x - spot.x, s.y - spot.y);
      if (d < cfg.PENALTY_CLEAR_RADIUS_PX) {
        const out = pushOut(s.x, s.y, spot.x, spot.y, cfg.PENALTY_CLEAR_RADIUS_PX);
        players.push({
          team,
          index: i,
          x: clamp(out.x, 0, cfg.PITCH_WIDTH_PX),
          y: clamp(out.y, 0, cfg.PITCH_HEIGHT_PX),
          role: 'set-piece',
        });
      }
    });
  };
  clear(attackTeam, attackShapes);
  clear(defenseTeam, defenseShapes);
  return { players, ball: { x: spot.x, y: spot.y } };
}

/**
 * Radial push-out: point at exactly `radius` from (cx,cy) along the current
 * bearing. A body exactly on the center steps toward midfield horizontally.
 */
function pushOut(
  x: number,
  y: number,
  cx: number,
  cy: number,
  radius: number,
): { x: number; y: number } {
  const dx = x - cx;
  const dy = y - cy;
  const len = Math.hypot(dx, dy);
  if (len === 0) {
    return { x: cx - radius, y: cy };
  }
  return { x: cx + (dx / len) * radius, y: cy + (dy / len) * radius };
}
