# Feature: Sandbox 1v1 + Balón

## Problema del jugador
El jugador necesita experimentar de forma inmediata e intuitiva la respuesta del jugador humano, la trayectoria del balón (física 2D + altura Z virtual) y la detección de goles con una cámara fluida.

## Objetivo
Establecer el Sandbox 1v1 con mecánicas base de movimiento arcade, tiro cargado, altura Z del balón, cámara dinámica y arco/gol en MatchScene.

## Fuera de alcance
- IA compleja de 11v11 o formaciones (pertenece a Fase 2/3).
- Sistema de faltas, tarjetas o fuera de juego.
- Progresión, monedas, energía o menús de club.

## User stories
- **Como jugador**, quiero mover a mi futbolista con respuesta inmediata (WASD / Flechas) para que el movimiento se sienta ágil.
- **Como jugador**, quiero mantener presionado Espacio/Tiro para cargar la potencia y soltar para patear la pelota con altura y dirección.
- **Como jugador**, quiero que la cámara me siga suavemente a mi jugador y a la pelota con un ligero desplazamiento hacia adelante (*look-ahead*).
- **Como jugador**, quiero ver la sombra del balón escalar y cambiar de opacidad cuando gana altura virtual Z.

## Reglas de dominio
- **Balón Z**: La altura $Z$ se simula de manera independiente. Si $Z > 0$, el balón no puede ser interceptado por una entrada rasa. La sombra sigue la posición $(X,Y)$ real y ajusta su escala/opacidad según $Z / Z_{max}$.
- **Tiro cargado**: Potencia entre 0.0 y 1.0 basada en el tiempo retenido hasta `BALANCE_CONFIG.PHYSICS.PLAYER_MAX_CHARGE_MS`.
- **Cámara**: Debe realizar interpolación suave (*lerp*) entre el centro del jugador y el balón, aplicando un *look-ahead* proporcional a la velocidad del balón.

## UX/controles
- WASD / Flechas para dirección.
- Espacio (teclado) para cargar y ejecutar tiro/pase.

## Criterios de aceptación
1. El balón responde al tiro cargado aplicando velocidad física y altura virtual Z.
2. La cámara sigue suavemente al jugador y al balón sin saltos bruscos.
3. El gol registra el evento y reinicia la jugada después de un breve delay configurado.
4. Los tests unitarios de matemáticas de física Z, potencia de tiro y estado de MatchManager se ejecutan con éxito.
