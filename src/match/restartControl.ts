import type { TeamSide } from './TouchTracker';

export type RestartControlKind =
  | 'THROW_IN'
  | 'CORNER'
  | 'GOAL_KICK'
  | 'FREE_KICK'
  | 'PENALTY'
  | 'KICKOFF';

export interface RestartControlArgs {
  kind: RestartControlKind;
  /** Team that owns the restart (takes the kick/throw). */
  restartTeam: TeamSide;
  ball: { x: number; y: number };
  /** Home outfield+GK positions in squad order (index i -> `home-${i}`). */
  home: { x: number; y: number }[];
  /** Designated taker (kicker/shooter/thrower) when placement names one. */
  takerId?: string | null;
  /** Squad indices that can never take control (the GK — selection excludes it). */
  ineligible?: Set<number>;
}

/**
 * Batch C — own-restart control (Phaser-free, Vitest-testable).
 * On an own-team restart the human takes the teammate nearest the ball (the
 * designated taker where placement names one); on opponent restarts it
 * returns null so control is never stolen. The scene feeds the result into
 * its selection swap at the restart resume edge.
 */
export function restartControlId(args: RestartControlArgs): string | null {
  void args.kind;
  if (args.restartTeam !== 'home') {
    return null;
  }
  if (args.takerId) {
    return args.takerId;
  }
  let best = -1;
  let bestD = Infinity;
  args.home.forEach((p, i) => {
    if (args.ineligible?.has(i)) {
      return;
    }
    const d = (p.x - args.ball.x) ** 2 + (p.y - args.ball.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best < 0 ? null : `home-${best}`;
}
