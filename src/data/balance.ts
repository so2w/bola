// Playtest final (goal alignment): the single source of truth for goal
// geometry — shared verbatim with scripts/generate-sprites.js so the drawn
// goal frames, the detection zones and the painted pitch markings can never
// drift apart (tests/goalGeometry.spec.ts locks the contract).
import goalGeometry from './goalGeometry.json';
import type { PitchQuality, WeatherType } from '../match/WeatherSystem';
import type { FormationId } from './formations';

export const BALANCE_CONFIG = {
  MATCH: {
    DURATION_REAL_MINUTES: 3,
    GAME_TIME_SCALE: 3,
    TIME_REMAINING_GAME_SECONDS: 540,
    KICKOFF_PAUSE_MS: 1500,
    GOAL_PAUSE_MS: 2000,
    OUT_OF_BOUNDS_PAUSE_MS: 2000,
    // Halftime breather (batch 5, D+E): PLAYING pauses into HALF at
    // mid-duration with the clock stopped, sides swap, then a KICKOFF resumes.
    HALF_PAUSE_MS: 2500,
    // Batch B1 (full time): whistle-to-panel pause between FULL_TIME and
    // RESULTS. Clocks that omit it fall back to this default so legacy
    // short test clocks still advance deterministically.
    FULL_TIME_PAUSE_MS: 2000,
    // Playtest round 2: after any transition into PLAYING, kicks aimed at the
    // kicker's own half are suppressed for this window (kickoff own-goal guard).
    KICKOFF_GRACE_MS: 800,
    // Playtest round 3: during the grace window a charged KICK power is capped
    // so a kickoff blast can never be an unstoppable 600px/s free-goal; the
    // capped flight is interceptable by field players and the GK.
    KICKOFF_GRACE_SHOT_CAP: 0.5,
    // Batch A (player entrance): pre-match walk-in budget + skip flag.
    // INTRO is opt-in per clock (MatchManager.enterIntro) so legacy test
    // clocks that never call it stay on KICKOFF.
    INTRO_DURATION_MS: 4000,
    INTRO_SKIPPABLE: true,
  },
  PHYSICS: {
    PITCH_WIDTH: goalGeometry.PITCH_WIDTH_PX,
    PITCH_HEIGHT: goalGeometry.PITCH_HEIGHT_PX,
    BALL_BOUNCE: 0.8,
    BALL_FRICTION: 0.1,
    BALL_MAX_IMPULSE: 600,
    BALL_MIN_KICK_THRESHOLD: 0.15,
    BALL_MAX_Z: 60,
    // Vertical (Z) ballistics: semi-implicit Euler on z/vz with gravity,
    // restitution < 1 on landing and rest snapping (docs/adr/0001).
    BALL_GRAVITY_Z_PX_S2: 2000,
    BALL_KICK_VZ_MAX_PX_S: 500,
    BALL_RESTITUTION_Z: 0.55,
    BALL_REST_Z_PX: 2,
    BALL_REST_VZ_PX_S: 90,
    // Rolling resistance on the ground (per-second velocity fraction).
    BALL_GROUND_DRAG_PER_S: 1.0,
    BALL_ROLL_STOP_PX_S: 8,
    // Shadow follows x/y with a fixed offset and shrinks/fades with z.
    BALL_SHADOW_Y_OFFSET_PX: 4,
    BALL_SHADOW_SCALE_SHRINK: 0.6,
    BALL_SHADOW_ALPHA_BASE: 0.6,
    BALL_SHADOW_ALPHA_FADE: 0.5,
    BALL_SHADOW_ALPHA_MIN: 0.1,
    // Surface seam default: neutral multiplier (future WeatherSystem plugs in).
    SURFACE_NEUTRAL_FRICTION: 1.0,
    // Remediation (game feel): match pace cut ~16% so carriers can be seen
    // before the pass. Old value 220.
    PLAYER_MAX_SPEED: 185,
    PLAYER_DRAG: 0.8,
    PLAYER_MAX_CHARGE_MS: 1000,
    PLAYER_KICK_DURATION_MS: 200,
  },
  AI: {
    TICK_MS: 150,    ANCHOR_TOLERANCE_PX: 40,
    CAPTURE_RADIUS_PX: 16,
    POSSESSABLE_Z: 15,
    // Remediation: carrier keeps the ball at feet longer (old 22) so
    // dribbling before passing is viable; receptions seal earlier.
    CONTROL_RADIUS_PX: 26,
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
    // Fase 4 carrier feel (W1 follow-up): the ball holder no longer runs a
    // perfect straight line at the goal. Small deterministic heading wobble
    // (pure f(time, entity phase)), pressure-based speed modulation from
    // per-tick opponent counts, an open-lane boost, and a curved approach
    // that rotates the goal target away from the nearest ahead defender.
    DRIBBLE_WOBBLE_AMPLITUDE_DEG: 8,
    DRIBBLE_WOBBLE_PERIOD_MS: 900,
    DRIBBLE_PRESSURE_SLOW_PX: 90,
    DRIBBLE_PRESSURE_SLOW_FACTOR: 0.75,
    DRIBBLE_PRESSURE_REF_COUNT: 3,
    // Remediation: carriers stop sprinting away from the ball (old 1.1).
    DRIBBLE_OPEN_LANE_BOOST: 1.02,
    DRIBBLE_CURVE_MAX_DEG: 25,
    DRIBBLE_CURVE_RANGE_PX: 160,
    DRIBBLE_CORRIDOR_HALF_WIDTH_PX: 40,
    // Phase 2 closure (small-sided AI): field-player passing + off-ball support.
    // AI_PASS_TENDENCY is the probability the holder passes when choosePassTarget
    // finds an open teammate (seeded rng — deterministic); AI_PASS_ERROR_PX bounds
    // the symmetric pass-target jitter so AI feel matches human pass gates.
    AI_PASS_TENDENCY: 0.65,
    AI_PASS_ERROR_PX: 18,
    // Off-ball attack support (arcade-y, no tactics presets): teammates shift
    // forward by PUSH plus away-from-nearest-opponent SPACING (only inside
    // AVOID_RADIUS), clamped so |target - anchor| <= MAX_SHIFT.
    AI_SUPPORT_PUSH_PX: 50,
    AI_SUPPORT_SPACING_PX: 36,
    AI_SUPPORT_AVOID_RADIUS_PX: 120,
    AI_SUPPORT_MAX_SHIFT_PX: 90,
    // Batch C (visible help, AGENTS.md section 11 — shape preserved): the
    // closest OPEN support-eligible teammate (no opponent inside OPEN_RADIUS)
    // gets EXTRA_PUSH on top of the base push so the lane offer reads on
    // screen; a holder with a clearly-best lane (target inside LANE_RANGE
    // with no opponent inside the LANE_CORRIDOR segment) passes at once
    // instead of rolling the tendency dice.
    AI_LANE_OFFER_EXTRA_PUSH_PX: 40,
    AI_LANE_OPEN_RADIUS_PX: 120,
    AI_HOLDER_LANE_RANGE_PX: 300,
    AI_HOLDER_LANE_CORRIDOR_PX: 50,
    // Living movement batch (AGENTS.md section 11 — shape preserved): every
    // value below bounds how far off-ball players may drift from their
    // anchors, so the block slides and breathes without ever collapsing.
    // Ball-side block slide: the whole outfield translates toward the ball by
    // the ball's offset from pitch center scaled per axis, clamped per axis.
    AI_BLOCK_SHIFT_X_WEIGHT: 0.12,
    AI_BLOCK_SHIFT_Y_WEIGHT: 0.25,
    AI_BLOCK_SHIFT_MAX_X_PX: 40,
    AI_BLOCK_SHIFT_MAX_Y_PX: 60,
    // Defenders never cross to the attacking side of the ball: DF targets
    // clamp to this margin goal-side of the ball along the attack axis.
    AI_BLOCK_SHIFT_GOAL_SIDE_MARGIN_PX: 30,
    // Turnover runs: on possession loss the nearest RECOVERY_COUNT
    // non-pressers sprint goal-side of their anchors for RECOVERY_WINDOW_MS;
    // on possession win the ATTACK_RUN_COUNT most advanced attackers break
    // forward with EXTRA_PUSH (still clamped by AI_SUPPORT_MAX_SHIFT_PX).
    AI_RECOVERY_WINDOW_MS: 1500,
    AI_RECOVERY_COUNT: 2,
    AI_RECOVERY_DEPTH_PX: 60,
    // Remediation: recovery runs stop warping past carriers (old 1.2).
    AI_RECOVERY_SPEED_FACTOR: 1.05,
    AI_ATTACK_RUN_WINDOW_MS: 1500,
    AI_ATTACK_RUN_COUNT: 2,
    AI_ATTACK_RUN_EXTRA_PUSH_PX: 60,
    // Idle sway: deterministic target-level breathing f(player id, nowMs) so
    // nobody freezes on the anchor; radius keeps it visible yet in shape.
    AI_IDLE_SWAY_RADIUS_PX: 8,
    AI_IDLE_SWAY_PERIOD_MS: 2600,
    // Defensive tracking (positioning only, DF role): non-presser defenders
    // blend their anchor toward a point GOAL_SIDE_PX behind (goal-side of)
    // the nearest threat inside TRACK_RADIUS_PX, bounded by MAX_SHIFT.
    AI_TRACK_WEIGHT: 0.35,
    AI_TRACK_GOAL_SIDE_PX: 24,
    AI_TRACK_RADIUS_PX: 220,
    AI_TRACK_MAX_SHIFT_PX: 70,
    // Remediation (shot placement): AI aim spreads across the mouth plus a
    // bounded margin, so corners are reachable and shots can miss the frame
    // (TouchTracker byline rules then award corner/goal kick as before).
    SHOT_MISS_MARGIN_PX: 28,
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
    // Remediation: slower overall play still triggers visible dives (old 200).
    DIVE_TRIGGER_SPEED: 180,
    DIVE_DURATION_MS: 400,
    GK_HOLD_MS: 700,
    // Phase 2 closure (GK movement profile): the keeper no longer moves exactly
    // like a field player. Locomotion caps to GK_MAX_SPEED_PX_S and per-frame
    // velocity change clamps to GK_ACCEL_PX_S2 (see AIController isGK branch and
    // docs/adr/0002-gk-tick-cadence.md). Dive reach stays interceptable: burst
    // speed < BALL_MAX_IMPULSE, accel reaches max in ~150ms.
    // Remediation pace: keeper top speed follows the field cut (old 200),
    // accel keeps the ~150ms reach (old 1400).
    GK_MAX_SPEED_PX_S: 170,
    GK_ACCEL_PX_S2: 1200,
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
    EMPTY_CONE_FALLBACK: 'forward' as 'none' | 'forward',
    // Remediation: passes ~20% slower (old 0.4) so receivers read on screen.
    PASS_POWER_PCT: 0.32,
    // Playtest round 3 (pass feel): passes are visibly lifted (z bump) and the
    // intended receiver gets a short possession hint (wider capture radius).
    PASS_LIFT_Z: 26,
    // Remediation: more time to see the receiver (old 900).
    PASS_HINT_MS: 1100,
    // Playtest final (directional passing): the human pass targets by AIM
    // direction — the best receiver inside a cone around the input direction
    // (any heading, wider than the forward-only PASS_CONE_DEG auto cone),
    // scored by distance + openness. Neutral input falls back to the
    // forward-cone auto-choice; quick buffered taps aim with the direction
    // held at press time. Human-input only — AI pass targeting is unchanged.
    PASS_AIM: {
      CONE_DEG: 75,
      DISTANCE_WEIGHT: 0.6,
      OPENNESS_WEIGHT: 0.4,
      OPENNESS_RADIUS_PX: 120,
      MIN_CANDIDATES: 1,
    },
  },
  // Touch input proto (Batch 2): virtual left stick + contextual A/B buttons.
  // The stick reports deflection as a fraction of STICK_RADIUS_PX; movement
  // intent is dead-zoned, EMA-filtered per update and quantized to
  // STICK_DIRECTIONS headings for stable control. Widget geometry targets
  // the landscape corners so the action stays uncovered.
  INPUT_TOUCH: {
    STICK_DEAD_ZONE: 0.2,
    STICK_FILTER_ALPHA: 0.35,
    STICK_DIRECTIONS: 16,
    STICK_RADIUS_PX: 90,
    STICK_THUMB_RADIUS_PX: 36,
    STICK_CENTER_X: 140,
    STICK_CENTER_Y: 400,
    STICK_BASE_COLOR: 0xffffff,
    STICK_BASE_ALPHA: 0.18,
    STICK_THUMB_COLOR: 0xffffff,
    STICK_THUMB_ALPHA: 0.45,
    BUTTON_RADIUS_PX: 44,
    BUTTON_A_X: 772,
    BUTTON_A_Y: 400,
    BUTTON_B_X: 884,
    BUTTON_B_Y: 400,
    BUTTON_A_COLOR: 0x4caf50,
    BUTTON_B_COLOR: 0xf44336,
    BUTTON_ALPHA: 0.5,
    BUTTON_LABEL_COLOR: '#ffffff',
    BUTTON_LABEL_FONT_SIZE: '28px',
    WIDGET_DEPTH: 10,
  },
  // Playtest round 3 (controls discoverability): static controls hint shown
  // during KICKOFF and the first seconds of PLAYING.
  UI: {
    CONTROLS_HINT_MS: 15000,
    CONTROLS_HINT_TEXT: 'Moverse: WASD/Flechas/stick · Pasar: A/J · Tirar: S/K (mantener)',
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
    GOAL_MOUTH_CENTER_Y_PX: goalGeometry.GOAL_MOUTH_CENTER_Y_PX,
    GOAL_MOUTH_HALF_HEIGHT_PX: goalGeometry.GOAL_MOUTH_HALF_HEIGHT_PX,
    // Phase 4 Batch A: shot-impact camera shake (previously inline literals
    // in MatchScene.wireShots — moved to config per the zero-literals rule).
    SHOT_SHAKE: {
      POWER_THRESHOLD: 0.6,
      DURATION_MS: 100,
      POWER_SCALE: 0.02,
      MAGNITUDE_MIN: 0.008,
      MAGNITUDE_MAX: 0.02,
    },
  },
  // Phase 4 Batch A (AGENTS.md section 13): every WeatherSystem number lives
  // here — the system itself is config-driven and clamped. Surface level is
  // chosen by config for now; the stadium evolution that upgrades the pitch
  // is Phase 6.
  SURFACE: {
    DEFAULT_LEVEL: 'REGULAR_GRASS' as PitchQuality,
    LEVELS: {
      DIRT: { FRICTION_MULT: 1.3, SPRINT_MULT: 0.9, RECEPTION_DIFFICULTY: 1.2 },
      IRREGULAR_GRASS: { FRICTION_MULT: 1.15, SPRINT_MULT: 0.95, RECEPTION_DIFFICULTY: 1.1 },
      REGULAR_GRASS: { FRICTION_MULT: 1.0, SPRINT_MULT: 1.0, RECEPTION_DIFFICULTY: 1.0 },
      PROFESSIONAL_GRASS: { FRICTION_MULT: 0.95, SPRINT_MULT: 1.05, RECEPTION_DIFFICULTY: 0.9 },
    },
    // Section 13 hard limits: a bad pitch must never fully randomize or
    // cripple play — every composed modifier clamps into these bounds.
    CLAMPS: {
      FRICTION_MIN: 0.5,
      FRICTION_MAX: 2.0,
      SPRINT_MIN: 0.5,
      SPRINT_MAX: 1.25,
      RECEPTION_MIN: 0.5,
      RECEPTION_MAX: 1.5,
    },
    // Pitch visual evolution on the cheap (section 3 budget: flat rects only,
    // no particles). Patches scatter deterministically via modular strides
    // (no RNG in game code); geometry/colors/counts all config-driven.
    VISUALS: {
      DIRT: {
        TINT_COLOR: 0x8a6d3b,
        TINT_ALPHA: 0.1,
        PATCH_COUNT: 14,
        PATCH_COLOR: 0x6b4f2a,
        PATCH_ALPHA: 0.2,
        PATCH_W_PX: 96,
        PATCH_H_PX: 30,
        PATCH_STRIDE_X_PX: 173,
        PATCH_STRIDE_Y_PX: 97,
        PATCH_INSET_PX: 60,
      },
      IRREGULAR_GRASS: {
        TINT_COLOR: 0x9aa84a,
        TINT_ALPHA: 0,
        PATCH_COUNT: 8,
        PATCH_COLOR: 0x7d8f3f,
        PATCH_ALPHA: 0.14,
        PATCH_W_PX: 70,
        PATCH_H_PX: 22,
        PATCH_STRIDE_X_PX: 151,
        PATCH_STRIDE_Y_PX: 89,
        PATCH_INSET_PX: 60,
      },
      REGULAR_GRASS: {
        TINT_COLOR: 0,
        TINT_ALPHA: 0,
        PATCH_COUNT: 0,
        PATCH_COLOR: 0,
        PATCH_ALPHA: 0,
        PATCH_W_PX: 0,
        PATCH_H_PX: 0,
        PATCH_STRIDE_X_PX: 0,
        PATCH_STRIDE_Y_PX: 0,
        PATCH_INSET_PX: 0,
      },
      PROFESSIONAL_GRASS: {
        TINT_COLOR: 0,
        TINT_ALPHA: 0,
        PATCH_COUNT: 0,
        PATCH_COLOR: 0,
        PATCH_ALPHA: 0,
        PATCH_W_PX: 0,
        PATCH_H_PX: 0,
        PATCH_STRIDE_X_PX: 0,
        PATCH_STRIDE_Y_PX: 0,
        PATCH_INSET_PX: 0,
      },
    },
  },
  // Phase 4 Batch A: weather profiles compose multiplicatively on top of the
  // surface level. MVP default is CLEAR_DAY (the "no effect" type); per-match
  // weather selection arrives with a later batch.
  WEATHER: {
    DEFAULT_TYPE: 'CLEAR_DAY' as WeatherType,
    TYPES: {
      CLEAR_DAY: { FRICTION_MULT: 1.0, SPRINT_MULT: 1.0, RECEPTION_DIFFICULTY: 1.0 },
      NIGHT: { FRICTION_MULT: 1.0, SPRINT_MULT: 1.0, RECEPTION_DIFFICULTY: 1.0 },
      RAIN: { FRICTION_MULT: 0.85, SPRINT_MULT: 1.0, RECEPTION_DIFFICULTY: 1.0 },
      // HEAT: small sprint/control cost only. The energy drain belongs to the
      // Phase 6 EnergySystem — documented no-op on energy until then.
      HEAT: { FRICTION_MULT: 1.0, SPRINT_MULT: 0.95, RECEPTION_DIFFICULTY: 1.05 },
      SNOW: { FRICTION_MULT: 1.2, SPRINT_MULT: 0.9, RECEPTION_DIFFICULTY: 1.1 },
    },
    CLAMPS: {
      FRICTION_MIN: 0.5,
      FRICTION_MAX: 2.0,
      SPRINT_MIN: 0.5,
      SPRINT_MAX: 1.25,
      RECEPTION_MIN: 0.5,
      RECEPTION_MAX: 1.5,
    },
    // RAIN streak overlay intentionally skipped for the 60fps mobile budget
    // (section 3): re-evaluate with pooled objects after profiling.
    VISUALS: { RAIN_STREAKS_ENABLED: false },
  },
  // Deterministic RNG source (section 28): the single seed every system
  // defaults to; surfaced in the debug overlay (section 30).
  RNG: {
    DEFAULT_SEED: 1,
  },
  // Phase 4 Batch A (debug observability, AGENTS.md section 30): overlay
  // panel + live tuning keys. Never visible by default; every layout value,
  // color and key name lives here. Tuning overrides are session-only — they
  // apply on top of BALANCE_CONFIG and are never persisted.
  DEBUG: {
    TOGGLE_KEY: 'F3',
    ADJUST_DOWN_KEY: 'MINUS',
    ADJUST_UP_KEY: 'PLUS',
    CYCLE_KNOB_KEY: 'BACKTICK',
    UPDATE_INTERVAL_MS: 250,
    PANEL: {
      X_PX: 12,
      Y_PX: 56,
      FONT_FAMILY: 'monospace',
      FONT_SIZE_PX: '13px',
      LINE_SPACING_PX: 2,
      TEXT_COLOR: '#00ff66',
      BG_COLOR: 'rgba(0, 0, 0, 0.55)',
      PADDING: { left: 8, right: 8, top: 6, bottom: 6 },
      MAX_CANDIDATES: 3,
      DEFAULT_POSSESSION_PCT: 50,
      DEPTH: 40,
      SCROLL_FACTOR: 0,
    },
    // Live tuning knobs (section 30 "when practical"): passPower and
    // cameraLerp defaults mirror INPUT.PASS_POWER_PCT / CAMERA.LERP —
    // the debug spec locks the mirror so they cannot drift.
    // Remediation: passPower default follows the feel cut (old 0.4).
    TUNING: {
      KNOBS: [
        { KEY: 'playerSpeed', LABEL: 'player speed', MIN: 0.5, MAX: 1.5, STEP: 0.05, DEFAULT: 1 },
        { KEY: 'ballFriction', LABEL: 'ball friction', MIN: 0.5, MAX: 2, STEP: 0.05, DEFAULT: 1 },
        { KEY: 'passPower', LABEL: 'pass power', MIN: 0.1, MAX: 0.9, STEP: 0.05, DEFAULT: 0.32 },
        { KEY: 'shotPower', LABEL: 'shot power', MIN: 0.5, MAX: 2, STEP: 0.05, DEFAULT: 1 },
        { KEY: 'cameraLerp', LABEL: 'camera lerp', MIN: 0.01, MAX: 0.5, STEP: 0.01, DEFAULT: 0.08 },
      ],
    },
  },
  // Batch C (visible goal frames): posts + crossbar + cheap net drawn in
  // MatchScene from this geometry. Goal-line X values and the zone size are
  // derived from the shared goal geometry (same file the sprite generator
  // paints its markings from); the mouth height equals 2x
  // FEEDBACK.GOAL_MOUTH_HALF_HEIGHT_PX so drawn posts sit on the POST bands.
  // The net protrudes outward beyond each goal line.
  // Remediation: GOAL_MAX_Z_PX is the crossbar height gate — balls crossing
  // the line above it are not goals.
  GOAL_FRAME: {
    LEFT_GOAL_X_PX: goalGeometry.GOAL_LINE_LEFT_X_PX,
    RIGHT_GOAL_X_PX: goalGeometry.GOAL_LINE_RIGHT_X_PX,
    GOAL_ZONE_WIDTH_PX: goalGeometry.GOAL_ZONE_WIDTH_PX,
    GOAL_ZONE_HEIGHT_PX: goalGeometry.GOAL_ZONE_HEIGHT_PX,
    GOAL_MAX_Z_PX: 40,
    POST_WIDTH_PX: 6,
    POST_COLOR: 0xffffff,
    POST_ALPHA: 1,
    CROSSBAR_COLOR: 0xffffff,
    CROSSBAR_ALPHA: 1,
    NET_DEPTH_PX: 30,
    NET_COLOR: 0xffffff,
    NET_ALPHA: 0.25,
    NET_MESH_LINES: 4,
    MESH_LINE_WIDTH_PX: 1,
    FRAME_DEPTH: 8,
  },
  // Batch C (foul signal): transient FALTA/PENAL banner reusing the
  // HalftimeBanner overlay pattern. Copy + timing + geometry all live here.
  FOUL_BANNER: {
    CENTER_X_PX: 480,
    CENTER_Y_PX: 120,
    PANEL_W_PX: 220,
    PANEL_H_PX: 56,
    FONT_FAMILY: 'monospace',
    FONT_SIZE_PX: '28px',
    TEXT_COLOR: '#ffffff',
    BG_COLOR: 0x000000,
    BG_ALPHA: 0.7,
    FREE_KICK_TEXT: 'FALTA',
    PENALTY_TEXT: 'PENAL',
    DURATION_MS: 1500,
    DEPTH: 26,
    SCROLL_FACTOR: 0,
    CENTER_ORIGIN: 0.5,
  },
  // Contextual restarts (RULE-1/RULE-2): throw-in support bubble, corner
  // geometry, 6yd goal-kick spot, and the corner-exit tolerance.
  RESTART: {    CORNER_EPSILON_PX: 8,
    THROW_IN_SUPPORT_COUNT: 2,
    THROW_IN_SUPPORT_RADIUS_PX: 120,
    // Batch 5 (throw-in placement): thrower + ball step this far INSIDE from
    // the touchline instead of spawning exactly on the boundary line (the
    // on-the-line spawn fought Arcade collideWorldBounds and sat one pixel
    // from an immediate re-exit).
    THROW_IN_INSET_PX: 24,
    // Batch 5 (kickoff placement): no outfield player starts a kickoff past
    // the halfway line — anchors crossing midfield clamp to this margin on
    // their own half (home left of center, away right of center).
    KICKOFF_HALF_MARGIN_PX: 40,
    CORNER_ARC_OFFSET_PX: 20,
    CORNER_BOX_ATTACKERS: 3,
    CORNER_BOX_DEFENDERS: 3,
    GOAL_KICK_SPOT_X_PX: 60,
  },
  // Batch A (player entrance, AGENTS.md section 7 INTRO state): both teams
  // spawn below the bottom touchline (tunnel/sideline) and walk to their
  // kickoff anchors. Walk speed matches field-player pace so arrival lands
  // well inside INTRO_TIMEOUT_MS; any-key/tap skips when SKIPPABLE.
  ENTRANCE: {
    ENTRANCE_Y_OFFSET_PX: 48,
    // Remediation pace parity with the field cut (old 220).
    ENTRANCE_WALK_SPEED_PX_S: 185,
    ENTRANCE_ARRIVE_RADIUS_PX: 14,
    INTRO_TIMEOUT_MS: 6000,
  },
  // Batch A (halftime banner at HALF): overlay panel geometry, colors and
  // copy. The scene reads every value from here — no UI literals elsewhere.
  HALFTIME_BANNER: {
    PANEL_CENTER_X_PX: 480,
    PANEL_CENTER_Y_PX: 270,
    PANEL_W_PX: 520,
    PANEL_H_PX: 340,
    BG_COLOR: 0x000000,
    BG_ALPHA: 0.85,
    FONT_FAMILY: 'monospace',
    TITLE_TEXT: 'MEDIO TIEMPO',
    TITLE_FONT_SIZE_PX: '36px',
    TITLE_Y_PX: 130,
    TITLE_ORIGIN_Y: 0.5,
    CENTER_ORIGIN: 0.5,
    SCORE_FONT_SIZE_PX: '56px',
    SCORE_Y_PX: 200,
    SCORE_PLACEHOLDER: '0 - 0',
    SCORE_SEPARATOR: ' - ',
    GOALS_ABBR: 'G',
    SHOTS_ABBR: 'T',
    PASSES_ABBR: 'P',
    BODY_FONT_SIZE_PX: '18px',
    SECOND_HALF_NOTE_TEXT: 'Segundo tiempo — lados cambiados',
    NOTE_Y_PX: 250,
    HOME_LABEL: 'LOCAL',
    AWAY_LABEL: 'VISITANTE',
    HOME_LINE_Y_PX: 285,
    AWAY_LINE_Y_PX: 310,
    BUTTON_FONT_SIZE_PX: '22px',
    BUTTON_TEXT_COLOR: '#ffff00',
    BUTTON_BG_COLOR: '#000000',
    BUTTON_PADDING: { left: 12, right: 12, top: 6, bottom: 6 },
    CONTINUE_LABEL: 'Continuar',
    CONTINUE_Y_PX: 350,
    RESTART_LABEL: 'Reiniciar partido',
    RESTART_Y_PX: 390,
    TEXT_COLOR: '#ffffff',
    ACCENT_COLOR: '#ffff00',
    DEPTH: 28,
    SCROLL_FACTOR: 0,
  },
  // Batch B1 (tactics presets, AGENTS.md section 12): exactly three
  // presets. BLOCK_SHIFT_PX moves the outfield block along the attack axis
  // (negative = deeper, positive = higher); SUPPORT_PUSH_PX overrides the
  // off-ball support shove; ATTACKERS_COUNT bounds how many outfield players
  // join the attack; PRESS_COUNT_MAX caps simultaneous pressers.
  TACTICS: {
    DEFAULT: 'balanced' as const,
    LABELS: {
      defensive: 'Defensiva',
      balanced: 'Equilibrada',
      offensive: 'Ofensiva',
    },
    LABEL_PREFIX: 'Táctica',
    HINT_KEY: 'T',
    LABEL_X_PX: 936,
    LABEL_Y_PX: 52,
    LABEL_FONT_SIZE_PX: '16px',
    LABEL_COLOR: '#ffffff',
    PRESETS: {
      defensive: {
        BLOCK_SHIFT_PX: -40,
        SUPPORT_PUSH_PX: 20,
        ATTACKERS_COUNT: 2,
        PRESS_COUNT_MAX: 1,
      },
      balanced: {
        BLOCK_SHIFT_PX: 0,
        SUPPORT_PUSH_PX: 50,
        ATTACKERS_COUNT: 4,
        PRESS_COUNT_MAX: 2,
      },
      offensive: {
        BLOCK_SHIFT_PX: 40,
        SUPPORT_PUSH_PX: 80,
        ATTACKERS_COUNT: 6,
        PRESS_COUNT_MAX: 2,
      },
    },
  },
  // Batch B1 (full-time panel at RESULTS): overlay geometry, colors and copy.
  // Payload reuses the halftime stats shape (score + per-team lines).
  FULLTIME_BANNER: {
    PANEL_CENTER_X_PX: 480,
    PANEL_CENTER_Y_PX: 270,
    PANEL_W_PX: 520,
    PANEL_H_PX: 360,
    BG_COLOR: 0x000000,
    BG_ALPHA: 0.88,
    FONT_FAMILY: 'monospace',
    TITLE_TEXT: 'FINAL',
    TITLE_FONT_SIZE_PX: '36px',
    TITLE_Y_PX: 120,
    TITLE_ORIGIN_Y: 0.5,
    CENTER_ORIGIN: 0.5,
    SCORE_FONT_SIZE_PX: '56px',
    SCORE_Y_PX: 190,
    SCORE_PLACEHOLDER: '0 - 0',
    SCORE_SEPARATOR: ' - ',
    GOALS_ABBR: 'G',
    SHOTS_ABBR: 'T',
    PASSES_ABBR: 'P',
    BODY_FONT_SIZE_PX: '18px',
    NOTE_TEXT: 'Partido completo',
    NOTE_Y_PX: 240,
    HOME_LABEL: 'LOCAL',
    AWAY_LABEL: 'VISITANTE',
    HOME_LINE_Y_PX: 275,
    AWAY_LINE_Y_PX: 300,
    BUTTON_FONT_SIZE_PX: '22px',
    BUTTON_TEXT_COLOR: '#ffff00',
    BUTTON_BG_COLOR: '#000000',
    BUTTON_PADDING: { left: 12, right: 12, top: 6, bottom: 6 },
    REPLAY_LABEL: 'Jugar de nuevo',
    REPLAY_Y_PX: 350,
    TEXT_COLOR: '#ffffff',
    ACCENT_COLOR: '#ffff00',
    DEPTH: 29,
    SCROLL_FACTOR: 0,
  },
  // Batch B2 (simple fouls, AGENTS.md section 7: no cards, no walls, no
  // offside): tackle-from-behind rule, box geometry, set-piece staging and
  // anti-soft-lock timing. The scene evaluates contact; the manager awards.
  FOUL: {
    // A challenge counts as a tackle attempt inside this radius of the carrier.
    TACKLE_RADIUS_PX: 24,
    // A carrier slower than this cannot be fouled from behind (clean steal).
    MIN_CARRIER_SPEED_PX_S: 40,
    // Foul cone: angle between the carrier motion and the carrier->tackler
    // vector above this means "from behind" (180 = directly behind).
    BEHIND_ANGLE_DEG: 100,
    // Minimum match time between two foul awards (no whistle spam).
    COOLDOWN_MS: 3000,
    // Penalty-box geometry measured from each goal line / pitch center.
    BOX_DEPTH_PX: 130,
    BOX_HALF_HEIGHT_PX: 120,
    // Penalty spot offset from the goal line, centered vertically.
    PENALTY_SPOT_OFFSET_PX: 90,
    // GK line offset from the goal line at penalties (mirrors goal zones).
    PENALTY_GK_LINE_OFFSET_PX: 20,
    // Shooter stands this far behind the penalty spot toward midfield.
    PENALTY_SHOOTER_OFFSET_PX: 26,
    // Non-participants are cleared to at least this radius from the spot.
    PENALTY_CLEAR_RADIUS_PX: 150,
    // Free-kick support bubble around the kicker.
    FREE_KICK_SUPPORT_COUNT: 2,
    FREE_KICK_SUPPORT_RADIUS_PX: 90,
    // Defenders inside this radius of the spot are pushed out to it (no wall).
    FREE_KICK_DEFENDER_DISTANCE_PX: 120,
    // Safety resume when nobody takes the set piece (anti-soft-lock).
    SET_PIECE_MAX_WAIT_MS: 4000,
    // Away-AI set-piece kick delay + power (scene-synthesized kick).
    SET_PIECE_AI_DELAY_MS: 1200,
    SET_PIECE_AI_POWER: 0.55,
    // Away-AI set-piece aim: goal-mouth offset from the goal line (mirrors
    // the holder-attack targets used by the field AI).
    SET_PIECE_AI_GOAL_OFFSET_PX: 60,
  },
  // Batch B2 (procedural audio, AGENTS.md section 22: original synthesis
  // only, volumes/variants from config, mix limits). The WebAudio synth is a
  // fallback: asset files win whenever present.
  AUDIO: {
    MASTER_VOLUME: 1.0,
    // Deterministic round-robin variants per event (no RNG in game code).
    VARIANTS: 3,
    VARIANT_RATE_STEP: 0.06,
    VARIANT_VOLUME_STEP: 0.05,
    // Cheer layer volume inside the GOAL event (louder than ambient cheers).
    KICK: { VOLUME: 0.8, RATE: 1.0, FREQ_HZ: 110, DURATION_MS: 140, WAVE: 'sine' },
    PASS: { VOLUME: 0.6, RATE: 1.1, FREQ_HZ: 220, DURATION_MS: 90, WAVE: 'triangle' },
    WHISTLE: { VOLUME: 0.9, RATE: 1.0, FREQ_HZ: 2200, DURATION_MS: 500, WAVE: 'square' },
    POST: { VOLUME: 1.0, RATE: 1.0, FREQ_HZ: 880, DURATION_MS: 300, WAVE: 'triangle' },
    GOAL: { VOLUME: 1.0, RATE: 1.0, FREQ_HZ: 523, DURATION_MS: 600, WAVE: 'sawtooth' },
    CHEER: { VOLUME: 0.7, RATE: 1.0, FREQ_HZ: 800, DURATION_MS: 900, WAVE: 'noise' },
    CLICK: { VOLUME: 0.5, RATE: 1.0, FREQ_HZ: 660, DURATION_MS: 60, WAVE: 'square' },
    GOAL_CHEER_VOLUME: 0.9,
    // Batch C (crowd bed): looping ambient filtered-noise bed under the
    // goal-cheer swell. Low volume by design — the swell stays on top.
    CROWD_BED: { VOLUME: 0.15, FREQ_HZ: 500, Q: 0.6, DURATION_MS: 2000 },
    // Phase 4 Batch B (dynamic stadium crowd, AGENTS.md section 22 layer 3):
    // the bed's intensity follows the game state. MatchScene samples a pure
    // level function at SAMPLE_INTERVAL_MS (no per-frame gain writes); the
    // level rises while the ball is in an attacking third, more near the box,
    // peaks on GOAL and decays back. The home crowd is louder when leading.
    // All levels are gains in [MIN_LEVEL, MAX_LEVEL]; NEUTRAL_LEVEL keeps the
    // old static CROWD_BED.VOLUME mix when the ball sits in midfield.
    CROWD_DYNAMICS: {
      SAMPLE_INTERVAL_MS: 250,
      NEUTRAL_LEVEL: 0.15,
      THIRD_LEVEL: 0.3,
      BOX_LEVEL: 0.55,
      GOAL_PEAK_LEVEL: 1.0,
      LEAD_BONUS: 0.1,
      MIN_LEVEL: 0.05,
      MAX_LEVEL: 1.0,
      // Zone thresholds measured from each goal line (px).
      ATTACKING_THIRD_PX: 320,
      BOX_ZONE_PX: 130,
      // Smooth interpolation rates (gain per ms): fast rise, slow decay.
      ATTACK_PER_MS: 0.0004,
      RELEASE_PER_MS: 0.00016,
      // WebAudio ramp windows for one intensity sample (anti-zipper).
      GAIN_ATTACK_MS: 200,
      GAIN_RELEASE_MS: 800,
    },
  },
  // Phase 4 Batch B (cartoon animations, AGENTS.md section 21): override clip
  // windows for the new action poses. Every override is bounded by a timer and
  // always reverts to idle/run — no anim state can wedge. GK dive reuses
  // GK.DIVE_DURATION_MS (matches the FSM dive window).
  ANIM: {
    // Slide tackle clip window on the pressure/tackle action.
    TACKLE_DURATION_MS: 300,
    // Goal celebration: scorer + CELEBRATION_TEAMMATES nearest non-GK
    // teammates bounce for a bounded window (always < MATCH.GOAL_PAUSE_MS so
    // the celebration reads inside the goal freeze), then revert.
    CELEBRATION_DURATION_MS: 1800,
    CELEBRATION_TEAMMATES: 2,
    // Celebration bounce frame rate (arms-up <-> idle yoyo pair).
    // Remediation: snappier bounce (old 3), less robotic.
    CELEBRATION_FRAME_RATE: 5,
    // GK clip windows: claim outlasts GK.GK_HOLD_MS so the hold pose reads;
    // the scene re-arms every frame while the FSM stays in the state.
    GK_CLAIM_DURATION_MS: 900,
    GK_DISTRIBUTE_DURATION_MS: 300,
  },
  // Batch B2 (frame-time measurement, AGENTS.md section 33): rolling tracker
  // fed from the scene update loop. Log cadence in frames (600 ~= 10s at 60fps).
  PERF: {
    FRAME_TIME_WINDOW: 60,
    FRAME_TIME_LOG_EVERY: 600,
  },
  // Batch 5 (controlled-player indicator, AGENTS.md sections 8 + 34): ring +
  // floating marker that follows selection switches. Bright base with a dark
  // outline pass so the marker stays legible on ANY kit color.
  INDICATOR: {
    RING_RADIUS_PX: 26,
    RING_WIDTH_PX: 3,
    RING_COLOR: 0xffe135,
    RING_ALPHA: 0.95,
    MARKER_WIDTH_PX: 20,
    MARKER_HEIGHT_PX: 14,
    MARKER_Y_OFFSET_PX: -48,
    MARKER_COLOR: 0xffe135,
    MARKER_ALPHA: 0.95,
    OUTLINE_COLOR: 0x1a1a1a,
    OUTLINE_ALPHA: 0.9,
    OUTLINE_WIDTH_PX: 2,
    BOB_AMPLITUDE_PX: 4,
    BOB_PERIOD_MS: 800,
    DEPTH: 15,
  },
  // Settings/pause/Spanish-UI batch (AGENTS.md sections 7, 8, 34): pre-match
  // option orders + defaults. Every list is the single source the menu model
  // reads; defaults MUST mirror the previous hardcoded behavior so a scene
  // started without init data is bit-identical to the old boot.
  // Session-only: persisting settings per profile is a Phase 6 SaveGame
  // OPEN QUESTION (documented in specs/settings_menus_spanish_ui.md).
  SETTINGS: {
    SURFACE_ORDER: ['DIRT', 'IRREGULAR_GRASS', 'REGULAR_GRASS', 'PROFESSIONAL_GRASS'] as PitchQuality[],
    WEATHER_ORDER: ['CLEAR_DAY', 'RAIN', 'SNOW', 'HEAT'] as WeatherType[],
    FORMATION_ORDER: ['3v3', '5v5', '11v11'] as FormationId[],
    DURATION_OPTIONS_MINUTES: [3, 5],
    VOLUME_STEPS: [0, 0.25, 0.5, 0.75, 1],
    DEFAULTS: {
      SURFACE_INDEX: 2, // REGULAR_GRASS — WeatherSystem default (zero change)
      WEATHER_INDEX: 0, // CLEAR_DAY — WEATHER.DEFAULT_TYPE
      FORMATION_INDEX: 2, // 11v11 — Batch B1 shipped default
      DURATION_INDEX: 0, // 3 real minutes — MATCH.DURATION_REAL_MINUTES
      VOLUME_INDEX: 4, // 1.0 — AUDIO.MASTER_VOLUME
    },
  },
  // Pre-match menu layout (section 34: readable, large touch rows). Geometry
  // and styles only — copy lives in src/data/uiText.ts.
  MENU: {
    FONT_FAMILY: 'monospace',
    TITLE_X_PX: 480,
    TITLE_Y_PX: 64,
    TITLE_FONT_SIZE_PX: '40px',
    TITLE_COLOR: '#ffe135',
    ROW_X_PX: 480,
    ROW_Y_START_PX: 150,
    ROW_SPACING_PX: 56,
    ROW_FONT_SIZE_PX: '22px',
    ROW_COLOR: '#ffffff',
    SELECTED_COLOR: '#ffe135',
    PLAY_FONT_SIZE_PX: '30px',
    PLAY_TEXT_COLOR: '#ffe135',
    PLAY_BG_COLOR: '#000000',
    BUTTON_PADDING: { left: 16, right: 16, top: 8, bottom: 8 },
    CURSOR_PREFIX: '» ',
    HINT_Y_PX: 506,
    HINT_FONT_SIZE_PX: '14px',
    HINT_COLOR: '#ffffff',
    HINT_BG_COLOR: 'rgba(0,0,0,0.5)',
    DEPTH: 10,
  },
  // In-match HUD affordances (AGENTS.md section 8: never over the play area —
  // both buttons live on the top HUD strip next to the clock). ABANDON quits
  // to the menu (remediation: the old Marcador score-peek toggle was
  // redundant next to PAUSA and read as a broken CANCELAR).
  HUD: {
    ABANDON_BUTTON_X_PX: 936,
    ABANDON_BUTTON_Y_PX: 24,
    ABANDON_FONT_SIZE_PX: '18px',
  },
  // In-match pause affordance + overlay (AGENTS.md section 8: the button must
  // never cover the play area — it lives on the top HUD strip next to the
  // clock; the overlay is screen-pinned at panel center like the banners).
  PAUSE: {
    BUTTON_X_PX: 110,
    BUTTON_Y_PX: 24,
    BUTTON_FONT_SIZE_PX: '18px',
    BUTTON_TEXT_COLOR: '#ffffff',
    BUTTON_BG_COLOR: '#000000',
    BUTTON_PADDING: { left: 10, right: 10, top: 4, bottom: 4 },
    PANEL_CENTER_X_PX: 480,
    PANEL_CENTER_Y_PX: 270,
    PANEL_W_PX: 480,
    PANEL_H_PX: 380,
    BG_COLOR: 0x000000,
    BG_ALPHA: 0.85,
    FONT_FAMILY: 'monospace',
    TITLE_Y_PX: -130,
    TITLE_FONT_SIZE_PX: '40px',
    ROW_Y_START_PX: -70,
    ROW_SPACING_PX: 58,
    ROW_FONT_SIZE_PX: '24px',
    HINT_Y_PX: 135,
    HINT_FONT_SIZE_PX: '14px',
    TEXT_COLOR: '#ffffff',
    SELECTED_COLOR: '#ffe135',
    SELECTED_MARKER: '» ',
    ACCENT_COLOR: '#ffe135',
    CENTER_ORIGIN: 0.5,
    // Above every gameplay HUD and banner (banners are 26-29), under the
    // dev debug panel (40).
    DEPTH: 35,
    SCROLL_FACTOR: 0,
  },
};

/** Batch B1: tactics preset ids (AGENTS.md section 12 — exactly three). */
export type TacticsId = keyof typeof BALANCE_CONFIG.TACTICS.PRESETS;

export type TacticsPreset = (typeof BALANCE_CONFIG.TACTICS.PRESETS)[TacticsId];

/** Resolves a tactics preset or throws before kickoff (same fail-fast rule as formations). */
export function resolveTactics(id: TacticsId): TacticsPreset {
  const preset = BALANCE_CONFIG.TACTICS.PRESETS[id];
  if (!preset) {
    throw new Error(
      `Unknown tactics id '${String(id)}'. Registered: ${Object.keys(BALANCE_CONFIG.TACTICS.PRESETS).join(', ')}`,
    );
  }
  return preset;
}
