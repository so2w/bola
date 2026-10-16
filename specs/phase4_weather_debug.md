# Feature: Weather/Surface runtime wiring + debug observability (Phase 4 Batch A)

## Problema del jugador

El partido se siente igual en cualquier cancha/clima (WeatherSystem era código muerto, testeado pero nunca consumido) y no existe forma de observar ni ajustar el juego en vivo durante el tuning de game feel (AGENTS.md sección 30).

## Objetivo

- Conectar los modificadores de superficie/clima (fricción del balón, sprint de jugadores, dificultad de recepción) al partido real, con límites de la sección 13.
- Añadir el modo debug de la sección 30: panel de observabilidad + knobs de ajuste en vivo, nunca visible por defecto.

## Fuera de alcance

- Sistema de energía (HEAT drena energía en Phase 6).
- Evolución del estadio que cambia la superficie (Phase 6) — el nivel se elige por config.
- Visual de lluvia/nieve (riesgo de perf; documentado en config).
- Animaciones, audio dinámico de público, tácticas, pases, selección (reglas), reanudaciones, banners.

## User stories

- Como entrenador, quiero que una cancha de tierra se sienta distinta a una profesional (el balón muere antes, el sprint rinde menos), sin que el juego se vuelva aleatorio.
- Como developer/playtester, quiero un panel debug (FPS, estado, posesión, control, candidatos, IA, balón, modificadores, seed) y knobs vivos (velocidad, fricción, pase, tiro, cámara) para afinar game feel sin recompilar.

## Reglas de dominio

- Modificadores compuestos (superficie × clima) se clampean a los límites de `BALANCE_CONFIG.SURFACE.CLAMPS` (sección 13: una cancha mala NUNCA aleatoriza/paraliza el juego).
- Los mismos modificadores afectan a AMBOS equipos (sección 13).
- El sprint se aplica por la ÚNICA ruta de velocidad: `Player.maxSpeed` (humano `move()` y locomoción AI la leen). El GK conserva su propio perfil (`GK_MAX_SPEED_PX_S`) y no recibe el modificador.
- HEAT: costo pequeño de sprint/control; NO drena energía (documentado no-op hasta Phase 6).
- CLEAR_DAY es el tipo "sin efecto" (equivalente NONE) y es el default del MVP.
- Tuning debug: overrides de sesión, jamás persistidos, se aplican SOBRE `BALANCE_CONFIG`, con clamps por knob y sin NaN.

## UX/controles

- Toggle debug: tecla de config (F3). Panel oculto por defecto.
- Ajuste: MINUS/PLUS ajustan el knob activo; BACKTICK cicla; solo activas con el panel visible (nunca sombrean bindings de juego).
- Knobs: playerSpeed, ballFriction, passPower, shotPower, cameraLerp.

## Estados y transiciones

- Sin cambios de estados del MatchManager (solo lectura del estado para el panel).

## Datos/configuración

- `BALANCE_CONFIG.SURFACE` (LEVELS, CLAMPS, VISUALS, DEFAULT_LEVEL), `BALANCE_CONFIG.WEATHER` (TYPES, CLAMPS, DEFAULT_TYPE), `BALANCE_CONFIG.RNG.DEFAULT_SEED`, `BALANCE_CONFIG.DEBUG` (PANEL, TUNING.KNOBS, teclas, cadence), `BALANCE_CONFIG.FEEDBACK.SHOT_SHAKE` (literales previos de shake movidos a config).
- Cero literales de tuning en WeatherSystem/DebugTuning/DebugMonitor/MatchScene nuevos caminos.

## Edge cases

- Config extrema (p.ej. FRICTION_MULT 10) → clamp en compose, nunca llega al juego.
- Pitch/weather desconocido → throw fail-fast (misma regla que tácticas).
- Inputs no finitos al payload debug → sanitizados a 0 (el panel jamás muestra NaN).
- Ajustes no finitos (NaN/Infinity) → ignorados.
- Panel oculto → cero trabajo por frame (sin gathering ni allocation).
- Top-3 de selección: slots prealocados reutilizados (sin allocation por frame en hot path).

## Rendimiento

- Fricción al balón: multiplicación escalar por frame, sin allocation.
- Sprint: escrituras solo en create y cuando cambia `DebugTuning.version` (version-gated).
- Panel: refresco a cadencia de config (250ms) y solo visible; ~4 allocations/seg mientras está abierto.
- Visual de superficie: rects planos dibujados una vez en create (sin partículas); posiciones deterministas por stride modular (sin RNG).

## Telemetría futura

- Ninguna (fuera de MVP).

## Criterios de aceptación

- DIRT desacelera el balón mediblemente más que PROFESSIONAL, dentro de clamps (test).
- Sprint alcanza a ambos equipos por igual (test); default REGULAR_GRASS/CLEAR_DAY = 220px/s (cero cambio de comportamiento por defecto).
- Payload debug contiene todos los campos de la sección 30, sin NaN (test).
- Knobs clampeados, espejo de config bloqueado por test (passPower/cameraLerp no derivan).
- Suite completa verde, tsc limpio, build OK.

## Casos de prueba

- `tests/phase4.weatherWiring.spec.ts` (20): config/instanciación, clamps, HEAT, fail-fast, seam del balón (dirt vs pro), sprint ambos equipos, knobs, visuales deterministas.
- `tests/phase4.debug.spec.ts` (18): DebugTuning (defaults/clamps/NaN/cycle/fail-fast), payload completo + sanitización, formato, top-3 de selección, wiring de teclas en create(), toggle visible/oculto.
- `tests/weather.test.ts` (preexistente, sigue verde vía API static back-compat).
