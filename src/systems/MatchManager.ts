/**
 * TODO: MatchManager — implement in a later change per AGENTS.md Subsystem 4
 * (Match Engine & Game Loop Manager).
 *
 * Planned responsibilities (NOT implemented in Paso 1):
 * - Global referee state machine: KICKOFF -> PLAYING -> GOAL -> OUT_OF_BOUNDS -> GAME_OVER.
 * - Match clock: 3 real minutes (1 real second = 3 game seconds).
 * - Goal detection areas, score tracking, "GOAL!" effect, kickoff repositioning.
 */
export type MatchState = 'KICKOFF' | 'PLAYING' | 'GOAL' | 'OUT_OF_BOUNDS' | 'GAME_OVER';

export class MatchManager {
  public state: MatchState = 'KICKOFF';
  public timeRemaining = 540; // game seconds: 3 real minutes *3
  public score = { home: 0, away: 0 };
  public kickoffTimer = 1500;
  public resetTimer = 0;

  constructor() {}

  public update(delta: number): void {
    // Foundation skeleton: no logic yet, keep build passing
  }

  public getTime(): number {
    return this.timeRemaining;
  }
}
