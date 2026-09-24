# Estrategia de pruebas

Qué protege cada capa de pruebas, cuándo corre y qué no cubre. Regla general: una prueba
debe fallar si el comportamiento clínico o físico se rompe; una prueba que repite una
constante o un umbral ajustado a la salida actual no protege nada.

| Capa               | Dónde                                             | Cuándo corre                                    | Qué protege                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unitarias rápidas  | `src/validation/*.test.ts` sin marcador           | `npm test` (~15 s), `check`, CI                 | DSP (FFT, filtro de pared, envolvente), unidades, clasificador VExUS C (27 combinaciones), anatomía por puntos, sonda y acoplamiento, capas, documentación, límites del shader (tubos, nodos y ranuras de uniforms), eco de interfaz en la distancia por la normal (`faceGradient.test.ts`: el perfil suma 1 en la VCI elíptica), transitorio omitido solo bajo ruido/10 (`receiver.test.ts`), opciones de medida del coste del cuadro (`frameCost.test.ts`) |
| Lentas             | primera línea `// @tier slow`                     | `npm run test:all`, `check`, CI                 | Fisiología emergente por caso, cadena Doppler, **cadena completa del alumno** (`examChain.test.ts`: puerta → espectro → medición → grado), **propiedades** (`properties.test.ts`, fast-check), **gemelo B→C→D de los ecos de interfaz** (`interfaceTwin.test.ts`: β, deriva con la profundidad, M1–M9 y la regla de antes con `it.fails`)                                                                                                                    |
| Cobertura          | `npm run test:coverage`                           | `check`, CI                                     | Umbrales globales (≥ 88 % sentencias, ≥ 83 % ramas) que solo pueden subir; excluye lo que necesita DOM/WebGL/Web Audio                                                                                                                                                                                                                                                                                                                                       |
| e2e                | `e2e/*.spec.ts` (Playwright + SwiftShader)        | `npm run e2e`, CI tras `check`                  | Arranque sin errores, casos, medición numérica, pérdida y recuperación del contexto WebGL, **equivalencia TS ↔ GLSL** en tejido, vaso, velocidad y cara de interfaz (volumen y cáscara de las caras), **SNR de Rayleigh del speckle** hepático, **normales de la GPU** frente al gradiente de `faceSdf`                                                                                                                                                      |
| Banco de fidelidad | `tools/fidelity/bench.ts` (Playwright + GPU real) | `npm run fidelity`, a mano en cada PR de imagen | Textura de la envolvente y de la imagen mostrada, banco de interfaces (paredes por sistema, cápsula, diafragma, Morison; `--sweep` con 4 poses más por vista), cps y coste del cuadro sin y con color; línea base en `docs/fidelity/baseline.json` (decisión 52). La prueba ciega con jueces: `npm run fidelity:blind`                                                                                                                                       |

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
con la caja de color encendida y sin opciones, la cadencia del color (decisión 39) salta casi todos los
cuadros y la medida no significa nada.

- `forceColor: true`: cada cuadro es completo y lleva la pasada de color. Si la caja está apagada, la
  enciende con el comando del equipo y la deja como estaba al terminar, aunque algo falle.
- `repeatPass: '<pasada>'` (con `repeatCount`, 1 por defecto): repite el dibujo de esa pasada de
  `FRAME_PASSES` dentro de cada cuadro sin cambiar la imagen. Su coste es (con − sin) / `repeatCount`:
  así se atribuye ΔB (`'rawField'`) o ΔA (`'transmission'` y las etapas A0–A2) en Metal, que no separa
  el tiempo de las pasadas (decisión 47). Una pasada de cadencia de color exige `forceColor`.
- Las opciones que no medirían nada lanzan (`frameMeasureOptions`). La aplicación nunca las pasa;
  `frameCost.test.ts` lo comprueba con un renderizador falso.

El banco (`npm run fidelity`) guarda por escena `msPerFrame` (color apagado) y `msPerFrameColor`
(color encendido, `forceColor`).

## Qué no está cubierto todavía

- Estadística de speckle frente a clips reales (`speckle-statistics-uncalibrated`); la e2e solo
  exige la SNR teórica de Rayleigh en parénquima (`app/speckle.ts`). El banco de fidelidad mide la
  textura de segundo orden y la imagen mostrada contra imágenes reales de referencia, pero a mano y
  sin umbrales en CI.
- Imagen de referencia (golden) del modo B y del color.
- Rendimiento por cuadro medido en CI (solo presupuesto de bundle).
- Interacción de UI más allá de la e2e de humo (paneles, teclado completo, navegador 3D).
