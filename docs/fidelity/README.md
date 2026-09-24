# Banco de fidelidad del modo B

Mide, con números reproducibles, cuánto se parece la imagen del simulador a la física y a una
ecografía real (decisión 52). Nació de la evaluación ciega de la tanda 1.5: un juez de contexto
limpio distinguió las 21 imágenes simuladas de las reales, casi siempre en menos de un segundo
(nota global 2/7). A partir de ahí, cada cambio de imagen se acepta con estas métricas y no a ojo.

## Cómo se corre

```bash
npm run dev          # servidor de desarrollo en el puerto 6600
npm run fidelity     # 2 casos × 4 puntos de partida con GPU real → docs/fidelity/baseline.json
```

`npm run fidelity -- --url <servidor> --out <archivo>` cambia el destino. `npm run fidelity -- --sweep`
mide además cada vista con la sonda basculada ±6° e inclinada ±6° y agrega el banco de interfaces
de las cinco poses (`sweep` en el JSON, con `summarizeFaces`). No llena todos los tramos: las
suprahepáticas y el diafragma a 0–20° quedan casi vacíos (ver «Qué llena el barrido»), así que los
ecos de interfaz (decisión 57) solo vigilan los que se llenan en alguna vista (`GATED_FACE_BINS`) y cada
escena lista en `escasos` los que en ella no llegan a 10 registros o no tienen rosario. Necesita GPU:
con SwiftShader los cuadros por segundo no significan nada, así que no corre en CI. En este Mac,
espera a que no esté corriendo el runner de EchoTwin (`pgrep -f /Users/daniel/builds/`).

La composición espacial (decisión 58) está encendida por defecto, como en la aplicación:
`npm run fidelity -- --compound false` mide la imagen de una mirada (la de las líneas base de abajo), y el
JSON dice con cuál se midió (`compuesto`).

El gancho `window.__vexusTest.fidelity({ compound, startPoint, display, pose, samples })` da las mismas
métricas desde la consola o una e2e; `compound` es obligatorio: con `true` llena el anillo de miradas,
asienta la persistencia con él lleno y mide la envolvente compuesta; sin `display` solo mide la
envolvente (sirve con SwiftShader). `pose`
(`{ rockDeg, tiltDeg }`) mueve la sonda respecto a la pose de partida y `samples` devuelve un registro
por línea y pared (`faceSamples`). Clasifica en CPU una rejilla de líneas × 0,5 mm (~1–3 s).

## Dos niveles

Una textura puede fallar por la física del moteado o por la cadena del equipo que la muestra. Por
eso se mide en los dos niveles.

| Nivel           | Qué se mide                                                                                                               | Dónde                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Envolvente      | Física del moteado antes de comprimir: SNR, tamaño y forma del grano, periodicidad y topología de los ceros.              | `envelopeTexture` (`src/app/fidelity.ts`)       |
| Imagen mostrada | Cadena del equipo (TGC, rango dinámico, curva de grises, persistencia): gris del hígado, perfil en profundidad y paredes. | `displayStats`, `depthProfile`, `fidelityStats` |

Las funciones puras se prueban con campos sintéticos en `src/validation/fidelity.test.ts`.

## Métricas y referencias

Etiquetas: **[MEDIDO]** en la suite o en las imágenes de referencia; **[LITERATURA]** valor
publicado; **[ESTIMADO]** juicio del panel.

La textura se mide en **hígado despejado**, sobre una rejilla de clasificación de líneas × 0,5 mm:

- a ≥ 6 mm de cualquier tejido que no sea hígado en el plano (≥ 3 mm en la imagen mostrada), vasos
  incluidos (la `boundaryDistance` del hígado no cuenta los tubos); lo que queda fuera del sector o del
  campo no se conoce y cuenta como otro tejido (en la réplica en CPU deja fuera 5 de los 29 parches de
  la subxifoidea del sano; con moteado ideal, la SNR se mueve 0,01 por muestreo). La guarda de
  Rayleigh de la e2e (`speckleStats`) exige además, en cada muestra, ≥ 6 mm del borde del hígado en 3D
  (`boundaryDistance`): la rejilla no ve una frontera fuera del plano;
- en líneas con acoplamiento ≥ 0,95;
- antes del primer tejido que hace sombra (gas o hueso, como la pasada A) en esa línea y en sus dos
  vecinas, con 2 mm de margen;
- fuera de la penumbra de la apertura: la transmisión con apertura de la pasada A no queda más de
  0,5 dB por debajo de la de un solo rayo (decisión 54). Junto a una costilla el cono queda tapado en
  parte aunque la línea no lo esté; sin esto, el hígado del flanco «bajaba» a 76 de gris con
  desviación 23;
- con todas las muestras del parche dentro, no solo unas de control.

Sin esa máscara, las sombras costales y el mal contacto entran en los parches y se miden como grietas
(índice 0,6 en la ventana intercostal frente a 0,08 despejada). El gris y el perfil en profundidad
usan además **hígado puro**: sin más de 0,5 dB de atenuación distinta de la del hígado en el camino.
El refuerzo tras un vaso es física correcta, no un defecto de la TGC, y antes se medía como pendiente
(0,46 dB/cm en la subxifoidea con congestión).

### Envolvente (parches de 48 muestras × 16 líneas, comprobadas línea a línea)

| Métrica               | Definición                                                           | Moteado ideal                                                                         |
| --------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| SNR                   | Media / desviación de la envolvente por parche.                      | 1,91 (Rayleigh) [LITERATURA]; 1,92–1,96 con este parche [MEDIDO]                      |
| Grano axial y lateral | FWHM de la autocovarianza, promediada entre parches, en mm.          | ≈ FWHM de la PSF de amplitud, ±12 % [MEDIDO]; 0,4–0,9 mm axial a 3,5 MHz [LITERATURA] |
| Lóbulo secundario     | Máximo de la autocovarianza tras su primer mínimo.                   | < 0,05 sintético, ≤ 0,06 con la GPU [MEDIDO]; una retícula da > 0,3                   |
| Fracción oscura       | Muestras < 0,3 × la media del parche.                                | 0,068 (1 − e^(−0,09·π/4)) [LITERATURA]                                                |
| Índice de grietas     | Fracción de lo oscuro en componentes conexos de ≥ 2 granos de largo. | 0,045–0,10 según el tamaño de la PSF [MEDIDO]; \|campo real\| da 0,30–0,39            |

