import { describe, it, expect } from 'vitest';
import { TutorialManager } from '../src/progression/TutorialManager';

describe('TutorialManager', () => {
  it('starts at STEP_1_ATTACK and advances to STEP_2_DEFENSE on goal', () => {
    const tut = new TutorialManager();
    expect(tut.getStep()).toBe('STEP_1_ATTACK');

    tut.onGoalScored();
    expect(tut.getStep()).toBe('STEP_2_DEFENSE');
  });

  it('advances through all 3 steps to COMPLETED', () => {
    const tut = new TutorialManager();
    tut.onGoalScored(); // STEP 1 -> STEP 2
    tut.onTackleSuccess(); // STEP 2 -> STEP 3
    tut.onMatchFinished(); // STEP 3 -> COMPLETED

    expect(tut.isCompleted()).toBe(true);
  });
});
