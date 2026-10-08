export interface Footballer {
  id: string;
  name: string;
  position: 'GK' | 'DF' | 'MF' | 'FW';
  level: number;
  xp: number;
  energy: number;
  price: number;
}

export class EconomySystem {
  private coins = 500; // Starting soft currency

  constructor(initialCoins = 500) {
    this.coins = Math.max(0, initialCoins);
  }

  public getBalance(): number {
    return this.coins;
  }

  public addReward(amount: number): void {
    if (amount > 0) {
      this.coins += amount;
    }
  }

  public canAfford(price: number): boolean {
    return price > 0 && this.coins >= price;
  }

  public buyPlayer(roster: Footballer[], player: Footballer): boolean {
    if (roster.length >= 22) {
      return false; // Roster limit reached per AGENTS.md section 14
    }
    if (!this.canAfford(player.price)) {
      return false;
    }
    this.coins -= player.price;
    roster.push(player);
    return true;
  }
}
