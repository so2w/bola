# ADR 0002 — GK Per-Frame Tick Cadence + Movement Profile

Status: Accepted
Date: 2026-10-15
Context: Phase 2 closure (small-sided 3v3/5v5 AI)

## Problem

The field-player coordinator runs at a 150ms cadence (6.7Hz) and caches
commands between ticks. A 600px/s shot covers 90px per tick window
(600 * 0.15). The GK dive radius is 120px with a 400ms dive. If the keeper
were evaluated inside the coordinator cadence, a fast shot entering and
crossing the dive window between two ticks would never trigger a dive —
the keeper would watch the ball fly past. Missing a 600px/s dive inside
one 150ms cadence window is a real, measured risk (see
`tests/goalkeeperAI.spec.ts` dive-reachability test).

Separately, the keeper moved exactly like a field player (same max speed,
instant velocity changes via `AIController`), which reads wrong: keepers
shuffle along the line and explode laterally, they do not sprint like
wingers.

## Decision

1. **Per-frame GK tick, never inside the coordinator cadence.**
   `TeamCoordinator.update()` handles field players at 150ms;
   `TeamCoordinator.tickGK()` is called every frame by `MatchScene` with
   the fresh ball snapshot. The decision is documented in
   `TeamCoordinator.ts` (design 3.0) and enforced by
   `tests/matchScene.tickGK.spec.ts` (tickGK runs every frame, even inside
   the 150ms window).

2. **GK movement profile from config, consumed in the GK path.**
   `BALANCE_CONFIG.GK.GK_MAX_SPEED_PX_S` caps keeper locomotion and
   `BALANCE_CONFIG.GK.GK_ACCEL_PX_S2` clamps per-frame velocity change
   (`AIController` `isGK` branch). Field players keep instant
   velocity-direct locomotion at `PHYSICS.PLAYER_MAX_SPEED`; keepers are
   accel-limited and slightly slower on sustained runs, which preserves
   dive reachability (burst within the radius) without outrunning chasers
   up the pitch.

## Tuning (all in BALANCE_CONFIG.GK)

- `GK_MAX_SPEED_PX_S: 200` (field: 220).
- `GK_ACCEL_PX_S2: 1400` (reaches max in ~143ms, one coordinator tick).

## Consequences

- Dive evaluation runs at frame rate (cheap FSM, no O(n^2)); field-player
  cadence and determinism are untouched (seeded rng, no Math.random).
- `AIController` takes an `isGK` flag (4th constructor arg, default false
  for back-compat); `MatchScene` wires it from formation roles (index 0).
- Keeper distribution still flows through the guarded kick path
  (`handleAIKick` PASS/DISTRIBUTE), so kickoff-grace and proximity gates
  apply identically.
- Future 11v11 keeps the same split: per-frame keeper, cadenced field.
