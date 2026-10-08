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
}

export class AudioDirector {
  private adapter?: SoundAdapter;
  private masterVolume = 1.0;

  constructor(adapter?: SoundAdapter) {
    this.adapter = adapter;
  }

  public setAdapter(adapter: SoundAdapter): void {
    this.adapter = adapter;
  }

  public playEvent(event: AudioEvent): void {
    if (!this.adapter) {
      return;
    }

    switch (event) {
      case 'KICK':
        this.adapter.play('sfx_kick', { volume: 0.8 * this.masterVolume, rate: 1.0 });
        break;
      case 'PASS':
        this.adapter.play('sfx_pass', { volume: 0.6 * this.masterVolume, rate: 1.1 });
        break;
      case 'WHISTLE':
        this.adapter.play('sfx_whistle', { volume: 0.9 * this.masterVolume, rate: 1.0 });
        break;
      case 'POST':
        this.adapter.play('sfx_post', { volume: 1.0 * this.masterVolume, rate: 1.0 });
        break;
      case 'GOAL':
        this.adapter.play('sfx_goal', { volume: 1.0 * this.masterVolume });
        this.adapter.play('sfx_cheer', { volume: 0.9 * this.masterVolume });
        break;
      case 'CROWD_CHEER':
        this.adapter.play('sfx_cheer', { volume: 0.7 * this.masterVolume });
        break;
      case 'UI_CLICK':
        this.adapter.play('sfx_click', { volume: 0.5 * this.masterVolume });
        break;
    }
  }
}
