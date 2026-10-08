import { describe, it, expect } from 'vitest';
import { GoalkeeperAI } from '../src/ai/GoalkeeperAI';

describe('GoalkeeperAI FSM', () => {
  it('tracks ball position along the goal line within bounds', () => {
    const gk = new GoalkeeperAI();
    const gkContext = { x: 50, y: 270, goalY: 270, minY: 200, maxY: 340 };

    const res = gk.update(16, gkContext, { x: 300, y: 220 }, { x: 0, y: 0 });
    expect(res.targetY).toBe(220);
    expect(gk.state).toBe('TRACK');
  });

  it('triggers DIVE when fast shot approaches goal area', () => {
    const gk = new GoalkeeperAI();
    const gkContext = { x: 50, y: 270, goalY: 270, minY: 200, maxY: 340 };

    const res = gk.update(16, gkContext, { x: 80, y: 270 }, { x: -300, y: 0 });
    expect(res.action).toBe('DIVE');
    expect(gk.state).toBe('DIVE');
  });
});
