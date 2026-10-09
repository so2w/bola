import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { Ball } from '../entities/Ball';
import { MatchManager } from '../systems/MatchManager';
import { CameraController } from '../match/CameraController';
import { PlayerSelectionSystem } from '../match/PlayerSelectionSystem';
import { PossessionSystem } from '../match/PossessionSystem';
import { HumanInputController } from '../input/HumanInputController';
import { AIController } from '../input/AIController';
import { TeamCoordinator } from '../ai/TeamCoordinator';
import { FORMATIONS, anchorCoords } from '../data/formations';
import type { AICommand, BallSnapshot, EntitySnapshot } from '../ai/commands';

/** Frame index inside the players sheet = position in manifest.spritesheets.players.frames. */
const HOME_RUN_FRAME = 1;

/**
 * MatchScene — core gameplay wiring for Fase 2 (small-sided 3v3).
 * Renders pitch, builds both teams at data-driven formation anchors, wires
 * TeamCoordinators (150ms cadence + per-frame GK), possession, automatic
 * selection with controller swap, and per-frame locomotion from AI commands.
 */
export class MatchScene extends Phaser.Scene {
  private player!: Player;
  private ball!: Ball;
  private homeTeam: Player[] = [];
  private awayTeam: Player[] = [];
  private roles: { home: string[]; away: string[] } = { home: [], away: [] };
  private homeByIndex = new Map<string, Player>();
  private awayByIndex = new Map<string, Player>();
  private aiControllers = new Map<string, AIController>();
  private awayControllers = new Map<string, AIController>();
  private humanController?: HumanInputController;
  private humanPlayerId: string | null = null;
  private manager?: MatchManager;
  private cameraController?: CameraController;
  private selectionSystem?: PlayerSelectionSystem;
  private possession?: PossessionSystem;
  private coordinatorHome?: TeamCoordinator;
  private coordinatorAway?: TeamCoordinator;
  private clockText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private leftGoal!: Phaser.GameObjects.Zone;
  private rightGoal!: Phaser.GameObjects.Zone;
  private gameOverGroup!: Phaser.GameObjects.Container;
  private resultOverlayGroup!: Phaser.GameObjects.Container;
  private cancelButton?: Phaser.GameObjects.Text;

  constructor() {
    super('MatchScene');
  }

