import { describe, it, expect, vi, afterEach } from 'vitest';
import { BALANCE_CONFIG } from '../src/data/balance';
import {
  computeCrowdIntensity,
  nextCrowdLevel,
  CrowdIntensitySampler,
} from '../src/audio/crowdIntensity';
import { AudioDirector } from '../src/audio/AudioDirector';
import { WebAudioSynth } from '../src/audio/WebAudioSynth';

// Phase 4 Batch B (AGENTS.md section 22 layer 3): dynamic stadium crowd —
// intensity by ball zone + score differential, low-cadence sampling, smooth
// clamped interpolation (no zipper noise), goal peak layered under the cheer.

const CD = BALANCE_CONFIG.AUDIO.CROWD_DYNAMICS;
const PHYS = BALANCE_CONFIG.PHYSICS;

afterEach(() => {
  delete (globalThis as Record<string, unknown>)['AudioContext'];
});

// ---------------------------------------------------------------------------
// Config shape (zero tuning literals outside BALANCE_CONFIG).
// ---------------------------------------------------------------------------

describe('crowd dynamics — config carries every level and curve', () => {
  it('CROWD_DYNAMICS exposes cadence, levels, zones and attack/release rates', () => {
    expect(CD.SAMPLE_INTERVAL_MS).toBeGreaterThan(0);
    expect(CD.NEUTRAL_LEVEL).toBeGreaterThan(0);
    expect(CD.ATTACKING_THIRD_PX).toBeGreaterThan(0);
    expect(CD.BOX_ZONE_PX).toBeGreaterThan(0);
    expect(CD.ATTACKING_THIRD_PX).toBeGreaterThan(CD.BOX_ZONE_PX);
    expect(CD.ATTACK_PER_MS).toBeGreaterThan(0);
    expect(CD.RELEASE_PER_MS).toBeGreaterThan(0);
  });

  it('level ladder rises toward the box and peaks on goal', () => {
    expect(CD.GOAL_PEAK_LEVEL).toBeGreaterThan(CD.BOX_LEVEL);
    expect(CD.BOX_LEVEL).toBeGreaterThan(CD.THIRD_LEVEL);
    expect(CD.THIRD_LEVEL).toBeGreaterThan(CD.NEUTRAL_LEVEL);
  });

  it('baseline keeps the old static bed mix (no volume regression at kickoff)', () => {
    expect(CD.NEUTRAL_LEVEL).toBe(BALANCE_CONFIG.AUDIO.CROWD_BED.VOLUME);
  });
});

// ---------------------------------------------------------------------------
// Target level: ball zone + score differential.
// ---------------------------------------------------------------------------

describe('crowd dynamics — computeCrowdIntensity by zone and score', () => {
  it('midfield is the neutral baseline', () => {
    expect(computeCrowdIntensity({ ballX: PHYS.PITCH_WIDTH / 2, scoreHome: 0, scoreAway: 0 })).toBe(
      CD.NEUTRAL_LEVEL,
    );
  });

  it('attacking thirds rise; the box rises more (symmetric on both flanks)', () => {
    const left = CD.BOX_ZONE_PX + (CD.ATTACKING_THIRD_PX - CD.BOX_ZONE_PX) / 2;
    const right = PHYS.PITCH_WIDTH - left;
    expect(computeCrowdIntensity({ ballX: left, scoreHome: 0, scoreAway: 0 })).toBe(CD.THIRD_LEVEL);
    expect(computeCrowdIntensity({ ballX: right, scoreHome: 0, scoreAway: 0 })).toBe(CD.THIRD_LEVEL);
    expect(computeCrowdIntensity({ ballX: CD.BOX_ZONE_PX / 2, scoreHome: 0, scoreAway: 0 })).toBe(
      CD.BOX_LEVEL,
    );
    expect(
      computeCrowdIntensity({ ballX: PHYS.PITCH_WIDTH - CD.BOX_ZONE_PX / 2, scoreHome: 0, scoreAway: 0 }),
    ).toBe(CD.BOX_LEVEL);
  });

  it('home crowd is louder when home leads; an away lead gets no bonus', () => {
    const base = computeCrowdIntensity({ ballX: PHYS.PITCH_WIDTH / 2, scoreHome: 0, scoreAway: 0 });
    const leading = computeCrowdIntensity({
      ballX: PHYS.PITCH_WIDTH / 2,
      scoreHome: 1,
      scoreAway: 0,
    });
    const trailing = computeCrowdIntensity({
      ballX: PHYS.PITCH_WIDTH / 2,
      scoreHome: 0,
      scoreAway: 1,
    });
    expect(leading).toBe(Math.min(base + CD.LEAD_BONUS, CD.MAX_LEVEL));
    expect(trailing).toBe(base);
  });

  it('levels stay inside the configured clamp window for extreme inputs', () => {
    const levels = [
      computeCrowdIntensity({ ballX: -500, scoreHome: 0, scoreAway: 0 }),
      computeCrowdIntensity({ ballX: 5000, scoreHome: 0, scoreAway: 0 }),
      computeCrowdIntensity({ ballX: 0, scoreHome: 9, scoreAway: 0 }),
    ];
    for (const level of levels) {
      expect(level).toBeGreaterThanOrEqual(CD.MIN_LEVEL);
      expect(level).toBeLessThanOrEqual(CD.MAX_LEVEL);
    }
  });
});

