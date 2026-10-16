import { resolveFormation, type FormationId } from '../data/formations';
import type { PitchQuality, WeatherType } from './WeatherSystem';

/**
 * Scene init-data shape for MatchScene selection (FORM-1 + settings batch).
 * Batch B1: the shipped default is 11v11 — 3v3/5v5 stay available via the
 * explicit formation param for tests and sandbox. The settings batch adds
 * surface/weather/duration/volume carried from the pre-match menu
 * (session-only; persistence is a Phase 6 OPEN QUESTION).
 */
export interface MatchSceneInitData {
  formationHome?: FormationId;
  formationAway?: FormationId;
  surface?: PitchQuality;
  weather?: WeatherType;
  /** Real minutes (3 or 5, AGENTS.md section 7); drives the match clock. */
  durationRealMinutes?: number;
  /** Master volume step in [0, 1]; reaches AudioDirector on create. */
  volume?: number;
}

export interface MatchFormations {
  home: FormationId;
  away: FormationId;
}

/**
 * Resolves and validates per-team formations from scene init data.
 * Unknown ids throw a descriptive error BEFORE any entity spawns
 * (FORM-1 scenario 3). Phaser-free so it is unit-testable.
 */
export function resolveMatchFormations(data?: MatchSceneInitData): MatchFormations {
  const home: FormationId = data?.formationHome ?? '11v11';
  const away: FormationId = data?.formationAway ?? '11v11';
  resolveFormation(home);
  resolveFormation(away);
  return { home, away };
}
