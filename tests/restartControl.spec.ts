import { describe, it, expect, vi } from 'vitest';
import { restartControlId } from '../src/match/restartControl';
import { MatchManager } from '../src/systems/MatchManager';

// Batch C-D: on own-team restarts control jumps to the nearest teammate
// (the taker where one exists); opponent restarts never steal control.
// TDD RED: restartControl helper + manager kickoff-team tracking are missing.

function homeLine() {
  return [
    { x: 100, y: 100 },
    { x: 300, y: 270 },
    { x: 440, y: 270 },
  ];
}

function fakePlayer(x = 0, y = 0) {
  return {
    x,
    y,
    sprite: { x, y } as any,
    setPosition: vi.fn(function (this: any, px: number, py: number) {
      this.x = px;
      this.y = py;
      if (this.sprite) {
        this.sprite.x = px;
        this.sprite.y = py;
      }
    }),
    body: { setVelocity: vi.fn(), setAcceleration: vi.fn() },
  } as any;
}

function fakeBall(x = 480, y = 270) {
  return {
    sprite: {
      x,
      y,
      setPosition: vi.fn(function (this: any, px: number, py: number) {
        this.x = px;
        this.y = py;
      }),
    },
    body: { setVelocity: vi.fn() },
    z: 0,
    vz: 0,
    zTarget: 0,
    reset: vi.fn(),
  } as any;
}

describe('restartControlId — own restarts claim the nearest teammate', () => {
  it('own throw-in/corner/goal-kick: nearest home player to the ball', () => {
    const ball = { x: 450, y: 270 };
    for (const kind of ['THROW_IN', 'CORNER', 'GOAL_KICK', 'KICKOFF'] as const) {
      expect(restartControlId({ kind, restartTeam: 'home', ball, home: homeLine() })).toBe('home-2');
    }
  });

  it('own free-kick/penalty: the designated taker wins over proximity', () => {
    const ball = { x: 600, y: 300 };
    expect(
      restartControlId({ kind: 'FREE_KICK', restartTeam: 'home', ball, home: homeLine(), takerId: 'home-0' }),
    ).toBe('home-0');
    expect(
      restartControlId({ kind: 'PENALTY', restartTeam: 'home', ball, home: homeLine(), takerId: 'home-1' }),
    ).toBe('home-1');
  });

  it('opponent restarts never steal control (null for every kind)', () => {
    const ball = { x: 450, y: 270 };
    for (const kind of ['THROW_IN', 'CORNER', 'GOAL_KICK', 'FREE_KICK', 'PENALTY', 'KICKOFF'] as const) {
      expect(restartControlId({ kind, restartTeam: 'away', ball, home: homeLine(), takerId: 'home-0' })).toBeNull();
    }
  });

  it('ties resolve to the lower index (deterministic)', () => {
    const ball = { x: 200, y: 100 };
    const home = [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
    ];
    expect(restartControlId({ kind: 'KICKOFF', restartTeam: 'home', ball, home })).toBe('home-0');
  });
});

describe('MatchManager kickoff-team tracking — who owns the next kickoff', () => {
  function boundManager() {
    const mgr = new MatchManager();
    mgr.bind(undefined as any, fakeBall(), [fakePlayer()], [fakePlayer()], { home: '3v3', away: '3v3' });
    return mgr;
  }

  it('match opens with a home kickoff', () => {
    expect(boundManager().kickoffTeam).toBe('home');
  });

  it('conceding team kicks off: home scores -> away kickoff; away scores -> home kickoff', () => {
    const first = boundManager();
    first.state = 'PLAYING';
    first.handleGoal('home');
    expect(first.kickoffTeam).toBe('away');
    const second = boundManager();
    second.state = 'PLAYING';
    second.handleGoal('away');
    expect(second.kickoffTeam).toBe('home');
  });
});
