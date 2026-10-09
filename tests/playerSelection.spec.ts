import { describe, it, expect } from 'vitest';
import { PlayerSelectionSystem } from '../src/match/PlayerSelectionSystem';
import { BALANCE_CONFIG } from '../src/data/balance';

const SEL = BALANCE_CONFIG.SELECTION;

describe('PlayerSelectionSystem — intercept/angle scoring', () => {
  it('intercept beats raw distance: farther player aligned with ball velocity wins', () => {
    const selector = new PlayerSelectionSystem(SEL.COOLDOWN_MS);
    // Ball at (500, 270) moving right fast
    const ballPos = { x: 500, y: 270 };
    const ballVel = { x: 600, y: 0 };
    // A: nearer but laterally offset from the velocity line
    const a = { id: 'A', x: 520, y: 240 };
    // B: farther but exactly on the velocity line
    const b = { id: 'B', x: 560, y: 270 };

    const selected = selector.update(16, [a, b], ballPos, ballVel);

    expect(selected).toBe('B');
  });

  it('no oscillation: near-tied candidates keep the current selection', () => {
    const selector = new PlayerSelectionSystem(SEL.COOLDOWN_MS);
    const candidates = [
      { id: 'p1', x: 100, y: 100 },
      { id: 'p2', x: 115, y: 100 },
    ];

    selector.update(16, candidates, { x: 100, y: 100 }, { x: 0, y: 0 });
    expect(selector.getSelectedId()).toBe('p1');

    // Ball drifts slightly toward p2 (within hysteresis margin)
    selector.update(16, candidates, { x: 110, y: 100 }, { x: 0, y: 0 });
    selector.update(16, candidates, { x: 115, y: 100 }, { x: 0, y: 0 });
    expect(selector.getSelectedId()).toBe('p1');
  });

  it('cooldown blocks switching within 300ms; switch allowed after expiry', () => {
    const selector = new PlayerSelectionSystem(SEL.COOLDOWN_MS);
    const candidates = [
      { id: 'far', x: 100, y: 100 },
      { id: 'near', x: 300, y: 100 },
    ];

    // Select 'far' first (ball on it, no other candidates better)
    selector.update(16, candidates, { x: 100, y: 100 }, { x: 0, y: 0 });
    expect(selector.getSelectedId()).toBe('far');

    // Ball jumps to 'near' — better by a wide margin, but within cooldown
    selector.update(16, candidates, { x: 300, y: 100 }, { x: 0, y: 0 });
    expect(selector.getSelectedId()).toBe('far');

    // Advance past the cooldown window → switch allowed
    selector.update(SEL.COOLDOWN_MS + 1, candidates, { x: 300, y: 100 }, { x: 0, y: 0 });
    expect(selector.getSelectedId()).toBe('near');
  });

  it('GK is never selected even when closest to the ball', () => {
    const selector = new PlayerSelectionSystem(SEL.COOLDOWN_MS);
    const candidates = [
      { id: 'gk', x: 100, y: 100, role: 'GK' },
      { id: 'fw', x: 160, y: 100, role: 'FW' },
    ];

    const selected = selector.update(16, candidates, { x: 100, y: 100 }, { x: 0, y: 0 });

    expect(selected).toBe('fw');
  });

  it('GK excluded leaves field players even when GK would be the only candidate', () => {
    const selector = new PlayerSelectionSystem(SEL.COOLDOWN_MS);
    const candidates = [{ id: 'gk', x: 100, y: 100, role: 'GK' }];

    const selected = selector.update(16, candidates, { x: 100, y: 100 }, { x: 0, y: 0 });

    expect(selected).toBeNull();
  });

  it('engaged players are penalized but can still be re-selected as current', () => {
    const selector = new PlayerSelectionSystem(SEL.COOLDOWN_MS);
    const candidates = [
      { id: 'p1', x: 100, y: 100 },
      { id: 'p2', x: 400, y: 400, isEngaged: true },
    ];

    selector.update(16, candidates, { x: 400, y: 400 }, { x: 0, y: 0 });
    expect(selector.getSelectedId()).toBe('p2');

    // p2 stays selected when still the best option (hysteresis applies to current)
    selector.update(16, candidates, { x: 405, y: 400 }, { x: 0, y: 0 });
    expect(selector.getSelectedId()).toBe('p2');
  });
});
