import { resolveFormation, type FormationId } from '../data/formations';

/**
 * Scene init-data shape for MatchScene formation selection (FORM-1).
 * Batch B1: the shipped default is 11v11 — 3v3/5v5 stay available via the
 * explicit formation param for tests and sandbox.
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
  const home: FormationId = data?.formationHome ?? '11v11';
  const away: FormationId = data?.formationAway ?? '11v11';
  resolveFormation(home);
  resolveFormation(away);
  return { home, away };
}
