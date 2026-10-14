import { describe, expect, it } from 'vitest';
import { MatchManager } from '../src/systems/MatchManager';
import { TeamCoordinator } from '../src/ai/TeamCoordinator';
import { GoalkeeperAI } from '../src/ai/GoalkeeperAI';
import { PossessionSystem } from '../src/match/PossessionSystem';
import { BallCaptureSystem } from '../src/match/BallCaptureSystem';
import { AIController } from '../src/input/AIController';
import { choosePassTarget } from '../src/input/HumanInputController';
import { shouldShowControlsHint } from '../src/ui/controlsHint';
import { anchorCoords, resolveFormation } from '../src/data/formations';
import { BALANCE_CONFIG } from '../src/data/balance';
import { applyKickoffGracePowerCap, isKickoffGraceActive } from '../src/match/kickGate';
import { mulberry32 } from '../src/utils/rng';
import type { BallSnapshot, EntitySnapshot } from '../src/ai/commands';

// ---------------------------------------------------------------------------
// Playtest round 3 (fase 4): "8-0 by minute 1" repro harness.
//
// Symptom 1: a kickoff K sends the ball THROUGH every player straight into
//   goal — nothing physically intercepts the ball and the GK never dives.
// Symptom 2: teammates run robotic straight lines and freeze on their anchor.
// Symptom 3: the player doesn't know the controls.
// Symptom 4: J frequently does nothing (empty pass cone => no pass).
//
// Every suite mirrors MatchScene wiring headlessly with the REAL domain
// classes. Like round 2, each regression must name its broken path.
// ---------------------------------------------------------------------------

const W = BALANCE_CONFIG.PHYSICS.PITCH_WIDTH;
const H = BALANCE_CONFIG.PHYSICS.PITCH_HEIGHT;
const DT = 16;
const SPEED = BALANCE_CONFIG.PHYSICS.PLAYER_MAX_SPEED;

const GOAL_RIGHT = { xMin: 920, xMax: 960, yMin: 200, yMax: 340 };

interface SimEntity extends EntitySnapshot {
  setPosition(x: number, y: number): void;
}

function makeEntity(id: string, team: 'home' | 'away', role: EntitySnapshot['role'], x: number, y: number): SimEntity {
  return {
    id, team, role, x, y, vx: 0, vy: 0,
    setPosition(nx: number, ny: number) {
      this.x = nx;
      this.y = ny;
    },
  };
}

function snapOf(e: SimEntity): EntitySnapshot {
  return { id: e.id, team: e.team, role: e.role, x: e.x, y: e.y, vx: e.vx, vy: e.vy };
}

// ===========================================================================
// TASK 1.1 — BallCaptureSystem: the ball must never cross a player unchecked
// ===========================================================================
describe('playtest round 3/TASK 1.1 — BallCaptureSystem (sticky trap)', () => {
  const fieldPlayer = (x: number, y: number): EntitySnapshot => ({
    id: 'away-2', team: 'away', role: 'MF', x, y, vx: 0, vy: 0,
  });
  const gk = (x: number, y: number): EntitySnapshot => ({
    id: 'away-0', team: 'away', role: 'GK', x, y, vx: 0, vy: 0,
  });

  it('a grounded pass-speed ball crossing a standing field player is trapped (stops dead)', () => {
    const cap = new BallCaptureSystem();
    // Ball travelling along y=270 at pass speed (240px/s < TRAP_MAX_SPEED).
    const prev: BallSnapshot = { x: 400, y: 270, z: 0, vx: 240, vy: 0 };
    // One frame later the segment passes right through the player's body (420,270).
    const now: BallSnapshot = { x: 404, y: 270, z: 0, vx: 240, vy: 0 };
    const ev = cap.evaluate([fieldPlayer(420, 270)], prev, now);
    expect(ev).not.toBeNull();
    expect(ev?.playerId).toBe('away-2');
    expect(ev?.stopBall).toBe(true);
  });

  it('a fast shot (600px/s) crossing a field player is NOT trapped (needs GK/error)', () => {
    const cap = new BallCaptureSystem();
    const prev: BallSnapshot = { x: 400, y: 270, z: 0, vx: 600, vy: 0 };
    const now: BallSnapshot = { x: 410, y: 270, z: 0, vx: 600, vy: 0 };
    const ev = cap.evaluate([fieldPlayer(420, 270)], prev, now);
    expect(ev).toBeNull();
  });

  it('a fast shot approaching the GK inside CLAIM_RADIUS is claimed', () => {
    const cap = new BallCaptureSystem();
    const prev: BallSnapshot = { x: 850, y: 270, z: 0, vx: 600, vy: 0 };
    const now: BallSnapshot = { x: 860, y: 270, z: 0, vx: 600, vy: 0 };
    // GK at 902: segment does not reach him yet — no capture.
    expect(cap.evaluate([gk(902, 270)], prev, now)).toBeNull();
    // GK moved out to 880 to meet it: capture.
    const ev = cap.evaluate([gk(880, 270)], prev, now);
    expect(ev?.playerId).toBe('away-0');
  });

  it('a high ball (z above INTERCEPT_MAX_Z) is never trapped', () => {
    const cap = new BallCaptureSystem();
    const prev: BallSnapshot = { x: 400, y: 270, z: 40, vx: 240, vy: 0 };
    const now: BallSnapshot = { x: 404, y: 270, z: 40, vx: 240, vy: 0 };
    expect(cap.evaluate([fieldPlayer(408, 270)], prev, now)).toBeNull();
  });
});

