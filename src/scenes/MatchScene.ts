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
import { AudioDirector } from '../audio/AudioDirector';
import { PowerMeterHud } from '../ui/PowerMeterHud';
import { pinHudObject, zoomForFormation } from '../ui/hudPin';
import { shouldShowControlsHint } from '../ui/controlsHint';
import { BALANCE_CONFIG } from '../data/balance';
import { buildFrameMap } from '../entities/frameMap';
import { GoalFeedback } from '../match/GoalFeedback';
import { anchorCoords, resolveFormation, type FormationId } from '../data/formations';
import { aimsIntoOwnHalf, applyKickoffGracePowerCap, canApplyKick, gateKickCommand, isKickoffGraceActive, kickHasBall } from '../match/kickGate';
import { BallCaptureSystem } from '../match/BallCaptureSystem';
import { resolveMatchFormations, type MatchSceneInitData } from '../match/resolveFormations';
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
  /** Active per-formation camera zoom (HUD pinning uses the same value). */
  private cameraZoom = 1;
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
  private formations: { home: FormationId; away: FormationId } = { home: '3v3', away: '3v3' };
  /** Player → (team, id) for last-touch attribution feeds (RULE-1). */
  private playerMeta = new Map<Player, { team: 'home' | 'away'; id: string }>();
  private lastTouchPossessorId: string | null = null;
  /** Scoring side of the last GOAL — picks which net flash pulses. */
  private lastScoringSide: 'home' | 'away' = 'home';
  /** PRES-2: match event audio with graceful missing-asset fallback. */
  private audio?: AudioDirector;
  /** PM-1: charge power meter, fixed bottom-center HUD slot. */
  private powerMeter?: PowerMeterHud;
  /** Previous MatchManager state — drives WHISTLE/GOAL transition events. */
  private prevMatchState?: string;
  /** PRES-2: PASS vs KICK hint set by handleAIKick, consumed by wireShots. */
  private pendingShotKind = new Map<Player, 'KICK' | 'PASS'>();

  /** MF-1/MF-2: goal-mouth feedback guards (POST once per shot, cheer once per goal). */
  private goalFeedback = new GoalFeedback();
  /** MF-2: net flash overlays for each goal side, hidden at rest. */
  private netFlash: { home: Phaser.GameObjects.Rectangle; away: Phaser.GameObjects.Rectangle } | null = null;
  /** Playtest round 2: scene clock + last PLAYING-resume timestamp (kickoff grace). */
  private currentTimeMs = 0;
  private playResumedAtMs: number | null = null;
  /** Playtest round 3: first PLAYING transition (controls-hint window). */
  private firstPlayStartedAtMs: number | null = null;
  /** Playtest round 3: bottom-center controls hint (KICKOFF + first 15s). */
  private controlsHintText!: Phaser.GameObjects.Text;
  /** Playtest round 3: physical ball interception (no ball-through-player). */
  private ballCapture?: BallCaptureSystem;
  /** Ball position at the end of the previous frame (interception segment). */
  private prevBallX = 480;
  private prevBallY = 270;

  constructor() {
    super('MatchScene');
  }

  /**
   * FORM-1: formations come from scene init data (formationHome/formationAway),
   * defaulted and validated BEFORE any entity spawns. Default is '3v3' to keep
   * Fase 2 gameplay unchanged until a later slice flips the default to '11v11'.
   */
  init(data?: MatchSceneInitData): void {
    this.formations = resolveMatchFormations(data);
  }

  create(): void {
    // Static pitch backdrop.
    this.add.image(480, 270, 'pitch');

    // World bounds for Arcade physics
    this.physics.world.setBounds(0, 0, 960, 540);

    // Ball
    this.ball = new Ball(this, 480, 270);

    // Teams placed at data-driven formation anchors (parametric FormationId)
    const homeCoords = anchorCoords(resolveFormation(this.formations.home), 'home', 960, 540);
    const awayCoords = anchorCoords(resolveFormation(this.formations.away), 'away', 960, 540);
    this.roles = {
      home: homeCoords.map((a) => a.role),
      away: awayCoords.map((a) => a.role),
    };

    // PA-1: manifest-driven frame registry (name -> sheet index) injected per team.
    // Cache key is 'manifest' (BootScene.preload); registry is the documented
    // fallback. Absent in headless test mocks -> Players use legacy frames.
    const manifest =
      (this.cache?.json?.get('manifest') as
        | { spritesheets: { players: { frames: string[] } } }
        | undefined) ??
      (this.registry?.get('manifest') as
        | { spritesheets: { players: { frames: string[] } } }
        | undefined);
    const frameMap = manifest ? buildFrameMap(manifest) : undefined;

    this.homeTeam = homeCoords.map((a) => new Player(this, a.x, a.y, { team: 'home', frames: frameMap }));
    // Away tint is applied INSIDE Player only as a fallback for missing away frames (PA-1-S2/S3).
    this.awayTeam = awayCoords.map((a) => new Player(this, a.x, a.y, { team: 'away', frames: frameMap }));

    this.homeByIndex = new Map(this.homeTeam.map((p, i) => [`home-${i}`, p]));
    this.awayByIndex = new Map(this.awayTeam.map((p, i) => [`away-${i}`, p]));
    this.playerMeta = new Map<Player, { team: 'home' | 'away'; id: string }>([
      ...[...this.homeByIndex].map(([id, p]) => [p, { team: 'home' as const, id }] as const),
      ...[...this.awayByIndex].map(([id, p]) => [p, { team: 'away' as const, id }] as const),
    ]);

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
    // MC-1/MC-2: injected match context — ball position + teammates (the
    // controlled player changes on selection swaps, so getTeammates is a closure).
    this.humanController.setContext({
      getBallPos: () => ({ x: this.ball.sprite.x, y: this.ball.sprite.y }),
      getTeammates: () =>
        this.homeTeam
          .filter((p) => p !== this.player)
          .map((p) => ({ x: p.sprite.x, y: p.sprite.y })),
      attackDir: 1,
    });
    this.player = this.homeTeam[this.homeTeam.length - 1];
    this.humanPlayerId = null;

    // Systems
    this.manager = new MatchManager();
    this.manager.bind(this, this.ball, this.homeTeam, this.awayTeam, this.formations);
    // PRES-1: config-driven camera (zoom fixed at create, clamp to pitch bounds).
    // Playtest fix: zoom is per-formation (3v3 plays closer than 11v11) so the
    // pitch never fills the whole viewport and characters stay readable.
    const camCfg = BALANCE_CONFIG.CAMERA;
    this.cameraZoom = zoomForFormation(this.formations.home);
    this.cameraController = new CameraController(this.cameras.main, camCfg.LERP, camCfg.LOOK_AHEAD, {
      zoom: this.cameraZoom,
      playerWeight: camCfg.PLAYER_WEIGHT,
      ballWeight: camCfg.BALL_WEIGHT,
      clampMargin: camCfg.CLAMP_MARGIN,
      worldWidth: BALANCE_CONFIG.PHYSICS.PITCH_WIDTH,
      worldHeight: BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT,
    });
    // PRES-2: event-driven audio; assets are optional (skip + debug warn).
    this.audio = new AudioDirector({
      has: (key) => this.cache.audio.exists(key),
      play: (key, cfg) => this.sound.play(key, cfg),
    }, { debug: true });
    this.selectionSystem = new PlayerSelectionSystem();
    this.possession = new PossessionSystem();
    this.ballCapture = new BallCaptureSystem();
    this.coordinatorHome = new TeamCoordinator('home', resolveFormation(this.formations.home));
    this.coordinatorAway = new TeamCoordinator('away', resolveFormation(this.formations.away));

    // Scoring orientation: left zone = away scores, right zone = home scores
    this.leftGoal = this.add.zone(20, 270, 40, 140);
    this.rightGoal = this.add.zone(940, 270, 40, 140);
    this.physics.world.enable([this.leftGoal, this.rightGoal]);
    (this.leftGoal.body as Phaser.Physics.Arcade.Body).setImmovable(true);
    (this.rightGoal.body as Phaser.Physics.Arcade.Body).setImmovable(true);
    this.leftGoal.setVisible(false);
    this.rightGoal.setVisible(false);

    // MF-1: post bands sit just beyond the goal-mouth band (geometry from
    // BALANCE_CONFIG.FEEDBACK), one above and one below each goal zone.
    const FB = BALANCE_CONFIG.FEEDBACK;
    const bandOffset = FB.GOAL_MOUTH_HALF_HEIGHT_PX + FB.POST_BAND_HEIGHT_PX / 2;
    const postBands: Phaser.GameObjects.Zone[] = [];
    for (const goal of [
      { x: 20, side: 'left' as const },
      { x: 940, side: 'right' as const },
    ]) {
      for (const dir of [-1, 1]) {
        const band = this.add.zone(
          goal.x,
          FB.GOAL_MOUTH_CENTER_Y_PX + dir * bandOffset,
          40,
          FB.POST_BAND_HEIGHT_PX,
        );
        this.physics.world.enable(band);
        (band.body as Phaser.Physics.Arcade.Body).setImmovable(true);
        band.setVisible(false);
        postBands.push(band);
      }
    }
    for (const band of postBands) {
      this.physics.add.overlap(this.ball.sprite, band, () => {
        // MF-1-S2/S3 + MF-2-S2: POST fires once per shot, only while PLAYING.
        if (this.manager && this.goalFeedback.onPostBandOverlap(this.manager.state)) {
          this.audio?.playEvent('POST');
        }
      }, undefined, this);
    }

    // MF-2: cheap net flash — alpha-pulsed rectangle over each goal zone.
    this.netFlash = {
      // Net that flashes belongs to the conceding goal's side: a home GOAL is
      // scored in the right goal, an away GOAL in the left goal.
      home: this.add.rectangle(940, FB.GOAL_MOUTH_CENTER_Y_PX, 40, 140, 0xffffff, 0),
      away: this.add.rectangle(20, FB.GOAL_MOUTH_CENTER_Y_PX, 40, 140, 0xffffff, 0),
    };
    this.netFlash.home.setDepth(9).setVisible(false);
    this.netFlash.away.setDepth(9).setVisible(false);

    this.physics.add.overlap(this.ball.sprite, this.leftGoal, () => {
      if (this.manager?.state === 'PLAYING') {
        this.lastScoringSide = 'away';
        this.manager.handleGoal('away');
      }
    }, undefined, this);

    this.physics.add.overlap(this.ball.sprite, this.rightGoal, () => {
      if (this.manager?.state === 'PLAYING') {
        this.lastScoringSide = 'home';
        this.manager.handleGoal('home');
      }
    }, undefined, this);

    // HUD — pinned to the screen (scroll+zoom independent) at safe-margin slots:
    // clock top-left (24,24), score top-center, Cancel top-right (936,24).
    this.clockText = this.add.text(24, 24, '03:00', {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: '#ffffff',
    }).setDepth(10);

    this.scoreText = this.add.text(480, 24, '0 - 0', {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: '#ffffff',
    }).setOrigin(0.5, 0).setDepth(10);

    // Cancel button to show result overlay
    this.cancelButton = this.add.text(936, 24, 'Cancel', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#ffffff',
      backgroundColor: '#000000',
      padding: { left: 8, right: 8, top: 4, bottom: 4 },
    }).setOrigin(1, 0).setDepth(10).setInteractive();
    this.cancelButton.on('pointerdown', () => {
      // Result peek is a PLAYING-state affordance; at GAME_OVER the game-over
      // panel already shows the final score (verify WARNING-1 resolution).
      if (this.resultOverlayGroup && this.manager?.state === 'PLAYING') {
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

    // PM-1: meter visible only while the controlled player is charging
    // (created last so it never shifts existing container creation order).
    this.powerMeter = new PowerMeterHud(this);

    // Playtest round 3 (controls discoverability): static bottom-center hint.
    this.controlsHintText = this.add.text(480, 516, BALANCE_CONFIG.UI.CONTROLS_HINT_TEXT, {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffffff',
      backgroundColor: 'rgba(0,0,0,0.5)',
      padding: { left: 8, right: 8, top: 3, bottom: 3 },
    }).setOrigin(0.5, 1).setDepth(10);

    // HUD anti-zoom (playtest fix): at zoom 1.3-1.6 the old world-space HUD
    // text was pushed/clipped at screen edges. Everything HUD is pinned to
    // fixed screen slots, independent of camera scroll and zoom.
    const vw = this.cameras.main.width;
    const vh = this.cameras.main.height;
    pinHudObject(this.clockText, 24, 24, this.cameraZoom, vw, vh);
    pinHudObject(this.scoreText, 480, 24, this.cameraZoom, vw, vh);
    pinHudObject(this.cancelButton, 936, 24, this.cameraZoom, vw, vh);
    pinHudObject(this.gameOverGroup, 480, 270, this.cameraZoom, vw, vh);
    pinHudObject(this.resultOverlayGroup, 480, 270, this.cameraZoom, vw, vh);
    pinHudObject(this.controlsHintText, 480, 516, this.cameraZoom, vw, vh);
    this.powerMeter.pinToScreen(this.cameraZoom, vw, vh);
  }

  update(time: number, delta: number): void {
    this.currentTimeMs = time;
    // Manager update first
    if (this.manager) {
      const wasPlaying = this.manager.state === 'PLAYING';
      this.manager.update(delta);
      // Kickoff grace bookkeeping: remember every transition into PLAYING
      // (kickoff and restart resumes) so own-half kicks in the window fizzle.
      if (!wasPlaying && this.manager.state === 'PLAYING') {
        this.playResumedAtMs = time;
        if (this.firstPlayStartedAtMs === null) {
          this.firstPlayStartedAtMs = time;
        }
      }
      // PRES-2: state-transition audio (whistle at kick-in, goal sting on goal)
      if (this.prevMatchState === 'KICKOFF' && this.manager.state === 'PLAYING') {
        this.audio?.playEvent('WHISTLE');
      }
      // MF-1/MF-2 guarded events: CROWD_CHEER + net flash fire exactly once on
      // the PLAYING -> GOAL edge; post guard re-arms on every PLAYING resume.
      for (const event of this.goalFeedback.onStateTransition(this.prevMatchState, this.manager.state)) {
        if (event === 'CROWD_CHEER') {
          this.audio?.playEvent('GOAL');
          this.audio?.playEvent('CROWD_CHEER');
        } else {
          this.pulseNet(this.lastScoringSide);
        }
      }
      // Kick-gate hygiene on restart: any transition into KICKOFF drops stale
      // cached AI commands (e.g. a GK DISTRIBUTE requested while the ball sat
      // inside the goal during the GOAL freeze) and cancels an in-flight
      // human charge so nothing fires the moment PLAYING resumes.
      if (this.prevMatchState !== 'KICKOFF' && this.manager.state === 'KICKOFF') {
        for (const ai of this.aiControllers.values()) {
          ai.setCommand(undefined);
        }
        for (const ai of this.awayControllers.values()) {
          ai.setCommand(undefined);
        }
        this.player?.cancelCharge();
        this.pendingShotKind.clear();
      }
      this.prevMatchState = this.manager.state;
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
      const possessorId = this.possession.update(delta, [...homeSnaps, ...awaySnaps], ballSnap);
      // RULE-1: a capture counts as a touch
      if (possessorId && possessorId !== this.lastTouchPossessorId) {
        this.lastTouchPossessorId = possessorId;
        this.manager?.touchTracker.recordTouch(
          possessorId.startsWith('away') ? 'away' : 'home',
          possessorId,
          ballSnap.x,
          ballSnap.y,
        );
      } else if (!possessorId) {
        this.lastTouchPossessorId = null;
      }

      // Playtest round 3: physical interception. The ball may never cross a
      // player's body without an event — a body on the flight path traps the
      // ball (field players: slow balls only; GK: any speed in claim radius).
      // Runs BEFORE command application so a trapped ball never reaches a
      // goal zone in the same frame.
      if (
        this.ballCapture &&
        this.manager?.state === 'PLAYING' &&
        this.possession.possessorId === null
      ) {
        const ev = this.ballCapture.evaluate(
          [...homeSnaps, ...awaySnaps],
          { x: this.prevBallX, y: this.prevBallY, z: ballSnap.z, vx: ballSnap.vx, vy: ballSnap.vy },
          ballSnap,
        );
        if (ev) {
          this.ball.body.setVelocity(0, 0);
          this.ball.zTarget = 0;
          this.possession.setPossessor(ev.playerId);
        }
      }
      this.prevBallX = this.ball.sprite.x;
      this.prevBallY = this.ball.sprite.y;

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
        // A charge held across a stoppage never resumes: cancel it so the
        // next key release cannot fire a shot from a stale charge.
        controlled.cancelCharge();
        controlled.updateAnimation(delta);
      }
    }
    // Kit regression fix (playtest round 2): EVERY player animates, not only
    // the controlled one. Previously non-controlled players never received
    // updateAnimation(), so every AI/away sprite froze on the sheet creation
    // frame (index 0 = home-idle red) — both teams looked identical.
    for (const p of [...this.homeTeam, ...this.awayTeam]) {
      if (p !== controlled) {
        p.updateAnimation(delta);
      }
    }
    this.ball.preUpdate(time, delta);

    // PM-1: HUD reflects the controlled player's charge state.
    if (this.powerMeter && controlled) {
      this.powerMeter.update(controlled.getPower(), controlled.isChargingNow());
    }

    // PRES-1: per-frame camera follow (selected player + ball, config lerp,
    // look-ahead and pitch-edge clamp) — after entity preUpdate, before HUD.
    if (this.cameraController && controlled && this.ball) {
      this.cameraController.update(
        { x: controlled.sprite.x, y: controlled.sprite.y },
        { x: this.ball.sprite.x, y: this.ball.sprite.y },
        { x: this.ball.body.velocity.x, y: this.ball.body.velocity.y },
      );
    }

    // HUD update
    if (this.manager && this.clockText && this.scoreText) {
      const seconds = Math.max(0, Math.ceil(this.manager.getTime()));
      const minutes = Math.floor(seconds / 60);
      const secs = seconds % 60;
      const mmss = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      this.clockText.setText(mmss);
      this.scoreText.setText(`${this.manager.score.home} - ${this.manager.score.away}`);
      // Playtest round 3: controls hint visible at KICKOFF + first seconds.
      this.controlsHintText?.setVisible(
        shouldShowControlsHint(this.manager.state, this.firstPlayStartedAtMs, time),
      );
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

    // Result overlay score sync; auto-hide once the match ends so the
    // game-over panel (depth 30) is never stacked under a stale peek (depth 25)
    if (this.resultOverlayGroup && this.manager) {
      if (this.manager.state === 'GAME_OVER') {
        this.resultOverlayGroup.setVisible(false);
      } else {
        const roScoreText = (this.resultOverlayGroup as any).scoreText as Phaser.GameObjects.Text;
        if (roScoreText && this.resultOverlayGroup.visible) {
          roScoreText.setText(`${this.manager.score.home} - ${this.manager.score.away}`);
        }
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

  /**
   * AI kick dispatch: SHOOT/PASS/DISTRIBUTE trigger a guarded kick toward the
   * command target. Defense-in-depth (kickGate): the command is ignored unless
   * the match is PLAYING and the kicker is next to the ball — a stale command
   * surviving a restart can never send the center-spot ball flying into the
   * wrong half.
   */
  private handleAIKick(p: Player, cmd: AICommand): void {
    if (cmd.action !== 'SHOOT' && cmd.action !== 'PASS' && cmd.action !== 'DISTRIBUTE') {
      return;
    }
    // Kickoff grace (playtest round 2): an AI SHOOT aimed at the AI's own half
    // during the grace window after a resume is downgraded to a HOLD (no kick).
    const meta = this.playerMeta.get(p);
    const attackDir: 1 | -1 = meta?.team === 'away' ? -1 : 1;
    if (
      cmd.action === 'SHOOT' &&
      isKickoffGraceActive(this.playResumedAtMs, this.currentTimeMs) &&
      aimsIntoOwnHalf(attackDir, cmd.targetX - p.sprite.x)
    ) {
      return;
    }
    const facingVec = gateKickCommand(
      this.manager?.state,
      cmd,
      { x: p.sprite.x, y: p.sprite.y },
      { x: this.ball.sprite.x, y: this.ball.sprite.y },
    );
    if (!facingVec) {
      return;
    }
      // PRES-2: tag the shot kind so the shot sound is PASS vs KICK by command.
      this.pendingShotKind.set(p, cmd.action === 'PASS' ? 'PASS' : 'KICK');
    p.shootWithPower(cmd.power ?? 0.3, new Phaser.Math.Vector2(facingVec.x, facingVec.y));
  }

  /** MF-2: config-timed net flash pulse (alpha 0.6 -> 0, two cycles). */
  private pulseNet(side: 'home' | 'away'): void {
    const rect = this.netFlash?.[side];
    if (!rect) {
      return;
    }
    rect.setVisible(true);
    this.tweens.add({
      targets: rect,
      alpha: { from: 0.6, to: 0 },
      duration: BALANCE_CONFIG.FEEDBACK.NET_FLASH_MS / 2,
      yoyo: true,
      repeat: 1,
      onComplete: () => {
        rect.setVisible(false);
        rect.setAlpha(0);
      },
    });
  }

  private wireShots(p: Player): void {
    p.onShot((power, facing, cbKind) => {
      // Playtest remediation: a kick (AI or human key release) may move the
      // ball ONLY during live play. Human key listeners are event-driven and
      // bypass the per-frame canPlay gating, so the state check lives here.
      if (!canApplyKick(this.manager?.state)) {
        return;
      }
      // Defense in depth: HumanInputController already gates by pickup radius
      // (MC-2), but any path that reaches this callback without adjacency must
      // not be able to move the ball (same rule gateKickCommand applies to AI).
      if (!kickHasBall(p.sprite.x, p.sprite.y, this.ball.sprite.x, this.ball.sprite.y)) {
        return;
      }
      const meta = this.playerMeta.get(p);
      const attackDir: 1 | -1 = meta?.team === 'away' ? -1 : 1;
      // Kickoff grace (playtest round 2 "apenas hago el saque me hacen gol"):
      // the kickoff walk-up faces the kicker's OWN goal; a charged release in
      // the grace window with an own-half facing is suppressed (HOLD) instead
      // of firing a 600px/s own goal that no defender can reach.
      const kindEvent = this.pendingShotKind.get(p) ?? cbKind ?? 'KICK';
      if (
        kindEvent === 'KICK' &&
        isKickoffGraceActive(this.playResumedAtMs, this.currentTimeMs) &&
        aimsIntoOwnHalf(attackDir, facing.x)
      ) {
        return;
      }
      // RULE-1: the kicker touched the ball before it flew.
      if (meta) {
        this.manager?.touchTracker.recordTouch(meta.team, meta.id, p.sprite.x, p.sprite.y);
      }
      this.possession?.onKick();
      // MF-1: a new kick re-arms the once-per-shot POST guard.
      this.goalFeedback.onKick();
      // Playtest round 3 kickoff free-goal fix: during the grace window any
      // KICK is capped so the flight is always interceptable by field traps
      // or the GK — a single kickoff kick can no longer be an unstoppable goal.
      const effectivePower =
        kindEvent === 'KICK'
          ? applyKickoffGracePowerCap(power, this.playResumedAtMs, this.currentTimeMs)
          : power;
      this.ball.applyKick(facing, effectivePower);
      // PRES-2 + MC-1: PASS vs KICK hint (AI map or human contextual pass).
      this.pendingShotKind.delete(p);
      this.audio?.playEvent(kindEvent);
      if (effectivePower > 0.6) {
        const magnitude = Phaser.Math.Clamp(effectivePower * 0.02, 0.008, 0.02);
        this.cameras.main.shake(100, magnitude);
      }
    });
  }
}
