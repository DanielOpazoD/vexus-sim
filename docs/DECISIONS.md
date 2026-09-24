# Decisiones de diseño

Formato (práctica de EchoTwin): entrada numerada, nunca renumerada; una decisión superada se marca
`[Estado: superada por N]` dentro de su propio título. Cada entrada lleva la medición o la
observación que la motivó. Referencias: «guía» = prompt guía de desarrollo (27 secciones); «base» =
base de conocimiento del 21-09-2026 (A–I, hoja 10, invariantes 10.1, ejemplos 10.2).
`docs/DECISIONS_INDEX.md` se genera con `npm run docs:index`.

## 1. Sin framework de UI; núcleo independiente del DOM

`Simulator`, fisiología, anatomía y Doppler no importan nada del DOM salvo el canvas WebGL del
renderizador. La UI se suscribe a un `Store` mínimo. `src/validation/layers.test.ts` lo comprueba
sobre los imports reales (decisión 20).

## 2. Contorno de AD prescrito («modo de calibración») en lugar de lazo cerrado

La hoja consolidada admite imponer la PAD como condición de contorno. Permite variar cada mecanismo
(a, x, v, y, IT, función VD, distensibilidad) con significado y calibrar contra trazados. El paso a
lazo cerrado sustituiría `src/physiology/rightAtrium.ts` sin tocar la red venosa.

## 3. Suprahepáticas drenan a un nodo cavoauricular sin volumen

Con la HV drenando al compartimento abdominal de la VCI, su distensibilidad amortiguaba S/D hasta
S≈D (S 13,9 / D 13,2 cm/s). Las HV entran a 1–2 cm de la aurícula (base B.2): nodo resistivo
R 0,01 entre AD, HV y VCI abdominal. Resultado: S/D 1,38 en el sano y S −10,6 en congestión.

## 4. Distensibilidad sinusoidal que se rigidiza con la presión

Con C constante el sano daba PF 30 % y la congestión 60 %. C_h = C₀·exp(−(P−P_ref)/k) separa los
casos sin ajustes por paciente; k = 12 mmHg está marcado NEEDS_CALIBRATION.

## 5. Medición de S con signo

S es el pico anterógrado en la ventana sistólica salvo flujo retrógrado ≤ −2 cm/s y ≥ 25 % del máximo
(50 % desde la decisión 44), en cuyo caso S es ese mínimo. «Valor de mayor magnitud» escogía la cola del flujo diastólico previo
y ocultaba la inversión.

## 6. Velocidad uniforme a lo largo de cada tubo

Q=cte en un tubo afilado multiplicaba por 2–3 la velocidad periférica (95 cm/s, aliasing artificial).
Las colectoras reciben tributarias y las ramas portales se dividen: el caudal local escala con el área.

## 7. Aire entre la cara convexa y la piel = gel

El marchador trataba el hueco geométrico de las líneas laterales como gas. Se ignora el aire antes de
entrar en el cuerpo; el acoplamiento por línea (`lineCoupling`) modela la pérdida de contacto.

## 8. Reentrada de dispersores por la línea de corriente

Los dispersores que salen de la caja del volumen de muestra reentran por el extremo opuesto de su
línea de corriente. Sin esto, cada salida era un chasquido y la sangre se convertía en tejido en < 1 s.

## 9. Base de flujo por dispersor y actualización lenta

Cada dispersor guarda tangente·perfil; su velocidad es base·u_ref(t). Pesos, salida de caja y fD se
recalculan cada 8 ticks; el fasor avanza por multiplicación compleja. `advance` pasó de 6 ms a 2 ms
por cuadro a 2,6 kHz con 320 dispersores.

## 10. TGC nominal del equipo y nivel de ruido

Compensación nominal 2·α_hígado(f)·r antes de la TGC del usuario; ambas amplifican también el ruido.

## 11. Doppler en «unidades de sangre»

Color y PW expresan potencias relativas a la amplitud de sangre a transmisión 1 (clutter +41 dB;
ruido −35 dB re sangre en color; −55 dB por muestra en PW).

## 12. Navegador 3D con three.js, procedural [Estado: superada por 15]

Primera versión en canvas 2D con proyección propia.

## 13. Pestañas por etapa del equipo [Estado: superada por 16]

Imagen / Color / PW / Paciente / Medición / Docente en un panel único.

## 14. Corte ecográfico como mapa de tejidos del plano

Nueva pasada GPU (`FRAG_TISSUEMAP`, 96×128) que emite clase de tejido y vaso por celda con la MISMA
clasificación que la imagen; `src/ui/cutMapView.ts` lo convierte a sector con rótulos en el
centroide de cada estructura, a ≤ 8 Hz y resolución 1× (36 ms → 25 ms por actualización). Idea
tomada de `CutMapView` de EchoTwin.

## 15. Navegador 3D «Sonda y abdomen» con three.js

Reemplaza al canvas 2D (decisión 12). Piel superelíptica translúcida sobre la MISMA elipse que usa
`torsoDepth`, costillas 3–11 de ambos lados como tubos (las derechas 5–10 con la ley exacta de
`scene.ribs`), esternón, columna, crestas ilíacas, diafragma paramétrico (`domeHeight`), hígado por
marching cubes sobre `AnatomyScene.liverSdf` con los mismos recortes que `classify`, vasos con radio
variable, sonda convexa con marcador arrastrable y abanico del sector. Gestos idénticos a EchoTwin:
arrastrar piel = deslizar (por diferencias, no salta), marcador o rueda = rotar, ⇧ = bascular,
⌥ = inclinar, botón derecho = orbitar, ⌘/Ctrl+rueda = zoom. Render solo cuando cambia algo
(pose, respiración > 0,3 mm, profundidad): 1,7 ms por cuadro en régimen, 66 k triángulos tras
compactar el búfer de MarchingCubes (300 k triángulos vacíos costaban 80 ms). Brazos abducidos para
no tapar el flanco. Sin activos externos.

## 16. Disposición de tres columnas y consola por pestañas con iconos

Rejilla `40px | 1fr | 46px` × `300px | 1fr | 280px` como EchoTwin: carril izquierdo (3D arriba,
corte abajo, ayuda de gestos), imagen sobre negro con HUD mono en las esquinas (caso; FC/ritmo y
profundidad/frecuencia/ganancia; modo activo), consola derecha Adquirir / Imagen / Doppler / Medir /
Docente con secciones «bisel» (h4 en mayúsculas + guion de acento), barra inferior de modos con chip
de contexto y estado del bucle. La consola sigue la intención: activar Color/PW abre Doppler. La
pestaña Docente solo existe con la casilla activada.

## 17. «Puntos de partida» en vez de vistas

La guía §8 prohíbe botones que equivalgan a vistas. Adquirir ofrece cuatro posiciones cutáneas de
partida (subxifoideo, intercostal derecho, flanco, renal) hacia las que la sonda se desliza de forma
continua con ángulos neutros; la ventana diagnóstica hay que encontrarla; cualquier gesto cancela la
animación. Es una desviación deliberada y documentada de la guía, en la línea de EchoTwin («animar,
nunca teletransportar»).

## 18. Hígado bilobulado

Un solo elipsoide de 27 × 17 × 21 cm daba un hígado esférico y sobredimensionado en el 3D y en el
corte. Ahora es la unión suave (k 30 mm) de un lóbulo derecho (88 × 78 × 92 mm) y un lóbulo
izquierdo aplanado (90 × 42 × 58 mm), en TS (`AnatomyScene.liverSdf`) y GLSL (`smoothMin`), de modo
que imagen, corte y malla 3D cambian a la vez.

## 19. Fidelidad de imagen tomada de EchoTwin

Cambios en `passes.glsl.ts`, todos con causa física: núcleos PSF de energía unitaria (Σw² = 1) y
envolvente ×2/√π para que la amplitud media quede calibrada en unidades de retrodispersión sin
depender de la anchura del haz; ruido del receptor gaussiano complejo añadido ANTES de la PSF y de
la detección (el ruido de envolvente rellenaba los nulos del speckle); término especular (n·d)⁴
confinado a la muestra que cruza la interfaz (ventana |n·d|·dr, mínimo 0,15·dr) y sin fasor;
célula de speckle en elevación anclada al grosor de corte (decorrelación al inclinar); heterogeneidad
lenta del parénquima ±4 dB p-p a ~1,6 ciclos/cm; campo cercano y cola sucia anclados a la sonda
(línea, r), no al tejido; mapa de grises exponencial en dB (C = 3,5) porque en imágenes reales la
desviación del gris crece con el nivel. Referencia de blanco −20 dB. Pendiente: medir célula de
speckle, SNR local y asimetría contra clips reales (docs/APPROXIMATIONS.md).

## 20. Prácticas de ingeniería portadas

`// @tier slow` en la primera línea de una prueba la saca de `npm test`; `test:all` lo corre todo y
es lo que ejecuta `check`. `src/validation/layers.test.ts` comprueba las fronteras de capas y detecta
ciclos (Tarjan) con una lista de ciclos aceptados que solo puede encoger (vacía). `tools/ci/bundle-
budget.ts` fija presupuestos por patrón con la medición fechada en cabecera. `tools/docs/decisions-
index.ts` genera el índice y `docs.test.ts` exige que esté al día y que ARCHITECTURE.md solo nombre
archivos existentes.

## 21. Campo profundo: techo de compensación, frecuencia efectiva y ecos de gas atenuados

A 24 cm la imagen saturaba en blanco más allá de ~15 cm: la compensación nominal (2·α·r con
α a 3,5 MHz, 4,2 dB/cm) no tenía techo y amplificaba el ruido del receptor (−55 dB) y la cola
sucia del gas, que además no pagaba la atenuación de ida y vuelta hasta el reflector. Ahora:
(1) la compensación nominal + TGC del usuario se limita a 50 dB (`TGC_CAP_DB`, ganancia máxima
del amplificador): con 3 dB/cm de ida y vuelta compensa por completo hasta ~17 cm y más allá la
imagen se oscurece y el ruido gana, como un convexo real al límite de penetración; (2) la
atenuación de transmisión y la compensación nominal usan una frecuencia efectiva de 2,5 MHz
(`B_EFFECTIVE_MHZ`, centro de banda desplazado por la atenuación); (3) el ruido baja a −72 dB
re eco hepático; (4) las A-lines tras gas se multiplican por T_gas^k y la cola sucia por T_gas
(transmisión justo antes del reflector), a −10 dB del parénquima y con caída de 40 mm. Verificado
a 16 y 24 cm: hígado uniforme hasta 15 cm, gas como sombra con cola tenue, nieve gris oscura al
fondo.

## 22. Marco anatómico levógiro: espejo en el navegador 3D y rótulos de orientación

`anatomy/scene.ts` usa x = izquierda del paciente, y anterior, z craneal, que es un marco
LEVÓGIRO; three.js es dextrógiro, así que el avatar se veía en espejo (hígado bajo las costillas
izquierdas). En vez de reescribir la escena, el GLSL y las pruebas (todo el eje x cambiaría de
signo), `Navigator3D` cuelga toda la anatomía de un grupo con escala x = −1 (three.js invierte
las caras cuando el determinante es negativo) y devuelve las intersecciones al marco anatómico con
`worldToLocal`. La imagen, el corte y el Doppler no cambian: una reflexión conserva productos
escalares, y la relación marcador ↔ lado de la imagen se conserva. Cámara por defecto anterior
oblicua desde la derecha del paciente con la cabeza arriba (up = +z), rótulos «cabeza / pies /
D / I» en el avatar, y órbita con el sentido de OrbitControls.

## 23. Anatomía de la iteración 2: hígado en cuña, vía biliar, suprahepáticas y porta de segundo orden

El hígado pasa de dos elipsoides a un elipsoide derecho grande (170 × 190 × 200 mm) al que la
pared abdominal recorta la cara anterior, la cúpula la superior y un **plano visceral**
(z = −40 − 0,35·y, arista redondeada 12 mm) la inferior: cuña con borde agudo a z ≈ −68 bajo la
pared anterior y a −26 en la cara posterior; impresión renal (el riñón derecho + 4 mm se resta con
`smoothMax`) y fosa vesicular (la vesícula se resta). Craneocaudal ≈ 135–140 mm en la línea
medioclavicular; transverso 196 mm. Las suprahepáticas tienen tributarias (anterior/posterior de la
derecha, segmento VIII de la media, II–III de la izquierda) y la media e izquierda confluyen en un
**tronco común** de 1 cm que entra por la cara anterior izquierda de la cava, con la derecha entrando
1 cm más abajo por la posterolateral (variante más frecuente, B.2). La porta añade la porción
umbilical y las ramas lateral (II–III) y medial (IV). La **vía biliar** (colédoco, hepáticos derecho e
izquierdo, cístico) es una lista de conductos (`AnatomyScene.ducts`): tubos sin flujo con luz
`Fluid` y pared `BileDuctWall` ecogénica, anterolaterales a la porta. El gas intestinal desaparece del
avatar de referencia (queda el mecanismo para confusores). Todo sigue siendo [EXTRAPOLACIÓN PROPIA]
en ángulos y longitudes; `anatomy.test.ts` fija puntos de cada estructura.

## 24. Riñones implícitos y datos de escena en textura

