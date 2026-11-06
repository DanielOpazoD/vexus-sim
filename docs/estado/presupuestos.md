# Estado vigente: presupuestos

Actualizado: 2026-11-06 sobre main `bd2f575`. Todos los techos que hoy aplica el código, con la decisión que los fijó y
su valor actual. Los techos no se suben para obtener verde (decisión 322); subir uno es una decisión propia, declarada en
la PR y en `docs/DECISIONS.md`.

## Cómo se mantiene

- La tabla la genera `tools/docs/estado.ts` tras `vite build`: lee cada techo de la fuente que lo aplica
  (`tools/ci/bundleBudgets.ts`, `src/anatomy/loadS0028.ts`, `src/ui/s0028Surfaces.ts`, `.github/workflows/ci.yml`, los
  ocho techos de `src/validation/shaderLimits.test.ts` a través de `tools/anatomy/s0028-shader-metrics.ts`) y mide el
  valor actual con las mismas funciones que lo comprueban. Las cifras quedan en `docs/estado/medidas.json`.
- `src/validation/estado.test.ts` exige que cada techo de la tabla sea el del código, que la tabla sea la de
  `medidas.json` y que las medidas de los programas y de las texturas coincidan con las vivas mientras su GLSL y sus
  descriptores no cambien. Regenera con `node --import tsx tools/docs/estado.ts --write` al subir un techo o al cerrar una
  fase.
- Lo que no mide una herramienta local queda fuera de la tabla: la duración real de los trabajos de la CI (el recibo de
  cada PR) y el pico de memoria en Metal, criterio de trabajo de ≤ 2,0 GB para toda la aplicación (decisión 318; medido
  1,68–1,77 GB con s0028 en P2, decisión 320).

## Techos

<!-- tabla generada por tools/docs/estado.ts -->

Medido sobre main `bd2f575` el 2026-11-06 con `tools/docs/estado.ts`. No se copian a mano.

