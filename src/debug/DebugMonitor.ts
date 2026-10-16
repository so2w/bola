import { BALANCE_CONFIG } from '../data/balance';
import type { DebugTuning } from './DebugTuning';

/** Rolling frame-time stats (from FrameTimeTracker). */
export interface DebugFrameStats {
  avg: number;
  max: number;
  count: number;
}

/** One selection candidate score (from PlayerSelectionSystem). */
export interface DebugCandidateScore {
  id: string;
  score: number;
}

/** Active surface/weather modifier snapshot. */
export interface DebugSurfaceInfo {
  level: string;
  weather: string;
  frictionMultiplier: number;
  sprintSpeedMultiplier: number;
  receptionDifficulty: number;
}

/** Raw values gathered by the scene (all optional chains allowed at runtime). */
export interface DebugPayloadInput {
  frameStats: DebugFrameStats;
  matchState: string;
  possessionHomePct: number;
  controlledPlayerId: string | null;
  selectionCandidates: DebugCandidateScore[];
  pressersHome: number;
  pressersAway: number;
  holderId: string | null;
  ballX: number;
  ballY: number;
  ballZ: number;
  ballSpeed: number;
  surface: DebugSurfaceInfo;
  rngSeed: number;
}

/** Sanitized debug payload (AGENTS.md section 30 field list). */
export interface DebugPayload {
  fps: number;
  frameAvgMs: number;
  frameMaxMs: number;
  frameCount: number;
  matchState: string;
  possessionHomePct: number;
  possessionAwayPct: number;
  controlledPlayerId: string | null;
  selectionCandidates: DebugCandidateScore[];
  pressersHome: number;
  pressersAway: number;
  holderId: string | null;
  ballX: number;
  ballY: number;
  ballZ: number;
  ballSpeed: number;
  surface: DebugSurfaceInfo;
  rngSeed: number;
}

function safe(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

/**
 * DebugMonitor — pure payload builder + formatter for the section-30 debug
 * overlay. Every non-finite input is sanitized to 0 so the panel can never
 * render NaN. Allocation happens at debug cadence only (~4Hz while visible);
 * the hidden overlay performs zero work.
 */
export function buildDebugPayload(input: DebugPayloadInput): DebugPayload {
  const fs = input.frameStats ?? { avg: 0, max: 0, count: 0 };
  const frameAvgMs = safe(fs.avg);
  const frameMaxMs = safe(fs.max);
  const frameCount = Math.max(0, safe(fs.count));
  const fps = frameAvgMs > 0 ? safe(1000 / frameAvgMs) : 0;
  const homePct = Math.min(100, Math.max(0, safe(input.possessionHomePct)));
  return {
    frameAvgMs,
    frameMaxMs,
    frameCount,
    fps,
    matchState: input.matchState ?? 'UNKNOWN',
    possessionHomePct: homePct,
    possessionAwayPct: 100 - homePct,
    controlledPlayerId: input.controlledPlayerId ?? null,
    selectionCandidates: (input.selectionCandidates ?? [])
      .slice(0, BALANCE_CONFIG.DEBUG.PANEL.MAX_CANDIDATES)
      .map((c) => ({ id: c.id, score: safe(c.score) })),
    pressersHome: Math.max(0, Math.round(safe(input.pressersHome))),
    pressersAway: Math.max(0, Math.round(safe(input.pressersAway))),
    holderId: input.holderId ?? null,
    ballX: safe(input.ballX),
    ballY: safe(input.ballY),
    ballZ: safe(input.ballZ),
    ballSpeed: Math.max(0, safe(input.ballSpeed)),
    surface: {
      level: input.surface?.level ?? 'UNKNOWN',
      weather: input.surface?.weather ?? 'UNKNOWN',
      frictionMultiplier: safe(input.surface?.frictionMultiplier),
      sprintSpeedMultiplier: safe(input.surface?.sprintSpeedMultiplier),
      receptionDifficulty: safe(input.surface?.receptionDifficulty),
    },
    rngSeed: safe(input.rngSeed),
  };
}

/** Renders the payload as overlay lines (English UI copy, config keys shown). */
export function formatDebugPayload(payload: DebugPayload, tuning: DebugTuning): string {
  const D = BALANCE_CONFIG.DEBUG;
  const lines: string[] = [];
  lines.push(
    `FPS ${payload.fps.toFixed(1)} | frame avg ${payload.frameAvgMs.toFixed(2)}ms max ${payload.frameMaxMs.toFixed(2)}ms (n=${payload.frameCount})`,
  );
  lines.push(
    `state ${payload.matchState} | poss H${payload.possessionHomePct.toFixed(0)}/A${payload.possessionAwayPct.toFixed(0)}`,
  );
  const cands = payload.selectionCandidates
    .map((c) => `${c.id} ${c.score.toFixed(2)}`)
    .join(' | ');
  lines.push(`ctrl ${payload.controlledPlayerId ?? 'none'} | cands ${cands || 'none'}`);
  lines.push(
    `AI press H${payload.pressersHome}/A${payload.pressersAway} | holder ${payload.holderId ?? 'none'}`,
  );
  lines.push(
    `ball x ${payload.ballX.toFixed(0)} y ${payload.ballY.toFixed(0)} z ${payload.ballZ.toFixed(0)} | v ${payload.ballSpeed.toFixed(0)}px/s`,
  );
  lines.push(
    `pitch ${payload.surface.level} | ${payload.surface.weather} | fr ${payload.surface.frictionMultiplier.toFixed(2)} spr ${payload.surface.sprintSpeedMultiplier.toFixed(2)} rec ${payload.surface.receptionDifficulty.toFixed(2)}`,
  );
  lines.push(`rng seed ${payload.rngSeed}`);
  for (const line of tuning.describe()) {
    lines.push(line);
  }
  lines.push(
    `${D.ADJUST_DOWN_KEY}/${D.ADJUST_UP_KEY} adjust, ${D.CYCLE_KNOB_KEY} cycle, ${D.TOGGLE_KEY} hide`,
  );
  return lines.join('\n');
}