Riñón como primitiva propia (`kidneyQuery`, hoy en el módulo `anatomy/organs/kidney.ts`): elipsoide orientado (base u/v/w: eje largo
con el polo superior medial y posterior, hilio anteromedial), seno renal (elipsoide + canal del hilio),
pirámides medulares en cuña (3 ángulos × 4 posiciones, papila hacia el seno) y columnas de Bertin
entre ellas, grasa perirrenal de 3,5 mm. Tejidos nuevos: corteza (0,8 re hígado), médula (0,3), seno
(2,3), grasa perirrenal (1,5), pared biliar (2,4). Vasos: arteria y vena renal de cada lado (la
arteria derecha por detrás de la cava; la vena izquierda cruza por delante de la aorta) y tres pares
interlobares derechos en las columnas de Bertin del plano coronal lateral, arteria y vena adyacentes.
Con 34 tubos y ~120 nodos los `uniform vec4[]` superaban el mínimo garantizado de WebGL2 (224
vec4): los tubos viajan en una **textura de datos RGBA32F** (`uSceneTex`: 4 texels de cabecera por
tubo con inicio, n.º de nodos, escalas, pared, tejidos, u_ref y **esfera envolvente**; nodos a partir
de `NODE_BASE`). Los nodos se suben una vez; las cabeceras (calibre, u_ref) cada cuadro. La esfera
envolvente descarta la mayoría de tubos por muestra en CPU y GPU. Coste GPU a 16 cm: 13,5 ms por
cuadro (medido con `EXT_disjoint_timer_query_webgl2`), tras evitar la clasificación de los planos
laterales de elevación cuando el central está lejos de toda interfaz (`sampleSide`). Precisión
(revisión externa, 23-09-2026): «lejos» es `bd` > desplazamiento + 0,5 mm, y la `bd` del hígado no
cuenta los tubos, así que junto a un vaso fuera del plano el plano lateral hereda el tejido del
central (1–5 % de los píxeles de hígado, `side-plane-skips-tubes`); el margen de 0,5 mm es además
menor que la cápsula (0,8 mm).

## 25. Corte ecográfico en un Worker con la anatomía TypeScript

La lectura GPU→CPU del mapa de tejidos (readPixels o PBO + valla + getBufferSubData) bloqueaba el
hilo principal 50–90 ms por lectura porque Chrome espera a toda la cola de la GPU: con 8 Hz de corte,
la mitad del tiempo. El corte se calcula ahora en `src/ui/cutMapWorker.ts` con `AnatomyQuery`
(la misma anatomía TS que el Doppler y las mediciones), 96 × 128 puntos por petición, una petición
en vuelo, resultado transferido sin copia. Ventajas: cero contención con la GPU, y el corte pasa a ser
una comprobación visual continua de la equivalencia TS ↔ GLSL. La pasada `FRAG_TISSUEMAP` se conserva
(lectura asíncrona) para depuración y para un futuro test de equivalencia.

## 26. Componente renal del VExUS emergente

Nuevo compartimento renal en la red venosa (ambos riñones): arteria renal de baja resistencia
(R 3,75, IR ≈ 0,6), lecho C_k 4,5 mL/mmHg, vena renal R 0,1 / L 0,002 hacia la VCI abdominal
(τ ≈ 0,45 s). Las velocidades interlobares salen de Q/A con el 12 % del caudal renal por vaso
modelado. `renalPatternFromPeaks` clasifica continuo (mín ≥ 30 % del máximo), bifásico (S ≥ 30 % de
D con interrupción), monofásico (solo D) y «fuera del esquema» (inversión con S y D). Calibración
(tools/calibrate.ts): sano S 16,8 / D 14,9 / mín 7,5 cm/s → continuo; congestión S 6,6 / D 32,2 /
mín −5,4 → monofásico; los grados 0 y 3 se conservan. El caudal renal añadido a la cava subía la VCI
sana a 19,6 mm (umbral 20): bajar R_VCI→AD la acoplaba más a la pulsación auricular (colapso
cardíaco > 15 % en apnea), así que se desplaza la ley de tubo (P₀ −0,5 → 0 mmHg): VCI sana
18,7/11,3 mm (colapso 39 %), congestión 31,4/27,5. Medición observada
`measureObservedRenal` sobre el espectro adquirido, fila «Renal» del protocolo y herramienta `renal`;
punto de partida «Renal» en la línea axilar posterior (φ 1,12π, z −75, inclinación −0,5) y alcance
de la sonda ampliado a φ ≤ 1,2π. Verificado en vivo: puerta en la vena interlobar en apnea → espectro
continuo y «Renal: continuo» en el resultado.

**Enmienda (revisión externa, 23-09-2026).** «Continuo» exigía un mínimo ≥ 30 % del máximo, y el VExUS
lo define por la ausencia de interrupción. Un flujo pulsátil que nunca se detiene salía bifásico, o
monofásico si S era pequeña, y entonces sumaba un componente grave al grado: (S 5, D 20, mín 4) daba
grado 2 con hígado y porta normales. En la interpolación lineal sano → grave (con la semilla del sano)
la regla vieja solo cambiaba el rótulo, sin tocar el grado: de 0,5 a 0,75 decía bifásico con el flujo
sin interrumpir (en 0,6, mín/máx 0,26 y mínimo +4,5 cm/s).

Ahora es continuo si el mínimo supera max(suelo, 10 % del máximo) [EXTRAPOLACIÓN PROPIA]; el 10 % es
donde el valle se confunde con la línea de base en la escala del espectro. Una revisión adversarial
con IQ sintética por la cadena real (filtro de pared, espectro, `measureObservedRenal`) obligó a dos
precisiones para que la verdad y la captura digan lo mismo:

- **Suelo en Hz, no en cm/s.** En la captura, «sin flujo» es lo que cae en la banda del filtro de
  pared (`flowBandMinHz`: 25 Hz + 37,5 Hz de margen, o dos bins a PRF alta), convertido con la PRF y
  el ángulo de la captura (`renalFloorCms`). Un suelo fijo de 2 cm/s en velocidad corregida hacía
  que el mismo espectro fuera bifásico a 0° y continuo a 45°. La verdad usa 2 cm/s (el mismo corte
  a la PRF por defecto sin corrección, ≈ 1,9 cm/s).
- **Mínimo resoluble.** El cuantil robusto 0,97 del mínimo (decisión 44) descartaba ~26 ms por
  latido: una vena que se detenía 30 ms dos veces por latido salía continua. Ahora la captura toma el
  mínimo exacto de su traza, pero solo de columnas creíbles. A la PRF por defecto (2600 Hz) la
  envolvente de la vena se hunde 3–6 columnas justo en su pico, con la sangre llenando el espectro
  (+20 dB sobre el suelo en el lado de la vena). Una segunda revisión midió que así el sano salía
  bifásico en 13 de 72 capturas, y en 12 de 72 con la regla vieja. Ahora una columna con la traza en
  la línea de base y sangre en el lado de la vena (la prueba de presencia de la calidad,
  `bloodInColumn`) es un hundimiento del detector y no fija el mínimo. Una pausa real está en el
  suelo (±2 dB).
- **Resolución de la verdad.** Una pausa más breve que la resolución del espectro no llega a cero.
  La verdad usa el mínimo del máximo móvil de `RENAL_GAP_MIN_S` = 20 ms (`resolvableMinimum`). Esa
  resolución es la del espectro a ~4 kHz: a 1,5–2,6 kHz se pierden pausas de 20–30 ms y a 6 kHz se
  ven las de 10 ms (`renal-pause-resolution-prf`). Ninguno de los tres casos tiene pausas de 10–40 ms,
  así que no cambia ningún resultado.

Los tres casos no cambian: sano (mín 7,5) y FA (mín 7,1) continuos, grave (−5,3) monofásico. En la
interpolación, el bifásico aparece en la fracción 0,8 (mín 1,9 cm/s) en vez de 0,5. Cerca del
umbral (0,80–0,82) la captura y la verdad pueden discrepar, como ocurría en 0,55 con el umbral
viejo. Pruebas sobre la cadena real: `renalInterruption.test.ts`.

## 27. Repositorio, CI y saneamiento tras revisión adversarial

Repositorio en GitHub (`DanielOpazoD/vexus-sim`, privado) con `main` siempre verde, ramas cortas por
intención y PR con plantilla (CONTRIBUTING.md); CI en GitHub Actions ejecuta exactamente `npm run
check` (formato, lint, tipos, todas las pruebas, build, presupuesto). Prettier y reglas de lint
adicionales (`consistent-type-imports`, `eqeqeq`, `no-explicit-any`). Dos revisiones adversariales
de contexto limpio (estructura y pruebas) encontraron y se corrigieron: (1) la medición renal
sobrevivía al cambio de caso (grado mezclado de dos pacientes); (2) el navegador 3D seguía mostrando
la anatomía del caso anterior y el renderizador no liberaba recursos GPU (`dispose()` en renderer,
simulador y `Navigator3D.setAnatomy`); (3) `tubeQuery` con sección elíptica descartaba la componente
axial y prolongaba la cava 15 mm más allá de su último nodo (TS y GLSL); (4) `Beat.rr` era el
intervalo anterior y no «hasta la siguiente R» como prometía el contrato del que dependen todas las
ventanas de medida. Duplicaciones eliminadas con un único dueño: `median`/`extremeInWindow`
(`core/series.ts`), Nyquist/PRF (`core/units.ts`), constantes TS ↔ GLSL y `#define` de tejidos
generados desde el enum, puntos de partida (`app/startPoints.ts`, la consola y el 3D ya divergían),
límites del equipo, `LINES` desde el transductor. `main.ts` cede la animación de la sonda
(`app/probeAnimation.ts`) y los atajos (`ui/keyboardShortcuts.ts`); los ganchos de depuración solo en
desarrollo. Pruebas nuevas en el nivel rápido con valores cerrados (53 → 53 + 20): primitivas
(tubo, riñón, smoothMin/Max), DSP (unidades, FFT, filtro de pared, STFT, envolvente), ritmo,
respiración, conservación de masa de la red venosa, ventanas de medida, tabla completa del
clasificador (27 combinaciones + fronteras) y `decisions-index` con entrada sintética; cobertura
del núcleo sin DOM/WebGL medida con `npm run test:coverage`. Pendiente (registrado, no hecho):
dividir `panel.ts`, `navigator3d.ts`, `scene.classify` y el resto de `main.ts`; lint con tipos;
`noUncheckedIndexedAccess`.

## 28. Consola y navegador 3D por módulos

`panel.ts` (822 líneas) pasa a un compositor de 140 líneas que implementa `PanelContext` (acceso al
simulador y al estado, `track/sync/section/segmented`) y cinco pestañas independientes en
`src/ui/panel/`: `acquireTab`, `imageTab`, `dopplerTab` (devuelve sus tres subpaneles), `MeasureTab`
(clase con estado: mediciones adquiridas, calibrador, captura, resultado) y `TeacherTab`; los textos
del clasificador viven una sola vez en `vexusText.ts`. `navigator3d.ts` (868 líneas) conserva la
clase (cámara, gestos, dibujo, espejo del marco) y cede los constructores de geometría a
`src/ui/navigator3d/`: `common` (unidades, `disposeObject`, superficie del tronco), `body` (piel y
esqueleto), `organs` (hígado por marching cubes, diafragma, vesícula, riñones, vía biliar), `tubes`,
`labels` (rótulos y puntos de partida), `probe` (sonda y abanico), `anatomyGroups`. Sin cambios de
comportamiento; verificado en vivo (medición, captura, cambio de caso).

## 29. Geometría del sector única, árbol vascular propio y `classify` por pasos

`ultrasound/sectorGeometry.ts` (puro, con pruebas de inversa píxel ↔ haz y encaje en el lienzo) es
la única definición del encaje del abanico: la usan el renderizador (conversión de barrido, overlay,
calibrador) y el corte ecográfico, que antes reimplementaba la fórmula con otro margen, de modo que la
superposición corte ↔ imagen ya es exacta salvo escala. El árbol vascular y la vía biliar salen del
constructor de la escena a `anatomy/vesselTree.ts` (con `VesselDef`/`DuctDef`), y `scene.classify`
documenta su orden de prioridad y delega en `classifyWall`, `classifyTubes`, `classifyKidneys` y
`classifyLiver` (misma semántica; `anatomy.test.ts` intacto). `tools/ci/bundle-budget.ts` pasa a
TypeScript como el resto de herramientas; `CaseId` tipa el estado de UI (un id de caso inválido no
compila; el `<select>` se valida con `isCaseId`).

## 30. Comprobación en vivo de la equivalencia TS ↔ GLSL

La regla «la anatomía TypeScript y la GLSL son la misma» era, hasta ahora, una inspección visual.
En modo docente el bucle compara cada 250 ms el mapa de tejidos de la GPU (`FRAG_TISSUEMAP`, lectura
asíncrona) con el del Worker (`AnatomyQuery`), en la MISMA rejilla (96 × 128 celdas del plano) y en
el MISMO instante: el corte guarda con cada mapa la muestra fisiológica, el marco de la sonda y la
profundidad con que se pidió, `Simulator.gpuTissueMap(at)` dibuja la GPU con esos mismos datos (y
`tissueMap` sincroniza la textura de escena al calibre de ese instante), y el mapa GPU devuelto —que
es el del tick anterior— se compara con la instantánea CPU de ese tick. `app/equivalenceCheck.ts`
informa acuerdo total, acuerdo en celdas interiores (4 vecinos iguales) y los pares CPU→GPU más
frecuentes; la pestaña Docente lo muestra. Resultado: **100,0 % de acuerdo** (total e interior) en las
ventanas renal, intercostal y subxifoidea del caso congestivo con respiración profunda. Antes de
sincronizar instante y calibre se veía 91–94 % con «pared venosa→sangre» en la cava pulsátil: era
tiempo, no anatomía; ahora una divergencia real (un tejido nuevo sin `#define`, un recorte distinto)
se ve de inmediato como pares CPU→GPU sistemáticos.

