export const BALANCE_CONFIG = {
  MATCH: {
    DURATION_REAL_MINUTES: 3,
    GAME_TIME_SCALE: 3,
    TIME_REMAINING_GAME_SECONDS: 540,
    KICKOFF_PAUSE_MS: 1500,
    GOAL_PAUSE_MS: 2000,
    OUT_OF_BOUNDS_PAUSE_MS: 2000,
    // Playtest round 2: after any transition into PLAYING, kicks aimed at the
    // kicker's own half are suppressed for this window (kickoff own-goal guard).
    KICKOFF_GRACE_MS: 800,
    // Playtest round 3: during the grace window a charged KICK power is capped
    // so a kickoff blast can never be an unstoppable 600px/s free-goal; the
    // capped flight is interceptable by field players and the GK.
    KICKOFF_GRACE_SHOT_CAP: 0.5,
  },
  PHYSICS: {
    PITCH_WIDTH: 960,
    PITCH_HEIGHT: 540,
    BALL_BOUNCE: 0.8,
    BALL_FRICTION: 0.1,
    BALL_MAX_IMPULSE: 600,
    BALL_MIN_KICK_THRESHOLD: 0.15,
    BALL_MAX_Z: 60,
    PLAYER_MAX_SPEED: 220,
    PLAYER_DRAG: 0.8,
    PLAYER_MAX_CHARGE_MS: 1000,
    PLAYER_KICK_DURATION_MS: 200,
  },
  AI: {
    TICK_MS: 150,    ANCHOR_TOLERANCE_PX: 40,
    CAPTURE_RADIUS_PX: 14,
    POSSESSABLE_Z: 15,
    CONTROL_RADIUS_PX: 22,
    PRESS_COUNT_MAX: 2,
    SHOOT_RANGE_PX: 120,
    // Playtest round 2 (jitter) hysteresis: a ball holder that steps outside
    // CONTROL_RADIUS for a few frames keeps the dribble intent; presser slots
    // only swap when the challenger is closer by more than this margin.
    BALL_HOLDER_GRACE_MS: 600,
    PRESS_SWITCH_MARGIN_PX: 30,
    // Playtest round 3 (ball must never travel through players): sticky-trap
    // interception tuning used by BallCaptureSystem. A field player traps the
    // ball when its path crosses their body AND it arrives slower than
    // TRAP_MAX_SPEED_PX_S; the GK claims at any speed within CLAIM_RADIUS.
    // Balls above INTERCEPT_MAX_Z fly over heads and are never trapped.
    TRAP_MAX_SPEED_PX_S: 340,
    INTERCEPT_MAX_Z: 12,
    // Playtest round 3 (locomotion smoothing): arrival damping radius —
    // speed scales linearly inside it down to ARRIVAL_MIN_SPEED_PCT; and a
    // small deterministic idle-wander orbit so at-anchor players never
    // freeze in place (kills the "straight line robot" feel).
    ARRIVAL_RADIUS_PX: 28,
    ARRIVAL_MIN_SPEED_PCT: 0.25,
    IDLE_WANDER_RADIUS_PX: 6,
    IDLE_WANDER_SPEED: 0.002,
  },
  SELECTION: {
    W1: 1.0,
    W2: 0.9,
    HYSTERESIS_PX: 150,
    COOLDOWN_MS: 300,
    DIST_MAX_PX: 720,
    ENGAGED_PENALTY: 0.3,
    INTERCEPT_RADIUS_PX: 48,
  },
  GK: {
    TRACK_RADIUS_PX: 260,
    CLAIM_RADIUS_PX: 46,
    DIVE_RADIUS_PX: 120,
    DIVE_TRIGGER_SPEED: 200,
    DIVE_DURATION_MS: 400,
    GK_HOLD_MS: 700,
  },
  // Camera follow (PRES-1): weighting between controlled player and ball,
  // velocity look-ahead, per-frame lerp, per-formation zoom (playtest: 1.15
  // showed the whole pitch and made characters illegible; closer zooms keep
  // action readable per AGENTS.md §9) and edge clamp allowance (margin of
  // visible dead space beyond the pitch, in px).
  CAMERA: {
    LERP: 0.08,
    LOOK_AHEAD: 0.15,
    ZOOM_3V3: 1.6,
    ZOOM_5V5: 1.4,
    ZOOM_11V11: 1.25,
    PLAYER_WEIGHT: 0.4,
    BALL_WEIGHT: 0.6,
    CLAMP_MARGIN: 0,
  },
  // Fase 4 GOLPE LEGIBLE (1.2): human input buffer + contextual pass gating.
  INPUT: {
    BUFFER_MS: 150,
    PASS_PICKUP_RADIUS_PX: 28,
    PASS_CONE_DEG: 45,
    PASS_MAX_RANGE_PX: 260,
    EMPTY_CONE_FALLBACK: 'none' as const,
    PASS_POWER_PCT: 0.4,
  },
  // Playtest round 3 (controls discoverability): static controls hint shown
  // during KICKOFF and the first seconds of PLAYING.
  UI: {
    CONTROLS_HINT_MS: 15000,
    CONTROLS_HINT_TEXT: 'Flechas moverse · J pase · K tiro (mantener p/ cargar)',
  },
  // Fase 4 GOLPE LEGIBLE (3.2): charge power meter HUD geometry/colors.
  POWER_METER: {
    WIDTH_PX: 120,
    HEIGHT_PX: 10,
    Y_OFFSET_PX: -40,
    COLOR_LOW: 0x4caf50,
    COLOR_HIGH: 0xf44336,
  },
  // Fase 4 GOLPE LEGIBLE (5.x): post band geometry, net flash timing,
  // goal-mouth band reference and the boundary rule for classification.
  FEEDBACK: {
    NET_FLASH_MS: 600,
    POST_BAND_HEIGHT_PX: 24,
    POST_BOUNDARY_INCLUSIVE: true,
    GOAL_MOUTH_CENTER_Y_PX: 270,
    GOAL_MOUTH_HALF_HEIGHT_PX: 70,
  },
  // Contextual restarts (RULE-1/RULE-2): throw-in support bubble, corner
  // geometry, 6yd goal-kick spot, and the corner-exit tolerance.
  RESTART: {
    CORNER_EPSILON_PX: 8,
    THROW_IN_SUPPORT_COUNT: 2,
    THROW_IN_SUPPORT_RADIUS_PX: 120,
    CORNER_ARC_OFFSET_PX: 20,
    CORNER_BOX_ATTACKERS: 3,
    CORNER_BOX_DEFENDERS: 3,
    GOAL_KICK_SPOT_X_PX: 60,
  },
};
