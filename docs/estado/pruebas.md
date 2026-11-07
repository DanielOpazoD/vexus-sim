# Estado vigente: pruebas

Actualizado: 2026-11-07 sobre main `8ed26cf`. Qué capas de prueba hay, cuánto tardan y cómo se acepta un cambio. La
estrategia está en `docs/TESTING.md`; el procedimiento de aceptación y fusión, en `CONTRIBUTING.md`.

## Capas

<!-- capas: generado por tools/docs/estado.ts -->

Medido en el candidato basado en main `8ed26cf` el 2026-11-07 con `tools/docs/estado.ts`.

| Capa                                    |  Cuántas | Dónde                                   |
| --------------------------------------- | -------: | --------------------------------------- |
| Archivos vitest (rápidos + lentos)      |      321 | `src/**/*.test.ts`                      |
| De ellos, lentos (`// @tier slow`)      |       34 | `npm run test:slow`, `check`, CI        |
| Especificaciones e2e / llamadas `test(` | 85 / 143 | `e2e/*.spec.ts`, 12 fragmentos en la CI |
| Contratos Python                        |       20 | `tools/anatomy/*_test.py` (local)       |

<!-- fin de capas -->

| Capa               | Qué protege                                                                                            | Cuándo corre                        |
| ------------------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Unitarias rápidas  | DSP, unidades, clasificador VExUS, anatomía por puntos, sonda, contratos estáticos (GLSL, docs, capas) | `npm test`, gancho de push, `check` |
| Lentas             | fisiología emergente por caso, cadena Doppler y cadena completa del alumno (decisión 94)               | `npm run test:slow`, `check`, CI    |
| Cobertura          | umbrales globales que solo suben, en dos fases (core y matrices IQ) con sello por commit               | `check`, CI                         |
| e2e                | arranque, casos, medición, contexto WebGL y equivalencia TS ↔ GLSL con SwiftShader (decisiones 30, 57) | CI en doce fragmentos               |
| Contratos Python   | fuente y exportadores del TAC de la migración s0028                                                    | local, al tocar `tools/anatomy`     |
| Banco de fidelidad | textura e interfaces en GPU real                                                                       | a mano en cada PR de imagen         |

## Tiempos

Medidos en el cierre serial de P3 r2 sobre este Mac (10 núcleos, carga ajena variable;
[cierre](../evidence/INDEX.md#migration-p3-r2-closure-json)):

| Etapa                      | Segundos |
| -------------------------- | -------: |
| `npm test` (un trabajador) |      194 |
| `npm run test:slow`        |    1.084 |
| `npm run check` completo   |    4.591 |

El `check` local tarda 70–85 min y el gancho de push corre los tipos y `npm test` (decisión 322: ambos son la causa de la
dieta de tiempo del punto 7). Con carga ajena alta los fallos locales son de plazo: se anota la carga y se repite, sin
ampliar plazos (decisión 322).

## CI y recibo

- Trabajos: `check` (lint, tipos, pruebas con cobertura, build y presupuesto), `matrix-validation`, `triplex-early` y la
  e2e en doce fragmentos con un trabajador cada uno; plazos en `docs/estado/presupuestos.md`.
- Las fases de validación dejan informes JSON con sello de fase, commit y SHA-256; el cierre comprueba sus bytes y la
  lista completa de archivos (`docs/TESTING.md`).
- La e2e corre sin repeticiones y con `failOnFlakyTests`: un fallo ya impide integrar. El veredicto protegido de `main`
  exige `check`, la matriz, el tríplex y todos los fragmentos; después, el recibo de aceptación verifica la ejecución
  de cada prueba prevista una sola vez (`tools/ci/write-acceptance-receipt.ts`).
- `main` exige el veredicto; ninguna PR se fusiona sin él (decisión 322).

## Guardas estáticas recientes

- Registro de gemelos CPU/GLSL y CPU/Worker: cada par nombra su prueba de paridad (decisión 322, punto 5).
- Manifiestos de mutantes comprobados contra el código; ejecución en el workflow complementario, fuera del veredicto
  protegido (decisión 322, punto 8; `tools/mutants/`).
- Índice de la evidencia y prohibición de rutas absolutas en `docs/`
  ([índice](../evidence/INDEX.md), decisión 322, punto 9).
- Estas páginas de estado: `src/validation/estado.test.ts` exige que existan, que citen decisiones que existen y que
  sus cifras generadas sean las de `docs/estado/medidas.json`.