## 31. Fibrilación auricular como ritmo y tercer caso

`Rhythm` admite `'atrial-fibrillation'`: RR lognormal alrededor de la FC media con dispersión
relativa `rrVariability` (0,22 en el caso) y refractariedad del nodo AV ≥ 0,3 s; sin onda P
(`tP = NaN`) ni contracción auricular (`atrialAmplitude 0`), con lo que la presión de AD pierde la
onda a y la suprahepática la onda A **sin ninguna regla**; ondas f deterministas en el ECG. Las
ventanas de medida con NaN son ventanas vacías (`core/series.ts`, `systolicPeak`): antes una ventana
NaN devolvía el mínimo GLOBAL como «A» (−5,6 cm/s en un paciente sin aurícula), y un latido sin A se
descartaba entero; ahora A es opcional y S/D bastan. Caso «FA · congestión moderada» (PAD 13, VD 0,5,
IT 0,35, C_h 0,5): VCI 29,5/26,0 mm, S 9,5 < D 13,5 (leve), PF 36 % (leve), renal continuo → grado 1
emergente, con A = NaN. La FC del HUD es una media móvil (como un monitor) porque en FA el RR latido
a latido salta.

## 32. Pruebas de extremo a extremo en Chromium

Ninguna prueba unitaria puede ver que el módulo arranca, que WebGL2 renderiza cuadros o que la UI
está cableada: `ReferenceError: CASE_IDS is not defined` (un import olvidado durante un refactor)
pasó todos los tests y solo se vio en el navegador. `e2e/smoke.spec.ts` (Playwright, sobre el build
con `vite preview` en el puerto 6609) comprueba: arranque sin errores de consola ni `pageerror`,
`t` avanza y hay fps > 0; cambio de caso reflejado en el HUD (incluida la FA); modo PW por teclado,
pestaña Medir → suprahepática → Capturar → resultado con VSH; Docente con verdad fisiológica. En CI
corre en un job aparte tras `check`, con Chromium + SwiftShader (WebGL2 por software, sin GPU). No
entra en `npm run check` (2 min) pero sí en CI; `npm run e2e` en local.

**Enmienda (Fase 0).** Con SwiftShader no se alcanzaban ni «fps > 0» fiable ni la verdad fisiológica
(t > 8 s), y la prueba de medición aceptaba «VSH: —»: se relajaron sin decirlo. Ahora la e2e usa ganchos
`?e2e` (`advance`, `placeGate`) y exige un valor numérico; además comprueba la pérdida de contexto WebGL
y el gate de equivalencia TS ↔ GLSL (`e2e/equivalence.spec.ts`).

## 33. La congestión se ve: calibres basales reales, plétora ×1,6 y hepatomegalia

Evaluación clínica (22-09): el caso grave era casi indistinguible del sano en modo B y en el 3D. Tres
causas: (1) los radios basales de las suprahepáticas eran los de un paciente ya dilatado (curso medio
9 mm de diámetro) → se reducen ×0,8 (curso medio 5–8 mm, desembocadura 8–10 mm, B.2); (2) la ley de
dilatación √(1 + 0,06·(P − 7)) daba ×1,33 a 19 mmHg → √(1 + 0,12·(P − 7)): ×0,95 en el sano y ×1,6 en
la congestión grave (12–15 mm de diámetro, plétora real); (3) el avatar 3D construía los tubos con
los radios basales: ahora `buildVessels` recibe el calibre del caso en régimen (`getCaliber`) y la
sección elíptica de la cava, y se reconstruye al cambiar de caso. Hepatomegalia congestiva:
`PatientState.liver.sizeFactor` (1,1 en el grave, 1,05 en la FA) escala los lóbulos y baja el borde
inferior ≈ 1 cm por cada 10 %. Recalibrado (r_ref en el sitio de muestreo 5,6/4,5/4,2 mm): sano S 27,1 / D 18,7 / A −5,6 (grado 0); grave S −6,8 /
D 23,7, PF 70 %, VCI 31,4 (grado 3); FA S<D, PF 36 % (grado 1).

## 34. Árbol vascular hepático de 3.º–4.º orden y lista de tubos por cuadro

El parénquima mostraba 2–3 vasos por sector donde un hígado real enseña decenas de ramas portales
(con manguito ecogénico) y suprahepáticas finas. `buildHepaticBranches` (`anatomy/vesselTree.ts`)
genera, con semilla fija, ~60 ramas desde los extremos y puntos medios de las ramas de 2.º orden:
dos hijas por bifurcación a 30–45° alrededor de un eje aleatorio perpendicular, longitud 0,7× (22–40
mm), radio 0,62× (mínimo 0,9 mm), una segunda bifurcación, y extremos acortados hasta quedar ≥ 3 mm
dentro del hígado (`liverSdf`, que ya conoce riñón y vesícula): el árbol nunca sale del parénquima y
sigue a la hepatomegalia. Cada rama hereda el `id` fisiológico de su madre (misma velocidad ×
`flowFactor` 0,85ⁿ, en TS y GLSL) y su tejido de pared; `vesselById` y `vesselAreas` solo miran a
las madres (sin esto, la última rama sustituía a la madre y disparaba las velocidades ×20). Con ~90
tubos el bucle GLSL por muestra subía el cuadro de 13 a 23 ms: ahora la textura de escena lleva por
cuadro solo los tubos cuya esfera envolvente corta la losa del plano (elevación ± 12 mm), 20–40 de
~90, con el índice original en H2.w; cuadro de nuevo en 12–14 ms y equivalencia TS ↔ GLSL 100 %.

**Enmienda (revisión externa, 23-09-2026).** La contención solo miraba los extremos: en la congestión
grave una rama de `hvLeftTributary` tenía los dos extremos dentro del hígado y el punto medio 4 mm
fuera, en la fisura umbilical, así que una luz con flujo sustituía al ligamento redondo. Ahora cada
rama se recorre cada 0,5 mm desde que sale de la luz de su madre: la luz con el calibre más dilatado
(`BRANCH_MAX_RADIUS_SCALE`: suprahepáticas 1,8×, porta 1,2×; medido 1,71 y 1,15 en los tres casos)
más su pared debe quedar dentro del parénquima y fuera de la fisura umbilical y del ligamento
venoso. Si no cabe, se acorta como antes. El sano y la FA no cambian (47 ramas idénticas); el grave
pierde esa rama (48 → 47) sin alterar las demás, porque era una hoja y no consume la semilla.

## 35. Columna con arco posterior, costillas que terminan en la apófisis transversa, «columna» ≠ «costilla»

Daniel señaló una «costilla» flotando bajo la VCI a 20 cm en el corte y en la imagen. Diagnóstico:
(1) el hueso profundo era el **cuerpo vertebral** (bien situado detrás de aorta y cava) pero el corte
rotulaba todo `Bone` como «costilla»; (2) la columna era solo un cilindro de 40 mm demasiado
posterior (su cara dorsal quedaba dentro de la pared), sin arco ni apófisis transversas; (3) las
costillas eran un anillo completo que pasaba por detrás de la columna. Ahora: `Spine` = cuerpo
vertebral (r 18 mm, centro y −48: cara posterior a ≈ 5 cm de la piel dorsal) ∪ arco posterior con
apófisis transversas (caja ±40 mm, y −90…−64), en TS (`sdSpine`) y GLSL; `sdRib` no existe por
detrás de la columna en |x| < 46 mm (las costillas se articulan con las transversas), en TS, GLSL y
en el avatar 3D; cava, aorta, renales y desembocadura de las suprahepáticas 10 mm más anteriores
(justo delante del cuerpo vertebral); tejido `Vertebra` (mismas propiedades que el hueso cortical)
para rotular «columna». Equivalencia TS ↔ GLSL 100 %.

## 36. Proporciones craneocaudales referidas al xifoides y diafragma en dos hemicúpulas

La ventana subxifoidea mostraba la confluencia de las suprahepáticas a 17–19 cm (real 10–14): la
cúpula (+95 mm), la unión cavoauricular (+90) y el hilio hepático (−28) estaban 4–5 cm demasiado
altos respecto al xifoides, el tronco era demasiado grueso (AP 23 cm) y el reborde costal demasiado
alto. Ahora z = 0 es la punta del xifoides (T9–T10) y: cúpula derecha en T8–T9 (**+55 mm**),
unión cavoauricular +55, tronco común de suprahepáticas +42…+50, hilio hepático −45 (T12–L1),
reborde costal medioclavicular ≈ −56 (10.º arco), borde hepático en cuña a −83 bajo la pared
anterior, vesícula con el fondo en el borde (−65), aurícula derecha (−15, 15, 95) r 30, costillas
5–10 con el 7.º cartílago en el xifoides, tronco AP 21 cm, riñones y arco vertebral dentro de la
cavidad, arteria renal derecha entre cava y cuerpo vertebral. El diafragma deja de ser una sola
cúpula con «zócalo» (fuera de su elipse todo era pulmón hasta z −95, lo que convertía en pulmón
el polo superior del riñón izquierdo): ahora son **dos hemicúpulas** (derecha apex +55, izquierda
+25) sobre la **línea de inserción costal** (0 en el xifoides, −50 en flancos y espalda,
`diaphragmEdgeZ`), en TS (`diaphragmHeight`/`sdDiaphragm`), GLSL y el 3D. Puntos de partida:
intercostal en el 7.º–8.º espacio (z 8), flanco −20, renal −80. Resultado: VCI a 12 cm y
confluencia a 13–14 cm desde el subxifoideo; hígado de 113–123 mm en la línea medioclavicular
(rango ecográfico 12–15 cm), diafragma y pulmón visibles en la ventana intercostal a 10–12 cm.
Equivalencia TS ↔ GLSL 100 %.

## 37. Riñón en judía con escotadura hiliar, 16 pirámides e interlobares en abanico

El riñón era un elipsoide liso con 12 pirámides gruesas y unos interlobares rectos que cruzaban el
seno como una barra. Ahora el contorno resta un elipsoide en la cara medial (`HILUM_NOTCH`, 10 mm
de profundidad, arista 6 mm): forma de judía con hilio, en TS (`kidneyOuterSdf`) y GLSL; 16
pirámides más finas (fila lateral de 4 y filas anterior, posterior y oblicuas de 3; tabla `PYRAMIDS`
interpolada en el shader como `const vec2 PYR[]`, así no puede divergir); corteza 0,72 re hígado
(ligeramente hipoecoica, adulto normal); interlobares que nacen en el seno y se abren en abanico
(u × 1,15) por las columnas de Bertin entre las pirámides laterales (`BERTIN_COLUMNS_U`). El hilio
queda relleno de grasa perirrenal (grasa hiliar). Equivalencia TS ↔ GLSL 100 %.

**Enmienda (revisión externa, 23-09-2026).** La arteria y la vena renales compartían el nodo hiliar y
se solapaban 8 mm en su último tramo: el 14–21 % del eje arterial se clasificaba como vena, y una
puerta PW sobre la arteria del hilio daba el espectro venoso. Ahora, de delante atrás, vena y arteria
con los ejes a 9 mm en el hilio (radios 4,5 y 2,4 más las paredes), y tramos extrarrenales con la
vena por delante de la arteria (la derecha pasa además por detrás de la cava). Sin solaparse en todo
el recorrido: holgura ≥ 0,9 mm entre paredes. La base del riñón izquierdo es especular (su w apunta
hacia atrás) y sus desplazamientos van con el signo cambiado. Siguen sin existir las segmentarias y
las interlobares izquierdas (`no-left-interlobar-vessels`).

## 38. PSF lateral con número F y ensanchamiento espectral intrínseco

La PSF lateral era una gaussiana con σ₀ 0,9 mm en el foco y zR 28 mm, igual en TS y GLSL pero sin
relación con la apertura: el campo lejano se veía tan fino como el cercano y la puerta PW tenía una
anchura arbitraria. Ahora `src/ultrasound/beamModel.ts` define el haz de un convexo de 3,5 MHz
(λ 0,44 mm, apertura tx 26 mm con foco único, recepción con enfoque dinámico D = min(26, r/2,5),
k 1,3): FWHM de dos vías 1/√(1/tx² + 1/rx²) ≈ 1,4 mm hasta el foco y ≈ 3,5 mm a 16 cm, monótona
tras el foco. La pasada D (GLSL `lateralSigmaMm`) recibe los cuatro parámetros en `uBeam` y
reproduce la misma fórmula; la puerta PW usa 1,2 × esa σ; y cada dispersor del volumen de muestra
«ve» el haz con un ángulo gaussiano σθ = D_rx/4r (≈ 0,1 rad hasta 65 mm), lo que ensancha el
espectro como el ensanchamiento intrínseco de un equipo real (Δf/f ≈ tan θ·D/2r) en vez de dibujar
una línea fina. Aperturas y F# son [EXTRAPOLACIÓN PROPIA] hasta medir la PSF de un equipo (E.7).

## 39. Doppler color por celdas, varianza de Kasai y cadencia física de cuadro

El color se estimaba por píxel de una textura de 96 × 160 con velocidad uniforme dentro del vaso: una
mancha plana de bordes nítidos que se refrescaba a 15 Hz fijos, sin relación con la caja ni la PRF.
Ahora el estimador trabaja por celda (una línea de color por grado × un paquete axial de 1 mm,
`COLOR_LINE_SPACING_RAD`/`COLOR_PACKET_MM`) y la conversión de barrido interpola entre celdas: el
mosaico grueso del color real. La autocorrelación pierde coherencia con el ensanchamiento espectral
de la celda (ρ = exp(−2(π·σf/PRF)²), σf por la dispersión angular de la apertura del `beamModel`,
el tiempo de tránsito y el gradiente del perfil en las celdas que tocan la pared) y el estimador
añade la varianza de fase de Kasai (1 − ρ²)/(2Nρ²): moteado de velocidad dentro del vaso, mosaico
en el borde del aliasing y más ruido con ensembles cortos. La cadencia es la física
(`colorTiming`): cada cuadro cuesta líneas × ensemble disparos a la PRF más el cuadro B intercalado,
y con color activo la imagen entera (B + color) se refresca a esa frecuencia, que se rotula en la
esquina («· 8 Hz»): abrir la caja o bajar la PRF se paga en cuadros por segundo, como en el equipo.
Densidad de líneas fija y sin adaptación automática del ensemble: [EXTRAPOLACIÓN PROPIA].

