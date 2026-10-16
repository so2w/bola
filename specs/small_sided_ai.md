# Feature: Small-sided 3v3 / 5v5 Interno & Selección Automática

## Problema del jugador
Para que el partido se sienta como fútbol arcade fluido (11v11 en el futuro), el juego debe seleccionar automáticamente al jugador con mejor oportunidad de intervenir y la IA debe mantener una estructura básica de equipo (no "todos persiguen el balón").

## Objetivo
Implementar el sistema de selección automática de jugador controlado (`PlayerSelectionSystem`), IA básica de compañeros y rivales con Utility + FSM ligera (`FootballAI`), y la FSM básica de portero (`GoalkeeperAI`).

## Fuera de alcance
- Formaciones avanzadas de 11v11.
- Árboles de habilidades o consumo de energía persistente.
- Audio de ambiente estadio o comentarista.

## User stories
- **Como jugador**, quiero que el control cambie automáticamente al compañero con mejor ángulo/distancia para interceptar la pelota sin que el selector salte erráticamente de un frame a otro.
- **Como jugador**, quiero ver que mis compañeros y rivales mantienen una posición lógica en el campo (defensores cubren zona, atacantes buscan espacio).
- **Como jugador**, quiero un portero que se mueva horizontalmente sobre su línea de gol y reaccione a los tiros dirigidos al arco.

## Reglas de dominio
- **PlayerSelectionSystem Scoring**:
  $$Score = w_1 \cdot \text{distancia} + w_2 \cdot \text{ánguloIntercept} + \text{hysteresisCooldown}$$
  Evitar oscilación constante (*hysteresis*).
  Engaged (press/chase) resta `ENGAGED_PENALTY`; MatchScene construye los
  candidatos con `isEngaged` desde los comandos PRESS vigentes.
- **FootballAI FSM**:
  - `DEFENDING`: Mantener estructura, presionar sólo 1-2 jugadores cercanos.
  - `ATTACKING`: Soporte sin balón — ancla + empuje frontal
    (`AI_SUPPORT_PUSH_PX`) + separación del rival más cercano dentro de
    `AI_SUPPORT_AVOID_RADIUS_PX`, acotado por `AI_SUPPORT_MAX_SHIFT_PX`.
    Sin datos de equipo se mantiene el ancla exacta (legado).
  - `BALL_HOLDER`: Utilidad TIRO > PASE > CONDUCCIÓN. Tiro en
    `SHOOT_RANGE_PX`; si no, pase vía `choosePassTarget` (mismo cono/rango
    que pases humanos, potencia `INPUT.PASS_POWER_PCT`) con tendencia
    `AI_PASS_TENDENCY` y error acotado `AI_PASS_ERROR_PX`; si no hay
    compañero abierto, conducción.
- **GoalkeeperAI FSM**: `POSITION` → `TRACK` → `CLAIM` / `DIVE` → `RECOVER`.
  Tick por frame (nunca dentro de la cadencia 150ms — ver
  `docs/adr/0002-gk-tick-cadence.md`); locomoción con perfil propio
  (`GK.GK_MAX_SPEED_PX_S`, `GK.GK_ACCEL_PX_S2`).

## Criterios de aceptación
1. `PlayerSelectionSystem` elige determinísticamente al mejor jugador sin oscilar cada frame.
2. `GoalkeeperAI` reacciona ante la aproximación del balón sobre el área chica.
3. Las pruebas unitarias de puntuación de selección y decisiones de IA pasan limpiamente.
