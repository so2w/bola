export interface SaveGameData {
  schemaVersion: number;
  clubName: string;
  coins: number;
  rosterIds: string[];
}

export class LocalSaveRepository {
  private STORAGE_KEY = 'retro_soccer_save_v1';
  private memoryFallback: string | null = null;

  public save(data: SaveGameData): void {
    const json = JSON.stringify(data);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(this.STORAGE_KEY, json);
    } else {
      this.memoryFallback = json;
    }
  }

  public load(): SaveGameData | null {
    let raw: string | null = null;
    if (typeof localStorage !== 'undefined') {
      raw = localStorage.getItem(this.STORAGE_KEY);
    } else {
      raw = this.memoryFallback;
    }

    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.schemaVersion === 1) {
        return parsed as SaveGameData;
      }
    } catch {
      return null;
    }
    return null;
  }
}
