import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { Ball } from '../entities/Ball';
import { MatchManager } from '../systems/MatchManager';
import { CameraController } from '../match/CameraController';
import { PlayerSelectionSystem } from '../match/PlayerSelectionSystem';
import { PossessionSystem } from '../match/PossessionSystem';
import { HumanInputController, type PassContext } from '../input/HumanInputController';
import { TouchInput } from '../input/TouchInput';
import { AIController } from '../input/AIController';
import { aimShotTarget } from '../ai/FootballAI';
import { mulberry32, type Rng } from '../utils/rng';
import { TeamCoordinator } from '../ai/TeamCoordinator';
import { AudioDirector } from '../audio/AudioDirector';
import { WebAudioSynth } from '../audio/WebAudioSynth';
import { FrameTimeTracker } from '../utils/FrameTimeTracker';
import { detectFoul } from '../match/foulRule';
import { PowerMeterHud } from '../ui/PowerMeterHud';
import { pinHudObject, zoomForFormation } from '../ui/hudPin';
import { shouldShowControlsHint } from '../ui/controlsHint';
import { BALANCE_CONFIG, type TacticsId } from '../data/balance';
import { buildFrameMap } from '../entities/frameMap';
import { gkClipForState, isGkOverrideClip } from '../entities/gkAnim';
import { pickCelebrationIds } from '../match/celebration';
import { CrowdIntensitySampler } from '../audio/crowdIntensity';
import { GoalFeedback } from '../match/GoalFeedback';
import { goalFrameGeometry, isGoalCrossing } from '../match/goalFrame';
import { restartControlId, type RestartControlKind } from '../match/restartControl';
import { FoulBanner } from '../ui/FoulBanner';
import { resolveFormation, type FormationId } from '../data/formations';
import { kickoffAnchors } from '../match/restartPlacement';
import { aimsIntoOwnHalf, applyKickoffGracePowerCap, canApplyKick, gateKickCommand, isKickoffGraceActive, kickHasBall } from '../match/kickGate';
import { BallCaptureSystem } from '../match/BallCaptureSystem';
import { ControlledIndicatorModel, ControlledPlayerIndicator } from '../ui/ControlledIndicator';
import { resolveMatchFormations, type MatchSceneInitData } from '../match/resolveFormations';
import {
  defaultMatchSettings,
  resolveClockSeconds,
  resolveMatchSettings,
  type MatchSettings,
} from '../match/settingsModel';
import { canPauseMatch, PauseMenuModel, type PauseAction, type PauseAdjustChange, type PauseRow } from '../match/pauseState';
import { entranceStarts } from '../match/EntranceSystem';
import { WeatherSystem, DEFAULT_WEATHER_CONFIG } from '../match/WeatherSystem';
import { PauseOverlay } from '../ui/PauseOverlay';
import { UI_TEXT } from '../data/uiText';
import { DebugTuning } from '../debug/DebugTuning';
import { buildDebugPayload, formatDebugPayload } from '../debug/DebugMonitor';
import { HalftimeBanner, halftimeBannerData } from '../ui/HalftimeBanner';
import { FulltimeBanner } from '../ui/FulltimeBanner';
import type { AICommand, BallSnapshot, EntitySnapshot } from '../ai/commands';
import type { GKState } from '../ai/GoalkeeperAI';

