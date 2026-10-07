# AGENTS.md — Master Product \& Engineering Specification

## Proyecto: Retro Barrio Soccer (working title)

> Este documento es la fuente de verdad del proyecto para humanos y agentes de IA. El nombre es provisional. El juego se inspira en la accesibilidad, cámara y nostalgia de los juegos sociales de fútbol 2D de finales de los 2000, pero debe tener identidad, código, arte, audio, nombres, narrativa e interfaz originales.

\---

## 0\. Directiva para cualquier agente

Antes de modificar código:

1. Lee este archivo completo.
2. Revisa el estado real del repositorio y las pruebas.
3. Identifica la fase activa del roadmap.
4. Escribe un plan corto de implementación y criterios de aceptación.
5. Implementa SOLAMENTE el alcance de esa fase/tarea.
6. Añade o modifica pruebas antes o junto con el código cuando sea razonable (TDD).
7. Ejecuta typecheck, lint, unit tests y pruebas pertinentes.
8. No declares una tarea terminada si falla una prueba crítica.
9. No cambies arquitectura, dependencias o reglas de producto sin documentarlo en un ADR.
10. Nunca implementes sistemas futuros sólo porque la arquitectura podría soportarlos.

### Regla de oro

**GAME FEEL FIRST.** Si el partido no es divertido, responsivo, legible y estable, gestión, monetización, multijugador y contenido adicional no tienen prioridad.

### Orden de prioridad

1. Controles y respuesta.
2. Balón, pases, tiros y goles.
3. Cámara y legibilidad.
4. IA de compañeros/rivales y portero.
5. Reglas/reanudaciones.
6. Sonido y feedback.
7. Rendimiento.
8. Progresión.
9. Gestión/economía.
10. Contenido adicional.

\---

## 1\. Visión

Juego de fútbol arcade 2D, cartoon, simple de aprender y difícil de soltar, para PC/web y Android. El jugador asume el papel de un entrenador recién llegado a un barrio latinoamericano ficticio. Allí encuentra una cancha deteriorada y jóvenes que juegan por pasión. El entrenador organiza un pequeño torneo, forma un club y, después de tres partidos de tutorial, obtiene acceso a la competición organizada.

La campaña inicial cuenta el viaje:

**Barrio (tutorial) → Liga Amateur → Segunda División → Primera División.**

Libertadores ficticia, Mundial de Clubes, selecciones, eliminatorias, Copa continental, Mundial y multijugador pertenecen al futuro y NO se implementan en el primer lanzamiento.

### Emoción objetivo

"Empezamos en una cancha rota y terminamos llenando nuestro propio estadio."

### Pilares

* Fútbol inmediatamente divertido.
* Partidos cortos: normalmente 3 min; partidos/torneos importantes 5 min.
* 11 vs 11 sin convertirlo en simulador complejo.
* Decisiones económicas simples con consecuencias visibles en cancha.
* Progresión clara del club y de los jugadores.
* Mucha personalidad latinoamericana mediante escenarios, sonido, narración y personajes ficticios originales.
* Excelente legibilidad en pantallas pequeñas.
* Nostalgia sin copiar propiedad intelectual de terceros.

\---

## 2\. Límites legales y creativos

NO copiar nombres, logotipos, uniformes, personajes, diálogos, música, sonidos, sprites, código, interfaces ni assets de Bola Social Soccer, clubes, ligas, FIFA, CONMEBOL, marcas deportivas u otras propiedades ajenas sin licencia.

Las referencias externas sirven sólo para estudiar principios generales: cámara, claridad, ritmo, controles y atmósfera.

### Equipos homenaje

Se permiten clubes ficticios con identidad propia y referencias culturales generales, pero nunca una reproducción que pueda confundirse con el club real. Ejemplos conceptuales como “Los Xeneizes” o “El Poderoso” deben pasar revisión de marca antes de publicación; durante desarrollo usar nombres claramente ficticios.

### Patrocinadores

No usar Nike, Adidas ni logos simulados. Crear marcas ficticias originales de ropa, bebidas, telefonía, transporte, etc.

### Representación de jugadores

Los atributos NUNCA dependen de raza, etnia o apariencia física. La diversidad visual debe ser amplia. Ventajas deportivas pueden provenir de historial de formación o arquetipos no protegidos, por ejemplo: formado en altura, futsal, cancha irregular, especialista en lluvia, velocista, potencia física.

\---

## 3\. Audiencia y plataformas