| Techo                                               |      Límite |      Actual |     Margen | Unidad   | Decisión | Fuente                      |
| --------------------------------------------------- | ----------: | ----------: | ---------: | -------- | -------- | --------------------------- |
| JS total (todo `dist`, Workers y ganchos incluidos) |   1.070.080 |   1.069.860 |        220 | B        | 294      | `tools/ci/bundleBudgets.ts` |
| `abdominal-atlas.gzip.bin`                          |   6.291.456 |   5.806.258 |    485.198 | B        | —        | `tools/ci/bundleBudgets.ts` |
| `abdominal-body.bin`                                |        3640 |        3640 |          0 | B        | —        | `tools/ci/bundleBudgets.ts` |
| `abdominal-direct.gzip.bin`                         |   8.567.375 |   8.567.375 |          0 | B        | 317      | `tools/ci/bundleBudgets.ts` |
| `abdominal-surface.gzip.bin`                        |   6.291.456 |   5.914.463 |    376.993 | B        | —        | `tools/ci/bundleBudgets.ts` |
| `abdominalAtlas.js`                                 |     122.880 |      22.357 |    100.523 | B        | —        | `tools/ci/bundleBudgets.ts` |
| `abdominalSurface.js`                               |     122.880 |        3568 |    119.312 | B        | —        | `tools/ci/bundleBudgets.ts` |
| `anatomyScene.js`                                   |     122.880 |      22.519 |    100.361 | B        | —        | `tools/ci/bundleBudgets.ts` |
| `annotation-capacity.gzip.bin`                      |     856.999 |     284.466 |    572.533 | B        | 320      | `tools/ci/bundleBudgets.ts` |
| `bootstrap.js`                                      |     343.040 |     289.434 |     53.606 | B        | —        | `tools/ci/bundleBudgets.ts` |
| `candidate-manifest.bin`                            |      38.617 |      38.309 |        308 | B        | 321      | `tools/ci/bundleBudgets.ts` |
| `cutMapView.js`                                     |     122.880 |      16.105 |    106.775 | B        | —        | `tools/ci/bundleBudgets.ts` |
| `cutMapWorker.js`                                   |     122.880 |        2517 |    120.363 | B        | —        | `tools/ci/bundleBudgets.ts` |
| `doppler-worklet.js`                                |     122.880 |        2829 |    120.051 | B        | —        | `tools/ci/bundleBudgets.ts` |
| `gatePlacement.js`                                  |     122.880 |        1164 |    121.716 | B        | —        | `tools/ci/bundleBudgets.ts` |
| `index.css`                                         |      20.480 |      20.433 |         47 | B        | —        | `tools/ci/bundleBudgets.ts` |
| `index.js`                                          |     343.040 |        5181 |    337.859 | B        | —        | `tools/ci/bundleBudgets.ts` |
| `loadS0028.js`                                      |     122.880 |        1874 |    121.006 | B        | —        | `tools/ci/bundleBudgets.ts` |
| `navigator3d.js`                                    |     122.880 |      28.288 |     94.592 | B        | —        | `tools/ci/bundleBudgets.ts` |
| `pwMeasurements.js`                                 |     122.880 |      15.854 |    107.026 | B        | —        | `tools/ci/bundleBudgets.ts` |
| `query.js`                                          |     122.880 |     104.478 |     18.402 | B        | —        | `tools/ci/bundleBudgets.ts` |
| `reference-body.bin`                                |        2080 |        2080 |          0 | B        | —        | `tools/ci/bundleBudgets.ts` |
| `s0028Solids.js`                                    |     122.880 |      11.490 |    111.390 | B        | —        | `tools/ci/bundleBudgets.ts` |
| `s0028Surfaces.js`                                  |     122.880 |        5964 |    116.916 | B        | —        | `tools/ci/bundleBudgets.ts` |
| `series.js`                                         |     122.880 |        2199 |    120.681 | B        | —        | `tools/ci/bundleBudgets.ts` |
| `skin-polar.gzip.bin`                               |     947.509 |     947.509 |          0 | B        | 317      | `tools/ci/bundleBudgets.ts` |
| `speckleField.js`                                   |     122.880 |        9580 |    113.300 | B        | —        | `tools/ci/bundleBudgets.ts` |
| `structureIdentity.js`                              |     122.880 |        1457 |    121.423 | B        | —        | `tools/ci/bundleBudgets.ts` |
| `surfaces.gzip.bin`                                 |   9.672.026 |   5.340.216 |  4.331.810 | B        | 318      | `tools/ci/bundleBudgets.ts` |
| `teacherTab.js`                                     |     122.880 |      46.604 |     76.276 | B        | —        | `tools/ci/bundleBudgets.ts` |
| `testHooks.js`                                      |     122.880 |      69.636 |     53.244 | B        | —        | `tools/ci/bundleBudgets.ts` |
| `thoracic-atlas.gzip.bin`                           |   6.291.456 |   4.444.037 |  1.847.419 | B        | —        | `tools/ci/bundleBudgets.ts` |
| `thoracic-direct.gzip.bin`                          |   5.252.011 |   5.252.011 |          0 | B        | 317      | `tools/ci/bundleBudgets.ts` |
| `thoracic-surface.gzip.bin`                         |   6.291.456 |   3.341.604 |  2.949.852 | B        | —        | `tools/ci/bundleBudgets.ts` |
| `three.js`                                          |     385.024 |     380.390 |       4634 | B        | 307      | `tools/ci/bundleBudgets.ts` |
| `transducerProfile.js`                              |     122.880 |      25.984 |     96.896 | B        | —        | `tools/ci/bundleBudgets.ts` |
| `units.js`                                          |     122.880 |         388 |    122.492 | B        | —        | `tools/ci/bundleBudgets.ts` |
| Descarga del paquete s0028 (gzip)                   |  25.000.000 |  20.433.526 |  4.566.474 | B        | 318      | `src/ui/s0028Surfaces.ts`   |
| Cada `.gzip` fijado del paquete s0028 (por archivo) |  19.510.002 |   8.567.375 | 10.942.627 | B        | 317      | `src/anatomy/loadS0028.ts`  |
| Textura abdominal s0028 en memoria (RAW)            | 139.921.010 | 139.917.029 |       3981 | B        | 317      | `src/anatomy/loadS0028.ts`  |
| Textura torácica s0028 en memoria (RAW)             |  60.413.664 |  60.413.664 |          0 | B        | 317      | `src/anatomy/loadS0028.ts`  |
| Samplers por programa (las dos personas)            |          16 |          16 |          0 | samplers | 317      | `tools/ci/shaderBudgets.ts` |
| Ranuras vec4 de uniforms por programa               |         179 |         138 |         41 | ranuras  | 317      | `tools/ci/shaderBudgets.ts` |
| Trabajo «check» de la CI                            |          25 |           — |          — | min      | —        | `.github/workflows/ci.yml`  |
| Trabajo «matrix-validation» de la CI                |          25 |           — |          — | min      | —        | `.github/workflows/ci.yml`  |
| Trabajo «triplex-early» de la CI                    |          10 |           — |          — | min      | —        | `.github/workflows/ci.yml`  |
| Trabajo «e2e» de la CI                              |          40 |           — |          — | min      | —        | `.github/workflows/ci.yml`  |

