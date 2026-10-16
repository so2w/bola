import { BALANCE_CONFIG } from '../data/balance';

/**
 * Batch B2 — original procedural sound synthesis (AGENTS.md sections 2/22:
 * no copied audio, zero audio files in the repo, so wired events need a
 * synthesized fallback). Oscillator/noise-based kick thump, whistle,
 * goal/cheer-ish swell, post ping and UI click — all recipes from
 * BALANCE_CONFIG.AUDIO.
 *
 * Headless-safe: the AudioContext is created lazily on first play and every
 * entry point no-ops when the platform has no AudioContext (tests, SSR) or
 * when creation/replay throws (autoplay policy). Game logic stays
 * deterministic: variant cycling is a round-robin counter and noise uses a
 * fixed-seed LCG — no Math.random, no Date.now (the AudioContext clock is
 * platform audio time, used only for envelope scheduling).
 */
export class WebAudioSynth {
  private ctx: unknown = null;
  private crowdStarted = false;
  /** Phase 4 Batch B: the crowd bed's gain node (intensity modulation). */
  private crowdGain: GainNode | null = null;
  /** Settings batch: live master volume for the bed (events scale upstream). */
  private masterVolume = BALANCE_CONFIG.AUDIO.MASTER_VOLUME;
  /** Last intensity level applied to the bed (re-applied on volume change). */
  private crowdLevel = BALANCE_CONFIG.AUDIO.CROWD_BED.VOLUME;
  private readonly wantedKeys = new Set([
    'sfx_kick',
    'sfx_pass',
    'sfx_whistle',
    'sfx_post',
    'sfx_goal',
    'sfx_cheer',
    'sfx_click',
  ]);

  public has(key: string): boolean {
    return this.wantedKeys.has(key);
  }

  public play(key: string, config?: { volume?: number; rate?: number }): void {
    const recipe = recipeForKey(key);
    if (!recipe) {
      return;
    }
    const ctx = this.ensureContext();
    if (!ctx) {
      return;
    }
    try {
      this.render(ctx, recipe, config?.volume ?? recipe.VOLUME, config?.rate ?? recipe.RATE);
    } catch {
      // Audio must never break gameplay (autoplay policy, torn-down ctx).
    }
  }

  /**
   * Batch C — looping ambient crowd bed (filtered-noise loop at low volume).
   * Called from the first user-gesture handler so the AudioContext unlocks
   * inside the input path (autoplay-policy safe); the existing lazy guard
   * keeps headless/test environments a silent no-op. Idempotent: the second
   * call never layers a second bed. The GOAL cheer swell keeps playing
   * layered on top through the normal play() path.
   */
  public startCrowdBed(): boolean {
    if (this.crowdStarted) {
      return true;
    }
    const ctx = this.ensureContext();
    if (!ctx) {
      return false;
    }
    try {
      const bed = BALANCE_CONFIG.AUDIO.CROWD_BED;
      const durS = bed.DURATION_MS / MS_PER_S;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer(ctx, durS);
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = bed.FREQ_HZ;
      filter.Q.value = bed.Q;
      const gain = ctx.createGain();
      gain.gain.value = Math.min(1, bed.VOLUME * this.masterVolume);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      src.start();
      this.crowdGain = gain;
      this.crowdStarted = true;
      return true;
    } catch {
      return false;
    }
  }

  public isCrowdBedActive(): boolean {
    return this.crowdStarted;
  }

  /**
   * Settings batch: live master volume for the ambient bed (one-shot events
   * are already scaled by AudioDirector before reaching the synth). Re-ramps
   * the live bed toward the same intensity target under the new master.
   * Headless-safe: no-op without a running bed.
   */
  public setMasterVolume(volume: number): void {
    if (!Number.isFinite(volume)) {
      return;
    }
    this.masterVolume = Math.max(0, Math.min(volume, 1));
    this.setCrowdIntensity(this.crowdLevel);
  }

