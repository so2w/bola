export type UpgradeType = 'PITCH_UPGRADE' | 'CAPACITY_UPGRADE' | 'LIGHTING_UPGRADE' | 'TRAINING_CENTER' | 'CLINIC';

export interface StadiumState {
  pitchLevel: 1 | 2 | 3 | 4;
  capacity: number;
  hasLighting: boolean;
  hasTrainingCenter: boolean;
  hasClinic: boolean;
}

export class StadiumSystem {
  private state: StadiumState;

  constructor(initial?: Partial<StadiumState>) {
    this.state = {
      pitchLevel: 1,
      capacity: 200,
      hasLighting: false,
      hasTrainingCenter: false,
      hasClinic: false,
      ...initial,
    };
  }

  public getState(): StadiumState {
    return { ...this.state };
  }

  public static upgradeCost(upgrade: UpgradeType): number {
    const costs: Record<UpgradeType, number> = {
      PITCH_UPGRADE: 500,
      CAPACITY_UPGRADE: 300,
      LIGHTING_UPGRADE: 600,
      TRAINING_CENTER: 800,
      CLINIC: 400,
    };
    return costs[upgrade];
  }

  public applyUpgrade(upgrade: UpgradeType, currentCoins: number): { success: boolean; remainingCoins: number } {
    const cost = StadiumSystem.upgradeCost(upgrade);
    if (currentCoins < cost) {
      return { success: false, remainingCoins: currentCoins };
    }

    switch (upgrade) {
      case 'PITCH_UPGRADE':
        if (this.state.pitchLevel < 4) {
          this.state.pitchLevel = (this.state.pitchLevel + 1) as StadiumState['pitchLevel'];
        }
        break;
      case 'CAPACITY_UPGRADE':
        this.state.capacity += 500;
        break;
      case 'LIGHTING_UPGRADE':
        this.state.hasLighting = true;
        break;
      case 'TRAINING_CENTER':
        this.state.hasTrainingCenter = true;
        break;
      case 'CLINIC':
        this.state.hasClinic = true;
        break;
    }

    return { success: true, remainingCoins: currentCoins - cost };
  }
}
