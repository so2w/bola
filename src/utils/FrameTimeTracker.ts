import { BALANCE_CONFIG } from '../data/balance';

/**
 * Batch B2 — lightweight rolling frame-time tracker (AGENTS.md section 33).
 * Fed from the scene update loop; exposes rolling avg/max over a configured
 * sample window. Pure math, headless-testable. Non-finite or negative
 * samples are ignored (a torn-down loop must not poison the stats).
 */
export class FrameTimeTracker {
  public readonly window: number;
  private samples: number[] = [];
  private sum = 0;
  private peak = 0;

  constructor(windowSize: number = BALANCE_CONFIG.PERF.FRAME_TIME_WINDOW) {
    this.window = Math.max(1, Math.floor(windowSize));
  }

  public push(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
      return;
    }
    this.samples.push(deltaMs);
    this.sum += deltaMs;
    if (deltaMs > this.peak) {
      this.peak = deltaMs;
    }
    if (this.samples.length > this.window) {
      const dropped = this.samples.shift();
      this.sum -= dropped ?? 0;
      if (dropped !== undefined && dropped >= this.peak) {
        this.peak = this.samples.reduce((m, s) => (s > m ? s : m), 0);
      }
    }
  }

  public get count(): number {
    return this.samples.length;
  }

  public get avg(): number {
    if (this.samples.length === 0) {
      return 0;
    }
    return this.sum / this.samples.length;
  }

  public get max(): number {
    return this.peak;
  }

  public reset(): void {
    this.samples = [];
    this.sum = 0;
    this.peak = 0;
  }

  /** Dev-console line (no HUD widget — the debug overlay is Phase 4). */
  public toLogString(): string {
    return `[FrameTime] frame avg=${this.avg.toFixed(2)}ms max=${this.max.toFixed(2)}ms n=${this.count}`;
  }
}
