/** Tuning for the pre-match walk-in (Batch A). All values come from BALANCE_CONFIG.ENTRANCE. */
export interface EntranceWalkConfig {
  WALK_SPEED_PX_S: number;
  ARRIVE_RADIUS_PX: number;
}

/**
 * Off-pitch start positions for the player entrance (Batch A).
 * Both teams line up below the bottom touchline (tunnel/sideline) spread
 * across the width — deterministic, no RNG.
 */
export function entranceStarts(
  count: number,
  pitchW: number,
  pitchH: number,
  yOffsetPx: number,
): { x: number; y: number }[] {
  const starts: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    starts.push({
      x: ((i + 1) * pitchW) / (count + 1),
      y: pitchH + yOffsetPx,
    });
  }
  return starts;
}

/**
 * Headless entrance walk (Batch A): straight-line seek toward each player's
 * kickoff anchor at a constant walk speed. The scene mirrors this with
 * AIController MOVE commands; this model is what headless tests use to prove
 * arrival within the INTRO budget.
 */
export class EntranceWalk {
  private positions: { x: number; y: number }[];
  private readonly targets: { x: number; y: number }[];
  private readonly cfg: EntranceWalkConfig;

  constructor(
    starts: { x: number; y: number }[],
    targets: { x: number; y: number }[],
    cfg: EntranceWalkConfig,
  ) {
    this.positions = starts.map((s) => ({ ...s }));
    this.targets = targets.map((t) => ({ ...t }));
    this.cfg = { ...cfg };
  }

  public update(dtMs: number): void {
    const maxStep = (this.cfg.WALK_SPEED_PX_S * dtMs) / MS_PER_SECOND;
    for (let i = 0; i < this.positions.length; i++) {
      const p = this.positions[i];
      const t = this.targets[i];
      if (!p || !t) {
        continue;
      }
      const dx = t.x - p.x;
      const dy = t.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= this.cfg.ARRIVE_RADIUS_PX || dist === 0) {
        continue;
      }
      const step = Math.min(maxStep, dist);
      p.x += (dx / dist) * step;
      p.y += (dy / dist) * step;
    }
  }

  public allArrived(): boolean {
    for (let i = 0; i < this.positions.length; i++) {
      const p = this.positions[i];
      const t = this.targets[i];
      if (!p || !t) {
        continue;
      }
      if (Math.hypot(t.x - p.x, t.y - p.y) > this.cfg.ARRIVE_RADIUS_PX) {
        return false;
      }
    }
    return true;
  }

  public getPositions(): { x: number; y: number }[] {
    return this.positions.map((p) => ({ ...p }));
  }
}

/** Milliseconds per second (arithmetic, not tuning). */
const MS_PER_SECOND = 1000;
