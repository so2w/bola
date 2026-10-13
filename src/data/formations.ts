/**
 * Data-driven formation definitions (AGENTS.md §24: content separated from logic).
 *
 * Anchor convention: `nx`/`ny` are normalized pitch coords in [0..1]x[0..1],
 * measured from the team's DEFENDING goal toward the ATTACKING goal:
 *   nx = 0 -> own goal line, nx = 1 -> opponent goal line
 *   ny = 0 -> top touchline, ny = 1 -> bottom touchline
 * FormationSystem.anchors converts them to absolute pitch coords and mirrors
 * the away side horizontally. IDs are forward-compatible with 11v11.
 */

export type Role = 'GK' | 'DF' | 'MF' | 'FW';

export type FormationId = '3v3' | '5v5' | '11v11';

export interface FormationSlot {
  id: string;
  role: Role;
  nx: number;
  ny: number;
  side?: 'L' | 'C' | 'R';
}

export const FORMATIONS: Record<FormationId, FormationSlot[]> = {
  '3v3': [
    { id: 'gk', role: 'GK', nx: 0.06, ny: 0.5 },
    { id: 'df1', role: 'DF', nx: 0.35, ny: 0.5 },
    { id: 'fw1', role: 'FW', nx: 0.62, ny: 0.5 },
  ],
  '5v5': [
    { id: 'gk', role: 'GK', nx: 0.05, ny: 0.5 },
    { id: 'df1', role: 'DF', nx: 0.28, ny: 0.32 },
    { id: 'df2', role: 'DF', nx: 0.28, ny: 0.68 },
    { id: 'mf1', role: 'MF', nx: 0.45, ny: 0.5 },
    { id: 'fw1', role: 'FW', nx: 0.62, ny: 0.5 },
  ],
  /**
   * 11v11 default shape: 4-4-2. Numerically equivalent to the legacy
   * FormationSystem.getPositions('4-4-2') absolute coords normalized to
   * 960x540 (60/960 = 0.0625, (480-280)/960 = 0.20833..., etc.).
   * Other shapes (4-3-3, 3-5-2) are documented as out-of-scope stubs; any
   * future shape lands here as additional data, never as hardcoded coords.
   */
  '11v11': [
    { id: 'gk', role: 'GK', nx: 0.0625, ny: 0.5 },
    { id: 'lb', role: 'DF', nx: 25 / 120, ny: 0.2, side: 'L' },
    { id: 'cb1', role: 'DF', nx: 0.1875, ny: 0.4, side: 'L' },
    { id: 'cb2', role: 'DF', nx: 0.1875, ny: 0.6, side: 'R' },
    { id: 'rb', role: 'DF', nx: 25 / 120, ny: 0.8, side: 'R' },
    { id: 'lm', role: 'MF', nx: 17 / 48, ny: 0.18, side: 'L' },
    { id: 'cm1', role: 'MF', nx: 0.34375, ny: 0.38, side: 'L' },
    { id: 'cm2', role: 'MF', nx: 0.34375, ny: 0.62, side: 'R' },
    { id: 'rm', role: 'MF', nx: 17 / 48, ny: 0.82, side: 'R' },
    { id: 'st1', role: 'FW', nx: 11 / 24, ny: 0.38, side: 'L' },
    { id: 'st2', role: 'FW', nx: 11 / 24, ny: 0.62, side: 'R' },
  ],
};

/**
 * Resolves a FormationId to its slot list. Throws a descriptive error for
 * unregistered ids so scene/manager code fails BEFORE any entity spawns
 * (FORM-1 scenario 3).
 */
export function resolveFormation(id: FormationId): FormationSlot[] {
  const slots = FORMATIONS[id];
  if (!slots) {
    throw new Error(`Unknown formation id '${String(id)}'. Registered: ${Object.keys(FORMATIONS).join(', ')}`);
  }
  return slots;
}

export interface AnchorCoord {
  x: number;
  y: number;
  role: Role;
  slot: string;
}

/**
 * Converts normalized formation slots to absolute pitch coords.
 * Home team: x = nx * pitchW. Away team: mirrored horizontally.
 * Shared by FormationSystem.anchors and TeamCoordinator.
 */
export function anchorCoords(
  slots: FormationSlot[],
  side: 'home' | 'away',
  pitchW: number,
  pitchH: number,
): AnchorCoord[] {
  const flip = side === 'away';
  return slots.map((s) => ({
    x: (flip ? 1 - s.nx : s.nx) * pitchW,
    y: s.ny * pitchH,
    role: s.role,
    slot: s.id,
  }));
}
