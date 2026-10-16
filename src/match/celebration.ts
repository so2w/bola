/**
 * Phase 4 Batch B (AGENTS.md section 21): goal celebration player selection.
 *
 * Pure and deterministic: the scorer (last toucher, when it plays for the
 * scoring side) plus the N nearest non-GK teammates of the scoring side. An
 * own-goal toucher (opponent id) simply is not among the candidates, so the
 * selection degrades to the nearest players. Distance ties break by id.
 */

export interface CelebrationCandidate {
  id: string;
  x: number;
  y: number;
  isGk: boolean;
}

export function pickCelebrationIds(
  candidates: readonly CelebrationCandidate[],
  reference: { x: number; y: number },
  lastTouchId: string | null,
  teammateCount: number,
): string[] {
  const eligible = candidates.filter((c) => !c.isGk);
  const scorer = lastTouchId !== null ? eligible.find((c) => c.id === lastTouchId) ?? null : null;
  const rest = eligible
    .filter((c) => c !== scorer)
    .map((c) => ({ c, d: Math.hypot(c.x - reference.x, c.y - reference.y) }))
    .sort((a, b) => (a.d !== b.d ? a.d - b.d : a.c.id.localeCompare(b.c.id)))
    .slice(0, Math.max(0, teammateCount))
    .map((e) => e.c.id);
  return scorer ? [scorer.id, ...rest] : rest;
}
