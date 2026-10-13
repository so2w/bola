import { anchorCoords, resolveFormation, type AnchorCoord, type FormationId } from '../data/formations';

/**
 * Formation shape names for 11v11. '4-4-2' is data-driven via
 * FORMATIONS['11v11']; '4-3-3' and '3-5-2' are documented stubs that fall
 * back to 4-4-2 (out of scope for the vertical slice — see design S1).
 */
export type FormationType = '4-4-2' | '4-3-3' | '3-5-2';

export interface Position2D {
  x: number;
  y: number;
  role: 'GK' | 'DF' | 'MF' | 'FW';
}

export type Anchor2D = AnchorCoord;

export class FormationSystem {
  /**
   * @deprecated Superseded by the data-driven path (FORMATIONS['11v11'] +
   * FormationSystem.anchors). Kept as a thin adapter over the same data so
   * legacy callers stay numerically identical; removal targeted after S2.
   */
  public static getPositions(formation: FormationType, side: 'home' | 'away', pitchW = 960, pitchH = 540): Position2D[] {
    if (formation !== '4-4-2') {
      // Documented stub: only 4-4-2 exists as data in this slice; other
      // shapes fall back to it instead of hardcoding parallel coord tables.
    }
    return FormationSystem.anchors('11v11', side, pitchW, pitchH).map((a) => ({
      x: a.x,
      y: a.y,
      role: a.role,
    }));
  }

  /**
   * Converts data-driven normalized formation anchors to absolute pitch coords.
   * Home team: x = nx * pitchW. Away team: mirrored horizontally.
   * Unknown ids throw a descriptive error (FORM-1 scenario 3).
   */
  public static anchors(formationId: FormationId, side: 'home' | 'away', pitchW = 960, pitchH = 540): Anchor2D[] {
    return anchorCoords(resolveFormation(formationId), side, pitchW, pitchH);
  }
}
