# Estado vigente: anatomía

Actualizado: 2026-11-06 sobre main `bd2f575`. Qué anatomía hay hoy, dónde se calcula y qué falta. El historial completo
está en `docs/DECISIONS.md`; la migración paso a paso, en `docs/anatomia/migracion-s0028.md`; la aceptación anatómica,
en `docs/anatomia/relaciones-tac.md`.

## Personas

La fidelidad se mide contra un humano real, no contra un promedio (decisión 311). Hay dos personas y dos variantes de
prueba de la primera:

| Persona | Cómo se elige     | Fuente                                                                                           | Uso                                               |
| ------- | ----------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| default | por defecto       | atlas abdominal y torácico registrados más la escena procedural (vasos, pared en capas, órganos) | la aplicación; no cambia sin decisión propia      |
| legacy  | `?abdomen=legacy` | escena procedural sin atlas                                                                      | gate TS ↔ GLSL de la CI (decisiones 30, 57 y 166) |
| s0028   | `?abdomen=s0028`  | un TAC real (caso s0028), anatomía paralela por fases                                            | migración P0–P8 (decisión 317)                    |

`?reference=1` carga además el perfil corporal del adulto de referencia (`reference-body.bin`); la e2e de equivalencia lo
cubre con legacy. Tras P8, el corte sustituye el default por s0028 cuando pase la lista de relaciones del TAC (decisiones
317 y 322).

## Fases s0028

| Fase     | Qué entra                                                                 | Decisión          | Estado en main |
| -------- | ------------------------------------------------------------------------- | ----------------- | -------------- |
| P0       | fuente, lector directo B, piel y profundidad, presupuestos                | 317               | fusionada      |
| P1       | lector especializado por persona y mallas exactas precalculadas           | 318               | fusionada      |
| —        | mallas compactadas sin pérdida                                            | 319               | fusionada      |
| P2       | pared continua: regla directa, contacto por la piel y respiración sobre U | 320               | fusionada      |
| P3 r1–r2 | sólidos y compartimento posterior en CPU y Worker                         | 321 (en revisión) | fusionada      |
| P3 r3    | sólidos y posterior en la GPU                                             | 321 (en revisión) | fusionada      |
| P3 r4    | interior renal desde el propio TAC, offline (se instala en r5)            | 321 (en revisión) | fusionada      |
| P4–P6    | digestivo, gas y capas; redes vasculares del mismo hígado                 | —                 | pendientes     |
| P7–P8    | tórax y VCI–AD del caso; diez poses y adquisiciones, lista de relaciones  | —                 | pendientes     |

## Dónde se calcula

Tres implementaciones de la misma anatomía: TS en la página (medición, PW), TS en el Worker del corte y GLSL (imagen,
color). La regla «anatomía TS = GLSL» (`CLAUDE.md`, invariante 1) se comprueba con e2e que comparan la GPU con la CPU.

| Bloque                    | default                                                      | s0028                                                                          |
| ------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Clasificación de un punto | página, Worker y GLSL                                        | página, Worker y GLSL con los dueños de P3 (decisión 321)                      |
| Campos de los órganos     | atlas registrados en las tres                                | lector directo B en las tres; GLSL especializado por persona (decisión 318)    |
| Pared                     | capas con relieve y costillas (decisiones 62 y 88)           | pared continua de la regla directa en las tres (decisión 320)                  |
| Superficies 3D            | mallas del navegador sobre el mismo campo                    | mallas exactas precalculadas (decisiones 318 y 319)                            |
| Paridad en la CI          | `equivalence.spec.ts`, `abdominalAtlas.spec.ts` y regionales | `s0028WallGpu.spec.ts`, `s0028SolidsGpu.spec.ts`; CPU = Worker bit a bit (321) |

El default no cambia con s0028: la decisión 321 lo comprueba en 82.251 puntos, 10 marcos y 30 contactos idénticos a main
y en el hash de los programas GLSL; cada PR del programa estructural lo vuelve a demostrar (decisión 322).

## Qué es U en s0028

U es «desconocido»: el modelo no inventa tejido donde la fuente no lo dice.

- Celdas de la carta de pared sin anotación: la anotación v2 cubre el 90,98 % con D o E (decisión 320); el resto es U y
  el contacto acopla por la piel.
- Dos dueños independientes en un punto son conflicto: U, conservados en `solids`, sin precedencia (decisión 321). El
  solape hígado/pared de unos 11 mm³ sigue declarado como conflicto.
- Riñón: borde D (identidad y rótulo) e interior U en la aplicación hasta r5, que instala el rótulo offline de P3 r4.
- Gerota, cuadrado lumbar y diafragma posterior: U en P3; la grasa entra solo como «grasa compatible» D (decisión 321).
- La zona respaldada por pulmón (portal e intercostal altas) es pared torácica: se difiere a P7–P8.

## Presupuestos de la persona s0028

Todos los techos de la aplicación, con su fuente, están en `docs/estado/presupuestos.md`. Los de s0028:

<!-- presupuestos s0028: generado por tools/docs/estado.ts -->

Medido sobre main `bd2f575` el 2026-11-06 con `tools/docs/estado.ts`.

| Techo                                               |  Límite (B) |  Actual (B) | Margen (B) | Decisión |
| --------------------------------------------------- | ----------: | ----------: | ---------: | -------- |
| Descarga del paquete s0028 (gzip)                   |  25.000.000 |  20.433.526 |  4.566.474 | 318      |
| Cada `.gzip` fijado del paquete s0028 (por archivo) |  19.510.002 |   8.567.375 | 10.942.627 | 317      |
| Textura abdominal s0028 en memoria (RAW)            | 139.921.010 | 139.917.029 |       3981 | 317      |
| Textura torácica s0028 en memoria (RAW)             |  60.413.664 |  60.413.664 |          0 | 317      |
| `abdominal-direct.gzip.bin`                         |   8.567.375 |   8.567.375 |          0 | 317      |
| `annotation-capacity.gzip.bin`                      |     856.999 |     284.466 |    572.533 | 320      |
| `candidate-manifest.bin`                            |      38.617 |      38.309 |        308 | 321      |
| `skin-polar.gzip.bin`                               |     947.509 |     947.509 |          0 | 317      |
| `surfaces.gzip.bin`                                 |   9.672.026 |   5.340.216 |  4.331.810 | 318      |
| `thoracic-direct.gzip.bin`                          |   5.252.011 |   5.252.011 |          0 | 317      |

<!-- fin de presupuestos s0028 -->

Memoria: el criterio de trabajo es ≤ 2,0 GB de pico en Metal para toda la aplicación (decisión 318); con s0028 se midió
1,68–1,77 GB en P2 (decisión 320). P3 r3 lee la grasa de plazas ya reservadas del atlas (decisión 321).