// ===========================================================================
// TASK 1.2 — GK reacts to a fast straight shot from center
// ===========================================================================
describe('playtest round 3/TASK 1.2 — GK defends a 600px/s straight shot', () => {
  it('GK at (902,270) tracks, dives and the ball is captured BEFORE the goal line', () => {
    const gkAI = new GoalkeeperAI(mulberry32(7));
    const capture = new BallCaptureSystem();
    const gkEntity = makeEntity('away-0', 'away', 'GK', 902.4, 270);
    // Ball kicked from center at 600px/s aimed dead straight at the right goal.
    const ball = { x: 480, y: 270, z: 0, zTarget: 0, vx: 600, vy: 0 };

    const states = new Set<string>();
    let capturedAtX: number | null = null;
    let scored = false;

    for (let frame = 0; frame < 200 && !scored && capturedAtX === null; frame++) {
      const cmd = gkAI.tick(DT, snapOf(gkEntity), {
        ball: { x: ball.x, y: ball.y, z: ball.z, vx: ball.vx, vy: ball.vy },
        teammates: [],
        opponents: [],
        attackDir: -1,
      });
      states.add(cmd.action);

      // GK locomotion toward the command target at player max speed.
      const dx = cmd.targetX - gkEntity.x;
      const dy = cmd.targetY - gkEntity.y;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        gkEntity.setPosition(
          gkEntity.x + (dx / len) * Math.min(len, SPEED * (DT / 1000)),
          gkEntity.y + (dy / len) * Math.min(len, SPEED * (DT / 1000)),
        );
      }

      // Ball flight + z spring (same math as Ball.preUpdate).
      const prev: BallSnapshot = { x: ball.x, y: ball.y, z: ball.z, vx: ball.vx, vy: ball.vy };
      ball.x += ball.vx * (DT / 1000);
      ball.y += ball.vy * (DT / 1000);
      ball.zTarget = ball.zTarget > 0 ? ball.zTarget * 0.92 : 0;
      ball.z = Math.max(0, ball.z + (ball.zTarget - ball.z) * 0.15);

      const ev = capture.evaluate([snapOf(gkEntity)], prev, {
        x: ball.x, y: ball.y, z: ball.z, vx: ball.vx, vy: ball.vy,
      });
      if (ev) {
        capturedAtX = ball.x;
      }
      if (ball.y >= GOAL_RIGHT.yMin && ball.y <= GOAL_RIGHT.yMax && ball.x >= GOAL_RIGHT.xMin) {
        scored = true;
      }
    }

    // The keeper must at least TRACK and DIVE at some point during the shot.
    expect([...states]).toContain('TRACK');
    expect([...states]).toContain('DIVE');
    // And crucially the interception happens before the goal mouth (x=920).
    expect(scored).toBe(false);
    expect(capturedAtX).not.toBeNull();
    expect(capturedAtX as number).toBeLessThan(GOAL_RIGHT.xMin);
  });
});

