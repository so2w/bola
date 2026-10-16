/**
 * Fase 4 Slice 1 (PA-1): manifest-driven spritesheet frame registry.
 *
 * The players sheet's frame index equals the entry position inside
 * manifest.spritesheets.players.frames (names are the single source of truth).
 * Phaser-free: importable from unit tests without a Phaser runtime.
 *
 * Phase 4 Batch B: the clip set grew to 8 (idle/run/kick + tackle, celebrate,
 * GK dive/claim/distribute) — every clip resolves per team with a home-frame
 * + tint fallback, same PA-1-S3 rule as the original three.
 */

export type ClubTeam = 'home' | 'away';
export type PlayerClip =
  | 'idle'
  | 'run'
  | 'kick'
  | 'tackle'
  | 'celebrate'
  | 'dive'
  | 'claim'
  | 'distribute';

export interface PlayersManifestLike {
  spritesheets: { players: { frames: string[] } };
}

/** Builds name -> frame index from the loaded BootScene manifest. */
export function buildFrameMap(manifest: PlayersManifestLike): Map<string, number> {
  const map = new Map<string, number>();
  manifest.spritesheets.players.frames.forEach((name, i) => {
    map.set(name, i);
  });
  return map;
}

export interface ResolvedClips {
  idle: number[];
  /** Run clip contains ONLY run frames (PA-1-S1). */
  run: number[];
  kick: number[];
  /** Slide tackle clip (Batch B). */
  tackle: number[];
  /**
   * Celebration clip (Batch B): arms-up frame paired with the idle frame so
   * the anim bounces (yoyo) between them for the bounded celebration window.
   */
  celebrate: number[];
  /** GK clips (Batch B), picked by the keeper FSM state. */
  dive: number[];
  claim: number[];
  distribute: number[];
  /**
   * True when any clip had to fall back to the `home-*` frame because the
   * team frame was missing (PA-1-S3) — caller applies the team tint.
   * Home team never tints.
   */
  needsTint: boolean;
}

/**
 * Legacy sheet fallback (no registry available at all): the original 3-frame
 * layout idle=0, run=1, kick=2. New clips reuse the closest legacy frame —
 * tackle/dive/distribute read as action (kick frame), celebrate/claim read as
 * neutral (idle frame) — so headless scenes with a stale sheet still animate.
 */
const LEGACY_FRAME_INDEX: Record<PlayerClip, number> = {
  idle: 0,
  run: 1,
  kick: 2,
  tackle: 2,
  celebrate: 0,
  dive: 2,
  claim: 0,
  distribute: 2,
};

/**
 * Resolves the per-team animation frames, preferring `<team>-<clip>` names and
 * falling back to `home-<clip>` (tint fallback) when the team frame is missing.
 */
export function resolveClipFrames(map: ReadonlyMap<string, number>, team: ClubTeam): ResolvedClips {
  let needsTint = false;
  const pick = (clip: PlayerClip): number[] => {
    const teamIdx = map.get(`${team}-${clip}`);
    if (teamIdx !== undefined) {
      return [teamIdx];
    }
    const homeIdx = map.get(`home-${clip}`);
    if (homeIdx !== undefined) {
      if (team === 'away') {
        needsTint = true;
      }
      return [homeIdx];
    }
    // No registry available at all: legacy sheet layout.
    return [LEGACY_FRAME_INDEX[clip]];
  };
  return {
    idle: pick('idle'),
    run: pick('run'),
    kick: pick('kick'),
    tackle: pick('tackle'),
    celebrate: [...pick('celebrate'), ...pick('idle')],
    dive: pick('dive'),
    claim: pick('claim'),
    distribute: pick('distribute'),
    needsTint,
  };
}
