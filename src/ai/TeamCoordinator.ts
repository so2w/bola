import { BALANCE_CONFIG, resolveTactics, type TacticsId } from '../data/balance';
import { anchorCoords, type FormationSlot } from '../data/formations';
import { PossessionSystem } from '../match/PossessionSystem';
import { FootballAI } from './FootballAI';
import { GoalkeeperAI, type GKState } from './GoalkeeperAI';
import { choosePassTarget } from '../input/passTarget';
import { mulberry32, type Rng } from '../utils/rng';
import type { AICommand, BallSnapshot, EntitySnapshot, TeamSide } from './commands';

/**
 * True when the segment from->to has no opponent inside the corridor
 * half-width (projection clamped to the segment, so bodies beyond the
 * receiver never block). Pure, deterministic, config-driven width.
 */
export function passSegmentIsClear(
  from: { x: number; y: number },
  to: { x: number; y: number },
  opponents: readonly EntitySnapshot[],
  corridorHalfWidthPx: number,
): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    return true;
  }
  const len = Math.sqrt(len2);
  for (const o of opponents) {
    const t = ((o.x - from.x) * dx + (o.y - from.y) * dy) / len2;
    if (t < 0 || t > 1) {
      continue;
    }
    const perp = Math.abs((o.x - from.x) * dy - (o.y - from.y) * dx) / len;
    if (perp <= corridorHalfWidthPx) {
      return false;
    }
  }
  return true;
}

/**
 * Living movement: ball-side block slide as a pure function of the ball
 * position (deterministic, unit-testable). The whole outfield block
 * translates toward the ball by its offset from pitch center scaled per
 * axis, clamped per axis so lines stay compact. Applied uniformly, so
 * relative shape is preserved by construction.
 */
export function blockShiftForBall(ball: { x: number; y: number }): { dx: number; dy: number } {
  const cfg = BALANCE_CONFIG.AI;
  const phys = BALANCE_CONFIG.PHYSICS;
  const rawX = (ball.x - phys.PITCH_WIDTH / 2) * cfg.AI_BLOCK_SHIFT_X_WEIGHT;
  const rawY = (ball.y - phys.PITCH_HEIGHT / 2) * cfg.AI_BLOCK_SHIFT_Y_WEIGHT;
  const dx = Math.max(-cfg.AI_BLOCK_SHIFT_MAX_X_PX, Math.min(cfg.AI_BLOCK_SHIFT_MAX_X_PX, rawX));
  const dy = Math.max(-cfg.AI_BLOCK_SHIFT_MAX_Y_PX, Math.min(cfg.AI_BLOCK_SHIFT_MAX_Y_PX, rawY));
  return { dx, dy };
}

/**
 * Living movement: DF goal-side rail (positioning only). A shifted defender
 * target never crosses to the attacking side of the ball — it clamps to a
 * config margin goal-side of it. Other roles pass through untouched.
 */
export function clampDefenderGoalSide(
  x: number,
  role: EntitySnapshot['role'],
  ballX: number,
  attackDir: 1 | -1,
): number {
  if (role !== 'DF') {
    return x;
  }
  const margin = BALANCE_CONFIG.AI.AI_BLOCK_SHIFT_GOAL_SIDE_MARGIN_PX;
  return attackDir === 1 ? Math.min(x, ballX - margin) : Math.max(x, ballX + margin);
}

/**
 * Team-level blackboard coordinator (AGENTS.md §11).
 *
 * - Field-player decisions run at the coordinator cadence (aiTickMs, ~150ms =
 *   6.7Hz); between ticks the SAME cached command instances are returned.
 * - Assigns at most PRESS_COUNT_MAX pressers (nearest, deterministic tie-break);
 *   the rest hold formation anchors.
 * - The GK is NOT ticked here: MatchScene calls tickGK(...) every frame
 *   (design 3.0 — dive reachability vs 600px/s shots requires per-frame
 *   evaluation; a 150ms cadence would eat the dive window).
 * - Snapshots must be built in the same order as formation anchors
 *   (positional correspondence snaps[i] ↔ anchors[i]).
 * - Deterministic: injected seeded RNG, no Math.random.
 */
