# Feature: Liga Amateur (Fase 7)

## Problema del jugador
El jugador necesita competir en su primera temporada oficial estructurada tras graduarse del Tutorial de Barrio, ganando dinero de taquilla y decidiendo si ascender a Segunda División o repetir categoría para fortalecer el club.

## Objetivo
Implementar la estructura de la Liga Amateur (`LeagueManager`), el calendario de la temporada (`SeasonSchedule`) y la calculadora de taquilla (`TicketSystem`).

## Fuera de alcance
- Segunda o Primera División (Fases 8 y 9).
- Torneos internacionales o copas (prohibido en v1).

## User stories
- **Como jugador**, quiero jugar un calendario de partidos de la Liga Amateur contra clubes barriales ficticios.
- **Como jugador**, quiero recibir ingresos por taquilla tras cada partido en casa en función de la asistencia y capacidad del estadio.
- **Como jugador**, al terminar la temporada quiero elegir libremente si ascender o continuar en la Liga Amateur.

## Reglas de dominio
- **Ingresos por Taquilla**:
  $$\text{Taquilla} = \min(\text{Fans}, \text{CapacidadEstadio}) \cdot \text{PrecioEntrada}$$
- **Liga Amateur**:
  - Dificultad base de IA: $1.0$.
  - Requisito para opción de ascenso: Terminar entre los primeros 2 lugares de la tabla.

## Criterios de aceptación
1. `LeagueManager` genera una tabla de posiciones coherente y actualiza puntos tras cada partido.
2. `TicketSystem` calcula la recaudación sin generar valores negativos o NaN.
3. Pruebas unitarias de tabla de posiciones e ingresos por taquilla en verde.
