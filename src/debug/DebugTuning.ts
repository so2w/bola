import { BALANCE_CONFIG } from '../data/balance';

/** One live-tunable knob (bounded, config-declared). */
export interface TuningKnobCfg {
  KEY: string;
  LABEL: string;
  MIN: number;
  MAX: number;
  STEP: number;
  DEFAULT: number;
}

const DEFAULT_KNOBS: readonly TuningKnobCfg[] = BALANCE_CONFIG.DEBUG.TUNING.KNOBS;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * DebugTuning — session-only live tuning knobs (AGENTS.md §30 "when
 * practical"). Overrides apply ON TOP of BALANCE_CONFIG and are NEVER
 * persisted: a reload restores the config values. Knobs are bounded at
 * MIN/MAX and can never hold NaN (non-finite adjustments are ignored).
 *
 * `version` increments on every value change so the scene can re-apply
 * tunings version-gated instead of writing them every frame.
 */
export class DebugTuning {
  private readonly knobs: readonly TuningKnobCfg[];
  private readonly values = new Map<string, number>();
  private selectedIndex = 0;
  private versionCount = 0;

  constructor(knobs: readonly TuningKnobCfg[] = DEFAULT_KNOBS) {
    if (!knobs || knobs.length === 0) {
      throw new Error('DebugTuning: at least one knob is required');
    }
    for (const k of knobs) {
      if (!k.KEY) {
        throw new Error('DebugTuning: knob without KEY');
      }
      if (!Number.isFinite(k.MIN) || !Number.isFinite(k.MAX) || k.MIN >= k.MAX) {
        throw new Error(`DebugTuning: knob '${k.KEY}' has invalid MIN/MAX`);
      }
      if (!Number.isFinite(k.STEP) || k.STEP <= 0) {
        throw new Error(`DebugTuning: knob '${k.KEY}' has invalid STEP`);
      }
      if (!Number.isFinite(k.DEFAULT)) {
        throw new Error(`DebugTuning: knob '${k.KEY}' has non-finite DEFAULT`);
      }
    }
    for (const k of knobs) {
      this.values.set(k.KEY, clamp(k.DEFAULT, k.MIN, k.MAX));
    }
    this.knobs = knobs;
  }

  /** Bumped on every value change (version-gated re-apply in the scene). */
  public get version(): number {
    return this.versionCount;
  }

  public get selectedKey(): string {
    return this.knobs[this.selectedIndex].KEY;
  }

  /** Current value of a knob; unknown keys throw fail-fast. */
  public getValue(key: string): number {
    const v = this.values.get(key);
    if (v === undefined) {
      throw new Error(`DebugTuning: unknown knob '${key}'`);
    }
    return v;
  }

  /** Selects the active knob by key (throws on unknown keys). */
  public select(key: string): void {
    const idx = this.knobs.findIndex((k) => k.KEY === key);
    if (idx < 0) {
      throw new Error(`DebugTuning: unknown knob '${key}'`);
    }
    this.selectedIndex = idx;
  }

  /** Cycles to the next knob (wraps around). */
  public cycle(): void {
    this.selectedIndex = (this.selectedIndex + 1) % this.knobs.length;
  }

  /**
   * Adjusts the selected knob by `steps` × STEP, clamped to MIN/MAX.
   * Non-finite or zero steps are ignored (never NaN, no version bump).
   */
  public adjustSelected(steps: number): void {
    if (!Number.isFinite(steps) || steps === 0) {
      return;
    }
    const knob = this.knobs[this.selectedIndex];
    const current = this.values.get(knob.KEY) as number;
    const next = clamp(current + steps * knob.STEP, knob.MIN, knob.MAX);
    if (next !== current) {
      this.values.set(knob.KEY, next);
      this.versionCount++;
    }
  }

  /** Overlay lines (the selected knob is marked with '>'). */
  public describe(): string[] {
    return this.knobs.map((k, i) => {
      const v = this.values.get(k.KEY) as number;
      const mark = i === this.selectedIndex ? '>' : ' ';
      return `${mark} tuning ${k.KEY} = ${v.toFixed(2)} (${k.MIN}..${k.MAX} step ${k.STEP})`;
    });
  }
}