Por bandas de profundidad (20–60, 60–100, 100–140 y 140–180 mm), el grano lateral se compara con la
PSF de dos vías de `beamModel.ts` a la profundidad media de la banda (`beamFwhmMm`). Si el grano no
cabe en el parche (la autocovarianza no baja de 0,5), grietas y lóbulos salen NaN, no 0.

### Imagen mostrada (hígado despejado y puro)

| Métrica                 | Definición                                                                                                                                                                                                                                                                                                                                                                                                   | Referencia real                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gris del hígado         | Media, desviación y percentiles 5/50/95 del gris 0–255.                                                                                                                                                                                                                                                                                                                                                      | Media 52–112; desviación 10–16 en equipos modernos (THI y composición espacial), 21–25 en moteado crudo [MEDIDO en las referencias de la tanda 1.5] |
| Huecos a la vista       | Píxeles por debajo de la mitad de la media.                                                                                                                                                                                                                                                                                                                                                                  | [ESTIMADO] se calibra con las referencias                                                                                                           |
| Perfil en profundidad   | Nivel mostrado (dB bajo el techo, invirtiendo la curva de grises) por bandas de 10 mm; pendiente.                                                                                                                                                                                                                                                                                                            | 0 ± 0,3 dB/cm con la TGC bien ajustada [ESTIMADO]                                                                                                   |
| Centro de la luz        | Mediana del gris de la sangre a ≥ 1,5 mm de su pared, sin sombra delante.                                                                                                                                                                                                                                                                                                                                    | Casi negro: 0,6–9,6 [MEDIDO en las referencias, mínimo en 7×7]                                                                                      |
| Diafragma saturado      | Fracción de los píxeles del diafragma en el blanco (≥ 250).                                                                                                                                                                                                                                                                                                                                                  | ≤ 2 % [ESTIMADO]                                                                                                                                    |
| Pared anterior / hígado | Pico de gris en [−1,5 mm del borde; +0,5 mm de la primera celda de sangre] de la VCI o una suprahepática frente a la mediana del hígado en [−10; −3] mm, por tramos de incidencia (0–20°, 20–40°, 40–60°) sobre la normal real de la pared (gradiente de `faceSdf`). Sin pared, el moteado solo da ~1,1.                                                                                                     | 1,36–2,1 [MEDIDO en las referencias, 3 perfiles de incidencia desconocida]                                                                          |
| Cuadros por segundo     | Lectura del HUD tras 3 s en tiempo real.                                                                                                                                                                                                                                                                                                                                                                     | ≥ 30 (guía)                                                                                                                                         |
| Coste del cuadro        | `msPerFrame`: tiempo de pared medio de 20 cuadros con la caja de color apagada. `msPerFrameColor`: con la caja encendida y la pasada de color en cada cuadro (`frameCostMs(20, { forceColor: true })`; sin forzarla, la cadencia del color salta el cuadro y el gancho se niega a medir). Las dos, en la pose de partida de la vista (`startPoint`), aunque `--sweep` haya movido la sonda entre una y otra. | Solo entre versiones, en la misma máquina y con la misma carga                                                                                      |

### Banco de interfaces (PR 5a)

Cada línea que pasa de ≥ 3 mm de tejido previo a una interfaz da un registro, con la incidencia
sobre la normal de la cara: el gradiente (diferencias centrales de 0,02 mm) de `faceSdf`, la misma
distancia que decide la clasificación (`AnatomyScene.faceSdf`: luz del tubo, superficie hepática,
cúpula, contorno renal y luz vesicular). Los registros se agrupan por tramos de incidencia y se
enlazan en paredes (líneas vecinas con el borde a ≤ 3 mm) para los huecos y el rosario.

| Interfaz                    | Paso en la línea                                                                           | Referencia (hígado)     | Normal         |
| --------------------------- | ------------------------------------------------------------------------------------------ | ----------------------- | -------------- |
| VCI, suprahepáticas y porta | hígado → (pared) → sangre de ese sistema, ≤ 4 celdas                                       | [−10; −3] mm del borde  | `tube`         |
| Cápsula hepática            | músculo o grasa → cápsula, ≤ 4 celdas                                                      | 3–10 mm bajo la cápsula | `liverSurface` |
| Diafragma                   | hígado o cápsula → diafragma → pulmón, ≤ 10 celdas; la pleura es el primer gas de la línea | [−10; −3] mm del borde  | `dome`         |
| Morison                     | hígado o cápsula → grasa perirrenal → cápsula renal, ≤ 12 celdas                           | [−10; −3] mm del borde  | `kidneyOuter`  |

`walls` sigue siendo la tabla histórica (VCI y suprahepáticas juntas); `wallSystems` las separa y
añade la porta. Las métricas de envolvente (pico, anchura, línea pleural y costura) usan la envolvente
con la compensación nominal de la pasada de escaneo, 2·α_hígado·r (`envelopeLine`, sin la TGC del
usuario ni su techo): la envolvente de la GPU lleva la atenuación de ida y vuelta (~3 dB/cm) y la
referencia está a 3–10 mm de la cara. Sin compensarla, el mismo eco medía ~4 dB distinto con la
referencia encima (pared) o debajo (cápsula), la línea pleural ~3 dB de menos y un diafragma sin
costura daba 0,02–0,03 de costura. En cada tramo:

| Métrica       | Definición                                                                                                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cociente y dB | Pico de gris en [−1,5 mm del borde; +0,5 mm del objetivo] frente a la mediana del hígado de referencia.                                                                                                                           |
| Huecos        | Fracción de líneas con el pico a < 6 dB (nivel mostrado) sobre el hígado.                                                                                                                                                         |
| Tramo         | Hueco más largo a lo largo de una pared: líneas de hueco consecutivas × paso de línea en el borde (mm).                                                                                                                           |
| Rosario       | CV del pico de envolvente de cada línea dividido por la mediana de sus vecinas a ±3 líneas de la misma pared.                                                                                                                     |
| FWHM del eco  | Anchura a −6 dB alrededor del pico de la envolvente, en pasos de 0,05 mm.                                                                                                                                                         |
| Pico          | Pico de la envolvente compensada sobre la mediana del hígado de referencia (dB).                                                                                                                                                  |
| Diafragma     | Línea pleural (pico a ±1,5 mm del cruce exacto, bisección de 20 pasos en la CPU), desviación de su posición, costura (racha ≥ 0,3 mm de envolvente < hígado − 15 dB en [pleura; +2,5 mm]) y p95 del desfase del espejo de la GPU. |
| Suelo espejo  | `mirrorFloorMm`: p95 del desfase que da la colocación de la pasada A (marcha gruesa y bisección, emuladas en la CPU), el suelo del anterior.                                                                                      |
| Cara saturada | Píxeles ≥ 250 a ≤ 1 mm de la cúpula, del contorno renal y de la vesícula.                                                                                                                                                         |

El desfase del espejo tiene un suelo que no es de geometría: el de la colocación de la pasada A. Hasta
el PR 5b el espejo quedaba en el centro del primer segmento grueso de pulmón (paso = profundidad/160,
1,125 mm a 18 cm), así que |espejo − pleura| caía en [0; paso) y su p95 rondaba 1 mm aunque la cúpula
estuviera en su sitio (0,002–1,10 mm, p95 1,02, en las 33 líneas de la subxifoidea del sano). Con la
decisión 57, A0 lleva ese segmento al cruce con una bisección de 6 pasos (`mirrorCrossing`) y el suelo
baja a ≤ 0,009 mm. `mirrorOffsetMm` ≈ `mirrorFloorMm` dice que la GPU coloca el espejo como la CPU
emula; la puerta de 5b es p95 ≤ 0,05 mm.

Las líneas pintadas de `src/validation/fidelity.test.ts` fijan cada métrica (una pared continua no
tiene huecos ni rosario; una línea de cada tres apagada da un tercio de huecos de un paso; ±6 dB al
azar dan rosario > 0,3; un eco gaussiano mide 2,355·σ; una costura de 0,5 mm cuenta en todas las
líneas; con 3 dB/cm de atenuación, el eco compensado mide lo mismo con la referencia encima o debajo).
La e2e de normales compara la normal de la GPU (`queryPoints` con `normals`) con el
gradiente de `faceSdf` a 0,02–0,4 mm de cada cara, en los tejidos que la dibujan, con una fila por
cara y otras por subconjunto (`FACE_NORMAL_SUBSETS`: la VCI, su cuerpo y el riñón con y sin
escotadura, muestreados aparte). La normal que se compara es la que usa el eco de interfaz
(`faceGradient`), y también su norma (p95 del error relativo ≤ 0,01), con la que el eco pasa `ifd` a
distancia por la normal. En 5a, emulando la GLSL en TS (sano en apnea), cúpula y vesícula daban |n·∇| ≥ 0,99 en
p01 y el tubo, mezclando todos los vasos, ≥ 0,99 en p05, pero tres normales no eran el gradiente; el
PR 5b (decisión 57) las corrige:

- tubo: la VCI (`tubeIvc`) no coincidía en todo su cuerpo, no solo en la tapa. Su sección es elíptica
  y la normal de la GPU (`tubeQuery`, d/dist) escalaba la componente anteroposterior una vez, mientras el
  gradiente la escala dos: en el cuerpo (`tubeIvcBody`, 0 < s < 1 en su segmento) |n·∇| iba de 0,991 a
  0,996 (p01–p50) con `ivcApScale` 0,777 (6–8°) y bajaba a 0,984 (10°) con 0,70. Ahora la normal es el
  gradiente de la sección, con el afilamiento del radio; portada a TS da p01 ≥ 0,9999 en el cuerpo
  (`faceNormals.test.ts`) y la e2e exige p05 ≥ 0,99 en la VCI y p01 ≥ 0,98 en su cuerpo;
- riñón: junto a la escotadura hiliar (`kidneyOuterNotch`, solo en la ventana renal) la normal era la
  del elipsoide sin escotadura (la fila entera daba 0,61 en p01);
- cápsula hepática: `liverSdf` elegía la normal de una de las superficies que funde con `smoothMax`
  (p05 de 0,45 a 0,98 según la vista, por la impresión renal y la unión de los lóbulos).

En el riñón, la cápsula, el diafragma y la vesícula la GPU usa ahora el gradiente numérico de la misma
distancia que decide la clasificación, con el paso del banco (0,02 mm), solo en las muestras al alcance
de su cara. La e2e exige mediana ≥ 0,99 en todas las caras, p05 ≥ 0,98 en el tubo y p01 ≥ 0,98 en la
cúpula, la vesícula, la cápsula hepática, el riñón entero (con y sin escotadura) y el cuerpo de la VCI;
y en la norma, p95 del error relativo ≤ 0,01 (el gemelo TS da ≤ 5·10⁻⁵; una GPU que la dejara en 1
daría ≥ 0,1 en la VCI de la subxifoidea, donde |∇| = 1/apScale).

### Línea base de interfaces con GPU (PR 5a, antes de los ecos de interfaz)

`npm run fidelity -- --sweep true` en el M4, cinco poses por vista. Cociente pico/hígado a 0–20° (40–60°
en la segunda columna de VSH) con, entre paréntesis, registros; h = fracción de líneas con hueco
(pico < hígado + 6 dB); r = rosario. Referencias reales: pared 1,36–2,1; una pared continua tiene
h ≈ 0 y rosario < 0,26.