## 40. Fisura umbilical y ligamento redondo

El lóbulo izquierdo era un elipsoide liso: ni en 3D ni en el corte se distinguía el segmento IV de
los segmentos II–III, y faltaba el foco ecogénico del ligamento redondo que cualquier ecografista
usa como referencia en el corte transversal epigástrico. Ahora `liverSdf` = `liverBaseSdf`
excavado por una lámina sagital en x = 15 mm (izquierda del paciente), 8 mm de ancho, 14 mm de
profundidad desde la superficie, solo por delante (y > 0) y en el tercio inferior (z < −30):
`umbilicalFissureSdf(m, dBase)` = max(|x − 15| − 4, −(dBase + 14), z + 30, −y), unida con
`smoothMax` de 3 mm. Lo excavado se clasifica como tejido nuevo `LigamentumTeres` (grasa + fibra,
retrodispersión 2,2, α 0,6): banda brillante bajo la cara anterior en el corte sagital y foco entre
III y IV en el transversal. Misma fórmula en GLSL (`fissureSdf`, `uFissure`), equivalencia
TS ↔ GLSL 100 %; el navegador 3D hereda el surco por marching cubes sobre el mismo SDF. Falta la
fisura del ligamento venoso y el falciforme como lámina peritoneal.

## 41. Vesícula en pera con pared y porción umbilical de la porta izquierda en la fisura

La vesícula era un elipsoide alineado con los ejes (34 × 17 × 17 mm, eje derecha–izquierda) sin
pared: en el corte no tenía fondo ni cuello y la fosa no apuntaba al hilio. Ahora es un elipsoide
con base propia (`OrientedEllipsoid`, `sdOrientedEllipsoid` en TS y GLSL): eje u del fondo
(anteroinferolateral, asomando bajo el reborde hepático) al cuello (posterosuperomedial, hacia la
porta hepatis), semiejes 40 × 11 × 11 mm con afilamiento 0,45 en +u (fondo r ≈ 16 mm, cuello r ≈
6 mm), pared de 1,5 mm de `BileDuctWall` (ecogénica) alrededor de la luz anecoica y fosa de 2 mm
excavada en el hígado con el mismo SDF. El navegador 3D la extrae por marching cubes del mismo
campo. Se retira la limitación `axis-aligned-gallbladder`. La porción umbilical de la porta
izquierda termina ahora en el receso de Rex, bajo el suelo de la fisura umbilical (decisión 40),
de donde salen las ramas de II–III y IV: el ligamento redondo se continúa con ella como en la
anatomía real. Costillas con oblicuidad creciente (`ribTiltMm`) y profundidad por defecto 18 cm
van en el mismo lote de fidelidad.

## 42. Segmentos de Couinaud derivados de los vasos, ligamento venoso e hígado 3D translúcido

El hígado 3D era una masa opaca sin referencias. Ahora `src/anatomy/couinaud.ts` deriva la
partición de Couinaud de la MISMA escena: el plano de cada suprahepática (que contiene el tronco y
el eje de la cava) separa V/VIII de VI/VII (derecha), el lóbulo derecho del IV (media, línea de
Cantlie) y II de III (izquierda); la fisura umbilical (decisión 40) separa IV de II–III; el plano
portal (z −36) separa superior de inferior; y el caudado (I) es lo que queda entre la cava y la
fisura del ligamento venoso, por detrás de ella. Si un vaso se mueve, los segmentos lo siguen (test
`couinaud.test.ts`). El navegador 3D colorea la malla vértice a vértice con esa función, la hace
translúcida (opacidad 0,62, sin escritura de profundidad) para ver suprahepáticas, porta y arteria
dentro, y rotula I–VIII en el centroide de cada segmento. La fisura del ligamento venoso entra
también en el modelo acústico como lámina fibrosa de 2,4 mm (`LigamentumVenosum`, retrodispersión
2,6) en el plano porta hepatis → desembocadura de la suprahepática izquierda, acotada en x y z:
la línea ecogénica que delimita el caudado en el corte subxifoideo. Misma fórmula en GLSL
(`uLigVen`, `uLigVenBox`), equivalencia TS ↔ GLSL 100 %. Los segmentos son metadatos: no cambian
la señal.

## 43. Arquitectura renal, receso de Morison, cortina pulmonar, pared periportal y pared blanda

Cinco defectos de fidelidad señalados sobre la imagen. (1) **Riñón**: las 16 pirámides se fundían
en un anillo hipoecoico; ahora son cuñas discretas (semiángulo 7°→14°, semilongitud 3,5→8 mm)
separadas por columnas de Bertin; cápsula fibrosa de 0,6 mm (`RenalCapsule`, ecogénica) que
delimita el riñón; pelvis de orina anecoica (`RenalPelvis`, 18 × 7 × 5 mm) en el centro del seno.
(2) **Interfaz hígado–riñón**: la grasa perirrenal (4 mm) llega hasta la impresión renal del hígado,
así que en el receso de Morison la secuencia es cápsula hepática → grasa de Gerota → cápsula renal
→ corteza, sin el hueco de 0,5 mm que antes se clasificaba como intestino. (3) **Cortina pulmonar**:
lámina de pulmón de 3 mm pegada a la cara interna de la pared en el receso costofrénico derecho
(x < −45, y < 40) desde la cúpula hasta z = 18 − descenso diafragmático; en inspiración baja y tapa
la parte alta del hígado lateral, el rayo se refleja (pasada A) y deja líneas A a múltiplos de la
profundidad de la pleura: signo de la cortina. El descenso viaja en `VesselCaliber.diaphragmCaudalMm`
(el marco material es espiratorio; la lámina vive en la pared, que no se desplaza). (4) **Pared
periportal** proporcional al calibre local (`wallThicknessMm`: 0,24·r acotado a 0,5–1,4 mm): el doble
contorno ecogénico se desvanece hacia la periferia. (5) **Pared blanda** (`skinSoftness`): bajo el
xifoides la pared absorbe el 65 % del hueco por basculación/inclinación (35 % bajo el reborde, 15 %
sobre costillas), así la VCI en eje largo con basculación craneal conserva el acoplamiento sin
presionar. El punto de partida renal pasa a la línea axilar posterior con el eje largo del riñón en
el plano (barrido de poses). Misma regla en TS y GLSL; equivalencia 100 %.

## 44. Medición del alumno robusta: envolvente de la banda contigua, lado venoso y regla de S invertida

La primera prueba de la cadena completa del alumno (`examChain.test.ts`: puerta desde una ventana
real → IQ → espectro → la MISMA medición que la pestaña Medir → grado) falló en 2 de los 3 casos:
el caso sano salía «leve» y la FA «grave». Cuatro causas, todas en la medición, ninguna en la
fisiología:

1. **Envolvente**: «último bin sobre umbral» por columna → un bin de ruido aislado era un pico de
   hasta 3× la verdad, y S/D/PF toman extremos por ventana. Ahora: espectro promediado 3 × 3
   (columnas × bins, potencia lineal), bins significativos (> suelo + 6 dB), banda CONTIGUA a la
   línea de base (se corta tras 3 bins no significativos), envolvente por el método del percentil
   (92 % de la potencia de la banda) y mediana temporal de 5 columnas (`columnBandEnvelopes`,
   `observedTrace`). Correlación con la velocidad real 0,92 → 0,99.
2. **Extremos**: el mínimo/máximo absoluto de una ventana caía en una columna con caída de señal.
   Las trazas medidas usan el cuantil 0,97 (`robustExtremeInWindow`); la verdad fisiológica sigue
   con extremos exactos sobre la señal limpia.
3. **Renal**: arteria y vena interlobares comparten la puerta en lados opuestos de la línea de
   base; la medición elegía el lado dominante columna a columna y en sístole saltaba a la arteria.
   Ahora la vena se lee siempre en su lado: el arterial es el de mayor relación sístole/diástole
   (`observedSideTraces`, `measureObservedRenal`).
4. **S invertida** (decisión 5): «retrógrado ≥ 25 % del pico» convertía la muesca breve de la onda
   C de la FA en «S invertida» al medirla sobre la envolvente (≈ 1,5× la velocidad media). Ahora
   ≥ 50 % (`S_REVERSAL_FRACTION`), invariante de escala; el caso grave (S claramente retrógrada)
   no cambia.

Con ello los tres casos coinciden con la verdad en los tres territorios y dan grado 0, 3 y 1; la
PF medida queda a ≤ 5 puntos (17/13, 73/75, 35/36 %). La prueba usa la técnica de un operador:
puerta dentro de la luz con el mejor ángulo de insonación y escala hasta el límite de la
profundidad (PRF ≤ 0,9·c/2d). La pestaña Medir hereda las correcciones.

## 45. Anatomía de una sola fuente, paso 1: esquema único de uniforms de la escena

**Contexto.** La anatomía existe en TS y en GLSL. Los ~40 uniforms que la describen (torso,
diafragma, hígado, vesícula, riñones, costillas, cortina…) se declaraban a mano en
`anatomy.glsl.ts` y se subían a mano, con los mismos nombres, en ~85 líneas de `renderer.ts`,
cuatro veces por cuadro y con asignaciones de memoria en cada una. Un nombre mal escrito o un
uniform olvidado no da error: `getUniformLocation` devuelve `null` y el valor se ignora.
**Opciones.** (a) Seguir a mano con la e2e de equivalencia como red; (b) generar GLSL desde un
subconjunto de TS (coste alto, herramientas propias); (c) un esquema de datos del que salgan
declaraciones y subida, como primer paso hacia un grafo de nodos SDF interpretado por TS y GLSL.
**Decisión.** (c): `ultrasound/shaders/sceneUniforms.ts` define `SCENE_UNIFORMS` (nombre, tipo,
tamaño, documentación y función de valor). `SCENE_UNIFORMS_GLSL` sustituye las declaraciones en
`ANATOMY_GLSL`; el renderer evalúa los valores una vez por instante (`evaluateSceneUniforms`) y
los sube a cada programa (`uploadSceneUniforms`), comprobando el tamaño de cada valor.
**Consecuencias.** Un órgano nuevo añade sus uniforms en un solo sitio; `renderer.ts` pierde ~85
líneas; menos asignaciones por cuadro. Siguientes pasos: módulos por órgano que co-localicen su
SDF en TS, su fragmento GLSL y sus uniforms; después, primitivas genéricas (elipsoides orientados,
láminas, tubos) como datos en la textura de escena.
**Verificación.** `sceneUniforms.test.ts`: ANATOMY_GLSL no declara uniforms a mano, todo uniform
usado está en el esquema y ninguno sobra, valores finitos del tamaño correcto para los tres casos;
la e2e de equivalencia TS ↔ GLSL sigue al 100 %.

## 46. Anatomía de una sola fuente, paso 2: la anatomía es dueña de su gemelo GPU, módulos de órgano y equivalencia volumétrica

**Contexto.** Tras el esquema de uniforms (45) seguían tres problemas: el GLSL de la anatomía vivía
en `ultrasound/` aunque es la misma anatomía que `anatomy/`; cada órgano repartía su SDF entre
`scene.ts`/`primitives.ts` (TS) y `anatomy.glsl.ts` (GLSL) con constantes copiadas a mano (el
redondeo 3,0 de la fisura, el semiespesor 1,2 del ligamento venoso); y el gate de equivalencia
solo miraba los planos de las 4 ventanas. Prueba de mutación: cambiar en GLSL el redondeo de la
fisura de 3 a 6 mm no lo detectaban las ventanas (100 %).
**Opciones.** (a) Grafo de nodos SDF interpretado por TS y GLSL de una vez (reescritura completa
de `classify`); (b) migración progresiva por módulos de órgano, protegida por un gate volumétrico
estricto; (c) generar GLSL desde TS.
**Decisión.** (b). `anatomy/gpu/` contiene `anatomy.glsl.ts` y `sceneUniforms.ts` (la anatomía es
dueña de su gemelo). `anatomy/organs/` contiene módulos con la geometría, las funciones TS y su
gemelo GLSL con el MISMO nombre y las constantes del shader generadas desde el TS; primeros
módulos: `liverLigaments` (fisura umbilical y ligamento venoso) y `lungCurtain`. `ORGAN_MODULES`
los registra y `ANATOMY_GLSL` incluye sus gemelos. `volumeEquivalence` compara TS y GLSL en 50 000
puntos pseudoaleatorios de todo el tronco (semilla fija) y la e2e exige acuerdo EXACTO lejos de
interfaces (≥ 1 mm) en tejido, vaso y velocidad.
**Consecuencias.** Revisar un órgano es leer un archivo; un nombre GLSL sin gemela TS falla la
suite. La migración de vesícula, riñón, hígado y tubos queda como trabajo progresivo con la misma
red. La mutación anterior ahora falla la e2e.
**Verificación.** `organs.test.ts` (gemelos por nombre, constantes generadas, comportamiento),
`sceneUniforms.test.ts`, e2e `equivalence.spec.ts` con 3 casos × (4 ventanas + 50 000 puntos):
≈ 44 700 puntos interiores y 500–960 de sangre por caso, cero discrepancias.

