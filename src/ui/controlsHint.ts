import { BALANCE_CONFIG } from '../data/balance';

/**
 * Controls discoverability hint (playtest round 3): the player did not know
 * J passes / K charges a shot. A static bottom-center HUD line is shown
 * during KICKOFF and for the first CONTROLS_HINT_MS of PLAYING.
 *
 * Phaser-free visibility rule; MatchScene owns the Text object.
 */
export function shouldShowControlsHint(
  matchState: string | undefined,
  playStartedAtMs: number | null,
  nowMs: number,
): boolean {
  if (matchState === 'KICKOFF') {
    return true;
  }
  if (matchState !== 'PLAYING' || playStartedAtMs === null) {
    return false;
  }
  return nowMs - playStartedAtMs < BALANCE_CONFIG.UI.CONTROLS_HINT_MS;
}