  create(): void {
    // Static pitch backdrop.
    this.add.image(480, 270, 'pitch');

    // World bounds for Arcade physics
    this.physics.world.setBounds(0, 0, 960, 540);

    // Ball
    this.ball = new Ball(this, 480, 270);

    // 3v3 teams placed at data-driven formation anchors
    const homeCoords = anchorCoords(FORMATIONS['3v3'], 'home', 960, 540);
    const awayCoords = anchorCoords(FORMATIONS['3v3'], 'away', 960, 540);
    this.roles = {
      home: homeCoords.map((a) => a.role),
      away: awayCoords.map((a) => a.role),
    };

    this.homeTeam = homeCoords.map((a) => new Player(this, a.x, a.y));
    this.awayTeam = awayCoords.map((a) => {
      const p = new Player(this, a.x, a.y);
      p.sprite.setTint(0x0000ff);
      return p;
    });

    this.homeByIndex = new Map(this.homeTeam.map((p, i) => [`home-${i}`, p]));
    this.awayByIndex = new Map(this.awayTeam.map((p, i) => [`away-${i}`, p]));

    // Controllers: every player gets an AIController with kick wiring
    for (const [id, p] of this.homeByIndex) {
      const ai = new AIController((cmd) => this.handleAIKick(p, cmd));
      p.attachController(ai);
      this.aiControllers.set(id, ai);
    }
    for (const [id, p] of this.awayByIndex) {
      const ai = new AIController((cmd) => this.handleAIKick(p, cmd));
      p.attachController(ai);
      this.awayControllers.set(id, ai);
    }

    // Human controller — attached when the selection system decides
    this.humanController = new HumanInputController();
    this.player = this.homeTeam[this.homeTeam.length - 1];
    this.humanPlayerId = null;

    // Systems
    this.manager = new MatchManager();
    this.manager.bind(this, this.ball, this.homeTeam, this.awayTeam, { home: '3v3', away: '3v3' });
    this.cameraController = new CameraController(this.cameras.main);
    this.selectionSystem = new PlayerSelectionSystem();
    this.possession = new PossessionSystem();
    this.coordinatorHome = new TeamCoordinator('home', FORMATIONS['3v3']);
    this.coordinatorAway = new TeamCoordinator('away', FORMATIONS['3v3']);

    // Scoring orientation: left zone = away scores, right zone = home scores
    this.leftGoal = this.add.zone(20, 270, 40, 140);
    this.rightGoal = this.add.zone(940, 270, 40, 140);
    this.physics.world.enable([this.leftGoal, this.rightGoal]);
    (this.leftGoal.body as Phaser.Physics.Arcade.Body).setImmovable(true);
    (this.rightGoal.body as Phaser.Physics.Arcade.Body).setImmovable(true);
    this.leftGoal.setVisible(false);
    this.rightGoal.setVisible(false);

    this.physics.add.overlap(this.ball.sprite, this.leftGoal, () => {
      if (this.manager?.state === 'PLAYING') {
        this.manager.handleGoal('away');
      }
    }, undefined, this);

    this.physics.add.overlap(this.ball.sprite, this.rightGoal, () => {
      if (this.manager?.state === 'PLAYING') {
        this.manager.handleGoal('home');
      }
    }, undefined, this);

    // HUD
    this.clockText = this.add.text(20, 20, '03:00', {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: '#ffffff',
    }).setDepth(10);

    this.scoreText = this.add.text(480, 20, '0 - 0', {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: '#ffffff',
    }).setOrigin(0.5, 0).setDepth(10);

    // Cancel button to show result overlay
    this.cancelButton = this.add.text(900, 20, 'Cancel', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#ffffff',
      backgroundColor: '#000000',
      padding: { left: 8, right: 8, top: 4, bottom: 4 },
    }).setOrigin(1, 0).setDepth(10).setInteractive();
    this.cancelButton.on('pointerdown', () => {
      if (this.resultOverlayGroup) {
        this.resultOverlayGroup.setVisible(!this.resultOverlayGroup.visible);
      }
    });

    // Game Over group
    this.gameOverGroup = this.add.container(480, 270).setDepth(30);
    const goBg = this.add.rectangle(0, 0, 600, 240, 0x000000, 0.7).setOrigin(0.5);
    const goTitle = this.add.text(0, -60, 'GAME OVER', {
      fontFamily: 'monospace',
      fontSize: '48px',
      color: '#ffffff',
    }).setOrigin(0.5);
    const goScore = this.add.text(0, 0, '0 - 0', {
      fontFamily: 'monospace',
      fontSize: '36px',
      color: '#ffffff',
    }).setOrigin(0.5);
    const goRestart = this.add.text(0, 60, 'Restart (R)', {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: '#ffff00',
      backgroundColor: '#000000',
      padding: { left: 12, right: 12, top: 6, bottom: 6 },
    }).setOrigin(0.5).setInteractive();
    goRestart.on('pointerdown', () => {
      this.manager?.restart();
      this.gameOverGroup.setVisible(false);
    });
    this.gameOverGroup.add([goBg, goTitle, goScore, goRestart]);
    this.gameOverGroup.setVisible(false);
    (this.gameOverGroup as any).scoreText = goScore;

    // Result overlay group
    this.resultOverlayGroup = this.add.container(480, 270).setDepth(25);
    const roBg = this.add.rectangle(0, 0, 400, 200, 0x000000, 0.8).setOrigin(0.5);
    const roTitle = this.add.text(0, -60, 'Resultado', {
      fontFamily: 'monospace',
      fontSize: '32px',
      color: '#ffffff',
    }).setOrigin(0.5);
    const roScore = this.add.text(0, 0, '0 - 0', {
      fontFamily: 'monospace',
      fontSize: '40px',
      color: '#ffffff',
    }).setOrigin(0.5);
    const roClose = this.add.text(0, 70, 'Cerrar', {
      fontFamily: 'monospace',
      fontSize: '22px',
      color: '#ffff00',
      backgroundColor: '#000000',
      padding: { left: 12, right: 12, top: 6, bottom: 6 },
    }).setOrigin(0.5).setInteractive();
    roClose.on('pointerdown', () => {
      this.resultOverlayGroup.setVisible(false);
    });
    this.resultOverlayGroup.add([roBg, roTitle, roScore, roClose]);
    this.resultOverlayGroup.setVisible(false);
    (this.resultOverlayGroup as any).scoreText = roScore;

