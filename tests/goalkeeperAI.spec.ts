import { describe, it, expect } from 'vitest';
import { GoalkeeperAI } from '../src/ai/GoalkeeperAI';
import { mulberry32 } from '../src/utils/rng';
import { BALANCE_CONFIG } from '../src/data/balance';
import type { EntitySnapshot, BallSnapshot } from '../src/ai/commands';

const GK = BALANCE_CONFIG.GK;
const PITCH_W = BALANCE_CONFIG.PHYSICS.PITCH_WIDTH;
const PITCH_H = BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT;

function gkSnap(x = 57.6, y = 270): EntitySnapshot {
  return { id: 'home-0', team: 'home', role: 'GK', x, y, vx: 0, vy: 0, state: 'POSITION' };
}

function ball(x: number, y: number, z = 0, vx = 0, vy = 0): BallSnapshot {
  return { x, y, z, vx, vy };
}

function teammates(): EntitySnapshot[] {
  return [
    { id: 'home-1', team: 'home', role: 'DF', x: 336, y: 270, vx: 0, vy: 0 },
    { id: 'home-2', team: 'home', role: 'FW', x: 595, y: 270, vx: 0, vy: 0 },
  ];
}

function opponents(): EntitySnapshot[] {
  return [
    { id: 'away-1', team: 'away', role: 'DF', x: 624, y: 270, vx: 0, vy: 0 },
    // Asymmetric fixture: away-2 sits 114px from home DF but only 29px from home FW,
    // so the DF is STRICTLY the most open teammate (no iteration-order tie).
    { id: 'away-2', team: 'away', role: 'FW', x: 450, y: 270, vx: 0, vy: 0 },
  ];
}

function ctx(b: BallSnapshot) {
  return { ball: b, teammates: teammates(), opponents: opponents(), attackDir: 1 as const };
}

describe('GoalkeeperAI — full FSM', () => {
  it('radii and timers come from config, not hardcoded', () => {
    const custom = { ...GK, TRACK_RADIUS_PX: 300, CLAIM_RADIUS_PX: 60, DIVE_RADIUS_PX: 90, DIVE_TRIGGER_SPEED: 150, DIVE_DURATION_MS: 250 };
    const ai = new GoalkeeperAI(mulberry32(1), custom);

    // Ball within custom track radius (300) but beyond default (260)
    const cmd = ai.tick(16, gkSnap(), ctx(ball(57.6 + 280, 270)));
    expect(cmd.action).toBe('TRACK');

    // Ball within custom dive radius (90) at speed > custom trigger (150)
    const cmd2 = ai.tick(16, gkSnap(), ctx(ball(57.6 + 80, 270, 0, -400, 0)));
    expect(cmd2.action).toBe('DIVE');
  });

  it('TRACK when ball within track radius; POSITION anchor otherwise', () => {
    const ai = new GoalkeeperAI(mulberry32(1));

    const far = ai.tick(16, gkSnap(), ctx(ball(600, 270)));
    expect(far.action).toBe('MOVE'); // POSITION: hold goal-line anchor
    expect(far.targetX).toBe(57.6);

    const tracking = ai.tick(16, gkSnap(), ctx(ball(57.6 + 200, 320)));
    expect(tracking.action).toBe('TRACK');
  });

  it('CLAIM when ball close and slow; HOLD when secured', () => {
    const ai = new GoalkeeperAI(mulberry32(1));

    // Ball stationary within claim radius
    const claim = ai.tick(16, gkSnap(), ctx(ball(57.6 + 30, 270)));
    expect(claim.action).toBe('CLAIM');

    // GK reaches the ball → HOLD with hold timer started
    const atBall = gkSnap(57.6 + 30, 270);
    const hold = ai.tick(16, atBall, ctx(ball(57.6 + 30, 270)));
    expect(hold.action).toBe('HOLD');
  });

  it('dive reachable: GK enters DIVE before a 600px/s shot crosses the goal line', () => {
    const ai = new GoalkeeperAI(mulberry32(1));
    const gk = gkSnap(57.6, 270);
    // Shot from just beyond dive radius, aimed head-on at the goal (x=20 line)
    const startX = 57.6 + GK.DIVE_RADIUS_PX + 10;
    let b = ball(startX, 270, 0, -600, 0);

    let enteredDiveAtFrame = -1;
    let crossedGoalLine = false;
    for (let frame = 0; frame < 60; frame++) {
      ai.tick(16, gk, ctx(b));
      if (ai.state === 'DIVE' && enteredDiveAtFrame === -1) {
        enteredDiveAtFrame = frame;
      }
      b = { ...b, x: b.x + b.vx * 0.016 };
      if (b.x <= 20) {
        crossedGoalLine = true;
        break;
      }
    }

    expect(enteredDiveAtFrame).toBeGreaterThanOrEqual(0);
    // Dive must happen BEFORE the ball crosses the goal line
    expect(crossedGoalLine).toBe(true);
    expect(enteredDiveAtFrame).toBeLessThan(15); // ~15 frames of flight from dive radius
  });

  it('distribute after hold: passes to the most open teammate and recovers', () => {
    const ai = new GoalkeeperAI(mulberry32(1));
    const atBall = gkSnap(57.6 + 30, 270);

    // Secure the ball
    ai.tick(16, atBall, ctx(ball(57.6 + 30, 270)));
    expect(ai.state).toBe('HOLD');

    // Elapse the hold time → the tick after HOLD expires returns DISTRIBUTE
    let cmd = { targetX: 0, targetY: 0, action: 'HOLD' as const };
    for (let i = 0; i < 100; i++) {
      cmd = ai.tick(16, atBall, ctx(ball(57.6 + 30, 270)));
      if (cmd.action === 'DISTRIBUTE') break;
    }
    expect(cmd.action).toBe('DISTRIBUTE');
    expect(ai.state).toBe('RECOVER');
    // Asymmetric fixture: home-1 (DF, 336) is 114px from its nearest opponent;
    // home-2 (FW, 595) is only 29px from its marker → the DF is strictly most open.
    expect(cmd.targetX).toBe(336);
    expect(cmd.targetY).toBe(270);

    // DISTRIBUTE is followed by RECOVER (walk back)
    const recover = ai.tick(16, atBall, ctx(ball(57.6 + 30, 270)));
    expect(recover.action).toBe('MOVE');
    // With the ball gone (kicked away), the FSM returns to POSITION
    ai.tick(16, atBall, ctx(ball(600, 270)));
    expect(ai.state).toBe('POSITION');
  });
});