### Lanzamiento inicial

* Web/PC para iteración rápida.
* Android mediante wrapper nativo una vez estable el build web.
* Orientación horizontal durante los partidos.
* Menús responsive.

### Rendimiento

El objetivo de hardware exacto deberá fijarse contra los mínimos publicados por Google/Apple cerca del lanzamiento de 2027. Hasta entonces:

* 60 FPS objetivo en hardware de referencia.
* 30 FPS mínimo tolerable sin alterar lógica de simulación.
* Ninguna mecánica puede depender de frame rate.
* Pooling para objetos recurrentes.
* Evitar partículas, luces y postprocesado caros.
* Assets con presupuestos de tamaño definidos antes de content production.

\---

## 4\. Stack técnico inicial

* TypeScript estricto.
* Phaser 3.x.
* Vite.
* Phaser Arcade Physics + simulación propia de altura virtual del balón.
* Vitest para unit/integration tests de lógica.
* Playwright para smoke/E2E cuando existan menús estables.
* Datos configurables en JSON/TS schemas; evitar constantes de balance escondidas en lógica.
* Guardado local versionado durante MVP.
* Backend/cuenta/sincronización: interfaz preparada, implementación fuera del MVP.

No introducir un motor diferente, ECS completo o framework UI adicional sin ADR que muestre una necesidad real.

\---

## 5\. Bucle principal

### Loop corto

Entrar → preparar alineación/táctica simple → jugar partido → ver resultado/MVP/XP/recompensa → decidir mejora/entrenamiento/fichaje → siguiente partido.

### Loop de temporada

Competir → atraer público → generar taquilla → desarrollar plantilla/estadio → superar la categoría → decidir cuándo ascender.

### Loop de campaña

Transformar un equipo de barrio en club de Primera División.

El jugador debe pasar la mayor proporción posible del tiempo jugando fútbol, no administrando pantallas.

\---

## 6\. Introducción y tutorial

### Premisa

El entrenador llega a un barrio latinoamericano ficticio. La cancha está deteriorada. Diferentes personajes presentan el lugar y a los primeros jugadores. Un reportero deportivo ficticio actúa como narrador/corresponsal recurrente, con estilo radial/televisivo enérgico y original, sin imitar voz, nombre, frases o apariencia exacta de periodistas reales.

### Tutorial: exactamente 3 partidos

**Partido 1 — Muévete y juega**

* Movimiento.
* Selección automática.
* Pase.
* Tiro.
* Gol.

**Partido 2 — Defiende**

* Presión/entrada.
* Cambio contextual si aplica.
* Saque de banda, meta y esquina.

**Partido 3 — Partido completo**

* Sin pausas tutoriales largas.
* Introduce energía y resultado final.
* Al terminar desbloquea Liga Amateur y gestión básica.

El tutorial debe enseñar haciendo, con prompts breves y descartables.

\---

## 7\. Partido 11 vs 11

### Filosofía

Debe parecer fútbol sin exigir conocimiento táctico profundo. La complejidad interna de 22 agentes NO debe convertirse en complejidad de control.

### Duración

* Estándar: 3 minutos reales.
* Encuentro importante/torneo: 5 minutos.
* El reloj de fútbol mostrado puede acelerarse visualmente, pero la duración real es la fuente de verdad.

### Reglas iniciales

* Kickoff.
* Gol.
* Saque de banda.
* Saque de meta.
* Tiro de esquina.
* Faltas simples cuando la entrada lo justifique.
* Penalti si corresponde.
* Sin fuera de juego en MVP.
* Sin sistema complejo de tarjetas inicialmente.

### Estados del MatchManager

BOOT → INTRO → KICKOFF → PLAYING → STOPPAGE → THROW\_IN | GOAL\_KICK | CORNER | FREE\_KICK | PENALTY → GOAL → HALF/RESUME (si aplica) → FULL\_TIME → RESULTS.

Cada transición debe ser determinista y testeable.

\---

## 8\. Controles

### Objetivo

Sensación de consola de los 90: pocos botones, lectura instantánea.

### Móvil, horizontal

* Stick virtual izquierdo: movimiento 360° discretizado/filtrado para control estable.
* Botón A contextual: pase con balón / presión o entrada sin balón.
* Botón B: tiro; mantener carga potencia dentro de límites cortos.
* Botón opcional C sólo si playtests prueban que es necesario para pase elevado/habilidad.

No cubrir la acción con UI. Zonas táctiles grandes y reajustables si es posible.