    // R key listener for restart
    this.input.keyboard?.on('keydown-R', () => {
      if (this.manager?.state === 'GAME_OVER') {
        this.manager.restart();
        this.gameOverGroup.setVisible(false);
      }
    });

    // Wire shot events for every player
    for (const p of [...this.homeTeam, ...this.awayTeam]) {
      this.wireShots(p);
    }
  }

  update(time: number, delta: number): void {
    // Manager update first
    if (this.manager) {
      this.manager.update(delta);
    }

    const isPlaying = this.manager?.state === 'PLAYING';
    const resultOverlayVisible = this.resultOverlayGroup?.visible ?? false;
    const canPlay = isPlaying && !resultOverlayVisible;

    // Team AI: snapshots → coordinators → commands
    if (this.coordinatorHome && this.coordinatorAway && this.ball && this.possession) {
      const homeSnaps = this.buildSnaps(this.homeTeam, 'home');
      const awaySnaps = this.buildSnaps(this.awayTeam, 'away');
      const ballSnap = this.buildBallSnap();

      // Possession per frame (domain-only wiring; consumed by coordinators)
      this.possession.update(delta, [...homeSnaps, ...awaySnaps], ballSnap);

      const homeCmds = this.coordinatorHome.update(time, homeSnaps, ballSnap, this.possession);
      const awayCmds = this.coordinatorAway.update(time, awaySnaps, ballSnap, this.possession);

      // Per-frame GK evaluation (design 3.0: NEVER inside the 150ms cadence)
      const gkHome = homeSnaps.find((s) => s.role === 'GK');
      const gkAway = awaySnaps.find((s) => s.role === 'GK');
      if (gkHome) {
        this.coordinatorHome.tickGK(delta, gkHome, {
          ball: ballSnap,
          teammates: homeSnaps.filter((s) => s.role !== 'GK'),
          opponents: awaySnaps,
          attackDir: 1,
        });
      }
      if (gkAway) {
        this.coordinatorAway.tickGK(delta, gkAway, {
          ball: ballSnap,
          teammates: awaySnaps.filter((s) => s.role !== 'GK'),
          opponents: homeSnaps,
          attackDir: -1,
        });
      }

      // Automatic selection (human) — home field players only, GK excluded
      if (canPlay && this.selectionSystem) {
        const candidates = homeSnaps
          .filter((s) => s.role !== 'GK')
          .map((s) => ({ id: s.id, x: s.x, y: s.y, role: s.role }));
        const selectedId = this.selectionSystem.update(
          delta,
          candidates,
          { x: ballSnap.x, y: ballSnap.y },
          { x: ballSnap.vx, y: ballSnap.vy },
        );
        if (selectedId) {
          this.swapToHuman(selectedId);
        }
      }

      // Apply commands to AI controllers; selected human player is exempt
      if (canPlay) {
        for (const [id, ai] of this.aiControllers) {
          if (id !== this.humanPlayerId) {
            ai.setCommand(homeCmds.get(id));
          }
        }
        for (const [id, ai] of this.awayControllers) {
          ai.setCommand(awayCmds.get(id));
        }
      }
    }

    // Controllers update (human + AI locomotion) — gated when not playing
    const controlled = this.player;
    if (canPlay) {
      for (const p of this.homeTeam) {
        p.updateController(delta);
      }
      for (const p of this.awayTeam) {
        p.updateController(delta);
      }
    } else {
      for (const p of [...this.homeTeam, ...this.awayTeam]) {
        p.body.setVelocity(0, 0);
        p.body.setAcceleration(0, 0);
      }
      if (controlled) {
        controlled.body.setVelocity(0, 0);
        controlled.body.setAcceleration(0, 0);
      }
    }

    // Controlled player preUpdate (charge + animation)
    if (controlled) {
      if (canPlay) {
        controlled.preUpdate(time, delta);
      } else {
        controlled.updateAnimation();
      }
    }
    this.ball.preUpdate(time, delta);

    // HUD update
    if (this.manager && this.clockText && this.scoreText) {
      const seconds = Math.max(0, Math.ceil(this.manager.getTime()));
      const minutes = Math.floor(seconds / 60);
      const secs = seconds % 60;
      const mmss = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      this.clockText.setText(mmss);
      this.scoreText.setText(`${this.manager.score.home} - ${this.manager.score.away}`);
    }

    // Game Over overlay visibility and score sync
    if (this.manager && this.gameOverGroup) {
      const goScoreText = (this.gameOverGroup as any).scoreText as Phaser.GameObjects.Text;
      if (this.manager.state === 'GAME_OVER') {
        this.gameOverGroup.setVisible(true);
        if (goScoreText) {
          goScoreText.setText(`${this.manager.score.home} - ${this.manager.score.away}`);
        }
      } else {
        this.gameOverGroup.setVisible(false);
      }
    }

    // Result overlay score sync
    if (this.resultOverlayGroup && this.manager) {
      const roScoreText = (this.resultOverlayGroup as any).scoreText as Phaser.GameObjects.Text;
      if (roScoreText && this.resultOverlayGroup.visible) {
        roScoreText.setText(`${this.manager.score.home} - ${this.manager.score.away}`);
      }
    }
  }

  /** Builds entity snapshots in anchor order (TeamCoordinator contract). */
  private buildSnaps(team: Player[], side: 'home' | 'away'): EntitySnapshot[] {
    return team.map((p, i) => ({
      id: `${side}-${i}`,
      team: side,
      role: (this.roles[side][i] ?? 'FW') as EntitySnapshot['role'],
      x: p.sprite.x,
      y: p.sprite.y,
      vx: p.body.velocity.x,
      vy: p.body.velocity.y,
    }));
  }

  private buildBallSnap(): BallSnapshot {
    return {
      x: this.ball.sprite.x,
      y: this.ball.sprite.y,
      z: this.ball.z,
      vx: this.ball.body.velocity.x,
      vy: this.ball.body.velocity.y,
    };
  }

  /** Swaps the human controller onto the newly selected player (one controller per Player). */
  private swapToHuman(newId: string): void {
    if (this.humanPlayerId === newId || !this.humanController) {
      return;
    }
    // Previous human player back to AI
    if (this.humanPlayerId) {
      const old = this.homeByIndex.get(this.humanPlayerId);
      const oldAI = this.aiControllers.get(this.humanPlayerId);
      if (old && oldAI) {
        old.attachController(oldAI);
      }
    }
    const next = this.homeByIndex.get(newId);
    if (next) {
      next.attachController(this.humanController);
      this.player = next;
      this.humanPlayerId = newId;
    }
  }

  /** AI kick dispatch: SHOOT/PASS/DISTRIBUTE trigger a guarded kick toward the command target. */
  private handleAIKick(p: Player, cmd: AICommand): void {
    if (cmd.action !== 'SHOOT' && cmd.action !== 'PASS' && cmd.action !== 'DISTRIBUTE') {
      return;
    }
    const dx = cmd.targetX - p.sprite.x;
    const dy = cmd.targetY - p.sprite.y;
    const facing = new Phaser.Math.Vector2(dx, dy);
    if (facing.lengthSq() > 0) {
      facing.normalize();
    }
    p.shootWithPower(cmd.power ?? 0.3, facing);
  }

  private wireShots(p: Player): void {
    p.onShot((power, facing) => {
      this.possession?.onKick();
      this.ball.applyKick(facing, power);
      if (power > 0.6) {
        const magnitude = Phaser.Math.Clamp(power * 0.02, 0.008, 0.02);
        this.cameras.main.shake(100, magnitude);
      }
    });
  }
}
