# Markings, goal-line, and game-feel remediation

## Problema del jugador

Live playtest (ground truth): pitch markings missing (penalty arc, small-box
line, corner arcs); goals register before the ball crosses the painted meta
line; the top-right CANCELAR/Marcador button does nothing useful next to PAUSA;
the match feels too fast to carry the ball before passing; the GK dive is
invisible; every shot goes down the middle.

## Objetivo

Restore all markings from shared geometry, gate goals on the actual line
crossing, give the cancel affordance one clear Spanish behavior, slow pacing
~15-20% via config, make dives/claims read, and spread shots across the mouth.

## Fuera de alcance

New tactics sliders, online/PvP, ads/IAP, art-pipeline changes beyond the
procedural generator, commentary audio.

## User stories

- Veo el arco del área, la línea del área chica y los arcos de esquina.
- El gol solo cuenta cuando el balón cruza la línea de meta.
- Abandonar el partido desde el HUD funciona siempre igual.
- Puedo conducir el balón y ver al receptor antes de pasar.
- Veo al portero estirarse y atajar; los jugadores no parecen robots.
- Los tiros pueden ir a los palos y también afuera.

## Reglas de dominio

- Every painted line derives from `src/data/goalGeometry.json` (shared with
  `BALANCE_CONFIG`); zero free-hand literals in `scripts/generate-sprites.js`.
- Goal = ball x fully beyond the meta line + y inside the mouth + z under the
  crossbar (`GOAL_FRAME.GOAL_MAX_Z_PX`). Posts/crossbar band behavior kept.
- Pacing changes via `BALANCE_CONFIG` only; real duration unchanged
  (`MATCH.GAME_TIME_SCALE` stays 3).
- Anim must never delay input (existing rule); generator stays plain JS +
  deterministic (no Date/Math.random).
- UI copy Spanish; code/comments English.

## Datos/configuración (old → new for every tuned number)

| Key | Old | New | Why |
|---|---|---|---|
| `PHYSICS.PLAYER_MAX_SPEED` | 220 | 185 | -16% match pace |
| `ENTRANCE.ENTRANCE_WALK_SPEED_PX_S` | 220 | 185 | walk-in parity with players |
| `GK.GK_MAX_SPEED_PX_S` | 200 | 170 | keeper pace matches field |
| `GK.GK_ACCEL_PX_S2` | 1400 | 1200 | same ~150ms reach at lower top speed |
| `GK.DIVE_TRIGGER_SPEED` | 200 | 180 | slower play still triggers visible dives |
| `AI.AI_RECOVERY_SPEED_FACTOR` | 1.2 | 1.05 | recovery runs stop warping past carriers |
| `AI.DRIBBLE_OPEN_LANE_BOOST` | 1.1 | 1.02 | carriers stop sprinting away from the ball |
| `AI.CONTROL_RADIUS_PX` | 22 | 26 | carrier keeps the ball at feet longer |
| `AI.CAPTURE_RADIUS_PX` | 14 | 16 | receptions seal slightly earlier |
| `INPUT.PASS_POWER_PCT` | 0.4 | 0.32 | passes ~20% slower, receivers readable |
| `DEBUG.TUNING passPower DEFAULT` | 0.4 | 0.32 | mirror of PASS_POWER_PX (spec-locked) |
| `INPUT.PASS_HINT_MS` | 900 | 1100 | more time to see the receiver |
| `ANIM.CELEBRATION_FRAME_RATE` | 3 | 5 | snappier, less robotic bounce |
| `GOAL_FRAME.GOAL_MAX_Z_PX` | (new) | 40 | crossbar height for the goal gate |
| `AI.SHOT_MISS_MARGIN_PX` | (new) | 28 | mouth ±70 aims across ±98: corners + misses |
| `goalGeometry` markings | (new) | box 90/110, small 40/90, spot 62, arc 55, corner 14 | restore dropped lines from shared source |

## Edge cases

- Ball 1px inside the line = no goal; 1px past = goal; y outside mouth = no
  goal (TouchTracker byline rules award corner/goal kick as before).
- High ball (z > crossbar) over the line = no goal.
- Paused: abandon still quits to menu; kicks stay gated.
- Old manifests (16 frames) still resolve single-frame fallbacks.

## Criterios de aceptación

- `pitchMarkingsGeometry()` enumerates all 9 marking kinds; regen paints them.
- `isGoalCrossing` ±1px/post/z tests green; scene gates both goal overlaps.
- Abandonar quits to MenuScene with current settings (headless test).
- Full suite green, `tsc` clean, `npm run build` ok, generator re-run + green.
- No tuning literals / "Bola clone" in touched files.

## Casos de prueba

`tests/remediation.batch.spec.ts`: markings enumeration, goal-line gate,
abandon copy+behavior, pacing values, shot spread (posts + miss), anim
frames (run/idle pairs resolve, manifest length 20).
