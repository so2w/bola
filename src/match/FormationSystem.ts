import { FORMATIONS, type FormationId, type FormationSlot, type Role } from '../data/formations';

export type FormationType = '4-4-2' | '4-3-3' | '3-5-2';

export interface Position2D {
  x: number;
  y: number;
  role: 'GK' | 'DF' | 'MF' | 'FW';
}

export interface Anchor2D {
  x: number;
  y: number;
  role: Role;
  slot: string;
}

export class FormationSystem {
  public static getPositions(formation: FormationType, side: 'home' | 'away', pitchW = 960, pitchH = 540): Position2D[] {
    const isHome = side === 'home';
    const direction = isHome ? 1 : -1;
    const centerX = pitchW / 2;

    if (formation === '4-4-2') {
      return [
        // GK
        { x: isHome ? 60 : pitchW - 60, y: pitchH / 2, role: 'GK' },
        // Defenders (4)
        { x: centerX - direction * 280, y: pitchH * 0.2, role: 'DF' },
        { x: centerX - direction * 300, y: pitchH * 0.4, role: 'DF' },
        { x: centerX - direction * 300, y: pitchH * 0.6, role: 'DF' },
        { x: centerX - direction * 280, y: pitchH * 0.8, role: 'DF' },
        // Midfielders (4)
        { x: centerX - direction * 140, y: pitchH * 0.18, role: 'MF' },
        { x: centerX - direction * 150, y: pitchH * 0.38, role: 'MF' },
        { x: centerX - direction * 150, y: pitchH * 0.62, role: 'MF' },
        { x: centerX - direction * 140, y: pitchH * 0.82, role: 'MF' },
        // Forwards (2)
        { x: centerX - direction * 40, y: pitchH * 0.38, role: 'FW' },
        { x: centerX - direction * 40, y: pitchH * 0.62, role: 'FW' },
      ];
    }

    // Default 4-4-2 fallback
    return FormationSystem.getPositions('4-4-2', side, pitchW, pitchH);
  }

  /**
   * Converts data-driven normalized formation anchors to absolute pitch coords.
   * Home team: x = nx * pitchW. Away team: mirrored horizontally.
   */
  public static anchors(formationId: FormationId, side: 'home' | 'away', pitchW = 960, pitchH = 540): Anchor2D[] {
    const slots: FormationSlot[] = FORMATIONS[formationId];
    const flip = side === 'away';
    return slots.map((s) => ({
      x: (flip ? 1 - s.nx : s.nx) * pitchW,
      y: s.ny * pitchH,
      role: s.role,
      slot: s.id,
    }));
  }
}