| Escena                  | VCI 0–20°                  | VSH 0–20°                | VSH 40–60°                 | Cápsula 0–20°              | Morison 0–20°             |
| ----------------------- | -------------------------- | ------------------------ | -------------------------- | -------------------------- | ------------------------- |
| Sano, subxifoidea       | 1,11 (17; h 0,77; r 0,29)  | —                        | 1,08 (21; h 0,95; r 0,25)  | 1,12 (313; h 0,78; r 0,36) | —                         |
| Sano, intercostal       | 1,14 (12; h 0,92; r 0,29)  | 1,04 (4; h 1,00; r —)    | 1,13 (100; h 0,78; r 0,31) | 1,02 (103; h 0,93; r 0,38) | 1,28 (10; h 0,20; r 0,23) |
| Sano, flanco            | 1,17 (69; h 0,83; r 0,24)  | 1,54 (1; h 0,00; r —)    | 1,14 (34; h 0,85; r 0,27)  | 1,16 (137; h 0,70; r 0,28) | —                         |
| Sano, renal             | 1,13 (13; h 0,85; r 0,23)  | —                        | —                          | —                          | —                         |
| Congestión, subxifoidea | 1,26 (10; h 0,30; r 0,32)  | —                        | 1,17 (35; h 0,74; r 0,27)  | 1,09 (390; h 0,81; r 0,34) | —                         |
| Congestión, intercostal | 1,07 (19; h 0,84; r 0,32)  | 1,07 (9; h 0,89; r 0,31) | 1,10 (177; h 0,79; r 0,32) | 1,11 (172; h 0,85; r 0,34) | 1,41 (55; h 0,04; r 0,30) |
| Congestión, flanco      | 1,22 (103; h 0,66; r 0,28) | —                        | 1,12 (55; h 0,87; r 0,28)  | 1,15 (141; h 0,77; r 0,26) | —                         |
| Congestión, renal       | 1,15 (26; h 0,65; r 0,35)  | —                        | —                          | —                          | —                         |

Lo que delata la imagen, medido: paredes y cápsula a 1,02–1,26 (lo que da el moteado solo) con huecos
en el 65–95 % de las líneas y rosario 0,23–0,38. La interfaz hepatorrenal ya destaca (1,28–1,41,
continua) porque la grasa perirrenal es ecogénica. Estas cifras son el «antes» del PR 5b.

### Qué llena el barrido (`--sweep`)

Registros por tramo de las cinco poses del barrido en apnea (réplica en CPU: la detección de las
caras y la incidencia son de la CPU; la GPU solo pone el gris y la envolvente, y el instante del ciclo
puede mover unos pocos registros). \* = sin rosario (ninguna pared con 5 líneas a ±3 en el tramo).

| Escena                  | VCI 0–20° | VSH 0–20° | VSH 40–60° | Porta 0–20 / 20–40 / 40–60° | Cápsula 0–20° | Diafragma 0–20 / 20–40 / 40–60° | Morison 0–20° |
| ----------------------- | --------- | --------- | ---------- | --------------------------- | ------------- | ------------------------------- | ------------- |
| Sano, subxifoidea       | 18        | 0         | 22         | 15\* / 39 / 30\*            | 313           | 0 / 2 / 54                      | 0             |
| Sano, intercostal       | 15        | 3         | 102        | 4 / 4 / 4                   | 103           | 0 / 0 / 0                       | 10            |
| Sano, flanco            | 74        | 1         | 33         | 0 / 0 / 0                   | 137           | 0 / 0 / 9                       | 0             |
| Sano, renal             | 14        | 0         | 0          | 0 / 0 / 0                   | 0             | 0 / 0 / 0                       | 0             |
| Congestión, subxifoidea | 9\*       | 0         | 31         | 16\* / 31 / 23\*            | 390           | 0 / 5 / 60                      | 0             |
| Congestión, intercostal | 19        | 9         | 166        | 2 / 3 / 3                   | 172           | 0 / 0 / 0                       | 55            |
| Congestión, flanco      | 103       | 0         | 55         | 0 / 0 / 0                   | 141           | 0 / 4 / 9                       | 0             |
| Congestión, renal       | 22        | 0         | 0          | 0 / 0 / 0                   | 0             | 0 / 0 / 0                       | 0             |

Lo que eso deja fuera de las puertas de 5b (solo cuentan los tramos con n ≥ 10; el banco lo repite en
`escasos` de cada escena):

- **Suprahepáticas a 0–20°: < 10 en las ocho escenas.** No se pueden evaluar «VSH ≥ 1,36 a 0–20°», su
  caída con la incidencia ni su continuidad a 0–20°. Hay que medirlas a 20–40° (8–111 registros fuera de
  la ventana renal) o añadir una vista dirigida (subcostal oblicua hacia la confluencia).
- **Diafragma a 0–20°: 0 en todas.** La cúpula solo se ve a 20–60° (a 40–60° en la subxifoidea: 54–60
  registros de 16 paredes); la línea pleural, su posición, la costura, el espejo y el rosario ≤ 0,22 se
  evalúan a 40–60° o sobre todos los tramos, o hace falta una vista con la cúpula como primer gas a poca
  incidencia.
- **Porta:** a 0–20° y 40–60° nunca da rosario (15–30 registros repartidos en 8–12 paredes) y fuera de
  la subxifoidea no llega a 10 en ningún tramo.
- VCI a 0–20°: ≥ 10 salvo la subxifoidea con congestión (9). Cápsula a 0–20°: ≥ 103 salvo la ventana
  renal (0). Morison a 0–20°: solo la intercostal (10 y 55).

Más poses no lo arreglan: una búsqueda de ±24° de basculación e inclinación en pasos de 8° (49 poses
por vista y caso) da VSH 0–20° ≥ 10 en 3 (sano) y 8 (congestión) de 196 poses, siempre con 1–3
paredes, y el diafragma a 0–20° no pasa de 11 registros de una pared. Por eso el barrido sigue siendo
de ±6° y los ecos de interfaz solo vigilan los tramos que se llenan (`GATED_FACE_BINS`): VCI 0–20°,
VSH 20–40° y 40–60°, porta 20–40°, cápsula 0–20°, diafragma 40–60° y Morison 0–20°.

### Ecos de interfaz (PR 5b, decisión 57): predicción del gemelo y puertas con GPU

