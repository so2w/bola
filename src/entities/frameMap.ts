/**
 * Fase 4 Slice 1 (PA-1): manifest-driven spritesheet frame registry.
 *
 * The players sheet's frame index equals the entry position inside
 * manifest.spritesheets.players.frames (names are the single source of truth).
 * Phaser-free: importable from unit tests without a Phaser runtime.
 */

export type ClubTeam = 'home' | 'away';
export type PlayerClip = 'idle' | 'run' | 'kick';

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
  /**
   * True when any clip had to fall back to the `home-*` frame because the
   * team frame was missing (PA-1-S3) — caller applies the team tint.
   * Home team never tints.
   */
  needsTint: boolean;
}

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
    // No registry available at all: legacy sheet layout idle=0, run=1, kick=2.
    return [clip === 'idle' ? 0 : clip === 'run' ? 1 : 2];
  };
  return { idle: pick('idle'), run: pick('run'), kick: pick('kick'), needsTint };
}
