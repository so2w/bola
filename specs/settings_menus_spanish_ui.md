# Feature: Menús de ajustes pre-partido + pausa + UI en español

## Problema del jugador

El juego arranca directo al partido sin forma de elegir terreno, clima, formación, duración ni volumen; no existe pausa durante el partido; y varios textos visibles siguen en inglés (HOME/AWAY en estadísticas, HALFTIME/FULL TIME en banners, botones HUD), rompiendo la identidad en español del juego.

## Objetivo

- Menú pre-partido (nueva escena ligera entre BootScene y MatchScene) con: TERRENO (4 niveles de `SURFACE.LEVELS`), CLIMA (CLEAR_DAY/RAIN/SNOW/HEAT), FORMACIÓN (3v3/5v5/11v11, default 11v11), DURACIÓN (3 o 5 minutos reales, sección 7), VOLUMEN (pasos de master volume), JUGAR.
- Pausa (Esc + botón HUD táctil): congela reloj y updates; overlay con CONTINUAR / REINICIAR PARTIDO / AJUSTES (volumen + clima en vivo; terreno y formación sólo pre-partido con hint) / SALIR AL MENÚ.
- Todo copy visible al usuario en español, desde configuración (cero literales de copy fuera de config; el overlay debug queda técnico/inglés por ser dev-facing).

## Fuera de alcance

- Persistencia de ajustes (SaveGame es Phase 6 — OPEN QUESTION: persistir ajustes de partido por perfil).
- Backend/cuenta, telemetry, nuevos estados del MatchManager (la pausa es gating de escena, NO un estado del manager).
- Menús de club, plantilla, economía, tutorial.
- Cambiar comportamiento por defecto: sin datos de escena el partido debe comportarse exactamente igual que antes (REGULAR_GRASS / CLEAR_DAY / 11v11 / 3 min / volumen 1.0).

## User stories

- Como entrenador, quiero elegir cancha, clima, formación y duración antes de salir a la cancha, para jugar el partido que quiero.
- Como entrenador, quiero pausar el partido (tecla o botón táctil) y reanudar sin que nada se rompa, incluso en pausas de reanudación o set pieces.
- Como entrenador, quiero ajustar volumen y clima en vivo desde la pausa, sin reiniciar.
- Como jugador hispanohablante, quiero que TODA la UI del partido esté en español.

## Reglas de dominio

- La pausa NUNCA es un estado del MatchManager: es gating de `MatchScene.update()` (el manager no recibe delta y por tanto su reloj/timers quedan congelados). Reanudar conserva el estado exacto.
- Pausa permitida en cualquier estado NO terminal (RESULTS/FULL_TIME/GAME_OVER la rechazan).
- Mientras está pausada, NINGÚN path puede mover el balón: el gate vive en `wireShots` (choke point único de patadas humanas/AI) y `handleAIKick` (defense in depth); el charge humano se cancela al pausar.
- Los ajustes son session-only: viajan por scene data (menu → match) y regresan al salir al menú. Sin `Math.random()`/`Date.now()`; valores validados fail-fast (superficie/clima/duración desconocidos → throw; volumen no finito → ignorado/clampeado).
- Duración real → reloj de juego: `TIME_REMAINING_GAME_SECONDS = minutos × 60 × GAME_TIME_SCALE` (3 min → 540, 5 min → 900; idéntico al default actual para 3).
- Volumen master: multiplica eventos vía `AudioDirector.masterVolume` (ya existente) + se delega al synth para la cama de público.
- Clima en vivo (pausa → AJUSTES): recrear `WeatherSystem` (misma superficie) + reaplicar sprint/velocidades por la ruta única existente. Terreno y formación NO cambian mid-match (sólo pre-partido).

## UX/controles

- Menú: flechas arriba/abajo mueven cursor, izquierda/derecha ajustan, Enter juega (sólo fila JUGAR), tap en una fila la cicla, tap en JUGAR inicia.
- Pausa: Esc o botón HUD "PAUSA" ( franja superior, nunca sobre el área de juego); overlay con filas navegables por teclado Y taps; AJUSTES es una segunda página con VOLVER.
- Indicador de selección por color + prefijo de cursor, desde config (sección 34: legible, táctiles grandes).

## Estados y transiciones

- BootScene → MenuScene → MatchScene(init data) → (pausa ⇄ overlay) → SALIR AL MENÚ → MenuScene(settings actuales).
- Reinicios internos (banner "Jugar de nuevo", "Reiniciar partido", tecla R, pausa → REINICIAR) re-usan los settings vigentes de la escena: ningún reset vuelve a defaults.

## Datos/configuración

- `BALANCE_CONFIG.SETTINGS` (órdenes de opciones, defaults, pasos de volumen), `BALANCE_CONFIG.MENU` (geometría/estilos del menú), `BALANCE_CONFIG.PAUSE` (geometría del overlay + botón).
- `src/data/uiText.ts`: copy español user-facing (equipos LOCAL/VISITANTE, menú, pausa, HUD, grito de gol). Los banners conservan sus propios grupos en BALANCE_CONFIG con valores ya en español (MEDIO TIEMPO / FINAL / LOCAL / VISITANTE).
- `MatchSceneInitData` extendido: `surface`, `weather`, `durationRealMinutes`, `volume` (además de formación existente).

## Edge cases

- Pausa durante INTRO/GOAL/set pieces/HALF: reanudar conserva el estado y ningún timer avanza mientras está pausada (sin wedges).
- Esc/botón en estados terminales: ignorado (el panel de resultados ya es terminal).
- Patada/pase presionado durante la pausa: suprimido en `wireShots` (el estado del manager sigue PLAYING, por eso el gate extra es obligatorio).
- Volume no finito → ignorado; superficie/clima/duración inválidas en scene data → throw fail-fast (misma convención que formaciones/tácticas).
- Crear los objetos nuevos de pausa AL FINAL de `MatchScene.create()` (tests existentes dependen del orden de `add.text`/`add.container`).

## Rendimiento

- Pausa = early return en update (cero trabajo por frame, ni frame-time push).
- Overlay renderiza sólo en transiciones de cursor/ajuste, no por frame.
- Menú: escena estática ligera sin physics.

## Telemetría futura

- Nombres listos: `settings_changed`, `match_paused/resumed`, `pause_quit_to_menu` (sin analytics real, sección 38).

## Criterios de aceptación

- El partido ya no arranca en frío: BootScene → menú → JUGAR inicia con los ajustes elegidos (test).
- Pausa desde cada estado mayor no wedgea; reloj congelado mientras pausa (test).
- Ajustes aplicados de verdad: superficie/clima llegan a WeatherSystem, duración al reloj del manager, volumen al AudioDirector, formación vía resolveFormations (test).
- Reinicios respetan settings vigentes (test).
- Copy español desde config en banners/HUD/menú/pausa; cero literals de copy nuevos fuera de config (test).
- Suite completa verde, tsc limpio, build OK.

## Casos de prueba

- `tests/menuSettings.spec.ts`: modelo puro del menú (defaults, navegación, ajuste por fila, resolución a scene data, reloj por duración, labels españoles, fail-fast).
- `tests/pauseState.spec.ts`: canPause por estado, modelo de menú de pausa (páginas, acciones, ajustes en vivo), no-wedge con MatchManager real.
- `tests/uiText.spanish.spec.ts`: cobertura de copy español (banners LOCAL/VISITANTE, MEDIO TIEMPO/FINAL, menú, pausa, HUD, grito de gol).
- `tests/settingsWiring.spec.ts`: integración de escena (settings aplicados en create, pausa congela updates, patada suprimida en pausa, clima en vivo, quit al menú con settings).