## 47. Grafo de pasadas del renderer y tiempo de GPU que no miente

**Contexto.** `UltrasoundRenderer.render` encadenaba a mano ocho pasadas (A–G, persistencia,
presentación) en un método de 170 líneas; el orden y las dependencias entre texturas solo estaban en
comentarios, y no había ninguna medida del coste de GPU por pasada ni del cuadro (la evaluación
estructural lo señalaba como hueco de rendimiento). Al medir con `EXT_disjoint_timer_query_webgl2`
en WebKit/Metal, cada pasada devolvía ≈ 18 ms (también el blit final) con un cuadro real de 16,4 ms
medido de forma síncrona: la suma (129 ms) no significaba nada.
**Opciones.** (a) Grafo de render completo con asignación automática de texturas (excesivo para
ocho pasadas fijas); (b) tabla declarativa de pasadas + validación pura + temporizador por pasada;
(c) solo temporizador. (b) sin comprobar la resolución del temporizador habría publicado números falsos.
**Decisión.** (b). `ultrasound/passGraph.ts` declara `FRAME_PASSES` (lee, escribe, cadencia de
cuadro o de color) y `passGraphErrors` exige que nadie lea antes de que exista su entrada, un único
escritor por recurso (salvo la historia ping-pong), ninguna pasada muerta y salida a pantalla.
`render()` recorre la tabla y cada pasada es un método (`passes: Record<PassId, …>` obliga a
implementarlas todas). `ultrasound/gpuTimer.ts` mide cada pasada sin bloquear (consultas leídas
cuando el driver las da por disponibles, media exponencial, descarte de intervalos «disjoint», tope
de consultas en vuelo) y `summarizeGpuTimings` solo da tiempos por pasada si la pesada (B, campo
crudo) cuesta más de 3 veces la trivial (S, presentación); si no, da solo el total del cuadro.
**Consecuencias.** La pestaña Docente y el diagnóstico exportable muestran el tiempo de GPU del
cuadro, y por pasada donde el navegador lo permite (en Metal: «este navegador no separa las
pasadas»). Añadir una pasada es una fila en la tabla más su método; la suite rechaza órdenes rotos.
Pendiente: presupuesto de tiempo por cuadro en CI (SwiftShader no expone temporizadores).
**Verificación.** `passGraph.test.ts`: la tabla es válida y cinco mutaciones del orden (axial antes
del campo crudo, sin lateral, sin color, color de cuadro detrás de G, dos escritores, pasada muerta,
sin presentación) fallan; el temporizador con un WebGL falso (no bloquea, media, «disjoint»,
reutiliza y libera consultas, deja de medir si el driver no responde) y el resumen con los valores
medidos en Metal. En vivo: modo B y color correctos, equivalencia 100 %, «GPU ≈ 26 ms/cuadro».
**Enmienda (coste por diferencia, 24-09-2026).** Como Metal no separa las pasadas, el gancho
`frameCostMs(n, { repeatPass })` vuelve a emitir el dibujo de una pasada dentro del cuadro (mismo
programa, uniforms y texturas) y su coste sale por diferencia del tiempo de pared; las repeticiones caen
dentro del intervalo de esa pasada en el temporizador. Cada repetición dibuja en un destino de prueba con
el tamaño y los formatos de la salida de la pasada, alternando dos: la salida real no se toca (la imagen
no cambia) y cada repetición es su propio pase de render, porque sobre el mismo destino una GPU de
teselas como la del M4 podría sombrear solo el último de unos triángulos opacos que se tapan (sin mezcla,
sin `discard`, sin profundidad) y la diferencia no mediría nada. Antes de fiarse de un Δ, comprobar que
Δ(4 repeticiones) ≈ 4·Δ(1) (`docs/TESTING.md`). `forceColor` mide el cuadro con la pasada de color, que la
cadencia de la decisión 39 salta con el reloj quieto; con la caja encendida y sin él, el gancho lanza en
vez de devolver ≈ 0 ms. La aplicación no pasa nunca estas opciones (`frameCost.test.ts`, también con el
renderizador real sobre un WebGL falso).

## 48. La sangre del volumen de muestra reentra por su propia cuerda y la vena renal es el lado que domina la puerta

**Contexto.** Con la puerta quieta sobre la suprahepática del sano, en apnea, la señal PW se perdía
sola: los dispersores con peso de haz > 0,3 pasaban de 30 a 0 en 10 s, el peso de sangre caía al
66 % del de una siembra nueva y la VSH acababa «sin señal» a los ~20 s, con la verdad constante.
Causa: al salir de la caja, la sangre reentraba por su recta de corriente pero se reclasificaba en
el punto de entrada, y la reclasificación periódica la reorientaba con la tangente local; en un
vaso curvo la recta de vuelta no era la de ida, la población derivaba hacia una esquina y quedaba
atrapada en cuerdas de 8–32 ticks, demasiado cortas para volver a reclasificarse (estado
absorbente). Además cada reentrada costaba una clasificación anatómica (44 µs): 19 000–30 000 por
segundo, más de un segundo de CPU por segundo simulado.
**Opciones.** (a) Reentrada por la frontera de la caja con probabilidad proporcional al flujo
entrante v·n: exacta, pero por rechazo cuesta ~2 clasificaciones por reentrada en la suprahepática y
~35 en una interlobar (la caja es casi toda parénquima). (b) Caja periódica en sus propios ejes:
en un vaso oblicuo la sangre reentra fuera de la luz y se convierte en tejido para siempre (fuga).
(c) Órbita cerrada: la sangre reentra por su cuerda con su identidad y su dirección.
**Decisión.** (c). `SampleVolumeIQ.spawn` devuelve, para la sangre, `reenter(exited, …)`: fase y
amplitud nuevas, mismo vaso, misma base de flujo, sin clasificar; la reclasificación periódica ya
no reorienta la sangre que sigue en su vaso. El tejido se sigue clasificando al entrar (con la
respiración puede entrar sangre) y, si la recta ya no cruza la caja, se resiembra al azar como
antes. Nuevo diagnóstico `GateComposition.bloodWeight` (Σ w_sangre / N). Consecuencia en la
medición: con el centro del vaso poblado, la arteria interlobar vecina resultó ser una señal débil
(19–25 dB bajo la vena en el sano y en FA) cuya traza, rozando el umbral, sale plana: la regla
«el lado de mayor S/D es la arteria» elegía al azar. `measureObservedRenal` toma ahora como vena el
lado que domina la potencia (`sideEnergyDb`, ≥ 6 dB) y solo si ambos son comparables (congestión
grave: la vena monofásica queda 3–4 dB por encima) usa el predominio sistólico.
**Consecuencias.** La medición es estable durante minutos de puerta quieta; la cadena PW baja a
~4 400 clasificaciones por segundo en la suprahepática (÷6). Las envolventes llegan ahora al máximo
real del perfil: el pico S normal alcanza ~48 cm/s y a PRF 3200 (±49 cm/s) se pliega; la prueba de
dirección usa 4500 Hz, como subiría la escala el operador. Pendiente: en vasos finos y curvos la
cuerda recta puede salir de la luz (sangre fuera del vaso hasta la siguiente reclasificación, que
sigue alcanzando a un cuarto fijo de la población: `thin-vessel-sample-volume-lag`).
**Verificación.** `sampleVolume.test.ts`: en apnea sobre la suprahepática, el peso de sangre con
historia se mantiene > 0,8 del de una siembra nueva entre 14 y 22 s (sin el cambio: 0,66, falla).
`examChain.test.ts` (sano y FA: «continuo» con la vena bien elegida; antes, con el arreglo y la
regla S/D, salía «bifásico») y `doppler.test.ts`.

## 49. Control de calidad de la captura PW: «no medible» con motivo, onda reproducible y suelo de la captura

**Contexto.** La pestaña Medir clasificaba cualquier espectro: la VSH del caso grave en la cadena
del alumno «acertaba» midiendo ruido (la puerta caía en la confluencia con la VCI dilatada), la
e2e de captura medía la sombra de la cortina pulmonar, y con respiración tranquila la puerta fija
sobre la suprahepática del sano daba «grave» (S +36 cm/s en un latido y −13 en el siguiente, o S
invertida en tres latidos con D invertida en uno). La base de conocimiento A.4 exige que «no
medible» nunca sea sinónimo de normal. Además la envolvente se hundía en el pico S: el suelo de
cada columna era su mediana, que es sangre cuando el perfil llena más de media banda.
**Opciones.** Umbral de potencia global (no distingue un vaso intermitente de uno débil); ajustar
el patrón con la verdad (prohibido: la medición es sobre la señal adquirida); pedir apnea siempre
(la respiración tranquila es parte del examen real). Para el suelo: percentil fijo por columna
(sesgo distinto con y sin suavizado) o nivel de ruido conocido del equipo (la medición solo ve
columnas).
**Decisión.** `doppler/measureQuality.ts` juzga cada captura sobre el espectro suavizado:
sangre = ≥ 2 bins contiguos a suelo + 12 dB fuera de la banda del filtro de pared; un latido vale
con sangre en ≥ 60 % de sus columnas. Motivos, en orden: sin señal (ningún latido vale y sangre en
< 20 % de las columnas), aliasing (en ≥ 3 columnas de algún latido la sangre toca a la vez los dos
bordes de la banda con un hueco al nivel del ruido entre ambos, o > 25 % de la energía en el 15 %
exterior de la banda: a PRF 1000–1800 el pico S del sano plegado al otro lado se leía como S
invertida, «grave», y la energía junto a ±Nyquist era solo del 10–14 %),
intermitente (algún latido no vale), inconsistente (suprahepática: S anterógrada en unos latidos e
invertida en otros, o D invertida en alguno, con |x| ≥ 25 % de D) y pocos latidos (< 3). En la
interlobar se juzga el lado de la vena. La captura con motivo se muestra con su texto y no entra en
el grado. El suelo de cada columna es su percentil 25 más la distancia mediana − P25 que tiene el ruido en
la captura (`captureNoiseFloorsDb`): una forma, no un nivel, así que no cambia con la ganancia (un
primer intento acotaba por el decil de la captura y un cambio de ganancia a mitad dejaba pasar ruido
como flujo: grado 3 con el visto bueno). Solo cuentan los latidos que el espectro cubre (≥ 90 %),
la captura toma los 4 últimos latidos completos de sus 7 s y el flujo se cuenta desde el corte del
filtro de pared + 37,5 Hz. Una captura rechazada no muestra patrón ni en el resultado ni en las
filas del protocolo. La técnica del operador (`bestGateOnVessel`) evita la
confluencia con la VCI (≥ 10 mm) y admite un peso de ventana acústica (`acousticWindowWeight`),
que usan los ganchos de la e2e.
**Consecuencias.** El alumno ve por qué no vale su captura y cómo corregirla (apnea, escala,
contacto). La S del sano en la app pasa de 15–25 cm/s (patrón que oscilaba entre normal y leve) a
29–31 con S/D 1,61–1,74 (verdad 1,72). Pendiente: el aliasing fuerte se pliega a velocidades
plausibles y no se detecta (`severe-aliasing-not-detected`); la calidad es conservadora en la FA
(una S pequeña tiene puntas de signo contrario y a veces se rechaza en apnea; un umbral relativo a
la propia S rechazaba menos pero dejaba pasar una S invertida falsa, que sí cambia el grado).
**Verificación.** `measureQuality.test.ts` (13 espectros sintéticos: cada motivo y sus falsos
positivos, entre ellos un pico plegado con poca energía en los bordes y una onda que roza un solo
borde); `examChain.test.ts`: a PRF 1400 la VSH del sano sale «grave» y la calidad dice aliasing,
a 5000 normal y medible; `dsp.test.ts` (un flujo que llena 80 de 128 bins no sube el suelo);
`examChain.test.ts`: en apnea las tres capturas pasan la calidad en los tres casos; la interlobar
grave con respiración es intermitente; y en capturas sucesivas cada 2 s durante 26 s (sano, FA y
grave con respiración tranquila; sano y FA en apnea) ninguna captura con el visto bueno da un
patrón falso y en apnea más de la mitad son medibles (sin exigir D anterógrada, el sano con ventana
daba «grave» a los 10 s: la prueba falla). `dsp.test.ts`: un salto de ganancia de +10 dB en una
captura de ruido no deja ninguna columna con envolvente. Revisión adversarial de contexto limpio
antes del PR: ganancia, filas del protocolo, cobertura del espectro, filtro de pared alto y latidos
por captura, corregidos. E2e: en apnea la VSH se mide con valor numérico
y con la sonda levantada la captura dice «no medible: no hay flujo en la puerta».

**Enmienda (revisión externa, C10, 24-09-2026).** La regla «sangre en ≥ 60 % de las columnas del latido»
no mira la fase: una vena renal monofásica solo lleva flujo en diástole. Una revisión adversarial sobre
la cadena real (1296 capturas) mostró que la vena monofásica alcanzable (congestión grave, apnea) se
rechazaba por otra causa. A la PRF por defecto (2600 Hz, ±40 cm/s) su onda D (~34 cm/s) se pliega y
deja la ventana diastólica sin sangre del lado de la vena. Ningún latido valía, y la calidad decía «el
vaso entra y sale de la puerta» en vez de «suba la escala». A la PRF máxima ya era medible. Cambios en
la medición renal (suprahepática y porta no cambian):