// ---------------------------------------------------------------------------
// Smoothing: bounded interpolation toward the target (attack/release).
// ---------------------------------------------------------------------------

describe('crowd dynamics — nextCrowdLevel smooth interpolation', () => {
  it('rises at ATTACK_PER_MS and never overshoots the target', () => {
    const dt = CD.SAMPLE_INTERVAL_MS;
    const first = nextCrowdLevel(CD.NEUTRAL_LEVEL, CD.BOX_LEVEL, dt);
    expect(first).toBe(CD.NEUTRAL_LEVEL + CD.ATTACK_PER_MS * dt);
    const nearTarget = nextCrowdLevel(CD.BOX_LEVEL - CD.ATTACK_PER_MS * dt / 2, CD.BOX_LEVEL, dt);
    expect(nearTarget).toBe(CD.BOX_LEVEL);
  });

  it('falls at RELEASE_PER_MS toward lower targets', () => {
    const dt = CD.SAMPLE_INTERVAL_MS;
    const fell = nextCrowdLevel(CD.BOX_LEVEL, CD.NEUTRAL_LEVEL, dt);
    expect(fell).toBe(CD.BOX_LEVEL - CD.RELEASE_PER_MS * dt);
  });

  it('converges to the target, stays finite and inside the clamps', () => {
    let level = CD.NEUTRAL_LEVEL;
    for (let i = 0; i < 500; i++) {
      level = nextCrowdLevel(level, CD.BOX_LEVEL, CD.SAMPLE_INTERVAL_MS);
      expect(Number.isFinite(level)).toBe(true);
      expect(level).toBeGreaterThanOrEqual(CD.MIN_LEVEL);
      expect(level).toBeLessThanOrEqual(CD.MAX_LEVEL);
    }
    expect(level).toBe(CD.BOX_LEVEL);
  });

  it('decay from the goal peak lands back near the baseline (small decay back)', () => {
    let level = CD.GOAL_PEAK_LEVEL;
    for (let i = 0; i < 100; i++) {
      level = nextCrowdLevel(level, CD.NEUTRAL_LEVEL, CD.SAMPLE_INTERVAL_MS);
    }
    expect(level).toBe(CD.NEUTRAL_LEVEL);
  });
});

// ---------------------------------------------------------------------------
// Cadence: the sampler writes a level only when the interval elapsed.
// ---------------------------------------------------------------------------

describe('crowd dynamics — CrowdIntensitySampler cadence', () => {
  it('emits null below the cadence and a level once it elapses', () => {
    const sampler = new CrowdIntensitySampler();
    expect(sampler.update(CD.SAMPLE_INTERVAL_MS - 1, { ballX: 480, scoreHome: 0, scoreAway: 0 })).toBeNull();
    const level = sampler.update(1, { ballX: 480, scoreHome: 0, scoreAway: 0 });
    expect(level).not.toBeNull();
    expect(CD.MIN_LEVEL).toBeLessThanOrEqual(level as number);
    expect((level as number) >= CD.MIN_LEVEL && (level as number) <= CD.MAX_LEVEL).toBe(true);
  });

  it('accumulates frame deltas across updates (no per-frame writes)', () => {
    const sampler = new CrowdIntensitySampler();
    expect(sampler.update(50, { ballX: 480, scoreHome: 0, scoreAway: 0 })).toBeNull();
    expect(sampler.update(50, { ballX: 480, scoreHome: 0, scoreAway: 0 })).toBeNull();
    expect(sampler.update(50, { ballX: 480, scoreHome: 0, scoreAway: 0 })).toBeNull();
    expect(sampler.update(50, { ballX: 480, scoreHome: 0, scoreAway: 0 })).toBeNull();
    expect(sampler.update(50, { ballX: 480, scoreHome: 0, scoreAway: 0 })).not.toBeNull();
  });

  it('forceLevel jumps immediately (goal peak) and decays from there', () => {
    const sampler = new CrowdIntensitySampler();
    sampler.forceLevel(CD.GOAL_PEAK_LEVEL);
    const level = sampler.update(CD.SAMPLE_INTERVAL_MS, {
      ballX: PHYS.PITCH_WIDTH / 2,
      scoreHome: 0,
      scoreAway: 0,
    });
    expect(level).toBe(CD.GOAL_PEAK_LEVEL - CD.RELEASE_PER_MS * CD.SAMPLE_INTERVAL_MS);
  });
});

