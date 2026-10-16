import type { FormationId } from '../data/formations';
import { BALANCE_CONFIG } from '../data/balance';
import { MatchStatsTracker } from '../match/MatchStats';
import { otherTeam, TouchTracker, type ExitClassification, type TeamSide } from '../match/TouchTracker';
import {
  RESTART_PLACEMENT_CONFIG,
  cornerPlacement,
  freeKickPlacement,
  goalKickPlacement,
  kickoffAnchors,
  penaltyPlacement,
  throwInPlacement,
  type RestartPlacement,
  type TeamShape,
} from '../match/restartPlacement';
import {
  awardForFoul,
  type FoulAward,
} from '../match/foulRule';
import type { Ball } from '../entities/Ball';
import type { Player } from '../entities/Player';

export type MatchState =
  | 'BOOT'
  | 'INTRO'
  | 'KICKOFF'
  | 'PLAYING'
  | 'STOPPAGE'
  | 'THROW_IN'
  | 'GOAL_KICK'
  | 'CORNER'
  | 'FREE_KICK'
  | 'PENALTY'
  | 'GOAL'
  | 'OUT_OF_BOUNDS'
  | 'HALF'
  | 'FULL_TIME'
  | 'RESULTS'
  /** Deprecated Batch B1 alias: kept for legacy call sites, never entered. */
  | 'GAME_OVER';

export interface MatchFormations {
  home: FormationId;
  away: FormationId;
}

/** CONF-1: match clock constants injected, defaulting to BALANCE_CONFIG.MATCH. */
export interface MatchClockConfig {
  TIME_REMAINING_GAME_SECONDS: number;
  GAME_TIME_SCALE: number;
  KICKOFF_PAUSE_MS: number;
  GOAL_PAUSE_MS: number;
  OUT_OF_BOUNDS_PAUSE_MS: number;
  /**
   * Batch 5 (D+E): halftime breather in ms. Optional so legacy custom clocks
   * (short test clocks built before halftime existed) never enter HALF —
   * only clocks that opt in get the mid-match pause + side swap.
   */
  HALF_PAUSE_MS?: number;
  /**
   * Batch B1 (full time): whistle-to-panel pause between FULL_TIME and
   * RESULTS. Optional so legacy custom clocks advance via the BALANCE
   * default instead of stalling.
   */
  FULL_TIME_PAUSE_MS?: number;
  /**
   * Batch B2 (set pieces): safety resume when nobody takes the kick
   * (anti-soft-lock). Optional so legacy custom clocks fall back to BALANCE.
   */
  SET_PIECE_MAX_WAIT_MS?: number;
  /**
   * Batch A (player entrance): INTRO walk-in budget in ms + skip flag.
   * Optional so clocks that never call enterIntro() stay on KICKOFF.
   */
  INTRO_DURATION_MS?: number;
  INTRO_SKIPPABLE?: boolean;
}

interface PendingRestart {
  kind: 'THROW_IN' | 'CORNER' | 'GOAL_KICK';
  team: TeamSide;
  exit: ExitClassification;
}

/**
 * Referee state machine + match clock (AGENTS.md §7). Deterministic and
 * testable: kickoff/goal/reset timers flow from config through bind().
 * Teams are arrays placed at data-driven formation anchors (no hardcoded coords).
 *
 * RULE-1/RULE-2: boundary exits are classified by TouchTracker (last touch),
 * THROW_IN/CORNER/GOAL_KICK use contextual placement instead of full anchor
 * resets, and goals count exactly once via the goal latch.
 */