  /**
   * Phase 4 Batch B (section 22 layer 3): modulates the crowd bed gain toward
   * the given intensity level (0..1, clamped to the CROWD_DYNAMICS window).
   * One WebAudio ramp per call — MatchScene samples at a low cadence, so
   * there are no per-frame writes and no zipper noise; the ramp window is
   * the configured attack (rise) or release (fall) time. Headless/bed-not-
   * started: safe no-op.
   */
  public setCrowdIntensity(level: number): void {
    if (!this.crowdStarted || !this.crowdGain) {
      return;
    }
    const ctx = this.ensureContext();
    if (!ctx) {
      return;
    }
    try {
      const cd = BALANCE_CONFIG.AUDIO.CROWD_DYNAMICS;
      const clamped = Math.min(Math.max(level, cd.MIN_LEVEL), cd.MAX_LEVEL);
      this.crowdLevel = clamped;
      const target = Math.min(1, clamped * this.masterVolume);
      const g = this.crowdGain.gain;
      const rampMs = target >= g.value ? cd.GAIN_ATTACK_MS : cd.GAIN_RELEASE_MS;
      g.cancelScheduledValues?.(ctx.currentTime);
      g.setValueAtTime(g.value, ctx.currentTime);
      g.linearRampToValueAtTime(target, ctx.currentTime + rampMs / MS_PER_S);
    } catch {
      // Audio must never break gameplay (autoplay policy, torn-down ctx).
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) {
      return this.ctx as AudioContext;
    }
    const ctor = (globalThis as { AudioContext?: new () => AudioContext }).AudioContext;
    if (typeof ctor === 'undefined') {
      return null;
    }
    try {
      const ctx = new ctor();
      // Suspended (autoplay policy) still schedules fine once resumed by a
      // user gesture; attempt resume opportunistically without awaiting.
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => undefined);
      }
      this.ctx = ctx;
      return ctx;
    } catch {
      return null;
    }
  }

  private render(
    ctx: AudioContext,
    recipe: SynthRecipe,
    volume: number,
    rate: number,
  ): void {
    const t0 = ctx.currentTime;
    const durS = recipe.DURATION_MS / MS_PER_S;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(
      Math.min(1, volume * BALANCE_CONFIG.AUDIO.MASTER_VOLUME),
      t0 + ATTACK_S,
    );
    gain.gain.exponentialRampToValueAtTime(PEAK_FLOOR, t0 + durS);
    gain.connect(ctx.destination);

    if (recipe.WAVE === 'noise') {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer(ctx, durS);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = recipe.FREQ_HZ * rate;
      filter.Q.value = NOISE_Q;
      src.connect(filter);
      filter.connect(gain);
      src.start(t0);
      src.stop(t0 + durS);
      return;
    }
    const osc = ctx.createOscillator();
    osc.type = recipe.WAVE;
    osc.frequency.value = recipe.FREQ_HZ * rate;
    osc.connect(gain);
    osc.start(t0);
    osc.stop(t0 + durS);
  }

  /** Deterministic white-ish noise (fixed-seed LCG, no Math.random). */
  private noiseBuffer(ctx: AudioContext, durS: number): AudioBuffer {
    const len = Math.max(1, Math.floor(ctx.sampleRate * durS));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let seed = NOISE_SEED;
    for (let i = 0; i < len; i++) {
      seed = (seed * LCG_A + LCG_C) >>> 0;
      data[i] = seed / UINT32_MAX - NOISE_CENTER;
    }
    return buf;
  }
}

/** Seconds per millisecond-scale conversion (arithmetic, not tuning). */
const MS_PER_S = 1000;
/** Gain envelope attack + floor (click-free, inaudible-silent constants). */
const ATTACK_S = 0.008;
const PEAK_FLOOR = 0.001;
/** Bandpass Q for the crowd-ish noise swell. */
const NOISE_Q = 0.8;
/** LCG constants for deterministic noise (Numerical Recipes). */
const NOISE_SEED = 0x12345678;
const LCG_A = 1664525;
const LCG_C = 1013904223;
const UINT32_MAX = 0xffffffff;
const NOISE_CENTER = 0.5;

interface SynthRecipe {
  VOLUME: number;
  RATE: number;
  FREQ_HZ: number;
  DURATION_MS: number;
  WAVE: OscillatorType | 'noise';
}

const KEY_TO_EVENT: Record<string, 'KICK' | 'PASS' | 'WHISTLE' | 'POST' | 'GOAL' | 'CHEER' | 'CLICK'> = {
  sfx_kick: 'KICK',
  sfx_pass: 'PASS',
  sfx_whistle: 'WHISTLE',
  sfx_post: 'POST',
  sfx_goal: 'GOAL',
  sfx_cheer: 'CHEER',
  sfx_click: 'CLICK',
};

function recipeForKey(key: string): SynthRecipe | null {
  const event = KEY_TO_EVENT[key];
  if (!event) {
    return null;
  }
  const entry = BALANCE_CONFIG.AUDIO[event] as {
    VOLUME: number;
    RATE: number;
    FREQ_HZ: number;
    DURATION_MS: number;
    WAVE: string;
  };
  const wave = entry.WAVE === 'noise' ? 'noise' : toOscillatorType(entry.WAVE);
  return { VOLUME: entry.VOLUME, RATE: entry.RATE, FREQ_HZ: entry.FREQ_HZ, DURATION_MS: entry.DURATION_MS, WAVE: wave };
}

function toOscillatorType(wave: string): OscillatorType {
  if (wave === 'sine' || wave === 'triangle' || wave === 'square' || wave === 'sawtooth') {
    return wave;
  }
  return 'sine';
}
