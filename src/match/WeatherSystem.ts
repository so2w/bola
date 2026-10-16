import { BALANCE_CONFIG } from '../data/balance';

export type PitchQuality = 'DIRT' | 'IRREGULAR_GRASS' | 'REGULAR_GRASS' | 'PROFESSIONAL_GRASS';
export type WeatherType = 'CLEAR_DAY' | 'NIGHT' | 'RAIN' | 'HEAT' | 'SNOW';

export interface SurfaceModifiers {
  frictionMultiplier: number;
  sprintSpeedMultiplier: number;
  receptionDifficulty: number;
}

/** Modifier profile of a single surface level or weather type. */
export interface ModifierProfile {
  FRICTION_MULT: number;
  SPRINT_MULT: number;
  RECEPTION_DIFFICULTY: number;
}

/** Section 13 hard limits applied to every composed modifier. */
export interface ModifierClamps {
  FRICTION_MIN: number;
  FRICTION_MAX: number;
  SPRINT_MIN: number;
  SPRINT_MAX: number;
  RECEPTION_MIN: number;
  RECEPTION_MAX: number;
}

export interface WeatherSystemConfig {
  SURFACE: {
    DEFAULT_LEVEL: PitchQuality;
    LEVELS: Record<PitchQuality, ModifierProfile>;
    CLAMPS: ModifierClamps;
  };
  WEATHER: {
    DEFAULT_TYPE: WeatherType;
    TYPES: Record<WeatherType, ModifierProfile>;
    CLAMPS: ModifierClamps;
  };
}

/** Default wiring: the BALANCE_CONFIG groups (single source of truth). */
export const DEFAULT_WEATHER_CONFIG: WeatherSystemConfig = {
  SURFACE: BALANCE_CONFIG.SURFACE,
  WEATHER: BALANCE_CONFIG.WEATHER,
};

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Fail-fast profile lookup (same convention as resolveTactics). */
function profileOf(
  map: Record<string, ModifierProfile | undefined>,
  key: string,
  what: string,
): ModifierProfile {
  const p = map[key];
  if (
    !p ||
    !Number.isFinite(p.FRICTION_MULT) ||
    !Number.isFinite(p.SPRINT_MULT) ||
    !Number.isFinite(p.RECEPTION_DIFFICULTY)
  ) {
    throw new Error(
      `WeatherSystem: unknown or malformed ${what} '${String(key)}'. Registered: ${Object.keys(map).join(', ')}`,
    );
  }
  return p;
}

function clampsOf(clamps: ModifierClamps | undefined): ModifierClamps {
  if (
    !clamps ||
    !Number.isFinite(clamps.FRICTION_MIN) ||
    !Number.isFinite(clamps.FRICTION_MAX) ||
    !Number.isFinite(clamps.SPRINT_MIN) ||
    !Number.isFinite(clamps.SPRINT_MAX) ||
    !Number.isFinite(clamps.RECEPTION_MIN) ||
    !Number.isFinite(clamps.RECEPTION_MAX)
  ) {
    throw new Error('WeatherSystem: malformed CLAMPS config');
  }
  return clamps;
}

/** Composes surface × weather and clamps (section 13 guard at compose time). */
function composeModifiers(
  cfg: WeatherSystemConfig,
  pitch: PitchQuality,
  weather: WeatherType,
): SurfaceModifiers {
  const surface = profileOf(cfg.SURFACE.LEVELS, pitch, 'pitch quality');
  const type = profileOf(cfg.WEATHER.TYPES, weather, 'weather type');
  const c = clampsOf(cfg.SURFACE.CLAMPS);
  return {
    frictionMultiplier: clamp(
      surface.FRICTION_MULT * type.FRICTION_MULT,
      c.FRICTION_MIN,
      c.FRICTION_MAX,
    ),
    sprintSpeedMultiplier: clamp(
      surface.SPRINT_MULT * type.SPRINT_MULT,
      c.SPRINT_MIN,
      c.SPRINT_MAX,
    ),
    receptionDifficulty: clamp(
      surface.RECEPTION_DIFFICULTY * type.RECEPTION_DIFFICULTY,
      c.RECEPTION_MIN,
      c.RECEPTION_MAX,
    ),
  };
}

/**
 * WeatherSystem — config-driven surface/weather modifiers (AGENTS.md §13).
 *
 * Every number comes from BALANCE_CONFIG.SURFACE / .WEATHER; composed
 * modifiers clamp into the section-13 limits so a bad pitch can never fully
 * randomize or cripple play. HEAT carries a small sprint/control cost only —
 * the energy drain is Phase 6 (EnergySystem) and is a documented no-op until
 * then. HEAT/NIGHT visuals and RAIN streaks are intentionally out of MVP
 * scope (see config comments).
 */
export class WeatherSystem {
  private readonly pitch: PitchQuality;
  private readonly type: WeatherType;
  private readonly modifiers: SurfaceModifiers;

  constructor(
    cfg: WeatherSystemConfig = DEFAULT_WEATHER_CONFIG,
    pitch: PitchQuality = cfg.SURFACE.DEFAULT_LEVEL,
    weatherType: WeatherType = cfg.WEATHER.DEFAULT_TYPE,
  ) {
    this.pitch = pitch;
    this.type = weatherType;
    this.modifiers = composeModifiers(cfg, pitch, weatherType);
  }

  public get pitchQuality(): PitchQuality {
    return this.pitch;
  }

  public get weatherType(): WeatherType {
    return this.type;
  }

  public get frictionMultiplier(): number {
    return this.modifiers.frictionMultiplier;
  }

  public get sprintSpeedMultiplier(): number {
    return this.modifiers.sprintSpeedMultiplier;
  }

  public get receptionDifficulty(): number {
    return this.modifiers.receptionDifficulty;
  }

  public getSurfaceModifiers(): SurfaceModifiers {
    return this.modifiers;
  }

  /** Back-compat static API (legacy call sites + weather.spec.ts). */
  public static getSurfaceModifiers(
    pitch: PitchQuality,
    weather: WeatherType,
    cfg: WeatherSystemConfig = DEFAULT_WEATHER_CONFIG,
  ): SurfaceModifiers {
    return composeModifiers(cfg, pitch, weather);
  }
}
