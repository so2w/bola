/**
 * TODO: MatchManager — implement in a later change per AGENTS.md Subsystem 4
 * (Match Engine & Game Loop Manager).
 *
 * Planned responsibilities (NOT implemented in Paso 1):
 * - Global referee state machine: KICKOFF -> PLAYING -> GOAL -> OUT_OF_BOUNDS -> GAME_OVER.
 * - Match clock: 3 real minutes (1 real second = 3 game seconds).
 * - Goal detection areas, score tracking, "GOAL!" effect, kickoff repositioning.
 */
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

export class MatchManager {
  public state: MatchState = 'KICKOFF';
  public timeRemaining = 540; // game seconds: 3 real minutes *3
  public score = { home: 0, away: 0 };
  public kickoffTimer = 1500;
  public resetTimer = 0;

  private scene?: Phaser.Scene;
  private ball?: any;
  private homePlayer?: any;
  private awayPlayer?: any;

  constructor() {}

  public bind(scene: Phaser.Scene, ball: any, homePlayer: any, awayPlayer: any): void {
    this.scene = scene;
    this.ball = ball;
    this.homePlayer = homePlayer;
    this.awayPlayer = awayPlayer;
  }

  public update(delta: number): void {
    // KICKOFF → PLAYING after 1.5s
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
    if (this.homePlayer?.body) {
      this.homePlayer.body.setVelocity(0, 0);
    }
    if (this.awayPlayer?.body) {
      this.awayPlayer.body.setVelocity(0, 0);
    }
  }

  private resetMatch(): void {
    if (this.ball?.reset) {
      this.ball.reset();
    }
    if (this.homePlayer?.setPosition) {
      this.homePlayer.setPosition(560, 270);
    }
    if (this.awayPlayer?.setPosition) {
      this.awayPlayer.setPosition(400, 270);
    }
    this.freezeEntities();

    this.state = 'KICKOFF';
    this.kickoffTimer = 1500;
  }

  public restart(): void {
    this.score = { home: 0, away: 0 };
    this.timeRemaining = 540;
    this.resetTimer = 0;
    this.state = 'KICKOFF';
    this.kickoffTimer = 1500;

    if (this.ball?.reset) {
      this.ball.reset();
    }
    if (this.homePlayer?.setPosition) {
      this.homePlayer.setPosition(560, 270);
    }
    if (this.awayPlayer?.setPosition) {
      this.awayPlayer.setPosition(400, 270);
    }
    this.freezeEntities();
  }

  public getTime(): number {
    return this.timeRemaining;
  }
}
