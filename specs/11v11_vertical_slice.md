# Feature: 11v11 Vertical Slice

## Problema del jugador
El jugador necesita experimentar un partido completo de fútbol 11 vs 11 de 3 minutos de duración real con estructura táctica clara, saques de reanudación (saque de banda, saque de meta, tiros de esquina) y sin bloqueos de juego (*soft-locks*).

## Objetivo
Implementar las formaciones base de 11 jugadores (`FormationSystem`), la máquina de estados ampliada de reanudaciones en `MatchManager` (`THROW_IN`, `GOAL_KICK`, `CORNER`, `FREE_KICK`) y el director de audio de eventos (`AudioDirector`).

## Fuera de alcance
- Animaciones complejas de público o narrativa de campaña (Fase 4/5).
- Sistema de faltas avanzadas, tarjetas o fuera de juego (Fase 4+).
- Interfaz de gestión financiera o transferencias de plantilla (Fase 6).

## User stories
- **Como jugador**, quiero competir en un partido de 11 vs 11 donde ambos equipos mantienen posiciones lógicas en el campo según la formación elegida.
- **Como jugador**, quiero que cuando la pelota salga de la cancha por banda o fondo, el árbitro detenga el juego y otorgue el saque de banda, saque de meta o córner al equipo correspondiente.
- **Como jugador**, quiero escuchar retroalimentación sonora clara en los contactos del balón, silbato y vítores cuando ocurre un gol.

## Reglas de dominio
- **Formación 4-4-2**:
  - GK (1), CB (2), LB/RB (2), MF (4), FW (2).
  - Posiciones base relativas al tamaño de la cancha ($960 \times 540$).
- **MatchState Transitions**:
  `KICKOFF` → `PLAYING` → `STOPPAGE` (`THROW_IN` | `GOAL_KICK` | `CORNER`) → `PLAYING` → `GOAL` → `KICKOFF` → `FULL_TIME` → `RESULTS`.
- **Regla de toque**:
  - Salida por banda lateral: Saque de banda para el rival del último jugador que tocó el balón.
  - Salida por línea de fondo: Saque de meta si el último toque fue atacante; Córner si fue defensor.

## Criterios de aceptación
1. `FormationSystem` genera posiciones iniciales válidas para 11 jugadores por bando sin colisiones o sobreposiciones.
2. `MatchManager` gestiona determinísticamente las reanudaciones de banda/córner/meta sin bloquear la partida.
3. El reloj de juego transcurre en 3 minutos reales (180 segundos).
4. Pruebas unitarias de formaciones, reanudaciones y transiciones pasan exitosamente.
