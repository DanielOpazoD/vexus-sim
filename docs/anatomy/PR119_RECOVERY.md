# Candidato local de recuperación de PR119

**Registro del primer candidato, sobre PR143.** Las cifras y bloqueos que siguen pertenecen a
`6d6fb6d87d5e460dcf63c38a4dad863e6ab7d638`. La combinación aislada posterior con PR144 y sus resultados
distintos se documentan en [PR119_PR144_RECOVERY.md](PR119_PR144_RECOVERY.md); este registro se conserva.

Estado: provisional, sin integrar ni publicar. Base `a3a5b8fb94dd8683fd72a6beb7ee8da2b2f94281` (PR143);
segundo padre `bd35838bed6201ce38eaca5ce23948f712290120` (PR119). El candidato se conserva como merge local WIP para revisión; no es apto para integrar mientras sus gates estén rojos. No se han modificado ramas fuente, PR142, PR144 ni `hepatic-boundary-separation`.

Este archivo no asigna decisiones 106/107/108 ni altera la secuencia 1..105. Si el candidato supera la verificación,
el coordinador decidirá si documentar una revisión de la 103 y actualizará limitaciones, aproximaciones e índice.
Las fichas actuales que aún describen columna continua son el estado previo integrado, no una validación del candidato.

## Contenido recuperado

- Cuerpos elípticos de misma área que el círculo anterior, niveles de 24 mm cada 31 y discos de 7 mm, con bordes redondeados;
  funciones de distancia TS y GLSL con las mismas constantes y disco que rellena el cilindro sin surco artificial.
- Clasificación de cuerpo/disco y distancia a la frontera que cuenta hueso y disco, más normales/curvatura del cuerpo y platillos.
- Nodos superiores del psoas y pruebas originales de holgura fina; sincronización del tamaño/espaciado vertebral en 3D.
- Las ocho pruebas originales de `spine.test.ts`, cobertura de discos/cortical en equivalencia y fila de normales `spine`.
  Se mantienen las guardas originales de sección, continuidad, holgura, ángulo, número de líneas y acuerdo GPU.

## Conciliación explícita con el código posterior

| Contrato                    | Candidato                                                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identificadores de interfaz | Reutiliza `VertebralCortex=25`; conserva `BowelLumen=23`, `BowelSerosa=24` e `INTERFACE_COUNT=26`.                                                                    |
| Propiedad de cortical       | Conserva los cuatro dueños protegidos por PR139 y el veto a sustituir otra interfaz. Añade solo cartílago dentro del disco, dueño de platillos original de PR119.     |
| Cápsulas suprimidas         | Conserva el caso de regresión real `[-14.1,-30.3,46.9]` y su expectativa de cápsula sin interfaz. No vuelve a la regla amplia «todo tejido no gaseoso» de PR119.      |
| Física del eco              | Conserva tabla, Fresnel, rugosidad, ventana angular, opacidad y ausencia de retrodispersión de PR139; alimenta curvatura geométrica elíptica/platillos en vez de 1/r. |
| Alcance                     | Mantiene banda conservadora 5 mm de PR139; no arrastra corte 1,3 mm previo a la transformación de facetas. El perfil acústico efectivo no cambia.                     |
| Intestino y vesícula        | Mantiene clasificación y curvatura intestinales, normales de vesícula y facetas materiales bajo compresión de PR136.                                                  |
| Perfil de referencia        | Conserva offset vertebral de referencia de −14,02345 mm y costillas compartidas. Amplía los puntos dirigidos GPU a costados elípticos y platillos en ambos cuerpos.   |
| Presupuestos/gates          | Conserva archivos actuales. No se arrastra aumento 335→337 KiB de PR119 ni se reduce cobertura/tolerancias.                                                           |
| Atribución anatómica        | Dimensiones/niveles/ubicación son aproximados o estimados. Cartílago costal como fibrocartílago discal sigue siendo extrapolación propia.                             |

La regla de dueños de PR139 puede impedir parte de las líneas brillantes de PR119 que antes tomaban la muestra hepática.
Se conserva la guarda original de ≥20 líneas a <30° y≥3 grupos discales; si falla, es una incompatibilidad que debe reportarse,
no una autorización para reducirla o volver a pintar cortical sobre órganos. Aún falta acreditar holguras y adquisición
para el cuerpo de referencia, que no existía cuando se midió PR119.

