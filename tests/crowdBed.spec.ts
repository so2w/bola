import { describe, it, expect, vi, afterEach } from 'vitest';
import { BALANCE_CONFIG } from '../src/data/balance';
import { AudioDirector } from '../src/audio/AudioDirector';
import { WebAudioSynth } from '../src/audio/WebAudioSynth';

// Batch C-C: looping ambient crowd bed under the goal-cheer swell.
// TDD RED: startCrowdBed / CROWD_BED config do not exist yet.

afterEach(() => {
  delete (globalThis as Record<string, unknown>)['AudioContext'];
});

function installFakeAudioContext() {
  const created: {
    loop: boolean;
    filterFreq: number;
    filterQ: number;
    gainValue: number;
  }[] = [];
  let sources = 0;
  class FakeContext {
    state = 'running';
    currentTime = 0;
    sampleRate = 44100;
    destination = {};
    resume() {
      return Promise.resolve();
    }
    createGain() {
      const gain = {
        gain: {
          value: 0,
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      };
      return gain;
    }
    createBuffer(_ch: number, len: number, _rate: number) {
      return { getChannelData: () => new Float32Array(len) };
    }
    createBufferSource() {
      sources++;
      const rec = { loop: false, filterFreq: 0, filterQ: 0, gainValue: 0 };
      created.push(rec);
      return {
        _rec: rec,
        buffer: null as unknown,
        loop: false,
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
    }
    createBiquadFilter() {
      return { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect: vi.fn() };
    }
    createOscillator() {
      return { type: '', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    }
  }
  (globalThis as Record<string, unknown>)['AudioContext'] = FakeContext;
  return {
    get sourceCount() {
      return sources;
    },
    created,
  };
}

describe('crowd bed — config carries the bed tuning', () => {
  it('AUDIO.CROWD_BED exposes volume/freq/Q/duration', () => {
    const bed = BALANCE_CONFIG.AUDIO.CROWD_BED;
    expect(bed.VOLUME).toBeGreaterThan(0);
    expect(bed.VOLUME).toBeLessThanOrEqual(1);
    expect(bed.FREQ_HZ).toBeGreaterThan(0);
    expect(bed.Q).toBeGreaterThan(0);
    expect(bed.DURATION_MS).toBeGreaterThan(0);
  });

  it('bed sits below the goal-cheer swell in the mix', () => {
    expect(BALANCE_CONFIG.AUDIO.CROWD_BED.VOLUME).toBeLessThan(BALANCE_CONFIG.AUDIO.GOAL_CHEER_VOLUME);
  });
});

describe('crowd bed — headless-safe lazy start', () => {
  it('no AudioContext: start is a safe no-op (never throws, never active)', () => {
    const synth = new WebAudioSynth();
    expect(() => synth.startCrowdBed()).not.toThrow();
    expect(synth.startCrowdBed()).toBe(false);
    expect(synth.isCrowdBedActive()).toBe(false);
  });

  it('first gesture start: looping filtered-noise bed at the configured volume', () => {
    installFakeAudioContext();
    const synth = new WebAudioSynth();
    expect(synth.startCrowdBed()).toBe(true);
    expect(synth.isCrowdBedActive()).toBe(true);
  });

  it('second start does not layer a second bed', () => {
    const hooks = installFakeAudioContext();
    const synth = new WebAudioSynth();
    synth.startCrowdBed();
    synth.startCrowdBed();
    expect(hooks.sourceCount).toBe(1);
  });
});

describe('crowd bed — director delegates, cheer stays layered', () => {
  it('AudioDirector.startCrowdBed reaches the synth adapter; silent without one', () => {
    const director = new AudioDirector(undefined, { debug: false });
    expect(() => director.startCrowdBed()).not.toThrow();
    const synth = { play: vi.fn(), startCrowdBed: vi.fn() };
    director.setSynthAdapter(synth);
    director.startCrowdBed();
    expect(synth.startCrowdBed).toHaveBeenCalledTimes(1);
  });

  it('GOAL still layers the cheer swell on top of the bed', () => {
    const played: string[] = [];
    const adapter = {
      has: () => true,
      play: (key: string) => {
        played.push(key);
      },
    };
    const director = new AudioDirector(adapter);
    director.playEvent('GOAL');
    expect(played).toContain('sfx_goal');
    expect(played).toContain('sfx_cheer');
  });
});