- Pasa su ventana diastólica (`phaseWindow`). Un latido vale si la sangre cubre ≥ 80 % de esa ventana
  y su fracción de columnas con sangre queda a ≤ 0,15 de la mediana de los DEMÁS latidos. Con la
  mediana de todos, 4 latidos permitían un reparto 2/2: una vena bifásica que perdiera la sístole en
  dos latidos se habría leído monofásica, con grado 3.
- La reproducibilidad se exige también a los latidos llenos.
- Si ningún latido vale y la captura se pliega, la calidad dice aliasing antes que intermitente.
- El texto de «intermitente» dice que el flujo no se repite de un latido a otro.

Efecto medido en la cadena real: con respiración, las capturas aceptadas bajan de 642 a 467 y su
precisión sube del 70 % al 88 %. El coste: se rechaza el 8,7 % de las que ya eran correctas (venas
continuas con un latido a 0,6–0,85 de sangre frente a 0,92–1). En apnea nada cambia, salvo el mensaje
del grave a 2600 Hz, que ahora es aliasing. Ninguna captura pasa a dar un monofásico falso.

## 50. El color comparte la transmisión del PW y su ganancia (en dB) alcanza el ruido del equipo

**Contexto.** El panel de expertos (22-09) encontró que el color no mostraba ruido ni a la ganancia
máxima y que color y PW no coincidían en sensibilidad. El color convertía la transmisión de la
pasada A (frecuencia B) a la Doppler con un exponente fijo 0,714 (B a 3,5 MHz) aunque el perfil de
la sonda tiene B y Doppler a 2,5 MHz; el PW usa la frecuencia Doppler del perfil. La ganancia de
color era un factor ×0,2–×4 y el ruido del estimador necesita ~×14 para asomar.
**Opciones.** Bajar el umbral de presentación (cambia a la vez la sensibilidad a la sangre y al ruido,
y la prueba de contacto que cuenta celdas); subir solo el máximo del factor lineal (sin unidades
reconocibles para el operador).
**Decisión.** `FRAG_COLOR` usa `uDopplerFreqRatio` = `dopplerEffectiveMHz / bEffectiveMHz` del
perfil. La ganancia de color pasa a `ColorSettings.gainDb` (−20 a +24 dB, `EQUIPMENT_LIMITS`)
sobre `COLOR_GAIN_REF` = ×2, calibrada con GPU real con la sonda levantada (ruido puro).
**Consecuencias.** Por defecto (0 dB) la suprahepática intercostal (−18 dB de transmisión) se ve con
~1 400 celdas y el ruido puro con 0; a +12 dB el ruido empieza a asomar (0,1 %) y al máximo llena el
64 % de la caja. Los vasos profundos en sombra (VCI subxifoidea −36 dB, porta desde el flanco −43 dB)
solo aparecen cerca del ruido, como en un equipo al límite de penetración.
**Verificación.** E2e «color: la misma transmisión que el PW y una ganancia que alcanza el ruido»:
|color − PW| < 1 dB en la puerta renal; ruido puro < 0,1 % a 0 dB y > 5 % a +24 dB.
`doppler.test.ts` exige el uniform del perfil en el shader (sin exponente literal) y
`equipment.test.ts` el acotado de la ganancia en dB.

## 51. Transiciones lentas en el volumen de muestra e invariantes de §21 sobre la señal

**Contexto.** Al escribir los invariantes de la guía §21 sobre la señal de la cadena completa, «un
vaso que sale de la puerta pierde la señal» fallaba: con respiración profunda y la puerta ya fuera
de todo vaso (composición 0 %), el espectro tenía «sangre» en el 67–98 % de las columnas. Causas,
medidas volcando el espectro: (1) el peso del haz de cada dispersor se actualizaba a escalones cada
SLOW_EVERY = 8 ticks y el clutter del tejido que se mueve (40 dB sobre la sangre) se replicaba a
múltiplos de PRF/8 por toda la banda; (2) los dispersores de tejido que salían de la caja
desaparecían de golpe con el peso de la cara (≈ 0,04 en las laterales) y (3) los que cambiaban de
identidad (sangre ↔ tejido, ×100 de amplitud) también: chasquidos de banda ancha a cientos por
segundo. El suelo aparente del espectro quedaba 20–40 dB sobre el ruido real.
**Opciones.** Actualizar pesos y fases en cada tick (×8 de coste); agrandar la caja a 3,5σ para que
se entre y salga con peso despreciable (mitad de densidad de dispersores en el centro, más varianza).
**Decisión.** El peso se interpola en rampa entre actualizaciones (`dw`); el tejido entra y sale en
una rampa de amplitud de AMP_RAMP_TICKS = 32 ticks (~5 ms a 6 kHz: su energía queda junto a la línea
de base) y el que sale se resiembra al apagarse; el cambio de identidad (sangre ↔ tejido) se hace en
dos rampas, primero se apaga la identidad vieja con su velocidad y luego se enciende la nueva (con
una sola rampa, un eco de tejido viajaba a velocidad de sangre y daba puntas en la S). La sangre
entra y sale con su amplitud por su cuerda (eco 100 veces menor, por caras de peso ≈ 0; apagarla en
rampa dejaba un 20 % de la población fuera de la caja en el flujo rápido), pero la que se siembra al
azar entra en rampa. La transmisión hasta la puerta, que la app recalcula cada ~32 ms con la anatomía
que respira y cambia a saltos (sombras costales), se aplica suavizada (1/32 por tick): cada salto
escalaba toda la IQ y era una línea vertical en el espectrograma. Coste: unas sumas por dispersor y
tick. Se probó además rotar la reclasificación entre los
cuatro grupos (ahora sin chasquidos): no mejoró la sangre que el vaso deja atrás y no se incluye.
**Consecuencias.** Con respiración profunda el suelo del espectro vuelve a su nivel real y el clutter
queda en la banda baja, como en un equipo; aun así, 60–70 dB sobre el ruido y por encima de un
filtro de pared de 25 Hz, tapa el flujo venoso lento (`respiratory-clutter-masks-slow-flow`): el
invariante de la puerta se prueba en apnea desplazando la puerta, y la coherencia respiración ↔
volumen de muestra sobre la composición (`sampleVolume.test.ts`).
**Verificación.** `invariants.test.ts`: reproducibilidad bit a bit (y otra semilla, otro espectro);
invertir y corregir 60° no cambian el patrón (S y D ×2 exactos); la puerta sobre la VSH ve sangre en

> 90 % de las columnas, a 10 mm en el parénquima en < 5 % y al volver otra vez > 90 %; la inversión
> del color no aparece en el estimador. Espectros volcados en respiración profunda antes y después; en
> la app, el espectrograma de la VSH con respiración profunda pasa de franjas horizontales por toda la
> banda (réplicas a PRF/8) y líneas verticales a un fondo limpio con el clutter en la línea de base.

## 52. La fidelidad del modo B se mide con un banco reproducible, en la envolvente y en la imagen mostrada

**Contexto.** Evaluación ciega de la tanda 1.5 (23-09-2026): dos jueces de contexto limpio
distinguieron las 21 imágenes simuladas de ecografías reales de Wikimedia Commons (7 parejas A/B y
14 sueltas), casi siempre en menos de 1 s; realismo 2,6 frente a 6,3, nota global 2/7. La pista
número uno, en los 14 paneles, fue el grano: celdas claras separadas por «grietas» oscuras. La única
guarda de imagen era la SNR de Rayleigh (e2e), que ya pasaba (1,7–2,05): el defecto es de segundo
orden y ninguna prueba lo veía. Y la causa no era la que parecía (se atribuyó al fundido
`smoothstep` de los dispersores). Con la envolvente real de la GPU (M4, Metal) en hígado despejado,
el moteado es como el de un campo ideal en todas las vistas medibles: SNR 1,90–1,97, fracción oscura
0,065–0,071 (Rayleigh 0,068), índice de grietas 0,055–0,089 (ideal 0,045–0,10), lóbulos ≤ 0,06,
grano axial 0,66–0,70 mm y lateral 0,82–1,10 × la PSF de `beamModel.ts`. Lo que se ve distinto es la
imagen mostrada: hígado en una mediana de 141–147 de gris con desviación 22–23 y 60 dB de rango, sin
composición espacial, frente a 52–112 y 10–16 en los equipos modernos de referencia (70 dB en el
Toshiba). Tampoco hay pared especular: la pared anterior de la VCI y las suprahepáticas da 1,0–1,2
× el hígado a cualquier incidencia, lo mismo que el moteado solo. Las «grietas» intercostales de una
primera medición eran sombras costales y líneas mal acopladas dentro de la máscara, y la pendiente
de 0,46 dB/cm con congestión era el refuerzo tras la VCI.
**Opciones.** Seguir juzgando a ojo (lo que llevó a atribuir las grietas a los dispersores);
métricas solo en la imagen (mezclan física y presentación); discriminador aprendido real/simulado
(necesita miles de imágenes reales del mismo equipo; queda para cuando las haya).
**Decisión.** Banco en dos niveles, `src/app/fidelity.ts`, sobre una rejilla de clasificación en CPU:

- `envelopeTexture`: SNR, grano (FWHM de la autocovarianza axial y lateral, comparado por bandas de
  profundidad con la PSF), lóbulo secundario, fracción oscura e índice de grietas (fracción de lo
  oscuro en componentes conexos de ≥ 2 granos); NaN si el grano no cabe en el parche.
- La máscara de hígado despejado: a ≥ 6 mm (3 mm en la imagen) de cualquier tejido que no sea hígado,
  vasos incluidos; líneas acopladas; antes del primer gas o hueso en la línea y sus vecinas; todas las
  muestras del parche dentro. El gris y el perfil, además, en hígado puro (≤ 0,5 dB de atenuación
  distinta en el camino).
- `displayStats`, `depthProfile` (regresión ponderada por píxeles) y el contraste pared/hígado por
  tramos de incidencia (0–20°, 20–40°, 40–60°) con la normal real de la pared (gradiente de la
  distancia a la luz: la `boundaryNormal` de TS no es una normal), sobre la imagen que lee
  `renderer.readDisplay()` (solo pruebas).
- El gancho `__vexusTest.fidelity`, `npm run fidelity` (GPU real, 2 casos × 4 vistas, línea base con
  el árbol de `src/` en `docs/fidelity/baseline.json`) y `npm run fidelity:blind` con el protocolo de
  los jueces (`docs/fidelity/`).

La curva de grises pasa a una constante compartida (`ultrasound/greyMap.ts`) porque el banco la
invierte para medir en dB.
**Consecuencias.** Cada PR de imagen de la tanda 1.5 se acepta con el banco antes y después; los
umbrales están en `docs/fidelity/README.md`. Con la línea base, la tanda cambia de orden: primero la
cadena de presentación (preajuste abdominal y, tras abaratar la pasada A, composición espacial), y de
los dispersores solo lo que la composición necesita (fase que dependa de la dirección de insonación)
y lo que los jueces vieron (el mismo moteado en todos los tejidos). Sin cambio para el alumno.
**Verificación.** `fidelity.test.ts` sobre campos sintéticos con la geometría del renderizador: el
moteado ideal da SNR 1,93, fracción oscura 0,068 y grano = 2,355·σ ± 12 %; la envolvente como
valor absoluto de un campo real (la hipótesis de un juez) da SNR 1,34 y 7 veces más grietas; una
modulación periódica deja un lóbulo de 0,47; un grano mayor que el parche da NaN. `fidelityScene.test.ts`
recorre la anatomía del sano en CPU (subxifoidea e intercostal) con una envolvente ×0,1 fuera del
hígado y una imagen pintada: la máscara solo mide hígado y las paredes salen con el cociente pintado
en sus tramos reales. La e2e mide la envolvente y la imagen mostrada con SwiftShader. Una revisión
adversarial encontró cinco defectos antes del PR (normal de pared falsa, refuerzo en la pendiente,
vasos dentro de la máscara, NaN convertidos en 0 y pruebas que no los veían); este registro describe
el banco ya corregido.

## 53. Preajuste abdominal: 70 dB y el hígado a media escala

**Contexto.** El banco de fidelidad (decisión 52) mostró que la textura que delató las 21 imágenes de
la prueba ciega no sale de la física del moteado (la envolvente es la de un campo ideal) sino de la
presentación: con 60 dB de rango y la referencia en −20 dB, el hígado quedaba en una mediana de
141–147 de gris con desviación 22–23, y cada cero del moteado se veía como una línea oscura sobre
fondo claro. En los equipos modernos de referencia el hígado está a 52–112 con desviación 10–16, y el
Toshiba muestra 70 dB en pantalla.
**Opciones.** Bajar la ganancia por defecto (el deslizador en −13 dB de salida confunde al alumno y
deja menos recorrido hacia abajo); cambiar la curva de grises (la exponencial es la de EchoTwin,
decisión 90, y a media escala es casi lineal); filtro de reducción de moteado (cosmético, lo prohíbe
§23).
**Decisión.** `DEFAULT_BMODE.dynamicRangeDb` = 70 y `DISPLAY_REF_DB` = −33 (antes −20 literal): con la
ganancia a 0 dB el hígado queda a media escala. La prioridad del color sigue siendo un umbral de gris,
como en un equipo, pero se deriva de las constantes (`COLOR_PRIORITY_GREY`: el gris del nivel 6 dB
sobre la referencia con el rango por defecto) para bloquear el mismo tejido que antes; la misma
fórmula da el 0,62 del preajuste anterior. La persistencia se queda en 8 bits: en una escena quieta
el filtro converge al valor exacto con un error ≤ 1 nivel de gris, y pasar a RGBA16F duplicaría la
memoria de vídeo de los tres destinos a pantalla completa.
**Consecuencias.** Banco antes → después (M4, densidad 2): hígado 141–147 → 99–103 de gris;
desviación 22–23 → 15–16 (ya en el rango de los equipos modernos sin composición espacial); luz
vascular 14–37 → 7–24; la envolvente, la pendiente en profundidad (−0,13 a +0,29 dB/cm), el diafragma
(nunca saturado) y los cps no cambian. Color sobre la suprahepática desde la ventana intercostal: cubre
el 91 % de la sangre de la caja (95 % antes, dentro de la variación entre cuadros) y el 0,07 % del
hígado (0,45 % antes). El HUD muestra «RD 70». La luz sigue algo gris (sangre a −31 dB del hígado):
queda para el moteado por tejido.
**Verificación.** `fidelity.test.ts` (el hígado a media escala con estas constantes; la prioridad
reproduce el 0,62 anterior); la e2e del banco exige hígado 85–120 de gris con desviación < 19 y luz
< 30; banco completo antes y después en `docs/fidelity/`.

