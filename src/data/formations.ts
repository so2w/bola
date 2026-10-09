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

export type FormationId = '3v3' | '5v5'; // future: '11v11'

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
};