// ---------------------------------------------------------------------------
// Delegation: AudioDirector -> synth, headless-safe.
// ---------------------------------------------------------------------------

describe('crowd dynamics — AudioDirector.setCrowdIntensity delegation', () => {
  it('delegates to the synth adapter', () => {
    const director = new AudioDirector(undefined, { debug: false });
    expect(() => director.setCrowdIntensity(0.4)).not.toThrow();
    const synth = { play: vi.fn(), setCrowdIntensity: vi.fn() };
    director.setSynthAdapter(synth);
    director.setCrowdIntensity(0.4);
    expect(synth.setCrowdIntensity).toHaveBeenCalledWith(0.4);
  });
});

describe('crowd dynamics — WebAudioSynth bed gain ramp', () => {
  function installFakeAudioContext() {
    const gains: Array<{
      value: number;
      setValueAtTime: ReturnType<typeof vi.fn>;
      linearRampToValueAtTime: ReturnType<typeof vi.fn>;
      cancelScheduledValues: ReturnType<typeof vi.fn>;
    }> = [];
    class FakeContext {
      state = 'running';
      currentTime = 123;
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
            cancelScheduledValues: vi.fn(),
          },
          connect: vi.fn(),
        };
        gains.push(gain.gain);
        return gain;
      }
      createBuffer(_ch: number, len: number, _rate: number) {
        return { getChannelData: () => new Float32Array(len) };
      }
      createBufferSource() {
        return { buffer: null, loop: false, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
      }
      createBiquadFilter() {
        return { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect: vi.fn() };
      }
      createOscillator() {
        return { type: '', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
      }
    }
    (globalThis as Record<string, unknown>)['AudioContext'] = FakeContext;
    return { gains };
  }

  it('before the bed starts: safe no-op', () => {
    const synth = new WebAudioSynth();
    expect(() => synth.setCrowdIntensity(0.6)).not.toThrow();
  });

  it('ramps the bed gain smoothly toward the clamped level (no zipper writes)', () => {
    const { gains } = installFakeAudioContext();
    const synth = new WebAudioSynth();
    synth.startCrowdBed();
    const bedGain = gains[0];
    // Bed starts at the baseline volume.
    expect(bedGain.value).toBe(
      Math.min(1, BALANCE_CONFIG.AUDIO.CROWD_BED.VOLUME * BALANCE_CONFIG.AUDIO.MASTER_VOLUME),
    );

    synth.setCrowdIntensity(0.6);
    const master = BALANCE_CONFIG.AUDIO.MASTER_VOLUME;
    expect(bedGain.setValueAtTime).toHaveBeenCalled();
    expect(bedGain.linearRampToValueAtTime).toHaveBeenCalledWith(0.6 * master, expect.any(Number));
    // One smooth ramp per sample, not a direct .value zipper write.
    expect(bedGain.linearRampToValueAtTime).toHaveBeenCalledTimes(1);
  });

  it('clamps out-of-range levels before touching the graph', () => {
    const { gains } = installFakeAudioContext();
    const synth = new WebAudioSynth();
    synth.startCrowdBed();
    const bedGain = gains[0];
    bedGain.linearRampToValueAtTime.mockClear();
    synth.setCrowdIntensity(50);
    const maxTarget = Math.min(1, CD.MAX_LEVEL * BALANCE_CONFIG.AUDIO.MASTER_VOLUME);
    expect(bedGain.linearRampToValueAtTime).toHaveBeenCalledWith(maxTarget, expect.any(Number));
  });

  it('headless (no AudioContext): start + set never throw', () => {
    const synth = new WebAudioSynth();
    expect(synth.startCrowdBed()).toBe(false);
    expect(() => synth.setCrowdIntensity(0.5)).not.toThrow();
  });
});
