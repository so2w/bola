export type TutorialStep = 'STEP_1_ATTACK' | 'STEP_2_DEFENSE' | 'STEP_3_MATCH' | 'COMPLETED';

export class TutorialManager {
  private currentStep: TutorialStep = 'STEP_1_ATTACK';
  private goalsScoredInStep = 0;
  private tacklesMadeInStep = 0;

  public getStep(): TutorialStep {
    return this.currentStep;
  }

  public isCompleted(): boolean {
    return this.currentStep === 'COMPLETED';
  }

  public onGoalScored(): void {
    if (this.currentStep === 'STEP_1_ATTACK') {
      this.goalsScoredInStep += 1;
      if (this.goalsScoredInStep >= 1) {
        this.currentStep = 'STEP_2_DEFENSE';
      }
    }
  }

  public onTackleSuccess(): void {
    if (this.currentStep === 'STEP_2_DEFENSE') {
      this.tacklesMadeInStep += 1;
      if (this.tacklesMadeInStep >= 1) {
        this.currentStep = 'STEP_3_MATCH';
      }
    }
  }

  public onMatchFinished(): void {
    if (this.currentStep === 'STEP_3_MATCH') {
      this.currentStep = 'COMPLETED';
    }
  }
}
