# VExUS Sim — simulador ecográfico de congestión venosa

Simulador web de VExUS (Venous Excess Ultrasound Score) construido como una **cadena causal**:

```
PatientState → fisiología (presiones, flujos, calibres) → anatomía deformable
  → adquisición (sonda 6DOF, haz, transmisión) → imagen B / color / IQ pulsado
  → espectro + audio → medición sobre lo adquirido → clasificación VExUS C
```

Nada dibuja una onda «normal / leve / grave»: las ondas suprahepáticas, la pulsatilidad
portal y el calibre de la cava **emergen** de una red venosa de parámetros concentrados
gobernada por una presión auricular derecha con forma fisiológica (ondas a/c/x/v/y,
insuficiencia tricuspídea, función del VD, respiración). El grado se calcula después, y por
separado para la verdad del caso y para lo que el alumno adquirió.

**Misión:** un gemelo digital ecográfico de la congestión venosa en el que el médico aprende VExUS obteniendo las
señales, no solo reconociéndolas, y puede equivocarse como con un paciente real. Los objetivos medibles (causalidad,
fidelidad ecográfica, anatómica y clínica, enseñar a obtener, interfaz simple, rendimiento y honestidad) y los
criterios para decidir están en [`docs/MISION.md`](docs/MISION.md).

> **Aviso.** No es un dispositivo médico. Los pacientes son sintéticos y muchos parámetros
> están marcados como `EXTRAPOLATION / NEEDS_CALIBRATION` (ver
> [`docs/APPROXIMATIONS.md`](docs/APPROXIMATIONS.md)). La base científica está en el informe
> «VExUS — Base de conocimiento y especificación» (21-09-2026), del que este código toma
> reglas, umbrales y valores iniciales.

## Ejecutar

```bash
npm install
npm run dev        # http://localhost:6600
```

| Comando              | Qué hace                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `npm run dev`        | servidor de desarrollo (Vite)                                                              |
| `npm test`           | pruebas rápidas (clasificador, anatomía, sonda, capas, documentación)                      |
| `npm run test:all`   | también las lentas (`// @tier slow`: fisiología emergente y cadena Doppler, ~1 min)        |
| `npm run calibrate`  | integra los casos y resume los observables fisiológicos verdaderos                         |
| `npm run docs:index` | regenera `docs/DECISIONS_INDEX.md`                                                         |
| `npm run check`      | formato + lint (con tipos) + tipos + todas las pruebas con cobertura + build + presupuesto |
| `npm run e2e`        | extremo a extremo en Chromium (arranque, medición, pérdida de GPU, equivalencia TS ↔ GLSL) |

Requiere Node 24 (la versión de `.nvmrc`, la que usan la CI y el desarrollo; `engines` admite ≥ 22, sin
probar) y un navegador con WebGL2 + `EXT_color_buffer_float` (Chrome, Safari 17+,
Firefox). Única dependencia de producción: three.js (navegador 3D); todo lo demás es procedural. El audio Doppler se activa con el botón «Audio» (política de reproducción del navegador).

## Cómo se usa

La pantalla tiene tres columnas: a la izquierda las **ventanas VExUS** (una tarjeta por punto de
partida), el **navegador 3D** («Sonda y abdomen») y el **corte ecográfico** plegable (mapa de las
estructuras que atraviesa el plano, con rótulos en modo docente); en el centro la **imagen** con HUD
y ECG (el espectro aparece con el PW y la franja del modo M con el modo M); a la derecha la **consola** por
pestañas. Abajo, la barra de modos: [2D | M | Color | PW] (Color y PW a la vez es el tríplex), Congelar, Audio y
Torso 3D.

- **Ventanas**: cada tarjeta desliza la sonda de forma continua hasta su punto de partida con sus ángulos
  de partida; la ventana hay que afinarla (nada teletransporta a una vista). La tarjeta de la ventana en
  la que está la sonda (cerca de su punto y con su giro) queda resaltada; su nombre y su color son los de
  su anillo en el 3D.
- **Sonda (navegador 3D)**: arrastrar la piel desliza; arrastrar el marcador azul o la rueda rota;
  ⇧+arrastrar bascula; ⌥+arrastrar inclina; botón derecho orbita; ⌘/Ctrl+rueda hace zoom. También se
  puede arrastrar sobre la imagen y con el teclado (`W A S D` deslizar, `Q E` rotar, `← →` bascular,
  `↑ ↓` inclinar, `R F` presión, `⇧` fino). La chuleta de gestos y teclado está detrás del «?» del
  navegador.
- **Consola**: _Adquirir_ (imagen: profundidad, ganancia y foco; sonda; respiración; y, plegado,
  lo avanzado: rango dinámico, persistencia, composición espacial y TGC de 8 bandas), _Doppler_
  (contextual: color o PW, con lo avanzado plegado), _Medir_ (protocolo VExUS: VCI con calibrador,
  suprahepática, porta y vena interlobar sobre el espectro adquirido, resultado y grado), _Docente_
  (solo con la casilla activada: intervenciones —bolo, diurético y PEEP— sobre la aurícula de lazo cerrado,
  «Reiniciar paciente», verdad fisiológica y estado de la adquisición). Las explicaciones
  están detrás del ⓘ de cada sección.
