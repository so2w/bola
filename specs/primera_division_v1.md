# Feature: Primera División / v1 (Fase 9 — Cierre MVP)

## Problema del jugador
El jugador llegó al techo de la campaña. La Primera División debe ser el desafío definitivo antes del crédito final: rivales con IA de elite, estadio propio lleno de ambiente y una temporada que se siente como un logro real.

## Objetivo
Implementar el escalado de dificultad de Primera División, el gestor de onboarding de accesibilidad (`AccessibilityConfig`), el validador de integridad del save pre-partido y el exportador de configuración Android stub.

## Fuera de alcance
- Multijugador, torneos internacionales o IAP (Fase 10+).
- Backend remoto (interfaz preparada, implementación fuera del MVP).

## User stories
- **Como jugador**, quiero enfrentar rivales de Primera División con IA que presiona en bloque, comete errores mínimos y genera peligro real en ofensiva.
- **Como jugador nuevo**, quiero que el juego me guíe con onboarding de controles la primera vez sin bloquearlo después.
- **Como jugador**, quiero poder pausar el partido desde el menú y que el estado se guarde antes de salir.
- **Como jugador Android**, quiero que el juego se ejecute en orientación horizontal con controles táctiles utilizables.

## Reglas de dominio
- **Primera División IA**:
  - Precisión de pase $\ge 0.95$.
  - Tiempo de reacción $\le 80\text{ ms}$.
  - Error de posicionamiento $\le 12\text{ px}$.
- **Accesibilidad**:
  - Texto mínimo legible en $320\text{ px}$ de ancho.
  - Shake de cámara desactivable.
  - Volumen master / efectos / ambiente independientes.
- **Integridad del Save**:
  - Validar `schemaVersion` antes de cargar.
  - Si falla la validación, cargar perfil de emergencia con fondos en $0$.

## Criterios de aceptación
1. `AccessibilityConfig` centraliza las opciones de volumen, shake y tamaño de controles táctiles.
2. `SaveValidator` detecta saves corruptos y retorna un estado de recuperación sin crashear.
3. Primera División aplica el perfil de IA de máxima exigencia.
4. `vitest run` y `tsc --noEmit` en verde con cobertura de los subsistemas anteriores.
