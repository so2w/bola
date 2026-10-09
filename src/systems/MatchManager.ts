import type { FormationId } from '../data/formations';
import { FormationSystem } from '../match/FormationSystem';
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
  | 'GOAL'
  | 'OUT_OF_BOUNDS'
  | 'GAME_OVER';

export interface MatchFormations {
  home: FormationId;
  away: FormationId;
}

/**
 * Referee state machine + match clock (AGENTS.md §7). Deterministic and
 * testable: kickoff/goal/reset timers flow from config through bind().
 * Teams are arrays placed at data-driven formation anchors (no hardcoded coords).
 */
export class MatchManager {
  public state: MatchState = 'KICKOFF';
  public timeRemaining = 540; // game seconds: 3 real minutes * 3
  public score = { home: 0, away: 0 };
  public kickoffTimer = 1500;
  public resetTimer = 0;

  private scene?: Phaser.Scene;
  private ball?: Ball;
  private homeTeam: Player[] = [];
  private awayTeam: Player[] = [];
  private formations: MatchFormations = { home: '3v3', away: '3v3' };

  constructor() {}

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
        this.kickoffTimer = 1500;
      }
      return;
    }

    // PLAYING: clock 3x scale, check events
    if (this.state === 'PLAYING') {
      const gameDeltaSec = (delta / 1000) * 3;
      this.timeRemaining = Math.max(0, this.timeRemaining - gameDeltaSec);
      if (this.timeRemaining <= 0) {
        this.state = 'GAME_OVER';
        return;
      }

      if (this.ball && this.ball.sprite) {
        const bx = this.ball.sprite.x;
        const by = this.ball.sprite.y;

        // Out of bounds
        if (bx < 0 || bx > 960 || by < 0 || by > 540) {
          this.handleOutOfBounds();
          return;
        }
      }
      return;
    }

    // GOAL / OUT_OF_BOUNDS / THROW_IN / GOAL_KICK / CORNER: pause, countdown reset
    if (
      this.state === 'GOAL' ||
      this.state === 'OUT_OF_BOUNDS' ||
      this.state === 'THROW_IN' ||
      this.state === 'GOAL_KICK' ||
      this.state === 'CORNER'
    ) {
      this.resetTimer -= delta;
      if (this.resetTimer <= 0) {
        this.resetMatch();
      }
      return;
    }

    // GAME_OVER: nothing to do
  }

  private kickTimerExpired(): boolean {
    return this.kickoffTimer <= 0;
  }

  public handleGoal(team: 'home' | 'away'): void {
    if (team === 'home') {
      this.score.home += 1;
    } else {
      this.score.away += 1;
    }

    this.freezeEntities();
    this.state = 'GOAL';
    this.resetTimer = 2000;

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

  private handleOutOfBounds(): void {
    this.freezeEntities();
    this.state = 'OUT_OF_BOUNDS';
    this.resetTimer = 2000;
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
    this.kickoffTimer = 1500;
  }

  public restart(): void {
    this.score = { home: 0, away: 0 };
    this.timeRemaining = 540;
    this.resetTimer = 0;
    this.state = 'KICKOFF';
    this.kickoffTimer = 1500;
    this.resetPositions();
  }

  public getTime(): number {
    return this.timeRemaining;
  }
}
