import { describe, it, expect, vi } from 'vitest';
import { MatchManager } from '../src/systems/MatchManager';
import { FormationSystem } from '../src/match/FormationSystem';

function fakePlayer() {
  return {
    setPosition: vi.fn(function (px: number, py: number) {
      this.x = px;
      this.y = py;
    }),
    body: { setVelocity: vi.fn() },
    x: 0,
    y: 0,
  } as any;
}

describe('MatchManager — team arrays + formation anchors', () => {
  it('resetMatch places every player at its formation anchor (no hardcoded coords)', () => {
    const mgr = new MatchManager();
    mgr.state = 'GOAL';
    mgr.resetTimer = 0;
    const homeAnchors = FormationSystem.anchors('3v3', 'home');
    const awayAnchors = FormationSystem.anchors('3v3', 'away');
    const home = homeAnchors.map(() => fakePlayer());
    const away = awayAnchors.map(() => fakePlayer());
    const ball = { reset: vi.fn() };

    mgr.bind({} as any, ball as any, home, away, { home: '3v3', away: '3v3' });
    mgr.restart();

    home.forEach((p, i) => {
      expect(p.setPosition).toHaveBeenCalledWith(homeAnchors[i].x, homeAnchors[i].y);
    });
    away.forEach((p, i) => {
      expect(p.setPosition).toHaveBeenCalledWith(awayAnchors[i].x, awayAnchors[i].y);
    });
    expect(ball.reset).toHaveBeenCalled();
    expect(mgr.state).toBe('KICKOFF');
    expect(mgr.score).toEqual({ home: 0, away: 0 });
    expect(mgr.timeRemaining).toBe(540);
  });

  it('home FW anchor is not the legacy hardcoded kickoff position (560, 270)', () => {
    const anchors = FormationSystem.anchors('3v3', 'home');
    const home = anchors.map(() => fakePlayer());
    const away = anchors.map(() => fakePlayer());
    const mgr = new MatchManager();

    mgr.bind({} as any, { reset: vi.fn() } as any, home, away, { home: '3v3', away: '3v3' });
    mgr.restart();

    // Legacy reset placed players at (560,270)/(400,270) — data anchors differ
    expect(home[2].x).toBe(anchors[2].x);
    expect(home[2].x).not.toBe(560);
  });

  it('freeze zeroes velocity for every player in both teams', () => {
    const mgr = new MatchManager();
    const home = [fakePlayer(), fakePlayer(), fakePlayer()];
    const away = [fakePlayer(), fakePlayer(), fakePlayer()];

    mgr.bind({} as any, { reset: vi.fn(), body: { setVelocity: vi.fn() } } as any, home, away, { home: '3v3', away: '3v3' });
    (mgr as any).freezeEntities();

    for (const p of [...home, ...away]) {
      expect(p.body.setVelocity).toHaveBeenCalledWith(0, 0);
    }
  });
});