// ===========================================================================
// TASK 1.3 — kickoff: a single immediate K must never produce a goal
// ===========================================================================
describe('playtest round 3/TASK 1.3 — kickoff free-goal harness', () => {
  it('kickGate caps charge power during the kickoff grace window', () => {
    const resumedAt = 1500;
    const inGrace = resumedAt + 200;
    const afterGrace = resumedAt + BALANCE_CONFIG.MATCH.KICKOFF_GRACE_MS + 50;
    expect(isKickoffGraceActive(resumedAt, inGrace)).toBe(true);
    expect(applyKickoffGracePowerCap(1.0, resumedAt, inGrace)).toBeLessThanOrEqual(
      BALANCE_CONFIG.MATCH.KICKOFF_GRACE_SHOT_CAP,
    );
    expect(applyKickoffGracePowerCap(0.2, resumedAt, inGrace)).toBe(0.2);
    expect(applyKickoffGracePowerCap(1.0, resumedAt, afterGrace)).toBe(1.0);
    expect(applyKickoffGracePowerCap(1.0, null, 5000)).toBe(1.0);
  });

  interface KickoffRun {
    goalsWithinGrace: number;
    captured: boolean;
  }

  /**
   * Kickoff -> PLAYING -> the human walks onto the ball and immediately fires
   * a full-charge K straight at the right goal. Real domain wiring:
   * MatchManager clock, both TeamCoordinators, per-frame GK, PossessionSystem
   * + BallCaptureSystem interception, kickGate grace power cap.
   */
  function runKickoffShot(seed: number): KickoffRun {
    const slots = resolveFormation('3v3');
    const homeCoords = anchorCoords(slots, 'home', W, H);
    const awayCoords = anchorCoords(slots, 'away', W, H);
    const home = homeCoords.map((a, i) => makeEntity(`home-${i}`, 'home', a.role, a.x, a.y));
    const away = awayCoords.map((a, i) => makeEntity(`away-${i}`, 'away', a.role, a.x, a.y));
    // Deterministic per-seed jitter of the away wall (spread out kickoff lanes).
    const rng = mulberry32(seed);
    for (const e of away.slice(1)) {
      e.setPosition(e.x + (rng() * 40 - 20), e.y + (rng() * 40 - 20));
    }

    const mgr = new MatchManager();
    const possession = new PossessionSystem();
    const capture = new BallCaptureSystem();
    const coordHome = new TeamCoordinator('home', slots, mulberry32(seed * 7 + 1));
    const coordAway = new TeamCoordinator('away', slots, mulberry32(seed * 7 + 2));

    const ball = { x: W / 2, y: H / 2, z: 0, zTarget: 0, vx: 0, vy: 0 };
    const human = home[home.length - 1]; // FW — the auto-selected player

    let goalsWithinGrace = 0;
    let captured = false;
    let playResumedAt: number | null = null;
    let kicked = false;
    let nowMs = 0;

    while (nowMs < 12000 && mgr.state !== 'GAME_OVER') {
      nowMs += DT;
      const prevState = mgr.state;
      mgr.update(DT);
      if (prevState !== 'PLAYING' && mgr.state === 'PLAYING') {
        playResumedAt = nowMs;
      }

      const homeSnaps = home.map(snapOf);
      const awaySnaps = away.map(snapOf);
      const bSnap: BallSnapshot = { x: ball.x, y: ball.y, z: ball.z, vx: ball.vx, vy: ball.vy };

      possession.update(DT, [...homeSnaps, ...awaySnaps], bSnap);
      const homeCmds = coordHome.update(nowMs, homeSnaps, bSnap, possession);
      const awayCmds = coordAway.update(nowMs, awaySnaps, bSnap, possession);

      for (const [snaps, opp, coord, dir] of [
        [homeSnaps, awaySnaps, coordHome, 1],
        [awaySnaps, homeSnaps, coordAway, -1],
      ] as const) {
        const gkSnap = snaps.find((s) => s.role === 'GK');
        if (gkSnap) {
          coord.tickGK(DT, gkSnap, {
            ball: bSnap,
            teammates: snaps.filter((s) => s.role !== 'GK'),
            opponents: opp,
            attackDir: dir as 1 | -1,
          });
        }
      }

      if (mgr.state === 'PLAYING') {
        // Human AI-exempt: walks to the ball, then smashes K at full charge.
        if (!kicked) {
          const dx = ball.x - human.x;
          const dy = ball.y - human.y;
          const dist = Math.hypot(dx, dy);
          if (dist > BALANCE_CONFIG.INPUT.PASS_PICKUP_RADIUS_PX - 4) {
            human.setPosition(
              human.x + (dx / dist) * SPEED * (DT / 1000),
              human.y + (dy / dist) * SPEED * (DT / 1000),
            );
          } else {
            // Human kick goes through the same wireShots gate semantics:
            // grace window caps the power.
            let power = 1.0;
            power = applyKickoffGracePowerCap(power, playResumedAt, nowMs);
            ball.vx = power * BALANCE_CONFIG.PHYSICS.BALL_MAX_IMPULSE;
            ball.vy = 0;
            ball.zTarget = power * BALANCE_CONFIG.PHYSICS.BALL_MAX_Z;
            possession.onKick();
            kicked = true;
          }
        }

        // AI locomotion for everyone else.
        for (const e of [...home, ...away]) {
          if (e === human) {
            continue;
          }
          const cmd = (e.team === 'home' ? homeCmds : awayCmds).get(e.id);
          if (!cmd) {
            continue;
          }
          const dx = cmd.targetX - e.x;
          const dy = cmd.targetY - e.y;
          const len = Math.hypot(dx, dy);
          if (len > 1) {
            e.setPosition(
              e.x + (dx / len) * Math.min(len, SPEED * (DT / 1000)),
              e.y + (dy / len) * Math.min(len, SPEED * (DT / 1000)),
            );
          }
        }

        // Ball integration (match ball z model).
        const prevBall: BallSnapshot = { x: ball.x, y: ball.y, z: ball.z, vx: ball.vx, vy: ball.vy };
        ball.x += ball.vx * (DT / 1000);
        ball.y += ball.vy * (DT / 1000);
        ball.zTarget = ball.zTarget > 0 ? ball.zTarget * 0.92 : 0;
        ball.z = Math.max(0, ball.z + (ball.zTarget - ball.z) * 0.15);

        // Physical interception BEFORE the goal-zone check.
        if (possession.possessorId === null) {
          const ev = capture.evaluate(
            [...home.map(snapOf), ...away.map(snapOf)],
            prevBall,
            { x: ball.x, y: ball.y, z: ball.z, vx: ball.vx, vy: ball.vy },
          );
          if (ev) {
            ball.vx = 0;
            ball.vy = 0;
            ball.zTarget = 0;
            possession.setPossessor(ev.playerId);
            captured = true;
          }
        }

        if (
          ball.y >= GOAL_RIGHT.yMin &&
          ball.y <= GOAL_RIGHT.yMax &&
          ball.x >= GOAL_RIGHT.xMin &&
          ball.x <= GOAL_RIGHT.xMax
        ) {
          const sinceResume = playResumedAt === null ? Infinity : nowMs - playResumedAt;
          if (sinceResume <= 3000) {
            goalsWithinGrace++;
          }
          mgr.handleGoal('home');
        }
      }
    }
    return { goalsWithinGrace, captured };
  }

  it('5 seeded kickoffs with immediate full-K produce ZERO goals in the first 3 seconds', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const r = runKickoffShot(seed);
      expect(r.goalsWithinGrace, `seed ${seed} scored off the kickoff kick`).toBe(0);
      expect(r.captured, `seed ${seed}: ball flew through every defender`).toBe(true);
    }
  });

  it('runs are deterministic per seed', () => {
    expect(runKickoffShot(3)).toEqual(runKickoffShot(3));
  });
});

