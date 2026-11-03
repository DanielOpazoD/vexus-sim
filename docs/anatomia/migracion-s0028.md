# Migración a s0028: cierre P0 y lector directo B

Objetivos 3, 7 y 8 de la misión: una persona coherente, capacidad medida y procedencia explícita.
**Estado vigente, decisión 317 provisional (02-11-2026): P0 prepara la primera PR; se acepta B y se abre P1 condicionada a capacidad real.**
Las menciones históricas a «316 provisional» corresponden al ensayo anterior; la 316 vigente de main trata la pared cava y se conserva íntegra.
Esta PR no modifica runtime, cargador, shaders del producto ni activos. Los TAC permanecen fuera de Git.
Los dictámenes de P0–P0e al final son historial anterior a las nuevas decisiones, con sus negativos íntegros.

## Qué se acepta y qué no acredita P0

El propietario decidió el 01-11 migrar `s0028` por bloques completos como anatomía paralela.
Default/atlas y legacy vigentes se conservan durante las fases. La activación y retirada de activos,
fixtures y código exclusivos viejos ocurren juntas en una PR final, tras las diez ventanas y las
14 relaciones de [relaciones TAC](relaciones-tac.md) revisadas sobre láminas del mismo plano físico.
No se injertan órganos de otro donante. Estómago lleno y grasa de pared son rasgos de esta persona.
El [plan original](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration/plan.md)
describe dependencias, tejidos, ventanas y retirada; las decisiones siguientes actualizan sus paradas.

B conserva 19 campos físicos RG16F de 1,5 mm y un alias lógico de gas: distancia R con filtrado
lineal y etiqueta G nearest. Gas usa bit 128, etiqueta digestiva mod128; no conserva SDF continuo
del gas. Se guardan todos los nodos/etiquetas fuente, origen y dimensiones, sin quitar órganos ni
recortar soporte para caber. Precisión ósea conserva los ocho nodos de `sourceDistancePrecise`.
Los veinte descriptores no equivalen a un clasificador funcional de veinte campos: el probe de
coste mantiene cuatro consultas legacy. P1 debe implementar y medir clasificación completa.

| Contabilidad de B                                   | Medida / decisión vigente                                                                                                                            |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Techo autorizado abdomen/tórax                      | **139.921.010 / 60.413.664 B**, antes 100.663.296 / 50.331.648 B (96/48 MiB)                                                                         |
| Texturas asignadas, padding y profundidad incluidos | 132.572.160 / 59.234.016 B; dimensiones 189×256×685 / 193×139×552                                                                                    |
| Piel CPU                                            | 1.024 rayos × 687 cortes a 0,75 mm, XY RG16F; 2.813.952 B RAW / 947.509 B gzip                                                                       |
| Reserva fija de anotación                           | 5.671.296 B RAW (4.491.648 abdomen + 1.179.648 tórax), **6.999 B gzip** vacía                                                                        |
| Manifiesto descargable del cierre                   | 35.130 B; descriptores nominales 960 B. Se retiran duplicados de offsets/informe, tiempos y hash de ejecución, conservados en `packing.json` externo |
| Residente contabilizado del cierre                  | **139.913.850 / 60.413.664 B**, márgenes 7.160 / 0 B; el techo autorizado sigue siendo el de la primera fila                                         |
| Descarga medida del cierre                          | **14.809.024 / 19.510.002 B**, margen **4.700.978 B**; campos gzip + piel gzip + reserva gzip + manifiesto                                           |
| Antes de comprimir la reserva (P0e)                 | 20.480.481 B; excedía en 970.479 B. Cambiar memoria no resolvía ese fallo                                                                            |
| Tres copias residentes de referencia                | 3×(139.921.010+60.413.664) = 601.004.022 B (~601 MB), frente a 3×112.228.544 = 336.685.632 B (~337 MB) de campos actuales; no es pico medido         |

**El techo del cargador no cambia en P0. P1 lo cambia al cargar** y mide pico real, incluidos
heap, copia Worker, GPU, descompresión, staging, superficies y cancelación. Si navegador o
SwiftShader de CI no lo soportan con los plazos actuales, se detiene P1. B excede el mínimo
WebGL de dimensión 256; el dispositivo observado permitía 2.048, sin prometer soporte universal.
No se cargan simultáneamente dos personas ni se transfieren buffers dejando sin copia a CPU.

**Descarga — decisión de implementación declarada en este cierre:** contar los bytes realmente
transmitidos. La reserva vacía viaja gzip; la residencia cuenta sus 5.671.296 B RAW. Cada fase
que la llene mide su gzip real, incluye todos los archivos/manifiesto y se detiene si supera
19.510.002 B. No se aumenta el límite, ni se acredita con ceros el coste futuro de anotaciones.
El manifiesto nuevo incluye la procedencia por campo y omite diagnósticos duplicados/de ejecución; eso explica que el total sea 14.809.024 B y no sólo
20.480.481−5.671.296+6.999 = 14.816.184 B. Los binarios de los atlas no cambian en este cierre.

**Piel:** D se mantiene en Z [−210;+60] mm y φ completo periódico, con contrato muestreado
p95 ≤1,5 mm y máximo ≤3 mm, salvo el detalle local aproximado aceptado del **ombligo**:
3,140913 mm, LAS [−0,927874;111,974688;−164,613793]. Se conserva también el diagnóstico fino
3,314219 mm; no se eleva el máximo general de D ni se llama Hausdorff continuo al muestreo.
Pelvis/ingle fuera de D siguen aproximadas; no se restringe movimiento. P1/P2 deben conservar
continuidad y la advertencia exterior prevista, todavía ausente del producto.

**Profundidad bajo piel:** exacta según las tolerancias donde hay TAC, no exactitud matemática
subvoxel. El auxiliar EDT R16F de 3 mm está en el atlas abdominal: una lectura lineal, seis para
gradiente, cero samplers nuevos; no reemplaza los campos de 1,5 mm. Fuera de la rejilla TAC,
a ≥12 mm fuera de la piel, en aire y sin consumidor, es **desconocida, no aprobada**. La falta
de referencia no demuestra aire: se conservan caras cortadas y contadores de referencias
faltantes. P1 debe acreditar todo consumidor, interior y envolvente exterior de 6 mm; no se
extiende la excepción a esa envolvente ni se transforma ausencia de referencia en error cero.

## Secuencia y paradas de P1