## Verificación ejecutada y bloqueos medidos

- `npm run typecheck`: pasa, exit 0.
- Focused con `VITEST_TIER=all`, `--maxWorkers=1` y `--testTimeout=180000`: 9 archivos, 111 pruebas,
  **110 pasan y 1 falla**. Único fallo: `spine.test.ts`, guarda subxifoidea de ≥20 líneas a <30°; se obtienen 13.
  Las otras 7 propiedades de columna pasan, junto a propiedad cortical de PR139, psoas/holguras,
  puntos de partida, órganos, gradientes, bindings GLSL, eco y pared. Duración 56,66 s.
- `npm run build`: tipos y Vite compilan; todos los límites por chunk pasan, pero el presupuesto total falla:
  **1.050.597 bytes JS frente al límite 1.048.576; exceso 2.021 bytes**. No se ha cambiado el presupuesto.
- El diagnóstico independiente conserva 13 líneas que llegan al disco y 4 grupos discales: las guardas originales
  ≥8 líneas/≥3 grupos se satisfacen. La aserción cortical previa impide que el test original llegue a ellas.

### Causa aislada del fallo anatómico

Bajo la regla de propiedad de PR139 hay 13 líneas corticales. Aplicando el predicado original de PR119 a las mismas
muestras geométricas habría 35. Las 22 líneas adicionales pertenecen a `Liver/None`, no a un dueño permitido por PR139.
Ejemplo: línea 14, punto `[-13.581912438349825,-33.94478058694987,-32.21850897122615]`, incidencia 25,656667°.

Una mutación local temporal **solo del predicado CPU** restaura la regla original de PR119 (todo tejido no gaseoso,
la superficie más cercana y alcance 1,3 mm). Se ejecutan sin modificar aserciones los tests de subxifoidea y propiedad:
la guarda ≥20 pasa y la protección de PR139 falla, al encontrar `Tissue.Liver` entre los dueños corticales.
La mutación no se publicó ni compiló como producto; se restauró `scene.ts` byte por byte en `finally`.
SHA256 restaurado: `24eb34b331b6ad7aa3b1cb879ba2071f143b3b1c714a82dbd6cc9a2e6c40ded9`.

En la rejilla exacta de la prueba de propiedad, el predicado original también asignaría:

| Tejido/interfaz actual      | Muestras adicionales | Ejemplo         |
| --------------------------- | -------------------: | --------------- |
| `Liver/None`                |                   51 | `[-20,-50,-19]` |
| `LiverCapsule/LiverCapsule` |                    1 | `[-20,-47,-30]` |
| `Diaphragm/None`            |                    6 | `[-20,-47,47]`  |
| `Diaphragm/DiaphragmLiver`  |                    5 | `[-17,-38,47]`  |

Por tanto no es un marcador de merge olvidado: restaurar sin más el comportamiento original recupera la visibilidad
pero vuelve a asignar cortical a hígado/cápsula/diafragma, incluyendo caras con otro dueño. Resolverlo requiere una
revisión explícita del contrato de propiedad y evidencia física/visual; no se ha inventado una tercera regla ni
rebajado ≥20. El candidato preserva el estado seguro de PR139 y queda rojo como testigo de esta incompatibilidad.

### Trabajo restante

No se ha ejecutado check completo, cobertura ni E2E/comparadores GPU del candidato rojo. Se requieren una decisión
coordinada sobre propiedad cortical/tejidos, una solución geométrica o acústica respaldada que pase ambas intenciones,
optimización real de al menos 2.021 bytes sin pérdida funcional, y después tipos/lint/formato, suite completa,
paridad dirigida/volumen/cáscara en ambos cuerpos, comparadores y E2E sobre el SHA exacto.

PR142 y PR144 siguen bajo control del otro operador. En particular PR144 agrega `blendMm` opcional a `sdSpine`
para la envolvente de exclusión hepática, sin modificar hueso con 0; este candidato no incorpora esa rama ni su packing.
La firma y semántica deberán conciliarse expresamente cuando el coordinador autorice continuar la recuperación.