El gemelo B→C→D en CPU (`src/validation/interfaceTwin.test.ts`, escenas planas con las funciones de
producción, K = 55 dB) predice, en cociente pico/hígado a 0–20° (antes → después): VSH 1,14 → 1,51
(1,50, 1,49 y 1,40 a 40, 120 y 150 mm), VCI 1,16 → 1,62, porta 1,42 → 1,62 (1,45 a 20–40° y 1,40 a
40–60°), cápsula 1,17 → 1,78, diafragma 1,29 → 2,16 sin costura (antes en el 66 % de las líneas) y
Morison 1,42 → 2,17; huecos a 0–20° ≤ 0,08 y rosario 0,16–0,21. La VSH vuelve a lo que da el moteado
solo fuera de ±20° (3,5 dB a 20–60°) y la porta no (10–11 dB). Sin la curvatura del riñón
(`interface-curvature-tubes-only`) Morison daba 2,23 con la s de la cápsula renal del plan (0,21); su
pico es la cara grasa/cápsula renal, 4 dB sobre la de hígado/grasa, y con s 0,25 queda en 2,17 (la s de
la grasa no lo mueve: 0,30 → 0,35 deja 2,23). La VCI de 1,62 es circular (r 10 mm); la de la escena es
elíptica y el eco usa la curvatura local de su sección: en apnea (apScale 0,777) la pared AP (subxifoidea)
da 1,67 y la lateral (flanco) 1,52. El eco se evalúa en la distancia por la normal, ifd/|∇| (decisión
57): sin |∇| la pared AP de la VCI perdía 2,2 dB en apnea y 6 dB a apScale 0,5.

Los objetivos se fijaron antes de medir con GPU (lo medido va después de la lista), solo en los
tramos con ≥ 10 registros:

- **Deben pasar (hoy fallan):** VCI 0–20° ≥ 1,40 y ≤ 2,1 (flanco, paredes laterales: el gemelo da 1,52
  en apnea; subxifoidea e intercostal del sano, paredes AP: 1,67),
  con huecos ≤ 0,15, tramo ≤ 1 mm y rosario ≤ 0,26; VSH 40–60° ≤ 1,20 y porta − VSH ≥ 5 dB a 20–40°
  (subxifoidea): la caída de la VSH con la incidencia, que a 0–20° no se puede medir; cápsula 0–20° ≥ 1,40
  con huecos ≤ 0,15 y rosario ≤ 0,22 (subxifoidea, intercostal y flanco); Morison 0–20° en [1,6; 2,2]
  con rosario ≤ 0,22 (intercostal); diafragma 40–60° (subxifoidea) con costura ≤ 0,02 y desfase del
  espejo p95 ≤ 0,05 mm. La línea pleural (≥ +18 dB) y su posición (≤ 0,15 mm) dependen de la incidencia
  y solo se exigirían a 0–20°, que no se llena.
- **Guardas (no deben empeorar):** porta 20–40° ≥ 1,40 (subxifoidea); moteado a ± 0,01 de la línea base
  (SNR 1,90–1,97, oscuros 0,065–0,071, grietas 0,055–0,083); hígado p50 99–103 y desviación ≤ 19; luz
  p50 < 30; caras sin saturar (≤ 0,02 en diafragma, Morison y vesícula); msPerFrame ≤ línea base +
  0,3 ms y, con el temporizador de GPU, rawField ≤ +0,15 ms y transmissionHits ≤ +0,05 ms.
- **Calibración de K:** si la VCI a 0–20° queda fuera de [1,45; 1,9], K se mueve en pasos de 1 dB
  dentro de [53; 57] (`IFACE_K_DB`); si hiciera falta salir de ese rango, es un error de modelo y se
  para. Morison sube con K (gemelo: 2,06 / 2,17 / 2,30 a 53 / 55 / 57 dB). Si pasa de 2,2 con K
  calibrado, la palanca es la cara que da su pico, la de la cápsula renal: su s (0,25 → 0,30 da 2,10 a
  55 dB) o su σz, no R; la s de la grasa perirrenal no lo mueve y la curvatura del riñón no está en el
  modelo (C solo en los tubos).

**Medido con GPU (M4, 24-09-2026, `--sweep`, K = 55 dB).** La cápsula a 0–20° pasa de 1,02–1,16 con
70–93 % de huecos a 1,64–1,89 sin huecos (rosario 0,15–0,20) y Morison da 1,97 / 2,18 sin huecos: los dos
como el gemelo, así que K no se mueve (Morison saldría de 2,2 con K 57). La VCI a 0–20° da 1,54–1,73 en la
congestión (flanco 1,57, intercostal 1,73, subxifoidea 1,57, renal 1,54; huecos ≤ 0,08) y 1,23–1,51 en el
sano (flanco 1,31, intercostal 1,51, subxifoidea 1,23, renal 1,27; huecos 0,15–0,54), frente a 1,07–1,26
antes. Queda bajo el objetivo en el sano porque la VCI está honda (125 mm en el flanco) y la coherencia de
curvatura C cae con la profundidad; el pico sobre el moteado, a < 15°, lo confirma: ~6 dB en la VCI y 8–10
dB en la porta frente a 19 dB en la cápsula y 22–24 dB en la cápsula renal. La palanca que queda es σe o
la retrodifusión de la pared delgada, no K. Las suprahepáticas a 40–60°: 1,08–1,14. Diafragma: desfase
del espejo 0,01 mm y costura ≤ 0,04 en casi todas las escenas; en la subxifoidea del sano a 40–60° el
banco marca 8,59 mm, igual a su `mirrorFloorMm` (la emulación en CPU de la GPU): a incidencia rasante la
referencia toma otro cruce y la GPU sigue al modelo (costura del render 0,017); a 20–40° la costura 1,00
sale de 2 registros. Cuadro: 4,0–5,5 ms. La e2e exige ahora, en lugar de pared/hígado ≥ 1,30, que la
mediana del pico de las caras de tubo a < 15° sea ≥ 5 dB con ≥ 5 muestras (la GPU sigue al modelo y el
cociente de pared en SwiftShader no llena los tramos), y la equivalencia tolera 0,02 mm en la distancia a
la cara (SwiftShader llega a 0,014 mm en la del diafragma; la GPU real, 7·10⁻⁶).

### Composición espacial (PR 4a, decisión 58): predicción del gemelo y puertas con GPU