export class TeamCoordinator {
  private lastTickMs = -Infinity;
  private readonly commands = new Map<string, AICommand>();
  private readonly fieldAIs = new Map<string, FootballAI>();
  private readonly gkAI = new GoalkeeperAI();
  private pressers: string[] = [];
  /** Batch 5 (D+E): after the halftime swap the team holds mirrored anchors. */
  private sidesSwapped = false;
  /** Batch B1 (tactics): active preset, default Equilibrada. */
  private tacticsId: TacticsId = BALANCE_CONFIG.TACTICS.DEFAULT;
  /**
   * Living movement: last tick's possession side for turnover detection
   * (null until the first tick establishes a baseline — no event fires).
   */
  private lastMyPossession: boolean | null = null;
  /** Living movement: active turnover kind + expiry of its run window. */
  private transitionKind: 'lost' | 'won' | null = null;
  private transitionUntilMs = -Infinity;

  constructor(
    private readonly teamId: TeamSide,
    private readonly formation: FormationSlot[],
    private readonly rng: Rng = mulberry32(BALANCE_CONFIG.RNG.DEFAULT_SEED),
  ) {}

  /** Called by the scene when MatchManager exchanges halves at halftime. */
  public setSidesSwapped(swapped: boolean): void {
    this.sidesSwapped = swapped;
  }

  /** Batch B1: switch the tactics preset (throws on unknown ids). */
  public setTactics(id: TacticsId): void {
    resolveTactics(id);
    this.tacticsId = id;
  }

  /** Phase 4 Batch A (section 30): current press assignment (debug display). */
  public getPresserIds(): readonly string[] {
    return this.pressers;
  }

  public getTactics(): TacticsId {
    return this.tacticsId;
  }

  public update(
    nowMs: number,
    snaps: EntitySnapshot[],
    ball: BallSnapshot,
    possession: PossessionSystem,
    opponents?: EntitySnapshot[],
    excludedIds?: Set<string> | string[],
  ): Map<string, AICommand> {
    if (nowMs - this.lastTickMs < BALANCE_CONFIG.AI.TICK_MS) {
      return this.commands; // cached, no recompute
    }
    this.lastTickMs = nowMs;
    this.tickInternal(nowMs, snaps, ball, possession, opponents, normalizeExcluded(excludedIds));
    return this.commands;
  }

  /**
   * Per-frame GK evaluation (design 3.0 CRITICAL): called every frame by
   * MatchScene, NEVER inside the coordinator cadence. Updates the GK entry in
   * the commands map (same Map instance returned by update()).
   */
  public tickGK(
    dtMs: number,
    gk: EntitySnapshot,
    ctx: { ball: BallSnapshot; teammates: EntitySnapshot[]; opponents: EntitySnapshot[]; attackDir: 1 | -1 },
  ): AICommand {
    const cmd = this.gkAI.tick(dtMs, gk, ctx);
    this.commands.set(gk.id, cmd);
    return cmd;
  }

  /**
   * Phase 4 Batch B (AGENTS.md sections 11 + 21): the live keeper FSM state.
   * MatchScene reads it every frame to pick the GK animation clip — the
   * keeper animates by its own state machine, never like a field player.
   */
  public gkState(): GKState {
    return this.gkAI.state;
  }

  /** Anchor side and attack direction follow the halftime swap. */
  private anchorSide(): TeamSide {
    if (!this.sidesSwapped) {
      return this.teamId;
    }
    return this.teamId === 'home' ? 'away' : 'home';
  }