| Fase                   | Resultado exigido antes de continuar                                                                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0, esta PR            | Fuente/manifiesto, B reproducible, piel/profundidad P0e, capacidad, coste de B y contratos sintéticos sin TAC en CI                                                                                             |
| P1                     | Selector/carga excluyente y corrupta/cancelable, identidad CPU/GPU/Worker, techo nuevo al cargar, pico real y primer cuadro completo Metal/SwiftShader; detener si capacidad, paridad, tiempos o shaders fallan |
| P1, superficies y piel | Generar cero común por bloques en Worker sin tareas principales ≥50 ms, sin truncar mallas; revalidar EDT, gradiente, contacto/pared y consumidores fuera de CT; continuidad al cruzar D                        |
| P2/P3                  | Piel/pared/esqueleto y sólidos con vecinos renales/posteriores; resolver conflictos fuente, sin precedencia para ocultarlos                                                                                     |
| P4/P5/P6               | Digestivo/gas/capas y redes vasculares/raíces del mismo hígado; conservar fisiología y negativos PW                                                                                                             |
| P7/P8                  | Tórax/VCI–AD del caso y diez poses/adquisiciones; láminas y lista de 14 relaciones aceptadas                                                                                                                    |
| Corte final            | Activar y retirar activos/código/fixtures exclusivos viejos en una sola PR, con CI completa                                                                                                                     |

Todos los techos de `shaderLimits.test.ts`, 16 samplers y 179 slots se mantienen. El B completo
de coste P0e pasó 8/8 estáticos (tabla histórica íntegra más abajo); primer cuadro micro SwiftShader
con ambos atlas y GL=0 no acredita arranque/JIT del programa completo. La reproducción tras rebase
vuelve a medir los ocho sobre los shaders actuales; resultados en la evidencia del cierre.
Coste completo reproducido sobre `origin/main` `27b6cf1`, con helpers y techos intactos:

| Programa           | B tokens/ramas  | Samplers | Slots | Resultado |
| ------------------ | --------------- | -------- | ----- | --------- |
| RAWFIELD           | 1.213.807/9.799 | 10       | 136   | pasa      |
| RAWFIELD_ECHO      | 506.183/4.103   | 16       | 137   | pasa      |
| RAWFIELD_CLASS     | 399.722/3.392   | 10       | 136   | pasa      |
| RAWFIELD_ELEVATION | 399.862/3.394   | 15       | 137   | pasa      |
| RAWFIELD_GRADIENT  | 291.770/2.362   | 15       | 138   | pasa      |
| TRANS_HITS         | 449.312/3.985   | 6        | 101   | pasa      |
| TRANS_HITS_GRID    | 223.543/1.980   | 11       | 102   | pasa      |
| COLOR              | 223.599/1.954   | 7        | 110   | pasa      |

Estimación de ingeniería P1→corte: 196–336 h, más 12–24 h del propietario, sin espera de CI.
No son plazos medidos ni fases ya implementadas. No hay validación clínica.

## Herramientas mantenidas, archivo y reproducción

En `tools/anatomy/` se mantienen `s0028-case.json`, `s0028-source.py` y su contrato;
`s0028-direct.py` y su contrato; `s0028-capacity.py`; `s0028-p0e-package.py`,
`s0028-p0e-domain.py` y contrato `s0028-p0e_test.py`; `s0028-skin.py` sólo compara huellas;
`s0028-measure.py` sólo prepara referencia corporal/huellas; `s0028-audit.ts` sólo exporta los
planos comparadores; `s0028-contract.ts` valida descriptores; `s0028-direct-cost.ts` mide B con
los helpers exactos del guardián. `run-tests.py` ejecuta contratos aislados.
El perfil auxiliar histórico 14×65 se conserva únicamente para congelar huellas P0, no como
piel del candidato. La reserva fija se extrae de compacto sin conservar el empaquetador rechazado.
Ninguna herramienta de candidato rechazado es necesaria para los contratos conservados.

Salen 14 archivos: `s0028-{compact.py,compact_test.py,cost.ts,boxes.cpp,correspondence.py,
correspondence.cpp,domain.py,map.ts,sparse.py,sparse_test.py,split.py,split_test.py,
split-cost.ts,split-package.py}`. Los contratos exclusivos de formatos rechazados se archivan;
gas/directo, capacidad, periodicidad y desconocidos se conservan en los contratos de B.
Mapa/superficies quedan como experimentos externos para P1, sin elegir una implementación en P0.
Originales de `e788905` (29 archivos), con SHA256 por archivo, están en el
[manifiesto de archivo](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p0-close/archive-e788905/manifest.json)
(SHA256 `a25526df0f4474b4d144d6d7bfb25b133b2bdca472e30dcbe95f8279456f0759`).
Los informes enlazados de P0–P0e conservan todas sus cifras y negativos. El
[informe del cierre](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p0-close/report.md)
registra SHA, diff, códigos y límites de la verificación actual.

Reproducción offline nueva, salidas en un directorio externo vacío; Node 24 vía wrapper,
Python aislado con las dependencias fijadas en `paired-renal-review-requirements.txt`.
`PY` es el ejecutable de ese entorno; `CT` contiene `ct.nii.gz` y `segmentations/`; `E` es salida
externa. No ejecutar sobre las carpetas históricas de evidencia:

```sh
./tools/workspace/run.sh "$PY" -I tools/anatomy/s0028-source.py inventory --case-dir "$CT" --out "$E/independent"
./tools/workspace/run.sh "$PY" -I tools/anatomy/s0028-source.py export --case-dir "$CT" --out "$E/source"
./tools/workspace/run.sh "$PY" -I tools/anatomy/s0028-source.py verify --case-dir "$CT" --out "$E/source"
./tools/workspace/run.sh "$PY" -I tools/anatomy/s0028-measure.py --out "$E/source"
./tools/workspace/run.sh node --import tsx tools/anatomy/s0028-audit.ts "$E/model"
./tools/workspace/run.sh "$PY" -I tools/anatomy/s0028-direct.py --source "$E/source" --out "$E/direct"
./tools/workspace/run.sh "$PY" -I tools/anatomy/s0028-p0e-domain.py --source "$E/source" --model "$E/model" --out "$E/domain"
./tools/workspace/run.sh "$PY" -I tools/anatomy/s0028-capacity.py --out "$E/capacity"
./tools/workspace/run.sh "$PY" -I tools/anatomy/s0028-p0e-package.py --source "$E/source" --original "$E/direct" --domain "$E/domain" --capacity-dir "$E/capacity" --out "$E/B"
./tools/workspace/run.sh node --import tsx tools/anatomy/s0028-direct-cost.ts "$E/B"
./tools/workspace/run.sh "$PY" -I tools/anatomy/run-tests.py tools/anatomy/s0028-source_test.py tools/anatomy/s0028-direct_test.py tools/anatomy/s0028-p0e_test.py
```

Los nuevos contratos Python de fuente/directo/P0e corren en `renal-reference.yml` con fixtures
sintéticos, sin CT, CGAL, C++ ni red durante las pruebas. Los contratos TS de fuente y coste B
entran en la CI general. El workflow conserva Node porque el contrato vascular previo ejecuta TS.
Los checks locales no acreditan una CI remota; el cierre no publica ni abre PR.