Las cifras M4, ruido, PSF, pleura, alias de decisiones y 26/28 E2E del anexo son evidencia histórica de PR119.
No equivalen a resultados del candidato, CI actual ni validación clínica; no justifican reintentos ni gates relajados.

## Archivo histórico de PR119

La siguiente decisión92 pertenece exclusivamente a `bd35838`; no ocupa la decisión92 actual de main.
Se conserva para evitar perder diagnóstico, limitaciones, alternativas descartadas y resultados históricos únicos.

## 92. Columna con cortical y discos: lo que había tras la VCI en la subxifoidea era la sombra de un cuerpo vertebral sin cara, no pulmón

**Contexto.** Sirve a los objetivos 2 (fidelidad ecográfica) y 3 (fidelidad anatómica) de `docs/MISION.md`. En las rondas
3, 4 y 5 del juez ciego, en la subxifoidea en eje largo (`normal-adult/subxiphoid`, recorte [880, 500, 520] de la captura
de 1440 × 900 con DPR 2, armónica, apnea espiratoria), bajo y a la derecha de la VCI «el tejido termina en un arco liso y
blando contra una zona negra», «sin eco de interfaz, sin espejo y sin reverberación»: «no es una sombra, porque no sigue las
líneas del haz, ni un órgano, porque no tiene interfaz». Sobrevivió a la decisión 85 (corazón y mediastino), que la
atribuyó al pulmón de encima de la cúpula. Antes de tocar nada se midió (`scratchpad/mirror/`, GPU real: M4, Metal,
armónica y compuesto, apnea espiratoria, `main` a386e5e): por línea, las salidas de A0 (espejo, gas, hueso, dirección
reflejada), la clasificación de TS a lo largo del camino que sigue la pasada B (recto hasta el espejo, reflejado después),
la transmisión de A y la envolvente compuesta, con el mapa de tejidos en la geometría exacta de la captura
(`probe.mts`, `overlay.mts`):

- **No era pulmón.** El recorte cubre θ 0…−34° y r 66–144 mm; en ninguna de sus líneas hay pulmón, cúpula ni espejo (el
  espejo solo aparece con θ > 0, detrás de la AD y del mediastino). La zona negra es, píxel a píxel, **la columna**: 100 de
  las 192 líneas (las de θ < 0) llegan con hígado delante al cuerpo vertebral a 122–135 mm, y la entrada en el hueso (100
  dB, decisión 88) deja la sombra limpia a −31/−35 dB del hígado, el suelo de ruido. El arco es la cara del cuerpo, un
  cilindro de 34 mm que el plano corta por su costado (x ≈ −13): el haz la toca a 44–50° (mediana 45°, en el marco de la
  sonda hundida), el cuerpo no tenía cortical (`vertebra-no-cortex`) y su borde solo lo dibujaba la banda de su propio
  moteado (pico −0,7…+4,7 dB sobre el hígado de 4–14 mm por encima), ablandada por la penumbra de la apertura y por la
  rodaja, que corta oblicua esa cara. Y era una sombra sin bordes a lo largo del haz porque el cilindro era continuo:
  sin discos, 11 cm de hueso liso de borde a borde del sector.
- **El diafragma y el pulmón de esa vista.** Con θ > 0 (líneas 98–167) el haz llega al pulmón de detrás del corazón y del
  mediastino a 42–58°: el eco de la pleura (el lóbulo de s 0,21) queda allí > 40 dB bajo el de frente, como debe, y el espejo
  (decisión 57, con la normal de la frontera del mediastino de la 85) dibuja la imagen del mediastino y del hígado, no un
  vacío. Solo las líneas 152–167, en el borde izquierdo y fuera del recorte, devuelven el camino reflejado al pulmón y quedan
  en franjas oscuras (`mediastinal-mirror-normal-approx`, sin cambios).