  private attackDirection(): 1 | -1 {
    const base: 1 | -1 = this.teamId === 'home' ? 1 : -1;
    if (!this.sidesSwapped) {
      return base;
    }
    return base === 1 ? -1 : 1;
  }

  private tickInternal(
    nowMs: number,
    snaps: EntitySnapshot[],
    ball: BallSnapshot,
    possession: PossessionSystem,
    opponents?: EntitySnapshot[],
    excluded?: Set<string>,
  ): void {
    const cfg = BALANCE_CONFIG.AI;
    const tactics = resolveTactics(this.tacticsId);
    const pressMax = tactics.PRESS_COUNT_MAX;
    const excludedIds = excluded ?? EMPTY_EXCLUDED;

    // Possession update (pure, idempotent — MatchScene also updates per frame)
    const possessorId = possession.update(cfg.TICK_MS, snaps, ball);
    const possessor = possessorId !== null ? snaps.find((s) => s.id === possessorId) : undefined;
    const myTeamPossession = possessor !== undefined && possessor.team === this.teamId;

    // Press assignment: at most PRESS_COUNT_MAX nearest field players.
    // Playtest round 2 anti-jitter: existing pressers are sticky — a challenger
    // only replaces a presser when it is closer by MORE than
    // PRESS_SWITCH_MARGIN_PX, so two defenders walking side-by-side don't swap
    // PRESS <-> anchor targets (a 180° velocity flip) every 150ms tick.
    const anchors = anchorCoords(this.formation, this.anchorSide(), BALANCE_CONFIG.PHYSICS.PITCH_WIDTH, BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT);
    // Batch B1 (block height): outfield anchors shift along the attack axis
    // by the preset amount; the GK holds its line. Clamped to the pitch.
    const attackDir: 1 | -1 = this.attackDirection();
    // Living movement (ball-side block slide): the whole outfield block
    // translates toward the ball on top of the tactics shift — uniform, so
    // shape is preserved; DF targets additionally clamp goal-side of the
    // ball via the rail. The GK still holds its line.
    const block = blockShiftForBall(ball);
    const shifted = anchors.map((a, i) => {
      if (snaps[i]?.role === 'GK') {
        return a;
      }
      const sx = clampDefenderGoalSide(a.x + attackDir * tactics.BLOCK_SHIFT_PX + block.dx, snaps[i]?.role ?? 'MF', ball.x, attackDir);
      return {
        ...a,
        x: Math.max(0, Math.min(BALANCE_CONFIG.PHYSICS.PITCH_WIDTH, sx)),
        y: Math.max(
          0,
          Math.min(BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT, a.y + block.dy),
        ),
      };
    });
    // Batch B1 (numbers joining attack): only the ATTACKERS_COUNT most
    // advanced outfield players (by raw anchor nx) get support shifts.
    const rankedAttackers = anchors
      .map((a, i) => ({ i, nx: this.formation[i]?.nx ?? 0, gk: snaps[i]?.role === 'GK' }))
      .filter((e) => !e.gk)
      .sort((a, b) => (b.nx !== a.nx ? b.nx - a.nx : a.i - b.i))
      .slice(0, tactics.ATTACKERS_COUNT);
    const attackers = new Set(rankedAttackers.map((e) => snaps[e.i]?.id));
    if (myTeamPossession) {
      this.pressers = [];
    } else {
      const ranked = snaps
        .filter((s) => s.role !== 'GK' && !excludedIds.has(s.id))
        .map((s) => ({ id: s.id, d: Math.hypot(s.x - ball.x, s.y - ball.y) }))
        .sort((a, b) => (a.d !== b.d ? a.d - b.d : a.id.localeCompare(b.id)));
      const incumbents = ranked.filter((r) => this.pressers.includes(r.id));
      const next = incumbents.slice(0, pressMax);
      for (const cand of ranked) {
        if (next.length >= pressMax) {
          break;
        }
        if (!next.some((n) => n.id === cand.id)) {
          // Slot open (previous presser gone/GK/overflow): fill by distance.
          next.push(cand);
        }
      }
      // All slots filled: a challenger replaces the WORST incumbent only when
      // decisively closer (hysteresis); ties never swap.
      for (const cand of ranked) {
        if (next.some((n) => n.id === cand.id)) {
          continue;
        }
        const worst = next.reduce((w, n) => (n.d > w.d ? n : w), next[0]);
        if (worst && cand.d + cfg.PRESS_SWITCH_MARGIN_PX < worst.d) {
          next[next.indexOf(worst)] = cand;
        }
      }
      this.pressers = next.map((n) => n.id);
    }

    // Living movement (turnover runs): a possession flip opens a bounded
    // window — 'lost' sends the nearest non-pressers sprinting goal-side,
    // 'won' breaks the most advanced attackers in behind. Evaluated at the
    // coordinator cadence (no tick re-architecture); ids are recomputed from
    // the same snapshots every tick inside the window, so membership tracks
    // play instead of freezing on the turnover frame.
    if (this.lastMyPossession !== null && myTeamPossession !== this.lastMyPossession) {
      this.transitionKind = myTeamPossession ? 'won' : 'lost';
      this.transitionUntilMs =
        nowMs + (myTeamPossession ? cfg.AI_ATTACK_RUN_WINDOW_MS : cfg.AI_RECOVERY_WINDOW_MS);
    }
    this.lastMyPossession = myTeamPossession;
    const transitionActive = this.transitionKind !== null && nowMs <= this.transitionUntilMs;
    const recoveryIds = new Set<string>();
    if (transitionActive && this.transitionKind === 'lost') {
      const presserIds = new Set(this.pressers);
      const cands = snaps
        .filter((s) => s.role !== 'GK' && !presserIds.has(s.id) && !excludedIds.has(s.id))
        .map((s) => ({ id: s.id, d: (s.x - ball.x) * (s.x - ball.x) + (s.y - ball.y) * (s.y - ball.y) }))
        .sort((a, b) => (a.d !== b.d ? a.d - b.d : a.id.localeCompare(b.id)))
        .slice(0, cfg.AI_RECOVERY_COUNT);
      for (const c of cands) {
        recoveryIds.add(c.id);
      }
    }
    const attackRunIds = new Set<string>();
    if (transitionActive && this.transitionKind === 'won') {
      rankedAttackers
        .slice(0, cfg.AI_ATTACK_RUN_COUNT)
        .map((e) => snaps[e.i]?.id)
        .filter((id): id is string => id !== undefined && !excludedIds.has(id))
        .forEach((id) => attackRunIds.add(id));
    }

    // Batch C (visible help, shape preserved): with team possession the
    // closest OPEN support-eligible teammate offers a lane (extra push via
    // ctx.laneOfferId) and the holder fires at once down a clearly-best lane
    // (ctx.forcedPassTarget). Both derive from the same tick snapshots;
    // press discipline above is untouched.
    const laneOfferId = myTeamPossession
      ? pickLaneOffer(snaps, possessorId ?? null, ball, opponents ?? [], attackers, excludedIds)
      : undefined;
    const forcedPassTarget = myTeamPossession
      ? pickForcedPassTarget(snaps, possessorId ?? null, attackDir, opponents ?? [])
      : undefined;

    // Per-player FSM ticks (GK excluded — tickGK handles it per frame)
    snaps.forEach((snap, i) => {
      if (snap.role === 'GK') {
        return;
      }
      if (!this.fieldAIs.has(snap.id)) {
        this.fieldAIs.set(snap.id, new FootballAI(this.rng));
      }
      const ai = this.fieldAIs.get(snap.id) as FootballAI;
      const anchor = shifted[i];
      const cmd = ai.tick(snap, {
        ball,
        possessorId,
        myTeamPossession,
        anchorX: anchor.x,
        anchorY: anchor.y,
        pressers: this.pressers,
        attackDir,
        nowMs,
        opponents,
        teammates: snaps,
        supportPushPx: tactics.SUPPORT_PUSH_PX,
        supportEnabled: attackers.has(snap.id),
        laneOfferId,
        forcedPassTarget: snap.id === possessorId ? forcedPassTarget : undefined,
        recoveryRun: recoveryIds.has(snap.id),
        attackRun: attackRunIds.has(snap.id),
      });
      this.commands.set(snap.id, cmd);
    });
  }
}

