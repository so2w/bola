import { BALANCE_CONFIG } from '../data/balance';

export type AudioEvent =
  | 'KICK'
  | 'PASS'
  | 'WHISTLE'
  | 'POST'
  | 'GOAL'
  | 'CROWD_CHEER'
  | 'UI_CLICK';

export interface SoundAdapter {
  play(key: string, config?: { volume?: number; rate?: number }): void;
  /**
   * Optional asset-existence probe (PRES-2). When present and it returns
   * false, playback is skipped with a debug warning instead of throwing.
   */
  has?(key: string): boolean;
}

export interface AudioDirectorOptions {
  /** Enable console.warn for skipped missing assets (debug builds only). */
  debug?: boolean;
  /**
   * Batch B2: procedural synthesis fallback (original WebAudio recipes, no
   * external assets). Used only when the primary adapter cannot play the
   * key — asset files always win when present.
   */
  synth?: SoundAdapter;
}

type SynthCfgKey = 'KICK' | 'PASS' | 'WHISTLE' | 'POST' | 'GOAL' | 'CHEER' | 'CLICK';

interface SfxMapping {
  key: string;
  cfg: SynthCfgKey;
  /** Volume override for layered events (GOAL's cheer layer). */
  volume?: number;
}

const EVENT_SFX: Record<AudioEvent, SfxMapping[]> = {
  KICK: [{ key: 'sfx_kick', cfg: 'KICK' }],
  PASS: [{ key: 'sfx_pass', cfg: 'PASS' }],
  WHISTLE: [{ key: 'sfx_whistle', cfg: 'WHISTLE' }],
  POST: [{ key: 'sfx_post', cfg: 'POST' }],
  GOAL: [
    { key: 'sfx_goal', cfg: 'GOAL' },
    { key: 'sfx_cheer', cfg: 'CHEER', volume: BALANCE_CONFIG.AUDIO.GOAL_CHEER_VOLUME },
  ],
  CROWD_CHEER: [{ key: 'sfx_cheer', cfg: 'CHEER' }],
  UI_CLICK: [{ key: 'sfx_click', cfg: 'CLICK' }],
};

export class AudioDirector {
  private adapter?: SoundAdapter;
  private synth?: SoundAdapter;
  private masterVolume = 1.0;
  private readonly debug: boolean;
  /** Warn once per missing key — repeated events must not spam the console. */
  private missingWarned = new Set<string>();
  /** Deterministic round-robin variant counters per event (no RNG). */
  private variantCounters = new Map<AudioEvent, number>();

  constructor(adapter?: SoundAdapter, options: AudioDirectorOptions = {}) {
    this.adapter = adapter;
    this.synth = options.synth;
    this.debug = options.debug ?? false;
  }

  public setAdapter(adapter: SoundAdapter): void {
    this.adapter = adapter;
  }

  /** Batch B2: attach (or replace) the procedural synthesis fallback. */
  public setSynthAdapter(synth: SoundAdapter): void {
    this.synth = synth;
  }

  /**
   * Batch C: starts the looping ambient crowd bed through the synth adapter
   * when it supports one. Silent when no synth (or no bed support) is
   * attached — audio must never break gameplay.
   */
  public startCrowdBed(): void {
    try {
      (this.synth as { startCrowdBed?: () => void } | undefined)?.startCrowdBed?.();
    } catch {
      // Audio must never break gameplay.
    }
  }

  /**
   * Phase 4 Batch B (section 22 layer 3): crowd bed intensity target from
   * MatchScene's low-cadence sampler. Delegated to the synth adapter, which
   * owns the bed gain node and ramps it smoothly (anti-zipper). Silent when
   * no synth is attached — audio must never break gameplay.
   */
  public setCrowdIntensity(level: number): void {
    try {
      (this.synth as { setCrowdIntensity?: (level: number) => void } | undefined)?.setCrowdIntensity?.(
        level,
      );
    } catch {
      // Audio must never break gameplay.
    }
  }

  /**
   * Plays one mapped key: the asset adapter wins when it can play the key
   * (PRES-2 skip + debug-warn otherwise, never throws); the synth fallback
   * covers missing assets so wired events still sound with zero audio files.
   */
  private playKey(mapping: SfxMapping, event: AudioEvent): void {
    const entry = BALANCE_CONFIG.AUDIO[mapping.cfg];
    const { volume, rate } = this.variantConfig(event, entry.VOLUME, entry.RATE, mapping.volume);
    if (this.adapter && (!this.adapter.has || this.adapter.has(mapping.key))) {
      this.adapter.play(mapping.key, { volume, rate });
      return;
    }
    if (this.adapter?.has && !this.adapter.has(mapping.key)) {
      if (this.debug && !this.missingWarned.has(mapping.key)) {
        this.missingWarned.add(mapping.key);
        // eslint-disable-next-line no-console
        console.warn(`[AudioDirector] missing audio asset "${mapping.key}" — event skipped`);
      }
    }
    this.synth?.play(mapping.key, { volume, rate });
  }

  /**
   * Deterministic variant: round-robin step around the base volume/rate from
   * config (AGENTS.md section 22 pitch/volume variation without RNG).
   */
  private variantConfig(
    event: AudioEvent,
    baseVolume: number,
    baseRate: number,
    volumeOverride?: number,
  ): { volume: number; rate: number } {
    const audio = BALANCE_CONFIG.AUDIO;
    const n = this.variantCounters.get(event) ?? 0;
    this.variantCounters.set(event, n + 1);
    const step = (n % audio.VARIANTS) - (audio.VARIANTS - 1) / VARIANTS_CENTER_DIVISOR;
    const volume = Math.max(
      0,
      (volumeOverride ?? baseVolume) * this.masterVolume + step * audio.VARIANT_VOLUME_STEP,
    );
    const rate = Math.max(VARIANT_RATE_FLOOR, baseRate * (1 + step * audio.VARIANT_RATE_STEP));
    return {
      volume: Math.min(volume, audio.MASTER_VOLUME),
      rate,
    };
  }

  public playEvent(event: AudioEvent): void {
    if (!this.adapter && !this.synth) {
      return;
    }
    for (const mapping of EVENT_SFX[event]) {
      this.playKey(mapping, event);
    }
  }
}

/** Centering divisor for the symmetric variant spread (arithmetic, not tuning). */
const VARIANTS_CENTER_DIVISOR = 2;
/** Rate floor keeps variant playbackpos audible and positive. */
const VARIANT_RATE_FLOOR = 0.25;