## 54. Transmisión en cuatro etapas, hueso clínico y penumbra de la apertura

**Contexto.** Tras el preajuste (decisión 53), las sombras eran lo siguiente que delataba la imagen:
columnas negras de techo plano con el grano del tejido dentro y bordes de un solo escalón. Tres
causas: (1) el hueso usaba la atenuación de IT'IS para cortical pura (4,7 dB/cm/MHz): tras una
costilla quedaban ~20–25 dB y, con 70 dB de rango, el hígado de detrás seguía visible (banco: núcleo
de la sombra 20–21 dB bajo el hígado); (2) un solo rayo por línea: una costilla somera tapa en
realidad solo parte del cono de la apertura, de modo que la sombra tiene penumbra y se rellena en
profundidad; (3) la pasada A remarchaba el rayo entero para cada profundidad de salida (O(N²),
~2,5 millones de clasificaciones por cuadro) y la textura se leía con filtrado lineal, que mezclaba
entre líneas profundidades de impacto con «sin impacto» (−1). Una revisión externa del código llegó a
lo mismo: separar pérdida local e integración para liberar presupuesto para subrayos.
**Opciones.** Subrayos reales por celda (K veces el coste de hoy); desenfocar la sombra en pantalla
(cosmético, §23); dejar el hueso de IT'IS y oscurecer con la ganancia.
**Decisión.**

- Pasada A en cuatro etapas: A0 impactos por línea (una marcha: espejo, primer gas, primer hueso),
  A1 un segmento por celda sobre el camino de A0, A2 suma acumulada con las reglas de
  `ultrasound/transmission.ts` y A apertura. ~60 000 clasificaciones por cuadro.