Tras la revisión de PR327, los contratos sintéticos rechazan trasladar 100 mm los veinte
campos junto al inventario, auxiliares de otro hash corporal o marco y atlas con 1 MiB RAW
añadido o hashes RAW/gzip alterados. La verificación de origen usa el affine del TAC y la
transformación del manifiesto; piel y EDT se contrastan con `body-source.npz` verificado.
`s0028-p0e-package.py` exige `--source` también al empaquetar sin `--original`, reabre ambos
atlas y contabiliza sus tamaños RAW reales. La reproducción desde TAC conserva los dos
hashes de atlas, el manifiesto byte por byte y las cifras de cierre de la tabla anterior.
El descubrimiento Python global falla sin CGAL en `diaphragm_source_repair_test.py`,
`diaphragm_relationships_test.py` y `posterior_source_test.py`; las tres pasan en el entorno
local con CGAL. Las dos primeras corren en `thoracic-source.yml`, que instala su versión
fijada con Python 3.12. `posterior_source_test.py` no aparece en los workflows actuales.

## Fuente y cobertura de los 42 tejidos

El manifiesto `tools/anatomy/s0028-case.json` fija CT y las 117 máscaras por SHA256, rejilla,
affine, unidades y persona. TotalSegmentator v3, Jakob Wasserthal / University Hospital Basel,
[DOI 10.5281/zenodo.22688904](https://doi.org/10.5281/zenodo.22688904), CC BY 4.0.
El header no declara unidades espaciales: la procedencia del release y el affine isotrópico de
1,5 mm son la evidencia de milímetros, no una unidad inferida del tamaño de un órgano.
Se aplica una única reflexión RAS→LAS y traslación
`[-3.04777431275115,-148.65228450019774,-390.98879268882285]` mm de `audit`.
Sin registro por órgano ni refit lumbar. No se usa geometría de s0440 ni BodyParts3D para rellenar.
El modelo vigente sólo se exporta como comparador en el mismo plano físico.

O = observado en máscara/TAC; D = derivado; E = estimación explícita sobre este individuo;
U = desconocido. Una etiqueta de órgano exterior no identifica su histología ni un material acústico.

|  ID | Tissue                | Fuente y estado P0                                    | Soporte o reserva medida                                                      |
| --: | --------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------- |
|   0 | Air                   | D: exterior del cuerpo; gas interno separado          | contorno cerrado / digestiveGas                                               |
|   1 | Skin                  | D: frontera corporal CT; espesor E                    | contorno nativo ensayado, frontera sin instalar                               |
|   2 | Fat                   | D: HU compatible; pertenencia U hasta anotación       | 8 fronteras locales, pertenencia por anotar                                   |
|   3 | Muscle                | O: autóctono; pared D/E pendiente, HU no da identidad | posteriorMuscle + fronteras locales                                           |
|   4 | Liver                 | O: liver                                              | liver                                                                         |
|   5 | LiverCapsule          | D/E: offset fino contenido del exterior               | etiqueta/offset reservado en liver                                            |
|   6 | Blood                 | O: aorta/VCI/porta-esplénica; ramas y cámaras E/U     | 3 campos independientes + 102 tubos/512 nodos                                 |
|   7 | VesselWallPortal      | E: pared sobre eje y radio del mismo caso             | tubos paramétricos                                                            |
|   8 | VesselWallThin        | E: paredes venosas; ostios pendientes                 | tubos paramétricos                                                            |
|   9 | Diaphragm             | U: requiere cúpula y hiatos anotados; grosor E        | pool indexado torácico, hiatos por anotar                                     |
|  10 | Lung                  | O: cinco lóbulos                                      | lung, sin descartar lóbulos para caber                                        |
|  11 | Bone                  | O: costillas/esternón/hip/sacro                       | thoracicBone, lumbarSacralBone, sacrum                                        |
|  12 | Bowel                 | O: stomach/duodenum/small_bowel/colon; subclase U     | digestiveTract; no colon entero como ciego                                    |
|  13 | BowelGas              | D: HU < −500 dentro de máscaras digestivas            | digestiveGas; componentes conservados                                         |
|  14 | Fluid                 | O: contornos vejiga/vesícula/quistes; luz D/E         | bladder/gallbladder/renalCysts                                                |
|  15 | ArteryWall            | E: pared sobre arterias del caso                      | tubos paramétricos                                                            |
|  16 | Cartilage             | O: costal_cartilages; contactos pendientes            | cartilage independiente del hueso                                             |
|  17 | RenalCortex           | O exterior renal, partición interna E/U               | kidneyRight/Left, etiquetas contenidas                                        |
|  18 | RenalMedulla          | E/U: pirámides no segmentadas                         | etiquetas internas en campos renales                                          |
|  19 | RenalSinus            | U: hilio/seno por anotar                              | etiquetas internas en campos renales                                          |
|  20 | PerirenalFat          | U: fascia/envoltura por revisar, HU insuficiente      | fronteras locales + pool indexado abdominal                                   |
|  21 | BileDuctWall          | E/U: continuidad desde hilio/vesícula pendiente       | cuatro conductos dentro de reserva 102 tubos                                  |
|  22 | Vertebra              | O: vértebras fuente; discos E/U                       | lumbarSacralBone/thoracicBone + pool indexado                                 |
|  23 | LigamentumTeres       | E/U: hitos de fisura por anotar                       | soporte liver, geometría paramétrica reservada                                |
|  24 | LigamentumVenosum     | E/U: fisura/raíz por anotar                           | soporte liver, geometría paramétrica reservada                                |
|  25 | RenalCapsule          | D/E: offset contenido, no espesor observado           | campo renal, sin otro volumen                                                 |
|  26 | RenalPelvis           | U: pelvis/luz por anotar                              | etiquetas internas en campos renales                                          |
|  27 | Psoas                 | O iliopsoas, psoas aislado U                          | posteriorMuscle, separación por anotar                                        |
|  28 | QuadratusLumborum     | U: no equivale a autóctono                            | fronteras locales + pool indexado abdominal, contornos bilaterales pendientes |
|  29 | RetroperitonealFat    | U: pertenencia anatómica por revisar                  | fronteras locales + pool indexado abdominal                                   |
|  30 | Myocardium            | O envolvente heart; cámaras/tabiques E/U              | heart; no convertir heart entero en Blood                                     |
|  31 | Mediastinum           | U: anotación local/pericardio; continuación E         | pool indexado torácico + etiquetas heart                                      |
|  32 | MesentericFat         | U: grasa intraperitoneal por delimitar                | fronteras locales + pool indexado abdominal                                   |
|  33 | Pancreas              | O: pancreas                                           | pancreas                                                                      |
|  34 | Spleen                | O: spleen                                             | spleen                                                                        |
|  35 | GutSubmucosa          | E: histología subvoxel contenida                      | etiquetas/offsets digestiveTract                                              |
|  36 | GutMuscularis         | E: histología subvoxel contenida                      | etiquetas/offsets digestiveTract                                              |
|  37 | SoftCapsule           | D/E: serosas contenidas                               | offsets pancreas/spleen/gallbladder                                           |
|  38 | BladderWall           | D/E: pared interna de vejiga/vesícula                 | offsets bladder/gallbladder                                                   |
|  39 | UnsegmentedSoftTissue | U: residual sin identidad                             | contorno; d=16 no significa grasa                                             |
|  40 | ColonicContents       | O contorno colon; contenido/capas E/U                 | digestiveTract; no se transforma en Fluid                                     |
|  41 | GastricContents       | O estómago lleno; contenido/capas E/U                 | digestiveTract; conservar distensión y gas fuente                             |

Las etiquetas de campo son identidades fuente, **no los IDs Tissue de esta tabla**. No se instala
un clasificador que convierta automáticamente estos proxies en tejidos acústicos. La acústica
vigente no se deriva de HU. Las 117 máscaras se inventarían incluso si están vacías o fuera de
los campos útiles; la lista de máscaras incluidas en cada campo queda en el manifiesto.

## Historial P0 y P0b: denso y paginado rechazados

[Evidencia P0](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p0/report.md),
[evidencia P0b](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p0b/report.md).
Las cifras y dictámenes siguientes corresponden a esas rondas, anteriores a la decisión 317.

P0 ensayó un atlas denso con soportes volumétricos conservadores y perfil 14×65 C1. Falló:
438.524.928/83.693.568 B de campos residentes y máximo cutáneo bidireccional 24,355 mm.
P0b conserva esa evidencia y cambia la representación, con protocolo y enmienda de contorno
fijados antes de medir. El cambio de regla proviene del propietario: **19.510.002 B totales**
redistribuibles, los bytes reales retirables; 96/48 MiB residentes se conservan. No se modifican
`tools/ci/bundle-budget.ts`, runtime ni activos. La decisión 316 sigue siendo provisional.

**Dictamen P0b: cabe en bytes, pero NO admite P1: la piel falla entre cortes y la sustitución
directa del lector paginado excede los techos estáticos de shader.** No es validación clínica.

| Paquete real, reabierto y decodificado                        |              B |        Cuota B |      Margen B |
| ------------------------------------------------------------- | -------------: | -------------: | ------------: |
| Campos abdomen gzip                                           |      6.246.334 |      7.000.000 |       753.666 |
| Campos tórax gzip                                             |      4.778.412 |      5.000.000 |       221.588 |
| Capacidad de anotación sin comprimir                          |      5.671.296 |      6.500.000 |       828.704 |
| Piel gzip                                                     |        874.211 |      1.000.000 |       125.789 |
| Manifiesto                                                    |          1.043 |         10.002 |         8.959 |
| **Total**                                                     | **17.571.296** | **19.510.002** | **1.938.706** |
| Abdomen residente, incluidos capacidad/piel/header/manifiesto |     47.058.757 |    100.663.296 |    53.604.539 |
| Tórax residente, incluida capacidad/header                    |     29.753.344 |     50.331.648 |    20.578.304 |

Los 20 campos fuente/gas se recuperan bit a bit, con orígenes, etiquetas y dimensiones exactos;
sin recorte de dominio, pitch 1,5 mm ni máscara visible retirada. Overlaps independientes y gas
se conservan. Páginas 4³: constantes inline, resto pool RG16UI de bits half, tabla uint32 y
header JSON embebidos. Texturas asignadas completas 256×256×157 y 256×256×109, incluido padding.
Esto cabe bajo dimensión 256; **no demuestra ejecución GPU mínima**. El atlas vigente tiene
338×217×280 y rechaza GPU insuficiente; no se le atribuye compatibilidad universal con 256.

Se sustituyen los proxies volumétricos de pared/discos/cúpula por capacidad materializada:
ocho fronteras uint16+identidad por 256 muestras y 344 cortes, mallas indexadas arbitrarias
abdomen 65.536 vértices/131.072 triángulos y tórax 32.768/65.536, más 102 tubos/512 nodos.
Su tamaño RAW es invariable al llenarlo: no se acredita compresión de ceros. Los huecos son U;
no hay anotación anatómica, ni garantía de que anotaciones futuras quepan. Cápsulas y capas
subvoxel serán leyes/offsets contenidos; grasa sólo con pertenencia anotada. El contorno no
radial cambia el significado de φ y obliga a migrar poses, marcos y normales juntos.

Piel: contorno cerrado de 1.024 puntos XY uint16 a 1/16 mm, 344 cortes nativos de −395,989 a
118,511 mm; origen común explícito, interpolación lineal periódica de arco y Z. Sin alisar,
convexificar ni borrar pliegues/brazos conectados. El radial de 512 radios se conserva rechazado
(max 10,663 mm). Barrido independiente final de 1.024 con fase 0,37 y huellas P0 congeladas:

| Dirección                      | p95 / máximo mm | Cotas 1,5 / 3 mm |
| ------------------------------ | --------------: | ---------------- |
| Piel → contorno, Z nativa      |   0,491 / 0,591 | pasa             |
| Contorno → piel, Z nativa      |   0,683 / 0,748 | pasa             |
| Piel nativa → contorno medio Z |   0,992 / 4,338 | FALLA            |
| Contorno medio Z → piel nativa |   1,101 / 6,333 | FALLA            |

El barrido 256 da 1,772/2,305 mm piel→contorno y 0,677/0,742 inverso: evidencia de convergencia,
no un gate alternativo elegido después. Las diez ventanas pasan ambas direcciones y medio Z;
el detalle por ventana está en `candidate-contour/skin-error.json` y el informe externo.
Distancias a superficies muestreadas, no Hausdorff continuo; comparar medio Z con fuente nativa
introduce hasta 0,75 mm de incertidumbre Z, insuficiente para aprobar 6,333 mm. El máximo P0 de
24,355 mm está en LAS [−78,485;52,535;−347,989], región inguinal, fuera de las diez ventanas,
sin húmero/escápula en el corte. **Los hombros/brazos conectados no explican ese máximo.** El
fallo nuevo está en [−41,895;81,311;−368,239], también inguinal; la correspondencia por arco entre
cortes sigue pendiente. No se presenta una hipótesis de torsión como causalidad ya demostrada.

Coste trasladado a P1: `s0028-cost.ts` usa los helpers exactos de `shaderLimits.test.ts` sobre
un lector aislado y todos los programas con anatomía. Ocho esquinas requieren ocho lecturas de
tabla y hasta ocho de pool: **hasta 16 texelFetch, sin descriptores**. RAWFIELD pasa de
1.259.657/10.072 tokens/ramas a 2.515.019/19.298 (techo 1.385.000/11.060); COLOR de
226.110/1.975 a 534.720/4.243 (248.000/2.160). Los ocho programas acotados exceden ambos
techos. Es una estimación estática de esta sustitución directa, no una imposibilidad de todo
lector ni una compilación GPU. El probe reutiliza descriptores legacy como argumentos y omite
el coste de realizar los JSON del paquete en descriptores GPU, piel y clasificación nueva.
No se instala ni se considera funcional el GLSL experimental completo.

Primera puerta P1: detenerse antes de anotación fina hasta que un lector completo conserve los
bits/cero/nearest, materialice y cuente descriptores GPU, pase **todos** los techos vigentes,
16 samplers/179 slots/256 de dimensión y primer cuadro Metal/SwiftShader bajo plazos actuales,
con CPU/GPU/Worker y negativos de corrupción/carga. No aumentar los techos para aceptar.

Las superficies se regeneran offline del cero de los campos decodificados, sin smoothing,
decimación ni descarga redundante. `surfaces-native` evita las copias proxy renales del arnés P0.
El coste Node observado es 57,129 s abdomen + 25,635 s tórax, incluida compresión por campo;
1.826.756 triángulos y 65.763.216 B de posiciones. El máximo de arrays transitorios explícitos
es 1.871.051.392 B en posteriorMuscle (rejilla cúbica de MarchingCubes), antes de GC/driver.
No es latencia del navegador ni memoria residente de campos. Detalle en `decoded/*-surface.json`. Segunda puerta P1: generación en Worker/cancelable,
por bloques sin la allocación cúbica observada (moverla a Worker no basta), progreso de UI y
cambio de persona/carga corrupta probados, sin tareas de generación en el hilo
principal ≥50 ms, sin truncar mallas y con pico CPU/Worker/GPU contado por separado de campos.
La continuidad de la interfaz y la paridad del cero no están demostradas en P0b.

Horas **estimadas**, sin espera de CI/revisión y condicionadas a las puertas: antes de P1,
8–16 h para rediseñar correspondencia axial de piel sin aflojar cotas. P1 40–72 h (carga 12–20,
lector/shader 16–32, superficies/Worker 12–20); P2 28–44; P3 24–40; P4 20–36; P5 16–28;
P6 16–28; P7 20–36; P8 20–32; corte 12–20. **P1 en adelante: 196–336 h**, más 8–16 h
previas y 12–24 h del propietario. Ninguna fase posterior está implementada por este informe.

La reproducción histórica de candidatos rechazados usa las copias con hash del
[archivo externo](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p0-close/archive-e788905/manifest.json),
no herramientas mantenidas en el producto. Los comandos originales están en el informe de cada ronda.

El arnés `run-tests.py` limpia argv antes de unittest; el fallo anterior de todas las suites no
probaba sus contratos. Localmente el entorno CGAL existente usa Python 3.12, numpy 2.3.5,
scipy 1.17.0, nibabel 5.4.2 y CGAL 6.0.1.post202410241521; el entorno CT/figuras usa Python 3.14.
CI sólo añade los dos contratos s0028 sin pacientes al workflow existente. No se afirma ejecución
CI de este checkout. R1 pertenece a P0; **R2 no tiene resultado y no se cita como realizada**.
Esta reanudación no solicita otra revisión independiente por instrucción explícita del propietario.

## Historial P0c: directo frente a paginado

[Evidencia P0c](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p0c/report.md).

**No admite P1:** el lector directo sí cabe en los ocho techos estáticos, pero los ladrillos
nativos completos no caben en memoria y el nuevo ensayo axial mantiene el fallo cutáneo.
Informe y protocolo prefijado:
`/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p0c/report.md`.
No cambia runtime, activos, presupuestos ni tolerancias. No es validación clínica.

Los veinte campos se conservan a 1,5 mm; gas pasa a un bit nearest del digestivo, con sus
23.595 vóxeles y 155 componentes recuperados exactamente. Su SDF continuo deja de almacenarse:
no se afirma equivalencia de esa distancia. Se recuperan los diecinueve ladrillos físicos del
atlas guardado; cada descriptor distingue hash fuente de hash almacenado. No hay caras enteras
de soporte con todos los nodos R=16 que puedan retirarse sin modificar la banda existente.

La descarga real, capacidad sin comprimir incluida, mide **19.256.357 / 19.510.002 B**. Las
texturas son 189×256×619 y 193×139×552: 119.798.784 y 59.234.016 B. Con piel/capacidad/tablas y
manifiesto, residentes contabilizados: **127.135.205 / 100.663.296 B** abdomen y
**60.413.664 / 50.331.648 B** tórax. No son picos del navegador.

Para cuatro ladrillos torácicos, `s0028-boxes.cpp` enumera seis separaciones por cada par y
las seis permutaciones de cada ladrillo: 60.466.176 asignaciones, sin límite de dimensiones.
Incluso quitando las guardas, el mínimo es **54.616.684 B** (193×263×269), antes de capacidad;
con ella excede 48 MiB en **5.464.684 B**. Es una refutación para esos cuatro ladrillos
rectangulares completos, no para todo formato directo: dividirlos y duplicar un halo para
filtrado sería otra representación que requiere medir sus descriptores/lector. No se relajan cuotas.

`s0028-direct-cost.ts` conserva el selector actual de cuatro consultas y materializa veinte
filas LO/DIM/OFF. Los ocho programas pasan los helpers y techos intactos de `shaderLimits.test.ts`;
CLASS: **425.994/3.492 tokens/ramas** frente a **455.000/3.830**. El lector habitual mantiene
una muestra filtrada de R y un `texelFetch` nearest de G; cerca del hueso suma ocho nodos de
precisión como hoy. El gas añade una consulta nearest al clasificar digestivo. No hay bucle de
veinte campos. El clasificador aún es el vigente: el slot de discos alias sacrum sólo sirve al
ensayo de coste, no es anatomía aceptada. No incluye nueva piel ni anotaciones.

El microprograma aislado de lectura con la textura real dibuja en Chromium x64/Rosetta y
SwiftShader: 0,681 s base frente a 0,787 s candidato desde fetch hasta primer cuadro, una
observación por fuente. No mide el JIT de los ocho programas ni el arranque del pipeline completo.

La correspondencia axial DTW monótona conserva entrantes, pero se rechaza: máximo de medio Z
**6,751 mm**, frente a 6,333 mm P0b; las diez huellas pasan. La envolvente Z de las huellas
[−157,6; −20] mm pasa con máximo 1,826 mm a medio Z. Fuera hay fallos también a Z≈−164 mm,
además del pliegue inguinal. Esa envolvente no sustituye el dominio autorizado. Las coordenadas
por intervalo tampoco son todavía una φ global continua para `probeFrame`.

El mapa 3D nativo puede extraerse por bloques de 32³ celdas sin las rejillas cúbicas auxiliares:
**1.826.756 triángulos**, distancias entre vértices frente a P0b ≤0,000034 mm, arrays explícitos
máximos **57.755.856 B**, 11,897 s Node incluyendo indexación/gzip. Fue la alternativa offline preferida para estudiar P1,
sin descarga de mallas; falta Worker/UI/pico real. Hay bloques de hasta 134,468 ms: no se ejecutará
en principal. Las mallas precalculadas nativas añaden 9.596.294 B gzip y exceden la cuota total.
A 3 mm sólo para el mapa, bajan a 449.508 triángulos/2.531.979 B gzip, pero desaparecen componentes
finos de gas; se conserva el negativo y se prefiere el cero nativo por bloques. Campos ecográficos intactos.

El informe externo contiene piel por ventana, ocho programas, coste de `torsoSkinPoint`,
`torsoDepth` y `probeFrame`, láminas abiertas, horas condicionadas y códigos reales de cierre.
Sólo commit local con el trailer indicado; sin revisión delegada por instrucción expresa.

## Historial P0d: división con halo, dominio cutáneo y profundidad

[Evidencia P0d](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p0d/report.md).

**No admite P1.** Base `655e936`; protocolo previo e informe completos en
`/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p0d/`.
El dominio fijado antes de medir es **Z [−210; +60] mm y φ completo periódico**:
52,4 mm caudales y 80 mm craneales de margen sobre las diez huellas congeladas.
La sonda libre puede rodear el tronco; no se reduce el dominio al sector de las tarjetas.
No cambia runtime, activos, cuotas, techos ni tolerancias. No es validación clínica.

`s0028-split.py` divide cada campo físico exclusivamente en Z, a 64 celdas más su nodo
compartido positivo. Conserva los diecinueve RG16F a 1,5 mm y el vigésimo campo lógico de gas
como bit nearest; los nodos y halos se recuperan exactamente. Las 49 filas físicas se eligen
mediante base + floor(z/64), sin recorrido de subladrillos ni lecturas de tabla en textura.
Las muestras CPU a ambos lados de todas las costuras conservan R y G. No se acredita todavía
paridad completa GPU/CPU/Worker ni el clasificador nuevo de veinte campos.

El packing heurístico prefijado deja 20.079.380 B de huecos abdominales y 8.847.004 B torácicos;
no demuestra un mínimo global. Texturas completas: 111.919.104 y 56.014.776 B. Incluyendo
capacidad original, piel, SDF, manifiesto y tablas, residentes contabilizados:
**119.617.863 / 100.663.296 B** abdomen y **57.194.424 / 50.331.648 B** tórax.
Con el mismo halo y reservas, los huecos tendrían que bajar a ≤1.124.813 y ≤1.984.228 B.
La descarga completa real es **19.614.340 / 19.510.002 B**, exceso **104.338 B**.
Son cuotas de representación, no picos medidos de heap/Worker/driver ni residencia duplicada.

`s0028-domain.py` construye piel RG16F XY, 512 ángulos por corte nativo, φ global continua,
704.512 B raw / 290.715 B gzip. Las diez huellas pasan nativo y cuartos de Z en ambas direcciones.
El dominio completo falla a medio Z: p95 1,054 mm, máximo **3,425 mm**, testigo
LAS [−0,9295; 112,2530; −164,2388]. Está dentro del margen aprobado; no se recorta para aprobar.
Pelvis/ingle continúan aproximadas. La futura UI debe permitir cruzar el borde sin salto de
piel y mostrar «Fuera de la zona de exploración verificada. Piel aproximada en pelvis e ingle;
no usar para valorar anatomía». **La app vigente no incorpora ese mensaje ni este candidato**.

El SDF corporal R16F de 3 mm, separado de los veinte campos de 1,5 mm, mide 143×89×96:
2.443.584 B raw / 1.398.721 B gzip. Dentro de caja, el error frente a EDT nativa es ≤1,439 mm
para los desplazamientos prefijados. La caja tiene 6 mm de margen, insuficiente para todos los
puntos exteriores: el fallback radial alcanza **25,321 mm** de error a +30 mm y se rechaza.
No se confunde error de discretización del SDF con precisión del lector combinado. Cambia además
la métrica radial histórica de pared por EDT aproximada; su integración requeriría revalidación.

`s0028-split-cost.ts` usa helpers y ocho techos exactos de `shaderLimits.test.ts`. Sólo split+gas
pasa tres de ocho; con profundidad/gradiente/fallback ninguno pasa tokens. CLASS:
**481.336/3.512** frente a **455.000/3.830**. Samplers completos: 12/18/12/17/17/8/13/9;
ECHO ya llegaría a 17 sólo añadiendo el sampler de profundidad. El fallback requiere otro de
piel; los tres programas >16 no se aprueban porque el backend observado permita 32.
Slots declarados 101–138; las tablas son const, no arrays uniform añadidos.
Lectura habitual de campo: una lineal + una nearest, ocho nodos extra de precisión ósea;
gas añade una nearest. Profundidad interior: una lineal; gradiente: seis. Fallback de piel:
seis fetches por profundidad (dos de centro Y y cuatro de XY), hasta 36 extra por gradiente.
`probeFrame` conserva cinco consultas CPU de cuatro nodos, sin ida/vuelta GPU.

El microshader con textura abdominal, SDF y piel reales dibuja en Chromium x64 bajo Rosetta,
SwiftShader, GL=0/contexto conservado: fetch→cuadro 0,449 s base / 0,743 s candidato, una
observación por fuente. No es arranque del producto ni JIT de los ocho programas completos.
El primer compile descubrió un origen negativo sin paréntesis; negativo y corrección del arnés
se conservan. El informe registra también el comparador CPU exterior inicialmente incorrecto
(clamp en vez de fallback), su enmienda y el resultado adverso real, sin cambiar formato ni dominio.

En esa ronda se versionaron herramientas y contratos; ahora los rechazados están archivados con hash, junto a la evidencia y el arnés GPU.
Las láminas muestran el testigo cutáneo contra el TAC de la misma persona y los límites de
profundidad. No se modifica el mapa nativo por bloques elegido en P0c. P1 en adelante mantiene
**196–336 h** estimadas, más **16–32 h** previas de rediseño por estas fronteras y 12–24 h del
propietario; no hay garantía de viabilidad ni fases posteriores entregadas. Códigos de cierre,
SHA/trailer, estado y evidencia <1 GB se acreditan en el informe y recibo de esta ronda.

## Historial P0e antes de las decisiones del propietario: A y B medidos

[Evidencia P0e](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p0e/report.md).
El bloqueo histórico se levanta en la decisión 317 con las condiciones del inicio de este documento;
los fallos medidos siguen conservados y no pasan a ser resultados aprobados.

**No admite P1, ni con A16 ni con B directo.** A falla memoria torácica, descarga y los ocho
shaders completos. B pasa los ocho shaders y samplers, pero falla descarga; ambos conservan
el fallo cutáneo de D y la cobertura exterior de profundidad sin acreditar. No es validación clínica.
Base local `3c485774f7a7de7b7765ac6e3648a9a2a9edbfe6`; SHA final y cierre en el recibo externo.
Protocolo anterior a los ensayos y evidencia nueva:
`/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p0e/`.
No se cambian runtime, activos, 5174, techos de shader, pitch de 1,5 mm, soporte ni estructuras.

A ensayó 16/24/32 celdas cúbicas con halo positivo de un nodo, tabla de dos texeles RG16F
por región en el mismo atlas y constantes bit a bit sólo cuando TODO el halo cumple R=+16
saturado y G constante. La regla previa minimiza el peor residente/cuota, luego descarga y C;
selecciona 16. No se combinan A y B. Capacidad RAW P0b íntegra: 5.671.296 B, sin crédito de
compresión. Memoria incluye tablas, halo, huecos, profundidad, piel CPU, capacidad, manifiesto
y descriptores alineados; no es pico observado heap/Worker/driver ni contabiliza copias transitorias.

| Candidato      | Abdomen residente B | Tórax residente B | Descarga B |
| -------------- | ------------------- | ----------------- | ---------- |
| Límite vigente | 100.663.296         | 50.331.648        | 19.510.002 |
| A16            | 95.116.358          | 54.760.248        | 20.217.610 |
| A24            | 107.668.180         | 58.689.648        | 21.428.501 |
| A32            | 127.887.330         | 61.640.928        | 21.596.146 |
| B              | 139.921.010         | 60.413.664        | 20.480.481 |

A16: margen abdominal +5.546.938 B, exceso torácico 4.428.600 B y descarga +707.608 B.
Omite 2.257/6.371 regiones abdominales y 463/3.188 torácicas. Ladrillos+halos activos:
80.848.328 / 53.551.700 B; la ocupación torácica y el halo ya exceden su cuota antes de reservas.
Las texturas completas miden 87.768.144 / 53.580.600 B, con Z 1.406/1.854.
Todas las dimensiones están bajo MAX_3D_TEXTURE_SIZE=2.048 observado; no son compatibles con
el mínimo 256. B mide 189×256×685 y 193×139×552; conserva la misma limitación explícita de P0c.

B conserva offsets y campos directos de P0c; el algoritmo prefijado coloca profundidad en
el primer hueco/crecimiento mínimo enumerado, con textura abdominal 132.572.160 B. **El mínimo
residente medido de ESTA representación es 139.921.010 B abdomen y 60.413.664 B tórax**
(133,439 / 57,615 MiB). No es un mínimo global de todo packing posible. Son cifras que deberá
explicitar cualquier futura decisión que use este B; la subida condicional autorizada el
02-11-2026 no habilita P1 porque faltan otras puertas. No se aplica ni se propone otra relajación.
Descarga B: 20.480.481 B, exceso 970.479 B. Ni redondear al orden de 128/61 MB ni subir sólo
textura soluciona descarga, piel o referencia de profundidad.

Recuperación: diecinueve campos físicos y vigésimo alias lógico gas; se recuperan TODOS los
nodos fuente almacenados bit a bit y los halos. Gas nearest bit128 y etiquetas digestivas
mod128 exactos; no se guarda ni se afirma conservar SDF continuo de gas (contrato P0c).
A16 comprueba todas las costuras XYZ, cinco fases alrededor de cada plano y extremos; B no
introduce costuras internas. La precisión ósea conserva los ocho nodos de `sourceDistancePrecise`.
Paridad GPU/CPU/Worker completa y clasificador nuevo siguen siendo puertas de P1, no evidencia P0e.

Los ocho programas se miden con helpers y techos EXACTOS de `shaderLimits.test.ts`, sin editarlo.
Valores tokens/ramas; A y B completos incluyen profundidad/gradiente alcanzables y gas. El selector
legacy sigue teniendo cuatro consultas; no es un clasificador funcional de los veinte campos.

| Programa           | Techo tokens/ramas | A16              | B               | Samplers A=B |
| ------------------ | ------------------ | ---------------- | --------------- | ------------ |
| RAWFIELD           | 1.385.000/11.060   | 1.520.149/11.087 | 1.212.601/9.763 | 10           |
| RAWFIELD_ECHO      | 577.000/4.640      | 647.822/4.706    | 505.781/4.091   | 16           |
| RAWFIELD_CLASS     | 455.000/3.830      | 527.999/3.938    | 399.320/3.380   | 10           |
| RAWFIELD_ELEVATION | 455.000/3.830      | 528.139/3.940    | 399.460/3.382   | 15           |
| RAWFIELD_GRADIENT  | 351.000/2.760      | 353.828/2.631    | 291.770/2.362   | 15           |
| TRANS_HITS         | 513.000/4.470      | 599.956/4.613    | 448.508/3.961   | 6            |
| TRANS_HITS_GRID    | 252.000/2.210      | 298.865/2.294    | 223.141/1.968   | 11           |
| COLOR              | 248.000/2.160      | 298.921/2.268    | 223.197/1.942   | 7            |

A falla 8/8; B pasa 8/8. Samplers sin incremento (máximo 16), uniform slots 101–138/179.
Profundidad ocupa R en RG16F del atlas abdominal: cero samplers nuevos, una lectura lineal,
seis para gradiente. Piel y cinco consultas de `probeFrame` permanecen CPU (20 nodos).

Hipótesis const OFF: en el control estático con el mismo floor(z/64), pasar de const a dos
texelFetch lleva CLASS de 455.778 a 481.400 tokens y COLOR de 250.770 a 265.720. El helper
cuenta cuerpos alcanzables; NO cuenta el contenido de declaraciones const. No respalda que
49 filas expliquen por sí solas su incremento. Diagnóstico GPU controlado, mismos datos y
textura extendida con tabla, cinco contextos por fuente alternados: compilación micro const
mediana 100,200 ms, rango 86,800–133,100;
fetch 120,400 ms, rango 112,100–133,200.
Carga compartida y caché del driver no controlada: no es prueba causal del JIT de ocho programas
completos ni una mejora de rendimiento acreditada.

Piel común fijada: 1.024 rayos, Z 0,75 mm; RG16F XY 1.024×687, 2.813.952 B raw / 947.509 B gzip.
D conserva z [−210,+60] mm y φ completo. Comparador nativo y cuartos del paso original de 1,5 mm,
ambas direcciones y huellas P0 intactas. Tabla: peor p95 y peor máximo entre las ocho comparaciones
por huella (no un percentil agrupado). Cotas invariables 1,5/3 mm.

| Huella          | Peor p95 mm | Peor máximo mm | 1,5/3 |
| --------------- | ----------- | -------------- | ----- |
| subxiphoid      | 1,218       | 1,282          | pasa  |
| epigastric      | 1,223       | 1,283          | pasa  |
| intercostal     | 1,206       | 1,365          | pasa  |
| subcostal       | 1,011       | 1,057          | pasa  |
| flank           | 1,013       | 1,058          | pasa  |
| portal          | 1,256       | 1,543          | pasa  |
| portalTrunk     | 1,013       | 1,058          | pasa  |
| renal           | 0,956       | 1,060          | pasa  |
| hepatorenal     | 1,030       | 1,105          | pasa  |
| portalSubcostal | 1,010       | 1,058          | pasa  |

| Fase Z nativa, D | Fuente→perfil p95/máx mm | Perfil→fuente p95/máx mm |
| ---------------- | ------------------------ | ------------------------ |
| 0                | 0,532 / 1,076            | 0,688 / 0,756            |
| 0.25             | 0,688 / 1,714            | 0,795 / 3,141            |
| 0.5              | 0,929 / 1,729            | 1,054 / 1,653            |
| 0.75             | 0,687 / 1,277            | 0,795 / 1,398            |

Las diez ventanas pasan; **D falla en 1/4 Z a 3,140913 mm**, LAS
[−0,927874;111,974688;−164,613793]. El máximo anterior de medio Z queda corregido, sin aprobar
el dominio. Diagnóstico fino de cuartos de 0,75 mm llega a 3,314219 mm, también conservado.
Distancias a superficies muestreadas; no Hausdorff continuo. Pelvis/ingle aproximadas declaradas;
no se limita movimiento ni se instala mensaje de UI. La futura app deberá conservar la advertencia
exterior definida en P0d y continuidad al cruzar D.

Profundidad: `classify`/`classifyWall` consumen signo fuera y magnitud en TODA la pared/interior;
`respWeight`, `insideWallMm` y caras profundas también la usan. `contact.ts` usa magnitud/gradiente
±1 mm y apaga acoplamiento a 4,5 mm; `skinEntry` busca cero y `firstCrossing` la pared hasta 3W.
`probeFrame` usa cinco puntos de la misma piel CPU. Por ello el protocolo exige todo interior de D
y envolvente exterior de 6 mm, manteniendo 1,5/3 mm y signo sin errores fuera de ±1,5 mm.
SDF corporal auxiliar 3 mm, caja XY+12 mm y Z D±6, sin tapas artificiales en D: no sustituye los
veinte campos de 1,5 mm. Fuera de caja, clamp EDT + distancia a caja, continuo y declarado aproximado.

Interior nativo: 5.482.316 muestras, p95 0,165403 mm y máximo 1,635651 mm; medio XYZ stride2:
685.017 muestras, p95 0,109876 mm y máximo 0,810046 mm. Cero errores de signo fuera de ±1,5 mm.
Offsets con referencia disponible y EDT<=6 mm: máximo 1,438802 mm, p95 peor 0,564697 mm;
la tabla externa `domain/depth.json` conserva cada offset y número de referencias ausentes.
**No se aprueba profundidad completa:** la caja x− sale de la rejilla CT y la envolvente exterior
prefijada de 6 mm no queda acreditada. No se infiere que allí sólo haya aire: el cuerpo fuente
presenta caras cortadas, y se conservan los desconocidos dentro del dominio exigido.

El arnés heredado etiquetaba a +30 mm diecinueve puntos fuera de CT como consumidos por aplicar
nearest al borde de la referencia: el aparente error 17,079505 mm no es una medida válida contra
EDT nativa exterior. Original, láminas y fallo se guardan en `depth-reference-clamp-rejected/`;
A2 fecha la corrección de validez (sin alterar candidato ni cotas). Cero muestras válidas se
expresa como desconocido, nunca error cero ni aprobado. Caras XY y bordes Z son continuos a
±1e−6 mm, con saltos <0,000003 mm; continuidad no demuestra la exactitud que falta.
La EDT también sustituiría la métrica radial histórica: pared/contacto requieren revalidación P1.

Primer cuadro aislado: Chromium 153.0.8010.12 x86_64 bajo Rosetta, `/tmp/pw-x64`, renderer ANGLE
SwiftShader verificado; ambos atlas A/B subidos realmente, 64×64 RGBA32F, píxel A/B contrastado
contra campo fuente/EDT CPU, GL=0 y contexto conservado. Sin programa completo ni arranque producto.
Una observación por fuente, bajo carga compartida, no comparación de velocidad:

| Fuente   | Upload+finish ms | Compile ms | Link ms | Draw+finish ms | Fetch→cuadro ms |
| -------- | ---------------- | ---------- | ------- | -------------- | --------------- |
| baseline | 81,600           | 108,800    | 14,400  | 0,000          | 822,300         |
| A        | 126,900          | 159,500    | 18,600  | 0,200          | 1016,100        |
| B        | 217,400          | 118,000    | 11,600  | 0,100          | 1635,400        |

Plazo 180 s intacto. A1 conserva el primer arnés que sólo subía abdomen en
`gpu-abdominal-only/`; la corrección sube también tórax y contrasta el píxel, sin cambiar candidatos.
Las únicas enmiendas son errores de arnés, fechadas en `amendments.md`, negativos conservados.
P0c no contiene `domain/` ni `boundary-diagnostics.json`: se registra esa ausencia en provenance;
se leen su protocolo/paquete/coste y los diagnósticos de P0d. No se inventa evidencia faltante.

Láminas abiertas y revisadas antes del cierre, todas bajo la raíz de evidencia indicada:

- `figures/skin-witness-ct.png`: mismo CT axial, detalle del pliegue anterior, coronal y sagital.
- `figures/windows-depth.png`: diez huellas, D y profundidad con referencia CT disponible.
- `figures/skin-depth-domain.png`: barrido de medio Z y diagnóstico de offsets.

Los originales previos a A2 también están abiertos y conservados, pero la validez corregida tiene
prioridad para interpretar números; no se descarta el negativo.

Horas **estimadas y condicionadas a resolver las puertas antes de iniciar P1**, sin CI/revisión:
P1 40–72 h; P2 28–44; P3 24–40; P4 20–36; P5 16–28; P6 16–28; P7 20–36; P8 20–32;
corte 12–20. **P1 en adelante: 196–336 h**, más 12–24 h del propietario. El rediseño que falta
antes de P1 no queda resuelto ni estimado de nuevo por P0e. No hay fase posterior implementada.

Cierre local secuencial con `tools/workspace/run.sh`: prettier --check ., docs-index --check,
lint, tipos, `npm test -- --maxWorkers=1` y todos los contratos Python. Códigos/logs reales en
`checks.json`, resumen y SHA en `receipt.json`. No acredita build, CI, E2E de producto, merge ni
validación clínica. No delegación/revisión por instrucción expresa. Sólo commit local con trailer.