### Teclado

* WASD/flechas: mover.
* A/J: acción/pase/entrada.
* S/K: tiro.
* Bindings centralizados, no hardcodeados en Player.

### Selección de jugador

Automática por defecto. El selector debe puntuar:

* distancia/intercepción probable;
* dirección de movimiento de balón;
* rol/posición;
* si otro compañero ya está comprometido;
* estabilidad: hysteresis/cooldown para evitar saltos constantes.

El indicador visible del jugador controlado debe ser grande, limpio y legible.

\---

## 9\. Cámara

Vista elevada similar al lenguaje visual de una transmisión futbolística. Nunca necesita mostrar todo el campo.

Requisitos:

* Sigue una posición suavizada que considera balón + jugador controlado.
* Look-ahead hacia la dirección de ataque/velocidad de la pelota.
* Zoom suficientemente cercano para leer personajes y balón.
* Nunca perder pelota ni acciones críticas fuera de encuadre por decisiones de cámara.
* Sin movimientos bruscos al cambiar jugador.
* Shake corto y limitado sólo para eventos importantes; nunca sacrificar lectura.

Crear CameraController independiente y testeable en su matemática.

\---

## 10\. Jugador y balón

### Jugador

Cada Footballer tiene:

* id estable;
* nombre ficticio;
* posición/rol;
* atributos;
* nivel y XP;
* energía;
* historial/arquetipo de formación;
* habilidad(es) desbloqueadas según versión;
* precio base fijo;
* apariencia/preset visual;
* estado disponible/cansado/lesionado.

### Atributos MVP

Escala interna 1–100:

* Velocidad.
* Control.
* Pase.
* Tiro.
* Defensa.
* Resistencia.
* Portería sólo para GK.

La UI puede simplificar estos números en barras/categorías.

### Balón

Ball es una simulación independiente del jugador:

* x/y terreno.
* z altura ficticia.
* vx/vy.
* vz.
* spin opcional futuro.
* fricción dependiente de superficie/clima.
* sombra atada a x/y y escalada/opacidad por z.

Tiros y pases deben ser reproducibles con parámetros explícitos. Evitar resultados caóticos de física pura.

### Game feel

* Pase rápido y legible.
* Tiro cargado contundente pero no lento.
* Recepción con pequeña asistencia.
* Tiros al poste con audio/feedback propio.
* Red debe reaccionar de forma barata pero visible.
* Input buffering pequeño donde mejore respuesta.

\---

## 11\. IA 11 vs 11

NO usar “todos persiguen el balón”.

### Roles mínimos

GK, CB/DF, MF, FW. Formaciones concretas se definen mediante datos.

### Utility + FSM ligera

Cada jugador evalúa acciones con baja frecuencia (ej. 5–10 Hz), mientras locomoción/interpolación corre cada frame.

**Sin balón:** mantener estructura, cubrir zona, marcar amenaza, ofrecer presión, interceptar, recuperar.

**Con posesión propia:** abrirse, dar línea de pase, atacar espacio, apoyar, mantener profundidad.

**Poseedor:** conducir, pasar, tirar o despejar usando utility scores sencillos.

Sólo 1–2 defensores deben presionar agresivamente; el resto conserva estructura.

### Portero

FSM específica:
POSITION → TRACK → CLAIM → DIVE/BLOCK → HOLD → DISTRIBUTE → RECOVER.

El portero no debe comportarse como jugador de campo con velocidad diferente.

### Dificultad

La dificultad sube por liga mediante:

* error de pase/tiro;
* velocidad de reacción;
* calidad de posicionamiento;
* selección de decisiones;
* disciplina defensiva.

Evitar cheats invisibles de velocidad o fuerza salvo tuning mínimo documentado.

\---

## 12\. Tácticas

Sólo tres presets inicialmente:

* Defensiva.
* Equilibrada.
* Ofensiva.

Cambian altura de bloque, riesgo de desmarque y cantidad de jugadores que atacan. No crear sliders tácticos complejos en MVP.

\---

## 13\. Superficie, estadio y clima

Las mejoras del estadio afectan VISUALMENTE y MECÁNICAMENTE.

### Calidad de cancha

Niveles iniciales sugeridos:

1. Tierra/césped muy deteriorado.
2. Césped irregular.
3. Césped correcto.
4. Césped profesional.

En superficies malas:

* mayor fricción/variación limitada del balón;
* sprint ligeramente penalizado;
* recepción algo más difícil.

