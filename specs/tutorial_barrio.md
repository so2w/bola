# Feature: Tutorial de Barrio (Fase 5)

## Problema del jugador
El jugador necesita aprender las mecánicas del juego de forma guiada, progresiva y sin interrupciones molestas, mediante 3 partidos cortos que cuentan la historia del club de barrio.

## Objetivo
Implementar la estructura narrativa y el gestor del tutorial (`TutorialManager`) que controla el flujo de los 3 partidos obligatorios antes de desbloquear la Liga Amateur.

## Fuera de alcance
- Menú avanzado de transferencias o mejoras financieras del estadio (Fase 6).
- Temporadas completas de liga (Fase 7).

## User stories
- **Como jugador**, quiero jugar el Partido 1 para aprender movimiento básico, pase y remate al arco.
- **Como jugador**, quiero jugar el Partido 2 para dominar la defensa, presión y saques de banda/esquina.
- **Como jugador**, quiero jugar el Partido 3 para competir en un encuentro completo de 3 minutos e introducir la barra de energía del equipo.
- **Como jugador**, quiero ver mensajes breves del asistente/periodista ficticio sin que bloqueen la fluidez de la partida.

## Reglas de dominio
- **Partidos del tutorial**:
  - `STEP_1_ATTACK`: Objetivo — Moverse y marcar 1 gol.
  - `STEP_2_DEFENSE`: Objetivo — Recuperar el balón y ejecutar un saque de banda.
  - `STEP_3_MATCH`: Partido completo de 3 minutos con barra de energía.
- **Transición de estado**:
  Al completar los 3 partidos, `TutorialManager.isCompleted()` se vuelve `true` y otorga el logro/desbloqueo de la Liga Amateur.

## Criterios de aceptación
1. `TutorialManager` avanza determinísticamente de paso al cumplir cada condición del partido.
2. Al terminar el Paso 3, el estado del juego desbloquea el acceso a la Liga Amateur.
3. Pruebas unitarias del gestor del tutorial en verde.