- **El borde radial en θ ≈ 0** (un panel de evaluación de `main` lo atribuyó a que el espejo se decide línea a línea, sí o no,
  sin la anchura del haz) separa las líneas que llegan antes al pulmón de detrás del corazón (espejo: la imagen del mediastino)
  de las que llegan antes al cuerpo vertebral (su sombra): lo negro de la derecha es hueso, no un espejo que falta. Su anchura
  10–90 % en la envolvente es de 2,5 mm a 140 mm de profundidad, frente a una FWHM lateral del haz de 3,0 mm: la PSF lateral de
  la pasada D ya mezcla las líneas vecinas como lo haría un haz que cae a medias en el pulmón. El espejo por línea sí deja
  franjas donde el camino reflejado vuelve al pulmón o al hueso a < 15 mm (en la subxifoidea, 10 de las 71 líneas con espejo: la
  97, justo en la transición, y las 148–167 del borde izquierdo; en la intercostal, 23 de 29, hacia la columna y el pulmón del
  receso): ahí un espejo ponderado por la fracción del cono que se refleja sería lo físico (pendiente).
- **La misma columna sin cara** en la intercostal (51 líneas: la mancha oscura de borde curvo del ángulo inferior, la «zona
  negra de borde curvo sin correlato» de la ronda 3), en la epigástrica (63: la cúpula oscura sobre la sombra, declarada en
  la decisión 83) y en la renal (17). El flanco, la subcostal y la portal no la ven.

**Opciones.** (1) Aclarar la sombra o pintar su borde: prohibido (§23, criterio 1). (2) Solo la cortical de la costilla sobre
el cilindro de 34 mm: a 44–50° su lóbulo (s 0,15) queda > 40 dB bajo el de frente y la difusa del hueso es 0 más allá del
ángulo crítico (26,9°, decisión 88): el recorte no cambiaría. (3) Una cortical rugosa (s ≈ 0,5) que brillara a 45–60°:
pendientes de 25–35° a la escala del haz no son un cuerpo vertebral. (4) El disco como tejido nuevo: con 33 tejidos
`TISSUE_VEC4` pasa de 8 a 9 y el programa dirigido de B, de 129 a 131 ranuras (tope 130). (5) El pilar derecho del
diafragma entre la VCI y la columna: otro órgano, pendiente. (6) La elegida: la sección real del cuerpo, su cortical con la
física de la costal y los discos (el navegador 3D ya dibujaba vértebras separadas cada 28 mm; la imagen, un cilindro).

**Decisión.**

- **Cuerpos elípticos con discos** (`anatomy/primitives.ts`: `SPINE_SHAPE`, `spineEllipseSd`, `spineSlabSd`, `spineArchSd`,
  `spineBodySd`, `spineDistances`, `sdSpine`, `sdSpineDisc`; gemelos GLSL `spineBodyParts`, `spineBodySd`, `spineArchSd` con
  las constantes interpoladas): la sección del cuerpo es una elipse de semiejes r·1,1765 y r/1,1765 con el r 17 de la escena,
  40 × 28,9 mm [LITERATURA aprox.: Panjabi y cols., Spine 1991;16:888 y 1992;17:299, platillos de T11–L1 de 37–42 × 29–33 mm:
  el fondo queda en su borde inferior], la misma área que el círculo; r conserva su valor, así que el peso respiratorio
  (`respiratoryWeight`, que solo usa r) no cambia. Cuerpos de 24 mm cada 31 (discos de 7 mm; en la unión toracolumbar,
  cuerpos de 22–25 y discos de 5–8) con el de T12 centrado en z −20: el plano de la transversa epigástrica lo corta por la
  mitad, el celíaco queda en T12, la mesentérica superior en L1 y las renales en L1–L2 [ESTIMADO]; el borde del platillo,
  redondeado 1,5 mm. El disco es el cilindro de los cuerpos fuera del hueso de un cuerpo: los dos llenan el cilindro, también
  en el borde redondeado (con el corte recto del disco quedaba ahí un surco de hasta 0,375 mm con el tejido vecino, pulmón
  junto a T11–T12: lo halló la revisión). El arco posterior sigue siendo una caja continua.