El efecto debe sentirse sin volver aleatorio o frustrante. Los mismos modificadores afectan a ambos equipos salvo traits explícitos.

### Instalaciones básicas

* Cancha/césped.
* Gradas/capacidad.
* Iluminación (habilita/mejora partidos nocturnos).
* Vestuario.
* Centro de entrenamiento.
* Clínica básica.

Las mejoras son inmediatas al pagar durante MVP. Sin temporizadores pay-to-wait.

### Clima/ambiente

* Día.
* Noche.
* Lluvia.
* Calor.
* Nieve (sólo escenarios apropiados de contenido).

Efectos deben ser simples y configurables. Lluvia puede alterar fricción/control; calor incrementa gasto energético; nieve altera tracción. Cada efecto necesita límites máximos para conservar control arcade.

\---

## 14\. Equipo y personalización

Al crear club:

* Nombre.
* Ciudad/región ficticia.
* Nombre corto para marcador.
* Escudo base original con colores configurables.
* Color primario/secundario.
* Uniforme local.
* Uniforme visitante.
* Pantalón/medias.
* Apariencia evolutiva del estadio.

No mascota. No lema.

Para MVP, el escudo utiliza una forma genérica ORIGINAL del proyecto y permite colores; no reproducir escudos existentes.

### Plantilla

* Máximo 22 futbolistas.
* Validar mínimo funcional para jugar.
* Debe ser imposible comprar un jugador si se excede el límite.

\---

## 15\. Progresión individual

Al terminar:

* Seleccionar MVP a partir de eventos medibles.
* Otorgar XP al MVP.
* Otorgar XP menor al resto de participantes/equipo.
* Mostrar resumen breve y claro.

MVP score sugerido (tuneable): goles, asistencias, atajadas, recuperaciones, pases útiles; penalizar errores graves. No premiar únicamente goles.

### Habilidades

Se desbloquean mediante niveles/entrenamientos. Mantener pocas y legibles.
Ejemplos:

* Tiro potente.
* Control rápido.
* Pase preciso.
* Recuperador.
* Reflejos (GK).

MVP: máximo 1 especialidad activa/pasiva significativa por jugador hasta validar el sistema. Evitar árboles enormes.

\---

## 16\. Energía, entrenamiento y lesiones

### Energía

0–100. Partido y entrenamiento consumen energía. Menor energía reduce principalmente capacidad de sostener sprint/rendimiento; jamás debe provocar controles rotos.

Regeneración inicial de diseño: hasta \~24 h para recuperación completa desde agotamiento extremo. TODOS los tiempos deben vivir en configuración y poder acelerarse durante tests.

### Entrenamiento

Entrenamientos mejoran atributos específicos a cambio de energía. Primeros minijuegos candidatos:

* definición a objetivos;
* slalom/control;
* pases;
* defensa;
* reflejos GK.

No implementar todos antes de validar uno.

### Sobreentrenamiento

Puede incrementar progreso pero dejar al jugador sin energía suficiente para competir. La decisión es riesgo deportivo, no castigo monetario.

### Lesiones

* Posibles en partidos.
* Muy poco frecuentes durante entrenamiento.
* Probabilidad acotada y visible en configuración.
* Nunca vincular compras reales con recuperación en MVP.

\---

## 17\. Entrenadores

El protagonista representa al entrenador de la historia. Pueden contratarse miembros/staff o mejoras de entrenador mediante precio fijo y bonos simples. Si se implementan entrenadores comprables, definirlos como especialistas del staff para no romper continuidad narrativa.

No crear simulación compleja de contratos en MVP.

\---

## 18\. Economía

### Moneda

Una moneda blanda principal en la versión inicial.

Fuentes:

* Taquilla.
* Premios deportivos.
* Sponsor diario.
* Recompensa diaria por entrar.
* Futuras recompensas publicitarias (NO implementar ads durante MVP).
* Futuras compras de moneda (NO implementar pagos durante MVP).

### Taquilla

Debe depender de:

* capacidad del estadio;
* nivel de asistencia/base de aficionados;
* rendimiento reciente;
* categoría;
* precio/regla sencilla predeterminada.

No convertirlo en simulador financiero.

### Mercado

* Compra directa.
* Máximo 22 jugadores.
* Precios fijos por tier, por ejemplo escala simple desde jugadores económicos hasta top; valores exactos son datos de balance, no especificación inmutable.
* Sin subastas.
* Sin negociación salarial en MVP.
* Venta directa por valor configurado.