Programas especializados (`shaderLimits.test.ts`, decisiones 309 y 320): tokens y ramas expandidos de `main`, por persona.

| Programa                  |  Tokens default / s0028 / techo |    Uso | Ramas default / s0028 / techo |    Uso | Ranuras | Samplers |
| ------------------------- | ------------------------------: | -----: | ----------------------------: | -----: | ------: | -------: |
| `FRAG_RAWFIELD`           | 1.260.863 / 407.897 / 1.385.000 | 91,0 % |        10.108 / 2926 / 11.060 | 91,4 % |     136 |       10 |
| `FRAG_RAWFIELD_ECHO`      |     525.694 / 166.402 / 577.000 | 91,1 % |            4239 / 1169 / 4640 | 91,4 % |     137 |       16 |
| `FRAG_RAWFIELD_CLASS`     |     414.230 / 120.890 / 455.000 | 91,0 % |             3503 / 853 / 3830 | 91,5 % |     136 |       10 |
| `FRAG_RAWFIELD_ELEVATION` |     414.370 / 121.030 / 455.000 | 91,1 % |             3505 / 855 / 3830 | 91,5 % |     137 |       15 |
| `FRAG_RAWFIELD_GRADIENT`  |      318.190 / 96.635 / 351.000 | 90,7 % |             2501 / 599 / 2760 | 90,6 % |     138 |       15 |
| `FRAG_TRANS_HITS`         |     468.025 / 168.324 / 513.000 | 91,2 % |            4104 / 1262 / 4470 | 91,8 % |     101 |        6 |
| `FRAG_TRANS_HITS_GRID`    |      230.028 / 78.134 / 252.000 | 91,3 % |             2030 / 611 / 2210 | 91,9 % |     102 |       11 |
| `FRAG_COLOR`              |      226.512 / 73.008 / 248.000 | 91,3 % |             1987 / 568 / 2160 | 92,0 % |     110 |        7 |

<!-- fin de la tabla generada -->

## Lectura

- El JS total es el techo más ajustado y cubre todo `dist`, incluidos Workers, el worklet y los ganchos de prueba (decisión
  294). La decisión 307 recuperó margen retirando de Three lo que nadie usa sin subir el límite.
- Los activos s0028 están fijados uno a uno (decisiones 317–321); la descarga del paquete completo tiene su propio techo
  de 25.000.000 B (decisión 318). Las texturas RAW se comprueban al cargar, con la misma cuenta que la tabla.
- Los programas tienen techo de tokens y ramas expandidos (decisión 309) porque el JIT de SwiftShader de la CI muere por
  tamaño mucho antes que Metal; las dos personas comparten los mismos techos (decisión 320). Samplers y ranuras de uniforms
  son los de WebGL2 en el peor equipo de referencia (decisión 317).
