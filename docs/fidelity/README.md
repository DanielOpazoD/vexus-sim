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
de las cinco poses (`sweep` en el JSON, con `summarizeFaces`). No llena todos los tramos que vigila
el PR 5b: las suprahepáticas y el diafragma a 0–20° quedan casi vacíos (ver «Qué llena el barrido»),
y cada escena lista en `escasos` los tramos vigilados sin 10 registros o sin rosario. Necesita GPU:
con SwiftShader los cuadros por segundo no significan nada, así que no corre en CI. En este Mac,
espera a que no esté corriendo el runner de EchoTwin (`pgrep -f /Users/daniel/builds/`).

El gancho `window.__vexusTest.fidelity({ startPoint, display, pose, samples })` da las mismas métricas
desde la consola o una e2e; sin `display` solo mide la envolvente (sirve con SwiftShader). `pose`
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

| Métrica                 | Definición                                                                                                                                                                                                                                                                                               | Referencia real                                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gris del hígado         | Media, desviación y percentiles 5/50/95 del gris 0–255.                                                                                                                                                                                                                                                  | Media 52–112; desviación 10–16 en equipos modernos (THI y composición espacial), 21–25 en moteado crudo [MEDIDO en las referencias de la tanda 1.5] |
| Huecos a la vista       | Píxeles por debajo de la mitad de la media.                                                                                                                                                                                                                                                              | [ESTIMADO] se calibra con las referencias                                                                                                           |
| Perfil en profundidad   | Nivel mostrado (dB bajo el techo, invirtiendo la curva de grises) por bandas de 10 mm; pendiente.                                                                                                                                                                                                        | 0 ± 0,3 dB/cm con la TGC bien ajustada [ESTIMADO]                                                                                                   |
| Centro de la luz        | Mediana del gris de la sangre a ≥ 1,5 mm de su pared, sin sombra delante.                                                                                                                                                                                                                                | Casi negro: 0,6–9,6 [MEDIDO en las referencias, mínimo en 7×7]                                                                                      |
| Diafragma saturado      | Fracción de los píxeles del diafragma en el blanco (≥ 250).                                                                                                                                                                                                                                              | ≤ 2 % [ESTIMADO]                                                                                                                                    |
| Pared anterior / hígado | Pico de gris en [−1,5 mm del borde; +0,5 mm de la primera celda de sangre] de la VCI o una suprahepática frente a la mediana del hígado en [−10; −3] mm, por tramos de incidencia (0–20°, 20–40°, 40–60°) sobre la normal real de la pared (gradiente de `faceSdf`). Sin pared, el moteado solo da ~1,1. | 1,36–2,1 [MEDIDO en las referencias, 3 perfiles de incidencia desconocida]                                                                          |
| Cuadros por segundo     | Lectura del HUD tras 3 s en tiempo real.                                                                                                                                                                                                                                                                 | ≥ 30 (guía)                                                                                                                                         |

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
| Suelo espejo  | `mirrorFloorMm`: p95 del desfase que da la marcha gruesa de la pasada A sola (emulada en la CPU), el suelo del anterior.                                                                                                          |
| Cara saturada | Píxeles ≥ 250 a ≤ 1 mm de la cúpula, del contorno renal y de la vesícula.                                                                                                                                                         |

El desfase del espejo tiene un suelo que no es de geometría: la pasada A pone hoy el espejo en el
centro del primer segmento grueso de pulmón (paso = profundidad/160, 1,125 mm a 18 cm), así que
|espejo − pleura| cae en [0; paso) y su p95 ronda 1 mm aunque la cúpula esté en su sitio (0,002–1,10 mm,
p95 1,02, en las 33 líneas de la subxifoidea del sano). Mientras `mirrorOffsetMm` ≈ `mirrorFloorMm`, el
espejo está donde la marcha gruesa lo pone; la puerta de 5b (p95 ≤ 0,05 mm) exige colocarlo en el
cruce exacto y solo entonces baja del suelo.

Las líneas pintadas de `src/validation/fidelity.test.ts` fijan cada métrica (una pared continua no
tiene huecos ni rosario; una línea de cada tres apagada da un tercio de huecos de un paso; ±6 dB al
azar dan rosario > 0,3; un eco gaussiano mide 2,355·σ; una costura de 0,5 mm cuenta en todas las
líneas; con 3 dB/cm de atenuación, el eco compensado mide lo mismo con la referencia encima o debajo).
La e2e de normales compara la normal de la GPU (`queryPoints` con `normals`) con el
gradiente de `faceSdf` a 0,02–0,4 mm de cada cara, en los tejidos que la dibujan, con una fila por
cara y otras por subconjunto (`FACE_NORMAL_SUBSETS`: la VCI, su cuerpo y el riñón con y sin
escotadura, muestreados aparte). Emulando la GLSL en TS (sano en apnea): cúpula y vesícula dan
|n·∇| ≥ 0,99 en p01 y el tubo, mezclando todos los vasos, ≥ 0,99 en p05. Tres normales no son el
gradiente y lo que exija el eco de interfaz se decide con estos datos:

- tubo: la VCI (`tubeIvc`) no coincide en todo su cuerpo, no solo en la tapa. Su sección es elíptica y
  la normal de la GPU (`tubeQuery`, d/dist) escala la componente anteroposterior una vez, mientras el
  gradiente la escala dos. En el cuerpo (`tubeIvcBody`, 0 < s < 1 en su segmento) |n·∇| va de 0,991 a
  0,996 (p01–p50) con `ivcApScale` 0,777 (apnea; 6–8°), y el mínimo analítico baja a 0,984 (10°) con
  0,70, que el sano alcanza respirando. En la fila del tubo no se ve; la tapa dentro de la aurícula y las
  uniones de tubos bajan además su p01 a 0,95 en la subxifoidea (2,5 % bajo 0,98). Es la pared que 5b
  hará brillar por incidencia: allí la normal debe salir del gradiente (la componente AP dividida dos
  veces por `apScale`) y la fila de la VCI exigirse ≥ 0,99 en p05;
- riñón: junto a la escotadura hiliar (`kidneyOuterNotch`, solo en la ventana renal) la normal es la
  del elipsoide sin escotadura: la fila entera da 0,61 en p01 (15 % bajo 0,98). Fuera del redondeo de la
  escotadura (`kidneyOuterNotchFree`, `hilumNotchActive`) es exacta (≥ 0,9999);
- cápsula hepática: `liverSdf` elige la normal de una de las superficies que funde con `smoothMax`;
  en la impresión renal (83 % de sus puntos bajo 0,98) y en la unión de los lóbulos se aparta del
  gradiente (p05 de 0,45 a 0,98 según la vista); donde manda la pared o la cúpula es exacta.

La e2e exige lo que ya se cumple (mediana ≥ 0,99 en todas las caras, p05 ≥ 0,98 en el tubo, p01 ≥
0,98 en la cúpula, la vesícula y el riñón sin escotadura) e informa del resto en sus anotaciones, con
las filas de la VCI y de la escotadura.

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
de ±6°.

## Línea base (23-09-2026, árbol `src/` 4de3821, tras el preajuste abdominal; M4 con Metal, densidad 2)

| Escena                  | SNR  | Oscuros | Grietas | Grano axial / lateral ÷ PSF | Hígado p05/p50/p95 | Desviación | Luz | dB/cm | Pared 0–20° | Pared 20–40° | cps |
| ----------------------- | ---- | ------- | ------- | --------------------------- | ------------------ | ---------- | --- | ----- | ----------- | ------------ | --- |
| Sano, subxifoidea       | 1,93 | 0,065   | 0,083   | 0,69 mm / 0,94–0,99         | 73 / 100 / 124     | 15,7       | 9   | −0,01 | 1,26 (1)    | 1,10 (90)    | 48  |
| Sano, intercostal       | 1,93 | 0,068   | 0,071   | 0,70 mm / 0,82–1,10         | 71 / 99 / 124      | 16,1       | 20  | −0,13 | —           | 1,16 (24)    | 60  |
| Sano, flanco            | —    | —       | —       | —                           | 74 / 102 / 126     | 15,8       | 24  | 0,04  | 1,15 (25)   | 1,05 (10)    | 49  |
| Sano, renal             | —    | —       | —       | —                           | 74 / 102 / 126     | 16,0       | 21  | 0,30  | —           | —            | 56  |
| Congestión, subxifoidea | 1,90 | 0,067   | 0,064   | 0,70 mm / 0,93–1,07         | 73 / 101 / 126     | 16,0       | 10  | −0,01 | 1,24 (2)    | 1,08 (37)    | 53  |
| Congestión, intercostal | 1,93 | 0,069   | 0,055   | 0,68 mm / 0,91–1,02         | 73 / 101 / 124     | 15,8       | 8   | 0,07  | —           | 1,10 (37)    | 56  |
| Congestión, flanco      | 1,97 | 0,071   | 0,061   | 0,66 mm / 0,89              | 75 / 103 / 127     | 15,9       | 23  | 0,07  | 1,14 (34)   | 1,01 (6)     | 52  |
| Congestión, renal       | —    | —       | —       | —                           | 72 / 100 / 123     | 15,5       | 14  | —     | —           | 1,02 (9)     | 56  |

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
| 4   | Composición espacial y armónica                            | Desviación del gris del hígado 10–16; ≥ 30 cps a densidad 2. Después, punto de control A (prueba ciega).                                                                                                                                                                                                                                                                                                                                                                       |
| 5   | Interfaces de Fresnel                                      | Pared/hígado 1,3–2,1 a 0–20° (hoy 1,14–1,19, lo que da el moteado solo) y caída con la incidencia en las suprahepáticas; sin huecos > 1 mm a lo largo de la pared.                                                                                                                                                                                                                                                                                                             |

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