- **Clasificación** (`AnatomyScene.classify`, GLSL `classifyWith`, mismo orden): tras la pared, el hueso (vértebra), el disco
  (el tejido del cartílago, que pasa a llamarse «cartílago»: el costal y el fibrocartílago del disco [EXTRAPOLACIÓN PROPIA]) y
  el resto (`classifyInside`, la clasificación de antes). Al final, en la muestra de fuera del hueso (`withSpineFace`): su
  distancia a la frontera cuenta el hueso y el disco (antes el hígado que la columna recorta no la contaba: en la
  subxifoidea, 134 de 142 muestras de hígado a 1,5–3 mm del hueso la tenían mayor, hasta 2,1 mm), y si no es gas, está a
  menos de `SPINE_FACE_MM` (1,3 mm: el alcance de una cara de un lado, 0,84 mm, por la cota de |∇| de la salida barata) de un
  cuerpo, el cuerpo es el hueso más cercano y la cara es la más cercana de las suyas, dibuja la cara nueva
  `Interface.VertebraCortex` (`IF_VERTEBRA`, 23; `INTERFACE_COUNT` 24) a la distancia del cuerpo. El arco no dibuja cara:
  una caja con cortical pintaba dos barras blancas horizontales a los lados del cuerpo en la epigástrica (capturas).
- **La cara** tiene la física de la cortical costal (decisiones 62 y 88): Fresnel músculo/hueso 0,59, σz 0,045 y s 0,15; se
  ilumina solo desde fuera (`faceLitFromProbe`), su difusa se apaga en el ángulo crítico (`boneDiffuseWindow`; las dos reglas
  con `isBoneCortex`) y lleva la coherencia de curvatura del costado del cuerpo (la curvatura de la elipse, `spineFaceCurvature`,
  con el eje en z; 0 en los platillos). Su gradiente es el numérico de `spineBodySd` (`faceGradient`, la primera rama de la
  GLSL: la cápsula o el diafragma también pueden dibujarla; TS: `faceSdf('spine')`).
- La vértebra pierde su retrodispersión propia (0,9 → 0), como el hueso de las costillas en la 88.
- **Psoas** (`organs/retroperitoneum.ts`): con el cuerpo 3 mm más ancho el psoas, pegado a su costado, entraba 2 mm en el
  hueso; el nodo de T12–L1 pasa de x 22 a 25 y el de L2 de (30, −45,5; r 12) a (31,4, −46,5; r 10,5): en una rejilla de 0,1 mm
  queda a 0,78 mm del hueso y a 0,61 de la grasa perirrenal (en `main`, 0,50 y 0,47), también en la congestión grave.
- **3D**: los cuerpos de la imagen (elípticos, de 24 mm cada 31) en lugar de cilindros de 22 mm cada 28 que la imagen no tenía.

**Consecuencias.** Con GPU (M4, armónica y compuesto, apnea espiratoria; `main` a386e5e → rama):

- **Subxifoidea (el recorte del juez)**: el haz toca el costado anterolateral de los cuerpos a 24–36° (mediana 26°; antes
  44–50°) y 43 de 97 líneas tienen la cara (34 a < 30°; antes, 0). Pico de la envolvente sobre el hígado de 4–14 mm por
  encima: +3,7 / −0,7 / +4,7 → +19,9 / +20,4 / +17,0 dB en las líneas de la derecha (u30, u36, u42) y −0,7 / −0,2 → +4,2 /
  +0,3 dB junto a θ 0 (u84, u90), donde la incidencia pasa de 30°. La sombra de debajo no cambia (−31/−35 dB). Once líneas
  llegan a un disco antes que al hueso: en la sombra quedan columnas del disco a −23/−26 dB del hígado, frente a −34/−36 de la
  sombra vecina, con los bordes a lo largo del haz; la línea brillante se corta en cada disco. La congestión grave, igual
  (43 líneas con cara, 35 a < 30°).
- **Epigástrica**: la cara anterior del cuerpo brilla en su vértice («la sonrisa»: +2,0…+6,4 → +14…+35 dB en las líneas
  u88–u104, a 0–24°); los hombros del arco siguen oscuros. **Intercostal**: el borde redondo del cuerpo, de +2,2 / +1,6 / −5,1
  a +15,0 / +34,5 / +20,7 dB (u132–u140, a 8–30°). Renal: 3 líneas con cara, a > 45°.