La tensión buscada: “¿compro un mejor delantero o arreglo la cancha?” Una estrella en un terreno deficiente no extrae todo su potencial debido a las condiciones comunes del partido.

### Monetización futura

Ads recompensados y compra de moneda requieren documento separado, consentimiento/plataforma, análisis de economía y protección contra pay-to-win. Fuera del MVP.

\---

## 19\. Ligas y carrera

### 19.1 Barrio

3 encuentros de tutorial. No es todavía la carrera profesional.

### 19.2 Liga Amateur

Primera campaña estructurada.

### 19.3 Segunda División

Mayor calidad IA y requisitos económicos/deportivos.

### 19.4 Primera División

Meta del lanzamiento v1.

Cada liga aumenta dificultad sin añadir controles nuevos arbitrarios.

### Repetición/ascenso

Al cumplir las condiciones de una liga, el jugador puede repetir la misma categoría para desarrollar club o aceptar el ascenso.

### Fracaso

Una campaña/temporada puede eliminar al club de esa carrera si acumula suficientes derrotas/queda fuera según reglas de competición. El reinicio debe estar explicado antes de que ocurra. NUNCA borrar cosméticos o metaprogresión comprada/ganada sin aviso.

No hay objetivos secundarios obligatorios por partido.

\---

## 20\. Contenido futuro: prohibido en MVP

Diseñar interfaces desacopladas cuando cueste poco, pero NO construir todavía:

* Libertadores ficticia/continental.
* Mundial de Clubes.
* Selecciones nacionales.
* Eliminatorias.
* Copa continental.
* Mundial.
* Amistosos online.
* Matchmaking.
* PvP competitivo.
* Chat.
* Clanes.
* Ads reales.
* IAP.
* Mercado entre usuarios.

\---

## 21\. Dirección artística

### Personajes

2D cartoon de alta legibilidad, proporciones estilizadas/cabezonas y silueta clara. Deben verse bien a escala de partido. No requieren personalización física individual por usuario; jugadores usan presets variados originales.

Animaciones mínimas:

* idle;
* correr en direcciones necesarias;
* controlar/pasar;
* tirar;
* entrada;
* caída/recuperación si aplica;
* celebración corta;
* GK idle/move/dive/claim/distribute.

Evitar que la animación retrase el input. Gameplay manda sobre fidelidad visual.

### Campo

Franjas sutiles, líneas claras, Porterías legibles, superficie que evoluciona visualmente. El balón nunca puede confundirse con líneas o partículas.

### Assets generados por IA

Se pueden usar para concept art y exploración. Antes del shipping:

* revisar licencias/términos;
* normalizar perspectiva, paleta y proporciones;
* mantener provenance/metadata de cada asset;
* no pedir imitaciones exactas de artistas, juegos o marcas.

\---

## 22\. Audio: pilar de producto

El estadio debe sentirse vivo incluso con gráficos sencillos.

### Capas

1. Room/stadium ambience.
2. Público base.
3. Intensidad dinámica según ataque/peligro/marcador.
4. Tambores/cánticos/vuvuzelas originales y contextuales.
5. Silbato árbitro.
6. Toque/pase/tiro del balón.
7. Poste/travesaño.
8. Red/gol.
9. Entradas/impactos sin exageración.
10. UI.

### Reglas

* No usar audio extraído de transmisiones o juegos.
* Cánticos deben ser originales.
* Mezcla con límites para evitar saturación móvil.
* Eventos repetitivos necesitan variantes y pitch/volume variation sutil.
* Gol aumenta ambiente sin impedir oír feedback esencial.

Crear AudioDirector basado en eventos, no llamadas de audio dispersas por entidades.

\---

## 23\. Narrativa y personajes

### Reparto inicial sugerido

* Entrenador protagonista: avatar funcional del jugador.
* Reportero/corresponsal ficticio recurrente: enmarca progresión y noticias.
* Encargado/a del campo: introduce mejoras del estadio.
* Asistente técnico: tutorial y formación.
* Ojeador/a: introduce mercado.
* Rival barrial recurrente: rivalidad deportiva ligera.

Los personajes deben ser originales. Diálogos cortos; nunca bloquear repetidamente el acceso al partido.

Narrativa mediante escenas breves/pre-match/post-match, mensajes y cambios visuales del barrio/club.

\---

## 24\. Datos y configuración

Separar contenido de lógica.

Sugerencia:

```
src/data/
  balance.ts
  teams.ts
  players.ts
  leagues.ts
  formations.ts
  stadium.ts
  training.ts
  weather.ts
```

Todos los IDs persistidos son estables. Nunca guardar referencias frágiles por índice.

BalanceConfig debe centralizar velocidades, cooldowns, energía, economía, tiempos, dificultad y modificadores ambientales.

\---

## 25\. Guardado

### MVP

Local-first.

SaveGame versionado:

* schemaVersion;
* profile;
* club;
* roster IDs + estado;
* progression;
* economy;
* stadium;
* calendar/campaign;
* settings;
* timestamps relevantes.

Requisitos:

* autosave después de transacciones y partidos;
* escritura atómica cuando plataforma lo permita;
* migraciones entre schema versions;
* slot de backup/recovery;
* nunca aceptar economía negativa por corrupción de save.

### Cuenta/nube

La UX futura requerirá cuenta para mantener personalización y progreso entre dispositivos, pero backend no debe bloquear el MVP. Crear `SaveRepository` con implementación local para sustituirla después.

\---

## 26\. Arquitectura recomendada

```
src/
  app/
    Game.ts
  scenes/
    BootScene.ts
    MainMenuScene.ts
    ClubScene.ts
    MatchScene.ts
    ResultsScene.ts
  entities/
    Player.ts
    Ball.ts
    Goal.ts
  match/
    MatchManager.ts
    RulesEngine.ts
    PossessionSystem.ts
    PlayerSelectionSystem.ts
    CameraController.ts
    FormationSystem.ts
    WeatherSystem.ts
  ai/
    FootballAI.ts
    GoalkeeperAI.ts
    UtilityScorer.ts
  input/
    InputManager.ts
    KeyboardInput.ts
    TouchInput.ts
  audio/
    AudioDirector.ts
  progression/
    ExperienceSystem.ts
    EnergySystem.ts
    TrainingSystem.ts
  club/
    EconomySystem.ts
    TransferMarket.ts
    StadiumSystem.ts
    RosterSystem.ts
  persistence/
    SaveRepository.ts
    LocalSaveRepository.ts
    migrations/
  data/
  ui/
  utils/
tests/
```

Principio: Phaser Scenes coordinan; la lógica de dominio vive en clases/sistemas testeables sin depender innecesariamente de Phaser.

\---

## 27\. SDD — proceso obligatorio

Cada feature no trivial empieza con `specs/<feature>.md`.

Plantilla:

```
# Feature
## Problema del jugador
## Objetivo
## Fuera de alcance
## User stories
## Reglas de dominio
## UX/controles
## Estados y transiciones
## Datos/configuración
## Edge cases
## Rendimiento
## Telemetría futura
## Criterios de aceptación
## Casos de prueba
```

No implementar una feature grande desde una frase vaga. Si falta una decisión que cambia producto, documentar `OPEN QUESTION` y escoger una default reversible sólo si desbloquea prototipo.

\---

## 28\. TDD y estrategia de pruebas

### Pirámide

**Unitarias:** matemáticas del balón, energía, XP, economía, selector, reglas, scoring MVP, modificadores clima/superficie.

**Integración:** MatchManager + RulesEngine; IA + formaciones; resultados + progresión + save.

**E2E/smoke:** iniciar juego, comenzar partido, marcar/finalizar, ver resultados, guardar/cargar, comprar jugador, mejorar estadio.

### Determinismo

* RNG inyectable con seed.
* Reloj inyectable para energía/recompensa diaria.
* No usar `Math.random()` directamente en dominio.
* No usar `Date.now()` directamente en lógica persistente.

### Definition of Done

Una feature está terminada sólo cuando:

* cumple spec;
* tests pertinentes pasan;
* typecheck pasa;
* no introduce error visible en consola;
* funciona con teclado y, si aplica, touch;
* no rompe save existente sin migración;
* performance permanece dentro del presupuesto;
* fue probada manualmente cuando involucra game feel.

\---

## 29\. Tests críticos mínimos

### Match

* Gol cuenta una sola vez.
* Reloj se pausa en stoppage si así lo define configuración.
* Salida por lateral elige equipo correcto.
* Corner/goal kick dependen del último toque.
* Reinicio coloca entidades en posiciones válidas.
* Full time bloquea nuevos goles.

### Ball

* Fricción reduce velocidad de manera estable.
* z nunca queda permanentemente bajo cero.
* rebote/aterrizaje no genera energía infinita.
* superficie cambia valores dentro de límites.