El gemelo B→C→D de tres planos (`src/validation/compoundSpeckle.test.ts`, subxifoidea, ±7°, 8
realizaciones; funciones de producción) predice a 20 / 45 / 90 / 150 mm: SNR 1,99 → 3,10 / 2,01 → 2,81 /
2,02 → 2,45 / 1,99 → 2,91; ρ(0,±) 0,23 / 0,42 / 0,65 / 0,35 frente a la ley con la σ medida 0,32 / 0,53 /
0,72 / 0,41 (la mezcla de magnitudes de los tres planos, no lineal y antes de la PSF, decorrela 0,05–0,11
más que la ley y sube N_eff un 4–12 %: un artefacto del modelo, no física del compuesto; con un plano, a
≤ 0,025); ρ(−,+) −0,003 / 0,014 / 0,27 / −0,035; N_eff 2,31 / 1,91 / 1,47 / 2,08; grano
compuesto/mirada 0 lateral 1,05 / 1,01 / 0,92 / 1,01 y axial 1,00–1,01; fracción oscura 0,06 → 0,003 /
0,005 / 0,012 / 0,003. Con ±6° N_eff 2,06 / 1,71 / 1,37 / 1,84 (grano a 90 mm 0,94) y con ±8° 2,55 /
2,10 / 1,57 / 2,31 (0,90). La umbra de una costilla de 12 mm a 18 mm acaba 2,8 mm antes (≈ 4,5 a ±8°) y
el refuerzo tras un vaso de 12 mm se ensancha +14 / +40 / +67 % a 80 / 110 / 150 mm. Ninguna de estas
cifras se ha medido con GPU: la GPU da una SNR de la mirada 0 0,05–0,1 más baja que el gemelo.

Métricas nuevas del banco con el compuesto (`fidelityStats` con las miradas del anillo): el hígado puro
es el de las tres miradas (cada dirigida con su peso entero y su transmisión con apertura a ≤ 0,5 dB del
rayo de la mirada 0: el AND de las penumbras); `compound.bands` (SNR de la mirada 0 y del compuesto,
ρ_I entre miradas con la compensación nominal en parches de 48 × 16, la ley con la σ del grano medido,
N_eff, oscuros, grietas, grano y la estadística de cada mirada), `compound.seam` (SNR con dos miradas / con
tres en parches de 8 × 48: con los 6 mm de margen al borde del sector solo caben en las bandas hondas),
`display.liverBands` (gris por banda) y `display.shadow.umbraShiftMm` (fin de la umbra a −40 dB respecto al
hígado en la transmisión de la pasada A, sin ruido, mediana de las líneas del núcleo cada 1 mm; mirada 0
menos compuesto; NaN si la mirada 0 no sale de −40 dB antes de 40 mm).

Objetivos con GPU (compuesto encendido, apnea, por banda de `DEPTH_BANDS_MM`; hoy fallan porque el
compuesto no existía; los fija este documento antes de medir y los verifica quien corre el banco):

| #   | Métrica                                                                         | Umbral                                                                                                                                                                         | Hoy (una mirada) | Predicción                                                                                      |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------- |
| G1  | SNR de la envolvente compuesta (bandas con ≥ 5 parches)                         | 2,1–3,0 en 20–60 y 140–180 mm; 2,0–3,0 en 60–140 mm; SNRc/SNR0 a ± 10 % de √N_eff medido                                                                                       | 1,87–1,97        | 2,4–3,1 (a 20 mm, 3,10 por el artefacto de la mezcla de planos; con el N_eff de la ley, ≈ 2,95) |
| G2  | Fracción oscura                                                                 | ≤ 0,035                                                                                                                                                                        | 0,063–0,071      | 0,003–0,012                                                                                     |
| G3  | Índice de grietas                                                               | ≤ 0,04                                                                                                                                                                         | 0,055–0,094      | 0,00–0,02                                                                                       |
| G4  | Desviación del gris del hígado puro por banda (≥ 1000 px)                       | 10,5–14,0; mediana del gris 90–110; θ se calibra en 6–8° para una mediana de 12–13 (absorbe el exceso de N_eff de la mezcla de planos: el θ calibrado no es una medida física) | 15,1–16,7        | 11–12,7                                                                                         |
| G5  | ρ(0,±) frente a la ley con la σ medida; N_eff                                   | ρ − ley en [−0,13; −0,03] (la predicción del gemelo de tres planos, −0,05 a −0,11, ± 0,02: la GPU hace la misma mezcla); N_eff entre la ley y +15 %                            | —                | ρ 0,23 / 0,42 / 0,65 / 0,35; N_eff +4–12 % sobre la ley                                         |
| G6  | Costura: SNR con 2 miradas / con 3 en la misma banda (parches 8 × 48)           | 0,80–0,95; NaN con < 5 parches; al menos una vista finita                                                                                                                      | 1,0              | 0,86–0,92 (diseño)                                                                              |
| G7  | Acortamiento de la umbra costal, compuesto frente a mirada 0 (flanco y renal)   | 1,5–8 mm                                                                                                                                                                       | 0                | ≈ 2,8 mm (≈ 4,5 a ±8°)                                                                          |
| G8  | Paridad de A2/A dirigidos con `steeredPrefixDb` y `steeredApertureTransmission` | ≤ 0,01 dB (`transmissionParity({ compound: true, look })`, sin las muestras en empate de redondeo: ±10⁻⁴ líneas, ≤ 1 %)                                                        | —                | empates 0,04–0,31 % (rejillas de CPU)                                                           |

Deben seguir pasando:

| #   | Condición                                                                                                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1  | Grano lateral ÷ PSF 0,8–1,25 por banda con el compuesto; y grano compuesto/mirada 0 0,9–1,1 (lateral y axial): separa la composición de un suavizado, que agranda el grano (el gemelo da 0,92 a 90 mm con ±7° y 0,90 con ±8°: cerca del suelo).                |
| K2  | Grano axial 0,5–0,9 mm.                                                                                                                                                                                                                                        |
| K3  | Lóbulos secundarios ≤ 0,15.                                                                                                                                                                                                                                    |
| K4  | Pendiente en profundidad 0 ± 0,3 dB/cm.                                                                                                                                                                                                                        |
| K5  | Por mirada (`compound.bands[].perLook`): SNR 1,75–2,1 y media a ± 3 % de la mirada 0 (la e2e admite ± 5 %).                                                                                                                                                    |
| K6  | Núcleo de la sombra costal ≥ 20 dB bajo el hígado con el compuesto (hoy 22,6–23,4).                                                                                                                                                                            |
| K7  | Escena quieta (`temporalStability`): correlación entre cuadros mostrados consecutivos ≥ 0,97 y modulación de periodo 3 ≤ 0,2 dB.                                                                                                                               |
| K8  | Rayo único de la mirada 0 ≤ 0,01 dB frente a la CPU; \|color − PW\| < 1 dB en la puerta renal.                                                                                                                                                                 |
| K9  | Color en la vista de la decisión 53: sangre ≥ 85 % e hígado ≤ 0,3 % (hoy 91 % y 0,07 %).                                                                                                                                                                       |
| K10 | Guardas de una mirada con `compound: false`, con los umbrales de hoy (SNR 1,6–2,25 y 1,75–2,1, oscuros 0,05–0,09, `speckleCrossfade` ± 15 %, `speckleMotion` ≥ 0,8 / ≥ 0,7 / < 0,3 / ≥ 0,9); la mirada 0 sigue el código de hoy (θ = 0) y K la pasa bit a bit. |
| K11 | `msPerFrame` ≤ 13,5 ms en las 8 escenas, con el color apagado y encendido, 3 corridas con el runner inactivo; ≥ 30 cps a densidad 2.                                                                                                                           |
| K12 | Gemelos de las decisiones 55 y 56 sin cambios.                                                                                                                                                                                                                 |

Informativas: borde de la sombra 10–90 % en ±20 líneas, refuerzo tras los vasos, ρ(−,+) (aliasing de línea,
`speckle-line-aliasing`), rosario del banco de interfaces (se espera × 0,65–0,85) y luz vascular (no se
puntúa aquí). La e2e «composición espacial» comprueba con SwiftShader G1–G4, K1, K5, la razón de grano, G8
y que `readEnvelope()` lanza si la mirada 0 no es la del último cuadro.

## Línea base (23-09-2026, árbol `src/` 4de3821, tras el preajuste abdominal; M4 con Metal, densidad 2)

| Escena                  | SNR  | Oscuros | Grietas | Grano axial / lateral ÷ PSF | Hígado p05/p50/p95 | Desviación | Luz | dB/cm | Pared 0–20° | Pared 20–40° | cps | ms sin / con color |
| ----------------------- | ---- | ------- | ------- | --------------------------- | ------------------ | ---------- | --- | ----- | ----------- | ------------ | --- | ------------------ |
| Sano, subxifoidea       | 1,93 | 0,065   | 0,083   | 0,69 mm / 0,94–0,99         | 73 / 100 / 124     | 15,7       | 9   | −0,01 | 1,26 (1)    | 1,10 (90)    | 48  | 7,5 / 6,9          |
| Sano, intercostal       | 1,93 | 0,068   | 0,071   | 0,70 mm / 0,82–1,10         | 71 / 99 / 124      | 16,1       | 20  | −0,13 | —           | 1,16 (24)    | 60  | 5,8 / 5,1          |
| Sano, flanco            | —    | —       | —       | —                           | 74 / 102 / 126     | 15,8       | 24  | 0,04  | 1,15 (25)   | 1,05 (10)    | 49  | 6,2 / 6,7          |
| Sano, renal             | —    | —       | —       | —                           | 74 / 102 / 126     | 16,0       | 21  | 0,30  | —           | —            | 56  | 6,0 / 6,5          |
| Congestión, subxifoidea | 1,90 | 0,067   | 0,064   | 0,70 mm / 0,93–1,07         | 73 / 101 / 126     | 16,0       | 10  | −0,01 | 1,24 (2)    | 1,08 (37)    | 53  | 7,0 / 6,7          |
| Congestión, intercostal | 1,93 | 0,069   | 0,055   | 0,68 mm / 0,91–1,02         | 73 / 101 / 124     | 15,8       | 8   | 0,07  | —           | 1,10 (37)    | 56  | 6,3 / 6,5          |
| Congestión, flanco      | 1,97 | 0,071   | 0,061   | 0,66 mm / 0,89              | 75 / 103 / 127     | 15,9       | 23  | 0,07  | 1,14 (34)   | 1,01 (6)     | 52  | 6,0 / 6,5          |
| Congestión, renal       | —    | —       | —       | —                           | 72 / 100 / 123     | 15,5       | 14  | —     | —           | 1,02 (9)     | 56  | 6,7 / 6,8          |

- **La envolvente es la de un moteado ideal** donde hay hígado despejado: SNR 1,90–1,97, fracción
  oscura 0,065–0,071, grietas 0,055–0,083, lóbulos ≤ 0,06 y grano lateral 0,82–1,10 × la PSF.
- **El preajuste abdominal (decisión 53) llevó el hígado a media escala:** mediana 141–147 → 99–103 y
  desviación 22–23 → 15–16, ya en el rango de los equipos modernos. La luz bajó de 14–37 a 8–24;
  sigue algo gris donde el vaso es pequeño (sangre a −31 dB del hígado).
- **La TGC está bien** una vez excluido el refuerzo posterior: −0,13 a +0,30 dB/cm.
- **No hay pared especular:** a cualquier incidencia la pared da lo que el moteado solo (1,0–1,3).
- En el flanco del sano y en las ventanas renales no queda hígado despejado para la textura.
- Las columnas de pared se midieron antes del banco de interfaces, con la ventana [−1,5; +1] mm y la
  normal del gradiente de `vesselHit.d` a 0,3 mm. La línea base del banco (por sistema, cápsula,
  diafragma y Morison) se re-mide con `npm run fidelity -- --sweep`: es el «antes» de los ecos de
  interfaz.

- **Coste del cuadro sin y con color:** el banco lo mide desde que `frameCostMs` puede forzar el cuadro
  con color (antes, con la caja abierta, la medida apenas dibujaba cuadros). La columna «ms sin / con
  color» es la mediana de 3 corridas del 24-09-2026 (árbol del PR que añadió la medida, M4, runner de
  EchoTwin parado pero con otra carga en la máquina, media de carga ≈ 5): la pasada de color cuesta
  ≤ 0,7 ms por cuadro, dentro del ruido entre corridas. El resto de columnas es de la línea base del
  23-09; `baseline.json` recibe `msPerFrameColor` la próxima vez que se regenere con `--sweep`. Con
  la misma carga, el árbol anterior daba 5,7–9,5 ms y este 5,3–8,0 (el transitorio ya no se evalúa
  bajo el ruido). Para atribuir el coste a una pasada: `frameCostMs(30, { repeatPass, repeatCount })`
  con 1 y 4 repeticiones; en el M4, B escala (≈ 2,3 ms por repetición con carga) y A cuesta ≈ 0,1 ms.

