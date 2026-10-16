import type { GKState } from '../ai/GoalkeeperAI';
import type { PlayerClip } from './frameMap';

/**
 * Phase 4 Batch B (AGENTS.md sections 11 + 21): the keeper picks its clip from
 * its own FSM state — it never animates like a field player with a different
 * speed. Positioning states reuse the shared idle/run locomotion clips; the
 * specialty states (dive, claim/hold, distribute) have dedicated clips.
 */
const GK_STATE_CLIPS: Record<GKState, PlayerClip> = {
  POSITION: 'idle',
  TRACK: 'run',
  CLAIM: 'claim',
  DIVE: 'dive',
  HOLD: 'claim',
  DISTRIBUTE: 'distribute',
  RECOVER: 'run',
};

/** GK FSM state -> clip mapping (complete by construction over GKState). */
export function gkClipForState(state: GKState): PlayerClip {
  return GK_STATE_CLIPS[state];
}

/** GK clips that play as bounded overrides on the Player entity. */
export type GkOverrideClip = 'dive' | 'claim' | 'distribute';

/**
 * True for the clips MatchScene must feed into Player.applyGkClip every frame
 * while the keeper FSM holds the state. Positioning clips (idle/run) fall back
 * to the normal locomotion state machine instead.
 */
export function isGkOverrideClip(clip: PlayerClip): clip is GkOverrideClip {
  return clip === 'dive' || clip === 'claim' || clip === 'distribute';
}