// ===========================================================================
// TASK 2 — locomotion smoothing: arrival damping + at-target wander
// ===========================================================================
describe('playtest round 3/TASK 2 — AIController locomotion (no robot lines)', () => {
  it('arrival damping: inside ARRIVAL_RADIUS the player slows below max speed', () => {
    const cfg = BALANCE_CONFIG.AI;
    const c = new AIController();
    // 20px away from a MOVE target: within ARRIVAL_RADIUS but outside the snap zone.
    const v = c.computeMovement({ x: 0, y: 0 }, { targetX: 20, targetY: 0, action: 'MOVE' }, DT);
    expect(v).not.toBeNull();
    const speed = Math.hypot(v!.vx, v!.vy);
    expect(speed).toBeGreaterThan(0);
    expect(speed).toBeLessThan(BALANCE_CONFIG.PHYSICS.PLAYER_MAX_SPEED);
  });

  it('at-target wander: an idle-at-anchor player keeps drifting instead of freezing', () => {
    const c = new AIController(undefined, BALANCE_CONFIG.AI, 0);
    let x = 0;
    let y = 0;
    let sumSpeed = 0;
    let headingDeltaSum = 0;
    let prevHeading: number | null = null;
    for (let i = 0; i < 3000 / DT; i++) {
      const v = c.computeMovement({ x, y }, { targetX: 0, targetY: 0, action: 'MOVE' }, DT);
      if (!v) {
        continue;
      }
      const sp = Math.hypot(v.vx, v.vy);
      sumSpeed += sp;
      if (sp > 1e-6) {
        const heading = Math.atan2(v.vy, v.vx);
        if (prevHeading !== null) {
          let d = Math.abs(heading - prevHeading);
          if (d > Math.PI) {
            d = 2 * Math.PI - d;
          }
          headingDeltaSum += d;
        }
        prevHeading = heading;
      }
      x += v.vx * (DT / 1000);
      y += v.vy * (DT / 1000);
    }
    // Not frozen: real displacement over the 3s window...
    expect(sumSpeed / (3000 / DT)).toBeGreaterThan(2);
    // ...but never a long straight line: accumulated heading change is large.
    expect(headingDeltaSum).toBeGreaterThan(1.0);
    // And the player stays parked near its anchor (bounded wander).
    expect(Math.hypot(x, y)).toBeLessThanOrEqual(BALANCE_CONFIG.AI.ARRIVAL_RADIUS_PX * 2);
  });

  it('two players sharing a target never collapse onto the same point', () => {
    const a = new AIController(undefined, BALANCE_CONFIG.AI, 0);
    const b = new AIController(undefined, BALANCE_CONFIG.AI, Math.PI);
    let ax = 0;
    let ay = 0;
    let bx = 0;
    let by = 0;
    const cmd = { targetX: 0, targetY: 0, action: 'MOVE' as const };
    let minSep = Infinity;
    for (let i = 0; i < 3000 / DT; i++) {
      const va = a.computeMovement({ x: ax, y: ay }, cmd, DT);
      const vb = b.computeMovement({ x: bx, y: by }, cmd, DT);
      if (va) {
        ax += va.vx * (DT / 1000);
        ay += va.vy * (DT / 1000);
      }
      if (vb) {
        bx += vb.vx * (DT / 1000);
        by += vb.vy * (DT / 1000);
      }
      if (i > 10) {
        minSep = Math.min(minSep, Math.hypot(ax - bx, ay - by));
      }
    }
    // Body radius is ~10px; staggered wander keeps them separated.
    expect(minSep).toBeGreaterThan(4);
  });
});