export class MatchManager {
  public state: MatchState = 'KICKOFF';
  public timeRemaining: number; // game seconds (CONF-1: clock from config)
  public score = { home: 0, away: 0 };
  public kickoffTimer: number;
  public resetTimer = 0;
  /** RULE-1: last-touch attribution, fed by kicks/possession captures. */
  public readonly touchTracker = new TouchTracker();
  /** Debug/telemetry: last restart award (kind + team) consumed at placement. */
  public lastRestartAward: { kind: string; team: TeamSide } | null = null;
  /**
   * Batch B2: last set-piece award with the designated kicker (team + squad
   * index carrying the placement 'kicker'/'shooter' role). The scene uses it
   * to hand control to the taker (home) or synthesize the AI kick (away).
   */
  public lastSetPiece: {
    kind: 'FREE_KICK' | 'PENALTY';
    team: TeamSide;
    kickerTeam: TeamSide;
    kickerIndex: number;
  } | null = null;
  /** Batch B2: match-time of the last foul award (cooldown, no Date.now). */
  private lastFoulAtMs = -Infinity;
  /** Batch B2: match-time elapsed in PLAYING (drives the foul cooldown). */
  private matchElapsedMs = 0;
  /**
   * Batch C (own-restart control): team that owns the next kickoff. Opens
   * with 'home'; every goal hands the restart to the conceding team. The
   * scene reads it on the KICKOFF -> PLAYING edge to hand control to the
   * nearest home teammate on own-team kickoffs only.
   */
  public kickoffTeam: TeamSide = 'home';

  private readonly clock: MatchClockConfig;
  private scene?: Phaser.Scene;
  private ball?: Ball;
  private homeTeam: Player[] = [];
  private awayTeam: Player[] = [];
  private formations: MatchFormations = { home: '11v11', away: '11v11' };
  /** RULE-2 double-goal guard: set on handleGoal, cleared on entering KICKOFF. */
  private goalLatch = false;
  private pendingRestart: PendingRestart | null = null;
  /** Batch 5 (D+E): halftime crosses once per match, then sides stay swapped. */
  private halftimeDone = false;
  public sidesSwapped = false;
  /** Batch A: per-team match stats (shots/passes/goals/possession) for the banner. */
  public readonly stats = new MatchStatsTracker();
  /** Batch A: INTRO walk-in countdown (armed by enterIntro). */
  public introTimer = 0;

  constructor(clock: MatchClockConfig = BALANCE_CONFIG.MATCH) {
    this.clock = { ...clock };
    this.timeRemaining = this.clock.TIME_REMAINING_GAME_SECONDS;
    this.kickoffTimer = this.clock.KICKOFF_PAUSE_MS;
  }

  public bind(
    scene: Phaser.Scene,
    ball: Ball,
    homeTeam: Player[],
    awayTeam: Player[],
    formations: MatchFormations,
  ): void {
    this.scene = scene;
    this.ball = ball;
    this.homeTeam = homeTeam;
    this.awayTeam = awayTeam;
    this.formations = formations;
  }

  public update(delta: number): void {
    // Batch A (INTRO): walk-in budget counts down, then kickoff spots.
    if (this.state === 'INTRO') {
      this.introTimer -= delta;
      if (this.introTimer <= 0) {
        this.completeIntro();
      }
      return;
    }

    // KICKOFF → PLAYING after the kickoff pause
    if (this.state === 'KICKOFF') {
      this.kickoffTimer -= delta;
      if (this.kickTimerExpired()) {
        this.state = 'PLAYING';
        this.kickoffTimer = this.clock.KICKOFF_PAUSE_MS;
      }
      return;
    }

    // PLAYING: clock at configured game-time scale (CONF-1), check events
    if (this.state === 'PLAYING') {
      const gameDeltaSec = (delta / 1000) * this.clock.GAME_TIME_SCALE;
      const prevRemaining = this.timeRemaining;
      this.timeRemaining = Math.max(0, this.timeRemaining - gameDeltaSec);
      this.matchElapsedMs += delta;
      // Batch 5 (D+E): crossing mid-duration pauses into HALF (clock stops).
      if (this.shouldEnterHalf(prevRemaining, this.timeRemaining)) {
        this.enterHalf();
        return;
      }
      if (this.timeRemaining <= 0) {
        this.enterFullTime();
        return;
      }

      if (this.ball && this.ball.sprite) {
        const bx = this.ball.sprite.x;
        const by = this.ball.sprite.y;
        const w = BALANCE_CONFIG.PHYSICS.PITCH_WIDTH;
        const h = BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT;

        // Out of bounds → classify exit + award via last touch (RULE-1)
        if (bx < 0 || bx > w || by < 0 || by > h) {
          this.handleBoundaryExit(bx, by);
          return;
        }
      }
      return;
    }

    // GOAL / OUT_OF_BOUNDS: pause, full anchor reset, back to KICKOFF
    if (this.state === 'GOAL' || this.state === 'OUT_OF_BOUNDS') {
      this.resetTimer -= delta;
      if (this.resetTimer <= 0) {
        this.resetMatch();
      }
      return;
    }

    // THROW_IN / GOAL_KICK / CORNER: pause, contextual placement, resume PLAYING
    if (
      this.state === 'THROW_IN' ||
      this.state === 'GOAL_KICK' ||
      this.state === 'CORNER'
    ) {
      this.resetTimer -= delta;
      if (this.resetTimer <= 0) {
        this.applyContextualRestart();
      }
      return;
    }

    // FREE_KICK / PENALTY (Batch B2): the clock is stopped and the match
    // resumes on the kick (scene calls notifySetPieceKick from the kick
    // path). The safety timer guarantees no soft-lock when nobody kicks.
    if (this.state === 'FREE_KICK' || this.state === 'PENALTY') {
      this.freezeEntities();
      this.resetTimer -= delta;
      if (this.resetTimer <= 0) {
        this.touchTracker.reset();
        this.pendingRestart = null;
        this.lastSetPiece = null;
        this.state = 'PLAYING';
      }
      return;
    }

    // HALF: clock stopped, players settle; countdown swaps sides + KICKOFF.
    if (this.state === 'HALF') {
      this.resetTimer -= delta;
      if (this.resetTimer <= 0) {
        this.beginSecondHalf();
      }
      return;
    }

    // FULL_TIME: final-whistle pause with a stopped clock, then RESULTS.
    if (this.state === 'FULL_TIME') {
      this.resetTimer -= delta;
      if (this.resetTimer <= 0) {
        this.state = 'RESULTS';
      }
      return;
    }

    // RESULTS + GAME_OVER (deprecated alias): terminal, nothing to do
  }

