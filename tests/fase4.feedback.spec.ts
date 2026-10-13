import { describe, it, expect } from 'vitest';
import { classifyGoalLineEntry, GoalFeedback } from '../src/match/GoalFeedback';
import { BALANCE_CONFIG } from '../src/data/balance';

const FB = BALANCE_CONFIG.FEEDBACK;
const CENTER = FB.GOAL_MOUTH_CENTER_Y_PX; // 270
const HALF = FB.GOAL_MOUTH_HALF_HEIGHT_PX; // 70
const BAND = FB.POST_BAND_HEIGHT_PX; // 24

/**
 * Fase 4 Slice 1 — MF-1 classification helper (5.1 RED) and MF-2 event
 * guards (5.2 RED). Phaser-free: MatchScene wires zones/overlaps to these.
 */
describe('MF-1 classifyGoalLineEntry (5.1)', () => {
  it('MF-1-S1: inside goal mouth band -> GOAL', () => {
    expect(classifyGoalLineEntry(CENTER)).toBe('GOAL');
    expect(classifyGoalLineEntry(CENTER + HALF - 1)).toBe('GOAL');
    expect(classifyGoalLineEntry(CENTER - HALF + 1)).toBe('GOAL');
  });

  it('MF-1-S2: just beyond the mouth, inside post band -> POST', () => {
    expect(classifyGoalLineEntry(CENTER + HALF + BAND / 2)).toBe('POST');
    expect(classifyGoalLineEntry(CENTER - HALF - BAND / 2)).toBe('POST');
  });

  it('MF-1-S3: overlapping boundary yields a single deterministic result (inclusive tiebreak: outer post edge -> POST)', () => {
    const exact = classifyGoalLineEntry(CENTER + HALF + BAND);
    expect(exact).toBe('POST');
    expect(classifyGoalLineEntry(CENTER + HALF + BAND)).toBe(exact); // deterministic, no RNG
  });

  it('MF-1-S4: boundary rule flips with POST_BOUNDARY_INCLUSIVE', () => {
    // With inclusive boundary, the goal-mouth edge is GOAL.
    expect(classifyGoalLineEntry(CENTER + HALF, { ...FB })).toBe('GOAL');
    // Exclusive rule: same edge falls through to POST.
    expect(classifyGoalLineEntry(CENTER + HALF, { ...FB, POST_BOUNDARY_INCLUSIVE: false })).toBe('POST');
    // And the outer post edge becomes WIDE when exclusive.
    expect(classifyGoalLineEntry(CENTER + HALF + BAND, { ...FB, POST_BOUNDARY_INCLUSIVE: false })).toBe('WIDE');
  });

  it('beyond post band -> WIDE', () => {
    expect(classifyGoalLineEntry(CENTER + HALF + BAND + 1)).toBe('WIDE');
  });
});

describe('MF-2 GoalFeedback guards (5.2)', () => {
  const MATCH_STATES = { KICKOFF: 'KICKOFF', PLAYING: 'PLAYING', GOAL: 'GOAL' };

  it('MF-1-S2/S3: POST fires once per shot while play is live', () => {
    const fb = new GoalFeedback();
    expect(fb.onPostBandOverlap(MATCH_STATES.PLAYING)).toBe(true); // fires
    expect(fb.onPostBandOverlap(MATCH_STATES.PLAYING)).toBe(false); // guard
    fb.onKick(); // new shot resets the guard
    expect(fb.onPostBandOverlap(MATCH_STATES.PLAYING)).toBe(true);
  });

  it('MF-2-S1: PLAYING->GOAL fires CROWD_CHEER + NET_FLASH exactly once; restart chain does not re-fire', () => {
    const fb = new GoalFeedback();
    const goalEvents = fb.onStateTransition(MATCH_STATES.PLAYING, MATCH_STATES.GOAL);
    expect(goalEvents).toEqual(['CROWD_CHEER', 'NET_FLASH']);

    // Restart path: GOAL -> KICKOFF -> PLAYING. No new cheer.
    expect(fb.onStateTransition(MATCH_STATES.GOAL, MATCH_STATES.KICKOFF)).toEqual([]);
    expect(fb.onStateTransition(MATCH_STATES.KICKOFF, MATCH_STATES.PLAYING)).toEqual([]);
  });

  it('MF-2-S2: crossings during GOAL state fire nothing', () => {
    const fb = new GoalFeedback();
    fb.onStateTransition(MATCH_STATES.PLAYING, MATCH_STATES.GOAL);
    expect(fb.onPostBandOverlap(MATCH_STATES.GOAL)).toBe(false);
  });

  it('post guard resets when play resumes after restart', () => {
    const fb = new GoalFeedback();
    expect(fb.onPostBandOverlap(MATCH_STATES.PLAYING)).toBe(true);
    fb.onStateTransition(MATCH_STATES.PLAYING, MATCH_STATES.GOAL);
    fb.onStateTransition(MATCH_STATES.GOAL, MATCH_STATES.KICKOFF);
    fb.onStateTransition(MATCH_STATES.KICKOFF, MATCH_STATES.PLAYING);
    expect(fb.onPostBandOverlap(MATCH_STATES.PLAYING)).toBe(true);
  });
});