### Selection

* Selecciona opción razonable más cercana a trayectoria, no sólo distancia absoluta.
* No oscila cada frame entre dos jugadores.

### Economy

* Compra descuenta exactamente precio.
* No comprar sin fondos.
* No exceder 22.
* Upgrade no puede comprarse dos veces por race/doble click.
* Taquilla nunca produce NaN/negativos inválidos.

### Energy

* Nunca <0 ni >100.
* Regeneración reproducible con clock mock.
* Entrenamiento descuenta energía y otorga progreso una sola vez.

### Save

* Round-trip conserva estado.
* Save antiguo migra.
* Save corrupto cae en recovery seguro.

\---

## 30\. Observabilidad de desarrollo

Modo debug activable, nunca visible en producción normal:

* FPS.
* estado del partido;
* posesión;
* jugador seleccionado y score de candidatos;
* estados IA;
* zonas/formación;
* velocidad/altura balón;
* seed RNG;
* colisiones;
* modificadores clima/césped.

Agregar comandos/debug sliders para tuning de velocidad, fricción, pase, tiro y cámara sin recompilar cuando sea práctico.

\---

## 31\. Balance inicial: filosofía, no números finales

Todos los valores son configurables. Primero encontrar diversión, después congelar balance.

Restricciones:

* jugador humano debe sentir respuesta inmediata;
* pase estándar debe ser más confiable que driblar todo el campo;
* tiro potente debe tener contrapartida de carga/precisión;
* cancha mala se nota pero no decide el partido sola;
* clima modifica estrategias de ejecución sin transformar el juego;
* mejores jugadores ayudan, pero no sustituyen jugar bien;
* diferencia entre ligas debe ser clara sin rubber-banding extremo.

\---

## 32\. Roadmap de implementación

### Fase 0 — Reset controlado

* Auditar MVP existente.
* Conservar sólo infraestructura útil.
* Tests básicos/build verde.
* Crear configs y arquitectura mínima.

**Gate:** proyecto abre reproduciblemente y CI local puede verificarlo.

### Fase 1 — Sandbox 1v1 + balón

* Movimiento.
* pase/tiro;
* balón XYZ virtual;
* arco/gol;
* cámara;
* teclado + touch proto.

**Gate:** 10 minutos de sandbox sin bugs graves y controles satisfactorios.

### Fase 2 — Small-sided 3v3/5v5 interno

Aunque producto final sea 11v11, usar equipos reducidos para desarrollar IA.

* selección automática;
* posiciones;
* pase AI;
* defensa;
* GK inicial.

**Gate:** IA mantiene forma y no converge toda al balón.

### Fase 3 — 11v11 vertical slice

* formaciones;
* portero completo;
* reglas/reanudaciones;
* cámara final aproximada;
* 3 minutos;
* audio básico.

**Gate:** jugar 10 partidos completos sin soft-lock; rendimiento objetivo alcanzado.

### Fase 4 — GAME FEEL milestone

* tuning intensivo;
* animación cartoon;
* stadium audio dinámico;
* feedback de pase/tiro/gol;
* clima/césped prototipo.

**GATE CRÍTICO:** no avanzar hasta que el partido por sí mismo sea divertido.

### Fase 5 — Tutorial de barrio

* narrativa mínima;
* 3 partidos;
* personajes introductorios;
* unlock Liga Amateur.

### Fase 6 — Club/progresión

* plantilla ≤22;
* XP/MVP;
* energía;
* un entrenamiento;
* mercado simple;
* economía;
* estadio básico;
* save versionado.

### Fase 7 — Liga Amateur

* temporada completa;
* dificultad;
* taquilla/afición;
* ascenso voluntario/repetición.

### Fase 8 — Segunda División

* contenido y balance;
* mejoras estadio;
* más jugadores/arquetipos;
* clima ampliado.

### Fase 9 — Primera División / v1

* campaña hasta meta;
* polish;
* onboarding completo;
* accessibility;
* optimización;
* Android packaging;
* QA/regression.

### Fase 10 — Sólo después de v1

Online, torneos internacionales, monetización, nube avanzada y contenido live según métricas reales.

\---

## 33\. Criterios cuantitativos del vertical slice

Antes de sistemas de carrera profundos:

* 11v11 completa un partido sin bloqueo en ≥99% de runs automatizables disponibles.
* Ningún jugador permanece atrapado fuera del campo tras una reanudación.
* Ningún gol cuenta doble.
* El selector no cambia repetidamente sin causa dentro de una ventana de estabilidad configurable.
* Frame time medido y registrado en dispositivo de referencia.
* Touch y teclado producen la misma intención de gameplay.
* Todos los valores de balance principales editables desde config.

Las cifras de FPS/dispositivos exactas se fijan después de profiling real, no se inventan.

\---

## 34\. UX y accesibilidad

* Texto legible en móvil.
* Iconos acompañados de significado contextual.
* Vibración opcional.
* Volumen separado: master, ambiente, efectos, música, narración.
* Reducir shake.
* Opciones de tamaño/transparencia de controles táctiles cuando sea viable.
* Contraste del indicador del jugador independiente del uniforme.
* No depender sólo de rojo/verde para estados.
* Pausa disponible fuera de situaciones online futuras.

\---

## 35\. Seguridad de economía y tiempo

Incluso local:

* validar todas las transacciones desde servicio de dominio;
* UI nunca modifica balance directamente;
* timestamps pasan por TimeProvider;
* recompensas diarias idempotentes;
* guardado valida schema antes de cargar;
* los cheats locales no son prioridad hasta existir backend/PvP.

\---

## 36\. Automatización para agentes IA

Cuando un agente reciba “implementa X”:

1. Ubica X en roadmap.
2. Lee/crea spec.
3. Inspecciona archivos relacionados.
4. Enumera riesgos/edge cases.
5. Crea test que falle cuando sea útil.
6. Implementa incremento mínimo.
7. Corre tests específicos.
8. Corre suite/typecheck.
9. Resume archivos modificados y decisiones.
10. Propone siguiente incremento, pero NO lo implementa sin solicitud.

### Prohibiciones del agente

* No reescribir todo el repo por conveniencia.
* No borrar pruebas para conseguir verde.
* No reducir strictness de TypeScript para ocultar errores.
* No agregar dependencias si una solución simple existente basta.
* No crear sistemas de monetización o red prematuramente.
* No cambiar game design silenciosamente.
* No incluir assets sin procedencia/licencia.
* No generar cientos de archivos/content antes de validar sistemas.

### Commits sugeridos

Un comportamiento por commit cuando sea práctico. Mensajes: `feat(match): ...`, `fix(ball): ...`, `test(economy): ...`, `docs(spec): ...`.

\---

## 37\. Política de decisiones

Si una decisión NO está definida:

* Si es fácil de revertir y puramente técnica: elegir solución más simple y documentarla.
* Si cambia jugabilidad/economía/narrativa/monetización: marcar pregunta y no asumir silenciosamente.
* Si bloquea compilación por detalle menor: usar placeholder explícito.

Crear `docs/adr/NNNN-title.md` para decisiones arquitectónicas importantes.

\---

## 38\. Métricas futuras

Preparar nombres de eventos, no analytics real hasta decidir privacidad/backend:

* match\_started/completed;
* match\_result;
* tutorial\_step;
* shot/pass/goal;
* player\_selected;
* training\_completed;
* stadium\_upgrade;
* player\_purchase/sale;
* league\_promoted;
* session\_duration.

Nunca registrar información personal sensible innecesaria.

\---

## 39\. Checklist antes de declarar MVP jugable

* \[ ] Se siente bien mover/controlar.
* \[ ] Pasar es rápido y útil.
* \[ ] Tirar tiene peso y feedback.
* \[ ] Balón visible siempre.
* \[ ] Cámara estable.
* \[ ] 11v11 conserva posiciones razonables.
* \[ ] GK funciona.
* \[ ] Laterales/corners/meta no bloquean partido.
* \[ ] Partido termina correctamente.
* \[ ] UI móvil no tapa acción.
* \[ ] Audio comunica contacto, peligro y gol.
* \[ ] 60 FPS objetivo evaluado en hardware real.
* \[ ] Save/load probado.
* \[ ] Tutorial de 3 partidos funciona.
* \[ ] Ciclo partido → recompensa → mejora → partido funciona.

\---

## 40\. North Star

Cada cambio debe contestar:

**¿Hace que jugar el próximo partido sea más claro, divertido o significativo?**

Si la respuesta es no, probablemente no es prioridad.

El objetivo no es reconstruir un juego desaparecido. El objetivo es crear un fútbol arcade original que produzca la misma clase de recuerdo: entrar por curiosidad, jugar por simplicidad y quedarse porque el club se siente propio.