  /**
   * Batch 5 (D+E): halftime triggers exactly once, when the countdown crosses
   * the midpoint from above. Starting below the midpoint (short test clocks,
   * resumed saves) never triggers it.
   */
  private shouldEnterHalf(prevRemaining: number, nextRemaining: number): boolean {
    if (this.clock.HALF_PAUSE_MS === undefined || this.halftimeDone) {
      return false;
    }
    const halfPoint = this.clock.TIME_REMAINING_GAME_SECONDS / HALF_DIVISOR;
    return prevRemaining > halfPoint && nextRemaining <= halfPoint;
  }

  private enterHalf(): void {
    this.freezeEntities();
    this.state = 'HALF';
    this.resetTimer = this.clock.HALF_PAUSE_MS ?? 0;
  }

  /**
   * Batch B1 (full time, AGENTS.md section 7): the clock hits zero in PLAYING
   * and the match whistles into FULL_TIME with entities frozen; the update
   * loop advances FULL_TIME into the terminal RESULTS panel after the
   * configured pause. GAME_OVER stays in the union as a deprecated alias for
   * legacy call sites but is never entered naturally.
   */
  private enterFullTime(): void {
    this.freezeEntities();
    this.state = 'FULL_TIME';
    this.resetTimer = this.clock.FULL_TIME_PAUSE_MS ?? BALANCE_CONFIG.MATCH.FULL_TIME_PAUSE_MS;
  }

  /**
   * Batch A (player entrance): arm the INTRO walk-in. The scene places both
   * teams off-pitch and walks them to kickoff anchors; the manager advances
   * to KICKOFF on arrival (skipIntro), timeout (update), or not at all when
   * the clock never opts in (legacy behavior untouched).
   */
  public enterIntro(): void {
    this.freezeEntities();
    this.state = 'INTRO';
    this.introTimer = this.clock.INTRO_DURATION_MS ?? BALANCE_CONFIG.MATCH.INTRO_DURATION_MS;
  }

  /** Batch A: any-key/tap skip for the entrance (config flag). */
  public skipIntro(): boolean {
    if (this.state !== 'INTRO') {
      return false;
    }
    const skippable = this.clock.INTRO_SKIPPABLE ?? BALANCE_CONFIG.MATCH.INTRO_SKIPPABLE;
    if (!skippable) {
      return false;
    }
    this.completeIntro();
    return true;
  }

  /** Batch A: entrance finished — snap to kickoff anchors, resume KICKOFF. */
  public completeIntro(): void {
    if (this.state !== 'INTRO') {
      return;
    }
    this.resetPositions();
    this.state = 'KICKOFF';
    this.kickoffTimer = this.clock.KICKOFF_PAUSE_MS;
    this.goalLatch = false;
    this.touchTracker.reset();
    this.pendingRestart = null;
    this.lastSetPiece = null;
  }