- **Modos**: `2` B, `M` modo M (clic en la imagen coloca la línea M, que también se arrastra; su franja
  profundidad × tiempo va debajo del ECG, con el barrido en la sección «Modo M» de Adquirir), `C` Color (clic en la
  imagen centra la caja), `P` PW (clic coloca la puerta), `Espacio` congela, `H` oculta el carril izquierdo, `[ ]`
  profundidad, `− +` ganancia, `Esc` cancela una herramienta.
- **Cine** (`src/ui/controllers/cine.ts`): con la imagen congelada, el deslizador bajo la imagen, `← →` (Inicio y Fin)
  y la rueda sobre la imagen recorren los últimos 6 s de cuadros; el cursor del ECG marca el cuadro mostrado y el
  calibrador mide sobre él. En Medir, «VCI modo M»: con la franja congelada, dos calibres de pared a pared (diámetro
  máximo y mínimo) dan la colapsabilidad. Cada control actúa en su etapa física: la corrección angular solo cambia el rótulo, la
  línea de base solo la presentación, el filtro de pared elimina frecuencias bajas de la IQ.

## Estructura

```
src/core         reloj único, aleatorio con semilla, FFT, unidades y fórmulas Doppler
src/physiology   PatientState, ritmo/ECG, presión de AD, red venosa 0D, respiración, motor
src/anatomy      primitivas implícitas, escena del avatar, deformación respiratoria, consulta
src/probe        sonda 6DOF, contacto/acoplamiento, geometría del haz
src/ultrasound   render WebGL2 por pasadas A–G (transmisión, campo de dispersores, PSF axial/lateral, color, barrido, persistencia)
src/doppler      volumen de muestra físico, IQ, filtro de pared, STFT, medición observada, cadena PW
src/audio        separación direccional (Hilbert) + AudioWorklet
src/vexus        mediciones de referencia y clasificador VExUS C
src/cases        pacientes (normal, congestión grave, FA con congestión moderada)
src/app          Simulator (composición), Store (estado de UI), estilos
src/ui           navegador 3D (three.js), corte ecográfico (Worker), consola por pestañas, entrada de sonda, ECG y espectrograma
src/validation   tests de invariantes (guía §21), ejemplos calculados (base 10.2), capas y documentación
tools/           calibración, depuración de ondas, índice de decisiones, presupuesto de bundle
docs/            DECISIONS.md (+ índice generado), LIMITATIONS.md, APPROXIMATIONS.md, ARCHITECTURE.md,
                 anatomia/revision-normal.md (anatomía y ecografía normal, ventanas VExUS, brechas del modelo)
```

## Estado (v0.5.0)

Cadena causal completa: reloj único → fisiología 0D (aurícula de lazo cerrado en la media con la forma de onda
calibrada, red esplácnico–sinusoidal–
suprahepática–cava con ley de tubo, resistores de Starling y lecho renal; respiración) → anatomía
implícita compartida TS/GLSL (pared, costillas oblicuas, columna, diafragma en dos hemicúpulas, cortina
pulmonar, hígado con fisura umbilical, ligamentos redondo y venoso y segmentos de Couinaud, vesícula en
pera con pared, VCI, suprahepáticas, porta con pared periportal ∝ calibre, vía biliar, riñones con
cápsula, pirámides, seno y pelvis) → sonda 6DOF con acoplamiento y pared blanda → modo B en GPU (PSF con
número F, grafo de pasadas validado) → color por celdas con varianza de Kasai y cadencia física → PW
con volumen de muestra 3D, espectro y audio → medición del alumno (envolvente por percentil de banda
contigua) → VExUS C con el contexto clínico que marca el alumno. Siete casos con el mismo motor: tres de
referencia (sano, congestión grave, FA con congestión moderada) y cuatro trampa con viñeta (presión intraabdominal
alta, IT grave con PAD casi normal, ventilación mecánica y cirrosis con fallo derecho; decisión 82).

Bases estructurales (v0.5.0): modelo de dominio (metadatos de vasos, equipo por comandos con
invariantes, sesión, perfil de transductor, matriz de capas), anatomía de una sola fuente (esquema de
uniforms y módulos de órgano con gemelos TS/GLSL del mismo nombre), producto (versión y commit visibles,
diagnóstico exportable con tiempo de GPU, release por tag).

Garantías automáticas: equivalencia TS ↔ GLSL en CI (7 ventanas y 50 000 puntos por caso, acuerdo
exacto), estadística de speckle de Rayleigh en parénquima, cadena completa del alumno por caso (medido =
verdad, grados 0/3/1), propiedades del motor con fast-check, límites del shader con margen, cobertura
≥ 88 % con umbrales, e2e con WebGL real. Guía de trabajo en `CLAUDE.md`, vocabulario en
`docs/GLOSSARY.md`, estrategia de pruebas en `docs/TESTING.md`.

Véase el informe de cierre de cada iteración en `docs/DECISIONS.md`.
Los criterios anatómicos, ecográficos y de adquisición por ventana se reúnen en
[`docs/anatomy/vexus-window-acceptance.md`](docs/anatomy/vexus-window-acceptance.md).
