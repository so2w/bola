# Feature: Club, Progresión y Economía (Fase 6)

## Problema del jugador
El jugador necesita sentir que sus partidos tienen recompensas duraderas: ganar dinero de taquilla, otorgar XP a sus jugadores (especialmente al MVP del partido), administrar la energía de la plantilla y realizar mejoras al estadio o fichajes en el mercado simple.

## Objetivo
Implementar los subsistemas de economía (`EconomySystem`), energía (`EnergySystem`), XP/MVP (`ExperienceSystem`), mercado de transferencias (`TransferMarket`) y persistencia local versionada (`LocalSaveRepository`).

## Fuera of alcance
- Compras con dinero real (IAP) o anuncios (prohibido en MVP).
- Contratos o sueldos complejos.
- Guardado en la nube / backend remoto.

## User stories
- **Como jugador**, quiero ganar monedas tras completar un partido para poder fichar mejores jugadores o mejorar las instalaciones de mi cancha.
- **Como jugador**, quiero que al terminar el partido se elija un MVP a partir de goles, asistencias y atajadas, otorgándole XP adicional.
- **Como jugador**, quiero que la plantilla tenga un límite de máximo 22 futbolistas para evitar saturación de espacio.
- **Como jugador**, quiero que el estado de mi club se guarde automáticamente de forma local y versionada.

## Reglas de dominio
- **Plantilla**: $N_{jugadores} \le 22$. No se puede comprar un jugador si la plantilla está llena o si no hay fondos suficientes.
- **Puntuación MVP**:
  $$\text{MVP\_Score} = (\text{goles} \cdot 100) + (\text{asistencias} \cdot 50) + (\text{atajadas} \cdot 40) + (\text{recuperaciones} \cdot 20)$$
- **Energía**: $0 \le \text{Energía} \le 100$. Disminuye tras cada partido y se regenera con un `TimeProvider`.
- **Save Versionado**: `schemaVersion = 1`. Migración automática si cambia el esquema.

## Criterios de aceptación
1. `EconomySystem` descuenta importes exactos y bloquea transacciones si el saldo es insuficiente o la plantilla excede 22.
2. `ExperienceSystem` calcula MVP determinísticamente y otorga XP.
3. `LocalSaveRepository` serializa y deserializa el perfil del club preservando dinero y estado.
4. Pruebas unitarias de economía, energía, XP y guardado en verde.