El detalle está en `baseline.json`. El árbol de `src/` identifica el código medido y sobrevive al
squash-merge (`git rev-parse <commit>:src`).

## Criterios de la tanda 1.5

Cada PR de imagen corre el banco antes y después y cita el cambio en su descripción. Orden revisado
con la línea base (primero la cadena de presentación, que es lo que delata la textura):

| PR  | Cambio                                                     | Aceptación medible                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0   | Este banco                                                 | Métricas reproducibles (± 0,01 entre corridas: el ruido del receptor cambia en cada cuadro); línea base en `baseline.json`.                                                                                                                                                                                                                                                                                                                                                    |
| 1   | Preajuste abdominal (hecho)                                | Hígado puro 99–103 de gris (objetivo 90–110) y desviación 15–16 (≤ 19); pendiente −0,13 a +0,30 dB/cm; diafragma nunca saturado; color en el hígado 0,07 % (antes 0,45 %). Luz 8–24: el ≤ 10 solo se cumple en 3 de 8 escenas y pasa al PR 2 (sangre con su propia población).                                                                                                                                                                                                 |
| 2   | Fase de insonación y moteado por tejido                    | Envolvente igual de ideal; correlación del moteado a través de una pared < 0,1; decorrelación con 8° de dirección < 0,3 [ESTIMADO].                                                                                                                                                                                                                                                                                                                                            |
| 3   | Transmisión O(N) con subrayos y hueso (hecho, decisión 54) | Pasada A ≥ 2× más rápida: el cuadro entero pasa de 12,9–16,3 a 4,6–7,3 ms (misma máquina y carga). Penumbra coherente con la apertura: el borde de la sombra del flanco es una rampa de −42 a −49 dB en 9 líneas (antes, un escalón de −31 a −50 en 4). Núcleo de la sombra costal 23–24 dB bajo el hígado, gris 30–35 (antes 20–24 dB, gris 32–41). **Parcial:** no llega al suelo de ruido + 3 dB, porque 10–40 mm detrás de la costilla el cono ya está destapado en parte. |
| 4a  | Composición espacial (decisión 58)                         | Objetivos con GPU (sección «Composición espacial», G1–G8 y K1–K12): SNR del compuesto 2,0–3,0 y ×√N_eff ± 10 %, fracción oscura ≤ 0,035, grietas ≤ 0,04, desviación del gris del hígado puro 10,5–14,0 por banda (θ se calibra en 6–8° para una mediana de 12–13), grano igual al de la mirada 0 (0,9–1,1), costura 0,80–0,95, umbra costal 1,5–8 mm más corta, paridad dirigida ≤ 0,01 dB, ≤ 13,5 ms y ≥ 30 cps a densidad 2. Después, punto de control A (prueba ciega).     |
| 4b  | Armónica (THI, decisión 59)                                | Grano lateral a 140–180 mm × 0,80–0,93, transitorio bajo −40 dB antes de 7 mm, reverberación de orden 2 ≤ −6 dB; la desviación del gris apenas cambia (−0,1 a +0,4 en los diseños). Se enciende por defecto solo si gana en el punto de control A.                                                                                                                                                                                                                             |
| 5a  | Banco de interfaces (hecho)                                | Banco por sistema y cara con huecos, rosario, anchura del eco, línea pleural, costura y desfase del espejo; normales de la GPU comprobadas; línea base con GPU (arriba). Sin cambio de imagen.                                                                                                                                                                                                                                                                                 |
| 5b  | Ecos de interfaz (decisión 57)                             | Pared/hígado 1,3–2,1 a 0–20° y caída con la incidencia en las suprahepáticas; sin huecos > 1 mm a lo largo de la pared. Medido con GPU: cápsula 1,64–1,89 sin huecos (antes 1,02–1,16 con 70–93 % de huecos), Morison 1,97/2,18, VCI 1,54–1,73 en la congestión y 1,23–1,51 en el sano; e2e: pico de las caras de tubo a < 15° con mediana ≥ 5 dB, cápsula ≥ 1,40 con ≥ 10 registros, costura ≤ 0,02 y espejo ≤ 0,05 mm.                                                       |

Los PR 6–10 (campo cercano, pulmón, microestructura, vasos y bordes orgánicos) añaden sus propias
métricas al banco cuando llegan; al final, punto de control B.

## Prueba ciega

`npm run fidelity:blind -- --out <carpeta>` monta las parejas simulada/real con la normalización del
informe y deja las claves aparte. Luego se lanzan los dos jueces de [juez-ciego.md](juez-ciego.md),
que solo pueden abrir las imágenes. Normalización idéntica para ambos lados:

- escala de grises;
- recorte rectangular dentro del sector, sin reglas, textos ni bordes del abanico (se comprueba que
  ninguna esquina sea negra);
- la misma resolución nativa en cada pareja y una escala física parecida;
- la misma recompresión JPEG;
- orden A/B sorteado con 3–4 reales en A.

Trampas que invalidan la prueba (aprendidas en la primera ronda): una regla o un borde del sector en
el recorte simulado, la misma imagen real en dos parejas y medir la luz vascular por su media en vez
de por su centro.

### Referencias reales (Wikimedia Commons)

| Imagen                                                                | Autor y licencia           |
| --------------------------------------------------------------------- | -------------------------- |
| `Ultrasonography_of_a_normal_liver.jpg`                               | Mikael Häggström, CC0      |
| `Ultrasound_liver_right_lobe_and_right_kidney.jpg`                    | Ptrump16, CC BY-SA 4.0     |
| `MorisonNoText.png`                                                   | Drahreg01, CC BY-SA 3.0    |
| `Ultrasound_image_IVC_110321140522_1406460.jpg` y otras 3 de la serie | Nevit Dilmen, CC BY-SA 3.0 |

Los recortes en grises son obras derivadas y conservan la licencia de su original; no se versionan
en el repositorio.
