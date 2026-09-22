# Estrategia de pruebas

Qué protege cada capa de pruebas, cuándo corre y qué no cubre. Regla general: una prueba
debe fallar si el comportamiento clínico o físico se rompe; una prueba que repite una
constante o un umbral ajustado a la salida actual no protege nada.

| Capa              | Dónde                                      | Cuándo corre                    | Qué protege                                                                                                                                                                                   |
| ----------------- | ------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unitarias rápidas | `src/validation/*.test.ts` sin marcador    | `npm test` (~15 s), `check`, CI | DSP (FFT, filtro de pared, envolvente), unidades, clasificador VExUS C (27 combinaciones), anatomía por puntos, sonda y acoplamiento, capas, documentación, límites del shader                |
| Lentas            | primera línea `// @tier slow`              | `npm run test:all`, `check`, CI | Fisiología emergente por caso, cadena Doppler, **cadena completa del alumno** (`examChain.test.ts`: puerta → espectro → medición → grado), **propiedades** (`properties.test.ts`, fast-check) |
| Cobertura         | `npm run test:coverage`                    | `check`, CI                     | Umbrales globales (≥ 88 % sentencias, ≥ 83 % ramas) que solo pueden subir; excluye lo que necesita DOM/WebGL/Web Audio                                                                        |
| e2e               | `e2e/*.spec.ts` (Playwright + SwiftShader) | `npm run e2e`, CI tras `check`  | Arranque sin errores, casos, medición numérica, pérdida y recuperación del contexto WebGL, **equivalencia TS ↔ GLSL** en tejido, vaso y velocidad                                             |

## Principios

- **Pipeline real**: las pruebas de regresión recorren el camino que usa la app (la cadena del
  alumno usa `measureObserved*`, la misma función de la pestaña Medir), no una copia.
- **Técnica del operador**: la puerta se coloca con `bestGateOnVessel` (dentro de la luz, mejor
  ángulo) y la escala hasta el límite de la profundidad; no con atajos que el alumno no tiene.
- **Mutación**: al añadir un gate, se comprueba que falla con el defecto que pretende atrapar
  (el de equivalencia se probó reintroduciendo la ley de caudal constante: p95 120 %).
- **Contraejemplos**: lo que fast-check encuentra se arregla o se documenta como `it.fails`
  enlazado a una limitación de `docs/LIMITATIONS.md`.
- **Semillas fijas**: fisiología, dispersores y fast-check son deterministas.
- **Fronteras**: cerca de un umbral clínico (PF 30/50 %, S/D renal 0,3) una prueba acepta la
  clase vecina y lo dice; lejos de él exige igualdad.

## Qué no está cubierto todavía

- Estadística de speckle frente a clips reales (`speckle-statistics-uncalibrated`).
- Imagen de referencia (golden) del modo B y del color.
- Rendimiento por cuadro medido en CI (solo presupuesto de bundle).
- Interacción de UI más allá de la e2e de humo (paneles, teclado completo, navegador 3D).