  /** Batch A: banner "Continuar" resumes the second half immediately. */
  public resumeSecondHalf(): void {
    if (this.state !== 'HALF') {
      return;
    }
    this.beginSecondHalf();
  }

  /** Batch A: banner "Reiniciar partido" — full reset back to INTRO. */
  public restartToIntro(): void {
    this.score = { home: 0, away: 0 };
    this.timeRemaining = this.clock.TIME_REMAINING_GAME_SECONDS;
    this.resetTimer = 0;
    this.goalLatch = false;
    this.touchTracker.reset();
    this.pendingRestart = null;
    this.lastSetPiece = null;
    this.lastFoulAtMs = -Infinity;
    this.matchElapsedMs = 0;
    this.kickoffTeam = 'home';
    this.halftimeDone = false;
    this.sidesSwapped = false;
    this.stats.reset();
    this.enterIntro();
  }

  /** Batch A: kick-path feeds (scene calls these when a kick is applied). */
  public recordShot(team: TeamSide): void {
    this.stats.recordShot(team);
  }

  public recordPass(team: TeamSide): void {
    this.stats.recordPass(team);
  }

  /** Batch A: possession feed (scene passes the holder's team + frame delta). */
  public addPossessionTime(team: TeamSide, deltaMs: number): void {
    this.stats.addPossession(team, deltaMs);
  }

  /** HALF countdown elapsed: exchange halves, mirror anchors, resume KICKOFF. */
  private beginSecondHalf(): void {
    this.halftimeDone = true;
    this.sidesSwapped = true;
    this.resetPositions();
    this.state = 'KICKOFF';
    this.kickoffTimer = this.clock.KICKOFF_PAUSE_MS;
    this.goalLatch = false;
    this.touchTracker.reset();
    this.pendingRestart = null;
    this.lastSetPiece = null;
  }

  /** Anchor side a team lines up on: exchanged after the halftime swap. */
  public anchorSideFor(team: TeamSide): TeamSide {
    if (!this.sidesSwapped) {
      return team;
    }
    return otherTeam(team);
  }

  /**
   * Horizontal attack direction: +1 attacks rightward, -1 leftward.
   * Home attacks right before the swap, left after it (away mirrored).
   */
  public attackDirection(team: TeamSide): 1 | -1 {
    const base: 1 | -1 = team === 'home' ? 1 : -1;
    if (!this.sidesSwapped) {
      return base;
    }
    return base === 1 ? -1 : 1;
  }

  /** Which team scores by putting the ball in a goal-mouth zone. */
  public scorerForGoal(goalSide: 'left' | 'right'): TeamSide {
    const homeAttacksRight = this.attackDirection('home') === 1;
    if (goalSide === 'right') {
      return homeAttacksRight ? 'home' : 'away';
    }
    return homeAttacksRight ? 'away' : 'home';
  }

  private kickTimerExpired(): boolean {
    return this.kickoffTimer <= 0;
  }

  public handleGoal(team: 'home' | 'away'): void {
    // RULE-2: a goal counts exactly once — only from PLAYING with a clear latch.
    if (this.state !== 'PLAYING' || this.goalLatch) {
      return;
    }
    this.goalLatch = true;
    if (team === 'home') {
      this.score.home += 1;
    } else {
      this.score.away += 1;
    }
    // Batch C: the conceding team owns the next kickoff.
    this.kickoffTeam = otherTeam(team);
    this.stats.recordGoal(team);

    this.freezeEntities();
    this.state = 'GOAL';
    this.resetTimer = this.clock.GOAL_PAUSE_MS;

    // VFX: ¡GOL!
    if (this.scene) {
      const txt = this.scene.add.text(480, 270, '¡GOL!', {
        fontFamily: 'monospace',
        fontSize: '64px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 6,
      }).setOrigin(0.5).setDepth(20);
      this.scene.tweens.add({
        targets: txt,
        scale: 1.2,
        alpha: 0,
        duration: 800,
        ease: 'Power2',
        onComplete: () => txt.destroy(),
      });
    }
  }