- Apertura (`ultrasound/aperture.ts`, gemelos TS y GLSL): si un gas o hueso por encima de r corta el
  cono (D·(1 − r₀/r) a su profundidad r₀), la transmisión de ida es la media de 9 líneas del cono,
  de emisión (26 mm) y de recepción (dinámica, F# 2,5); la de ida y vuelta, su producto.
- Hueso: 20 dB/cm/MHz efectivos (cortical + esponjosa; tablas clínicas 13–26, Bushberg).
- La salida de A lleva además la transmisión de un solo rayo, que usan el color y el PW: comparten
  así exactamente el modelo de la CPU (decisión 50). Diferencia deliberada, como el espejo: la
  penumbra de la apertura es del haz de imagen.
- La pasada B lee impactos y dirección con `texelFetch` (sin interpolar).
  **Consecuencias.** Las sombras nacen bajo el hueso, son completas junto a él y se rellenan en
  profundidad con bordes en rampa; siguen al mover la sonda. Los vasos tras una costilla quedan sin
  señal PW (realista). El cuadro entero cuesta 4,6–7,3 ms en vez de 12,9–16,3 (M4, misma carga).
  El banco de fidelidad excluye la penumbra de su hígado puro. Cifras antes y después en
  `docs/fidelity/README.md`.
  **Verificación.** e2e: la transmisión de un solo rayo de la GPU coincide con `rayAttenuationDb` en
  los mismos puntos (≤ 0,0001 dB con GPU real en cuatro ventanas; exige < 0,01); `aperture.test.ts`:
  sin obstáculo, un rayo; bajo una costilla sintética, sombra completa cerca y rellena en profundidad;
  borde en rampa monótona de ≥ 5 líneas; `passGraph.test.ts` con las cuatro etapas.

## 55. El medio de dispersores está anclado y no sigue a la sonda

**Contexto.** El moteado sale de una retícula material de 0,42 mm cuya coordenada elevacional se
comprime hasta el grosor de corte (decisión 99 de EchoTwin), para que la textura se decorrele al
inclinar la sonda un grosor de corte y no una célula. La compresión usaba como eje la normal ACTUAL
del plano y como pivote el origen del mundo: al girar la sonda cambiaba el medio. Con la sonda a
~100 mm del origen, 0,5° de giro desplazaban el campo 0,9 mm: correlación del moteado 0,16 con 0,5° de
giro y 0,02 con 1° de inclinación (gemelo TS de la pasada B). En un equipo el grano se conserva
mientras el plano no atraviesa otro tejido, y abanicar la sonda es la maniobra central del examen.
Lo señaló la revisión externa (C3).
**Opciones.** (1) Pivote en el plano actual, que sigue a la sonda en el plano (lo que proponía la
revisión): arregla el giro sobre el eje axial pero no la inclinación, porque los píxeles hondos del
plano nuevo quedan fuera del plano viejo sin comprimir (gemelo: 0,075 con 0,5°). (2) Medio fijo: eje
y pivote anclados. (3) Integrar de verdad en elevación con más planos (coste × planos).
**Decisión.** Medio anclado (`ultrasound/speckleField.ts`, `ElevationAnchor`). El eje y el pivote se
fijan con la sonda y no la siguen: la imagen se decorrela solo porque el plano atraviesa otro tejido.
Con la normal apartada α del ancla, la célula elevacional se adelgaza (|dq/dn| = √(sin²α + k²cos²α),
k ≈ 0,13 en el foco). A 20° la persistencia con 0,5° de inclinación cae a 0,3–0,65 y la SNR sube un
11–17 %; a 5° sigue ≥ 0,9 y ≤ +12 %. Por eso, si la normal se aparta más de 6° del ancla, el ancla se
renueva con un fundido de 8 cuadros entre los dos medios. El medio nuevo usa otra semilla:
√w·A + √(1−w)·B de dos campos gaussianos independientes sigue siendo gaussiano, así que la
estadística de Rayleigh no cambia durante el fundido. Un salto de pose entre cuadros (> 15 mm o

> 10°: el teletransporte de los ganchos de prueba) y el cambio de paciente reinician el ancla sin
> fundido; los puntos de partida de la app se animan y reanclan con fundido. En la pasada B,
> `speckleField` evalúa el segundo medio solo durante el fundido.
> **Consecuencias.** Abanicar o girar la sonda conserva el grano como en un equipo (gemelo: 0,95 con
> 0,5° de inclinación, 0,83 con 1°, 0,50 con 2°, 0,11 con 4°; giro axial 0,99 con 1°); trasladarla en
> elevación lo decorrela a la escala del grosor de corte (0,5 mm → 0,97; 2 mm → 0,66; 4 mm → 0,21). La
> imagen depende ahora de la trayectoria: volver a una pose tras girar más de 6° no da el mismo grano.
> Coste: una evaluación más del campo durante 8 cuadros cada 6° de giro.
> **Verificación.** `speckleField.test.ts` (gemelo TS): inclinación de 0,25–1° ≥ 0,95–0,75 y de 4–8°
> < 0,3; giro axial; traslación elevacional; a 1° del umbral, persistencia > 0,9 y SNR < +12 %; máquina
> de estados del ancla (fija por debajo del umbral, fundido monótono de 8 cuadros con la otra semilla y
> dos medios distintos en cada cuadro del fundido, sin reanclar a mitad de un fundido, salto sin
> fundido); Rayleigh y potencia iguales a mitad del fundido. e2e con GPU real, en apnea y sobre la
> envolvente del hígado dividida por su media local (~10 × 4 mm). La envolvente cruda la domina la
> atenuación sin TGC, y en la ventana intercostal quedan bandas de penumbra: dos moteados
> independientes correlacionaban 0,6 crudos y 0,45 quitando solo la media por fila. Lo halló una
> revisión adversarial.

- `speckleMotion` (GPU): 0,88 con 0,5° de inclinación, 0,78 con 2° de giro y 0,12 con 8°; exige
  ≥ 0,8 / ≥ 0,7 / < 0,3, y ≥ 0,9 al volver a la pose.
- `speckleCrossfade`: gira 1° por cuadro durante 16 cuadros y pasa dos fundidos. Exige la SNR dentro
  de ±15 %, cada cuadro correlacionado > 0,7 con el anterior (0,82–0,89 sin fundido) y saltos de
  nivel < 0,8 dB. Esta prueba halló dos defectos que el gemelo no veía:
  - el medio viejo se soltaba un cuadro antes y el último cuadro de cada fundido sumaba el mismo
    medio dos veces (+2,1 dB);
  - un reanclaje a mitad de fundido descartaba un medio de golpe (correlación 0,65).
    Ahora el medio viejo se suelta tras el último cuadro y no se reancla hasta que el fundido acaba.

## 56. Moteado por tejido, heterogeneidad continua y grumos en la grasa

**Contexto.** Un solo campo de dispersores servía a todos los tejidos; solo cambiaba la amplitud
(`uTissueBack`). El patrón del moteado continuaba a través de las paredes y el seno renal era
«hígado más brillante» (prueba ciega, decisión 52). La heterogeneidad lenta del parénquima eran cubos
de 6,25 mm de valor constante, con saltos de hasta 4 dB en sus caras. Lo señaló también la revisión
externa (C1).
**Opciones.** (1) Estadística K completa por tejido con densidad de dispersores variable (coste y
riesgo para la guarda de Rayleigh del hígado); (2) otra semilla por tejido, heterogeneidad continua y
una modulación lognormal de «grumos» solo en la grasa; (3) no tocar el moteado hasta la composición
espacial.
**Decisión.** (2), en la pasada B con su gemelo TS (`speckleField.ts`):

- Cada tejido suma a la semilla `tejido × 9,861`: es otra población y su moteado no continúa a
  través de un borde. El hash repite con periodo ≈ 9,70 en su coordenada; ese paso deja todas las
  diferencias de semilla (tejido y paridad del ancla, decisión 55) a ≥ 0,017 de un periodo.
- Heterogeneidad del parénquima con ruido de valor de fundido smoothstep sobre la misma célula de
  6,25 mm, escalada a la misma desviación que los cubos (1,15 dB). Ahora es continua: < 0,2 dB por
  0,1 mm.
- Grumos (`speckleClump`): la potencia se multiplica por una log-uniforme de media 1 en células de
  1,2 mm (~ la PSF lateral), con σ 1,0 en el seno renal, 0,8 en la grasa perirrenal y 0,5 en la
  subcutánea [EXTRAPOLACIÓN PROPIA]. Pocos dispersores dominan (estadística K) sin cambiar la
  potencia media; la mediana del gris baja algo, como toca a una K de igual potencia. Hígado, corteza
  y músculo no llevan grumos: siguen siendo Rayleigh.
- El grumo es un factor por píxel, del tejido del plano central, y se aplica a los tres planos de
  elevación a la vez. Se evalúa sobre la coordenada anclada, con la célula elevacional comprimida al
  grosor de corte como el moteado, y se mezcla en potencia durante el fundido del ancla. Un grumo por
  plano, sin anclar, oscurecía la grasa 0,5 dB y el seno parpadeaba al inclinar: persistencia de
  0,35 con 0,5° de inclinación, frente a 0,83 anclado.
- Los grumos viajan en `uTissueClump4` (de 4 en 4 por vec4, 7 ranuras): la pasada B queda en
  ~165 de los 224 vec4 de uniforms que garantiza WebGL2.
  **Consecuencias.** El seno renal y la grasa perirrenal tienen textura propia, más contrastada que la
  del hígado, y no parpadean al inclinar; las paredes y el parénquima vecino ya no comparten el grano.
  La guarda de Rayleigh del hígado no cambia. Coste: 7 hashes más por muestra de parénquima y 1–2 por
  píxel de grasa.
  **Verificación.** `tissueSpeckle.test.ts` (gemelo, por la pasada B de tres planos): correlación del
  campo entre tejidos < 0,08 (antes 1); heterogeneidad con saltos < 0,2 dB por 0,1 mm y desviación
  0,9–1,4 dB; grumos del seno con la misma potencia (±6 %), SNR al menos 0,3 menor y persistencia

> 0,7 con 0,5° de inclinación. `shaderLimits.test.ts`: ningún identificador suelto de TS en el GLSL
> (una primera versión declaraba `uTissueClump4[(TISSUE_COUNT + 3) / 4]` y el shader no compilaba; lo
> halló una revisión adversarial). e2e: la envolvente del hígado sigue siendo Rayleigh.

## 57. Ecos de interfaz: reflexión coherente en el cruce exacto, con Fresnel y suelo, lóbulo de Kirchhoff y coherencia de curvatura; espejo diafragmático exacto

**Contexto.** El banco de interfaces (PR 5a) midió con GPU paredes y cápsula a 1,02–1,26 sobre el
hígado, lo que da el moteado solo (referencias reales: 1,36–2,1), con huecos en el 65–95 % de las
líneas y rosario 0,23–0,38. El término especular de la pasada B (reflectividad·(n·d)⁴ en la muestra
cuya `bd` era menor que max(cosθ; 0,15)·dr, sin fasor) quedaba unos 10 dB bajo el moteado, vivía en
una sola muestra y dependía de dr (7,4 dB de deriva entre 100 y 240 mm de profundidad seleccionada).
Llevar Fresnel a la escala del moteado (hígado = 1) tampoco sirve: las paredes desaparecen (lo vio
la revisión externa). El espejo diafragmático quedaba en el centro de la primera celda gruesa de
pulmón, hasta 1,1 mm dentro, y el camino reflejado cruzaba pulmón negro: una costura entre el
diafragma y su imagen (gemelo: 66 % de las líneas; banco con GPU: 4–18 %). Tres normales de la GPU no
eran el gradiente de su distancia (e2e de 5a): la VCI (6–10°), el riñón junto al hilio y la cápsula.
**Opciones.** (1) Descriptor de la cara y eco en la pasada C: un MRT nuevo para lo que la pasada B ya
sabe con la misma consulta de `classify`. (2) Láminas de densidad Hann a través del espesor (diseño 3):
confunde reflexión con dispersión y no conserva el nivel. (3) Fase exacta de ida y vuelta −2k0·r_cara:
varía 2,2 rad por línea a 5°, las líneas (0,9–1,5 mm) la submuestrean y D la aliasa (gemelo: 1,25–1,38
con 27–47 % de huecos); una fase aleatoria o un canal incoherente de potencia dan lo mismo. (4) Un
factor de celda de resolución G(r): es la ley de un blanco puntual y apaga las paredes hondas 4–10 dB;
la ganancia coherente natural de D ya sigue a la de haces gaussianos coherentes (±1,2 dB entre 40 y
120 mm). (5) Sumar el eco en los tres planos elevacionales: duplica el término elevacional de C, que ya
es el resultado exacto de fase estacionaria. (6) Eco híbrido en la pasada B: el elegido.
**Decisión.** Eco determinista de una cara lisa, sumado en la pasada B de forma coherente y con fase 0
común a la cara al fasor del moteado, antes de la transmisión (envolvente de Rice); C y D no cambian.
Para la muestra dueña de la cara i, con θ el ángulo entre su normal y el rayo (el reflejado tras el
espejo): a = A_i·Λ(θ; s)·χ(θ; σz)·C·g(δ'), con

- A_i = β·10^(K/20)·R_ef·s_ref/s, R_ef = max(|R_Fresnel|, suelo) de la tabla de caras
  (`anatomy/interfaces.ts`: Z de TISSUES; suelos por la capa de colágeno de la pared, de Glisson, de la
  cápsula y de la fascia); K₀ = 55 dB (un plano liso frente al moteado del hígado, 56,5 dB según Madsen,
  Insana y Zagzebski 1984 y Chen, Phillips y Parker 1997, menos 1,5 dB de aberración de la pared;
  `IFACE_K_DB`, calibrable con GPU dentro de [53; 57]) y β = 0,2903 (gemelo, `IFACE_BETA`);
- Λ = sec²θ·exp(−tan²θ/(4s²)): lóbulo de Kirchhoff en amplitud con conservación de energía y
  Λ(0; s_ref) = 1 (s_ref 0,14, la de la VSH); χ = exp(−2(k0·σz·cosθ)²), rugosidad fina de Ament;
- C = [(1 + (2k0σl²κl)²)(1 + (2k0σe²κe)²)]^(−1/4), coherencia de curvatura de un haz gaussiano de dos
  vías sobre la dirección circunferencial del tubo (σl de `lateralSigmaMm`, compartida con D en
  `LATERAL_PSF_GLSL`; σe = elevSigma/√2), con la curvatura local de su sección (`Cls.kc`: 1/r en un tubo
  circular; en la VCI elíptica, apScale/r en las paredes AP y 1/(apScale²·r) en las laterales); solo
  tubos, C = 1 en el resto;
- g, gaussiana de integral unidad de σh 0,14 mm en δ = ifd/(|∇|·cosθ), con alcance ±3,5σh; en las caras
  que solo conoce un lado se desplaza 2,5σh dentro del dueño (mismo rizado y nivel que las de dos lados).
  ifd es el valor de la distancia de la cara, que no siempre es euclídea, y |∇| la norma de su gradiente
  (`faceGradient`): así dδ/dr = 1 a lo largo del rayo y g integra 1 (sin |∇| integraba 1/|∇|: la pared
  AP de la VCI, con |∇| = 1/apScale, perdía 2,2 dB en apnea y 6 dB a apScale 0,5). Muestreada como el
  moteado, tras C el cociente eco/moteado no depende de dr.

Una cara por estructura y sin signo (`Classification.interface` y `interfaceDistance` en TS,
`Cls.iface` y `Cls.ifd` en GLSL, con la cara de la luz en H1.w de la textura de escena): la luz de cada
sistema (VSH, VCI, porta, arteria, conducto biliar, vesícula; la conocen pared y luz), la cápsula
hepática (salvo junto al diafragma, cuya cara es de él, o a ≤ 0,2 mm de la grasa perirrenal, cuya cara
es de ella: Morison), la mitad abdominal del diafragma, la cápsula renal (cápsula y mitad interna de la
grasa) y la cara externa de la grasa perirrenal. Sin cara pared/hígado ni cápsula renal/corteza, ni
cara de tubo dentro de la aurícula derecha (el tramo de la VCI que entra en ella, con su tapa, se
clasifica antes que la aurícula pero no dibuja cara). El gradiente de la cara (`faceGradient`: normal y
norma) es el analítico de la sección elíptica en los tubos (con el afilamiento del radio; `Cls.n` sin
normalizar, gemelo `tubeFaceGradient`) y el numérico de su distancia en la cápsula hepática, el contorno
renal, el diafragma y la vesícula (paso 0,02 mm, gemelo `AnatomyScene.faceGradient`), solo en las
muestras al alcance de su cara: la salida barata descarta ifd > alcance·|∇| en los tubos y ifd >
alcance·1,5 (`IFACE_GRADIENT_MAX`) en el resto. El espejo de A0 se coloca en el cruce exacto con una
bisección de 6 pasos (≤ 0,009 mm, `mirrorCrossing`); A2 lo publica desde la fila que contiene r_m menos
el alcance del eco, la pasada B refleja solo r > r_m y la pleura (σz 0,09 mm, su parte coherente a
−28,7 dB) se dibuja desde ese punto, una vez por línea, con el coseno de la reflexión. La pasada B deja
de declarar la atenuación y las banderas por tejido, que no lee: 125 ranuras de uniforms (antes 165).
**Consecuencias.** En el gemelo B→C→D (K = 55 dB, cociente pico/hígado a 0–20°, antes → después): VSH
1,14 → 1,51 (40, 120 y 150 mm: 1,50, 1,49 y 1,40), VCI 1,16 → 1,62 (circular; la elíptica en apnea da
1,67 en su pared AP y 1,52 en la lateral), porta 1,42 → 1,62/1,45/1,40 en los tres tramos, cápsula
1,17 → 1,78, diafragma 1,29 → 2,16 sin costura (antes en el 66 % de las líneas) y Morison 1,42 → 2,17.
La VSH cae a lo que da el moteado solo fuera de ±20° (12,2 → 3,5 dB), la porta no. Huecos a 0–20°:
0,79 → 0,08 en la VSH y 0 en VCI, cápsula, diafragma y Morison; rosario 0,19–0,21. Sin la curvatura
elevacional del riñón (C = 1 fuera de los tubos) Morison daba 2,23 con s 0,21 en la cápsula renal,
sobre la banda del plan [1,6; 2,2] (el diseño, con la curvatura, 2,08): su pico es la cara grasa/cápsula
renal, 4 dB sobre la de hígado/grasa, así que la palanca del riesgo 4 del plan es su s (0,21 → 0,25) y no
la de la grasa (0,30 → 0,35 no lo mueve). Con GPU (M4, `npm run fidelity -- --sweep`, 24-09-2026) K se queda en 55 dB: la cápsula a 0–20° pasa
de 1,02–1,16 con 70–93 % de huecos a 1,64–1,89 sin huecos (rosario 0,15–0,20), Morison da 1,97 y 2,18
(dentro de [1,6; 2,2], sin huecos) y la VCI a 0–20° 1,54–1,73 en la congestión (huecos ≤ 0,08) y 1,23–1,51
en el sano (huecos 0,15–0,54). La VCI queda bajo el gemelo porque está hondo (125 mm en el flanco) y la
coherencia de curvatura C cae con la profundidad: el pico sobre el moteado, a < 15°, es ~6 dB en la VCI y
8–10 dB en la porta frente a 19 dB en la cápsula y 22–24 dB en la cápsula renal, como predice el modelo;
subir K para la VCI empujaría a Morison fuera de 2,2, así que la palanca que queda es σe (el haz
elevacional) o la retrodifusión de la pared delgada, no K. Las suprahepáticas a 40–60° dan 1,08–1,14 (la
caída con la incidencia). Diafragma: desfase del espejo 0,01 mm y costura ≤ 0,04 en casi todas las
escenas; en la subxifoidea del sano a 40–60° el banco marca 8,59 mm, que es su propio `mirrorFloorMm`
(la emulación en CPU del espejo de la GPU): a incidencia rasante la referencia del banco toma otro cruce
y la GPU sigue al modelo (costura del render 0,017). Coste medido: 4,0–5,5 ms por cuadro.
**Verificación.** `interfaceEcho.test.ts` (tabla, cada factor contra su valor analítico o su integral,
perfil de integral unidad, línea 1D con el moteado del repositorio y el pulso de C, uniforms y GLSL),
`interfaceTwin.test.ts` (lento: β ± 0,3 dB, deriva de β 0,21 dB y rizado 0,35/0,69 dB, tendencia con la
profundidad frente a haces gaussianos coherentes, M1–M9 y `it.fails` con la regla de antes, que no
cumple M1, M4 ni M7), `anatomy.test.ts` (la cara y su distancia en puntos conocidos; ninguna cara de
tubo dentro de la aurícula), `faceGradient.test.ts` (el perfil suma 1 ± 0,1 dB en las paredes AP y
lateral de una VCI elíptica a 0–20° y apScale 0,5–1, y en la de la escena; la regla sin |∇| da
20·log10(apScale); `tubeFaceGradient` es el gradiente de la distancia del tubo y su curvatura la de la
sección; la salida barata no descarta muestras al alcance de su cara), `equivalenceSweep.test.ts` y la
e2e de equivalencia (cara y distancia en el volumen y en la cáscara a 0,01–0,6 mm de cada cara, que
también mira las celdas de un tubo sin cara, ≥ 0,999), `transmission.test.ts` y `fidelityScene.test.ts`
(espejo exacto: suelo del desfase < 0,01 mm; el de antes, ~1 mm), `faceNormals.test.ts` (el gradiente
de la VCI con su gemelo TS, en dirección y norma) y la e2e de normales (p01 ≥ 0,98 en la cápsula, el
riñón entero y la VCI; norma con p95 ≤ 0,01), `shaderLimits.test.ts` (≤ 171
ranuras en la pasada B, `uIface[12]` con el tamaño interpolado de `INTERFACE_COUNT`) y la e2e del banco (pico de las caras de tubo
a < 15° con mediana ≥ 5 dB sobre ≥ 5 muestras, cápsula ≥ 1,40 donde hay ≥ 10 registros, costura ≤ 0,02, desfase del espejo ≤ 0,05 mm, caras sin
saturar). Todas las unitarias nuevas fallan en `main`.

## Iteración 2 — informe de cierre (22-09-2026)

Construido: corrección de lateralidad y campo profundo (21–22); anatomía nueva (hígado en cuña con
fosa vesicular e impresión renal, suprahepáticas con tributarias y tronco común, porta de segundo
orden, vía biliar, riñones con seno/pirámides/grasa perirrenal y vasos renales e interlobares, sin gas);
textura de datos de escena con esferas envolventes; corte ecográfico en Worker; compartimento renal
y patrón venoso intrarrenal emergente; medición renal observada; VExUS C completo. 53 tests.

Verificado en vivo: ventana renal por el flanco (corteza, seno ecogénico, pirámides, hígado como
ventana), puerta PW en la vena interlobar → espectro continuo y «Renal: continuo» en el resultado;
campo profundo a 24 cm sin saturación; avatar con el hígado bajo las costillas derechas; 50 fps con
13,5 ms de GPU por cuadro.

Límites conocidos: riñón izquierdo sin interlobares; vesícula alineada con los ejes; confluencia de
suprahepáticas a 15–19 cm desde el subxifoideo (avatar de tronco grande); calibración perceptual
pendiente.

Siguiente iteración: estadística de speckle contra clips reales; IQ por celda para color; confusores
(gas, ascitis); casos G.2; arritmias; test de equivalencia TS ↔ GLSL sobre `FRAG_TISSUEMAP`.

## Iteración 1 — informe de cierre (21-09-2026)

Construido: cadena causal completa (reloj → fisiología → anatomía → sonda → B/color/PW → espectro y
audio → medición → clasificación), navegador 3D, corte, consola por pestañas, dos casos, 44 tests.
Verificado en vivo: modo B con speckle ligado al tejido, suprahepática en corte intercostal, PW con
patrón S/D/A (S 36 / D 21 / A −6 → normal) y aliasing coherente, color rellenando la vena, 60 fps.

Límites conocidos: sin riñones; color emulado (no IQ por celda); sin lóbulos laterales ni armónicos;
sin movimiento cardíaco transmitido; calibración perceptual pendiente; el hígado sigue siendo dos
elipsoides (sin fosa vesicular ni impresión renal).

Siguiente iteración: riñones + interlobares + componente renal; IQ por celda para color; medición de
estadística de speckle contra clips reales; casos de la matriz G.2; arritmias.