- **Lo que no cambia**: banco de fidelidad (M4, las ocho escenas): gris y SNR del hígado, grano y las caras (VCI, VSH,
  peritoneo, cápsula, Morison) iguales dentro del ruido; la sombra de la subxifoidea tiene ahora las columnas de los discos
  (su perfil, −52 → −57…−42 dB) y la de la renal se queda sin «núcleo» (los discos cortan la tirada de ≥ 7 líneas bajo la
  vértebra). Un efecto de lado: la luz de la arteria renal derecha entraba 1,2 mm en el cilindro de antes, donde era hueso;
  ahora pasa a 1,3 mm del cuerpo. La VCI queda a ≥ 8 mm de la columna: el sitio de medida, su diámetro y la AD no cambian.
- **Lo que sigue oscuro**: las caras del cuerpo a más de ~30–35° de incidencia (la mitad izquierda de la columna de la
  subxifoidea, el costado del cuerpo en la intercostal) y el arco posterior, una caja sin cortical (acaban en él 21 de las 192
  líneas de la intercostal y 28 de la epigástrica, los «hombros» de la sombra), siguen siendo un borde de tejido contra la
  sombra, sin línea, como en `main` (la cortical de la costal tampoco brilla allí; la del arco, `spine-schematic`).
- **Equivalencia TS ↔ GLSL** con Metal: volumen de 50 000 puntos 1,000 (1739 de vértebra y 162 de disco), cáscara de las caras
  1,000 (1518 puntos de la cortical vertebral; |Δifd| ≤ 1·10⁻⁴ mm) y barrido de las siete ventanas 1,000; normales de la
  cara de la GPU frente al gradiente de TS, p01 0,99999996 en la subxifoidea, la intercostal y la renal, norma p95 ≤ 2·10⁻⁴.
- **Coste** (M4, cuatro rondas alternas, medianas): cuadro de la subxifoidea 9,34 → 9,30 ms, epigástrica 11,18 → 11,41,
  intercostal 12,97 → 12,90, renal 10,55 → 10,62 (sano); 9,35 → 9,69, 11,50 → 11,83, 12,67 → 12,99, 10,57 → 10,35 (grave):
  dentro del ruido (±1 ms). Arranque con SwiftShader (`scratchpad/gb/boottime.mts`, seis rondas alternas, carga 3–5): 27,8–28,2 s
  en `main` y 26,9–28,1 en la rama, mediana 27,9 s en los dos.
- **Presupuestos**: la pasada B, de 126 a 127 ranuras en la mirada 0 y de 128 a 129 en la dirigida (la fila de la cara en
  `uIface`; tope 130). Índice 333,7 → 336,1 kB (vite build sobre `main` a386e5e: la GLSL de la columna y de su cara en todas
  las pasadas que clasifican y sus gemelos TS): el presupuesto sube de 335 a 337 kB (`tools/ci/bundle-budget.ts`, con su nota).
- **Limitaciones**: se retira `vertebra-no-cortex`; nueva `spine-schematic` (columna recta de cuerpos elípticos iguales, sin
  cintura, lordosis ni cifosis y con niveles uniformes; arco posterior en caja continua, sin cortical, canal ni forámenes, así
  que tras el disco no se ve el complejo posterior; sin pilares del diafragma entre la VCI y la columna; el disco con las
  propiedades del cartílago costal). Pendientes: el pilar derecho del diafragma detrás de la VCI, el complejo posterior tras
  los discos y el espejo del pulmón junto al mediastino (las franjas oscuras del borde izquierdo de la subxifoidea).
- **La cara diafragma/pulmón, medida y fuera de esta decisión.** Un panel de evaluación de `main` la vio «nunca brillante».
  Con GPU, en la rama (pico en ±2 mm del cruce del espejo frente al hígado de 4–14 mm por encima de la misma línea): +6–11 dB
  a 10–30° de incidencia, +0–5 dB a 40–90° (subxifoidea, subcostal, flanco e intercostal, en sus poses y basculadas 25°), la
  incidencia de casi toda la cúpula en esas vistas. La imagen en espejo del hígado sí está, a −1–5 dB del hígado de encima, pero
  sin línea que la separe se lee como hígado que sigue. La causa: la pleura es la única cara rugosa sin su difusa (decisión 65;
  σz 0,09 deja χ(0) ≈ 0,04 y el resto de la energía no va a ninguna parte). Probada con la ley de las demás caras: +12–15 dB a
  40–60° (el gemelo, de 0–2 a 12–14 dB) pero +3–8 a 60–70°, el diafragma saturado sube a 2,9 % (tope 2 %) y, sobre todo, la
  cúpula oblicua se vuelve un trazo brillante de cuentas, una por línea (el cruce de cada línea con un perfil de 0,14 mm y un
  salto de 1–2 mm de una línea a la siguiente), incluso sin composición. Hace falta repartir el eco de cada línea en
  profundidad con su paso lateral, y eso toca la ventana de A2 que publica el espejo y los gemelos de la transmisión que
  reescribe la decisión 91: queda para después de ella. También se confirmó que la intercostal deslizada 15 mm hacia craneal
  (las dos apneas) no tiene líneas A bajo la pleura de la cortina (decisión 61).

