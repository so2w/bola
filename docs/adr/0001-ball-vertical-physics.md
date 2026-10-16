# ADR 0001 — Ball Vertical (Z) Physics Model

Status: Accepted
Date: 2026-10-15
Context: Phase 1 (Sandbox 1v1 + ball), Batch 1

## Problem

The ball needs a believable lifted-shot arc on a virtual height axis (z)
while staying arcade-legible, deterministic, fully config-driven, and
reproducible from explicit kick parameters. The previous model drove z with
a spring toward a decaying zTarget (`z += (zTarget - z) * 0.15`,
`zTarget *= 0.92`), which never represented velocity, could not bounce, and
buried tuning literals in `Ball.ts`.

## Decision

Integrate height with explicit vertical velocity (vz) using semi-implicit
Euler at the frame delta:

- `vz -= GRAVITY_Z * dt; z += vz * dt` while airborne (`z > 0` or `vz != 0`).
- On ground contact (`z <= 0`): snap `z = 0`; rest when
  `|vz| < REST_VZ` (plus a small `REST_Z` snap), otherwise bounce with
  `vz = -vz * RESTITUTION_Z` where `RESTITUTION_Z (0.55) < 1`, so landings
  never gain energy.
- `z` is clamped so it never stays below zero.
- Kicks set `vz = power * KICK_VZ_MAX` (power 1.0 peaks near `BALL_MAX_Z`),
  keeping `applyKick(impulse, power)` reproducible with explicit parameters
  and no randomness.
- Rolling resistance applies only when grounded: velocity scaled by
  `1 - GROUND_DRAG_PER_S * surfaceMultiplier * dt`, with a
  `ROLL_STOP` snap so balls come to rest instead of creeping forever.
- `Ball.update(dtMs, surfaceFrictionMultiplier = SURFACE_NEUTRAL_FRICTION)`
  carries the surface seam (default neutral 1.0); a future WeatherSystem
  passes its friction multiplier in. No weather logic lives in Ball.
- Legacy `zTarget` writes (pass lift, old restart code) convert once to
  `vz = sqrt(2·g·h)` on the next step, then clear — back-compat without
  spring code.

## Tuning (all in BALANCE_CONFIG.PHYSICS)

- `BALL_GRAVITY_Z_PX_S2: 2000`, `BALL_KICK_VZ_MAX_PX_S: 500`
  (full-power peak ≈ 62px, near `BALL_MAX_Z: 60`; shadow norm clamps).
- `BALL_RESTITUTION_Z: 0.55`, `BALL_REST_Z_PX: 2`, `BALL_REST_VZ_PX_S: 90`.
- `BALL_GROUND_DRAG_PER_S: 1.0`, `BALL_ROLL_STOP_PX_S: 8`.
- Shadow: `Y_OFFSET 4`, `SCALE_SHRINK 0.6`, `ALPHA_BASE 0.6`,
  `ALPHA_FADE 0.5`, `ALPHA_MIN 0.1`.
- `SURFACE_NEUTRAL_FRICTION: 1.0`.

## Consequences

- Ball arcs, bounces with visible energy loss, and rests deterministically;
  section 29 ball cases (friction, z floor, no energy gain, surface bounds,
  determinism) are covered by `tests/ball.spec.ts`.
- Capture/restart paths must zero `vz` alongside velocity (done in
  MatchScene/MatchManager); any future writer of ball motion must go
  through `applyKick`/`update` or explicitly handle `vz`.
- Frame-rate independence holds for reasonable deltas (dt-scaled Euler);
  extreme hitches (>100ms) were not specially handled — acceptable for the
  sandbox milestone.
