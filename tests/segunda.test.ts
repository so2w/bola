import { describe, it, expect } from 'vitest';
import { AIDifficultyScaler } from '../src/ai/AIDifficultyScaler';
import { StadiumSystem } from '../src/club/StadiumSystem';

describe('AIDifficultyScaler', () => {
  it('returns different profiles per league tier', () => {
    const amateur = AIDifficultyScaler.getProfile('AMATEUR');
    const segunda = AIDifficultyScaler.getProfile('SEGUNDA');
    const primera = AIDifficultyScaler.getProfile('PRIMERA');

    expect(amateur.passAccuracy).toBeLessThan(segunda.passAccuracy);
    expect(segunda.passAccuracy).toBeLessThan(primera.passAccuracy);
    expect(amateur.reactionMs).toBeGreaterThan(segunda.reactionMs);
    expect(segunda.reactionMs).toBeGreaterThan(primera.reactionMs);
  });

  it('Segunda División accuracy is >= 0.85 per spec', () => {
    const profile = AIDifficultyScaler.getProfile('SEGUNDA');
    expect(profile.passAccuracy).toBeGreaterThanOrEqual(0.85);
    expect(profile.reactionMs).toBeLessThanOrEqual(150);
  });
});

describe('StadiumSystem', () => {
  it('applies PITCH_UPGRADE immediately when affordable', () => {
    const stadium = new StadiumSystem();
    const result = stadium.applyUpgrade('PITCH_UPGRADE', 1000);

    expect(result.success).toBe(true);
    expect(result.remainingCoins).toBe(500);
    expect(stadium.getState().pitchLevel).toBe(2);
  });

  it('rejects upgrade if insufficient coins', () => {
    const stadium = new StadiumSystem();
    const result = stadium.applyUpgrade('CAPACITY_UPGRADE', 100);

    expect(result.success).toBe(false);
    expect(stadium.getState().capacity).toBe(200);
  });

  it('CAPACITY_UPGRADE adds +500 to stadium capacity', () => {
    const stadium = new StadiumSystem();
    stadium.applyUpgrade('CAPACITY_UPGRADE', 1000);
    expect(stadium.getState().capacity).toBe(700);
  });
});