// ===========================================================================
// TASK 3 — controls discoverability hint
// ===========================================================================
describe('playtest round 3/TASK 3 — controls hint visibility', () => {
  const HINT_MS = BALANCE_CONFIG.UI.CONTROLS_HINT_MS;

  it('visible during KICKOFF', () => {
    expect(shouldShowControlsHint('KICKOFF', null, 10000)).toBe(true);
  });

  it('visible during the first 15s of PLAYING, hidden after or at GAME_OVER', () => {
    expect(shouldShowControlsHint('PLAYING', 5000, 5000 + HINT_MS - 1000)).toBe(true);
    expect(shouldShowControlsHint('PLAYING', 5000, 5000 + HINT_MS + 1000)).toBe(false);
    expect(shouldShowControlsHint('GAME_OVER', 5000, 6000)).toBe(false);
    expect(shouldShowControlsHint('GOAL', 5000, 6000)).toBe(false);
  });
});

// ===========================================================================
// TASK 4 — pass fallback: J must always pass when a forward teammate exists
// ===========================================================================
describe('playtest round 3/TASK 4 — pass fallback forward', () => {
  const cfg = BALANCE_CONFIG.INPUT;

  it('empty cone falls back to the furthest FORWARD teammate (cone ignored, range kept)', () => {
    // No teammate inside the 45° forward cone, but one forward at 80° (outside cone).
    const target = choosePassTarget(
      { x: 100, y: 270 },
      [
        { x: 105, y: 100 }, // forward but outside cone (dy=-170 dominated)
        { x: 105, y: 440 }, // forward outside cone, closer-forward is first
        { x: 50, y: 270 }, // backward — never eligible
      ],
      1,
      cfg,
    );
    expect(target).not.toBeNull();
    expect(target).toEqual({ x: 105, y: 100 });
  });

  it('no forward teammate at all => still no pass', () => {
    const target = choosePassTarget(
      { x: 100, y: 270 },
      [{ x: 50, y: 270 }],
      1,
      cfg,
    );
    expect(target).toBeNull();
  });

  it('config default is forward fallback', () => {
    expect(cfg.EMPTY_CONE_FALLBACK).toBe('forward');
  });
});
