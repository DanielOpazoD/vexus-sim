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
de las cinco poses (`sweep` en el JSON, con `summarizeFaces`): sin él, los tramos de 0–20° tienen
una o dos paredes por vista. Necesita GPU: con SwiftShader los cuadros por segundo no significan
nada, así que no corre en CI. En este Mac, espera a que no esté corriendo el runner de EchoTwin
(`pgrep -f /Users/daniel/builds/`).

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

- a ≥ 6 mm de cualquier tejido que no sea hígado (≥ 3 mm en la imagen mostrada), vasos incluidos
  (la `boundaryDistance` del hígado no cuenta los tubos);
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
añade la porta. En cada tramo:

| Métrica       | Definición                                                                                                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cociente y dB | Pico de gris en [−1,5 mm del borde; +0,5 mm del objetivo] frente a la mediana del hígado de referencia.                                                                                                                           |
| Huecos        | Fracción de líneas con el pico a < 6 dB (nivel mostrado) sobre el hígado.                                                                                                                                                         |
| Tramo         | Hueco más largo a lo largo de una pared: líneas de hueco consecutivas × paso de línea en el borde (mm).                                                                                                                           |
| Rosario       | CV del pico de envolvente de cada línea dividido por la mediana de sus vecinas a ±3 líneas de la misma pared.                                                                                                                     |
| FWHM del eco  | Anchura a −6 dB alrededor del pico de la envolvente, en pasos de 0,05 mm.                                                                                                                                                         |
| Pico          | Pico de la envolvente sobre la mediana del hígado de referencia (dB).                                                                                                                                                             |
| Diafragma     | Línea pleural (pico a ±1,5 mm del cruce exacto, bisección de 20 pasos en la CPU), desviación de su posición, costura (racha ≥ 0,3 mm de envolvente < hígado − 15 dB en [pleura; +2,5 mm]) y p95 del desfase del espejo de la GPU. |
| Cara saturada | Píxeles ≥ 250 a ≤ 1 mm de la cúpula, del contorno renal y de la vesícula.                                                                                                                                                         |

Las líneas pintadas de `src/validation/fidelity.test.ts` fijan cada métrica (una pared continua no
tiene huecos ni rosario; una línea de cada tres apagada da un tercio de huecos de un paso; ±6 dB al
azar dan rosario > 0,3; un eco gaussiano mide 2,355·σ; una costura de 0,5 mm cuenta en todas las
líneas). La e2e de normales compara la normal de la GPU (`queryPoints` con `normals`) con el
gradiente de `faceSdf` a 0,02–0,4 mm de cada cara, en los tejidos que la dibujan. Emulando la GLSL
en TS (sano en apnea): cúpula y vesícula dan |n·∇| ≥ 0,99 en p01 y el tubo ≥ 0,99 en p05. Tres
normales no son el gradiente y lo que exija el eco de interfaz se decide con estos datos:

- tubo: la tapa elíptica de la VCI dentro de la aurícula (la normal escala la sección una vez; el
  gradiente, dos) y las uniones de tubos bajan el p01 de la subxifoidea a 0,95 (2,5 % bajo 0,98);
- riñón: junto a la escotadura hiliar la normal es la del elipsoide sin escotadura (ventana renal:
  0,61 en p01, 15 % bajo 0,98);
- cápsula hepática: `liverSdf` elige la normal de una de las superficies que funde con `smoothMax`;
  en la impresión renal (83 % de sus puntos bajo 0,98) y en la unión de los lóbulos se aparta del
  gradiente (p05 de 0,45 a 0,98 según la vista); donde manda la pared o la cúpula es exacta.

La e2e exige lo que ya se cumple (mediana ≥ 0,99 en todas las caras, p05 ≥ 0,98 en el tubo, p01 ≥
0,98 en la cúpula y la vesícula) e informa del resto en sus anotaciones.

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
