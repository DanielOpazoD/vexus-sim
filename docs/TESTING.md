# Estrategia de pruebas

Qué protege cada capa de pruebas, cuándo corre y qué no cubre. Regla general: una prueba
debe fallar si el comportamiento clínico o físico se rompe; una prueba que repite una
constante o un umbral ajustado a la salida actual no protege nada.

| Capa               | Dónde                                             | Cuándo corre                                    | Qué protege                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------ | ------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unitarias rápidas  | `src/validation/*.test.ts` sin marcador           | `npm test` (~15 s), `check`, CI                 | DSP (FFT, filtro de pared, envolvente), unidades, clasificador VExUS C (27 combinaciones), anatomía por puntos, sonda y acoplamiento, capas, documentación, límites del shader (tubos, nodos y ranuras de uniforms), eco de interfaz en la distancia por la normal (`faceGradient.test.ts`: el perfil suma 1 en la VCI elíptica), transitorio omitido bajo ruido/10 al sumarse y ≤ ruido/6 tras la PSF (`receiver.test.ts`), opciones de medida del coste del cuadro (`frameCost.test.ts`) |
| Lentas             | primera línea `// @tier slow`                     | `npm run test:all`, `check`, CI                 | Fisiología emergente por caso, cadena Doppler, **cadena completa del alumno** (`examChain.test.ts`: puerta → espectro → medición → grado), **propiedades** (`properties.test.ts`, fast-check), **gemelo B→C→D de los ecos de interfaz** (`interfaceTwin.test.ts`: β, deriva con la profundidad, M1–M9 y la regla de antes con `it.fails`)                                                                                                                                                  |
| Cobertura          | `npm run test:coverage`                           | `check`, CI                                     | Umbrales globales (≥ 88 % sentencias, ≥ 83 % ramas) que solo pueden subir; excluye lo que necesita DOM/WebGL/Web Audio                                                                                                                                                                                                                                                                                                                                                                     |
| e2e                | `e2e/*.spec.ts` (Playwright + SwiftShader)        | `npm run e2e`, CI tras `check`                  | Arranque sin errores, casos, medición numérica, pérdida y recuperación del contexto WebGL, **equivalencia TS ↔ GLSL** en tejido, vaso, velocidad y cara de interfaz (volumen y cáscara de las caras), **SNR de Rayleigh del speckle** hepático, **normales de la GPU** frente al gradiente de `faceSdf`                                                                                                                                                                                    |
| Banco de fidelidad | `tools/fidelity/bench.ts` (Playwright + GPU real) | `npm run fidelity`, a mano en cada PR de imagen | Textura de la envolvente y de la imagen mostrada, banco de interfaces (paredes por sistema, cápsula, diafragma, Morison; `--sweep` con 4 poses más por vista), cps y coste del cuadro sin y con color; línea base en `docs/fidelity/baseline.json` (decisión 52). La prueba ciega con jueces: `npm run fidelity:blind`                                                                                                                                                                     |

## Principios

- **Pipeline real**: las pruebas de regresión recorren el camino que usa la app (la cadena del
  alumno usa `measureObserved*`, la misma función de la pestaña Medir), no una copia.
- **Técnica del operador**: la puerta se coloca con `bestGateOnVessel` (dentro de la luz, mejor
  ángulo) y la escala hasta el límite de la profundidad; no con atajos que el alumno no tiene.
- **Mutación**: al añadir un gate, se comprueba que falla con el defecto que pretende atrapar
  (el de equivalencia se probó reintroduciendo la ley de caudal constante: p95 120 %; el del
  speckle, detectando intensidad o magnitudes antes del haz en el shader: SNR 1,11 y 6,18).
- **Contraejemplos**: lo que fast-check encuentra se arregla o se documenta como `it.fails`
  enlazado a una limitación de `docs/LIMITATIONS.md`.
- **Semillas fijas**: fisiología, dispersores y fast-check son deterministas.
- **Fronteras**: cerca de un umbral clínico (PF 30/50 %, S/D renal 0,3) una prueba acepta la
  clase vecina y lo dice; lejos de él exige igualdad.

## Coste del cuadro

`window.__vexusTest.frameCostMs(n, opts?)` (`src/app/testHooks.ts`) mide el coste medio de `n` cuadros
en tiempo de pared, sincronizado con la GPU al principio y al final. El reloj no avanza entre cuadros:
con la caja de color encendida, la cadencia del color (decisión 39) saltaría casi todos los cuadros y la
media saldría ≈ 0 ms. Por eso, con la caja encendida exige `forceColor`, y lanza sin él, con la imagen
congelada o con `n` que no sea un entero ≥ 1.

- `forceColor: true`: cada cuadro es completo y lleva la pasada de color. Si la caja está apagada, la
  enciende con el comando del equipo y la deja como estaba al terminar, aunque algo falle.
- `startPoint: '<vista>'`: coloca antes la sonda en ese punto de partida, para comparar medidas en la
  misma pose (el barrido del banco la deja basculada o inclinada).