  /**
   * RULE-1 award matrix: touchline → THROW_IN to the opponent of the last
   * touch; byline → CORNER when defense (incl. GK save) touched last,
   * GOAL_KICK when the attacker touched last.
   */
  private handleBoundaryExit(bx: number, by: number): void {
    const exit = this.touchTracker.classifyExit(bx, by);
    if (!exit) {
      // Should be unreachable (guard above), but never soft-lock.
      this.freezeEntities();
      this.state = 'OUT_OF_BOUNDS';
      this.resetTimer = this.clock.OUT_OF_BOUNDS_PAUSE_MS;
      return;
    }

    const last = this.touchTracker.lastTouchTeam ?? 'home';
    let restart: PendingRestart;
    if (exit.line === 'touchline') {
      restart = { kind: 'THROW_IN', team: otherTeam(last), exit };
    } else {
      const defense: TeamSide = exit.side === 'left' ? 'home' : 'away';
      const isCorner = last === defense;
      restart = {
        kind: isCorner ? 'CORNER' : 'GOAL_KICK',
        team: isCorner ? otherTeam(defense) : defense,
        exit,
      };
    }

    this.pendingRestart = restart;
    this.lastRestartAward = { kind: restart.kind, team: restart.team };
    this.freezeEntities();
    this.state = restart.kind;
    this.resetTimer = this.clock.OUT_OF_BOUNDS_PAUSE_MS;
  }

  /**
   * Batch B2 (simple fouls): awards a foul committed by `foulingTeam` at
   * (x, y). Only valid from PLAYING and outside the cooldown window —
   * anything else returns null with no state change. A box foul by the
   * defense is a PENALTY, otherwise a FREE_KICK (see foulRule awardForFoul).
   * Placement applies immediately; the match then waits for the kick
   * (notifySetPieceKick) or the safety timeout. No cards, no walls.
   */
  public awardFoul(foulingTeam: TeamSide, x: number, y: number): FoulAward | null {
    if (this.state !== 'PLAYING') {
      return null;
    }
    if (this.matchElapsedMs - this.lastFoulAtMs < BALANCE_CONFIG.FOUL.COOLDOWN_MS) {
      return null;
    }
    this.lastFoulAtMs = this.matchElapsedMs;
    const award = awardForFoul({ x, y }, foulingTeam);
    const homeShapes = this.teamShapes(this.homeTeam);
    const awayShapes = this.teamShapes(this.awayTeam);

    let placement: RestartPlacement;
    if (award.kind === 'FREE_KICK') {
      placement = freeKickPlacement({ x, y }, award.team, homeShapes, awayShapes, RESTART_PLACEMENT_CONFIG);
    } else {
      placement = penaltyPlacement(award.team, homeShapes, awayShapes, RESTART_PLACEMENT_CONFIG);
    }
    for (const t of placement.players) {
      const p = (t.team === 'home' ? this.homeTeam : this.awayTeam)[t.index];
      p?.setPosition(t.x, t.y);
    }
    this.placeBall(placement.ball.x, placement.ball.y);
    this.freezeEntities();
    this.touchTracker.reset();
    this.pendingRestart = null;
    this.lastRestartAward = { kind: award.kind, team: award.team };
    const taker = placement.players.find((t) => t.role === 'kicker' || t.role === 'shooter');
    this.lastSetPiece = {
      kind: award.kind,
      team: award.team,
      kickerTeam: taker?.team ?? award.team,
      kickerIndex: taker?.index ?? 0,
    };
    this.state = award.kind;
    this.resetTimer = this.clock.SET_PIECE_MAX_WAIT_MS ?? BALANCE_CONFIG.FOUL.SET_PIECE_MAX_WAIT_MS;
    return award;
  }

  /**
   * Batch B2 (resume on kick): the scene calls this from the kick path after
   * applying a set-piece kick. Returns true when a set piece resumed.
   */
  public notifySetPieceKick(): boolean {
    if (this.state !== 'FREE_KICK' && this.state !== 'PENALTY') {
      return false;
    }
    this.lastSetPiece = null;
    this.pendingRestart = null;
    this.state = 'PLAYING';
    return true;
  }