/** Normalizes the optional press-exclusion list (human-controlled ids). */
function normalizeExcluded(excludedIds?: Set<string> | string[]): Set<string> {
  if (excludedIds instanceof Set) {
    return excludedIds;
  }
  return new Set(excludedIds ?? []);
}

/** Shared empty exclusion set (avoids per-tick allocation on legacy calls). */
const EMPTY_EXCLUDED: Set<string> = new Set();

/**
 * Batch C: closest open support-eligible teammate to the ball. Open = no
 * opponent inside AI_LANE_OPEN_RADIUS_PX. Excludes the holder, the GK (by
 * eligibility) and human-controlled ids (their command is ignored by the
 * scene, so the offer must go to a visible AI runner). Ties break by id.
 */
function pickLaneOffer(
  snaps: EntitySnapshot[],
  possessorId: string | null,
  ball: BallSnapshot,
  opponents: EntitySnapshot[],
  attackers: Set<string>,
  excludedIds: Set<string>,
): string | undefined {
  const cfg = BALANCE_CONFIG.AI;
  const r2 = cfg.AI_LANE_OPEN_RADIUS_PX * cfg.AI_LANE_OPEN_RADIUS_PX;
  let best: string | undefined;
  let bestD = Infinity;
  for (const s of snaps) {
    if (s.id === possessorId || !attackers.has(s.id) || excludedIds.has(s.id)) {
      continue;
    }
    let open = true;
    for (const o of opponents) {
      const dx = s.x - o.x;
      const dy = s.y - o.y;
      if (dx * dx + dy * dy < r2) {
        open = false;
        break;
      }
    }
    if (!open) {
      continue;
    }
    const d = (s.x - ball.x) ** 2 + (s.y - ball.y) ** 2;
    if (d < bestD || (d === bestD && (best === undefined || s.id < best))) {
      bestD = d;
      best = s.id;
    }
  }
  return best;
}

