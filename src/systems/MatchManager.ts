import type { FormationId } from '../data/formations';
import { FormationSystem } from '../match/FormationSystem';
import { BALANCE_CONFIG } from '../data/balance';
import { otherTeam, TouchTracker, type ExitClassification, type TeamSide } from '../match/TouchTracker';
import {
  RESTART_PLACEMENT_CONFIG,
  cornerPlacement,
  goalKickPlacement,
  throwInPlacement,
  type RestartPlacement,
  type TeamShape,
} from '../match/restartPlacement';
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

  private readonly clock: MatchClockConfig;
  private scene?: Phaser.Scene;
  private ball?: Ball;
  private homeTeam: Player[] = [];
  private awayTeam: Player[] = [];
  private formations: MatchFormations = { home: '3v3', away: '3v3' };
  /** RULE-2 double-goal guard: set on handleGoal, cleared on entering KICKOFF. */
  private goalLatch = false;
  private pendingRestart: PendingRestart | null = null;

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
      this.timeRemaining = Math.max(0, this.timeRemaining - gameDeltaSec);
      if (this.timeRemaining <= 0) {
        this.state = 'GAME_OVER';
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

    // GAME_OVER: nothing to do
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

  /** Places every player at its formation anchor (data-driven, no hardcoded coords). */
  private resetPositions(): void {
    if (this.ball?.reset) {
      this.ball.reset();
    }
    const homeAnchors = FormationSystem.anchors(this.formations.home, 'home');
    const awayAnchors = FormationSystem.anchors(this.formations.away, 'away');
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
    this.resetPositions();
  }

  public getTime(): number {
    return this.timeRemaining;
  }
}
