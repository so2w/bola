import { resolveFormation, type FormationId } from '../data/formations';

/**
 * Scene init-data shape for MatchScene formation selection (FORM-1).
 * Defaults keep legacy 3v3 behavior until a later Fase 3 slice flips the
 * default to 11v11 — no gameplay regression for existing flows.
 */
export interface MatchSceneInitData {
  formationHome?: FormationId;
  formationAway?: FormationId;
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
  const home: FormationId = data?.formationHome ?? '3v3';
  const away: FormationId = data?.formationAway ?? '3v3';
  resolveFormation(home);
  resolveFormation(away);
  return { home, away };
}
