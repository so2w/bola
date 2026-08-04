# AGENTS.md — Master Blueprint: Retro Soccer 2D (Bola Clone)

## 1. Visión & Principio Rector
Recrear la experiencia arcade y nostálgica del juego "Bola Social Soccer" (2010) en un MVP web ultra fluido.
**Regla de Oro (Game Feel First):** El juego debe ser divertido, responsivo y adictivo desde el primer segundo. La pelota debe sentirse con peso, los tiros deben ser contundentes y el loop de juego debe ser ultra rápido.

---

## 2. Pila Tecnológica & Entorno
- **Engine:** Phaser 3.x con TypeScript
- **Bundler:** Vite
- **Físicas:** Phaser Arcade Physics (2D + Ficticia dimensión Z para tiros/sombras)
- **Generación de Assets:** Scripts Node.js (`/scripts/generate-sprites.js`) usando HTML5 Canvas/SVG vectoriales dinámicos.

---

## 3. Arquitectura del Proyecto & Separación de Roles

Para evitar código espagueti, las responsabilidades se dividen en 4 subsistemas (Sub-Agentes):

### 🤖 Agente 1: Gameplay, Ball & Player Physics
*Ubicación:* `src/entities/Player.ts`, `src/entities/Ball.ts`
- Maneja el movimiento de los jugadores (8 direcciones), barridas y tiros.
- **Mecánica Z-Axis para la Pelota:** La pelota opera con coordenadas $X, Y$ (terreno) y un offset $Z$ (altura ficticia) para renderizar la sombra abajo y la pelota arriba cuando sube en un tiro o pase bombeado.
- **Feedback (Juice):** Aplica un pequeño *Screen Shake* (100ms) en la cámara de Phaser al ejecutar un tiro cargado.

### 🤖 Agente 2: Rival AI ("Chasing & Shooting AI")
*Ubicación:* `src/systems/SimpleAI.ts`
- Lógica simple de máquina de estados para el equipo contrario (Bot):
  - **Modo Defensivo (Sin Balón):** Persigue la coordenada $X, Y$ del balón para presionar.
  - **Modo Ofensivo (Con Balón):** Avanza en dirección al arco rival. Si la distancia al arco es menor a 120px, ejecuta un tiro a puerta.

### 🤖 Agente 3: Procedural Assets & Sprite Generator
*Ubicación:* `scripts/generate-sprites.js`
- Script ejecutable en Node.js que genera en código:
  1. `pitch.png`: Terreno de juego con franjas de césped en dos tonos de verde y líneas blancas.
  2. `ball.png`: Balón tradicional y su textura de sombra semitransparente.
  3. `players.png`: Sprite sheet cartoon (cabeza redonda, cuerpo ovalado, manos/pies estilo Rayman) con paleta de colores parametrizable (Equipo Local vs Visita) y animación de 4 frames (Idle, Run, Kick).

### 🤖 Agente 4: Match Engine & Game Loop Manager
*Ubicación:* `src/systems/MatchManager.ts`, `src/scenes/MatchScene.ts`
- **Árbitro & Reglas:** Controla la máquina de estados global del partido:
  `KICKOFF` ➔ `PLAYING` ➔ `GOAL` ➔ `OUT_OF_BOUNDS` ➔ `GAME_OVER`.
- **Reloj:** Duración de 3 minutos reales (1s real = 3s de juego).
- **Detección de Gol:** Áreas de colisión invisibles en los arcos. Al detectar gol:
  1. Pausa el reloj y congela movimientos.
  2. Lanza efecto visual "¡GOL!" y suma al marcador.
  3. Reposiciona pelota y jugadores al centro tras 2 segundos.

---

## 4. Estructura de Archivos del Repositorio

```text
retro-soccer-game/
├── AGENTS.md                  # Este archivo (Master Prompt)
├── package.json
├── index.html
├── scripts/
│   └── generate-sprites.js    # Generador de Sprites SVG/Canvas
└── src/
    ├── main.ts                # Inicialización de Phaser
    ├── entities/
    │   ├── Ball.ts            # Física del balón + Z-axis
    │   └── Player.ts          # Controles y animaciones
    ├── systems/
    │   ├── MatchManager.ts    # Árbitro, temporizador y marcador
    │   └── SimpleAI.ts        # IA básica del bot
    └── scenes/
        └── MatchScene.ts      # Renderizado de cancha, colisiones e HUD