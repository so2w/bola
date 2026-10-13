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
}

export class AudioDirector {
  private adapter?: SoundAdapter;
  private masterVolume = 1.0;
  private readonly debug: boolean;
  /** Warn once per missing key — repeated events must not spam the console. */
  private missingWarned = new Set<string>();

  constructor(adapter?: SoundAdapter, options: AudioDirectorOptions = {}) {
    this.adapter = adapter;
    this.debug = options.debug ?? false;
  }

  public setAdapter(adapter: SoundAdapter): void {
    this.adapter = adapter;
  }

  /** PRES-2: skip + debug-warn on missing asset; never throw. */
  private playKey(key: string, config?: { volume?: number; rate?: number }): void {
    if (!this.adapter) {
      return;
    }
    if (this.adapter.has && !this.adapter.has(key)) {
      if (this.debug && !this.missingWarned.has(key)) {
        this.missingWarned.add(key);
        // eslint-disable-next-line no-console
        console.warn(`[AudioDirector] missing audio asset "${key}" — event skipped`);
      }
      return;
    }
    this.adapter.play(key, config);
  }

  public playEvent(event: AudioEvent): void {
    if (!this.adapter) {
      return;
    }

    switch (event) {
      case 'KICK':
        this.playKey('sfx_kick', { volume: 0.8 * this.masterVolume, rate: 1.0 });
        break;
      case 'PASS':
        this.playKey('sfx_pass', { volume: 0.6 * this.masterVolume, rate: 1.1 });
        break;
      case 'WHISTLE':
        this.playKey('sfx_whistle', { volume: 0.9 * this.masterVolume, rate: 1.0 });
        break;
      case 'POST':
        this.playKey('sfx_post', { volume: 1.0 * this.masterVolume, rate: 1.0 });
        break;
      case 'GOAL':
        this.playKey('sfx_goal', { volume: 1.0 * this.masterVolume });
        this.playKey('sfx_cheer', { volume: 0.9 * this.masterVolume });
        break;
      case 'CROWD_CHEER':
        this.playKey('sfx_cheer', { volume: 0.7 * this.masterVolume });
        break;
      case 'UI_CLICK':
        this.playKey('sfx_click', { volume: 0.5 * this.masterVolume });
        break;
    }
  }
}
