# Feature: Segunda División (Fase 8)

## Problema del jugador
Al ascender a la Segunda División, el jugador debe encontrar rivales con mayor disciplina táctica e IA exigente, mientras desbloquea la capacidad de realizar mejoras permanentes al estadio (instalaciones, capacidad de gradas e iluminación nocturna).

## Objetivo
Implementar el gestor de mejoras de estadio (`StadiumSystem`) y el escalado de dificultad de IA (`AIDifficultyScaler`).

## Fuera de alcance
- Torneos internacionales o copas ficticias (reservados para v2+).
- Microtransacciones o aceleradores de tiempo (prohibido en MVP).

## User stories
- **Como jugador**, quiero notar que los rivales de Segunda División cometen menos errores de pase y reaccionan más rápido en defensa.
- **Como jugador**, quiero poder comprar mejoras inmediatas para mi estadio (césped profesional, luz nocturna, gradas) que se reflejen visualmente y aumenten la capacidad de la taquilla.

## Reglas de dominio
- **Stadium Upgrades**:
  - `PITCH_UPGRADE`: Aumenta la calidad del terreno y reduce la fricción indeseada.
  - `CAPACITY_UPGRADE`: Incrementa el límite de espectadores en $+500$.
  - `LIGHTING_UPGRADE`: Habilita la programación de partidos nocturnos.
- **Dificultad de IA**:
  - Segunda División aplica un factor de precisión de pase $\ge 0.85$ y velocidad de reacción de $150\text{ ms}$.

## Criterios de aceptación
1. `StadiumSystem` aplica las mejoras inmediatamente al pagar el costo exacto sin tiempos de espera.
2. `AIDifficultyScaler` ajusta la velocidad de reacción y tasa de error de la IA según el tier de liga.
3. Pruebas unitarias de mejoras de estadio y escalado de dificultad en verde.