/**
 * Batch C: clearly-best lane for the holder — the forward-most in-cone
 * teammate (same gates as human passes) inside AI_HOLDER_LANE_RANGE_PX with
 * no opponent inside the AI_HOLDER_LANE_CORRIDOR_PX segment. Returns the
 * target point or undefined when the lane is not clearly best (caller falls
 * back to the tendency dice).
 */
function pickForcedPassTarget(
  snaps: EntitySnapshot[],
  possessorId: string | null,
  attackDir: 1 | -1,
  opponents: EntitySnapshot[],
): { x: number; y: number } | undefined {
  if (possessorId === null) {
    return undefined;
  }
  const holder = snaps.find((s) => s.id === possessorId);
  if (!holder) {
    return undefined;
  }
  const cfg = BALANCE_CONFIG.AI;
  const mates = snaps.filter((s) => s.team === holder.team && s.id !== holder.id);
  const target = choosePassTarget({ x: holder.x, y: holder.y }, mates, attackDir, BALANCE_CONFIG.INPUT);
  if (target === null) {
    return undefined;
  }
  if (Math.hypot(target.x - holder.x, target.y - holder.y) > cfg.AI_HOLDER_LANE_RANGE_PX) {
    return undefined;
  }
  if (!passSegmentIsClear({ x: holder.x, y: holder.y }, target, opponents, cfg.AI_HOLDER_LANE_CORRIDOR_PX)) {
    return undefined;
  }
  return target;
}
