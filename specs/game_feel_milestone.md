# Feature: GAME FEEL Milestone (Fase 4 Gate Crítico)

## Problema del jugador
El partido debe sentirse gratificante, claro y dinámico. Un pase sin retroalimentación o un choque contra el travesaño silencioso restan emoción arcade. La calidad del césped y el clima deben modificar la jugabilidad sin restar legibilidad o control.

## Objetivo
Implementar los modificadores ambientales de superficie y clima (`WeatherSystem`), el efecto de vibración/shake controlado y el *input buffering* para disparos y pases.

## Fuera de alcance
- Narrativa de campaña o partidos de tutorial (Fase 5).
- Menú de gestión de club y economía (Fase 6).

## User stories
- **Como jugador**, quiero sentir que patear al travesaño o marcar un gol produce una respuesta visual/sonora contundente (shake corto, animación de red/texto).
- **Como jugador**, quiero notar que jugar en un campo de tierra/barro afecta la fricción del balón y el sprint sin volverse frustrante o caótico.
- **Como jugador**, quiero disponer de *input buffering* ligero para que los pases o disparos ejecutados justo antes de recibir el balón se procesen con fluidez.

## Reglas de dominio
- **Superficies**:
  - `DIRT`: Fricción del balón $+30\%$, velocidad de sprint $-10\%$.
  - `IRREGULAR_GRASS`: Fricción $+15\%$.
  - `PROFESSIONAL_GRASS`: Fricción base ($1.0$).
- **Clima**:
  - `RAIN`: Fricción reducida en agua (deslizamiento $+20\%$), consumo de energía igual.
  - `HEAT`: Consumo de resistencia energético $+15\%$.
- **Camera Shake**: Máximo $100\text{ ms}$ y magnitud $\le 0.02$ para eventos importantes (gol, tiro potente $\ge 0.6$).

## Criterios de aceptación
1. `WeatherSystem` aplica modificadores deterministas a la física del balón y velocidad del jugador según superficie/clima.
2. `InputBuffer` retiene la intención del botón durante un margen configurable ($\le 150\text{ ms}$).
3. Todos los modificadores de balance permanecen editables centralizadamente en `src/data/balance.ts`.
4. Pruebas unitarias de modificadores ambientales e input buffer en verde.
