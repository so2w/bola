import { describe, it, expect } from 'vitest';
import { PlayerSelectionSystem } from '../src/match/PlayerSelectionSystem';

describe('PlayerSelectionSystem', () => {
  it('selects the closest player initially', () => {
    const selector = new PlayerSelectionSystem(300);
    const candidates = [
      { id: 'p1', x: 100, y: 100 },
      { id: 'p2', x: 400, y: 400 },
    ];
    const ballPos = { x: 120, y: 120 };

    const selected = selector.update(16, candidates, ballPos, { x: 0, y: 0 });
    expect(selected).toBe('p1');
  });

  it('prevents jitter oscillations thanks to hysteresis and cooldown', () => {
    const selector = new PlayerSelectionSystem(300);
    const candidates = [
      { id: 'p1', x: 100, y: 100 },
      { id: 'p2', x: 130, y: 100 },
    ];

    // Select p1 first
    selector.update(16, candidates, { x: 100, y: 100 }, { x: 0, y: 0 });
    expect(selector.getSelectedId()).toBe('p1');

    // Move ball slightly closer to p2, but within hysteresis + cooldown window
    selector.update(16, candidates, { x: 125, y: 100 }, { x: 0, y: 0 });
    expect(selector.getSelectedId()).toBe('p1');
  });
});