/** Midpoint divisor for center averages (arithmetic, not tuning). */
const FRAME_MID_DIVISOR = 2;

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
  /** Touch proto controller (Batch 2): stick + A/B; widgets self-skip off touch devices. */
  private touchInput?: TouchInput;
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
  /**
   * Remediation: the old score-peek toggle (Marcador) is now a proper abandon
   * affordance — Abandonar quits to the menu. PAUSA owns pausing; this button
   * owns leaving. One button, one behavior.
   */
  private abandonButton?: Phaser.GameObjects.Text;
  private formations: { home: FormationId; away: FormationId } = { home: '11v11', away: '11v11' };
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
  /** AI pass destinations (receiver possession hint), consumed by wireShots. */
  private pendingPassTarget = new Map<Player, { x: number; y: number }>();
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
  /** Batch 5 (A): ring + floating marker tracking the controlled player. */
  private indicator?: ControlledPlayerIndicator;
  private readonly indicatorModel = new ControlledIndicatorModel();
  /** Batch 5 (D+E): last applied side-swap state (attack dirs + coordinators). */
  private lastSidesSwapped = false;
  /** Home attack direction, flipped by the halftime side swap. */
  private homeAttackDir: 1 | -1 = 1;
  /** Batch A (INTRO): walk-in targets per player id (kickoff anchors). */
  private entranceTargets = new Map<string, { x: number; y: number }>();
  /** Batch A (HALF): overlay panel with score, stats and resume/restart. */
  private halftimeBanner?: HalftimeBanner;
  /** Batch B1 (RESULTS): terminal full-time panel with replay to INTRO. */
  private fulltimeBanner?: FulltimeBanner;
  /** Batch C (foul signal): transient FALTA/PENAL banner on set-piece awards. */
  private foulBanner?: FoulBanner;
  /** Batch B1 (tactics): active preset + small HUD label, default Equilibrada. */
  private tacticsId: TacticsId = BALANCE_CONFIG.TACTICS.DEFAULT;
  private tacticsLabel?: Phaser.GameObjects.Text;
  /** Batch B2: live set-piece (foul awarded, kick pending) + AI-kick countdown. */
  private setPiece: { timerMs: number; taken: boolean } | null = null;
  /**
   * Remediation (shot placement): deterministic seeded stream for the away-AI
   * set-piece aim spread — corners reachable, misses possible, no Math.random.
   */
  private readonly shotRng: Rng = mulberry32(BALANCE_CONFIG.RNG.DEFAULT_SEED);
  /**
   * Playtest final (control handoff): while set, auto-selection is suspended
   * and the human keeps the claimed restart/set-piece taker. Set on own-team
   * handoffs (kickoff/throw-in/corner/goal-kick resume, home free-kick/penalty
   * award), cleared by the FIRST applied kick of the ball (any kicker).
   */
  private controlHoldId: string | null = null;
  /** Batch B2: rolling frame-time stats fed from update (AGENTS.md section 33). */
  private readonly frameTime = new FrameTimeTracker();
  private frameCount = 0;
  /** Phase 4 Batch A: config-driven surface/weather modifiers (section 13). */
  private weatherSystem?: WeatherSystem;
  /** Phase 4 Batch A: session-only live tuning knobs (section 30, never persisted). */
  private readonly debugTuning = new DebugTuning();
  /** Phase 4 Batch A: debug overlay state — never visible by default. */
  private debugVisible = false;
  private debugText?: Phaser.GameObjects.Text;
  private debugAccumMs = 0;
  /** Version of the tuning values last written into entities/camera. */
  private lastTuningVersion = -1;
  /**
   * Settings/pause batch: chosen match settings (session-only — carried by
   * scene data from MenuScene, honored by every restart path; persistence is
   * a Phase 6 SaveGame OPEN QUESTION).
   */
  private matchSettings: MatchSettings = defaultMatchSettings();
  /** Settings/pause batch: scene-level pause (gating, NOT a manager state). */
  private paused = false;
  private pauseMenu?: PauseMenuModel;
  private pauseOverlay?: PauseOverlay;
  /** On-screen PAUSA affordance on the top HUD strip (Esc equivalent). */
  private pauseButton?: Phaser.GameObjects.Text;
  /**
   * Phase 4 Batch B (section 22 layer 3): dynamic crowd bed intensity —
   * sampled at a low cadence, one gain write per sample (never per frame).
   */
  private readonly crowdSampler = new CrowdIntensitySampler();

  constructor() {
    super('MatchScene');
  }

  /**
   * FORM-1: formations come from scene init data (formationHome/formationAway),
   * defaulted and validated BEFORE any entity spawns. Batch B1 ships 11v11 by
   * default; explicit 3v3/5v5 params stay available for tests and sandbox.
   * Settings batch: surface/weather/duration/volume resolve fail-fast here
   * (same convention) so create() can wire them into every system.
   */
  init(data?: MatchSceneInitData): void {
    this.formations = resolveMatchFormations(data);
    this.matchSettings = resolveMatchSettings(data);
  }

  create(): void {
    // Static pitch backdrop.
    this.add.image(480, 270, 'pitch');

    // Phase 4 Batch A: surface/weather modifiers from config (section 13)
    // plus cheap pitch visual evolution (flat rects only — section 3 budget).
    // Settings batch: surface/weather come from the pre-match menu via scene
    // init data (defaults preserve the old hardcoded behavior bit-for-bit).
    this.weatherSystem = new WeatherSystem(
      DEFAULT_WEATHER_CONFIG,
      this.matchSettings.surface,
      this.matchSettings.weather,
    );
    this.applySurfaceVisuals();

    // World bounds for Arcade physics
    this.physics.world.setBounds(0, 0, 960, 540);

    // Ball
    this.ball = new Ball(this, 480, 270);

    // Teams placed at own-half kickoff anchors (batch 5: raw data anchors
    // describe an attacking shape — kickoffAnchors clamps midfield leakers).
    const homeCoords = kickoffAnchors(this.formations.home, 'home');
    const awayCoords = kickoffAnchors(this.formations.away, 'away');
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

    // Controllers: every player gets an AIController with kick wiring.
    // Phase 2 closure (GK profile): keeper controllers carry isGK so locomotion
    // uses BALANCE_CONFIG.GK speeds/accel instead of field-player speeds.
    for (const [id, p] of this.homeByIndex) {
      const idx = Number(id.split('-')[1]);
      const isGK = this.roles.home[idx] === 'GK';
      const ai = new AIController((cmd) => this.handleAIKick(p, cmd), BALANCE_CONFIG.AI, undefined, isGK);
      p.attachController(ai);
      this.aiControllers.set(id, ai);
    }
    for (const [id, p] of this.awayByIndex) {
      const idx = Number(id.split('-')[1]);
      const isGK = this.roles.away[idx] === 'GK';
      const ai = new AIController((cmd) => this.handleAIKick(p, cmd), BALANCE_CONFIG.AI, undefined, isGK);
      p.attachController(ai);
      this.awayControllers.set(id, ai);
    }

    // Human controller — attached when the selection system decides
    this.humanController = new HumanInputController();
    // MC-1/MC-2: injected match context — ball position + teammates (the
    // controlled player changes on selection swaps, so getTeammates is a closure).
    this.humanController.setContext(this.buildHumanContext());
    this.player = this.homeTeam[this.homeTeam.length - 1];
    this.humanPlayerId = null;

    // Touch proto (Batch 2): same match context as the keyboard controller, so
    // both resolve identical intents through the same charge/cap/kick-gate
    // path. Widgets only materialize on touch-capable devices; otherwise
    // update() is a no-op and the keyboard keeps full authority. No Button C.
    this.touchInput = new TouchInput();
    this.touchInput.setContext(this.buildHumanContext());
    this.touchInput.attach(this, this.player);

    // Systems
    // Settings batch: the clock honors the chosen real duration (3 or 5
    // minutes, section 7) — every other value still comes from MATCH config.
    this.manager = new MatchManager({
      ...BALANCE_CONFIG.MATCH,
      TIME_REMAINING_GAME_SECONDS: resolveClockSeconds(this.matchSettings.durationMinutes),
    });
    this.manager.bind(this, this.ball, this.homeTeam, this.awayTeam, this.formations);
    // Batch A (INTRO): both teams start off-pitch and walk to kickoff spots.
    this.beginEntrance();
    // Batch A: any-key/tap skips the entrance (config flag enforced inside).
    // Batch C: the same first gesture unlocks the ambient crowd bed inside
    // the input handler path (autoplay-policy safe; headless no-op).
    // Settings/pause batch: ignored while paused — pause owns the keyboard.
    this.input.keyboard?.on('keydown', () => {
      if (this.paused) {
        return;
      }
      this.manager?.skipIntro();
      this.audio?.startCrowdBed();
    });
    // Headless scene mocks stub keyboard but not input.on — optional-chain it.
    (this.input as unknown as { on?: (ev: string, cb: () => void) => void }).on?.(
      'pointerdown',
      () => {
        if (this.paused) {
          return;
        }
        this.manager?.skipIntro();
        this.audio?.startCrowdBed();
      },
    );
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
    // Phase 4 Batch A: surface sprint modifier (shared by BOTH teams,
    // section 13) + live tuning applied through the single speed path
    // (Player.maxSpeed — human move() and AI locomotion both read it).
    // The GK keeps its own locomotion profile (GK_MAX_SPEED_PX_S) and is
    // intentionally unaffected by the sprint modifier.
    this.applySpeedAndPassTuning();
    // PRES-2: event-driven audio; assets are optional (skip + debug warn).
    this.audio = new AudioDirector({
      has: (key) => this.cache.audio.exists(key),
      play: (key, cfg) => this.sound.play(key, cfg),
    }, { debug: true });
    // Batch B2: procedural synthesis fallback (original WebAudio recipes) so
    // wired events sound with zero audio files. Asset files always win.
    // WebAudioSynth is lazy + headless-guarded — safe to attach everywhere.
    this.audio.setSynthAdapter(new WebAudioSynth());
    // Settings batch: master volume from the pre-match menu (pause AJUSTES
    // re-applies it live).
    this.audio.setMasterVolume(this.matchSettings.volume);
    this.selectionSystem = new PlayerSelectionSystem();
    this.possession = new PossessionSystem();
    this.ballCapture = new BallCaptureSystem();
    this.coordinatorHome = new TeamCoordinator('home', resolveFormation(this.formations.home));
    this.coordinatorAway = new TeamCoordinator('away', resolveFormation(this.formations.away));
    this.coordinatorHome.setTactics(this.tacticsId);
    this.coordinatorAway.setTactics(this.tacticsId);

    // Scoring orientation: left zone = away scores, right zone = home scores.
    // Playtest final (goal alignment): every zone rect comes from
    // goalFrameGeometry() — the SAME shared geometry the visible frames and
    // the painted pitch markings use, so detection, frame and markings can
    // never drift apart.
    const goalFrames = goalFrameGeometry();
    this.leftGoal = this.add.zone(
      goalFrames.left.zone.cx,
      goalFrames.left.zone.cy,
      goalFrames.left.zone.w,
      goalFrames.left.zone.h,
    );
    this.rightGoal = this.add.zone(
      goalFrames.right.zone.cx,
      goalFrames.right.zone.cy,
      goalFrames.right.zone.w,
      goalFrames.right.zone.h,
    );
    this.physics.world.enable([this.leftGoal, this.rightGoal]);
    (this.leftGoal.body as Phaser.Physics.Arcade.Body).setImmovable(true);
    (this.rightGoal.body as Phaser.Physics.Arcade.Body).setImmovable(true);
    this.leftGoal.setVisible(false);
    this.rightGoal.setVisible(false);

    // MF-1: post bands sit just beyond the goal-mouth band (geometry from
    // BALANCE_CONFIG.FEEDBACK), one above and one below each goal zone.
    const FB = BALANCE_CONFIG.FEEDBACK;
    const postBands: Phaser.GameObjects.Zone[] = [];
    for (const side of [goalFrames.left, goalFrames.right]) {
      for (const dir of [-1, 1]) {
        const bandY =
          dir === -1 ? side.mouthTopY - FB.POST_BAND_HEIGHT_PX / 2 : side.mouthBottomY + FB.POST_BAND_HEIGHT_PX / 2;
        const band = this.add.zone(side.zone.cx, bandY, side.zone.w, FB.POST_BAND_HEIGHT_PX);
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
      home: this.add.rectangle(
        goalFrames.right.zone.cx,
        goalFrames.right.zone.cy,
        goalFrames.right.zone.w,
        goalFrames.right.zone.h,
        0xffffff,
        0,
      ),
      away: this.add.rectangle(
        goalFrames.left.zone.cx,
        goalFrames.left.zone.cy,
        goalFrames.left.zone.w,
        goalFrames.left.zone.h,
        0xffffff,
        0,
      ),
    };
    this.netFlash.home.setDepth(9).setVisible(false);
    this.netFlash.away.setDepth(9).setVisible(false);

    this.physics.add.overlap(this.ball.sprite, this.leftGoal, () => {
      // Remediation: the zone is centered ON the line — an overlap alone is
      // not a goal. The ball must cross the painted meta line (isGoalCrossing);
      // near-line misses fall through to the TouchTracker byline rules.
      if (this.manager?.state === 'PLAYING' && this.ball) {
        // Batch 5 (D+E): scoring side follows the halftime side swap.
        if (isGoalCrossing('left', this.ball.sprite.x, this.ball.sprite.y, this.ball.z)) {
          this.lastScoringSide = this.manager.scorerForGoal('left');
          this.manager.handleGoal(this.lastScoringSide);
        }
      }
    }, undefined, this);

    this.physics.add.overlap(this.ball.sprite, this.rightGoal, () => {
      if (this.manager?.state === 'PLAYING' && this.ball) {
        if (isGoalCrossing('right', this.ball.sprite.x, this.ball.sprite.y, this.ball.z)) {
          this.lastScoringSide = this.manager.scorerForGoal('right');
          this.manager.handleGoal(this.lastScoringSide);
        }
      }
    }, undefined, this);

    // Batch C: visible goal frames drawn EXACTLY over the detection zones
    // above (posts on the goal-mouth edges = POST bands, cheap net outward).
    this.drawGoalFrames();

    // HUD — pinned to the screen (scroll+zoom independent) at safe-margin slots:
    // clock top-left (24,24), score top-center, Abandon top-right (HUD config).
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

    // Abandon button (HUD strip top-right): one tap quits to the menu with
    // the current settings. Geometry + copy from config/UI_TEXT.
    const HUDC = BALANCE_CONFIG.HUD;
    this.abandonButton = this.add.text(
      HUDC.ABANDON_BUTTON_X_PX,
      HUDC.ABANDON_BUTTON_Y_PX,
      UI_TEXT.HUD.ABANDON_LABEL,
      {
        fontFamily: 'monospace',
        fontSize: HUDC.ABANDON_FONT_SIZE_PX,
        color: '#ffffff',
        backgroundColor: '#000000',
        padding: { left: 8, right: 8, top: 4, bottom: 4 },
      },
    ).setOrigin(1, 0).setDepth(10).setInteractive();
    this.abandonButton.on('pointerdown', () => {
      this.scene.start('MenuScene', { settings: this.matchSettings });
    });

    // Game Over group
    this.gameOverGroup = this.add.container(480, 270).setDepth(30);
    const goBg = this.add.rectangle(0, 0, 600, 240, 0x000000, 0.7).setOrigin(0.5);
    const goTitle = this.add.text(0, -60, UI_TEXT.HUD.GAME_OVER_TITLE, {
      fontFamily: 'monospace',
      fontSize: '48px',
      color: '#ffffff',
    }).setOrigin(0.5);
    const goScore = this.add.text(0, 0, '0 - 0', {
      fontFamily: 'monospace',
      fontSize: '36px',
      color: '#ffffff',
    }).setOrigin(0.5);
    const goRestart = this.add.text(0, 60, UI_TEXT.HUD.RESTART_KEY_HINT, {
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
    const roTitle = this.add.text(0, -60, UI_TEXT.HUD.RESULT_TITLE, {
      fontFamily: 'monospace',
      fontSize: '32px',
      color: '#ffffff',
    }).setOrigin(0.5);
    const roScore = this.add.text(0, 0, '0 - 0', {
      fontFamily: 'monospace',
      fontSize: '40px',
      color: '#ffffff',
    }).setOrigin(0.5);
    const roClose = this.add.text(0, 70, UI_TEXT.HUD.RESULT_CLOSE, {
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

    // Batch A (HALF): overlay panel — Continuar resumes the second half,
    // Reiniciar re-runs the full entrance. Created AFTER the game-over and
    // result overlays so their add.text/container creation order (relied on
    // by scene tests) never shifts.
    this.halftimeBanner = new HalftimeBanner(
      this,
      BALANCE_CONFIG.HALFTIME_BANNER,
      () => this.manager?.resumeSecondHalf(),
      () => {
        this.manager?.restartToIntro();
        this.beginEntrance();
      },
    );

    // Batch B1 (RESULTS): terminal full-time panel reusing the stats payload.
    // "Jugar de nuevo" resets the match back to INTRO (walk-in re-runs).
    // Created AFTER the halftime banner so existing creation order never shifts.
    this.fulltimeBanner = new FulltimeBanner(
      this,
      BALANCE_CONFIG.FULLTIME_BANNER,
      () => {
        this.manager?.restartToIntro();
        this.beginEntrance();
      },
    );

    // Batch C (foul signal): transient FALTA/PENAL overlay, shown on the
    // PLAYING -> FREE_KICK/PENALTY edge next to the whistle.
    this.foulBanner = new FoulBanner(this, BALANCE_CONFIG.FOUL_BANNER);

    // Batch B1 (tactics): minimal switching UI — keyboard shortcut + small
    // HUD label, no menus or sliders. T cycles, 1/2/3 jump directly.
    const TC = BALANCE_CONFIG.TACTICS;
    this.tacticsLabel = this.add.text(
      TC.LABEL_X_PX,
      TC.LABEL_Y_PX,
      this.tacticsText(),
      {
        fontFamily: 'monospace',
        fontSize: TC.LABEL_FONT_SIZE_PX,
        color: TC.LABEL_COLOR,
      },
    ).setOrigin(1, 0).setDepth(10);
    this.input.keyboard?.on('keydown-T', () => this.cycleTactics());
    this.input.keyboard?.on('keydown-ONE', () => this.applyTactics('defensive'));
    this.input.keyboard?.on('keydown-TWO', () => this.applyTactics('balanced'));
    this.input.keyboard?.on('keydown-THREE', () => this.applyTactics('offensive'));

    // R key listener for restart (terminal states incl. new FULL_TIME/RESULTS)
    this.input.keyboard?.on('keydown-R', () => {
      if (
        this.manager?.state === 'GAME_OVER' ||
        this.manager?.state === 'FULL_TIME' ||
        this.manager?.state === 'RESULTS'
      ) {
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

    // Batch 5 (A): controlled-player indicator follows the initial player
    // until the selection system performs its first swap.
    this.indicator = new ControlledPlayerIndicator(this);
    this.indicator.setTarget(this.player.sprite);

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
    pinHudObject(this.abandonButton, HUDC.ABANDON_BUTTON_X_PX, HUDC.ABANDON_BUTTON_Y_PX, this.cameraZoom, vw, vh);
    pinHudObject(this.gameOverGroup, 480, 270, this.cameraZoom, vw, vh);
    pinHudObject(this.resultOverlayGroup, 480, 270, this.cameraZoom, vw, vh);
    this.halftimeBanner?.pinToScreen(this.cameraZoom, vw, vh);
    this.fulltimeBanner?.pinToScreen(this.cameraZoom, vw, vh);
    this.foulBanner?.pinToScreen(this.cameraZoom, vw, vh);
    if (this.tacticsLabel) {
      pinHudObject(
        this.tacticsLabel,
        BALANCE_CONFIG.TACTICS.LABEL_X_PX,
        BALANCE_CONFIG.TACTICS.LABEL_Y_PX,
        this.cameraZoom,
        vw,
        vh,
      );
    }
    pinHudObject(this.controlsHintText, 480, 516, this.cameraZoom, vw, vh);
    this.powerMeter.pinToScreen(this.cameraZoom, vw, vh);
    // Touch widgets use the same counter-scaled screen slots as the HUD so
    // the large touch zones never shift with camera scroll/zoom.
    this.touchInput?.pinWidgets(this.cameraZoom, vw, vh);

    // Settings/pause batch — created after every gameplay HUD/banner (their
    // creation order is locked by scene tests) but BEFORE the debug overlay
    // (which stays the LAST add.text by its documented invariant):
    //   - on-screen PAUSA button on the top HUD strip (never over the play
    //     area, section 8) + Esc toggle;
    //   - pause overlay (banner pattern) sharing the PauseMenuModel with the
    //     keyboard handlers.
    const P = BALANCE_CONFIG.PAUSE;
    this.pauseButton = this.add
      .text(P.BUTTON_X_PX, P.BUTTON_Y_PX, UI_TEXT.HUD.PAUSE_BUTTON, {
        fontFamily: 'monospace',
        fontSize: P.BUTTON_FONT_SIZE_PX,
        color: P.BUTTON_TEXT_COLOR,
        backgroundColor: P.BUTTON_BG_COLOR,
        padding: P.BUTTON_PADDING,
      })
      .setOrigin(0, 0)
      .setDepth(10)
      .setInteractive();
    this.pauseButton.on('pointerdown', () => this.togglePause());
    pinHudObject(this.pauseButton, P.BUTTON_X_PX, P.BUTTON_Y_PX, this.cameraZoom, vw, vh);

    this.pauseMenu = new PauseMenuModel(this.matchSettings);
    this.pauseOverlay = new PauseOverlay(this, P, {
      onRowTap: (row) => this.onPauseRowTap(row),
    });
    this.pauseOverlay.pinToScreen(this.cameraZoom, vw, vh);

    this.input.keyboard?.on('keydown-ESC', () => this.togglePause());
    // Pause-menu keyboard navigation — only while the pause overlay owns
    // the input (never shadows the gameplay bindings above).
    this.input.keyboard?.on('keydown-UP', () => this.pauseNavigate(-1));
    this.input.keyboard?.on('keydown-DOWN', () => this.pauseNavigate(1));
    this.input.keyboard?.on('keydown-LEFT', () => this.pauseAdjust(-1));
    this.input.keyboard?.on('keydown-RIGHT', () => this.pauseAdjust(1));
    this.input.keyboard?.on('keydown-ENTER', () => this.pauseConfirm());

    // Phase 4 Batch A (section 30): debug overlay — created LAST so no
    // existing text creation index shifts, hidden by default, every layout
    // value/key from DEBUG config. Session-only tuning keys act only while
    // the overlay is visible, so they never shadow gameplay bindings.
    const DBG = BALANCE_CONFIG.DEBUG;
    const PANEL = DBG.PANEL;
    this.debugText = this.add.text(PANEL.X_PX, PANEL.Y_PX, '', {
      fontFamily: PANEL.FONT_FAMILY,
      fontSize: PANEL.FONT_SIZE_PX,
      color: PANEL.TEXT_COLOR,
      backgroundColor: PANEL.BG_COLOR,
      padding: PANEL.PADDING,
      lineSpacing: PANEL.LINE_SPACING_PX,
    })
      .setDepth(PANEL.DEPTH)
      .setScrollFactor(PANEL.SCROLL_FACTOR)
      .setVisible(false);
    this.input.keyboard?.on(`keydown-${DBG.TOGGLE_KEY}`, () => this.toggleDebugOverlay());
    this.input.keyboard?.on(`keydown-${DBG.ADJUST_DOWN_KEY}`, () => {
      if (this.debugVisible) {
        this.debugTuning.adjustSelected(-1);
      }
    });
    this.input.keyboard?.on(`keydown-${DBG.ADJUST_UP_KEY}`, () => {
      if (this.debugVisible) {
        this.debugTuning.adjustSelected(1);
      }
    });
    this.input.keyboard?.on(`keydown-${DBG.CYCLE_KNOB_KEY}`, () => {
      if (this.debugVisible) {
        this.debugTuning.cycle();
      }
    });
  }

  update(time: number, delta: number): void {
    this.currentTimeMs = time;
    // Settings/pause batch: while paused NOTHING updates — no manager tick
    // (clocks/timers freeze), no AI, no controllers, no frame-time stats.
    // Resume continues from the exact same state (no wedge by construction).
    if (this.paused) {
      return;
    }
    // Phase 4 Batch A: re-apply live tuning only when a knob changed
    // (version-gated — no per-frame writes in the hot path).
    if (this.debugTuning.version !== this.lastTuningVersion) {
      this.applySpeedAndPassTuning();
    }
    // Batch B2: rolling frame-time stats (AGENTS.md section 33) + periodic
    // dev-console line (no HUD widget — the debug overlay is Phase 4).
    this.frameTime.push(delta);
    this.frameCount++;
    if (this.frameCount % BALANCE_CONFIG.PERF.FRAME_TIME_LOG_EVERY === 0) {
      // eslint-disable-next-line no-console
      console.debug(this.frameTime.toLogString());
    }
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
      // Batch B2: the whistle also blows the moment a foul stops play.
      // Batch C: the transient FALTA/PENAL banner shows on the same edge.
      if (
        this.prevMatchState === 'PLAYING' &&
        (this.manager.state === 'FREE_KICK' || this.manager.state === 'PENALTY')
      ) {
        this.audio?.playEvent('WHISTLE');
        this.foulBanner?.show(this.manager.state as 'FREE_KICK' | 'PENALTY');
      }
      // MF-1/MF-2 guarded events: CROWD_CHEER + net flash fire exactly once on
      // the PLAYING -> GOAL edge; post guard re-arms on every PLAYING resume.
      for (const event of this.goalFeedback.onStateTransition(this.prevMatchState, this.manager.state)) {
        if (event === 'CROWD_CHEER') {
          this.audio?.playEvent('GOAL');
          this.audio?.playEvent('CROWD_CHEER');
          // Phase 4 Batch B: scorer + nearest teammates celebrate (bounded);
          // the crowd bed peaks under the layered cheer, then decays back.
          this.triggerCelebration(this.lastScoringSide);
          this.peakCrowdIntensity();
        } else {
          this.pulseNet(this.lastScoringSide);
        }
      }
      // Kick-gate hygiene on restart: any transition into KICKOFF drops stale
      // cached AI commands (e.g. a GK DISTRIBUTE requested while the ball sat
      // inside the goal during the GOAL freeze) and cancels an in-flight
      // human charge so nothing fires the moment PLAYING resumes.
      // Playtest final: a stale control hold from the previous sequence dies
      // with the new restart.
      if (this.prevMatchState !== 'KICKOFF' && this.manager.state === 'KICKOFF') {
        for (const ai of this.aiControllers.values()) {
          ai.setCommand(undefined);
        }
        for (const ai of this.awayControllers.values()) {
          ai.setCommand(undefined);
        }
        this.player?.cancelCharge();
        this.pendingShotKind.clear();
        this.pendingPassTarget.clear();
        this.foulBanner?.hide();
        this.controlHoldId = null;
        // Phase 4 Batch B: kickoff hygiene kills any in-flight celebration /
        // tackle clip so the restart starts from a clean locomotion state.
        for (const p of [...this.homeTeam, ...this.awayTeam]) {
          p.resetAnimation();
        }
      }
      // Batch C (own-restart control): arriving into PLAYING from a restart
      // hands the human the nearest home teammate on OWN restarts only.
      if (
        this.manager.state === 'PLAYING' &&
        (this.prevMatchState === 'KICKOFF' ||
          this.prevMatchState === 'THROW_IN' ||
          this.prevMatchState === 'CORNER' ||
          this.prevMatchState === 'GOAL_KICK')
      ) {
        this.claimRestartControl(this.prevMatchState);
      }
      this.prevMatchState = this.manager.state;
      this.syncSideSwap();
      // Batch A: INTRO walk-in locomotion + HALF banner visibility.
      // Batch B1: terminal RESULTS panel visibility.
      // Batch B2: away-AI set-piece kick countdown.
      this.updateEntrance(delta);
      this.syncHalftimeBanner();
      this.syncFulltimeBanner();
      this.updateSetPiece(delta);
    }

    const isPlaying = this.manager?.state === 'PLAYING';
    const isSetPiece = this.manager?.state === 'FREE_KICK' || this.manager?.state === 'PENALTY';
    const resultOverlayVisible = this.resultOverlayGroup?.visible ?? false;
    const canPlay = isPlaying && !resultOverlayVisible;

    // Team AI: snapshots → coordinators → commands
    if (this.coordinatorHome && this.coordinatorAway && this.ball && this.possession) {
      const homeSnaps = this.buildSnaps(this.homeTeam, 'home');
      const awaySnaps = this.buildSnaps(this.awayTeam, 'away');
      const ballSnap = this.buildBallSnap();

      // Possession per frame (domain-only wiring; consumed by coordinators)
      const possessorId = this.possession.update(delta, [...homeSnaps, ...awaySnaps], ballSnap);
      // Batch A: possession-time feed for the halftime banner stats.
      if (possessorId) {
        this.manager?.addPossessionTime(
          possessorId.startsWith('away') ? 'away' : 'home',
          delta,
        );
      }
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

      // Batch B2 (simple fouls): tackle-from-behind check on live contact.
      // Steals resolve first (possession updated above), so this only fires
      // when the carrier KEEPS the ball with an opponent on their back inside
      // the tackle radius and moving — the whistle moment. Proximity-only and
      // team-symmetric: AI PRESS chases and human pressure runs both count as
      // challenges through the same snapshot rule (see foulRule.ts).
      if (this.manager?.state === 'PLAYING' && this.possession.possessorId) {
        const carrierId = this.possession.possessorId;
        const allSnaps = [...homeSnaps, ...awaySnaps];
        const carrier = allSnaps.find((s) => s.id === carrierId);
        if (carrier) {
          const foul = detectFoul(
            carrier,
            allSnaps.filter((s) => s.team !== carrier.team),
          );
          if (foul) {
            const award = this.manager.awardFoul(foul.foulingTeam, carrier.x, carrier.y);
            if (award) {
              this.onSetPieceAwarded();
            }
          }
        }
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
          this.ball.vz = 0;
          this.ball.zTarget = 0;
          this.possession.setPossessor(ev.playerId);
        }
      }
      this.prevBallX = this.ball.sprite.x;
      this.prevBallY = this.ball.sprite.y;

      // Carrier feel (fase 4): each coordinator also receives the OPPONENT
      // snapshots so the ball holder can derive its pressure/curve metrics at
      // the regular tick cadence (no per-frame O(n^2)).
      // Batch C: the human-controlled id is excluded from press assignment so
      // the chase slot is never wasted on the player the human already moves.
      const excludedHuman = this.humanPlayerId !== null ? new Set([this.humanPlayerId]) : undefined;
      const homeCmds = this.coordinatorHome.update(time, homeSnaps, ballSnap, this.possession, awaySnaps, excludedHuman);
      const awayCmds = this.coordinatorAway.update(time, awaySnaps, ballSnap, this.possession, homeSnaps);

      // Per-frame GK evaluation (design 3.0: NEVER inside the 150ms cadence)
      const gkHome = homeSnaps.find((s) => s.role === 'GK');
      const gkAway = awaySnaps.find((s) => s.role === 'GK');
      // Batch 5 (D+E): GK attack directions follow the halftime side swap.
      const homeDir: 1 | -1 = this.homeAttackDir ?? 1;
      const awayDir: 1 | -1 = homeDir === 1 ? -1 : 1;
      if (gkHome) {
        this.coordinatorHome.tickGK(delta, gkHome, {
          ball: ballSnap,
          teammates: homeSnaps.filter((s) => s.role !== 'GK'),
          opponents: awaySnaps,
          attackDir: homeDir,
        });
        this.applyGkAnimation(this.homeByIndex.get(gkHome.id), this.coordinatorHome.gkState());
      }
      if (gkAway) {
        this.coordinatorAway.tickGK(delta, gkAway, {
          ball: ballSnap,
          teammates: awaySnaps.filter((s) => s.role !== 'GK'),
          opponents: homeSnaps,
          attackDir: awayDir,
        });
        this.applyGkAnimation(this.awayByIndex.get(gkAway.id), this.coordinatorAway.gkState());
      }

      // Automatic selection (human) — home field players only, GK excluded.
      // Phase 2 closure: candidates carry isEngaged for already-committed
      // teammates (PRESS chasers) so SELECTION.ENGAGED_PENALTY operates in
      // production, not just unit tests.
      // Playtest final: suspended while a restart/set-piece control hold is
      // active — the claimed taker keeps control until the first kick.
      if (canPlay && this.selectionSystem && this.controlHoldId === null) {
        const candidates = homeSnaps
          .filter((s) => s.role !== 'GK')
          .map((s) => ({
            id: s.id,
            x: s.x,
            y: s.y,
            role: s.role,
            isEngaged: homeCmds.get(s.id)?.action === 'PRESS',
          }));
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
        // Phase 4 Batch B: an AI presser arriving at the carrier plays the
        // slide-tackle clip (cosmetic — the challenge itself resolves through
        // the possession/foul systems). Bounded window, no per-frame restarts.
        this.updatePresserTackleAnimations(homeCmds, homeSnaps, awaySnaps, this.homeByIndex);
        this.updatePresserTackleAnimations(awayCmds, awaySnaps, homeSnaps, this.awayByIndex);
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
      // Touch runs after the keyboard controller on the same player: a
      // deflected stick (or A-pressure chase) overrides, a neutral stick
      // writes nothing and the keyboard keeps authority.
      this.touchInput?.update(delta);
    } else if (isSetPiece && controlled) {
      // Batch B2 set piece: the taker aims with movement keys/stick and
      // charges the kick while everyone else stays pinned on their marks.
      controlled.updateController(delta);
      this.touchInput?.update(delta);
      for (const p of [...this.homeTeam, ...this.awayTeam]) {
        if (p !== controlled) {
          p.body.setVelocity(0, 0);
          p.body.setAcceleration(0, 0);
        }
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

    // Controlled player preUpdate (charge + animation). Batch B2: the charge
    // accumulates during set pieces too, so the taker can load the kick.
    if (controlled) {
      if (canPlay || isSetPiece) {
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
    // Phase 4 Batch A: surface friction reaches the ball through the
    // existing seam, composed with the live ballFriction knob (scalar math,
    // no allocation).
    this.ball.preUpdate(time, delta, this.ballFrictionMultiplier());

    // PM-1: HUD reflects the controlled player's charge state.
    if (this.powerMeter && controlled) {
      this.powerMeter.update(controlled.getPower(), controlled.isChargingNow());
    }

    // Batch 5 (A): indicator redrawn every frame from the controlled sprite,
    // in every match state (including HALF) so the marker never detaches.
    this.indicator?.update(time);

    // PRES-1: per-frame camera follow (selected player + ball, config lerp,
    // look-ahead and pitch-edge clamp) — after entity preUpdate, before HUD.
    if (this.cameraController && controlled && this.ball) {
      this.cameraController.update(
        { x: controlled.sprite.x, y: controlled.sprite.y },
        { x: this.ball.sprite.x, y: this.ball.sprite.y },
        { x: this.ball.body.velocity.x, y: this.ball.body.velocity.y },
      );
    }

    // Phase 4 Batch B (section 22 layer 3): crowd bed intensity sampled at a
    // low cadence — the pure level function reads ball zone + score; exactly
    // one smoothed gain write per sample, never per frame.
    if (this.manager) {
      const crowdLevel = this.crowdSampler.update(delta, {
        ballX: this.ball.sprite.x,
        scoreHome: this.manager.score.home,
        scoreAway: this.manager.score.away,
      });
      if (crowdLevel !== null) {
        this.audio?.setCrowdIntensity(crowdLevel);
      }
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
    // full-time panel (depth 29) is never stacked under a stale peek.
    // Batch B1: terminal states are FULL_TIME/RESULTS (GAME_OVER deprecated).
    if (this.resultOverlayGroup && this.manager) {
      if (
        this.manager.state === 'GAME_OVER' ||
        this.manager.state === 'FULL_TIME' ||
        this.manager.state === 'RESULTS'
      ) {
        this.resultOverlayGroup.setVisible(false);
      } else {
        const roScoreText = (this.resultOverlayGroup as any).scoreText as Phaser.GameObjects.Text;
        if (roScoreText && this.resultOverlayGroup.visible) {
          roScoreText.setText(`${this.manager.score.home} - ${this.manager.score.away}`);
        }
      }
    }

    // Phase 4 Batch A: debug overlay refresh (section 30) — cadence-gated,
    // zero work while hidden.
    this.updateDebugOverlay(delta);
  }

  /**
   * Phase 4 Batch B (sections 11 + 21): the keeper picks its clip from its own
   * FSM state — dive/claim/distribute play as bounded overrides (re-armed
   * every frame while the state holds), positioning states fall back to the
   * normal idle/run locomotion state machine.
   */
  private applyGkAnimation(gk: Player | undefined, state: GKState): void {
    if (!gk) {
      return;
    }
    const clip = gkClipForState(state);
    if (isGkOverrideClip(clip)) {
      gk.applyGkClip(clip);
    } else {
      gk.resetAnimation();
    }
  }

  /**
   * Phase 4 Batch B: AI presser within the tackle radius of the live carrier
   * plays the slide-tackle clip. Same radius as the foul rule so the whistle
   * moment and the pose coincide; the window bound prevents restart spam.
   */
  private updatePresserTackleAnimations(
    cmds: Map<string, AICommand>,
    snaps: EntitySnapshot[],
    opponentSnaps: EntitySnapshot[],
    byIndex: Map<string, Player>,
  ): void {
    const carrierId = this.possession?.possessorId;
    if (!carrierId) {
      return;
    }
    const carrier = [...snaps, ...opponentSnaps].find((s) => s.id === carrierId);
    if (!carrier) {
      return;
    }
    const radius = BALANCE_CONFIG.FOUL.TACKLE_RADIUS_PX;
    for (const s of snaps) {
      if (s.team === carrier.team || s.role === 'GK' || cmds.get(s.id)?.action !== 'PRESS') {
        continue;
      }
      if (Math.hypot(s.x - carrier.x, s.y - carrier.y) <= radius) {
        byIndex.get(s.id)?.startTackle();
      }
    }
  }

  /**
   * Phase 4 Batch B (section 21): the scorer (last toucher on the scoring
   * side) + the configured nearest non-GK teammates start the bounded
   * arms-up celebration on GOAL; kickoff hygiene resets them early.
   */
  private triggerCelebration(side: 'home' | 'away'): void {
    if (!this.ball) {
      return;
    }
    const team = side === 'home' ? this.homeTeam : this.awayTeam;
    const byIndex = side === 'home' ? this.homeByIndex : this.awayByIndex;
    const chosen = pickCelebrationIds(
      team.map((p, i) => ({
        id: `${side}-${i}`,
        x: p.sprite.x,
        y: p.sprite.y,
        isGk: this.roles[side][i] === 'GK',
      })),
      { x: this.ball.sprite.x, y: this.ball.sprite.y },
      this.lastTouchPossessorId,
      BALANCE_CONFIG.ANIM.CELEBRATION_TEAMMATES,
    );
    for (const id of chosen) {
      byIndex.get(id)?.startCelebration();
    }
  }

  /**
   * Phase 4 Batch B (section 22 layer 3): the crowd bed jumps to the goal
   * peak under the layered cheer; the sampler continues from there so the
   * following samples decay back to the zone level.
   */
  private peakCrowdIntensity(): void {
    const peak = BALANCE_CONFIG.AUDIO.CROWD_DYNAMICS.GOAL_PEAK_LEVEL;
    this.crowdSampler.forceLevel(peak);
    this.audio?.setCrowdIntensity(peak);
  }

  /**
   * Batch A (INTRO): places both teams off-pitch (tunnel/sideline) and arms
   * the manager walk-in. Targets are the own-half kickoff anchors; the
   * per-frame updateEntrance drives AI MOVE commands until arrival, skip or
   * timeout. Simple locomotion reuses AIController seek/arrive — no physics.
   */
  private beginEntrance(): void {
    const E = BALANCE_CONFIG.ENTRANCE;
    const W = BALANCE_CONFIG.PHYSICS.PITCH_WIDTH;
    const H = BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT;
    const homeTargets = kickoffAnchors(
      this.formations.home,
      this.manager?.anchorSideFor('home') ?? 'home',
    );
    const awayTargets = kickoffAnchors(
      this.formations.away,
      this.manager?.anchorSideFor('away') ?? 'away',
    );
    this.entranceTargets = new Map<string, { x: number; y: number }>([
      ...homeTargets.map((a, i) => [`home-${i}`, { x: a.x, y: a.y }] as const),
      ...awayTargets.map((a, i) => [`away-${i}`, { x: a.x, y: a.y }] as const),
    ]);
    for (const [id, p] of this.homeByIndex) {
      const starts = entranceStarts(this.homeByIndex.size, W, H, E.ENTRANCE_Y_OFFSET_PX);
      const idx = Number(id.split('-')[1]);
      const s = starts[idx] ?? starts[0];
      if (s) {
        p.setPosition(s.x, s.y);
      }
    }
    for (const [id, p] of this.awayByIndex) {
      const starts = entranceStarts(this.awayByIndex.size, W, H, E.ENTRANCE_Y_OFFSET_PX);
      const idx = Number(id.split('-')[1]);
      const s = starts[idx] ?? starts[0];
      if (s) {
        p.setPosition(s.x, s.y);
      }
    }
    this.manager?.enterIntro();
  }

  /** Batch A: drives the INTRO walk-in; arrival completes into KICKOFF. */
  private updateEntrance(delta: number): void {
    if (this.manager?.state !== 'INTRO') {
      return;
    }
    const E = BALANCE_CONFIG.ENTRANCE;
    let allArrived = true;
    const drive = (
      byIndex: Map<string, Player>,
      ctrls: Map<string, AIController>,
    ): void => {
      for (const [id, p] of byIndex) {
        const t = this.entranceTargets.get(id);
        if (!t) {
          continue;
        }
        const dist = Math.hypot(t.x - p.sprite.x, t.y - p.sprite.y);
        if (dist > E.ENTRANCE_ARRIVE_RADIUS_PX) {
          allArrived = false;
        }
        ctrls.get(id)?.setCommand({ action: 'MOVE', targetX: t.x, targetY: t.y });
      }
    };
    drive(this.homeByIndex, this.aiControllers);
    drive(this.awayByIndex, this.awayControllers);
    for (const p of [...this.homeTeam, ...this.awayTeam]) {
      p.updateController(delta);
    }
    if (allArrived) {
      this.manager?.completeIntro();
    }
  }

  /** Batch A: banner shows during HALF with live score + stats, hides after. */
  private syncHalftimeBanner(): void {
    if (!this.manager || !this.halftimeBanner) {
      return;
    }
    if (this.manager.state === 'HALF') {
      if (!this.halftimeBanner.visible) {
        this.halftimeBanner.show(
          halftimeBannerData(this.manager.score, this.manager.stats.snapshot()),
        );
      }
    } else if (this.halftimeBanner.visible) {
      this.halftimeBanner.hide();
    }
  }

  /** Batch B1: full-time panel shows at terminal RESULTS, hides elsewhere. */
  private syncFulltimeBanner(): void {
    if (!this.manager || !this.fulltimeBanner) {
      return;
    }
    if (this.manager.state === 'RESULTS') {
      if (!this.fulltimeBanner.visible) {
        this.fulltimeBanner.show(
          halftimeBannerData(this.manager.score, this.manager.stats.snapshot()),
        );
      }
    } else if (this.fulltimeBanner.visible) {
      this.fulltimeBanner.hide();
    }
  }

  /**
   * Batch B2: a foul whistle just stopped play. Clears possession + stale
   * commands (same hygiene as the KICKOFF transition), arms the set-piece
   * tracker, and hands a home set piece straight to the taker so the kick is
   * immediately playable.
   */
  private onSetPieceAwarded(): void {
    this.possession?.clear();
    this.lastTouchPossessorId = null;
    for (const ai of this.aiControllers.values()) {
      ai.setCommand(undefined);
    }
    for (const ai of this.awayControllers.values()) {
      ai.setCommand(undefined);
    }
    this.player?.cancelCharge();
    this.pendingShotKind.clear();
    this.pendingPassTarget.clear();
    this.setPiece = { timerMs: 0, taken: false };
    const sp = this.manager?.lastSetPiece;
    if (sp && sp.team === 'home' && sp.kickerTeam === 'home') {
      // Playtest final: the taker is controlled through the set piece and
      // the resume; the selector is synced so it cannot steal the taker back
      // on the award frame (stale canPlay) nor on the kick edge.
      const takerId = `home-${sp.kickerIndex}`;
      this.selectionSystem?.forceSelect(takerId);
      this.swapToHuman(takerId);
      this.controlHoldId = takerId;
    }
  }

  /**
   * Batch B2: while a set piece pends, counts the away-AI kick delay and fires
   * one synthesized shot at the goal (resume on kick flows through the normal
   * handleAIKick -> wireShots -> notifySetPieceKick path). Home set pieces
   * wait for the human taker; the manager safety timeout covers abandonment.
   * Remediation: the aim spreads across the mouth (aimShotTarget) instead of
   * auto-centering — corners are reachable and the shot can miss the frame.
   */
  private updateSetPiece(delta: number): void {
    const state = this.manager?.state;
    if (state !== 'FREE_KICK' && state !== 'PENALTY') {
      this.setPiece = null;
      return;
    }
    if (!this.setPiece) {
      this.setPiece = { timerMs: 0, taken: false };
    }
    const sp = this.manager?.lastSetPiece;
    if (!sp || sp.team !== 'away' || this.setPiece.taken) {
      return;
    }
    this.setPiece.timerMs += delta;
    if (this.setPiece.timerMs < BALANCE_CONFIG.FOUL.SET_PIECE_AI_DELAY_MS) {
      return;
    }
    this.setPiece.taken = true;
    const kicker =
      sp.kickerTeam === 'home'
        ? this.homeByIndex.get(`home-${sp.kickerIndex}`)
        : this.awayByIndex.get(`away-${sp.kickerIndex}`);
    if (!kicker) {
      return;
    }
    const dir = this.manager?.attackDirection('away') ?? -1;
    const goalX =
      dir === 1
        ? BALANCE_CONFIG.PHYSICS.PITCH_WIDTH - BALANCE_CONFIG.FOUL.SET_PIECE_AI_GOAL_OFFSET_PX
        : BALANCE_CONFIG.FOUL.SET_PIECE_AI_GOAL_OFFSET_PX;
    this.handleAIKick(kicker, {
      action: 'SHOOT',
      targetX: goalX,
      targetY: aimShotTarget(
        this.shotRng,
        BALANCE_CONFIG.FEEDBACK.GOAL_MOUTH_CENTER_Y_PX,
        BALANCE_CONFIG.FEEDBACK.GOAL_MOUTH_HALF_HEIGHT_PX,
        BALANCE_CONFIG.AI.SHOT_MISS_MARGIN_PX,
      ),
      power: BALANCE_CONFIG.FOUL.SET_PIECE_AI_POWER,
    });
  }

  /**
   * Batch C: draws both goal frames (posts + crossbar + cheap net) EXACTLY
   * over the detection zones from goalFrameGeometry — every size, color and
   * depth comes from BALANCE_CONFIG.GOAL_FRAME, no literals here.
   */
  private drawGoalFrames(): void {
    const GF = BALANCE_CONFIG.GOAL_FRAME;
    const frames = goalFrameGeometry();
    for (const side of [frames.left, frames.right]) {
      const mouthCy = (side.mouthTopY + side.mouthBottomY) / FRAME_MID_DIVISOR;
      const mouthH = side.mouthBottomY - side.mouthTopY;
      const netCx = (side.net.x1 + side.net.x2) / FRAME_MID_DIVISOR;
      const netW = Math.abs(side.net.x2 - side.net.x1);
      this.add
        .rectangle(netCx, mouthCy, netW, mouthH, GF.NET_COLOR, GF.NET_ALPHA)
        .setDepth(GF.FRAME_DEPTH);
      // Cheap mesh: evenly spaced verticals across the net depth.
      for (let i = 1; i <= GF.NET_MESH_LINES; i++) {
        const lineX = side.net.x1 + (netW * i) / (GF.NET_MESH_LINES + 1);
        this.add
          .rectangle(lineX, mouthCy, GF.MESH_LINE_WIDTH_PX, mouthH, GF.NET_COLOR, GF.NET_ALPHA)
          .setDepth(GF.FRAME_DEPTH);
      }
      this.add
        .rectangle(side.postTop.cx, side.postTop.cy, side.postTop.w, side.postTop.h, GF.POST_COLOR, GF.POST_ALPHA)
        .setDepth(GF.FRAME_DEPTH);
      this.add
        .rectangle(side.postBottom.cx, side.postBottom.cy, side.postBottom.w, side.postBottom.h, GF.POST_COLOR, GF.POST_ALPHA)
        .setDepth(GF.FRAME_DEPTH);
      this.add
        .rectangle(side.crossbar.cx, side.crossbar.cy, side.crossbar.w, side.crossbar.h, GF.CROSSBAR_COLOR, GF.CROSSBAR_ALPHA)
        .setDepth(GF.FRAME_DEPTH);
    }
  }

  /**
   * Batch C (own-restart control): on the resume edge into PLAYING, hand the
   * human the nearest-to-ball home teammate (the taker stands on the ball, so
   * nearest == taker). Opponent restarts resolve to null and never steal
   * control. The GK is ineligible — selection never controls it.
   */
  private claimRestartControl(prevState: RestartControlKind): void {
    if (!this.manager || !this.ball) {
      return;
    }
    let team: 'home' | 'away' | null = null;
    if (prevState === 'KICKOFF') {
      team = this.manager.kickoffTeam;
    } else if (prevState === 'THROW_IN' || prevState === 'CORNER' || prevState === 'GOAL_KICK') {
      team = this.manager.lastRestartAward?.team ?? null;
    } else {
      return;
    }
    if (team !== 'home') {
      return;
    }
    const ineligible = new Set<number>();
    this.roles.home.forEach((role, i) => {
      if (role === 'GK') {
        ineligible.add(i);
      }
    });
    const id = restartControlId({
      kind: prevState,
      restartTeam: team,
      ball: { x: this.ball.sprite.x, y: this.ball.sprite.y },
      home: this.homeTeam.map((p) => ({ x: p.sprite.x, y: p.sprite.y })),
      ineligible,
    });
    if (id !== null) {
      // Playtest final: sync the selector with the claim (it must not
      // re-select its stale pick on the resume frame) and HOLD the taker
      // through PLAYING until the first kick of the ball.
      this.selectionSystem?.forceSelect(id);
      this.swapToHuman(id);
      this.controlHoldId = id;
    }
  }

  /** Batch B2: rolling frame-time stats for the dev console / debug overlay. */
  public getFrameTimeStats(): { avg: number; max: number; count: number } {
    return { avg: this.frameTime.avg, max: this.frameTime.max, count: this.frameTime.count };
  }

  /**
   * Phase 4 Batch A: surface friction multiplier reaching the ball each
   * frame, composed with the live ballFriction tuning knob.
   */
  private ballFrictionMultiplier(): number {
    const surface =
      this.weatherSystem?.frictionMultiplier ??
      BALANCE_CONFIG.PHYSICS.SURFACE_NEUTRAL_FRICTION;
    return surface * this.debugTuning.getValue('ballFriction');
  }

  /**
   * Phase 4 Batch A: applies the surface sprint modifier (section 13 —
   * shared by BOTH teams) and the live playerSpeed / passPower knobs through
   * the single speed path. Version-gated from update(); called once from
   * create().
   */
  private applySpeedAndPassTuning(): void {
    const sprint =
      this.weatherSystem?.sprintSpeedMultiplier ??
      BALANCE_CONFIG.PHYSICS.SURFACE_NEUTRAL_FRICTION;
    const maxSpeed =
      BALANCE_CONFIG.PHYSICS.PLAYER_MAX_SPEED *
      sprint *
      this.debugTuning.getValue('playerSpeed');
    const passPct = this.debugTuning.getValue('passPower');
    for (const p of this.homeTeam) {
      p.maxSpeed = maxSpeed;
      p.passPowerPct = passPct;
    }
    for (const p of this.awayTeam) {
      p.maxSpeed = maxSpeed;
      p.passPowerPct = passPct;
    }
    // Live camera lerp knob (mocked test harnesses may lack the method).
    const cam = this.cameraController as unknown as { setLerp?: (f: number) => void } | undefined;
    cam?.setLerp?.(this.debugTuning.getValue('cameraLerp'));
    this.lastTuningVersion = this.debugTuning.version;
  }

  /**
   * Phase 4 Batch A: cheap pitch visual evolution — full-pitch tint plus
   * deterministic worn patches (flat rects, config colors/counts, no RNG,
   * no particles). Drawn immediately after the pitch image so insertion
   * order keeps them under every entity.
   */
  private applySurfaceVisuals(): void {
    const level =
      this.weatherSystem?.pitchQuality ?? BALANCE_CONFIG.SURFACE.DEFAULT_LEVEL;
    const visuals = BALANCE_CONFIG.SURFACE.VISUALS[level];
    const phys = BALANCE_CONFIG.PHYSICS;
    if (visuals.TINT_ALPHA > 0) {
      this.add.rectangle(
        phys.PITCH_WIDTH / FRAME_MID_DIVISOR,
        phys.PITCH_HEIGHT / FRAME_MID_DIVISOR,
        phys.PITCH_WIDTH,
        phys.PITCH_HEIGHT,
        visuals.TINT_COLOR,
        visuals.TINT_ALPHA,
      );
    }
    const spanW = phys.PITCH_WIDTH - visuals.PATCH_INSET_PX * FRAME_MID_DIVISOR;
    const spanH = phys.PITCH_HEIGHT - visuals.PATCH_INSET_PX * FRAME_MID_DIVISOR;
    if (visuals.PATCH_COUNT <= 0 || spanW <= 0 || spanH <= 0) {
      return;
    }
    for (let i = 0; i < visuals.PATCH_COUNT; i++) {
      const px = visuals.PATCH_INSET_PX + (i * visuals.PATCH_STRIDE_X_PX) % spanW;
      const py = visuals.PATCH_INSET_PX + (i * visuals.PATCH_STRIDE_Y_PX) % spanH;
      this.add.rectangle(px, py, visuals.PATCH_W_PX, visuals.PATCH_H_PX, visuals.PATCH_COLOR, visuals.PATCH_ALPHA);
    }
  }

  /** Phase 4 Batch A (section 30): debug overlay toggle — off by default. */
  private toggleDebugOverlay(): void {
    this.debugVisible = !this.debugVisible;
    this.debugText?.setVisible(this.debugVisible);
    // Refresh immediately on enable; start from zero on disable.
    this.debugAccumMs = this.debugVisible ? BALANCE_CONFIG.DEBUG.UPDATE_INTERVAL_MS : 0;
  }

  /**
   * Phase 4 Batch A (section 30): cadence-gated debug panel refresh.
   * Hidden overlay returns at once — no gathering, no allocation.
   */
  private updateDebugOverlay(delta: number): void {
    if (!this.debugVisible || !this.debugText) {
      return;
    }
    const DBG = BALANCE_CONFIG.DEBUG;
    this.debugAccumMs += delta;
    if (this.debugAccumMs < DBG.UPDATE_INTERVAL_MS) {
      return;
    }
    this.debugAccumMs = 0;
    const ws = this.weatherSystem;
    const neutral = BALANCE_CONFIG.PHYSICS.SURFACE_NEUTRAL_FRICTION;
    const ballVel = this.ball?.body.velocity ?? { x: 0, y: 0 };
    const payload = buildDebugPayload({
      frameStats: this.getFrameTimeStats(),
      matchState: this.manager?.state ?? 'UNKNOWN',
      possessionHomePct:
        this.manager?.stats?.possessionPct('home') ?? DBG.PANEL.DEFAULT_POSSESSION_PCT,
      controlledPlayerId: this.humanPlayerId,
      selectionCandidates: this.selectionSystem?.getTopCandidates?.() ?? [],
      pressersHome: this.coordinatorHome?.getPresserIds?.().length ?? 0,
      pressersAway: this.coordinatorAway?.getPresserIds?.().length ?? 0,
      holderId: this.possession?.possessorId ?? null,
      ballX: this.ball?.sprite.x ?? 0,
      ballY: this.ball?.sprite.y ?? 0,
      ballZ: this.ball?.z ?? 0,
      ballSpeed: Math.hypot(ballVel.x, ballVel.y),
      surface: {
        level: ws?.pitchQuality ?? BALANCE_CONFIG.SURFACE.DEFAULT_LEVEL,
        weather: ws?.weatherType ?? BALANCE_CONFIG.WEATHER.DEFAULT_TYPE,
        frictionMultiplier: ws?.frictionMultiplier ?? neutral,
        sprintSpeedMultiplier: ws?.sprintSpeedMultiplier ?? neutral,
        receptionDifficulty: ws?.receptionDifficulty ?? neutral,
      },
      rngSeed: BALANCE_CONFIG.RNG.DEFAULT_SEED,
    });
    this.debugText.setText(formatDebugPayload(payload, this.debugTuning));
  }

  /** Batch B1: HUD label copy for the active tactics preset (config-driven). */
  private tacticsText(): string {
    const TC = BALANCE_CONFIG.TACTICS;
    const label = (TC.LABELS as Record<string, string>)[this.tacticsId] ?? this.tacticsId;
    return `${TC.LABEL_PREFIX}: ${label} (${TC.HINT_KEY})`;
  }

  // -------------------------------------------------------------------------
  // Settings/pause batch: scene-level pause (gating, never a manager state).
  // -------------------------------------------------------------------------

  /** Esc / PAUSA button toggle. Terminal states reject pausing (results is final). */
  public togglePause(): void {
    if (!this.paused && !canPauseMatch(this.manager?.state)) {
      return;
    }
    this.setPaused(!this.paused);
  }

  public get isPaused(): boolean {
    return this.paused;
  }

  private setPaused(paused: boolean): void {
    if (this.paused === paused) {
      return;
    }
    this.paused = paused;
    if (paused) {
      // A charge held across the pause never resumes: cancel it so a later
      // key release cannot fire a stale shot the moment we unpause.
      this.player?.cancelCharge();
      this.pauseMenu = new PauseMenuModel(this.matchSettings);
      this.pauseOverlay?.show(this.pauseMenu);
    } else {
      this.pauseOverlay?.hide();
    }
  }

  /** Pause-menu keyboard navigation (only while the overlay owns the input). */
  private pauseNavigate(delta: number): void {
    if (!this.paused || !this.pauseMenu) {
      return;
    }
    this.pauseMenu.move(delta);
    this.pauseOverlay?.render(this.pauseMenu);
  }

  /** Pause-menu live adjustment (volume/weather apply immediately). */
  private pauseAdjust(delta: number): void {
    if (!this.paused || !this.pauseMenu) {
      return;
    }
    this.applyPauseAdjust(this.pauseMenu.adjust(delta));
    this.pauseOverlay?.render(this.pauseMenu);
  }

  /** Pause-menu Enter (confirm the selected row). */
  private pauseConfirm(): void {
    if (!this.paused || !this.pauseMenu) {
      return;
    }
    this.handlePauseAction(this.pauseMenu.confirm());
  }

  /** Overlay row tap: move the cursor to the row, then confirm it. */
  private onPauseRowTap(row: PauseRow): void {
    if (!this.paused || !this.pauseMenu) {
      return;
    }
    const rows = this.pauseMenu.rows();
    const index = rows.indexOf(row);
    if (index >= 0) {
      this.pauseMenu.cursor = index;
    }
    this.handlePauseAction(this.pauseMenu.confirm());
  }

  /** Executes a pause-menu action (scene-side effects only). */
  private handlePauseAction(action: PauseAction): void {
    const menu = this.pauseMenu;
    if (!this.paused || !menu) {
      return;
    }
    switch (action) {
      case 'resume':
        this.setPaused(false);
        return;
      case 'restart':
        this.setPaused(false);
        this.manager?.restartToIntro();
        this.foulBanner?.hide();
        this.setPiece = null;
        this.beginEntrance();
        return;
      case 'settings':
        menu.openSettings();
        this.pauseOverlay?.render(menu);
        return;
      case 'back':
        menu.closeSettings();
        this.pauseOverlay?.render(menu);
        return;
      case 'quit':
        this.setPaused(false);
        this.scene.start('MenuScene', { settings: this.matchSettings });
        return;
      default:
        // null: a value row cycled via confirm — repaint only.
        this.pauseOverlay?.render(menu);
    }
  }

  /**
   * Applies a live pause-settings change: volume reaches AudioDirector (and
   * the synth bed) immediately; weather recomposes the modifiers with the
   * SAME pre-match surface and re-applies sprint through the single speed
   * path (section 13 — terreno/formación stay pre-match only).
   */
  private applyPauseAdjust(change: PauseAdjustChange | null): void {
    if (!change) {
      return;
    }
    if (change.volume !== undefined) {
      this.matchSettings.volume = change.volume;
      this.audio?.setMasterVolume(change.volume);
    }
    if (change.weather !== undefined) {
      this.matchSettings.weather = change.weather;
      this.weatherSystem = new WeatherSystem(
        DEFAULT_WEATHER_CONFIG,
        this.matchSettings.surface,
        change.weather,
      );
      this.applySpeedAndPassTuning();
    }
  }

  /** Batch B1: apply a preset to both coordinators + refresh the HUD label. */
  private applyTactics(id: TacticsId): void {
    if (this.paused) {
      return;
    }
    this.tacticsId = id;
    this.coordinatorHome?.setTactics(id);
    this.coordinatorAway?.setTactics(id);
    this.tacticsLabel?.setText(this.tacticsText());
  }

  /** Batch B1: T cycles Defensiva -> Equilibrada -> Ofensiva. */
  private cycleTactics(): void {
    const order: TacticsId[] = ['defensive', 'balanced', 'offensive'];
    const next = order[(order.indexOf(this.tacticsId) + 1) % order.length];
    this.applyTactics(next as TacticsId);
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
      // Batch 5 (A): the marker tracks selection switches instantly.
      this.indicatorModel.setSelectedId(newId);
      this.indicator?.setTarget(next.sprite);
      // Touch widgets are built once; attach retargets the controlled player.
      this.touchInput?.attach(this, next);
    }
  }

  /**
   * Shared human/touch match context (MC-1/MC-2). attackDir follows the
   * halftime side swap instead of staying hardcoded. Playtest final:
   * opponents feed the directional-pass openness score.
   */
  private buildHumanContext(): PassContext {
    return {
      getBallPos: () => ({ x: this.ball.sprite.x, y: this.ball.sprite.y }),
      getTeammates: () =>
        this.homeTeam
          .filter((p) => p !== this.player)
          .map((p) => ({ x: p.sprite.x, y: p.sprite.y })),
      getOpponents: () =>
        this.awayTeam.map((p) => ({ x: p.sprite.x, y: p.sprite.y })),
      attackDir: this.homeAttackDir,
    };
  }

  /**
   * Batch 5 (D+E): applies the halftime side swap to coordinators and input
   * contexts exactly once per swap edge.
   */
  private syncSideSwap(): void {
    const swapped = this.manager?.sidesSwapped ?? false;
    if (swapped === this.lastSidesSwapped) {
      return;
    }
    this.lastSidesSwapped = swapped;
    this.homeAttackDir = this.manager?.attackDirection('home') ?? 1;
    this.coordinatorHome?.setSidesSwapped(swapped);
    this.coordinatorAway?.setSidesSwapped(swapped);
    this.humanController?.setContext(this.buildHumanContext());
    this.touchInput?.setContext(this.buildHumanContext());
  }

  /**
   * AI kick dispatch: SHOOT/PASS/DISTRIBUTE trigger a guarded kick toward the
   * command target. Defense-in-depth (kickGate): the command is ignored unless
   * the match is PLAYING and the kicker is next to the ball — a stale command
   * surviving a restart can never send the center-spot ball flying into the
   * wrong half.
   */
  private handleAIKick(p: Player, cmd: AICommand): void {
    if (this.paused) {
      return;
    }
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
      if (cmd.action === 'PASS') {
        this.pendingPassTarget.set(p, { x: cmd.targetX, y: cmd.targetY });
      }
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
      // Settings/pause batch: while paused the match state stays PLAYING, so
      // the state gate below would pass — the pause gate is mandatory here
      // (single choke point for human AND AI kick paths).
      if (this.paused) {
        return;
      }
      // Phase 4 Batch A: live shot-power tuning knob (session-only, section
      // 30) — clamped so a debug knob can never break the kick contract.
      const tunedPower = Phaser.Math.Clamp(
        power * this.debugTuning.getValue('shotPower'),
        0,
        1,
      );
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
          ? applyKickoffGracePowerCap(tunedPower, this.playResumedAtMs, this.currentTimeMs)
          : tunedPower;
      this.ball.applyKick(facing, effectivePower);
      // Playtest final: the first applied kick of the ball releases the
      // restart/set-piece control hold — normal auto-selection resumes.
      this.controlHoldId = null;
      // Batch B2 (resume on kick): a kick taken from a set piece restarts play.
      this.manager?.notifySetPieceKick();
      // Batch A: kick-path stats feed (PASS vs KICK) for the halftime banner.
      if (meta) {
        if (kindEvent === 'PASS') {
          this.manager?.recordPass(meta.team);
        } else {
          this.manager?.recordShot(meta.team);
        }
      }
      // Playtest round 3 pass feel: a pass is visibly lifted and the intended
      // receiver gets a widened capture radius for the arrival moment.
      if (kindEvent === 'PASS') {
        this.ball.zTarget = Math.max(this.ball.zTarget, BALANCE_CONFIG.INPUT.PASS_LIFT_Z);
        const hintTarget = p.lastPassTarget ?? this.pendingPassTarget.get(p);
        if (hintTarget) {
          this.possession?.setPassHint(hintTarget);
        }
      }
      this.pendingPassTarget.delete(p);
      // PRES-2 + MC-1: PASS vs KICK hint (AI map or human contextual pass).
      this.pendingShotKind.delete(p);
      this.audio?.playEvent(kindEvent);
      // Phase 4 Batch A: shot-impact shake moved to FEEDBACK.SHOT_SHAKE
      // config (zero-literals rule).
      const shake = BALANCE_CONFIG.FEEDBACK.SHOT_SHAKE;
      if (effectivePower > shake.POWER_THRESHOLD) {
        const magnitude = Phaser.Math.Clamp(
          effectivePower * shake.POWER_SCALE,
          shake.MAGNITUDE_MIN,
          shake.MAGNITUDE_MAX,
        );
        this.cameras.main.shake(shake.DURATION_MS, magnitude);
      }
    });
  }
}