  /** RULE-2: per-state placement (THROW_IN/CORNER/GOAL_KICK), then resume play. */
  private applyContextualRestart(): void {
    if (!this.pendingRestart) {
      this.resetMatch();
      return;
    }
    const r = this.pendingRestart;
    const homeShapes = this.teamShapes(this.homeTeam);
    const awayShapes = this.teamShapes(this.awayTeam);

    let placement: RestartPlacement;
    if (r.kind === 'THROW_IN') {
      placement = throwInPlacement(r.exit.exitPoint, r.team, homeShapes, awayShapes, RESTART_PLACEMENT_CONFIG);
    } else if (r.kind === 'CORNER') {
      placement = cornerPlacement(r.exit, r.team, homeShapes, awayShapes, RESTART_PLACEMENT_CONFIG);
    } else {
      placement = goalKickPlacement(r.exit, r.team, homeShapes, awayShapes, RESTART_PLACEMENT_CONFIG);
    }

    for (const t of placement.players) {
      const p = (t.team === 'home' ? this.homeTeam : this.awayTeam)[t.index];
      p?.setPosition(t.x, t.y);
    }
    this.placeBall(placement.ball.x, placement.ball.y);
    this.freezeEntities();
    this.touchTracker.reset();
    this.pendingRestart = null;
    this.state = 'PLAYING';
  }

  private teamShapes(team: Player[]): TeamShape[] {
    return team.map((p) => ({
      x: (p as any).sprite?.x ?? (p as any).x ?? 0,
      y: (p as any).sprite?.y ?? (p as any).y ?? 0,
    }));
  }

  private placeBall(x: number, y: number): void {
    const b = this.ball as any;
    if (!b) {
      return;
    }
    if (b.sprite?.setPosition) {
      b.sprite.setPosition(x, y);
    }
    if (typeof b.z === 'number') {
      b.z = 0;
    }
    if (typeof b.vz === 'number') {
      b.vz = 0;
    }
    if (typeof b.zTarget === 'number') {
      b.zTarget = 0;
    }
  }

  private freezeEntities(): void {
    if (this.ball?.body) {
      this.ball.body.setVelocity(0, 0);
    }
    for (const p of this.homeTeam) {
      p.body?.setVelocity(0, 0);
    }
    for (const p of this.awayTeam) {
      p.body?.setVelocity(0, 0);
    }
  }

  /**
   * Places every player at its own-half kickoff anchor (data-driven, no
   * hardcoded coords). After the halftime swap each team uses the mirrored
   * anchor side.
   */
  private resetPositions(): void {
    if (this.ball?.reset) {
      this.ball.reset();
    }
    const homeAnchors = kickoffAnchors(this.formations.home, this.anchorSideFor('home'));
    const awayAnchors = kickoffAnchors(this.formations.away, this.anchorSideFor('away'));
    this.homeTeam.forEach((p, i) => {
      const a = homeAnchors[i];
      if (a) {
        p.setPosition(a.x, a.y);
      }
    });
    this.awayTeam.forEach((p, i) => {
      const a = awayAnchors[i];
      if (a) {
        p.setPosition(a.x, a.y);
      }
    });
    this.freezeEntities();
  }

  private resetMatch(): void {
    this.resetPositions();
    this.state = 'KICKOFF';
    this.kickoffTimer = this.clock.KICKOFF_PAUSE_MS;
    this.goalLatch = false;
    this.touchTracker.reset();
    this.pendingRestart = null;
    this.lastSetPiece = null;
  }

  public restart(): void {
    // RULE-2: restart input during a GOAL celebration is ignored until KICKOFF.
    if (this.state === 'GOAL') {
      return;
    }
    this.score = { home: 0, away: 0 };
    this.timeRemaining = this.clock.TIME_REMAINING_GAME_SECONDS;
    this.resetTimer = 0;
    this.state = 'KICKOFF';
    this.kickoffTimer = this.clock.KICKOFF_PAUSE_MS;
    this.goalLatch = false;
    this.touchTracker.reset();
    this.pendingRestart = null;
    this.lastSetPiece = null;
    this.lastFoulAtMs = -Infinity;
    this.matchElapsedMs = 0;
    this.kickoffTeam = 'home';
    this.halftimeDone = false;
    this.sidesSwapped = false;
    this.stats.reset();
    this.resetPositions();
  }

  public getTime(): number {
    return this.timeRemaining;
  }
}

/** Halving divisor for the mid-duration halftime point (arithmetic, not tuning). */
const HALF_DIVISOR = 2;