**Verificación.** `spine.test.ts` (fallan en `main`: el cuerpo de 34 × 34 mm, solo vértebra a lo largo del eje, ninguna cara,
retrodispersión 0,9, la frontera del hígado junto a la columna por encima de su distancia en 134 de 142 muestras, 0 líneas con
cara y 0 con disco en la subxifoidea): la sección y los niveles con sus rangos anatómicos, el área del círculo y el plano de la
epigástrica en el centro de un cuerpo; cuerpos y discos llenan el cilindro junto al borde del platillo; la clasificación
(hueso sin moteado, disco, la cara delante del cuerpo y en el platillo, no en el arco ni más allá de `SPINE_FACE_MM`); las
reglas de la cara en un anillo de muestras a lo largo de la columna (el gas no la dibuja, el tejido más cerca del arco
tampoco, la cara más cercana gana —la cápsula y la mitad abdominal del diafragma conservan la suya— y la frontera cuenta el
hueso y el disco: cada una de las cuatro reglas y el corte recto del disco, quitados uno a uno, hacen fallar una prueba); la
frontera del hígado en la subxifoidea; el gradiente, la norma, la curvatura y el eje de la cara; su eco según la incidencia (el
de la costal, −10 dB a 20°, −40 dB a 35°, sin la cara de detrás ni difusa más allá del ángulo crítico); la subxifoidea del juez
(≥ 20 líneas con la cara a < 30° y ≥ 3 grupos de líneas por los discos); la GLSL con sus constantes, sus fórmulas y la regla.
Al día: `wall.test.ts` (24 caras, la vértebra sin moteado, la regla de la cara posterior en la GLSL), `interfaceEcho.test.ts`
(la ventana de la difusa), `startPoints.test.ts` (el disco del fondo de la intercostal no es una costilla),
`retroperitoneum.test.ts` (el psoas lateral al semieje del cuerpo y, en una rejilla de 0,2 mm, a > 0,5 mm del hueso y > 0,3
de la grasa perirrenal), `shaderLimits.test.ts` (127 y 129 ranuras), la e2e de equivalencia (≥ 1000 puntos de vértebra, ≥ 100
de cartílago —en `main`, 49, el costal— y la cara vertebral en la cáscara) y la de las normales (fila `spine`, exigida en p01;
la muestra que dibuja la cortical ya no cuenta en la fila de su tejido: el diafragma junto a la columna de la intercostal la
hacía fallar). La e2e completa (M4, SwiftShader, 27-09-2026 por la tarde, con otras sesiones compilando SwiftShader: carga 11–40 y el arranque de `main` y de la rama a 88–161 s, frente a 28 s por la mañana) con el tope por prueba subido a 300 s: 26 de 28; de las dos que agotaron el tiempo arrancando, «intervenciones docentes» pasa sola y «modo alumno ciego» (dos arranques con su tope propio de 240 s) no cabe a esa carga (por la mañana, 1,2 min). Revisión adversarial de contexto limpio: encontró la e2e de las normales en rojo (arriba), las
reglas de la cara sin prueba que las fijara, el surco del borde del platillo, el psoas a 0,17 mm del hueso y dentro de la grasa
perirrenal en una rejilla fina, cifras y afirmaciones de la documentación que no cuadraban y detalles de coste (la columna
calculada dos veces en TS, una normal de la vértebra que nadie usaba y era NaN en su eje); todo corregido arriba.