- `repeatPass: '<pasada>'` (con `repeatCount`, 1 por defecto): repite el dibujo de esa pasada de
  `FRAME_PASSES` dentro de cada cuadro sin cambiar la imagen. Su coste es (con − sin) / `repeatCount`:
  así se atribuye ΔB (`'rawField'`) o ΔA (`'transmission'` y las etapas A0–A2) en Metal, que no separa
  el tiempo de las pasadas (decisión 47). Una pasada de cadencia de color exige `forceColor`. Cada
  repetición dibuja en un destino de prueba propio (dos alternados, con el tamaño y los formatos de la
  salida de la pasada), así que es su propio pase de render: sobre el mismo destino, una GPU de teselas
  (Apple M) podría sombrear solo el último de los triángulos opacos que se tapan. Cada repetición paga,
  como la pasada real, la carga y la escritura de sus teselas.
- **Comprobación de linealidad** antes de fiarse de un Δ: medir con `repeatCount` 1 y 4 (varias veces,
  alternando) y exigir Δ(4) ≈ 4·Δ(1), con Δ(1) muy por encima de la dispersión entre corridas. Un Δ que
  no crece con las repeticiones es que el driver las descarta o que la pasada no es la que limita.
- Las opciones que no medirían nada lanzan (`frameMeasureOptions`). La aplicación nunca las pasa;
  `frameCost.test.ts` lo comprueba con un renderizador falso, y con el renderizador real sobre un WebGL
  falso que cada repetición va a otro FBO que el dibujo anterior, con las texturas de la pasada.

El banco (`npm run fidelity`) guarda por escena `msPerFrame` (color apagado) y `msPerFrameColor`
(color encendido, `forceColor`), las dos en la pose de partida de la vista.

## Composición espacial en los ganchos (decisión 58)

La imagen de la aplicación es, por defecto, el compuesto de tres miradas intercaladas (una por cuadro), y
un gancho que midiera «la envolvente» sin decir cuál cambiaría de significado en silencio. Por eso:

- `compound` es obligatorio en el tipo de `speckle`, `fidelity`, `speckleMotion`, `speckleCrossfade` y
  `transmissionParity`: con `false`, la imagen de una mirada de siempre (las guardas de una mirada lo
  pasan con sus umbrales de antes); con `true`, el gancho dibuja N cuadros, uno por mirada, para que las N
  ranuras del anillo sean del instante de la medida (con un salto de pose el anillo se reinicia; sin él,
  guardaría miradas de antes) y, si mide la imagen mostrada, asienta después la persistencia. El
  conmutador vuelve a como estaba al terminar, aunque algo falle, y medir «el compuesto» con el color
  encendido (donde no se forma) lanza.
- `readEnvelope()` lee la mirada 0 y lanza si no es la del último cuadro; el compuesto se pide con
  `{ source: 'compound' }` y cada mirada con `readLookEnvelope(ranura)`. `readTransmission({ look })` da la
  transmisión de una mirada dirigida solo tras el cuadro que la forma.
- Nuevos: `setCompound`, `compoundState`, `lookCorrelation` (la parte `compound` del banco),
  `temporalStability` (escena quieta: correlación entre cuadros y modulación de periodo 3) y
  `envelopeGuard` (la guarda de `readEnvelope`). `transmissionParity({ compound: true, look })` compara la
  mirada dirigida de la GPU con sus gemelos de TS sobre los segmentos de A0/A1 de la propia GPU
  (`app/steeredParity.ts`): una muestra cuyo resultado cambia al desplazar los redondeos de los gemelos
  ±10⁻⁴ líneas (`STEERED_TIE_LINES`, el doble del error de float32 emulado) es un empate y se cuenta
  aparte. `steeredParity.test.ts` comprueba el margen y que en las cuatro vistas los empates son ≤ 0,5 %
  (0,04–0,31 % en CPU; con el criterio anterior, θ·(1 ± 2·10⁻⁴), 0,35–1,35 %).
- `frameCostMs` mide con el conmutador como esté: con el compuesto, la media de las tres miradas.
- `compoundRenderer.test.ts` comprueba el cableado sin GPU: el renderizador real sobre un WebGL falso
  (`support/recordingGl.ts`, que registra programa, destino, texturas y uniforms de cada dibujo).

## Qué no está cubierto todavía

- Estadística de speckle frente a clips reales (`speckle-statistics-uncalibrated`); la e2e solo
  exige la SNR teórica de Rayleigh en parénquima (`app/speckle.ts`). El banco de fidelidad mide la
  textura de segundo orden y la imagen mostrada contra imágenes reales de referencia, pero a mano y
  sin umbrales en CI.
- Imagen de referencia (golden) del modo B y del color.
- Rendimiento por cuadro medido en CI (solo presupuesto de bundle).
- Interacción de UI más allá de la e2e de humo (paneles, teclado completo, navegador 3D).
