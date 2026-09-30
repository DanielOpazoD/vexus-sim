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

## 58. Composición espacial: tres miradas intercaladas (0, ±7°) en la rejilla común con la fase de mirada por nodo, promediadas en lineal

**Contexto.** La textura del hígado es la pista número uno de la prueba ciega (decisión 52): en la línea
base con GPU del 23-09 el hígado puro muestra una desviación del gris de 15,1–16,7 frente a 10–16 en los
equipos modernos de las referencias, y la envolvente es la de una sola mirada coherente: SNR 1,87–1,97,
fracción oscura 0,063–0,071 (Rayleigh, 0,068) e índice de grietas 0,055–0,094. Los preajustes abdominales
de los convexos actuales componen 3–9 miradas con actualización continua [LITERATURA: Jespersen,
Wilhjelm y Sillesen 1998, Ultrason Imaging 20:81; Entrekin et al. 2001, Semin Ultrasound CT MR 22:50], y
la media de N miradas decorreladas sube la SNR de la envolvente como √N_eff sin agrandar el grano
(Burckhardt 1978, IEEE Trans Sonics Ultrason 25:1). Los tres diseños y los tres jueces de esta decisión
coincidieron: en este modelo la armónica (THI) mueve la desviación entre −0,1 y +0,4 de gris, así que va
después y aparte (decisión 59).
**Opciones.** (1) Subcuadros dirigidos de verdad remuestreados a la rejilla de la mirada 0: una sola
mirada remuestreada ya da un grano de 1,13–1,59 × la PSF (el remuestreo es un suavizado, §23) y el
aliasing de línea sobredecorrela (N_eff 2,3–2,9 frente a la ley, 1,5–2,2). (2) Promedio logarítmico (en
dB): encoge el grano a 0,80–0,85 × la PSF; los equipos componen la envolvente en lineal. (3) Solo la
persistencia como compuesto (IIR): con 0,35 los pesos de las tres últimas miradas son 0,679/0,238/0,083 y
N_eff no pasa de 1,91 aun con miradas independientes; además ata la textura a un control del usuario.
(4) Desplazamiento virtual por nodo (giro de fase aleatorio de cada nodo con la varianza de la mirada):
reproduce la ley en estadística (N_eff a ±2 % en el foco), pero no es la fase de una dirección, así que
no tiene geometría (ni la penumbra, ni la incidencia de las caras, ni la costura dependen de la mirada);
queda como alternativa documentada si G1 o G5 fallan tras calibrar θ. (5) 384 líneas: quita el aliasing
de línea pero duplica B, C y D sin componer nada. (6) Componer con el color encendido: el cuadro B va a la
cadencia del color (4–11 Hz, decisión 39) y las tres miradas cubrirían 280–715 ms, con estela respiratoria
de varios mm. (7) Apagarlo por debajo de 30 cps medidos: no es determinista. (8) La elegida.
**Decisión.** Tres miradas, una por cuadro B en el orden 0, +θ, −θ (`COMPOUND` de
`ultrasound/compound.ts`: θ = 7° en el elemento, calibrable en 6–8° con el banco de GPU,
`COMPOUND_STEER_RANGE_DEG`; un único θ global, sin ajuste por profundidad), formadas en las muestras de la
mirada 0 con la línea dirigida que pasa por cada una y promediadas en lineal por la pasada K nueva:

- Geometría exacta del convexo (`ultrasound/steering.ts`): la mirada θ sale del elemento φ con dirección
  φ + θ y corta ρ = R + r a la distancia s(ρ) = √(ρ² − a²) − R·cos θ (a = R·sin θ); la inversa es cerrada,
  φ_k = α − θ + β(ρ) con β = asin(a/ρ), y la dirección del haz en el punto es α + β. ψ_k = √(ρ² − a²) +
  a·(α + β) − a·π/2 es un potencial exacto (∇ψ_k = b_k): el desfase de ida y vuelta respecto a la mirada 0,
  Δ_k = k2·(ψ_k − ρ) con k2 = 4π/λ = 28,56 rad/mm, se suma por nodo de la retícula del moteado en forma
  lineal, Δ_k(P) + g⊥·(x_n − P), dentro del cos/sin que ya existe (`speckleFieldPh`; ≤ 1·10⁻² rad frente a
  la fase exacta del nodo). Los valores de los nodos son los de siempre (sal por tejido y ancla, decisiones
  55 y 56): grumos y heterogeneidad son del material y comunes a las tres miradas.
- Transmisión dirigida sin clasificación ni pasada nuevas: A1 marca el gas de cada segmento en `oSeg.w`
  (1 pulmón, 2 otro); A2 suma, para la mirada del cuadro, los segmentos de A1 a lo largo del camino
  dirigido (la línea más cercana al cruce de cada fila, ×ds/dρ exacto, las reglas de hoy: gel previo, hueso
  6 dB al entrar, espejo 0,5 dB) en `o2`/`o3` (`steeredPrefixDb`); al cruzar el espejo de la decisión 57,
  en su cruce exacto, el camino se congela en esa línea y sigue su camino reflejado (el espejo no se dirige
  tras la reflexión). A calcula en `o3` la penumbra sobre los caminos dirigidos vecinos
  (`steeredApertureTransmission`: radio R·cos θ y distancias del camino; con θ = 0, la decisión 54 exacta)
  con el primer gas, el tipo de gas y la línea del espejo empaquetados. `o0`, `o1` y `o2.x` (el rayo único
  del color y del PW) no cambian.
- Pasada B, rama dirigida (`STEERED_FIELD_GLSL`, el main de su programa dirigido; `uSteer` = (θ, R·sin θ,
  R·cos θ, k2), `uLookSalt`, `uTrans3`; no lee A o0): la fase de la mirada, la transmisión del camino y el
  acoplamiento del elemento φ_k, el eco de interfaz y el de la pleura con la incidencia de la mirada
  (dirección α + β: una cara oblicua brilla en unas miradas y no en otras), la reverberación a múltiplos
  del primer gas a lo largo del camino y la cola sucia y el transitorio anclados a (línea dirigida,
  distancia del camino) con una sal por mirada (`lookSalt`, 0 en la mirada 0): cada mirada es otro
  disparo. Tras el espejo, el punto sigue la dirección reflejada de la línea que cruza desde su propio
  cruce, con la fase del potencial directo. Fuera del arreglo la mirada no existe (K la pesa 0), pero B la
  forma hasta el alcance del núcleo lateral de D (±2,5σ): si no, D mezclaría ceros en las muestras con
  peso junto al borde.
- Pasada K (`FRAG_COMPOUND`): en cada celda, la media de las envolventes válidas del anillo ponderada por
  la cobertura de cada mirada (`lookWeight`: 1 la mirada 0; rampa de una línea centrada en el borde del
  arreglo las dirigidas), con `texelFetch` en la misma celda y sin remuestreo. Con una sola mirada válida
  da env·1/1: la envolvente de D bit a bit.
- Anillo (`CompoundRing`): tres destinos R32F (`envLooks`, una historia externa en `passGraph.ts`: D
  escribe la ranura de la mirada del cuadro y K lee las tres y escribe `env`). Se reinicia (todas las
  ranuras inválidas y la siguiente es la mirada 0) con un salto de pose (`JUMP_MM` 15, `JUMP_DEG` 10),
  `setScene`, un cambio de profundidad, foco o líneas y un cambio de modo.
- Regla de actividad (`compoundActive`): compuesto ⇔ conmutador encendido y color apagado; el PW lo
  conserva (no limita la cadencia del modo B). Encendido por defecto; orden `compound` del equipo,
  conmutador «Compuesto» en la pestaña Imagen y «CX» en el HUD mientras se forma.
- La mirada 0 no cambia, ni en la imagen ni en el coste: A2, A y B tienen dos programas de una sola fuente
  (`transPrefixShader`, `transmissionShader`, `rawFieldShader` en `shaders/passes.glsl.ts`, con los huecos
  de la dirigida vacíos en la mirada 0): el de la mirada 0, byte a byte el de `main` antes de la
  composición y sin nada de la dirigida, y el dirigido (`FRAG_TRANS_PREFIX_STEERED`,
  `FRAG_TRANSMISSION_STEERED`, `FRAG_RAWFIELD_STEERED`), el único que declara `uSteer`. El renderizador
  elige uno por cuadro por su θ (`LookPrograms`; θ = 0 con el compuesto apagado o el color encendido),
  enlaza los seis con los demás al crearse (también al reconstruirse tras una pérdida de contexto), sube a cada uno los
  uniforms que declara y las repeticiones de medida (`repeatPass`) repiten el del cuadro. En un cuadro de
  la mirada 0 nadie escribe ni lee A o3 ni A2 o2/o3. K es un paso directo exacto. `readEnvelope({ source })`
  lee la mirada 0 por defecto y lanza si no es la del último cuadro; `compound` es obligatorio en el tipo de
  los ganchos de medida y las guardas de una mirada pasan `compound: false` con sus umbrales de siempre.
- Presupuesto: el programa de la mirada 0 de B conserva sus 105 ranuras de uniforms y sus 4 samplers; el
  dirigido declara 107 (uSteer, uLookSalt) y 4 samplers (uTrans3 en lugar de uTrans0); K, 10 ranuras y 3
  samplers; el dirigido de A, 6 samplers. El chunk principal del bundle pasa de 228,8 a 250,1 kB (el GLSL
  viaja como texto) y su presupuesto, de 240 a 260 kB (`tools/ci/bundle-budget.ts`).
- Arranque: el GLSL que se compila al crear el renderizador (y al reconstruirlo tras perder el contexto)
  pasa de 184,1 kB en 12 programas en `main` eabd2aa (201,0 kB en 13 con la primera versión, un programa
  por pasada) a 244,6 kB en 16, +33 %: B, de 42,8 kB a 42,8 + 46,5 (el dirigido compila otra vez la
  anatomía entera). Se compilan todos al crearse y no al primer cuadro dirigido: con el compuesto encendido
  por defecto ese es el segundo, así que diferirlos solo movería el coste un cuadro (y lo metería en las
  medidas de `frameCostMs`, que calientan con un solo cuadro, y un fallo de enlace pasaría del arranque al
  bucle). Para no pagarlo en serie, `GLProgram.linkAll` encarga los 16 y solo después comprueba cada
  enlace, con `KHR_parallel_shader_compile` pedida antes de compilar (en Chrome es opcional por página y da
  hasta 2 hilos de fondo por contexto): antes se consultaba el estado tras cada shader y cada enlace, 48
  esperas encadenadas; ahora 16, con todo encargado. Un fallo lanza con el nombre del programa y el
  registro y libera todo el lote. Tiempo de arranque sin medir: falta la e2e con SwiftShader (del `goto`
  al primer «fps» y al primer cuadro dirigido) A/B intercalada con `main` bajo la misma carga; los
  registros de e2e locales no sirven para esto porque la misma prueba de arranque, sobre el mismo código,
  ha tardado de 11,5 s a 1,0 min según la carga de la máquina.

**Consecuencias.** Predicción del gemelo B→C→D de tres planos a ±7° en la subxifoidea (8 realizaciones;
no medida en GPU) a 20 / 45 / 90 / 150 mm: ρ(0,±) 0,23 / 0,42 / 0,65 / 0,35 (ley con la σ medida 0,32 /
0,53 / 0,72 / 0,41), N_eff 2,31 / 1,91 / 1,47 / 2,08, SNR 1,99 → 3,10 / 2,01 → 2,81 / 2,02 → 2,45 / 1,99
→ 2,91, grano compuesto/mirada 0 lateral 1,05 / 1,01 / 0,92 / 1,01 y axial 1,00–1,01, fracción oscura
0,06 → 0,003–0,012; por mirada, SNR 1,97–2,01 y media a −1,1/+1,5 % de la mirada 0. La mezcla de
magnitudes de los tres planos de B (no lineal, por muestra y antes de la PSF) decorrela las miradas
0,05–0,11 más que la ley (con un solo plano, a ≤ 0,025) y sube N_eff un 4–12 %: es un artefacto del
modelo, no física del compuesto (una suma coherente en elevación seguiría la ley), y es la causa de que a
20 mm la SNR prevista (3,10) pase del techo de G1 (con el N_eff de la ley sería ≈ 2,95). La T3 del plan
(|ρ − ley| ≤ 0,08) no se cumplía; la prueba exige la ley con un plano y, con tres, fija el artefacto:
ρ − ley en [−0,13; −0,03], ρ al menos 0,03 por debajo del de un plano con las mismas realizaciones y N_eff
entre la ley y +15 %. Calibrar θ con G4 absorbe este exceso, así que el θ calibrado no es una medida física
del equipo (`docs/APPROXIMATIONS.md`). La umbra de una costilla de 12 mm a 18 mm (−40 dB respecto al hígado)
acaba 2,8 mm antes (26,3 → 23,6 mm; ~4,5 mm a ±8°) con el núcleo en el suelo (−22,6 → −22,2 dB), y el
refuerzo tras un vaso de 12 mm se ensancha +14 / +40 / +67 % a 80 / 110 / 150 mm con el pico 0,1–0,3 dB
más bajo. A ±6° N_eff baja a 2,06 / 1,71 / 1,37 / 1,84 y a ±8° sube a 2,55 / 2,10 / 1,57 / 2,31. Las
bandas laterales de dos miradas (la costura: 5–15 líneas por lado según la profundidad) tienen menos SNR
que el centro. Al abrir el color la textura vuelve a la de una mirada (coste asumido, como en varios
equipos; `compound-off-in-color`); el color y el PW no cambian. Coste estimado por los diseños: −0,15 a
+0,20 ms por cuadro de media (la rama dirigida de B en dos de cada tres cuadros, el segundo bucle de A2 y
el segundo cono de A, y K) y +3,9 MB de memoria. Medido (M4 con Metal, A/B intercalado con `main` bajo la
misma carga, media de carga ≈ 22, `frameCostMs(30, { repeatPass, repeatCount: 2 })`, Δ por repetición)
con la primera versión, un solo programa por pasada y la rama dirigida detrás de `if (uSteer.x != 0.0)`:
B costaba 4,5–4,9 ms frente a 2,6–2,9 en `main` **aun con el compuesto apagado** (θ = 0: la rama no se
tomaba nunca) y 4,7–4,9 encendido; el cuadro, 10,5–10,7 ms apagado y 11,3 encendido frente a 8,8–9,3; A2
+0,5 ms encendido (+0,1 apagado), A +0,1–0,2, C y D ≈ 0. El programa entero paga los registros y el
tamaño de la rama que lleva dentro, se tome o no (la de B inlinea otra vez la clasificación, el moteado con
fase y los ecos): opción descartada, +2 ms en cada cuadro de la aplicación. Diseño adoptado: dos
programas por pasada (arriba), con la mirada 0 byte a byte la de `main`; A2 y A se separan igual, aunque su
coste apagado era menor, porque tenían la misma estructura (su bucle o su cono dirigidos compilados en el
programa de la mirada 0). Los programas de la mirada 0 de A2 y A escriben 2 y 3 de los 4 adjuntos de su destino: se dibujan con solo esos activos (`bindTargetFor`). Con los cuatro activos WebGL rechaza el dibujo («Active draw buffers with missing fragment shader outputs») y el destino conserva el cuadro anterior: la e2e lo vio como transmisión a 407 dB de la CPU y espejo a 99 mm, y el WebGL falso de las pruebas rechaza ahora el dibujo igual. Medido con GPU (M4, 25-09-2026, mismas condiciones de carga, intercalado): con el compuesto apagado el cuadro cuesta lo de `main` (7,9–11,0 frente a 8,6–12,0 ms en las mismas rondas), encendido +0,9–1,7 ms. Con θ = 7° el banco da en el hígado puro una desviación del gris de 11,0–12,6 (antes 15,1–16,7; mediana 12,0, dentro de 12–13, así que θ se queda en 7°), SNR 2,37–2,51, oscuros 0,007–0,010, grietas 0 y grano axial 0,72–0,78 mm: la textura cambia sin agrandar el grano. G5–G8 y K7–K12 se informan en el banco (`compound.bands`, `seam`, `umbraShiftMm`); el punto de control A de la prueba ciega queda pendiente. El aliasing de línea del moteado (`speckle-line-aliasing`) queda para el PR 3.
**Verificación.** Gemelos (fallan en `main`): `steering.test.ts` (geometría exacta y θ = 0 identidad),
`speckleField.test.ts` (sin fase, bit a bit el de hoy; fase lineal ≤ 1·10⁻² rad; SNR y media por mirada),
`compoundSpeckle.test.ts` (lento: ley con un plano; con tres, el artefacto de la mezcla fijado y N_eff
entre la ley y +15 %; SNR ×√N_eff ±10 %, grano 0,9–1,1, oscuros ≤ 0,035),
`steeredSample.test.ts` (geometría de la rama dirigida de B: con θ = 0 la de la mirada 0; con ±θ el punto
en el camino, el reflejado tras el espejo, la pleura con |dirK·n|, la reverberación sobre el camino y el
alcance fuera del arreglo; líneas del GLSL fijadas), `steeredParity.test.ts` (margen de los empates de
redondeo de G8), `aperture.test.ts` (θ = 0 igual a la decisión 54; umbra y refuerzo), `transmission.test.ts`
(prefijo dirigido frente a la CPU a ≤ 0,05 dB, espejo congelado) y `compound.test.ts` (orden, reinicios,
pesos, paso directo, regla de actividad). GPU sin GPU: `passGraph.test.ts` (K antes de D, D escribiendo
`env` junto con K y B sin declarar la transmisión que muestrea: las tres se detectan; los samplers de los
dos programas de cada pasada), `shaderLimits.test.ts` (≤ 16 samplers, arrays de K interpolados, ningún
uniform sin declarar; los programas de la mirada 0 sin ningún identificador de la dirigida, sacados del
código, con una prueba de que volver a meter la rama se detecta, y la huella de su main, la de `main`
eabd2aa) y `compoundRenderer.test.ts` (el renderizador real sobre un WebGL falso: cada mirada dibuja A2, A
y B con su programa y solo el dirigido recibe la mirada, cada programa recibe todos los uniforms y samplers
que declara con el programa puesto y cada sampler su textura, `repeatPass` repite el programa del cuadro,
la reconstrucción tras perder el contexto libera y rehace los seis, el arranque y la reconstrucción encargan
todos los programas antes de la primera consulta de estado, con la extensión pedida antes de compilar, y un
fallo de compilación o de enlace lanza con el nombre y libera el lote, D escribe su ranura, K lee las tres con
su validez, los reinicios, las lecturas que se niegan a dar datos de otro cuadro y el protocolo de los
ganchos); `fidelity.test.ts` y `fidelityScene.test.ts`
(ρ_I, costura, umbra e hígado puro de las tres miradas). e2e: «composición espacial» (G1–G4, K1, K5,
grano, G8 y la guarda de `readEnvelope`) con SwiftShader, y las guardas de una mirada con
`compound: false` sin tocar sus umbrales.

## 59. Reservada: imagen armónica (THI) [Estado: superada por 77]

Número reservado para la armónica, que la decisión 58 dejó después y aparte. La armónica entró como decisión 77, con
otro diseño (1,75/3,5 MHz, efectos por uniforms) y sin el punto de control A del plan: ver allí por qué.

## 60. Reservada: hígado sin aristas [Estado: reservada]

Número reservado para la rama pendiente del contorno del hígado sin aristas; la redacta su rama.

## 61. Pleura parietal y cortina pulmonar: línea pleural, serie de reverberaciones de la pared, deslizamiento y borde blando

**Contexto.** El dueño (médico, 25-09-2026): «el signo de la cortina pulmonar sobre el hígado es de las
peores representaciones ecográficas que he visto». Referencias con convexo de 2–5 MHz: Lee FCY, _The
Curtain Sign in Lung Ultrasound_, J Med Ultrasound 2017;25:101–104 (fig. 1B: el pulmón aireado del receso
echa una cortina de aire gris y brumosa sobre el campo cercano del hígado, con un borde blando y oblicuo
de ~1 cm; la línea pleural acaba en el límite inferior del receso; fig. 5B: bajo la pared, la pleura es la
línea continua más brillante y debajo hay una neblina gris con bandas horizontales y líneas A a múltiplos
de la distancia sonda–pleura, que se apagan con la profundidad); PMC10132878 fig. 2A (signo del
murciélago: bajo la pleura todo el campo es neblina gris con 4–6 líneas A anchas y tenues que siguen la
curvatura de la sonda); Häggström (Commons CC0) y N. Dilmen (Commons) para la pared abdominal. El modelo
de antes: la cortina (decisión 43) era una lámina de pulmón de 3 mm bajo la pared y A0 trataba cualquier
primer pulmón como el espejo del diafragma (decisión 57): el camino se reflejaba en la cortina, volvía a
subir por la pared y salía al gel; la pasada B solo sumaba tres gaussianas de 1,2 mm a k·gasHit. Resultado:
sin eco de la pleura parietal, un rectángulo negro con arcos finos perfectos y un borde de un escalón de
una línea.
**Opciones.** (1) Dejar el espejo y pintar una neblina encima (cosmético, §23). (2) Ensanchar las gaussianas
de las líneas A (sigue sin física). (3) La integral completa de la reverberación con todas las
multiplicidades de caminos (coste: una muestra de la pared por orden). (4) Un programa de B aparte para las
líneas con cortina (más compilación y programas: la decisión 58 ya tiene dos por pasada). (5) El borde
blando con la penumbra de la apertura (decisión 54): la cuenta dos veces con la fracción de aire del haz,
que ya incluye su anchura lateral. (6) Una clasificación fraccionaria: rompe las puertas de equivalencia
TS ↔ GLSL. (7) La serie con R_p = |R_Fresnel| ≈ 1, como el plan: la copia espejo de la pared sale tan
brillante como el hígado (gemelo: neblina 0,99 × el hígado; aceptación 0,35–0,9) y la neblina es isótropa
(anisotropía 1,9; aceptación ≥ 2,5). (8) La elegida.
**Decisión.** Modelo físico de la especificación de la tanda (§2), en `ultrasound/pleura.ts` (gemelos TS y
`PLEURA_GLSL`):

- **Cortina frente a diafragma.** `classify` sigue igual y binaria; la variante sin la cortina es
  `classifyWith(m, false)` (GLSL) y `classify(m, caliber, false)` (TS). A0 (`FRAG_TRANS_HITS`) registra en
  una salida nueva, `h2`, la pleura parietal: el primer cruce exacto de la cara interna de la pared
  (`insideWallMm`, bisección de 6 pasos como el espejo), su distancia con signo al borde del pulmón que toca
  la pared en la huella del receso (`lungCurtainEdgeMm`: z − min(borde de la cortina, inserción del
  diafragma), porque por encima de la inserción el pulmón del tórax toca la pared: en el flanco en espiración
  la cúpula llega a la pared ~3 mm por debajo del borde de la cortina) si está a menos de 20 mm por el lado
  del hígado, la pérdida ΔL que el gas de la lámina cuesta de más frente al tejido de detrás y el tipo 3
  empaquetado con el último segmento de la cortina (3 + 4·(último + 1)). Solo cuenta el primer cruce. Si la
  pleura quedó registrada, el pulmón que toca la pared en el receso (`inLungRecess`: la cortina o el tórax a
  < 3 mm de la pared) y el que le sigue pegado (aire con aire: no hay pleura del diafragma entre los dos) no
  son espejo ni impacto de gas; el camino sigue recto. A1 los marca con 3 y los prefijos de A2 (y su gemelo)
  no los toman por un gas. El espejo del diafragma (el pulmón que se alcanza desde el hígado) no cambia, y
  tampoco el pulmón de una línea cuyo cruce de la pared cae fuera de la huella del receso: es el espejo de
  antes (costura de la huella, abajo). _Enmienda de la decisión 62:_ el pulmón del receso solo es la cortina si
  su primer segmento grueso empieza a ≤ un segmento del cruce D (`CURTAIN_CONTIGUOUS_SEGMENTS`, A0 y su gemelo
  `transmissionHitsLine`). Una línea que pasa junto al borde de la cortina registra su pleura con el volumen
  parcial del borde y, 50–90 mm más allá, toca el pulmón del receso posterior: con la regla de arriba ese pulmón
  era cortina (sin espejo y con ΔL 50–82 dB) y la pasada B le quitaba al hígado de en medio 21–33 dB de
  atenuación: una banda clara en la vista intercostal de la primera versión de la 62 al final de la espiración
  (pleura a 47–59 mm con f 0,12–0,35 y el pulmón 53–91 mm más hondo). Ahora es el espejo del diafragma de la
  decisión 57.
- **Línea pleural.** Cara nueva `Interface.PleuraWall` (Fresnel músculo/gas 0,9995; s 0,15 [ESTIMADO
  0,10–0,15]; σz 0,05 mm [ESTIMADO, calibrable 0,04–0,07]; de un lado, la dibuja el músculo). Eco a D con
  el lóbulo de Kirchhoff y la χ de Ament con la incidencia de la línea sobre la pared, y la transmisión de
  la última fila de A que no toca el pulmón (`pleuraCapMm`: interpolar mezclaba hasta 6,75 dB de gas).
- **Serie de la pared.** Cada reflexión especular de la pleura vale R_p·χ, su reflexión coherente (la misma
  χ que da el nivel de la línea pleural; la parte difusa se va en otras direcciones). Con E(d) = f(d)·T(d)
  el eco directo de la pared a la distancia d del camino: copia espejo a 2D − d con E·(R_p·χ)²·(T(D)/T(d))²,
  copia directa a D + d con 2·E·G (el camino recíproco, sonda → d → cara de la sonda → pleura → sonda, tiene
  el mismo retardo y la misma fase y se suma coherente), G = R_p·χ·R_t·T(D), R_t 0,3 [ESTIMADO, calibrable
  0,2–0,5]; cada ida y vuelta más, ×G y +D, y los caminos del mismo retardo se suman: el orden n de la copia
  espejo tiene n + 1 y el de la directa n + 2 (la prueba los enumera por fuerza bruta). Cada muestra bajo la
  pleura remuestrea la pared en el MISMO camino en a lo sumo dos puntos,
  d_M = (n+2)D − s y d_F = s − (n+1)D con n = ⌊s/D⌋ − 1 (clasificación, moteado anclado, grumos y ecos de
  interfaz de la pared: la neblina hereda las capas de la pared), mientras Gⁿ·T(D)·16 pase de la décima del
  ruido del receptor. Las líneas A son las réplicas del eco pleural (la copia directa con d = D):
  G^(k−1)·(eco pleural) a kD; la copia espejo no lleva el eco pleural (sin doble cuenta). Sustituyen a las
  gaussianas para la cortina; la cola sucia del gas intestinal no cambia.
- **Deslizamiento.** Campo incoherente anclado a las coordenadas materiales del pulmón (la z del cruce más
  el descenso de la cortina), con grano de 3 mm a lo largo de la pleura y 0,5 mm en profundidad [ESTIMADO],
  caída e^(−h/15 mm) [ESTIMADO 10–20] y nivel mostrado −8 dB del hígado junto a la pleura [ESTIMADO −8 a
  −12; el tope del rango: con −9 la anisotropía de la neblina quedaba en 2,50, en el límite de la aceptación].
  Como su grano es más largo que la PSF, C y D le dan 8,9 dB más de ganancia coherente que al moteado del
  hígado [MEDIDO, gemelo]: el campo va a −17 dB (`SLIDING_PSF_GAIN_DB` 9). En las miradas dirigidas lleva la
  sal de la mirada.
- **Borde blando.** f = Φ(dz/σ), σ² = (σe·|e_z|)² + (σl·|l_z|)² + σ_taper², con σe y σl el haz de dos vías a
  la profundidad de la pleura y σ_taper 4 mm [ESTIMADO 3–5]; Φ de Abramowitz y Stegun 7.1.26. Bajo la pleura
  la muestra es f·(pulmón) + (1 − f)·(el tejido de detrás, `classifyWith(m, false)`, con la transmisión
  min(min(T, T₁)·10^(ΔL/20), T(D)), T la de la apertura y T₁ la del rayo único de la línea, A o2: el cono de
  la apertura mezcla líneas vecinas con otra ΔL y la compensación de la línea sola, sin el tope, devolvía más
  de lo que su lámina quitó). Las líneas con f < 10⁻³ son las de siempre.
- **Coste y estructura.** Cada programa inlinea `classify` las mismas veces que antes (A0 2, A1 1, B 3; una
  sola implementación, `classifyWith`, y `classify` es su envoltorio). La muestra de la imagen (`mediumField`,
  `mediumFieldPh`: clasificación, tres planos, grumos y eco de interfaz) va una vez y fuera de bucles, como
  antes; las dos de la pared que copia la serie, en un bucle barato (`wallField`, `wallFieldPh`) que clasifica
  con el prefijo de la pared de `classify` (`classifyWall`: fuera del torso, piel, grasa, costillas y músculo;
  la muestra está antes de la pleura, así que es lo mismo que da `classify`, y la pared no tiene caras de
  interfaz; si pasa de la cara interna —en una mirada dirigida, ≤ 0,3 mm al final de la copia, bajo la réplica
  de la pleura— es músculo). A0 clasifica una vez por vuelta: tras una muestra de la lámina, la vuelta
  siguiente clasifica la misma muestra sin la cortina (ΔL); en el pulmón del tórax pegado a la lámina lo de
  detrás es el mismo pulmón y no hace falta. Motivo: con SwiftShader (la e2e y el CI) el JIT de B tardaba
  128 s en lugar de 6 (faceGradient, ~67 kB inlineados, dentro de un bucle) y el vigilante de la GPU de Chrome
  perdía el contexto al arrancar; `shaderLimits.test.ts` fija las copias de `classify` por programa y que
  faceGradient no quede dentro de un bucle. B lee `h2` (uHits2) y el rayo único de A (uTrans2: .x la mirada 0, .y la
  dirigida, que el programa dirigido de A escribe ahora en o2.y): dos samplers más, 6 en los dos programas. La
  tabla de caras crece una fila: 106 ranuras de uniforms en la mirada 0 y 108 en la dirigida (antes 105 y
  107).
- **Sin composición bajo la cortina.** Cada mirada dirigida reverbera a múltiplos de su propio camino y K
  promediaba tres arcos por línea A (capturas con GPU: desde la de orden 3, tres arcos paralelos); los
  preajustes de pulmón de los equipos no componen. K da a las dirigidas el peso `curtainSteerWeight`: 1 − fAir
  de la mirada 0 bajo su pleura (r > D, fAir ≥ 10⁻³), 1 fuera; en la cortina entera la imagen es la de la
  mirada 0 y el borde blando no deja costura. K lee la pleura de A0 (uHits2) y calcula fAir con la misma
  función que B (`CURTAIN_AIR_GLSL`); gemelo: `compoundEnvelope(…, curtain)`. Con SwiftShader, en la
  intercostal en apnea inspiratoria con el compuesto, la línea A de orden 2 pasa de +25,5 a +28,9 dB sobre el
  hígado y la de orden 3 de +2,5 a +8,7 dB: las de la mirada 0 (`compound-off-under-curtain`).
- **Miradas dirigidas.** El mismo modelo a lo largo del camino dirigido: su cruce sD es el de la línea que el
  camino corta a la profundidad de la pleura (punto fijo de tres pasos sobre `h2`), la serie remuestrea la
  pared en el propio camino con la fase de la mirada y la transmisión se lee en la celda de cada punto (A o3).
  Gemelo de la geometría: `steeredSample`.

Otras aproximaciones declaradas: la serie remuestrea la pared en la misma línea, no en la dirección
reflejada (las copias no cambian con la incidencia salvo por χ; las líneas A llevan el lóbulo una vez, el
del eco pleural, y no una vez por rebote), sin colas de cometa; el tejido de detrás se muestrea en el rayo
central, no en la parte del haz que cae bajo el borde; la lámina no es obstáculo de la penumbra de la
apertura. Costura de la huella: la línea que cruza la pared justo fuera de la huella del receso (y > 40 mm o
x > −45 mm) y alcanza luego el pulmón de la cortina bajo la pared lo trata como el espejo de la decisión 57
(en CPU, 5–7 líneas en la intercostal y 24–36 en la subxifoidea, que miran de refilón el borde de la huella);
quitar la huella del receso de `lungCurtainEdgeMm` lo arreglaría a costa de cambiar esas ventanas, y queda
para el dueño. El color y el PW siguen cruzando la lámina recta con 60 dB/cm (18 dB), como la CPU.

**Consecuencias.** Gemelo B → C → D → G (pared plana del adulto de referencia, `pleuraTwin.test.ts`): la
línea pleural satura 1,24–1,30 mm a 0–15° (pico +49,6 dB sobre el hígado a 0°, +43,0 a 15°, +38,0 a 20°) y
no satura a 30° (+20,9 dB); neblina en [D + 2, 2D − 2] a 68 de gris (0,68 × el hígado; antes, negro) y 38 en
el intervalo siguiente; la línea A de orden 2 a +28,0 dB sobre el hígado y +43,8 dB sobre la neblina vecina,
la de orden 3 a +8,2 dB; anisotropía de la neblina 1,97 / 0,77 mm = 2,57 (parches del banco; 2,12 sin el
deslizamiento); borde 10–90 % de 10,5 mm (el σ analítico con el haz de la intercostal, 4,05 mm: 10,4 mm);
deslizamiento mostrado a −7,5 dB del hígado junto a la pleura; la banda de 2–6 mm bajo la pleura
correlaciona 0,96 / 0,86 / 0,61 / 0,32 con 0,5 / 1 / 2 / 5 mm de descenso del pulmón y la pared de encima
1,000; sin el deslizamiento la neblina quedaría a 58 de gris (−13 dB en los 8 mm bajo la pleura; con él,
−7,3). El borde baja 10 mm con la respiración tranquila y 30 mm con la profunda. El hígado «puro» del banco y
de la guarda de Rayleigh deja fuera lo que hay bajo la pleura donde f ≥ 0,01 (−0,09 dB; la réplica de orden 2
≤ −12 dB): antes la guarda medía también el «hígado» de detrás de la cortina, que la imagen no mostraba; en
la intercostal en espiración quedan 105 parches de 16 × 8 en lugar de 276 (CPU; la guarda e2e pide > 50). La e2e del fundido del ancla (decisión 55, intercostal en espiración, 1°/cuadro) perdió así el
~43 % de su «hígado» (3126 de 7205 muestras) que era el espejo de la cortina, en parte ajeno al fundido (banda de líneas 112–127:
correlación 0,85 con el cuadro anterior en el enlace de dos fundidos, igual que sin fundido); en las bandas de
hígado de verdad la imagen es la de main (la misma correlación, banda a banda y cuadro a cuadro). En hígado
puro el enlace de dos fundidos seguidos cuesta lo que dice la teoría, ρ = 8/9 y una correlación de la
envolvente ×0,77 (Monte Carlo; medido ×0,78), y la base del giro baja de 0,89 a 0,80 a lo largo del barrido:
la prueba comparaba con 0,75 × la base de los primeros cuadros (0,619 < 0,667). Ahora deduce de los pesos lo
que cuesta cada fundido (ρ², fijado frente a las anclas en `speckleField.test.ts`), compara cada cuadro con su
entorno (±3) y exige además que el ancla no cambie más de 1/9 del medio por cuadro: 0,96–0,97 del entorno en
los dos arranques de fundido (umbral 0,85). El GLSL que viaja como texto en el chunk
principal crece ~15,4 kB (esbuild minificado frente a la base, sin el chunk de las pruebas): presupuesto de 260 a 270 kB, y a 280 kB tras el arreglo del JIT de SwiftShader y la cortina en K (269,9 kB con `vite build` sobre main a9520b8). Pendiente, con GPU: las
métricas del bloque `pleura` del banco (`docs/fidelity/README.md`), el coste (`msPerFrame` ≤ +0,5 ms, y
`msPerFrameInspiration` con la cortina tapando el sector), la calibración de R_t, σz y del nivel del
deslizamiento dentro de sus rangos y la comparación visual con las referencias; el juicio es del dueño.
**Verificación.** Pruebas que fallan en la base: `pleura.test.ts` (la cara de la tabla y su fila de uIface;
las amplitudes de la serie frente a la enumeración de los caminos acústicos; las réplicas de la línea
pleural; sin doble eco pleural; la truncación; la χ de cada rebote; Φ frente a la tabla y σ del borde en las
ventanas de partida; la clasificación sin la cortina igual a `classify` salvo en la lámina, donde da lo de
detrás; el deslizamiento anclado —la misma fase, la misma neblina; otra fase, otra; el pulmón que baja con
ella la conserva— y alargado; A0 frente a la decisión 57 en la intercostal, el flanco y la subxifoidea
basculadas: tipo 3 en el cruce exacto a ≤ 0,01 mm, sin espejo en la cortina, ΔL segmento a segmento, el
espejo del diafragma idéntico donde la línea no cruza la cortina; las marcas de A1 y los gemelos de A2; el
banco: líneas de la cortina, hígado puro, ajuste del borde y deslizamiento), `steeredSample.test.ts` (con
θ = 0 la cortina es la de la mirada 0; con ±θ el cruce del camino dirigido a ≤ 0,3 mm de la pleura, la serie
en el propio camino y la transmisión en la celda de cada punto; las líneas del GLSL) y `pleuraTwin.test.ts`
(lento, las métricas de arriba). `shaderLimits.test.ts`: cambio deliberado de la huella del main de B en la
mirada 0 (fuera de las líneas con pleura hace las mismas cuentas; huella nueva `e5fca934a2dddf02`), seis
samplers en B; la huella de A en la mirada 0 no cambia (el rayo único de la dirigida va en su programa).
`passGraph.test.ts`: B y A1 leen `transHits`, B también el rayo único de `trans`. Una revisión adversarial de
contexto limpio encontró, y quedaron corregidos con prueba: la raya de la costura de la huella (un segundo
cruce de la pared dentro de la huella registraba una pleura sin espejo en líneas que el modelo de antes
reflejaba), la sobrecompensación de ΔL por el cono de la apertura y las multiplicidades de la serie. e2e
(SwiftShader): en la intercostal en apnea inspiratoria, línea pleural ≥ 230,
neblina ≥ 20 de gris y > 0,2 × el hígado, más oscura en el intervalo siguiente, línea A de orden 2 > 3 dB.

## 62. Pared torácica y abdominal realista: capas con caras, textura anclada de la grasa y el músculo, cortical costal y pericondrio

**Contexto.** El dueño (25-09-2026): «la fidelidad debe empezar desde la pared torácica/abdominal». En las
referencias (convexo de 3,5 MHz: Häggström, hígado normal, Wikimedia Commons CC0; N. Dilmen, VCI, Commons)
la pared es una pila de líneas finas brillantes que siguen la curvatura de la sonda (piel, septos, fascias,
peritoneo) con huecos hipoecoicos en los primeros 1,5–3 cm, y el hígado empieza bajo una línea brillante
(peritoneo y cápsula). La anatomía ecográfica de la pared (revisión pictórica del Journal of Ultrasound 2020,
PMC7441131; Egyptian J Radiol Nucl Med 2019): piel ecogénica de 1–2 mm; grasa subcutánea en lóbulos
hipoecoicos separados por septos ecogénicos, con la fascia de Scarpa como línea dentro de la grasa; músculo
hipoecoico con septos de perimisio; vainas fasciales brillantes; fascia transversalis, grasa preperitoneal y
peritoneo parietal. Las costillas dan una cortical convexa muy brillante con sombra limpia (PMC10132878,
fig. 2A). En `main` (57/58) la pared eran tres bandas uniformes de moteado (grasa 0,55 con grumos, músculo
0,5), sin ninguna cara, las costillas sin eco de cortical y el cartílago a 0,6. Con el gemelo de la imagen
(A → B → C → D de la mirada 0 sobre la anatomía real, incidencia normal en la línea central): ninguna línea
dentro de la pared (la piel con el transitorio y la cápsula bajo la pared, fuera del tramo interior), la
grasa a −4/−6 dB del hígado (gris 80–86 con el hígado a 100) y la cortical costal a −3 dB del hígado.
**Opciones.** (1) Un tejido por capa sin caras: bandas de moteado de otro nivel; una banda de 0,3 mm se
diluye en la PSF y no da una línea fina, y cada tejido nuevo toca todas las tablas. (2) Eco coherente de
lámina lisa para todo, también septos y perimisio: líneas perfectas y continuas, cuando septos y perimisio
son láminas fibrosas irregulares que se ven como estrías granulosas. (3) La textura una vez por píxel, del
plano central, como los grumos (decisión 56): más barata, pero cambia el main de la mirada 0 (su huella) y
pierde el volumen parcial elevacional, que es física (la rodaja de 5–7 mm del campo cercano promedia láminas
de al lado). (4) La elegida: las capas y la cortical con la maquinaria de caras de la decisión 57 (cada
muestra dibuja su cara más cercana) y los septos y el perimisio como textura anclada de la amplitud en la
pasada B, evaluada en cada plano de elevación.
**Decisión.** Módulo de órgano `anatomy/organs/wall.ts` (TS y GLSL con los mismos nombres) y
`ultrasound/wallTexture.ts` (pasada B), con el gemelo de la imagen `validation/support/wallTwin.ts`:

- Coordenadas de la pared, todas del marco material (la pared no respira: lo que se construye con ellas está
  anclado): d, la profundidad bajo la piel (−`torsoDepth`, la métrica radial de las capas); u, la longitud de
  arco de la piel desde la línea media anterior (`wallArc`: serie hasta ε³, |du/ds| = 1 a ±0,5 %; su corte
  cae en la línea media posterior); y z. Toda onda en u es un armónico del perímetro (`wallWavenumber`):
  periódica en la vuelta. Con una longitud de onda cualquiera la profundidad de las capas saltaba en la línea
  media posterior y la diferencia central del gradiente de la GPU daba un eco espurio (lo halló la prueba de
  la salida barata).
- Capas: piel 2 mm; grasa subcutánea del hábito con la fascia de Scarpa al 40 % de su profundidad (±0,8 mm);
  músculo = el del hábito menos la grasa preperitoneal, con la fascia profunda ondulada (±1,2 mm); y la grasa
  preperitoneal (`Tissue.Fat`, 15 % de la subcutánea entre 1,5 y 4 mm: 2,1 en el sano) entre la
  transversalis (±0,25·(espesor − 1) mm) y el peritoneo parietal. La piel y el peritoneo no ondulan: el
  espesor total de la pared, y con él el hígado, la cortina y los vasos, no cambian. En la pared lateral, dos
  planos intermusculares (oblicuo externo/interno e interno/transverso) al 35 % del músculo desde la fascia y
  al 30 % desde la transversalis (±0,8 mm); hacia el recto (|u| de 50 a 80 mm, la línea semilunar) se acercan
  a sus vainas y a menos de 1 mm se funden con ellas [ESTIMADO].
- Caras (tabla de la decisión 57, `INTERFACES` 12 → 21): dermis/grasa (Fresnel 0,146, s 0,35), Scarpa
  (colágeno en grasa, suelo 0,07), fascia profunda (Fresnel grasa/músculo 0,138), los dos planos
  intermusculares (suelo 0,08), transversalis (0,138) y peritoneo parietal (grasa/hígado 0,132), con s 0,3
  y rugosidad efectiva σz 0,075 mm (una fascia ondulada a la escala del haz, con el volumen parcial de la
  rodaja): en la imagen sus líneas quedan a +6–14 dB sobre el hígado a incidencia normal, gris-blancas, sin
  saturar y bajo la pleura y la cortical, que son lo más brillante, como en las referencias [ESTIMADO]. Con
  σz 0,05 (la primera versión) quedaban a +15–29 dB y en la captura con GPU del flanco eran cinco líneas
  blancas, uniformes y saturadas, tan brillantes como la pleura y la cortical; con 0,10, al nivel del
  hígado; lisas (σz 0,03, s 0,2), a +30–40 dB y su falda axial llenaba el músculo, de 10 mm con cuatro caras.
  El peritoneo, σz 0,08 y s 0,4 (su cara la hacen irregular los lóbulos de la grasa preperitoneal): donde el
  hígado toca la pared su eco (0,35 mm por encima del cruce) y el de la cápsula (0,35 mm por debajo) se
  funden en una línea de ~1,3 mm, la misma que en las referencias y que la cápsula de la decisión 57 calibró
  en 1,3–2,1 × el hígado a 0–20°: 1,82–1,83 en el gemelo (con σz 0,04 y s 0,3, 2,24–2,40; con 0,06 y 0,4,
  1,88–1,97; la cápsula sola, 1,48–1,79). Cada muestra de piel, grasa, músculo o grasa
  preperitoneal dibuja la cara de su capa más cercana (a igualdad, la de fuera; `wallFace`): dos lados salvo
  el peritoneo, que solo lo conoce la grasa preperitoneal. La distancia de cada cara (`wallFaceSd`) es la de
  su capa, continua (los planos sin el corte de su fusión); su gradiente en la GPU es la diferencia central
  de siempre (`faceGradient`). La reflectividad de cada cara varía a lo largo de ella, exp(a·(n − 0,5)) con
  un ruido de valor anclado de 4 mm (a = 4, 5, 4, 4, 4, 3,5, 3 de la piel al peritoneo, ±4–6 dB: la rugosidad
  a la escala del haz, el volumen parcial y la oblicuidad, anclados; Scarpa a tramos casi desaparece;
  `wallFaceGain`). Con 6 mm y a = 1,5–3 (la primera versión) las líneas se veían trazadas con regla.
- Costillas: la cortical (Fresnel músculo/hueso 0,59, s 0,15, σz 0,045: su parte coherente queda bajo la de
  la pleura parietal de la decisión 61, la cara más brillante de la tabla) la dibuja el tejido blando de la pared
  a menos de 1,3 mm de una costilla ósea (≥ el perfil de una cara de un lado por la cota de su gradiente),
  con prioridad sobre las capas; el hueso no dibuja nada (su interior se atenúa). De la cortical solo da eco la
  cara que mira a la sonda (`faceLitFromProbe`: n·dir ≤ 0 con la normal exterior, en la mirada 0 y en las
  dirigidas; TS y GLSL): la cara posterior está a la sombra del hueso, pero la transmisión con apertura (la
  penumbra de la decisión 54) y los caminos dirigidos (58) la iluminaban a medias en los bordes de la costilla, y
  el eco, con |cosθ|, la dibujaba como a la anterior: en la captura con GPU del flanco cada costilla era un
  anillo entero (en el flanco, sin la regla, el eco de la cara posterior queda a < 3 dB del de la anterior; con
  ella, nada). El pericondrio (suelo 0,025, σz 0,06 y s 0,3, como las fascias) lo dibuja el cartílago, también
  en su cara profunda (el cartílago transmite). Con el suelo 0,06, σz 0,03 y s 0,2 (la primera versión) los
  cortes de los cartílagos del reborde eran en la subxifoidea una cadena de rizos blancos (captura con GPU): en
  el gemelo de la subxifoidea su pico sobre el hígado, en la mediana de sus 75 líneas, baja de +20,9 dB (p90
  +24,7) a +3,5 (p90 +6,2). Las dos llevan la coherencia de curvatura de la
  decisión 57 con la curvatura de la sección elíptica de la costilla (`ribCurvature`: a·b/(a²sin²t +
  b²cos²t)^{3/2}, 0,089/mm en la cresta que mira a la piel) sobre su eje (`ribTangent`), como un tubo.
  Retrodispersión del cartílago 0,6 → 0,15 (hialino homogéneo). `classify` busca las costillas antes que la
  grasa subcutánea, desde `ribSearchDepth` (la profundidad mínima a la que una puede llegar, conservadora):
  con la fascia profunda ondulada, la cresta de las costillas del arco anterior asomaba en la grasa y quedaba
  cortada por ella. Las coordenadas de la pared (`wallArc`, `wallDepths`) solo se calculan dentro de ella,
  no en cada punto del tronco.
- Extensión del cartílago costal: en `sdRib` era cartílago todo el arco con φ > `cartilageFromPhi` (1,05 rad),
  una regla escrita para el lado izquierdo (φ < π/2): en las costillas derechas, φ ∈ (π/2, π], todo el arco
  anterolateral y posterior era cartílago, y la ventana intercostal no tenía cortical ni sombra. Anatomía: el
  cartílago es el segmento anterior, de la unión costocondral (en la línea medioclavicular) al esternón (5.ª–7.ª)
  o al reborde costal (8.ª–10.ª); lateral a ella la costilla es hueso, con la cortical convexa brillante y la
  sombra limpia de las ventanas intercostales (el signo del murciélago de la ecografía pulmonar, PMC10132878).
  Regla nueva, simétrica: cartílago a menos de π/2 − `cartilageFromPhi` = 45° de la línea media anterior (la
  unión a x ≈ 96 mm en la elipse de la costilla, 136 × 89 mm: la línea medioclavicular; TS y GLSL). Y las 8.ª–
  10.ª acaban en el reborde costal (`ribAnteriorEndX`: x ≤ 15 + 1,53·z anterior; la 8.ª a −23 mm y la 9.ª a −62,
  mediales a la línea medioclavicular, la 10.ª a −100, en ella): antes todas cruzaban la línea media, y la
  ventana subxifoidea pasaba por los cartílagos de la 8.ª y la 9.ª. Los últimos 25 mm antes del extremo, en la
  mitad anterior, son cartílago aunque caigan fuera de los ±45° (`cartilageTailMm`): la 10.ª, cuyo extremo
  queda en la línea medioclavicular, conserva así su cartílago corto, unido al de la 9.ª en el reborde (sin la
  cola era hueso hasta su extremo). Con las costillas enteras (arriba) esos cartílagos atenuaban las miradas dirigidas de la
  subxifoidea y la composición (decisión 58) se quedaba sin hígado limpio que medir (1 parche frente a 6).
- Vista intercostal de partida: con las costillas óseas, la de antes (φ 0,88π, z 8, yaw 0,35, casi
  craneocaudal) cruzaba seis costillas con seis sombras, y a lo largo del 7.º espacio (φ 0,94π, z 19) la
  cortina pulmonar de la decisión 61 tapaba en espiración medio sector con las suprahepáticas (la captura PW
  de la e2e las perdía). Nueva pose, buscada en una rejilla de φ, z, yaw y basculación con criterios de
  función: el 8.º espacio (entre la 8.ª y la 9.ª costillas) en la línea axilar media, a lo largo del espacio y
  sin basculación (φ π, z 0, yaw −1,15). Ninguna costilla en todo el sector hasta 180 mm (quedan a ~14 mm a
  cada lado del plano; girar la sonda 2° mete la 9.ª en un borde), la huella apoyada entera (4 de 61 líneas
  sin acoplar, las de los bordes), la vértebra al fondo (14–16 cm) y 42 de 61 líneas con ≥ 30 mm de hígado
  antes de pulmón o hueso. La primera versión de esta pose (φ 0,98π, z 3, yaw −1,25, basculada 11°) tenía 14
  líneas sin acoplar, una costilla en cada borde (a 36–52 y a 71 mm) y 37 líneas de hígado. La puerta del
  operador (`bestGateOnVessel` con el peso de ventana) cae en una suprahepática con 43° y peso 0,058 a 89 mm
  en apnea espiratoria y con 35° y 0,038 a 101 mm en el máximo descenso de la respiración tranquila; la de la
  pose casi craneocaudal quedaba a 63–80 mm con 57–68° (el peso incluye la atenuación de ida y vuelta: una
  puerta más honda pesa menos aunque no tenga sombra, 0,09–0,16 allí). 161 parches de Rayleigh con la
  respiración tranquila; la cortina entra por el lado craneal (4 de 61 líneas en espiración, 13 en el máximo de
  la respiración tranquila y 39 en inspiración profunda: 84 líneas de cortina entera y 27 casi normales a la
  pleura de 192). Morison (hígado → grasa perirrenal → cápsula renal), que daba la vista intercostal de
  antes, sale del flanco inclinado 20° hacia atrás (en la pose de antes, las líneas del banco sin GPU acaban en
  la cortical de sus seis costillas); las suprahepáticas oblicuas del banco sin GPU se miden en la pose de
  antes, fija como las del contorno (`CAPTURE_POSES`).
- Textura (`wallTexture`, un factor de la amplitud de `fieldFor` y `fieldForPh` en la grasa y el músculo): la
  grasa subcutánea en lóbulos (columnas de Voronoi de 7 mm en (u, z) con estratos de 3,5 mm de hondo, con
  desfase e inclinación ≤ 14° por columna), septos de σ 0,15 mm con retrodispersión 1,6 sobre el interior
  del lóbulo (0,08); el músculo (0,35) con estrías de perimisio cada 2,2 mm (±15 %), casi paralelas a la piel
  con una ondulación peniforme de ±10–15° y en tramos de 10–30 mm (máscara de ruido por estría), σ 0,15 mm y
  retrodispersión 3,0 [ESTIMADO]. Cada lámina brilla 0,2 + 0,8·|cosθ|⁴ con su incidencia. Dirección del haz:
  en la mirada 0, la radial desde el centro de curvatura (exacta en la pared, que no respira); en las
  dirigidas, b_0 + g/k2 con g = k2·(b_k − b_0) el gradiente de la fase de la mirada (decisión 58). Se evalúa
  en cada plano de elevación: la mezcla de los tres la promedia en elevación como al moteado.
- La grasa baja de 0,55 a 0,08: la del interior del lóbulo. Con 0,25 (la del diseño) el interior mostrado
  quedaba a 0,62–0,70 del gris del hígado: los septos de los planos laterales de elevación y la falda axial de
  los del plano central le suman 2–4 dB; con 0,15, a 0,60–0,62 una vez medido lejos de las caras. El músculo
  baja de 0,5 a 0,35.
- Métricas de las capas (banco y gemelo): solo en las líneas a < 15° de la normal a la piel
  (`WALL_LAYER_DEG`) y solo las muestras a ≥ 1 mm de toda cara de la pared (`WALL_INTERIOR_MM`; con la PSF
  axial, un eco de +20 dB cae allí 20 dB bajo el músculo), también los septos y las estrías. Antes los septos y
  las estrías se tomaban a cualquier distancia de las fascias y la falda de sus ecos contaba como textura: sin
  textura alguna, el gemelo daba 2,1–2,8 dB de «septos» y 0,3–4,7 dB de «estrías»; ahora −0,4/+0,5 dB.
- Banco de interfaces (decisión 57): la cápsula bajo la pared tiene siempre encima la grasa preperitoneal y
  el peritoneo, dentro de la ventana de su pico, así que su puerta medía el peritoneo (quitar la cara de la
  cápsula no la movía: 2,40 → 2,39). Los registros con la cara interna de la pared en esa ventana (ensanchada
  por el alcance del eco de un lado, `PERITONEUM_REACH_MM`) pasan a `peritoneum`: la línea de los dos, con la
  ventana desde el cruce exacto con el peritoneo menos ese alcance (no 1,5 mm sobre el borde, donde está la
  transversalis; sin la línea si la transversalis queda a < 0,7 mm de ella). La puerta de la GPU «cápsula
  0–20°» pasa a esa línea (`GATED_FACE_BINS`, e2e ≥ 1,4 y ≤ 2,4); `capsule` queda para la cápsula sin la
  pared encima (bajo la pared, vacía).
- Centro de la luz del banco (`display.lumen`): la sangre de VCI, suprahepáticas y porta (sin la aorta ni los
  vasos renales) a ≥ 1,5 mm de su pared en el plano y, en 3D, a ≥ 1,5 mm más la σ elevacional del haz: toda la
  rodaja es sangre. Con la vista intercostal nueva la luz del plano daba una mediana de 45–52 (gemelo y
  SwiftShader): sus suprahepáticas, finas y oblicuas al plano, están a 1,2–1,9 mm de su pared en 3D y el grosor de
  corte mete la pared y el hígado en su «luz» (física, no un defecto del eco), y la VCI queda contra la vértebra.
  Ahora esa vista no tiene luz que medir; la subxifoidea y el flanco, con la VCI en eje largo, siguen a 1 (gemelo).
  Las guardas del moteado con giro (`speckleMotion`, `speckleCrossfade`) dejan fuera de su máscara la penumbra de
  la apertura (como el banco) y el fundido suma el nivel paso a paso en las muestras comunes a dos cuadros: girar
  16° desde la vista nueva mete la 9.ª costilla, y la media de una máscara que cambia de profundidad (la envolvente
  no lleva la compensación de la atenuación) movía el nivel 4 dB sin que nada cambiara de brillo.
- Con la decisión 61: las capas, las costillas y sus caras viven en `classifyWall`, el prefijo de la pared de
  `classify` (TS y GLSL) que la serie de reverberaciones de la pleura usa para copiar la pared bajo ella
  (`wallField`, `wallFieldPh`): las copias heredan la textura (en `fieldFor`) y llevan las caras de sus capas.
  El eco de interfaz completo no puede ir en ese bucle (`faceGradient`, ~67 kB inlineados: con SwiftShader el
  JIT de B tardaba 128 s y perdía el contexto; `shaderLimits.test.ts` lo vigila), así que las copias usan un eco
  de cara plana (`wallFaceEchoFlat`, TS y GLSL): las capas son casi paralelas a la piel y su normal y la norma
  de su gradiente son las de la profundidad radial (`torsoDepthGradient`, analítico), sin su ondulación (±0,25
  dB de la energía del eco completo por cara), sin la cortical ni el pericondrio. Pasada la cara interna la copia
  es la capa más honda (grasa preperitoneal, sin cara). La imagen coherente de una cara especular se degrada en el
  camino de la reverberación (cuatro pasos más por la pared, con su aberración, y la pleura, que no es plana a
  la escala del haz), lo que χ, la rugosidad fina, no recoge: el eco de las caras en las copias va por
  `WALL_COPY_FACE_GAIN` 0,35 [ESTIMADO 0,25–0,5]. Con 1, la imagen bajo la pleura era un peine de arcos
  brillantes (captura con SwiftShader, intercostal en inspiración) y el deslizamiento se perdía entre ellos (la
  banda de 2–6 mm bajo la pleura correlacionaba 0,99 al bajar el pulmón 2 mm con las caras de la primera versión,
  0,89 con las de ahora); con 0,35, bandas tenues (+2–4 dB sobre la neblina de entre ellas, Lee 2017 fig. 5B) y
  0,70, y en todo el rango 0,66–0,75 (aceptación < 0,8; `pleuraTwin.test.ts`). Con las caras de la primera
  versión (σz 0,05) la ganancia era 0,15 [0,1–0,3] y el tope de ese rango ya pasaba de 0,8 (0,89 con 0,3).
  Enmienda de la decisión 61 en A0 (y su gemelo): el pulmón del receso solo es la cortina si su primer segmento
  grueso empieza a ≤ un segmento del cruce D (`CURTAIN_CONTIGUOUS_SEGMENTS`; ver la 61): las líneas que rozaban
  el borde de la cortina en la vista intercostal de la primera versión tomaban por cortina el pulmón del receso
  posterior, 53–91 mm más hondo. Las caras nuevas van tras la pleura parietal
  (`PleuraWall` = 12): 13–21; la variación a lo largo de cada cara se siembra con su índice entre las de la
  pared, no con su número.
- La mirada 0 cambia su main solo en la llamada a la pared de la serie (`wallField` recibe la dirección de la
  línea, para el eco de cara plana; huella nueva en `shaderLimits.test.ts`); cambian además `classifyWall`,
  `faceGradient`, `fieldFor`, `interfaceEcho` y, en el programa dirigido, `fieldForPh` y `wallFieldPh`. La
  textura y `SPECKLE_TISSUE_GLSL` van antes del eco de interfaz (que usa `wallFaceGain`) en los dos programas
  de B. uWall pasa a vec4 (la grasa preperitoneal en .w): sin ranuras nuevas en la escena; `uIface` 13 → 22: la
  pasada B 106 → 115 ranuras (108 → 117 el programa dirigido); K no cambia (17).
- La equivalencia volumétrica solo exige la misma cara donde la de la CPU no cambia a ±0,02 mm
  (`FACE_STABLE_MM`): la pared cambia de dueño dentro de sus capas (la capa más cercana, el umbral de la
  cortical, la fusión de un plano) y allí un redondeo de float32 cambiaría la cara. Plegar esos márgenes en la
  distancia a la frontera dejaba un 13 % menos de puntos interiores (la e2e exige > 40 000 de 50 000) y
  obligaba a clasificar más planos laterales en la pasada B.

**Consecuencias.** El banco de la GPU (`display.wall`) sobre la envolvente del gemelo de la imagen en las
poses de partida (subxifoidea, intercostal, flanco y renal), antes → después: líneas brillantes dentro de la
pared 0–1 → 4–7 (+8–36 dB sobre la mediana local de su capa, que es oscura; a incidencia normal su pico queda
a +8,1 / +9,2 / +6,4 / +13,7 dB del hígado, con 0–0,2 % de picos saturados y un coeficiente de variación a lo
largo de cada línea de 55–73 %: gris-blancas y con tramos, no reglas blancas); el interior de los lóbulos,
0,47–0,57 del gris del hígado (antes, −4/−6 dB: 0,80–0,86); septos +5,0–10,4 dB y estrías +4,4–9,7 dB sobre
la mediana de su capa (antes ≈ 0; sin textura, con las caras, −2,5/+1,0 dB); el músculo entre estrías,
0,73–0,83 del hígado; la cortical costal del flanco, −3 → +19,3 dB sobre el hígado (67 líneas), 13 dB sobre las
líneas de la pared, sin eco de su cara posterior; en la intercostal no entra ninguna costilla, y la renal no
tiene líneas a < 15° de la normal para las capas. Hígado y riñón: el mismo campo bit a bit bajo la pared; la
grasa preperitoneal atenúa algo menos que el músculo que sustituye (+0,1–0,6 dB en el hígado, la SNR igual).
La línea del peritoneo y la cápsula (banco sobre el gemelo, 0–20°): 1,82–1,83 × el hígado (la cápsula sola,
sin la cara del peritoneo, ≥ 1,4, como la cápsula de antes; sin ninguna de las dos, < 1,3). Bajo la pleura de
la cortina (gemelo de la decisión 61, ahora con las capas planas de la pared, sus caras y su retrodispersión;
sin la textura): línea pleural saturada 1,26–1,34 mm (antes 1,24–1,30), neblina 65 de gris (0,65 × el hígado; 68) y 37 en el intervalo siguiente, línea A de orden 2 +44,7 dB sobre la neblina y +28,6 sobre el hígado, la 3
+9,1, anisotropía 2,61 / 0,74 mm = 3,52 (2,57) por las bandas, y la banda de 2–6 mm bajo la pleura
correlaciona 0,70 con 2 mm de descenso del pulmón (0,61; el deslizamiento solo, 0,61). Coste: en las
muestras de pared la pasada B suma la textura en tres planos y clasifica más planos laterales (~+70 % en
ellas, ~15 % de las muestras a 180 mm), y las copias de la pared bajo la pleura, la textura y el eco de cara
plana: +0,3–0,5 ms por cuadro estimados (sin medir con GPU); las caras de pared calculan su gradiente (6
evaluaciones de su capa) solo al alcance de su eco; `classifyWall` calcula las coordenadas de la pared solo
dentro de ella y busca las costillas solo desde `ribSearchDepth`. El GLSL que se compila al arrancar pasa de
298,2 a 364,8 kB (+22 %: el módulo de la pared va en todas las pasadas que clasifican); con SwiftShader la
aplicación arranca en 13,6–14,1 s frente a 10,7 s de main 3c2cec6 (25,7 frente a 19,5 s con la máquina
cargada), sin perder el contexto; el bucle de la serie no lo encarece (vaciarlo no mueve el arranque). El
chunk principal del bundle, 269,9 → 296,6 kB (`vite build`; presupuesto 280 → 305 kB). Reconciliación con la
decisión 60: su retirada entre la pared y el hígado debe clasificarse como grasa extraperitoneal de la pared
(prolongar la capa `Tissue.Fat` y la cara `Peritoneum` hasta el hígado), no como intestino; la cápsula
conserva su cara, y la línea de los dos sigue siendo la del banco (`peritoneum`). En el receso costofrénico la
capa interna de la pared es la grasa extrapleural y su «peritoneo» la fascia endotorácica, 0,35 mm sobre la
pleura; su eco (+20 dB sobre el hígado) queda ~30 dB bajo la línea pleural. La textura tiene una costura en la
línea media posterior (lóbulos y ruidos en u), sobre la columna y fuera de toda ventana. Pendiente con GPU: las
metas del banco de la pared y de la pleura (`docs/fidelity/README.md`), `WALL_COPY_FACE_GAIN` dentro de su
rango y el juicio visual del dueño frente a las referencias.

**Verificación.** `wall.test.ts` (geometría de las capas, arco y periodicidad, orden de las caras, planos
fundidos en el recto, caras de `classify` de la piel al peritoneo, cortical y pericondrio, las costillas no
cortadas por la grasa y `ribSearchDepth` conservadora, gradiente, tabla y nombres GLSL, GLSL de la anatomía
(costillas antes de la grasa, coordenadas de la pared solo dentro) y de la pasada B, textura: 1 fuera de la
pared, septos y estrías con su geometría, anclaje; la cara posterior de la cortical sin eco en la mirada 0 y en
las dirigidas, y a < 3 dB de la anterior sin la regla; el cartílago a ±45°, el reborde costal y la cola de
cartílago de la 10.ª; el eco de cara plana frente al completo, ≤ 0,5 dB por cara y ≤ 0,05 sin ondulación, y el
gradiente analítico frente al numérico); `wallTwin.test.ts` (lento, el gemelo de la imagen: ≥ 3 líneas dentro
de la pared y ≤ 1 antes, lóbulos ≤ 0,6 del hígado, septos y estrías ≥ 1,5× su capa y < 1,5 dB sin textura,
cortical ≥ +15 dB, anclaje al girar la sonda una línea (correlación > 0,999), hígado y riñón bit a bit sin
transmisión, y el banco de la GPU sobre el gemelo en las poses de partida: sus metas, las líneas a incidencia
normal a +4–16 dB del hígado con ≤ 1 % de picos saturados, un CV ≥ 0,3 a lo largo y ≥ 6 dB bajo la cortical,
septos y estrías < 1,5 dB sin textura, la cápsula sin registros bajo la pared y la línea del peritoneo en
1,4–2,1, la cápsula sola ≥ 1,4 y < 1,3 sin las dos caras), con el modelo de antes fallando cada meta;
`startPoints.test.ts` (la intercostal: ninguna costilla, ósea o cartílago, en todo el sector hasta 180 mm,
acoplamiento > 0,9, las suprahepáticas y la VCI, y la puerta del operador en una suprahepática a ≤ 50° y con
peso de ventana ≥ 0,03 en apnea espiratoria y en el máximo descenso de la respiración tranquila);
`pleura.test.ts` y `pleuraTwin.test.ts` de la decisión 61 con la pared nueva (las copias con sus caras por
`WALL_COPY_FACE_GAIN`, y el deslizamiento < 0,8 en los dos extremos de su rango; la cota del campo de la pared;
en toda línea con cortina, el borde a > −1,2 mm y su pulmón pegado al cruce, y las líneas que rozan el borde en
la pose de la primera versión, con su pulmón lejano como espejo y ΔL 0, también en el GLSL de A0; en la vista
intercostal la cortina entera y el borde en inspiración, sin sombra de costilla sobre la pleura);
`faceGradient.test.ts` (la salida barata con las caras de pared y costilla, |∇| ≤ 1,5; falló con la costura en
la línea media posterior y con los planos cortados); `equivalenceSweep.test.ts` (la cáscara ve las nueve caras
en los planos de partida y una GPU sin ellas o con otra ondulación); `fidelityScene.test.ts` (las
suprahepáticas oblicuas en la intercostal de las capturas, Morison desde el flanco inclinado, la línea del
peritoneo); `speckleField.test.ts` (sus cotas, en la pose intercostal de antes: ver LIMITATIONS.md);
`steeredParity.test.ts` (≤ 0,75 % de empates: la vértebra al fondo de la intercostal); `anatomy.test.ts`;
`shaderLimits.test.ts` (ranuras; huella del main de B por la llamada a `wallField`; faceGradient fuera de todo
bucle); e2e: «pared (decisión 62)» (banco de la pared con umbrales para SwiftShader, sus líneas sin saturar, la
cortical en el flanco, y las normales de sus caras en la GPU frente a TS, `wallNormals`), la de ecos de
interfaz (la línea del peritoneo; la luz < 30 donde hay ≥ 50 píxeles, al menos en la subxifoidea y el flanco), la
del color (el téxel de la pasada A que lee el color frente al mismo téxel en la CPU, ≤ 0,1 dB; con el PW en la
puerta, < 2 dB: el téxel es la línea y la fila que la contienen y el PW marcha a pasos de 2,5 mm; en la CPU,
≤ 0,88 dB en 40 fases de la respiración y ≤ 0,77 en el mismo punto), la de la pleura y las del moteado en la intercostal nueva, y la de equivalencia con las caras
nuevas.

## 63. La sonda comprime el tejido: solo empuja, la pared bajo las líneas acopladas queda paralela a la cara y el acoplamiento es el contacto conseguido

**Contexto.** El dueño (25-09-2026), con la pared de la decisión 62 en la GPU real: la fidelidad empieza en la
pared, y ahora se ve un defecto nuevo. El tronco es rígido: la cara convexa de la sonda (radio 60 mm, ±34°)
apoyada en una piel convexa solo la toca en un punto, y bajo la huella la piel, los septos, las fascias, el
peritoneo y la pleura se dibujan como una cúpula (∩): en las capturas de la intercostal en apnea espiratoria e
inspiratoria (`scratchpad/pared2`, mitad derecha) la pleura va de ~25 mm en el centro a 60–100 mm en los bordes
del sector. En un examen el operador aprieta hasta que los bordes apoyan, el tejido blando se amolda a la cara y
las capas del campo cercano corren paralelas a ella; lo hondo casi no se mueve. El acoplamiento (`lineCoupling`)
usaba un hueco ad hoc con un radio de piel fijo de 130 mm y el signo de su curvatura al revés (restaba la sagita de
la piel a la de la cara, como si la piel fuera cóncava) y 4 mm de gel: media 0,83 / 0,76 / 0,94 / 0,78 (flanco,
renal, intercostal, subxifoidea), con líneas «acopladas» sobre aire.
**Opciones.** (1) Desplazar por la normal de la piel hasta la profundidad de la cara: la vuelta a la identidad se
pliega en las líneas oblicuas (gemelo: dw/dd hasta −1,4 en la intercostal). (2) Columnas de la normal de la piel
desplazadas por su hueco: convergen mientras las líneas divergen y el campo se plegaba cerca del borde.
(3) Flexión de placa con giro (Kirchhoff): el giro crece con la profundidad y la transición se pliega igual.
(4) Un modelo elástico (elementos finitos): fuera del presupuesto de un `toMaterial` que corre en cada muestra de
cada pasada. (5) Mapa radial que TIRA del tejido hacia la cara, con el marco de la pose (la primera versión, bf26527):
la sonda no se hunde; la piel sube a la cara y la pared se lleva como una placa (la cara interna a W en toda la
huella). En la GPU (Metal) el flanco quedó excelente, pero en la intercostal los bordes del sector se doblaban hacia
abajo (una «bañera»: la placa llegaba al tope de 25 mm en las líneas muy oblicuas) y en la subxifoidea basculada el
talón se doblaba con una cuña oscura y arcos raros y la punta chocaba con el tope; el hígado se estiraba a lo largo
de las líneas hasta 2,5×. (6) La elegida: solo empujar.
**Decisión.** Campo de desplazamiento que SOLO EMPUJA, a lo largo de la dirección de compresión de cada elemento
(la normal de la cara: la línea radial desde el eje de curvatura), definido por su inversa mundo → material en
`anatomy/compression.ts` (gemelos TS y GLSL con los mismos nombres) y aplicado en `toMaterial` antes de deshacer
la respiración (`deformation.ts`; GLSL `toMaterial` = respiración⁻¹(`uncompress`(p))), con el contacto y el marco
efectivo en `probe/contact.ts`:

- Indentación efectiva. Para que los bordes apoyen, el operador hunde la sonda entera a lo largo de su eje (el
  mango): δ, el menor que hace que todos los nodos apoyen con la pared paralela (falsa posición de Illinois en
  [0, δ_max]), con el tope de la presión: la cara no se hunde en la piel rígida más de P = 13 + 20·blandura mm
  (`skinSoftness` de la decisión 43: 16 sobre costillas … 26 en el epigastrio). Lo que el usuario apriete (lift < 0,
  el deslizador «Presión») se suma a δ a lo largo del mismo eje (por la normal de la piel, con la sonda inclinada,
  alejaba la cara y deslizaba el plano fuera de sí mismo). Al levantar la sonda (lift > 0) el operador deja de
  apretar en 3 mm (la cara sube ~5 mm por mm de lift al principio). El marco efectivo (la pose más δ a lo largo del
  eje: el plano de imagen no cambia, solo su origen baja por la línea central) es el del simulador (`sim.frame`):
  imagen, puerta, gates, ganchos y el navegador 3D (que dibuja la sonda hundida en el tronco rígido) lo usan.
- Por nodo (64, equiespaciados en σ = sen α; 3 líneas por nodo), a lo largo de su línea en el tronco rígido desde
  el elemento del marco efectivo: r_s, la distancia a la piel (analítica: la elipse del tronco; < 0, la cara la
  hunde), y r_W, la distancia a la cara interna de la pared (profundidad W). Tabla: s₀ = min(0, r_s) (la piel
  hundida llega a la cara; si no la toca no se tira de ella), D = min(max(r_W, min(D*, T)), D* + 20) con
  T = r_W − r_s y D* = W + 1 mm, y s_D = min(0, r_W − D): la cara interna de la pared queda a D* en el mundo si el
  empuje alcanza (o a T si la pared mide menos a lo largo de la línea: se traslada entera); si no, el empuje se apaga
  dentro de la pared, que se dobla como en el tronco rígido.
- m′ = p + s·r̂, s = W_e(e)·T_l(σ)·g(d): g = s₀ + (s_D − s₀)·clamp(d, 0, D)/D para d < D y s_D·(1 −
  smoothstep(D, D + S, d)) debajo, S = max(2L, 6·|s_D|), L = 16 mm. s ≤ 0 (se aparta de la sonda) y ∂s/∂d ≥ 0
  (s_D ≥ s₀ y la caída multiplica s_D por algo decreciente): a lo largo de la línea el tejido solo se comprime
  (dr/dd ≥ 1; bajo la pared, a lo sumo un 20 %: 1/(1 + 1,5/6)) y el mapa nunca se pliega. A lo ancho el tejido
  empujado se abre: el arco de la misma α mide ρ en el mundo y ρ + s en el material. W_e: plana en la media huella
  elevacional (±6,5 mm) y cola de 10 mm; T_l: más allá del borde de la cara, los nodos del borde se apagan en Δσ 0,09.
- Acoplamiento = contacto conseguido (`contactCoupling`), por nodo: (1 − smoothstep(2, 4,5, max(r_s, hueco de
  los bordes elevacionales))) (el gel) · (1 − smoothstep(D*, D* + 1,5, r_W − max(0, r_s))) (la pared paralela; un
  hueco de gel la baja entera sin doblarla), el segundo factor erosionado un nodo (entre un nodo que apoya y otro
  cuya pared se dobla la tabla interpolada ya dobla la pared: la cara interna sube 10 mm en 1°) y el producto
  filtrado [1 2 1]/4: la transición ocupa ~4 nodos (12 líneas) y lo que pasa de la erosión queda ≤ 1/8. Lo usan la
  textura de acoplamiento del renderizador, la transmisión de la puerta PW (`gateTransmission`), el banco y los
  ganchos. `lineCoupling` se va.
- Las direcciones van al mundo con la jacobiana de la inversa (`warpAt`, analítica: una evaluación del campo;
  `warpNormal`: J^T·n = n + (r̂·n)·∇s + (s/ρ)·(n − (n·r̂)·r̂ − (n·ê)·ê)): el gradiente de cada cara en el eco de
  interfaz (normal y norma; la salida barata multiplica su cota por `warpBound`), la normal de las láminas de la
  textura de la pared, el eco de cara plana de las copias bajo la pleura y la incidencia de la pleura. En el borde
  exacto de la cara (las líneas extremas) la pendiente de la tabla es la de dentro.
- GPU: los mismos tres vec4 del esquema único (`uCompC`: centro de curvatura y R + alcance, 0 sin compresión;
  `uCompAx`: eje axial y sen del semiángulo; `uCompLat`: eje lateral y media huella) y la tabla en la textura de
  escena desde `COMPRESSION_BASE`, un téxel por nodo (s₀, s_D, D, R): el radio viaja en la tabla para que el alcance
  (max D + S de la tabla, la salida temprana antes de leerla) quepa en las tres ranuras. Dos lecturas de la textura
  por evaluación, como antes; sin atan (σ = (P·lateral)/ρ).
- El simulador calcula el contacto (y el marco efectivo) cuando cambia la pose (0,7–1,7 ms), lo pone en la
  anatomía (`AnatomyQuery.setProbeCompression`) y lo pasa al renderizador (`FrameInputs.compression`): CPU y GPU ven
  el mismo tejido. Los gates de equivalencia deforman cada punto de partida con la suya y su marco efectivo.

Parámetros y fuentes, todo [ESTIMADO]: la presión, que un convexo de 60 mm de radio y ±34° necesita hundirse su sagita
en el borde (10,3 mm) para apoyar entero en un abdomen plano, y algo más para que la pared oblicua de los bordes
quede paralela (flanco: 14,8 mm); fuerza de la sonda en el examen abdominal 5–20 N; módulos de contexto, de memoria:
hígado sano ~5 kPa (elastografía de transición), grasa 1–4 kPa, músculo 10–30 kPa. L = 16 mm [12–25] y κ = 6: bajo
una carga en franja o en rectángulo la tensión vertical cae a ~la mitad a una anchura del lado corto y a ~10 % a 3–4
anchuras (Boussinesq 1885, Flamant 1892; gráficos de Newmark 1935; de memoria, sin verificar); κ acota la compresión
del hígado (casi incompresible: en realidad se desliza de lado, ver `probe-compression-in-plane`): con κ = 4 (27 %)
el hígado despejado del banco en la subxifoidea pasaba de 31 a 22 parches (gemelo) y la e2e del banco se quedaba
en 15 (pide > 15); con 6, 28 y 16–17. A cambio lo hondo se mueve más (con κ = 4, ≤ 5–10 mm). Tolerancia de la
pared 1 mm y rampa 1,5 mm: la dispersión de la cara interna bajo las líneas acopladas ≤ 3 mm (el requisito de la
revisión con GPU). Gel 2 mm con 2,5 de rampa.

**Consecuencias.** Gemelo (CPU, `compression.test.ts`; adulto de referencia), en las poses de partida (subxifoidea,
intercostal, flanco, renal):

- Indentación δ 20,0 / 16,0 / 14,8 / 17,4 mm (topes 26 / 16 / 16 / 20; la subxifoidea, con 26° de basculación, ya
  hunde el talón 6 mm en la pose). Consecuencia aceptada: al apretar, el campo cercano se acerca a la sonda y lo
  hondo aparece hasta δ mm menos profundo en la imagen, como en un examen real. A lo largo de la línea central: la VCI
  de 123 → 107 mm (subxifoidea), el ligamento venoso de 132 → 116,5 (intercostal), la VCI de 127 → 112,5 (flanco); el
  riñón, justo bajo la pared en la vista renal, se lo lleva el empuje: su corteza, de 39 → 38,5 mm. Apretar 3 mm más
  (lift −3) baja la cara 3 mm por el eje y ensancha el contacto de la intercostal (media 0,64 → 0,70).
- Acopladas (≥ 0,5; plenas ≥ 0,99; media): 148 (−34°…+18°), 141, 0,77 / 122 (±21,5°), 114, 0,64 / 192, 192, 1 /
  192, 192, 1 (`main`: 151 / 180 / 160 / 148 líneas, media 0,78 / 0,94 / 0,83 / 0,76). La punta de la subxifoidea
  basculada no apoya más allá de +18° ni con la presión máxima; en la intercostal, a lo largo del espacio
  (casi transversal: en la sección la pared lateral del tórax tiene 69 mm de radio), la pared de los bordes no queda
  paralela ni hundiendo la sonda 50 mm.
- Bajo las líneas acopladas la piel queda en la cara (≤ 0,05 mm) y cada capa a su profundidad: la media pared con
  dispersión 0,85 / 0,80 / 0,25 / 0,45 mm y la cara interna (peritoneo y pleura) a 27,40–29,15 / 28,00–29,00 /
  28,55–29,00 / 28,30–29,05 mm (tronco rígido, con el marco de la pose, bajo las mismas líneas: 21,5–53,4 /
  28,1–50,0 / 28,6–46,8 / 28,3–51,5). La normal de las capas en el plano, frente a la línea, bajo las líneas de
  contacto pleno: ≤ 6,4 / 7,8 / 3,2 / 4,6° (rígido 41,6 / 46,7 / 34,0 / 39,0°); la tabla es lineal entre nodos y la
  pendiente de las capas oscila con el periodo de un nodo (con 32 nodos, hasta 9° en la media pared de la
  intercostal: el eco especular de las fascias se habría «abalorio»; con 64, la mitad).
- A lo largo de la línea el estiramiento (mundo/material) va de 0,763 / 0,756 / 0,800 / 0,779 a 1,000: solo
  compresión (el mínimo, la pared oblicua comprimida hasta D*). A lo ancho, ≤ 1,67 / 1,36 / 1,33 / 1,41 (el talón de
  la subxifoidea, empujado 24 mm). Empuje máximo 24,0 / 16,0 / 14,7 / 17,4 mm; alcance 172 / 124 / 117 / 133 mm; más
  allá, la identidad exacta. Lo hondo (mundo): VCI, suprahepáticas y riñón a más de 60 mm de la cara se mueven ≤ 11,6 /
  7,7 / 9,4 / 13,6 mm (el riñón, bajo la pared de la vista renal): se mueven con el empuje, menos que la cara.
- Los otros casos (pared de 29 y 31 mm): el flanco apoya entero con δ 14,9 y 15,3; la intercostal, 118 y 108 líneas.
- Intercostal: la pose de partida (a lo largo del 8.º espacio, φ π, z 0, yaw −1,15) frente a la coronal
  (marcador craneal) entre dos costillas en la axilar media, en un barrido de φ 0,96–1,04π, z −14…30 mm e
  inclinación 0 y −0,2, con la función de la vista (ángulo de la puerta en una suprahepática ≤ 50° con `bestGateOnVessel`
  y el peso de ventana ≥ 0,03, en apnea espiratoria y respirando; líneas de hígado; sombras costales ≤ 1 por borde) y
  la geometría del campo cercano (dispersión de la cara interna bajo las acopladas ≤ 3 mm). La actual pasa todas:
  ninguna costilla, 122 líneas de hígado, puerta a 42° / 35° con peso 0,085 / 0,060, cara interna Δ 1,0 mm; solo
  pierde los bordes (acoplamiento medio 0,64). Ninguna coronal pasa: apoyan enteras (Δ 0,4–1,2 mm) pero cruzan 3–5
  costillas (a 17–22 mm en z en la axilar media; el sector abarca ±47 mm a su profundidad; casi siempre una en el
  centro), dejan 19–63 líneas de hígado y solo las abanicadas hacia atrás (tilt −0,2, z −14…+6 mm: la del flanco,
  algo más alta) dan ≤ 50° (35–50°). Se queda la actual.
- Coste: `toMaterial` suma una evaluación del campo (salida temprana más allá del alcance) y la pasada B dos
  jacobianas por píxel (la muestra y, en las líneas con cortina, la pleura); +3 ranuras de uniforms en cada programa
  con anatomía (B 115 → 118, la dirigida 117 → 120). Arranque con SwiftShader: la primera versión (con atan, la
  tabla en uniforms indexada y la jacobiana por diferencias centrales) pasaba de 14,3–15,0 s en `main` a 17,1–18,3 s;
  la de solo empujar lee lo mismo de la textura y su perfil tiene una rama más: en 3 pares intercalados con `main`
  (carga de la máquina ~9, por otros procesos), 39,2 / 38,3 / 30,2 s frente a 42,7 / 34,6 / 27,5 s (razón 0,92 / 1,11 /
  1,10; con carga 25–55 los pares daban de 0,86 a 1,63): +10 % a lo sumo, a confirmar en una máquina quieta. Huella
  nueva del main de B (la incidencia de la pleura y la jacobiana que recibe `wallField`); sin compresión
  (uCompC.w = 0) las cuentas son las de antes.
- El banco de la pared (`display.wall`) elige las líneas «normales a la piel» con la normal del mundo y deja fuera de
  las líneas de la pared la ventana del eco de la cortical costal (hueso a < 0,6 + 1,3 mm del pico): con la pared
  comprimida, en el flanco la capa hallada a ~1 mm sobre las costillas era su cortical. Las costillas se llevan con
  la pared. Las guardas del medio anclado (`speckleMotion`, `speckleCrossfade`) miden el hígado de las líneas
  acopladas (≥ 0,95, como el banco): los bordes de la intercostal, sin acoplar, son ruido del receptor. Girar la
  sonda 2° cambia su contacto, pero solo empujando el tejido comprimido se mueve por ello 0,05 mm de mediana (p90
  0,18; gemelo), muy por debajo del grano (la versión que tiraba del tejido lo movía tanto que la guarda tuvo que
  medir solo donde no había compresión). La e2e de la composición espacial mide la subxifoidea basculada 10° menos
  (`pose: { rockDeg: −10 }`): con la de partida (26°) la punta no apoya más allá de +18° y lo hondo sube ~16 mm; en la
  rejilla de la e2e le quedaba 1 parche compuesto de hígado despejado a 20–60 mm (5 en `main`, el mínimo), con 16°, 7
  (apoyan 177 de 192 líneas; gemelo: VCI 272 → 309 muestras). El corte anatómico (`cutMapWorker`)
  recibe el contacto y muestra el tejido comprimido; los gemelos de imagen de la pared y la pleura (`wallTwin`,
  `pleuraTwin`) y el del contorno del hígado siguen sobre el tronco rígido con el marco de la pose sin hundir (solo
  toman del contacto el acoplamiento).
- Limitaciones: `probe-compression-kinematic` y `probe-compression-in-plane`. Pendiente con GPU: la comparación
  visual de la intercostal, el flanco y la subxifoidea con las capturas de bf26527 y el coste por cuadro.

**Verificación.** `compression.test.ts` (falla en `main`: la cúpula —la cara interna del tronco rígido bajo las
mismas líneas se dispersa 18–32 mm—, la normal a 34–47° y el acoplamiento): bajo las líneas acopladas, la piel en
la cara y cada capa a su profundidad (dispersión de la cara interna ≤ 1 / 1,5 / 3 / 3 mm; flanco y renal, 192
líneas; intercostal ≥ 110; subxifoidea ≥ 140); la normal del mundo de las capas bajo las de contacto pleno
(≤ 6° / 9°); solo empuja y solo comprime (s ≤ 0 y dr/dd ≥ 1 − 10⁻⁶ en un barrido de 144 poses de presión,
flotación, basculación e inclinación, en el plano y a ±3 mm; el empuje de la piel < 0,6·R); acoplamiento pleno en el
flanco y el renal, un solo tramo acoplado con el centro y los bordes sin acoplar en la intercostal y la
subxifoidea, sin saltos de más de 0,25 entre líneas vecinas; apretar lo ensancha y flotar lo quita; la cara se
hunde δ a lo largo del eje y lo hondo se acerca (> 0,5·δ salvo el riñón, que se lleva el empuje: < 0,3·δ); más allá
del alcance, la identidad, y lo hondo se mueve < 0,8·δ; la identidad con la sonda levantada 12 y 20 mm en las poses
de partida (con más basculación el elemento más bajo sigue en la piel más arriba: es físico); el gradiente analítico
frente al numérico; `warpNormal` = J^T numérica; `toWorld`∘`toMaterial` = identidad; la GLSL (constantes,
funciones, orden en `toMaterial`, sin atan, la tabla en la textura de escena, R + alcance en uCompC.w). `startPoints.test.ts`
y `examChain.test.ts` con el tejido comprimido y el marco efectivo de cada pose (la intercostal, con un acoplamiento
medio de más de 0,55); `anatomy.test.ts` y `gateTransmission.test.ts` con el contacto nuevo; `shaderLimits.test.ts`:
huella del main de B y `warpAt` fuera de todo bucle. e2e con SwiftShader (en el puerto propio, la máquina cargada):
equivalencia GLSL = TS con la compresión de cada punto de partida, arranque, cambio de caso, Medir, Rayleigh, banco
de fidelidad, composición espacial (con la subxifoidea basculada 10° menos), normales, ecos de interfaz, pleura,
pared, pasada A, moteado al inclinar y girar, fundido del ancla, sin contacto no hay Doppler y color: pasan.

## 64. Reservada: lámina difusa de la cápsula hepática [Estado: reservada]

Número reservado para la lámina difusa de la cápsula (plan de contornos); ya la citan `capsuleTwin.test.ts`,
`fidelity.ts` y `beamModel.ts`. La redacta su rama.

## 65. Modulación de R_ef de las caras: facetas inclinadas ancladas, rugosidad fina de frente y componente difusa

**Contexto.** Sirve al objetivo 2 (fidelidad ecográfica). En la ronda 3 del juez ciego (21/21 detectadas) la pista n.º 2
son las interfaces como trazos de pluma: líneas finas de brillo y grosor constantes a lo largo de toda su curva, que
siguen brillando oblicuas, sin fragmentación ni rugosidad, y alguna que sale del órgano (la ventana renal con la
cápsula, Morison y una «U» larga; las paredes de la VCI como alambres paralelos; los vasos; los nueve arcos de la
pared). Inventario en CPU de las cuatro ventanas (`scratchpad/iface/faces.mts`: con la compresión de la sonda, apnea
espiratoria, cada cruce de cada línea con su cara, su par de tejidos, su incidencia y el pico previsto del eco
coherente sobre el moteado, K + R_ef + Λ + χ + C; y el mapa de caras de la CPU sobre la captura con GPU,
`faceprobe.mts`):

- **La «U» de la ventana renal** es la cápsula renal (cara 10, grasa perirrenal/corteza) en el contorno profundo del
  riñón, que sigue a la izquierda por la cara externa de la grasa perirrenal (11, Morison: hígado/grasa) y la cápsula
  hepática (7) del hígado junto a la grasa retroperitoneal: anatomía real (la cápsula posterior del riñón y la
  interfaz hepatorrenal), pero a +23 dB a 0–20°, +18 a 20–40° y aún +12 dB (la 11) a 40–60°: un alambre en todo su
  recorrido. Las líneas rectas que «salen del órgano» en la intercostal y el flanco son la cápsula hepática (7) de
  la cara posterior del hígado junto a la VCI y la grasa retroperitoneal (una cara plana de la cuña visceral,
  decisión 72): reales, con forma de primitiva. En la ventana renal la cara del peritoneo parietal (19) de la pared
  separa en 114 de 192 líneas la grasa preperitoneal de la retroperitoneal (91 en el tronco sin la compresión de la
  sonda): grasa con grasa, sin peritoneo; en otras 56 (65), de la cápsula hepática: el área desnuda del hígado.
- Paredes de la VCI: +8,7 dB a 0–20° en la subxifoidea, uniformes; las fascias y el peritoneo de la pared, +4–16
  dB a 0–20° y, en la renal (sonda inclinada 23°), +5–14 dB a 20–40°: los arcos.

Tres causas en el eco de la decisión 57: (1) Λ(θ; s) es la **media del conjunto** de facetas, así que la línea es la
media en todas partes, sin la realización (tramos que miran a la sonda y tramos que no); (2) la coherencia de la
rugosidad fina se evaluaba en la incidencia media, χ(θ) = exp(−2(k0σz·cosθ)²), que **crece** con la oblicuidad: en
retrodispersión las facetas que devuelven el eco miran de frente al transductor, así que su χ es la de incidencia
normal (el término cuasi especular del modelo de dos escalas: Valenzuela 1978, _Boundary-Layer Meteorol._ 13:61; Leader
1978, _Radio Sci._ 13:441); con χ(θ) una fascia (σz 0,075 mm) ganaba +5 dB a 30° y +8 a 40°, casi lo que el lóbulo
le quitaba; (3) la energía que la rugosidad fina quita a la parte coherente (1 − χ²) se perdía: sin componente
difusa, una cara oblicua era o un alambre o nada.
**Opciones.** (1) Una ganancia aleatoria de R_ef a lo largo de la cara (como `wallFaceGain` de la 62): no depende de la
incidencia, pinta. (2) La fase de ida y vuelta de cada faceta: la descartó la 57 (las líneas la submuestrean). (3)
Facetas de Monte Carlo por rayo (Mattausch y Goksel, VCBM 2016 y _Comput. Graph. Forum_ 37:202, 2018: la rugosidad
como distribución de microfacetas): muchos rayos por muestra. (4) La elegida: un campo de inclinación liso y anclado
sobre el lóbulo propio de la faceta, con χ(0), y la componente difusa sobre el fasor del moteado.
**Decisión.** En la pasada B (`INTERFACE_ECHO_GLSL`; gemelos en `ultrasound/interfaceEcho.ts`: `facetTilt`,
`facetCosine`, `facetEchoField`, `diffuseEchoField`, `addInterfaceEcho`, `faceSiteGain`), para las caras que salen de
`classify`:

- **Facetas.** La normal de la cara se inclina con τ, tres ruidos de valor anclados al punto material (`FACET`: célula
  de 3 mm, correlación 0,67 a 1,5 mm y 0,18 a 3 mm, del orden del haz lateral; sales fijas por cara), de desviación
  σ_t = max(tan 5°, 0,5·s) por componente tangente: 5° en la VSH, la VCI y la cortical, 5,7° en las cápsulas, 7° en la
  porta, 8,5° en las fascias y 11° en el peritoneo [EXTRAPOLACIÓN PROPIA]. La especular es la de la faceta: su lóbulo
  propio de pendiente s_f = √(s² − σ_t²) (0,87·s; 0,78·s en la VSH y 0,81·s en la cortical, las más lisas: hace falta
  s > tan 5°, que una prueba vigila) en la incidencia sobre la normal inclinada, con la amplitud que conserva la
  energía (A_i·s/s_f): en media sobre τ la potencia de cada muestra es la del lóbulo del conjunto (±0,6 dB hasta 30° en
  las 19 caras), así que K y las R_ef calibradas no cambian en media. De frente la faceta apenas cambia el eco (la
  dependencia es de segundo orden en τ); en el flanco del lóbulo es exponencial en τ: la línea se arrosaria de frente y
  se rompe oblicua. El perfil (δ) sigue en la cara, con su incidencia; la curvatura C de tubos y costillas, la de la
  cara. La especular tiene la fase 0 común de la cara (decisión 57), así que C y D suman las facetas vecinas en amplitud:
  donde la PSF lateral abarca facetas distintas la imagen sigue su amplitud media, que a 10–20° queda bajo el lóbulo del
  conjunto (si la PSF las promediara del todo: −0,4 / −0,9 / −1,6 dB a 10 / 15 / 20° en la VCI, −1,2 / −2,4 / −3,8 en la
  VSH, −0,3 / −0,8 / −1,3 en la cápsula; con la PSF de 1,4–2 mm frente a la célula de 3 mm, menos); una fase por faceta
  la dejaría en la potencia media, pero las líneas la submuestrean.
- **χ(0)** en la especular de la faceta. La pleura del espejo, la pleura parietal de la cortina y las copias de la pared
  de su serie (decisiones 57, 61 y 62) conservan el eco del conjunto con χ(θ): sus niveles están calibrados con él y las
  copias van en un bucle (el JIT de SwiftShader).
- **Difusa.** a_d = κ_d·R_ef·√(1 − χ(0)²)·cosθ·g(δ)/g(0) sobre el fasor unidad del campo del tejido de la muestra
  (`mediumField` y `mediumFieldPh`: `field·(1 + a_d/|field|)`): incoherente con la especular, granulosa, anclada, con la
  fase de cada mirada del compuesto y casi independiente del ángulo (Lambert en amplitud). Al ir sobre el fasor del
  tejido refuerza su grano en lugar de sumar uno independiente: por muestra, (|f| + a_d)² frente a |f|² + a_d², hasta
  +2,8 dB más de potencia cuando la difusa iguala al moteado (Rayleigh: 1 + 2a·E|f|/(1 + a²) con E|f| = √π/2) y nada
  cuando una de las dos domina. κ_d = 24 (`FACET.diffuse`)
  [ESTIMADO]: no sale de la conservación de la energía (la parte que vuelve a la apertura depende de ella y de la PSF),
  se calibra: en el gemelo de la pared deja las líneas a +4,4–8,7 dB y la cortical costal a +17,7 dB, en sus metas (W7
  y W4 de la 62), que sin difusa bajaban a 0,6 y 11,3 al perder χ(θ). De frente, por muestra, la difusa queda 21–32 dB
  bajo la especular en las caras lisas (vasos, vesícula, cápsula hepática, cortical), 11 dB en la cápsula renal y
  Morison (σz 0,06) y es comparable en las fascias y el peritoneo (−5 a +0,5 dB), cuya rugosidad deja ~1 % de energía
  coherente.
- **Pendientes revisadas** (lo que dejaba alambres oblicuos no era el suelo, que no depende del ángulo, sino el lóbulo
  ancho con χ(θ)): cápsula hepática s 0,25 → 0,2; cápsula renal 0,25 → 0,2 con σz 0,05 → 0,06 y la cara externa de la
  grasa perirrenal 0,3 → 0,2 con σz 0,06 (el nivel de Morison lo fija ahora χ(0), no la s). La VCI conserva 0,18: con
  0,14 su pared a 0–20° en la subxifoidea del sano caía a 1,16 con un 62 % de huecos. Los suelos no cambian.
- **Grasa con grasa.** La cara interna de la pared con grasa detrás no tiene peritoneo: la grasa extraperitoneal sigue en
  la retroperitoneal o la perirrenal y queda una fascia, así que su R_ef baja de 0,132 a 0,03 (`RETRO_PERITONEUM_GAIN`)
  [ESTIMADO]. Grasa detrás (`fatAcrossWall`): dentro del compartimento retroperitoneal (decisión 81, `retroFatSdf` < 0)
  y sin hígado, cúpula (diafragma o pulmón) ni cuadrado lumbar a 1,5 mm de la muestra (`WALL_ACROSS_MM`), porque en
  `classify` los órganos ganan al compartimento. Contra el área desnuda del hígado, el diafragma o un músculo el salto
  de impedancia sigue ahí y la cara no cambia; la columna no se descarta (desde las ventanas abdominales esa cara está
  en la sombra del hueso). En el tronco entero el predicado acierta las 1032 caras con grasa detrás salvo 29 y no marca
  ninguna otra (`scratchpad/iface/retropred.mts`). Scarpa y los planos intermusculares conservan sus suelos: se rompen
  con sus facetas y su difusa queda ~4 dB bajo la de las fascias principales.
- **Sin ranuras nuevas:** todo son constantes (`#define`) y el uniform `uIface` de siempre, del que sale también la
  R_ef de la difusa (κ_d·R_ef = `IFACE_DIFFUSE`·A·2s, sin tabla) (la pasada B sigue en 128 y 130 ranuras). El campo de
  inclinación (tres ruidos de valor) solo se evalúa en las muestras al alcance de su cara, y el hígado, la cúpula y el
  cuadrado lumbar solo en las de la cara interna de la pared dentro del compartimento; todo fuera de los bucles (una
  prueba vigila que ni `interfaceEcho` ni `facetTilt` entren en uno). Las pleuras y las copias de la pared de la serie,
  en su bucle, usan el eco del conjunto sin difusa (`interfaceProfileEcho`).

**Consecuencias.** Banco con GPU (M4, armónica y compuesto, `--sweep`, 26-09-2026; `main` d1f3600, con la PSF de la
decisión 84 → esta decisión, `docs/fidelity/README.md`): Morison a 0–20° 2,19–2,32 → 2,01–2,13 (vuelve a [1,6; 2,2]:
con la PSF de la 84 había quedado por encima en tres de las cuatro escenas) con rosario 0,11–0,14 → 0,14–0,35, y a
20–40° 1,89–2,02 → 1,45–1,64; la línea del peritoneo y la cápsula a 0–20° 1,73–1,85 → 1,81–1,95 y a 20–40° 1,53–1,84
→ 1,33–1,59 (en la renal son las líneas contra el hígado, 1,53–1,55 → 1,33–1,39: la métrica pide la cápsula debajo y
no ve las de grasa con grasa); la VCI a 0–20° en la congestión 1,54–1,72 → 1,48–1,75 y en el sano 1,39–1,41 →
1,30–1,52, con huecos 0–0,20 → 0–0,38 y rosario 0,10–0,23 → 0,14–0,28 (las referencias, 0,23–0,38). La mediana del
sano en la subxifoidea (1,30) queda bajo el 1,36–2,1 de las tres referencias de pared y la del flanco en su borde
(1,36): cuenta ahora los tramos sin eco entre los brillantes (36–38 % de los registros), como la VCI real de las
imágenes del juez, que solo brilla en tramos cortos, y la imagen sigue la amplitud media de las facetas (arriba); la
potencia media por muestra es la de antes. VSH a 40–60° 1,05–1,15 → 1,06–1,15, porta a 20–40° 1,24–1,33 →
1,26–1,35 y el hígado (gris 86–95, desviación, SNR) sin cambios. Contorno de Morison: CVc a 0–20° 0,01 → 0,03–0,14
(referencias 0,03–0,08) y a 20–40° 0,03–0,06 → 0,12–0,16 (0,10–0,14); su contraste a 40–60° frente al de 0–20° sube de
0,23–0,27 a 0,31–0,35, aún lejos del 0,53–0,82 de las referencias (allí manda la banda de grasa perirrenal, que es del
tejido y no de la cara). Las líneas de la pared: dentro 5–6 como antes, nivel −0,2–13,6 → −0,1–11,3 dB (la renal,
13,4–13,6 → 10,7–11,3) y ningún pico saturado; en el gemelo de la pared, con la PSF de la 84, +4,6–8,4 dB y la
cortical costal +17,8 dB. En la ventana renal, línea a línea en el gemelo, la cara interna de la pared con grasa
detrás baja de −0,4 a −6,4 dB sobre el tejido de alrededor (91 líneas: ya no hay línea) y contra el hígado queda en
2,1 dB (2,7 con el eco de la 57; 65 líneas). En las capturas (`scratchpad/iface/ab-r1`) las paredes de la VCI son
líneas con tramos más y menos brillantes, los brazos de la «U» renal y Morison oblicuo se apagan y se rompen, y la
línea larga de la cara posterior del hígado en el flanco se modula y se apaga hacia el borde. Queda: el grosor de la
línea no depende de la inclinación de la cara en elevación (la rodaja de 3–5 mm la ensancharía; la cara de un lado es
fina en `classify`), las líneas a incidencia normal siguen siendo continuas y limpias (se arrosarian, no se
fragmentan), la pared sigue con sus capas equidistantes (anatomía de la 62) y la difusa es una capa fina sobre el
moteado del tejido, no la de un septo con volumen. Coste: tres ruidos de valor por muestra junto a una cara, y el
hígado, la cúpula y el cuadrado lumbar en las de la cara interna de la pared dentro del compartimento; el cuadro con
GPU no cambia de forma medible (9,3–11,5 → 9,7–13,1 ms con la máquina cargada) y el índice crece 1,8 kB. Revisión
adversarial: la primera versión bajaba la cara interna de la pared en todo el compartimento, también contra el área
desnuda del hígado (65 de las 156 líneas de la ventana renal), y su prueba medía justo esas líneas; ahora el
predicado mira lo que hay detrás y la prueba mide las dos familias por separado.
**Verificación.** `interfaceEcho.test.ts` (el ruido normalizado; la inclinación con σ_t por componente, media nula,
componentes y caras independientes, anclada y correlada 1,5–3 mm; s > tan 5° en todas las caras; la media sobre las
facetas igual al lóbulo del conjunto con χ(0) a ±1 dB hasta 20° en cinco caras; el CV de la especular que crece con la
incidencia; χ(0) frente a χ(θ); la difusa, Lambert, 21–32 dB bajo la especular por muestra en las caras lisas,
comparable en las fascias y escalando con K; la cara interna de la pared con grasa detrás y contra el hígado; las
constantes y las fórmulas en la GLSL de los dos programas de B), `interfaceTwin.test.ts` (M4 a 0–20° con las cotas de
la 57 salvo el tramo de la VSH y de la cápsula y el rosario de Morison, medidos con 8 semillas; M8 con cuatro
semillas frente al eco de la 57 con la misma tabla: la cápsula de 0–20° a 20–40° cae 10,5 frente a 9,4 dB y se rompe
más, huecos 0,34 frente a 0,25; y la fragmentación que depende de la incidencia en la cápsula en espiral: CV de la
traza 0,16 / 0,27 / 0,48 a 0° / 10° / 20° frente a 0,09 / 0,12 / 0,22 con el eco de la 57), `capsuleTwin.test.ts` (la
cresta sin moteado modulada y σ_L ≥ 1,6 dB a 0–20°), `wallTwin.test.ts` (las metas de la pared y la cortical con la
difusa, y las dos familias de la cara interna de la pared en la ventana renal), `pleuraTwin.test.ts` (su gemelo con el
eco de la faceta en la cápsula y las capas de la pared), `shaderLimits.test.ts` (ranuras, y ni `interfaceEcho` ni
`facetTilt` en un bucle), la e2e completa y el banco con GPU.

## 66. Tríplex: el color sigue en pantalla con el PW, la puerta nace en la caja y la caja acompaña a la puerta

**Contexto.** El dueño (médico, 25-09-2026): «al poner color doppler y luego poner PW se espera que se mantenga el
doppler color en pantalla». En un ecógrafo real, pulsar PW con el color encendido da el modo tríplex (B + color +
espectro): el color muestra dónde está el vaso y la puerta se coloca dentro de él. Aquí el reductor del equipo
hacía los modos excluyentes (`color.enabled = mode === 'color'`, `pw.enabled = mode === 'pw'`): el color se apagaba
al abrir el PW y la puerta quedaba donde estuviera (por omisión a 9 cm en el centro, casi siempre en parénquima). El
motor ya podía llevar las dos cosas a la vez (la pasada F y la cadena PW miran cada una su bandera).
**Opciones.** (1) Solo quitar la exclusividad: el color se queda, pero la puerta puede nacer fuera de la caja y, al
moverla, salir de ella sin que el color la siga. (2) El modo «actualizar» de algunos equipos (la imagen se congela
mientras corre el espectro): útil para PRF altas, pero el alumno pierde la imagen mientras coloca la puerta. (3) La
elegida: tríplex simultáneo como en los equipos actuales, con la puerta que nace en la caja y la caja que la
acompaña.
**Decisión.** `ImagingMode` gana `'triplex'` (`src/app/equipment.ts`; `store.ts` reexporta el tipo). Los botones y
atajos de Color y PW alternan su función y conservan la otra (`toggleMode`: color + PW → tríplex; PW otra vez →
color solo; 2D apaga las dos), como las teclas de un equipo; la herramienta de medida de la pestaña Medir abre el PW
conservando el color. En el reductor, el PW que se abre con el color encendido pone la puerta en el centro de la
caja si estaba fuera (`gateInColorBox`); el color que se abre con el PW encendido centra la caja en la puerta; y en
tríplex la caja se centra en la puerta cuando esta sale de ella, conservando su tamaño y acotada al sector (en
dúplex, sin color, la caja no se mueve). La cadencia física del color (decisión 39) descuenta el tiempo del PW
intercalado: cada disparo PW espera el eco del fondo de la puerta y se repite a su PRF sin huecos, así que la
imagen solo dispone de la fracción `1 − PRF·2d/c` (`pwDutyCycle`, acotada a 0,8): con la PRF por omisión y la
puerta a 9 cm, un 31 % menos de cuadros. Invariante: en tríplex la puerta queda siempre dentro de la caja; si un
comando la sacaría (mover la puerta, «Caja −», reducir la profundidad) la caja se centra en ella, y si lo que se movió
fue la caja, la puerta va a su centro (la revisión adversarial halló que «Caja −» la dejaba fuera en ~la mitad de los
estados). El HUD da las dos líneas (color y PW) y el chip la escala del color con la profundidad de la puerta y el
barrido; la pestaña Doppler muestra los dos subpaneles.
**Consecuencias.** El alumno coloca la puerta sobre el color, como en la clínica, y ve que la imagen se refresca más
despacio en tríplex. La PRF del PW no se reparte con el color (los equipos reales limitan a veces la escala del PW
en tríplex simultáneo): queda en `LIMITATIONS.md`. La composición espacial sigue apagada mientras haya color.
**Verificación.** `equipment.test.ts` (alternancia de los modos, la puerta que salta a la caja o se queda si ya
estaba dentro, la caja que se centra en la puerta al abrir el color desde el PW, la caja que acompaña a la puerta y
se acota junto al borde del sector, normalización idempotente),
`colorTiming.test.ts` (el tiempo del PW y su cota), `controllers.test.ts` (HUD y chip del tríplex) y la e2e
«tríplex» de `smoke.spec.ts` (color sobre las interlobares y espectro a la vez, puerta dentro de la caja, cadencia
menor que con el color solo y vuelta al color solo).

## 67. Vesícula en pera curvada con una sola pared; ningún vaso la atraviesa

**Contexto.** El dueño (médico, 25-09-2026): «vesícula biliar demasiado perfectamente geométrica, doble pared,
vasos hepáticos que pasan a través de la vesícula». Medido en el modelo: la vesícula era un único elipsoide recto
afilado (decisión 41), sin cuello, bolsa de Hartmann ni pliegues; en el lado hepático se veían dos líneas especulares
paralelas a 1,9 mm (la de la luz y la de la cápsula hepática de la fosa, que no se suprimía), lisas y de grosor
idéntico; y la suprahepática media nacía en la fosa: su primer tramo cruzaba la luz 34 mm (726 mm³, hasta 5,4 mm
dentro, igual en los tres casos), con sangre y flujo Doppler dentro de la bilis. El cístico acababa a 40 mm del
cuello. Referencias (revisión con fuentes, 25-09): vesícula de 7–10 × 3–4 cm y 30–50 mL; pared en ayunas < 3 mm,
una sola línea ecogénica fina (la pared doble o en capas es patológica: edema, hepatitis, insuficiencia cardíaca);
el cuello se curva y pliega (bolsa de Hartmann); la VHM corre por encima y por detrás de la vesícula en el plano de
Cantlie y solo tributarias de 2–3 mm llegan a rozar el lecho (Radiopaedia; Lucius 2025; Ball 2006; Zhang 2005).
**Opciones.** (1) Retocar el elipsoide (radios y afilamiento): sigue siendo un óvalo sin cuello. (2) Unión de
elipsoides: cuesta más uniforms y deja cinturas entre ellos. (3) La elegida: una cadena de conos redondeados sobre
una línea media curva, unida con mezcla suave.
**Decisión.** `organs/gallbladder.ts`: la luz es una cadena de cinco nodos (fondo 12 mm, cuerpo 14,5, infundíbulo 11,
bolsa de Hartmann 8, cuello 4,5) con `smoothMin` de 6 mm entre tramos (`gbSegment`, gemelo GLSL con el mismo orden de
operaciones; uniforms `uGbNodes[5]` y `uGbExtra` = mezcla y pared, las mismas 6 ranuras que antes). En GLSL, la cadena y
el hígado (`gallbladderSdf`, `liverSdf`) tienen una sobrecarga sin normal para los usos que no la necesitan (las
diferencias centrales de `faceGradient` y `liverInner`), y el elipsoide orientado de la decisión 41
(`sdOrientedEllipsoid`) desaparece. El fondo queda anteroinferolateral contra el peritoneo de la pared anterior (a 3,4 mm
en el adulto normal, 2,4 en la congestión grave y 0,4 en la FA con congestión moderada, de pared más gruesa), la bolsa
de Hartmann cuelga por debajo del infundíbulo y del cuello, y el cuello se dobla en «S» (> 40°) hacia el hilio; 35,5 mL
y ~8 cm. La pared pasa a 1,8 mm. La cápsula hepática que toca la pared de la vesícula en su fosa no dibuja su cara
(`GALLBLADDER_CONTACT_MM` = 1 mm, como Morison con la grasa perirrenal): la pared vesicular es una sola línea. La VHM
nace en el parénquima de IVb/V por encima de la fosa (a ≥ 5 mm de la pared con su calibre máximo) y el cístico sale de
la punta del cuello y baja hacia dentro hasta el colédoco. El navegador 3D dibuja la vesícula con la misma distancia.
**Consecuencias.** La vesícula se ve como una pera con el cuello plegado y una sola pared fina; en color no hay flujo
dentro. Falta la sombra de refracción de los bordes laterales del cuello y del fondo, que no está modelada. Un gancho
`setPose` de las pruebas permite capturar cualquier pose (la de la vesícula en eje largo sale de una búsqueda en CPU).
**Verificación.** `anatomy.test.ts`: la forma (fondo anteroinferolateral, cuello doblado > 40°, Hartmann colgante,
30–50 mL, 70–100 mm de largo, cuerpo ≤ 40 mm), la pared única (desde el cuerpo hacia la fosa la única cara especular
es la de la luz) y ningún vaso en la luz ni en la pared en los tres casos, con la VHM a ≥ 5 mm (antes 726 mm³ dentro);
la e2e de equivalencia TS↔GLSL (50 000 puntos); capturas con GPU (M4) antes y después en eje largo, en 2D y color.

## 68. Riñón con una sola línea capsular, pirámides tenues y distintas, seno digitado y pelvis colapsada

**Contexto.** El dueño (médico, 25-09-2026): «pésima representación ecográfica del riñón». La prueba ciega (ronda 2)
lo reconocía al instante: cápsula como doble línea paralela perfecta, pelvis negra recortada, seno ovalado homogéneo y
rayas oscuras verticales finas, rectas y equidistantes. En el modelo: la grasa perirrenal era una capa de 4 mm
constante cuyas dos caras (cápsula y cara externa) dibujaban dos líneas concéntricas en todo el contorno; la pelvis,
un elipsoide de 18 × 7 × 5 mm de orina; el seno, un elipsoide liso; las pirámides, 16 cuñas finas (se veían como rayas)
y las interlobares, tres pares rectos equidistantes que llegaban a 3 mm de la cápsula. Referencias (revisión con
fuentes, 25-09): cápsula = una sola interfaz especular, brillante de frente y perdida en los bordes; grasa perirrenal
de grosor variable, ≤ 1 mm contra el hígado en la mitad de los casos; pirámides hipoecoicas pero no negras, de tamaño
variable y a menudo tenues en el adulto, 6–8 por corte; seno ecogénico de bordes digitados e irregulares; sistema
colector colapsado; corteza de 7–8 mm; interlobares por las columnas de Bertin hasta la base de las pirámides
(Radiopaedia; PMC12731967; Emamian 1993; ACEP Sonoguide).
**Opciones.** (1) Quitar la cara externa de la grasa: Morison (grasa contra hígado) perdería su línea. (2) Grosor
variable con la cara externa solo donde la grasa es fina: una sola línea en todo el contorno y Morison conservado.
(3) Modelar la fascia de Gerota como capa aparte: más caras paralelas, el mismo defecto.
**Decisión.** Opción 2, más forma interna. `organs/kidney.ts` (gemelos TS/GLSL):
`perirenalThicknessMm` va de 1 mm (anterolateral, donde apoya el hígado) a 9 mm (detrás, hacia el hilio y en los
polos), en los dos riñones (el marco del izquierdo es especular: su w apunta hacia atrás). La cara externa se dibuja
donde la grasa mide ≤ 2,5 mm (`PERIRENAL.faceMaxMm`), fundida con la de la cápsula en una sola línea, y, aunque sea
gruesa, donde apoya el hígado (Morison: `liverSdf` a ≤ `MORISON_CONTACT_MM` de ella); donde es gruesa y no la toca el
hígado se confunde con la grasa retroperitoneal sin línea. La cápsula hepática le cede su cara en el contacto y, junto
a una grasa fina, también a ≤ `MORISON_SLIVER_MM` (3,5 mm, la lámina del borde de la impresión): una sola línea en
todo Morison. Esa cara tiene su propia geometría (`perirenalOuter`, el gradiente de `perirenalOuterSdf`), no la del
contorno renal. La impresión renal del hígado sigue a la cara externa de la grasa y la solapa 1 mm (la grasa, que se
clasifica antes, gana, y la distancia a la frontera del hígado la cuenta): menos láminas de «intestino» entre grasa e
hígado que antes (51–71 frente a 96–132 en el barrido de la cara). La banda difusa de la cápsula baja de 2,4 a 1,4 (la
línea la da su cara especular). Pirámides: 14 conos redondeados (papila de 1,5 mm a 3 mm del seno, base de 5,2–7,4 mm
de radio centrada a 7,5 mm de la cápsula, con orientación y tamaño algo distintos, dos compuestas en los polos;
`PYRAMIDS`); la unión corticomedular (`MEDULLA_MIN_DEPTH_MM`, 7 mm bajo la cápsula) corta el casquete de su base en una
base ancha que sigue al contorno: corteza ≥ 7 mm sobre toda pirámide; su eco pasa de 0,3 a 0,42 (−4,6 dB bajo la
corteza). Seno: elipsoide con el canal del hilio y un dedo (cáliz) hacia cada papila con mezcla suave
(`kidneySinusSdf`, que fuera del riñón no se evalúa): borde digitado. Pelvis colapsada: una lámina de 2,4 mm hacia el
hilio (antes 18 × 7 × 5). Interlobares: por columnas de Bertin a intervalos desiguales (u −27, −2,5, 23,5), con una
curva propia, hasta la unión corticomedular (19–21,5 mm del centro) y algo más finas.
**Consecuencias.** El riñón se ve con una sola línea capsular que se apaga en los bordes, un seno lobulado y ecogénico,
pirámides tenues y sin la barra negra de la pelvis, y Morison con una sola línea en todo el contacto. Una revisión
adversarial halló que la cara externa de la grasa gruesa, suprimida siempre, dejaba sin línea el 62 % del contacto
hígado–grasa (26 de 29 pasos en la vista renal); que el izquierdo tenía la grasa gruesa delante (8,2 mm) y fina detrás
(1,2); que el casquete de las pirámides llegaba a 3 mm de la cápsula (3,9 mm de corteza en la mediana), y que esta cara
usaba la normal del contorno (9° de error en el p90): corregidos. Morison no tiene hueco donde la grasa y el hígado se
tocan, pero en el borde de la impresión el redondeo del hígado deja una lámina de «intestino» de 1,2–1,35 mm de mediana
(hasta 3 mm) en el 29 % de los contactos del adulto normal (22–26 % en los congestivos): es el receso, y allí la línea
es la de la grasa fina o la de la cápsula, nunca las dos. Las pirámides pierden el casquete que ocupaba la corteza
externa: la mitad de su volumen o más (la médula pasa del 20 al 11 % del parénquima del corte coronal), con 7–10 mm de
alto y 10–15 mm de base en el plano coronal. Siguen pendientes la sombra de
refracción de los polos, los ecos arcuatos en la base de las pirámides, el psoas y el cuadrado lumbar detrás del riñón
(el «resto» tiene hoy la textura del intestino) y los lóbulos laterales que darían neblina en las luces vasculares
(`no-sidelobes`).
**Verificación.** `anatomy.test.ts`: pirámides de tamaños distintos, ≥ 5 separadas en el corte coronal, con ≥ 6,5 mm
de corteza en toda su superficie (rayos hasta la superficie de cada cono; antes solo el centro de la base) y médula
visible en cada una; pelvis ≤ 2,5 mm; el borde del seno sobresale > 2 mm del óvalo; grasa de menos de 1,5 mm
anterolateral y de más de 6 mm detrás y en los polos, fina delante y gruesa detrás también en el izquierdo; la mitad
externa de la grasa gruesa sin cara salvo contra el hígado y la fina con la cara de Morison; todo paso hígado ↔ grasa
con una cara y una sola (rayos desde el riñón y líneas de las vistas renal, de flanco y de Morison; antes 454 de 905,
26 de 29 y 26 de 38 sin cara, y el 11–14 % de los pasos de los rayos con la de la grasa y la de la cápsula a los dos lados
de una lámina); Morison sin hueco y, por el polo superior (grasa gruesa), con la cara de la grasa; `faceGradient.test.ts` (la cara de la grasa
gruesa sí la recorta la salida barata y su norma queda bajo la cota) y `faceNormals.test.ts` (fila `perirenalOuter`: la
GPU con el gradiente del contorno daba p01 0,965 en la ventana renal), también en la e2e de normales; equivalencia
TS↔GLSL (e2e); capturas con GPU (M4) de la vista renal antes y después.

## 69. VCI con curva sagital y embudo, por delante de la aorta; ramas viscerales de la aorta; hilio hepático reordenado

**Contexto.** El dueño (médico, 25-09-2026): «vena cava inferior demasiado recta; no está clara la relación con la
aorta». En el modelo, la VCI infrahepática era un único tramo recto de 320 mm (z −300…20) a 8 mm por delante de la
aorta, que solo se curvaba en sus últimos 40 mm; la aorta, un cilindro recto sin ramas. Una auditoría de choques entre
vasos halló además tres errores anatómicos: el tronco portal nacía DENTRO de la aorta (11,5 mm de solape en
(8, −22, −107)) y cruzaba la vena renal izquierda; la arteria hepática salía de la aorta 40 mm por debajo de las
arterias renales (el celíaco está en T12, por encima de ellas); el colédoco atravesaba la porta. Referencias (revisión con
fuentes, 25-09): la VCI dibuja una «S» sagital suave, más honda hacia caudal y con un embudo de 1–3 cm hacia la AD (28 ×
18 mm); en T11–T12 queda 10–25 mm por delante de la aorta y ~30 mm en la unión cavoatrial; en L1–L2, casi a la par y a
~31 mm lateral; la aorta se estrecha de ~22 a ~18 mm, apoyada en la cara anterior izquierda de las vértebras; el tronco
celíaco («gaviota») y la AMS ~1 cm más abajo salen de su cara anterior y la vena renal izquierda pasa entre la AMS y la
aorta; la porta nace detrás del cuello del páncreas y sube oblicua por delante de la VCI con el hiato de Winslow entre
ambas; el colédoco va a la derecha y por delante de la porta y la hepática propia a la izquierda (Li 2021; Joshi 2009;
Kot 2021; Radiopaedia; POCUS101).
**Opciones.** (1) Curvar solo la VCI: la porta, el colédoco y la hepática seguirían chocando. (2) La elegida: rehacer a la
vez la VCI, la confluencia de las suprahepáticas, la aorta con sus ramas, el tronco portal, el colédoco y la hepática,
con una auditoría de holguras entre tubos.
**Decisión.** `vesselTree.ts`: la VCI infrahepática pasa por siete nodos (lordosis por delante en L3, nivel renal,
infrahepático, retrohepático, confluencia) y sube hacia delante 19 mm desde el nivel renal hasta la AD; la
suprahepática gana un nodo y un embudo (radio 10 → 12,5 mm). La confluencia de las suprahepáticas (derecha y tronco
común media–izquierda) se lleva a la pared de la nueva VCI. La aorta se curva y se afila (11,5 → 9 mm de radio),
apoyada en la cara anterior izquierda del cuerpo vertebral sin hundirse en él. Vasos nuevos (`VESSEL_IDS`, sistema
`visceralArtery`): `celiacTrunk` (T12, de la cara anterior de la aorta a su bifurcación), `splenicArtery` y `sma` (12 mm
más abajo, por delante de la aorta; la vena renal izquierda pasa entre ambas, estrechada a 3 mm de radio en la pinza,
con 13,5 mm entre las luces), con caudales ilustrativos: 0,6 y 0,3 L/min con el pulso de baja resistencia el celíaco y
la esplénica; la AMS, 0,25 L/min con el suyo de ayunas, trifásico de alta resistencia (reflujo protodiastólico de
~0,1 s, IR 0,88). La hepática común sale del celíaco hacia la derecha y la propia sube por delante y a la izquierda de
la porta y cruza el hilio por delante de la confluencia de los hepáticos y por encima del cístico; el tronco portal
nace en la confluencia (−3, 6, −100) y pasa ≥ 10 mm por delante de la VCI; el colédoco va a la derecha y por delante
de la porta y sube medial al cuello de la vesícula, con el cístico hasta él. Punto
de partida nuevo, «Porta · lateral» (`portal`): la ventana preferida de la porta en VExUS, entre la axilar media y la
posterior y más caudal que la de las suprahepáticas, con la porta principal en el plano a < 60° del haz y la VCI detrás
(el plano del flanco, que va a la VCI, ya no corta el tronco portal); las pruebas de la cadena del alumno y del volumen de
muestra miden allí la porta principal (la que recomienda VExUS; con respiración tranquila se desliza por su eje).
**Consecuencias.** En la subxifoidea la VCI tiene el embudo y la confluencia de las hepáticas; en la transversa
epigástrica la VCI oval queda junto a la aorta redonda y del techo de la aorta sale el celíaco con la esplénica (la
«gaviota»); en la coronal del flanco, la VCI y la aorta corren paralelas («doble cañón»). La ventana «Porta · lateral» es
sobre todo «resto» (46 % del sector en el adulto normal; 41–43 % en los congestivos), hígado (22 %), grasa y músculo de
la pared (16 %), el riñón con su grasa (6 %), la VCI (2,3 %) y el tronco portal (1,7 %): la línea central cruza el
riñón, y la porta queda en un lado del sector. Una revisión adversarial halló que el colédoco entraba 1,4 mm en la
pared del cuello vesicular, que la vena renal izquierda tenía 3,45 mm de su luz dentro de la aorta (8 mm entre las luces
de la pinza, normal 10–28), que la aorta se hundía hasta 4,8 mm en la vértebra (el 9 % de su luz se clasificaba como
vértebra), que la hepática chocaba con el cístico y con el colédoco y que la AMS tenía el pulso de después de comer:
corregidos. Siguen tocándose en la porta hepatis, como en la realidad, el tronco portal con el colédoco (−0,5 mm entre
paredes) y con el cístico (−0,9), la rama izquierda de la porta con la hepática (−1,8) y el colédoco con los hepáticos
y el cístico que desembocan en él; la arteria renal derecha entra 1,2 mm en el cuerpo vertebral al cruzar la línea media. Con el cuerpo
vertebral del modelo (un cilindro de 34 mm sin cortical) la aorta queda a 33–38 mm de la VCI entre centros (la
referencia da ~31 en L1–L2). Pendiente: la pulsatilidad cardíaca de la VCI del sano (decisión aparte) y el cuerpo
vertebral sin cortical, cuya sombra es un rectángulo.
**Verificación.** `anatomy.test.ts`: la VCI sube hacia delante más de 15 mm entre el nivel renal y la AD sin saltos,
queda a más de 10 mm por delante de la aorta en el segmento retrohepático y a más de 20 mm cerca de la AD, a la par en
el nivel renal y a más de 25 mm lateral; embudo; celíaco por encima de la AMS y esta de las renales; la hepática nace
del celíaco; la porta a más de 10 mm por delante de la VCI y a más de 2 mm de la aorta, la VCI y la vena renal
izquierda; holguras ≥ 0 entre las paredes de la vena renal izquierda y la aorta, de la vena renal izquierda y la AMS,
del cístico y la hepática y de la hepática y el colédoco; 10–28 mm entre las luces de la pinza aortomesentérica, con
la vena más estrecha allí que en el hilio; la aorta fuera de la vértebra (con su pared); solo el cístico toca la
vesícula (cada conducto por separado); `physiology.test.ts`: la AMS trifásica de ayunas (IR 0,85–0,92, reflujo breve)
y el celíaco de baja resistencia; `cases.test.ts` (tipo de los vasos nuevos); equivalencia TS↔GLSL (e2e); capturas con
GPU (M4) antes y después en la subxifoidea, el flanco, la congestión grave y una transversa epigástrica.

## 70. Doppler color sin bloques: estimación continua, grano correlado a la celda de resolución y barra de escala

**Contexto.** El dueño (médico, 25-09-2026): «color doppler de mala calidad en vasos». En las capturas el color de las
suprahepáticas y la VCI eran bloques de color uniforme con escalones que seguían la rejilla (θ, r); la prueba ciega
(ronda 2) lo señalaba como rasgo sintético. Causa: la pasada F estimaba un valor por celda (una línea de color × un
paquete axial de 1 mm) con `floor(vUv·uCells)` y el mismo ruido para toda la celda: bloques de 3–4 × 2–3 téxeles con
valor idéntico que la interpolación bilineal solo difuminaba en su borde. Referencias (revisión con fuentes, 25-09):
en un equipo el color no muestra celdas; el relleno es moteado con manchas de 1,5–4 mm (el tamaño de la celda de
resolución) que cambian en cada cuadro de color, con huecos ocasionales, y el ruido nunca es independiente por píxel de
pantalla (Evans, Jensen y Nielsen 2011; patentes de BK, GE y Acuson sobre suavizado y persistencia); todos los equipos
muestran la barra de escala con ±Nyquist.
**Opciones.** (1) Suavizar la textura de celdas (mediana o bilineal más ancha): borra el mosaico pero deja el relleno
uniforme. (2) Simular la IQ por paquete en cada celda: más fiel, pero cuesta ~12 muestras de tiempo lento por celda y
cuadro. (3) La elegida: estimación continua por téxel con el mismo modelo de potencias y fases, y los términos
aleatorios (ruido del estimador, moteado de la sangre, fase de Kasai) como campos gaussianos correlados a la celda de
resolución.
**Decisión.** `FRAG_COLOR`: la posición de cada téxel es la suya (no el centro de su celda); `colorGauss` da normales en
los nodos de la retícula de resolución (una línea de color × un paquete axial, `uCells`) interpoladas con suavizado y
renormalizadas a varianza 1, con semilla por cuadro de color; la potencia de la sangre se multiplica por un moteado
exponencial de media 1 (dispersores de Rayleigh), así que el relleno queda moteado y con huecos donde el moteado cae
bajo el umbral; el ruido complejo del estimador y el de la fase de Kasai salen de campos del mismo tipo. La calibración
de potencias no cambia (moteado y ruido de media y varianza iguales). `drawOverlay` dibuja la barra del mapa con
±Nyquist en cm/s junto a la caja (`colorMapRgb`, el mismo mapa que la conversión de barrido).
**Consecuencias.** El color de un vaso se ve moteado, con el centro más claro por el perfil de velocidades, bordes
irregulares y un grano que cambia en cada cuadro, sin mosaico de celdas. Pendientes: persistencia propia del color
(hoy la da la persistencia de la imagen compuesta), destello por movimiento del tejido y mapa de varianza.
**Verificación.** e2e «color realista»: sobre las suprahepáticas del flanco, < 5 % de pares de téxeles vecinos con
color idénticos (antes, la mayoría), correlación de la potencia a 1 téxel > 0,5 y menor a 4 téxeles; las e2e de color
existentes (transmisión igual al PW, ruido a 0 y +24 dB, tríplex, sin contacto) sin cambiar sus umbrales.

## 71. Pleura y líneas A en todo el hemitórax derecho, también bajo la pared anterior

**Contexto.** El dueño (médico, 25-09-2026): «líneas A solo por lateral a nivel del tórax, no por anterior». La
pleura parietal de la decisión 61 (línea pleural, serie de reverberaciones de la pared, líneas A y deslizamiento) solo se
registraba en la huella de la lámina de la cortina (x ≤ −45, y ≤ 40: el receso lateral y posterior). Con la sonda en un
espacio intercostal anterior derecho, el pulmón del tórax que toca la pared por encima de la inserción del diafragma
quedaba fuera de la huella y la pasada A lo trataba como el espejo del diafragma (decisión 57): sin línea pleural, sin
líneas A, con el eco débil de la cúpula. Referencia (revisión con fuentes, 25-09): bajo toda la pared anterior derecha
hay pulmón aireado hasta el 6.º cartílago; en las ventanas intercostales anteriores y laterales se ven la línea pleural,
el deslizamiento y las líneas A (Dartmouth Human Anatomy; Lee 2017; POCUS101).
**Opciones.** (1) Extender la huella de la lámina a todo el hemitórax: la lámina que baja sobre el hígado taparía en
inspiración profunda toda la ventana del 8.º espacio (la prueba del hígado despejado se quedaba sin muestras) y bajaría
en horizontal por delante, donde el borde pulmonar real está más alto. (2) La elegida: dos huellas.
**Decisión.** `LUNG_CURTAIN.pleuraXMax` = 10 mm (hasta la línea media): `inLungRecess` (dónde empieza la pleura parietal
en A0) y `lungCurtainEdgeMm` (el borde del pulmón que toca la pared) usan todo el hemitórax derecho, delante, al lado y
detrás; fuera de la huella de la lámina el borde del pulmón es la inserción del diafragma. La lámina (`xMax`, `yMax`)
sigue solo en el receso lateral y posterior. Gemelos TS y GLSL.
**Consecuencias.** Con la sonda en un espacio intercostal anterior derecho por encima de la inserción del diafragma se ven
la línea pleural, las líneas A y el deslizamiento, como en el lateral. Por delante, la lámina no baja sobre el hígado con
la inspiración (el receso anterior queda para el ajuste del borde pulmonar por altura, pendiente); el lado izquierdo
(escotadura cardíaca) sigue sin pleura parietal.
**Verificación.** `pleura.test.ts`: desde cuatro poses intercostales anteriores derechas, todas las líneas cuyo primer
tejido tras la pared es pulmón registran la pleura de tipo 3 (antes, ninguna); la huella de la pleura llega a la pared
anterior y no al lado izquierdo; fuera de la lámina el borde es la inserción del diafragma. `organs.test.ts`: la lámina
conserva su huella. e2e de la pleura y de la cortina (decisión 61) sin cambiar umbrales.

## 72. Hígado con el borde inferior agudo apoyado en la pared, cara visceral cóncava y el tamaño de la revisión

**Contexto.** El dueño (médico, 25-09-2026): «hay que seguir mejorando la fidelidad a todo nivel: hígado 3D, bordes,
tamaño, textura». La revisión de anatomía normal (`docs/anatomia/revision-normal.md`, § 2 y tabla de brechas) medía un
craneocaudal de 12,3–12,6 cm en la medioclavicular (normal 14,0 ± 1,7), el borde izquierdo obtuso (107–161°, normal
30–45°; el derecho, 45–70°) y el caudado sin forma propia. Medido en cortes sagitales (ángulo entre la punta y el tramo
conexo 12 mm por encima), todo el borde inferior del sano daba 98–141°. Causa: el hígado era la unión suave de dos
elipsoides cortada por un plano casi horizontal (pendiente 0,2 en y) con 12 mm de redondeo; bajo el ecuador de los
elipsoides su cara anterior se curvaba hacia atrás (se separaba 5–29 mm de la pared, con «intestino» entre ambos en el
epigastrio) y el plano cortaba esa curva en ángulo obtuso. Además, el lóbulo derecho envolvía el tronco celíaco y la
esplénica (100 % y 36 % de su línea central dentro del hígado).
**Opciones.** (1) Más pendiente en el plano: agudiza la punta, pero la cara sube 30–50 mm por detrás y el hígado deja de
cubrir el riñón. (2) Un plano de pendiente fija desde la pared unido al de siempre: un solo ángulo para todo el borde y
el flanco romo. (3) Un borde que depende del ángulo del tronco: los puntos por detrás de la pared anterior tomaban la
altura del borde del flanco (su proyección radial) y la falda invadía el interior. (4) Hacer del segmento lateral
izquierdo una cuña entera hasta la cúpula: queda de 11 mm de grueso a la altura de la porta umbilical (debe tener
40–60). (5) La elegida: una cara cóncava de tres términos sobre una envolvente que llega a la pared.
**Decisión.** La cara visceral es una superficie z = z_v(x, y), mínimo suave (6 y 8 mm) de tres términos:

- la cara interior, una cuádrica ajustada a la anatomía: −59 sobre el riñón derecho, −54 en el hilio, −66 sobre la
  vesícula, −48 a −44 en el lóbulo izquierdo junto a la línea media, y subiendo hacia atrás y a la izquierda en el
  segmento lateral (−41 a −28);
- la falda anterior: baja hasta el borde inferior en la cara interna de la pared anterior (cúbica en x: −101 en el
  ángulo anterolateral, −84 en la medioclavicular derecha, −62 en el epigastrio, −49 y −38 hacia el reborde izquierdo) y
  sube hacia dentro con la cotangente del ángulo del borde por la profundidad bajo la pared (0,75 en el lóbulo derecho,
  1,6 en el izquierdo, con una transición suave entre x −60 y 10);
- la falda lateral: baja en el flanco hasta −112 (junto al polo inferior del riñón, como en la vista de Morison) con
  cotangente 0,75, y sube deprisa por delante y por detrás del flanco.

Los lóbulos pasan a ser la envolvente, más alta y más adelantada (derecho: centro (−70, −8, −42), 184 × 216 × 290 mm;
izquierdo: (5, 42, −20), 200 × 90 × 170 mm; unión suave de 15 mm, antes 30): la pared recorta la cara anterior y lateral
hasta el borde y la cúpula la superior. Un recorte posteromedial deja fuera del hígado el pilar derecho, la aorta, el
tronco celíaco y la esplénica: la región a la izquierda de x −10, del plano que se abre hacia el lóbulo izquierdo por
delante y por detrás de y 10. La hepatomegalia congestiva baja la cara interior 3 mm y el borde 2,2 mm por cada 1 % de
tamaño, reduce las pendientes y aumenta el redondeo: la cara interior baja más que el borde, la falda se acorta y el
borde se redondea. La suprahepática izquierda, su tributaria y la rama del segmento III de la porta pasan a la cuña del
segmento lateral. Gemelos TS y GLSL; el gradiente de z_v es analítico, así que la normal de la cara visceral es la
exacta y no la del plano dominante.
**Consecuencias.**

- Sano: ángulo del borde de 49–57° en el lóbulo derecho y 34–37° junto a la línea media (antes 98–141°), 51–54° en el
  borde lateral del flanco (corte coronal). El hígado apoya en la pared hasta la punta (≤ 1,5 mm) y el epigastrio ya no
  tiene intestino entre la pared y el lóbulo izquierdo.
- Tamaño: 157 mm de la cúpula a la punta en la medioclavicular en el sano (referencia 14,0 ± 1,7 cm) y 161–181 en la
  congestión grave; lóbulo izquierdo sobre la aorta de 95 × 69 mm (referencia 8,3 ± 1,7 × 5,7 ± 1,5 cm).
- Congestión grave: bordes romos (78–88° en el lóbulo derecho y la línea media).
- Vasos: el tronco celíaco, la esplénica y la aorta quedan fuera del hígado (antes 100 %, 36 % y 14 %). Las
  suprahepáticas y las ramas izquierdas de la porta quedan dentro (≥ 95 %).
- La cápsula subxifoidea ya no cambia de dueño bajo la pared: el mayor salto de incidencia entre líneas vecinas pasa de
  29,8° a 0,36°, así que una de las pruebas de la decisión 60 pasa en esa vista.
- Morison (decisión 68): el redondeo del borde de la impresión renal con la cara nueva deja láminas de «intestino» de
  hasta ~0,6 mm contra la grasa gruesa; `MORISON_CONTACT_MM` pasa de 0,2 a 0,8 mm (una sola línea también ahí). Quedan
  dos pasos con doble línea en los rayos desde el riñón, detrás del polo superior (`morison-rim-sliver`), ninguno en
  las vistas.
- El 3D del navegador, que usa una malla del mismo SDF, muestra la forma: la cara diafragmática contra la pared, el borde
  inferior oblicuo del flanco derecho al lóbulo izquierdo y el segmento lateral que se afila.
- Pendiente:
  - la textura del parénquima (moteado y tríadas portales);
  - el caudado como lóbulo propio;
  - el segmento lateral lejos de la línea media da 44–49° (en el límite), porque su punta apoya en la envolvente y no en
    la pared;
  - la hepática y el colédoco del hilio siguen dentro del parénquima (no hay grasa hiliar propia).
    **Verificación.**
- `liverShape.test.ts` (nuevo):
  - ángulos del borde en el sano (40–70° el derecho, ≤ 45° junto a la línea media, ≤ 70° el lateral) y en la congestión
    grave (≥ 75°);
  - craneocaudal de 140–165 mm en el sano y ≥ 10 % más en la grave;
  - lóbulo izquierdo sobre la aorta;
  - vasos dentro y fuera del hígado;
  - gradiente analítico frente a diferencias finitas en los tres casos.
- `anatomy.test.ts` y `couinaud.test.ts`: los puntos de la fisura umbilical, de la rama del segmento III y de los
  segmentos II y III, movidos a la nueva forma.
- `fidelityScene.test.ts`: la prueba de la decisión 60 en la subxifoidea pasa de `it.fails` a normal (126 pares, 0,36°).
- `liverContour.test.ts`: la arista pared|unión de los lóbulos de la subxifoidea ya no existe.
- e2e de equivalencia TS↔GLSL y de normales.

## 73. Pared viscoelástica de la VCI: el latido la mueve la mitad y la respiración igual

**Contexto.** El dueño (25-09-2026): «vena cava además demasiado pulsátil». El diámetro AP de la VCI salía del volumen
de su compartimento por la ley de tubo elástica, sin retraso: con cada latido las ondas de la aurícula movían la pared
2,9 mm (16 %) en el sano con respiración tranquila, 2,4 mm (12 %) en apnea, 3,5 mm (11 %) en la congestión grave y
1,8 mm (6 %) en la moderada, que en la imagen se ve como una VCI que late. La pared venosa real es viscoelástica y el
latido la mueve poco (~1 mm; en la plétora apenas); la respiración, que es 5–6 veces más lenta, la mueve entera. Un
intento anterior (resistencia e inercia en el tramo de la VCI) cambiaba la media del diámetro y los caudales, y con ellos
los grados de la verdad y de la cadena.
**Decisión.** La pared de la VCI es un elemento de Voigt de primer orden: el área de la luz que marca la pared sigue al
área del volumen de la red con τ = 0,2 s (`IVC_WALL_TAU_S`). Es la que se ve y se mide: diámetros AP, lateral y
equivalente, aplanamiento (con la presión transmural de ese diámetro), escala del tubo en la GPU y velocidad de la VCI
(caudal entre esa área). La red sigue usando su volumen elástico para las presiones y los caudales.
**Consecuencias.** Latido de la pared en respiración tranquila: 1,2 mm (7 %) en el sano, 1,4 mm (5 %) en la congestión
grave y 0,6 mm (2 %) en la moderada. La respiración no cambia: 24 %, 3 % y 7 %, con la misma media (17,74 frente a
17,68 mm en el sano). Pared y volumen se separan hasta un 14 % del diámetro en los colapsos rápidos del sano (5 % en la
congestión grave): `ivc-wall-lag-not-in-network`. Los grados y la cadena del alumno no cambian. El primer contraejemplo
de `prescribed-ra-contour` (hipovolemia con PAD ≈ 0: la VCI superaba 2 m/s) ya no la supera, porque la luz no se cierra
dentro de un latido; el segundo sigue ahí. El banco de fidelidad deja fuera las líneas en las que el pulmón tras la
pleura es más fino que el paso de la marcha de A0 (`lung-sliver-caval-hiatus`: entre el diafragma y la VCI
supradiafragmática queda a veces una lámina de 0,3 mm y la GPU pone el espejo 25 mm más hondo; es la costura aislada que
admite la e2e).
**Verificación.** `physiology.test.ts`: latido ≤ 1,5 mm en el sano y en la grave, colapsabilidad respiratoria > 20 % en
el sano y < 6 % en la grave, y media de la pared igual a la del volumen (< 0,2 mm). `properties.test.ts`: el primer
contraejemplo pasa a prueba normal. `fidelityScene.test.ts` con la guarda nueva del banco.

## 74. El resto del abdomen deja de parecer hígado: asas con su firma y grasa mesentérica

**Contexto.** El dueño (25-09-2026): «pésima representación ecográfica del riñón». Parte del problema no era el riñón:
todo lo que la anatomía no modela como órgano (asas intestinales, mesenterio y epiplón, grasa retroperitoneal) es un
solo tejido, el «resto», con retrodispersión 0,9 y el moteado del parénquima, así que en la ventana renal el riñón
aparecía rodeado de algo igual al hígado. Lo mismo pasaba en la ventana de la porta (≈ 46 % de «resto») y bajo la VCI del
flanco. En la ecografía real, alrededor del riñón y del hilio se ven asas con la firma intestinal (capas de la pared
de 2–4 mm, contenido líquido o con gas) y grasa mesentérica y retroperitoneal hiperecoica y granulosa.
**Decisión.** Un factor de la amplitud de retrodispersión del intestino, anclado al material (`restTexture`, gemelo
GLSL en la pasada B y en el gemelo de la pared): el nivel de un ruido de valor suave de dos octavas (celda de 16 mm)
separa las asas de la grasa; hacia dentro del borde, con la distancia aproximada t = (n − umbral)·celda, van la serosa
brillante (0,6 mm, 1,8), la muscular hipoecoica (2,2 mm, 0,38), la mucosa brillante (0,6 mm, 2,2) y la luz, con
contenido líquido (0,12) o mixto con gas (2,0) según un segundo ruido de 5 mm; entre las asas, grasa mesentérica a
1,35. El tejido pasa a retrodispersión 1 (el nivel lo da la textura) y a moteado con grumos (0,5).
**Consecuencias.** Alrededor del riñón, bajo el hígado en la ventana de la porta y en el flanco se ven asas en anillo y
en banda con su pared en capas y grasa más brillante y granulosa que el hígado: el hígado y el riñón se distinguen de
lo que los rodea. Sin la sombra ni la reverberación del gas (la transmisión no cambia) y sin psoas ni cuadrado lumbar
propios (`bowel-gas-no-shadow`, `no-psoas`). Las pruebas del banco de fidelidad y de los gemelos no cambian.
**Verificación.** `restTexture.test.ts`: la grasa es la moda y más brillante que el hígado, hay muscular, mucosa o
serosa y contenido líquido, los niveles están acotados, la textura está anclada (misma semilla, mismo valor) y el
shader toma las constantes del módulo. Capturas con GPU real de las ventanas renal, del flanco y de la porta.

## 75. Interfaz limpia: ventanas VExUS como tarjetas, la imagen manda y consola con divulgación progresiva

**Contexto.** El dueño (médico, 25-09-2026): «mejorar la interfaz visual para que sea más simple, más limpia, más
esquemática e intuitiva». En capturas a 1600 × 1000 el rótulo del navegador 3D quedaba tapado por sus botones; la ayuda de
gestos era un bloque fijo; 3D y corte se repartían el carril al 50 %; la pestaña Adquirir mezclaba puntos de partida,
cuatro deslizadores de sonda, tres de imagen y la respiración con tres bloques de ayuda, e «Imagen» repetía
profundidad, ganancia y foco; el espectro reservaba ~200 px aunque el PW estuviera apagado, y los modos eran botones
sueltos aunque el tríplex (decisión 66) enciende dos a la vez.
**Opciones.** (1) Solo estilo (colores y espaciado): no resolvía la mezcla de la consola ni el espacio perdido. (2) Un
framework de componentes: dependencia y bundle nuevos para una interfaz pequeña. (3) La elegida: ordenar la interfaz por
el flujo del examen (ventana → imagen → Doppler → medida) con divulgación progresiva, en el DOM y sin dependencias.
**Decisión.** Carril izquierdo: las ventanas VExUS (los puntos de partida de la decisión 17) como tarjetas arriba, con el
color y el nombre de su anillo del 3D y una línea con las estructuras que muestran (el texto largo, en el tooltip); se
resalta la ventana actual (`src/ui/startPointCards.ts`: la elegida mientras la sonda se desliza y después aquella cuyo
punto de partida está a ≤ 20 mm de la sonda sobre la piel). «Sonda y abdomen» lleva el rótulo y los iconos (+, −,
centrar, capas, «?») en su propia fila; la chuleta de gestos y teclado está detrás de «?»; el corte ocupa ~40 % y se
pliega (`src/ui/disclosure.ts`). Centro: el espectro solo ocupa su franja con PW (clase `pw-on`) y el ECG es una franja de
40 px; el eje de tiempo compartido sale del ECG. Consola: «Imagen» se funde en «Adquirir» (imagen, sonda, respiración y
«Avanzado» plegado con rango dinámico, persistencia, composición espacial y TGC); en Doppler, línea de base, corrección
angular y volumen en «Avanzado» plegado; secciones plegables (encabezado con su botón, `aria-expanded`) y un ⓘ por
sección (`role="tooltip"` y `aria-describedby`, se puede sobrevolar y Esc lo descarta) en lugar de bloques de texto; `tabAfterMode` hace que botones y teclado lleven la consola a
«Doppler» y de vuelta a «Adquirir». Barra inferior: [2D | Color | PW] segmentado (el tríplex, dos segmentos
encendidos) y Congelar, Audio y Torso 3D como botones secundarios con icono y `aria-pressed`. Estilo: tokens en
`:root`, rejilla de 8 px, texto de 12/13/14 px, un acento para lo activo, iconos SVG de trazo en línea y foco visible.
El texto no baja de 12 px y el gris secundario cumple 4,5:1. Enmienda la disposición de la decisión 16 y el lugar de
los puntos de partida de la 17.
**Consecuencias.** Sin PW la imagen gana ~160 px de alto a 1600 × 1000 (871 frente a 712); cada mando existe una sola vez
y el alumno ve las ventanas y su anillo en el 3D sin abrir pestañas. Al ocultar el carril (H) las tarjetas se ocultan con
él. Con el lienzo del 3D más alto que ancho (corte plegado) el navegador abre su campo vertical para no recortar el
tronco. El chunk principal crece 3,4 kB (con el GLSL minificado de main queda en 304,7 de 320 kB y el JS total en 985,9 de 1000 kB: los presupuestos no cambian). A 1280 × 720 (la
e2e) el lienzo de la imagen pasa de 700 × 434 a 712 × 591 px sin PW; con GPU real las métricas de las e2e que leen la
imagen mostrada no cambian (gris del hígado 96 → 96, DE 15,36 → 15,36; compuesto por bandas 11,8 → 11,4–11,7). Pendiente: recordar
entre sesiones qué secciones están plegadas.
**Verificación.** `styles.test.ts` (rejilla de tres columnas y carril oculto sin `display:none`), `startPointCards.test.ts`
(cada punto de partida es la ventana actual en su pose y el radio es menor que la distancia entre las dos ventanas más
próximas, 24 mm), `controllers.test.ts` (textos del HUD sin cambios) y la e2e de humo sin tocarla (ids, pestañas
«Medir» y «Docente», «Suprahepática», «Capturar», «Apnea esp…» y modo alumno ciego); capturas antes y después a
1600 × 1000 y 1280 × 800.

## 76. Ecos parásitos del modo fundamental: lóbulos laterales con la aberración de la pared y reverberación de sus caras

**Contexto.** El dueño aprobó (26-09-2026) el plan de fidelidad cuyo primer punto es lo que el juez ciego de la ronda
2 señalaba como delator: entre otras cosas, «luces sin ruido» (vasos y vesícula negros puros). La PSF lateral era solo
el lóbulo principal gaussiano (`no-sidelobes`) y la pared no reverberaba: en un ecógrafo real el modo fundamental ensucia
las luces con la neblina de los lóbulos laterales, que la aberración de fase de la grasa y el músculo sube por encima del
ideal de la apertura, y con la reverberación de las caras brillantes de la pared entre ellas y la sonda (el artefacto
clásico de la parte anterior de la vesícula, que puede imitar barro).
**Opciones.** (1) Un suelo de ruido más alto: es uniforme y no depende de lo que rodea a la luz. (2) Un pedestal
gaussiano positivo en el núcleo lateral: suma de forma coherente sobre un reflector continuo y sube ~1 dB los ecos
especulares calibrados (β, las cocientes de cápsula, Morison y pared). (3) Una pantalla de fase aleatoria cualquiera:
su paseo aleatorio es un sesgo fijo que depende de la anchura del haz (de −2,4 % a +3,5 % en un reflector continuo; β del
gemelo −0,2 dB). (4) Réplicas del campo entero bajo la pared: copian el moteado y las estrías del músculo dentro de la
vesícula. (5) Las elegidas.
**Decisión.** (a) Lóbulos laterales: el núcleo de la pasada D suma al lóbulo principal real un pedestal de σ 7 veces la
del principal con una pantalla de fase fija ANTISIMÉTRICA (la aberración: `SIDELOBE_PHASES`, φ(−k) = φ(k) + π, φ(0) =
π/2, generador congruencial, la misma tabla en TS y GLSL): sobre un reflector continuo los pares ±k se cancelan y el
término central queda en cuadratura, así que el eco especular no cambia (≤ 0,5 % para σ de 0,35 a 3 líneas), mientras
su energía lleva a las luces el moteado de lo que las rodea. La amplitud sale de las sumas discretas del núcleo
(a² = ISLR·c²·Σg_m²/Σg_p²), así que la energía del pedestal es ISLR −24 dB exacta a cualquier anchura (la fórmula
continua se quedaba 2 dB corta con σ 0,35); c es el acoplamiento de la línea de destino: una línea sin contacto no lo
recibe. (b) Reverberación: la pasada C suma al campo dos réplicas del propio campo tomadas W (el grosor de la pared) y 2W
filas enteras más arriba, que aparecen más hondas, a −50 y −62 dB sobre su fuente. Solo reverbera la pared: la fuente
está a lo sumo a W + 3 mm (su cara interna) y pasa un umbral suave sobre el módulo del campo en bruto (1,5–3,5), que en
la práctica solo abren la piel, las fascias, el peritoneo y las costillas (5 puntos de partida × 2 casos: la fuente más
honda a 30–44 mm). Cada orden paga su viaje extra por la pared: la transmisión de ida y vuelta de la línea hasta W,
una vez por orden (textura de A de la mirada del cuadro). Tras una costilla o un gas es ~0 y no hay réplica en la
sombra, y con la TGC nominal, que compensa el camino extra, en pantalla quedan a −50 y −62 dB de su fuente. (c) Los dos
crecen con la grasa subcutánea (+0,35 dB por mm sobre 14 mm) y la armónica tisular (decisión 77) los baja 12 dB; en las
réplicas, por orden (la segunda, dos rebotes, paga el doble de las dos cosas). Módulo `ultrasound/clutter.ts`
(parámetros, núcleo complejo, ganancias de las réplicas y compuerta), usado por los gemelos de CPU (`wallTwin`,
`interfaceTwin`, la prueba del receptor) y reflejado en `FRAG_AXIAL`/`FRAG_LATERAL`.
**Consecuencias.** Las luces de los vasos del hígado y de la VCI llevan una neblina tenue junto a sus bordes; la parte
anterior de la vesícula, réplicas débiles de la pared. En el tejido bajo la pared las réplicas quedan a −50/−57 dB rms
(gemelo, con transmisión) y el pedestal no cambia el nivel incoherente. Una línea sin contacto sigue oscura y las
sombras costales no se encienden. Bajo la pleura de la cortina las réplicas suman unos −40 dB a la serie de
reverberaciones de la pared (decisión 61), que ya copia la pared: doble cuenta despreciable (`APPROXIMATIONS.md`).
Coste: la pasada D recorre 25–57 líneas donde el pedestal lo pide (antes 5–9); ~0,2–0,3 ms por cuadro en el M4, medido
con la máquina cargada. Limitaciones: `no-sidelobes` pasa a «sin lóbulos de rejilla ni en elevación»; la reverberación es
de primer y segundo orden, de la pared entera y no de cada cara por su profundidad (el múltiplo costilla–sonda, a 2z, no
se dibuja).
**Verificación.**

- **`clutter.test.ts`:**
  - la pantalla de fase antisimétrica;
  - el núcleo de energía unidad, que sin pedestal o sin contacto es la gaussiana de siempre;
  - la energía del pedestal igual a ISLR·c² en el núcleo discreto (σ 0,35–3, c 1 y 0,5);
  - un reflector continuo cambia ≤ 0,5 %, y una luz junto a un moteado brillante recibe 0,3–1 veces la ISLR (≥ 10
    veces lo que deja la gaussiana sola);
  - la grasa y la armónica por orden;
  - las réplicas pagan la transmisión de la pared por orden y respetan la compuerta;
  - las mismas fórmulas, constantes y tabla (7 decimales) en las pasadas C y D.
- **Gemelo `wallTwin`:** ahora calcula B también por encima del parche, de donde salen las fuentes (antes las perdía
  en silencio). La comparación entre modelos de pared vuelve a ser bit a bit, sin réplicas. Una prueba nueva, con
  transmisión y réplicas en la subxifoidea y en el flanco de partida, exige que el hígado bajo la pared cambie ≤ −45 dB
  rms y que la sombra costal quede < 3 % de la media del hígado. Sin la transmisión de la pared da −43 dB y el eco de la
  costilla se copiaba en su sombra, a 10–40 % de la media: lo halló la revisión adversarial.
- **`interfaceTwin`:** M3 de la porta a 40° pasa de 1,404 a 1,397 (umbral 1,39): el pedestal reparte −24 dB de la
  energía de la vaina en las líneas vecinas. Sin pedestal vuelve a 1,40, y la ganancia coherente no cambia.
- **GPU (M4):** capturas de la subxifoidea, la intercostal, la vesícula, el flanco y la renal frente a `main`.

## 77. Armónica tisular: el modo B de un equipo moderno, con su haz, su acumulación y su ruido

**Contexto.** Las referencias reales del banco y del juez ciego son de equipos modernos con armónica tisular (THI) y
composición espacial (la desviación del gris del hígado, 10–16, está medida en ellas), pero el simulador solo formaba la
imagen en fundamental (`no-harmonics`), sin el conmutador que un alumno encuentra en cualquier consola. La decisión 76
dejó preparada la bajada de los ecos parásitos con la armónica. Sustituye a la 59, reservada para la armónica en el plan
de la composición.
**Opciones.**

- (1) Una armónica como filtro de «imagen limpia» (menos ruido y menos neblina): no es física, y en un equipo la
  armónica tiene menos penetración, no más.
- (2) El diseño del plan (la 59): 2,0/4,0 MHz, acumulación ∫D con el foco en una tabla, penumbra armónica por apertura y
  atenuación exacta por tejido con una salida más en A1 y dos prefijos en A2. Mucho coste en la cadena A para diferencias
  de menos de 1 dB a 1,75/3,5 MHz.
- (3) La elegida: los efectos que cambian lo que se ve, todos por uniforms de los programas de siempre.

**Decisión.** Emisión a 1,75 MHz e imagen con el armónico de 3,5 MHz (`ultrasound/harmonic.ts`).

- (a) **Haz.** La fuente armónica va como p1²: la emisión a λ1 = 2λ se estrecha ÷√2 en difracción y en desenfoque, y la
  recepción es a la frecuencia nominal de la sonda (`BeamParams.lambdaTxMm` y `txScale`, uniform `uBeamTx` de
  `LATERAL_PSF_GLSL`; `bmodeBeam`, derivado del perfil).
  - En elevación, lo mismo con la cintura y el rango de Rayleigh de la lente ×2: la σ equivalente de una vía es √2 × la
    de dos vías del par (`uElevHarmonic`, gemelo `elevSigmaMm(r, F, true)`; sin `pow` de base negativa).
  - El lóbulo principal lateral queda ~15 % más ancho en el foco a 90 mm (+25–36 % con el foco a 20–40 mm) e igual o más
    estrecho fuera. La rodaja es 2–7 % más gruesa entre 24 y 136 mm. Lo que gana la armónica son los lóbulos laterales.
  - Se supone la misma apertura de emisión efectiva de 26 mm a f1; la directividad de los elementos la ensancharía algo.
- (b) **Ecos parásitos** de la decisión 76: el pedestal y la primera réplica bajan 12 dB; la segunda, 24 dB (por orden).
- (c) **Transitorio** del transductor: es de banda fundamental y baja 20 dB (`uTransientGain`).
- (d) **Acumulación:** el armónico crece como 1 − e^(−r/2 mm) y el preajuste lo compensa desde 4 mm (`uHarmonicNear`).
  - Se aplica al eco del tejido en la pasada B, por el camino recorrido y antes de sumar el transitorio y el ruido, que
    no son armónicos: solo la piel queda más oscura (~−7 dB a 1 mm, ~−3 dB a 2 mm).
  - Con 1 − e^(−r/8 mm) compensada desde 10 mm y aplicada en D (la primera versión), las líneas de la pared de la
    decisión 62 bajaban hasta 6 dB en el gemelo (subxifoidea, nivel de línea +8,0 → +2,2 dB; revisión adversarial).
    Con 2/4 mm quedan como en fundamental: +4,7 → cuenta una fascia tenue más que la armónica destapa en una grasa más
    oscura; las demás líneas no bajan.
- (e) **Ruido** del receptor: sube 3 dB respecto al eco [ESTIMADO].
  - Las referencias con THI acotan la subida por arriba: con +6 dB la VCI subxifoidea daba una mediana de 10 de gris,
    fuera de su rango (0,6–9,6); con +3 dB, 7; con 0 dB, 4, como el fundamental.
  - El centro de la luz no mejora con la armónica, porque lo domina el ruido y no la neblina: lo que limpia la armónica
    es la neblina junto a las paredes y el campo cercano.
- (f) **Atenuación:** la ida paga 2·α(f1) y la vuelta α(2·f1). Con el desplazamiento a bajas de `bEffectiveMHz`,
  2·α(1,25) + α(2,5) ≈ 2·α(2,5): igual con α lineal en f (b = 1), 0,97–0,98 veces en la pared (b 1,05–1,1), ~0,2 dB
  menos en sus 28 mm. `bEffectiveMHz` no cambia.
- (g) **Doppler:** el color y el PW siguen en fundamental.

La aplicación arranca en armónica, como un preajuste abdominal moderno; la e2e sigue en fundamental (la física calibrada
de sus pruebas, `DEFAULT_BMODE.harmonic = false`) y prueba la armónica aparte. El banco y el juez ciego miden en armónica
salvo `--harmonic false`: la ronda 3 del juez hace de punto de control, en lugar del punto A del plan. En la consola va en
Avanzado («Armónica (THI)»); el HUD dice «THI 3,5 MHz». Cambiar de modo reinicia el anillo de miradas del compuesto.
**Consecuencias.** Banco con GPU (M4, composición encendida), de fundamental a armónica:

- el hígado no cambia: media y desviación 96,4/11,6 → 96,6/11,6 en la subxifoidea;
- el centro de la luz pasa de 4 a 7 de gris en la subxifoidea y de 5 a 7 en la congestión grave;
- en el flanco pasa de 14 a 19; esas luces son profundas, las domina el ruido y ya estaban fuera de las referencias en
  fundamental.

En la e2e, el campo cercano (0,5–4 mm: la piel, la grasa y el transitorio) oscurece, el tejido de 40–100 mm no cambia y
el ruido sube 3 dB en toda la profundidad (también junto a la sonda: no se acumula). A simple vista la diferencia es
sutil: a 1,75/3,5 MHz el lóbulo principal apenas cambia. Cambian el campo cercano, el transitorio, la neblina y el ruido
profundo. Coste: nulo, solo uniforms (B gana 4 ranuras; K, 2). `no-harmonics` pasa a `harmonic-simplified`.
**Verificación.**

- `harmonic.test.ts`:
  - el haz fundamental bit a bit el de antes;
  - el haz armónico derivado del perfil (λ de emisión 2λ, ÷√2, principal +10–20 % en el foco a 90 mm y +25–40 % a
    20 mm, ≤ +2 % fuera);
  - la σ elevacional armónica frente a su fórmula de dos vías;
  - la acumulación monótona de 0 a 1, solo en la piel;
  - el transitorio −20 dB y el ruido +3 dB;
  - las fórmulas en el GLSL (la acumulación en B antes del transitorio y del ruido; sin `pow` de base negativa), y que
    el color no lee nada de la armónica;
  - el comando del equipo;
  - el cableado en el renderizador real sobre WebGL falso: los uniforms de siempre en fundamental, y los del haz, la
    elevación, el transitorio, el ruido, la acumulación y los ecos parásitos en armónica.
- `compound.test.ts`: cambiar de modo reinicia el anillo.
- `controllers.test.ts`: el HUD.
- La e2e `harmonicContrast`:
  - el campo cercano, el tejido, y el ruido con la sonda levantada, en toda la profundidad y solo en las líneas sin
    contacto (en la subxifoidea un borde de la cara sigue apoyado en el abdomen curvo);
  - el conmutador con el HUD;
  - que la aplicación, sin `?e2e`, arranca en armónica.
- Guardas actualizadas: la huella del main de B (el transitorio lleva su ganancia y el tejido su acumulación) y las
  ranuras de K (2n + 13).
- Capturas con GPU lado a lado en la subxifoidea, la intercostal, el flanco y la congestión grave. La revisión
  adversarial de contexto limpio halló la acumulación que apagaba la pared, el juez que no capturaba en armónica, el
  anillo sin reiniciar y el `pow` de base negativa; están corregidos.

## 78. Tríadas portales finas: el hígado deja de ser un moteado uniforme

**Contexto.** El juez ciego (ronda 2) distinguía el hígado simulado por su textura: un moteado de Rayleigh de un solo
grano, con una heterogeneidad lenta de 1,15 dB, frente al de las referencias reales. En estas se ven puntos y trazos
ecogénicos de 1–5 mm, a veces con una luz diminuta: las tríadas portales finas, con la vaina fibrosa de Glisson. Salen
unas 0,2–0,3 por cm² en las capturas de la revisión: el Toshiba Aplio con el hígado y el riñón, y el de Morison. El
árbol de tubos llega hasta las ramas de 4.º orden (~1 mm de radio), con el tope de `MAX_TUBES`; por debajo no había
nada.
**Opciones.**

- (1) Más tubos: el tope de 128 tubos y el coste de la clasificación por tubo lo impiden.
- (2) Grumos en el hígado, el mecanismo de la grasa (decisión 56): da estadística K isótropa, sin la forma alargada ni la
  luz.
- (3) Subir la heterogeneidad: moteado a escala de centímetros, no focos.
- (4) La elegida: segmentos procedurales anclados, con vaina y luz, orientados como el árbol.

**Decisión.** Módulo `ultrasound/portalTriads.ts`.

- **Geometría:** una tríada como mucho por célula de 12 mm (probabilidad 0,7), con el centro en cualquier punto de la
  célula.
  - Un segmento de semilongitud 1,5–4,5 mm, orientado del hilio hacia fuera (la bifurcación portal de
    `vesselTree.ts`) con un giro aleatorio de peso 0,7.
  - Una vaina de radio 0,5–1,2 mm que multiplica la amplitud de retrodispersión del hígado por 4–9, distinta en cada
    tríada.
  - Una luz del 0–60 % del radio con la sangre (0,05), y bordes suaves de 0,12 mm.
  - Un hash ENTERO de los índices de la célula (PCG3D, Jarzynski y Olano 2020), con un número por parámetro y sales
    fijas: es anatomía del paciente, no depende de la semilla del moteado, no hierve y persiste al mover la sonda, y
    da las mismas tríadas bit a bit en TS y en cualquier GPU. La primera versión usaba el hash de coma flotante del
    moteado, amplificado por `fract(k·h)`: el gemelo y la GPU daban otras tríadas en el 67 % de los puntos junto a
    una, dos GPU conformes (con y sin FMA) discrepaban en el 11 % y las células espejo compartían números
    (revisión adversarial).
- **Búsqueda:** cada tríada cabe en media célula alrededor de su centro, así que en cada punto bastan las 8 células más
  cercanas. Si dos se tocan, gana la vaina más brillante y la luz se impone a cualquier vaina, sin depender del orden.
- **Pasada B:** el factor multiplica la retrodispersión de `T_LIVER` en `fieldFor` y en `fieldForPh`, en cada plano de
  elevación, así que el grosor de corte las funde como a los vasos. Gemelo TS en `wallTwin`.

La densidad y el brillo se ajustaron con capturas de GPU frente a las referencias. Con células de 8 mm y ganancia 3
salía un «cielo estrellado» (un patrón de hepatitis aguda). Con tríadas finas de 0,35–0,8 mm el volumen parcial las
borraba.
**Consecuencias.**

- **Imagen:** el hígado muestra focos brillantes y trazos dispersos (segmentos de 3–9 mm; en un corte de 3 mm se ven
  de ~5 mm de mediana), unas tres de cada cuatro con el centro oscuro: 0,25–0,35 por cm² en un corte de 3 mm, y un
  ~0,8 % del volumen del hígado es vaina.
- **Estadística:** la SNR del moteado del hígado baja ~0,05 (GPU, M4, mirada 0: subxifoidea 2,06 → 2,00, intercostal
  1,87 → 1,82, flanco 1,88 → 1,84), hacia la estadística algo pre-Rayleigh del hígado real, y sigue dentro de la guarda
  (1,6–2,25).
- **Coste:** 8 hashes por muestra de hígado y plano, más 3 por célula con tríada; sin uniforms nuevos.
- **Limitación `portal-triads-diffuse`:** son dispersores difusos brillantes, sin eco especular, sin Doppler y sin unirse
  al árbol; la misma densidad en todo el hígado.

**Verificación.**

`portalTriads.test.ts`:

- las 8 células vecinas dan lo mismo que las 64, en puntos al azar y pegados a tríadas;
- el hash: enteros de 32 bits, números de 24 bits exactos en float32, sin simetría entre células espejo y sin
  correlación entre parámetros;
- la vaina, la luz y un perfil radial sin saltos;
- en la anatomía real: 0,4–1,2 % del volumen, 0,2–0,5 por cm² en un corte de 3 mm y orientadas hacia el hilio
  (|cos| medio > 0,6);
- la misma fórmula y las constantes de TS en los dos programas de la pasada B, aplicada solo al hígado.

La e2e `triadParity` (equivalencia) evalúa el GLSL de la pasada B en la GPU (`queryTriads`, un programa de consulta) en
25 584 puntos materiales pegados a las tríadas de medio hígado y al azar, y lo compara con el gemelo: diferencia máxima
3,4·10⁻⁴ con Metal (M4), por debajo de 0,005 con SwiftShader.

Capturas con GPU de la intercostal, la subxifoidea y la renal, con y sin tríadas.

## 79. Aurícula de lazo cerrado en la media e intervenciones docentes: bolo, diurético y PEEP

**Contexto.** El dueño (médico, 26-09-2026): «adelante con todas tus propuestas». La PAD era un contorno prescrito
(`prescribed-ra-contour`): la media del caso más las ondas, sin relación con el volumen ni con la presión torácica, así
que no había forma de enseñar qué hacen un bolo, un diurético o la PEEP sobre la VCI, los Doppler y el grado. La PEEP
se cancelaba al prescribir la PAD respecto a la pleural de fin de espiración (`peep-no-hemodynamic-effect`: con 0, 5 o
15 cmH₂O todo era idéntico) y con respiración espontánea ni siquiera llegaba a la pleura.
**Opciones.** (1) Un modelo de cámaras (aurícula y ventrículo con volumen y válvulas, tipo CircAdapt): la forma de onda
saldría sola, pero habría que recalibrar los tres casos, cuyos patrones (grados 0/3/1) salen hoy de las ondas
calibradas. (2) Cerrar el lazo con la red tal cual, que se alimenta de una arteria a presión fija: su retorno venoso
apenas depende de la PAD (−0,88 mL/s por mmHg, 15 veces menos que la curva de Guyton de abajo) y no conserva el
volumen, así que un bolo no tendría dónde ir. (3) La elegida: lazo cerrado en la media y forma de onda calibrada.
**Decisión.** `src/physiology/circulation.ts`. La PAD media de fin de espiración es el cruce del retorno venoso
RV = (Pmsf − PAD)/R_RV con una curva de Frank–Starling del VD sobre la presión transmural, GC = f_A·GCmáx·(1 − e^(−Ptm/k)).
La curva de retorno venoso sale de la red en el punto de trabajo del caso, tras el calentamiento: Pmsf₀ es la media de
las presiones de sus compartimentos (esplácnico, hígado, cuerpo inferior, VCI, riñón y una arteria de 1,5 mL/mmHg)
ponderada por su distensibilidad local, la presión a la que se igualarían sin flujo, y R_RV = (Pmsf₀ − PAD₀)/GC₀, con GC₀
el caudal de la red a la aurícula: Pmsf₀ 10,5/24,2/18,7 mmHg, R_RV 1,22/1,37/1,27 mmHg·min/L y distensibilidad
128/111/113 mL/mmHg en el sano, la congestión grave y la FA. La curva de Starling pasa por el punto del caso con la
pendiente 61 mL·FC·fVD·(1 − 0,7·IT)/(Ptm + 2): 5,5 mL/s por mmHg en el sano, en la pendiente (S·R_RV = 0,40), 2,0 en la FA
(0,15) y 0,6 en la grave, en la meseta (0,05). Sin intervenciones el lazo devuelve la PAD del caso tal cual: la
trayectoria de los tres casos es idéntica bit a bit a la de main (respiración tranquila, apnea y profunda, 20 s). La
presión arterial de la red sigue al gasto con su resistencia constante (PAM = PAD + GC·RVS), y el volumen que el lazo
infunde o retira entra en los compartimentos de la red, no solo por sus bordes (`VenousNetwork.shiftVenousPressures`):
en cada paso el cambio de la Pmsf sube o baja la presión de todos ellos, con la ley no lineal del hígado y de la VCI (el
hígado rígido no se llena de más). Así los caudales de la red siguen al gasto del lazo desde el primer latido: en bloques
de latidos enteros, tras 500 mL en el sano, +7/+5 % … +20/+18 % (red/lazo, apnea). Sin esa entrada la red se llenaba
desde la arteria en tiempo real mientras la PAD subía al ritmo acelerado, y su retorno venoso iba 10–40 s al revés que
el gasto (−13 % tras un bolo en el sano, −30 % en la grave; +9 % tras un diurético).

Intervenciones (`PhysiologyEngine.intervene`, API pura): bolo y diurético/ultrafiltración cambian el volumen estresado
con una cinética de primer orden en tiempo docente acelerado ×30 (1 s simulado ≈ 30 s clínicos): τ 10 s el bolo (5 min
clínicos; 95 % a los 30 s) y 40 s el diurético (20 min; 95 % a los 2 min). La PEEP (una CPAP si respira solo:
`respiratory.ts` la aplica ya en los dos modos) sube la pleural un 40 % y la poscarga del VD un 1,5 % por cmH₂O, que
deprime más al VD desacoplado (Ees/Ea = 2·fVD), con τ 3 s sin acelerar. Los líquidos se recortan al dominio probado del
modelo (el de `properties.test.ts`): la PAD no baja de 2 mmHg con ninguna PEEP de la intervención (el límite se calcula
con PEEP 0; con la del caso, un caso con PEEP 15 llegaba a −0,6 mmHg al quitársela) y el llenado no pasa de 30 (el sano
admite −563 mL), dentro de −1000/+1500 mL. La holgura de cada sentido cuenta todo lo que aún no ha llegado en ese
sentido, así que un bolo rápido tras un diurético lento no cruza el límite de paso; las dosis se suman en un acumulador
por constante de tiempo, y el coste por paso no crece con los clics (antes, 0,77 s por segundo simulado tras 5000). La
forma de onda es la de siempre, con la carga del lazo: la media en cada paso y, congeladas por latido, la rigidez
auricular, que sigue al llenado por volumen (la PAD con la PEEP del caso), y la IT
funcional, IT₀·(Ptm_V/Ptm₀)³, que también: la PEEP comprime la aurícula pero no la llena, y baja la precarga del VD pero
sube su poscarga, así que no cambia ni la rigidez ni la IT. El exponente 3 dice que el orificio crece más deprisa que el
anillo al agotarse la reserva de coaptación; con 2 la grave quedaba tras el diurético en el umbral de la S invertida
(IT 0,45) y el patrón cambiaba de una ventana a otra. Pestaña Docente: bolo de 250 y 500 mL, diurético −500 mL y PEEP
0/5/10/15 cmH₂O, con el estado frente al caso (PAD media, gasto, volumen en curso y pedido, PEEP, IT) y el tiempo desde la
última intervención con su equivalente clínico; un líquido sin sitio marca su botón con `aria-disabled` (sigue enfocable:
con `disabled` el foco caía al cuerpo de la página) y lo aplicado o recortado se anuncia (`role="status"`, que se vacía y
se reescribe para que un mensaje repetido se vuelva a leer). Cada intervención borra las mediciones de «Medir»: el grado
del alumno no mezcla el antes y el después. «Reiniciar paciente» recarga el caso (`SimulationSession.reloadCase`, como un
cambio de caso: se borran las mediciones), anuncia el error si no pudo, y el aviso de la intervención anterior se borra
al cambiar de caso. El diagnóstico exportable lleva el estado del lazo y las intervenciones.
**Consecuencias.** A los 120 s, con respiración tranquila. Sano: +500 mL →
PAD 5 → 7,9 mmHg, VCI 18,1/12,6 → 24,5/20,1 mm (colapso 30 → 18 %), gasto +18 % (responde a volumen) y grado 0 → 1 con los
tres Doppler normales; con 250 mL, VCI 21,3 mm y grado 1. −500 mL → PAD 2,5, VCI 11,1/6,6 mm (41 %), gasto −21 %. PEEP
5/10/15 → PAD 5,5/6,1/6,6, colapso 29/27/26 %, gasto −10/−19/−29 %. Congestión grave: −500 mL → PAD 14,0, IT 0,70 → 0,38,
S −7 → +6 cm/s (S < D), PF 73 → 33 %, renal monofásico → bifásico: grado 3 → 2 a los 30 s y → 1 desde los 60 s, con el
gasto −4 %; +250/+500 mL → PAD 20,2/22,3 con el gasto +2/+3 % (meseta), IT 0,93/1, S −19/−21 cm/s y PF 122/150 %; PEEP 10
→ PAD 18,6, PF 84 %, grado 3. FA: −500 mL → PAD 9,4, grado 1 con la suprahepática normal; +250 mL → IT 0,49 y S ≈ −3 cm/s,
en el umbral de la inversión (grado 3 en 7 de 9 ventanas de 8 s, 2 en las otras); PEEP 15 deja la PF en 48–52 % (grado
1–2). Sin barorreflejo, la PAM de la red llega a 108 mmHg con 500 mL en el sano y el gasto cae con la PEEP más que en la
clínica; con −500 mL y PEEP 15 el sano queda en 2 L/min y, con respiración tranquila, la vena interlobar sale bifásica y
la PF en 34 % con la VCI de 13 mm. Revisión adversarial de contexto limpio: la trayectoria sin intervenciones es idéntica a
main y 12 420 entradas al azar no dieron ningún NaN; halló la red a contracorriente en los transitorios, el límite con la
PEEP del caso, el coste de los clics, el reinicio que anunciaba éxito con error, el aviso obsoleto tras cambiar de caso,
el foco perdido y dos mutaciones que ninguna prueba mataba; todo corregido arriba. Limitaciones: `prescribed-ra-contour` pasa a decir que lo prescrito es la forma de onda; se retira
`peep-no-hemodynamic-effect`; nuevas `mean-closed-loop` y `no-autonomic-reflexes`; `no-thoracic-waterfall` añade que el
diurético del sano llega a ella (VCI de 6 mm en la inspiración, a 2,8 m/s). Enmienda la «PAD impuesta como condición de
contorno» de la hoja consolidada: la PAD del caso es ahora el punto de trabajo del lazo.
**Verificación.** `circulation.test.ts` (rápida): la curva de Starling pasa por el punto y con la pendiente del caso,
creciente y cóncava; el cruce es monótono con el volumen, la pleural y la poscarga, y la meseta pasa casi toda la Pmsf a
la PAD; sin intervenciones, la PAD, la IT y la onda son las del caso; cinética exacta de las dosis y de la PEEP sin saltos;
límites y su recorte (también de paso y con 400 clics alternos), el límite con PEEP de caso, la onda de cada latido
congelada aunque cambie la carga y la rigidez con el llenado y no con la PAD. `interventions.test.ts` (lenta): los tres
casos con la PAD, la VCI y el grado de main; bolo, diurético y PEEP con los números de arriba, el patrón de la grave
sostenido de 80 a 160 s, la PEEP sin mejorar la congestión ni cambiar las ondas; el retorno de la red con el gasto del
lazo desde el primer bloque de latidos (bolo y diurético, sano y grave); fast-check con secuencias de intervenciones en
los tres casos y sus variantes con PEEP de caso y ventilación mecánica, en los cuatro patrones respiratorios (finito, VCI
acotada, < 3 m/s, PAD ≥ 2 y llenado ≤ 30 en cada paso). e2e «intervenciones docentes» (botones, estado, teclado, reinicio
y cambio de caso en el simulador vivo). Mutaciones que las pruebas matan: sin la IT dependiente de la carga (exponente 0;
la S de la grave se queda en −8 cm/s), sin la entrada de volumen en la red (las cuatro pruebas de «la red sigue al
lazo»), con la onda leída en vivo y no congelada por latido, con la rigidez de la PAD y no del llenado (en la unitaria y
en el motor), con el límite inferior calculado con la PEEP del caso y con la holgura sobre el total neto.

## 80. Cine y modo M: los cuadros adquiridos antes de la conversión de barrido y la franja M en la GPU

**Contexto.** El dueño (médico, 26-09-2026): «adelante con todas tus propuestas», que el simulador se comporte como un
ecógrafo en dos funciones que faltaban. «Congelar» solo detenía la imagen: no se podía volver a los cuadros anteriores
ni medir sobre ellos, como en el cine de un equipo; y no había modo M, con el que VExUS mide la colapsabilidad de la
VCI.
**Opciones.** Cine: (1) guardar la imagen mostrada (RGBA a tamaño del lienzo, 3–14 MB por cuadro: 6 s no caben en 64
MB); (2) leer cada cuadro a la CPU (`readPixels`, 50–90 ms, invariante 7); (3) la elegida: la envolvente compuesta y el
campo de color en la GPU, antes de la conversión de barrido, y la misma pasada G para verlos. Modo M: (1) leer la
columna de cada cuadro con un PBO y una valla: medido con GPU real, el `getBufferSubData` de Chrome es un viaje síncrono
al proceso de la GPU y bloqueaba el hilo 59 ms (p95) y hasta 86 ms por cuadro, y con uso READ avisa en cada valla hasta
agotar los 256 mensajes de WebGL del contexto; (2) dibujar la franja dentro del lienzo de la imagen (cambia la
disposición, el HUD y los clics); (3) la elegida: la franja en la GPU, copiada a su lienzo con `drawImage` (de GPU a GPU
con el Canvas2D acelerado de Chrome: 0,1 ms en el hilo, 0,3 como máximo con densidad 2; sin aceleración, Chrome la copia
por la CPU y el modo M baja de 60 a 41 fps).
**Decisión.** Cine: `CineRing` (`src/ultrasound/cine.ts`) guarda como mucho 20 cuadros por segundo del reloj de la
simulación (todos si llegan menos: el color, SwiftShader) en un anillo de 120, 6 s: tras la presentación,
`blitFramebuffer` copia la envolvente compuesta (`tEnv`, R32F) a una capa R16F de una textura de capas y, si el cuadro
muestra color, el campo de color a una capa RG16F (`tColor`, de RGBA32F), con las instantáneas inmutables de sus ajustes
(profundidad, ganancia, TGC, rango, persistencia; caja, PRF e inversión del color). Otra profundidad empieza el anillo;
el cambio de caso y la pérdida de contexto lo vacían. Al congelar, el último cuadro dibujado entra si la cadencia lo
había saltado (`cineSeal`), así que el final del cine es el cuadro congelado. `showCine(i)` devuelve su capa a `tEnv` y
`tColor` y dibuja G con sus ajustes; los anteriores que aún pesan en la persistencia (`persistenceReplay`: p^k·255 ≥ ½,
6 con 0,35 y 28 con 0,8) se funden en el mismo destino con la mezcla de la GPU, (1 − p^k)·G + p^k·destino: la de la
pasada P tras los k cuadros dibujados desde el guardado anterior. El cuadro se ve como se vio. El último es la propia
historia de la persistencia, que el cine no toca: el cuadro congelado píxel a píxel; al descongelar vuelve a la pantalla
(sin esperar al color) y la imagen sigue sin salto. Si el lienzo cambia con la imagen congelada (la historia se pierde),
la historia pasa a ser el cuadro mostrado. `readDisplay` lee lo que está en pantalla. Interfaz
(`src/ui/controllers/cine.ts`): con la imagen congelada, un deslizador bajo la imagen con el instante del cuadro («−1,25
s»), ← → Inicio Fin y la rueda sobre la imagen; congelada, la sonda no se mueve (la rueda y las flechas son del cine, y
un arrastre empezado antes tampoco la mueve), el clic solo mide (la puerta, la línea M y la caja se quedan como en la
imagen) y el Espacio descongela también con el deslizador enfocado, que devuelve el foco a «Congelar». Al restaurar un
contexto WebGL perdido, el cine y la franja M (del renderizador viejo) se vacían. El ECG, el espectro y la franja M
llevan un cursor en el cuadro mostrado y se desplazan con él cuando queda fuera de su ventana (`traceRight`: a una
décima del borde); la regla, el foco y la caja de color son los del cuadro (`Simulator.displayed`) y el calibrador de la
VCI mide sobre él (`display` es la geometría de su profundidad). Modo M: `ImagingMode` gana `'M'` (barra [2D | M | Color
| PW], tecla M; excluye Color y PW, y M otra vez vuelve a 2D) y el estado del equipo `mmode` {enabled, theta} con el
comando `placeMLine` (acotado al sector). La línea M, discontinua y amarilla, se coloca con un clic sobre la imagen,
como la puerta del PW, o se arrastra desde ella (a ≤ 10 px, antes que la sonda; no con un modificador, ni sobre el
deslizador del cine, ni congelada). En cada cuadro `FRAG_MLINE` copia esa línea de `tEnv`, con el mapa de grises de G
(`DISPLAY_GREY_GLSL`, una sola fuente para los dos), a una columna R8 de un anillo de 2048 (la «textura que se
desplaza»; `MColumnRing`, `src/ultrasound/mmode.ts`); `FRAG_MSTRIP` pinta la franja con el eje de tiempo del ECG (cada
píxel, la columna que cubre su instante: `pixelSlots`) en una esquina del lienzo de la imagen, la vista
(`src/ui/mModeView.ts`) la copia a `#mmode` y `represent` devuelve la imagen a la pantalla en el mismo cuadro; nada
vuelve a la CPU. Un cuadro sin modo M corta la franja (al volver, el barrido empieza de nuevo) y un hueco del reloj de
más de 0,5 s entre dos columnas queda en negro: la columna siguiente no lo rellena. La franja ocupa el sitio del
espectro, más alta (34 % del alto: se mide sobre ella), con la escala de profundidad, los calibres y el cursor del cine.
El barrido 25/50/100 mm/s es el del PW y el ECG, también en la sección «Modo M» de Adquirir (`tabAfterMode` lleva de
Doppler a Adquirir). Medir: «VCI modo M», dos calibres verticales sobre la franja (de pared a pared en el máximo y en el
mínimo, en cualquier orden; uno de menos de 1 mm se descarta) → máximo, mínimo y colapso (máx − mín)/máx
(`src/vexus/ivcCollapse.ts`); con el modo docente, junto a la verdad: el diámetro AP de la VCI del motor (`sample.ivc`)
en la ventana que muestra la franja, latido incluido; y la pestaña Docente da el colapso de la verdad de 6 s. Sin
calibrador en la imagen, el máximo del modo M es el diámetro de la VCI del grado.
**Consecuencias.** Memoria de GPU: 54,6 MB para el cine (120 × (384 + 60) kB) y 1 MB para la franja M. Coste con GPU
real (M4, 1600 × 1000, densidad 1 y 2; entre paréntesis, con la máquina muy cargada): cada toma del cine 0,02–0,03 ms de
GPU (0,07) y ~0 de CPU, a ≤ 20 Hz: ~0,01 ms por cuadro en vivo; la franja M, un dibujo de 1 × 512 píxeles por cuadro y
otro de su tamaño en pantalla con la copia, ~0,05 ms de GPU y ≤ 0,1 ms de CPU (60 fps en los dos modos); mostrar un
cuadro del cine, 1–2,4 ms (10). El chunk principal y el JS total crecen 13,4 kB (se quita `debugRead`, sin uso desde la
iteración 1, y dos lecturas de prueba repetidas se funden): sobre main 00fad81 (decisiones 76 y 77), 322,9 de 320 kB y
1005,1 de 1000 kB; los presupuestos no se suben: cabe cuando entre el renombrado de identificadores del GLSL. La
colapsabilidad medida en la franja de borde interno a borde interno coincide con la verdad (±2 puntos) con la línea 2 cm
por debajo de la desembocadura de las suprahepáticas (~80° con la VCI), pero casi de frente (≥ 84°) el eco especular de
la pared de enfrente se come 1–1,5 mm de la luz y sale ~6 puntos por encima (`m-mode-lumen-blooming`); la franja toma
una columna por cuadro de imagen, compuesta como la imagen (`m-mode-frame-rate`). La vista de la franja tiene ahora la
misma x por instante que el ECG (sin el resto de `SweepTimeline`). Hallazgo aparte: el mapa de tejidos del modo docente
(`tissueMap`) lee con el mismo PBO de uso READ y el mismo `getBufferSubData` síncrono (4 Hz).
**Verificación.** `cineMode.test.ts` (anillo y cadencia del cine, instante del cuadro, repetición de la persistencia,
eje de las franjas con el cursor, columna de la línea M y de cada píxel de la franja, colapsabilidad y su verdad en el
sano), `equipment.test.ts` (modo M: exclusión, alternancia y línea acotada), `controllers.test.ts` (HUD del modo M) y
dos e2e de `smoke.spec.ts`: «cine (decisión 80)» (retroceder ~1 s cambia la imagen y mueve el cursor del ECG; Fin da el
cuadro congelado idéntico) y «modo M (decisión 80)» (una mirada; línea M sobre la VCI subxifoidea 2 cm por debajo de las
suprahepáticas con un clic; en la franja que se ve, la banda sigue al diámetro de la verdad, r 0,94, y el colapso de sus
bordes y el de los calibres de Medir quedan a ±5 puntos de la verdad: 32–33 frente a 30,4 %). Con GPU real, la cuerda de
la luz a lo largo de esa línea da 28,8 frente a 30,3 % y la franja 31,5 %. Capturas con GPU real del cine en 2D, en
color y en tríplex y del modo M en vivo, congelado con los calibres y con el cine. Revisión adversarial de contexto
limpio: la franja unía los dos tramos al volver al modo M (una VCI inmóvil fabricada sobre la superficie de medida), la
línea M se movía congelada y robaba el deslizador, el cine quedaba colgado tras restaurar el contexto, la persistencia
repetida pesaba cada cuadro guardado como uno dibujado; todo corregido. Queda abierto de la revisión: la línea M y los
calibres de la franja solo se colocan con el puntero (el cine sí se recorre con el teclado) y `#mmode` es `role="img"`
aunque recibe clics. Hallazgo aparte, anterior a este cambio: tras restaurar el contexto, `rebuildRenderer` libera
objetos del contexto perdido (unos 127 avisos de WebGL por restauración en modo M, 7 de este cambio, que agotan los 256
mensajes del contexto).

## 81. Retroperitoneo: psoas, cuadrado lumbar y grasa retroperitoneal alrededor del riñón; Morison y la cápsula con una sola línea

**Contexto.** Sirve a los objetivos 3 (fidelidad anatómica) y 2 (fidelidad ecográfica) de `docs/MISION.md`. La ventana
renal seguía siendo sintética a primera vista para un juez ciego: todo lo que no era órgano
modelado era el «resto» con la textura de asas de la decisión 74, también detrás y por dentro del riñón, junto a la
columna y entre la VCI y la aorta (limitación `no-psoas`, brecha de `docs/anatomia/revision-normal.md`). En rayos desde el
centro del riñón derecho (1152 direcciones), el primer tejido tras su grasa perirrenal era intestino en 758, el 66 %
(detrás, 137; por dentro, 135 de 148), y en la ventana renal el anillo de 0–8 mm alrededor de la grasa perirrenal
tenía 328 muestras de asas y ninguna de grasa. En la anatomía seccional (Gray; Radiopaedia; Meyers, radiología del
retroperitoneo) el riñón está en el espacio perirrenal y lo rodean la grasa pararrenal (anterior y posterior) y, detrás,
el psoas (medial), el cuadrado lumbar y la aponeurosis del transverso; las asas (duodeno, colon ascendente) quedan delante.
Además, la cápsula del lado cercano del riñón y Morison eran dos líneas paralelas: la grasa perirrenal fina (≤ 2,5 mm)
dibujaba su cara externa y la de la cápsula renal a 1–1,6 mm (vista renal), que el pulso de 3,5 MHz resuelve (la
decisión 68 las quería fundidas en una).
**Opciones.**

- (1) Cambiar solo la textura del «resto» junto al riñón: sin músculos y con una frontera arbitraria.
- (2) Anatomía de mallas o de tablas de TC: dependencia nueva y sin gemelo GLSL barato.
- (3) Caras de interfaz para las fascias (del psoas, la renal posterior): cada cara suma una ranura a `uIface` (el
  programa dirigido de B queda en 130 de 130 con los tejidos nuevos) y una rama de `faceGradient`; el borde ya lo marca
  el contraste músculo/grasa (≈ 12 dB). Descartado.
- (4) Mover el riñón hacia delante para que el cuadrado pase entre él y la pared: cambia los vasos renales, Morison, la
  impresión renal, la ventana renal y sus pruebas.
- (5) La elegida: un módulo de órgano con SDF simples y gemelo GLSL, tres tejidos y la textura de fascículos.

**Decisión.**

- **Módulo `anatomy/organs/retroperitoneum.ts`** (TS y GLSL con los mismos nombres, simétrico en x; niveles vertebrales
  [ESTIMADO]: T12–L1 en z ≈ −45, L1 −63, L2 −97, L3 −131, L4 −165, L5 −200, S1 −232):
  - **Psoas:** cuatro conos redondeados por (|x|, y, z, r) = (22, −52, −45, 5) → (30, −45,5, −97, 12) → (37, −41, −131, 16) → (40, −39, −165, 18) → (51, −30, −240, 15): pegado a los cuerpos vertebrales, por delante de las transversas y
    detrás de la VCI y de la aorta, se separa hacia fuera y adelante. Sección por lado 1,8 cm² en L1, 4,7 en L2, 8,1 en L3
    y 10,2 en L4: 16 cm² los dos en L3, un adulto medio (~12–15 en la mujer y ~20 en el varón, por encima de los cortes de
    sarcopenia de ~10 y ~19 cm² [LITERATURA, orden de magnitud]). La primera versión, con 6,2 cm² por lado en L3, era la
    de un varón sarcopénico (revisión adversarial).
  - **Cuadrado lumbar:** lámina contra la cara interna de la pared posterior (y < −30), de la punta de las transversas
    (|x| 41) a 72–94 mm (más ancha abajo), de la 12.ª costilla (z −45) a la cresta (−190), con 8 mm arriba y 14 hacia L3
    [ESTIMADO sobre las guías del bloqueo del cuadrado lumbar]: 2,7–6,4 cm² en L2–L4. La pared posterior del modelo mide
    28 mm y la grasa perirrenal gruesa de detrás del riñón llega a ella: allí el músculo le deja sitio (la grasa se clasifica antes).
  - **Compartimento retroperitoneal:** detrás del peritoneo parietal posterior, y < y_peri(|x|, z): −4 mm por delante de
    los grandes vasos y del riñón (|x| ≤ 70), bajando con un smoothstep hasta −45 mm en la pared lateral (|x| 132, detrás
    de la línea axilar posterior), y bajo los riñones (z de −150 a −200) solo la gotera paravertebral (y < −30).
  - **En `classify`** (TS) y **`classifyWith`** (GLSL), tras el hígado: psoas, cuadrado, grasa retroperitoneal y, fuera,
    el «resto» de asas. Su distancia a la frontera es una cota inferior: las pseudodistancias de la pared, del borde
    lateral del cuadrado y del compartimento van divididas por la norma máxima de su gradiente (la profundidad radial bajo
    la pared, hasta 1,21 en la franja del cuadrado; el borde anterior del compartimento, 1,87), la del psoas (conos
    redondeados) sobrestima < 1 %, y cuenta la columna. La grasa perirrenal, que se clasifica antes, es la que le quita
    sitio al cuadrado; su término en la distancia del cuadrado solo la deja fuera de ella.
- **Tejidos 27–29** al final de la tabla (`T_PSOAS`, `T_QUADRATUS`, `T_RETROFAT`): el músculo con la c, ρ y α de IT'IS y la
  retrodispersión del músculo de la pared entre estrías (0,35) con la heterogeneidad lenta; la grasa, 1,4 con grumos 0,8,
  como la perirrenal [ESTIMADO]. `TISSUE_VEC4` pasa de 7 a 8: la pasada B, de 126 a 128 ranuras (130 el programa
  dirigido, el tope de `shaderLimits.test.ts`).
- **Textura `ultrasound/retroTexture.ts`** (gemelo en `wallTwin`): septos del perimisio entre haces de fascículos, un
  Voronoi 2D de 4 mm en la sección perpendicular al eje de cada músculo (la cuerda del psoas, a ≤ 3° de cada tramo; las
  fibras del cuadrado, que suben hacia dentro 0,25 mm por mm), extruido a lo largo de él con tramos de ~10 mm (~50 %
  encendidos), σ 0,2 mm y retrodispersión 3 (×8,6 sobre el músculo), con el brillo de lámina de la pared
  (ε + (1 − ε)·|cosθ|⁴) [ESTIMADO]: en eje largo, líneas finas a lo largo del músculo; en sección, puntos y trazos. Va
  en cada plano de elevación (`fieldFor`, `fieldForPh`), no en la pared que copia la serie de la pleura (`wallField`
  usa `fieldForBase`: está en un bucle y el JIT de SwiftShader se dispara con código pesado en un bucle), y `sampleSide`
  llama una sola vez a `fieldFor`.
- **Cápsula y Morison:** la grasa perirrenal fina dibuja entera la cara de la cápsula renal; solo la mitad externa de la
  gruesa dibuja la suya, y solo contra el hígado (decisión 68). La cápsula hepática le sigue cediendo la suya junto a una
  grasa fina (`MORISON_SLIVER_MM`): Morison es una sola línea, la de la cápsula renal, y el lado cercano del riñón
  también. Contra la grasa retroperitoneal, además, no hay salto de impedancia (grasa con grasa).

**Consecuencias.**

- **Imagen:** en la ventana renal el riñón queda rodeado de grasa ecogénica y granulosa, con las asas solo por delante y
  en el campo lejano (duodeno, colon); su lado cercano y Morison tienen una sola línea. En el flanco, entre la VCI y la
  aorta hay grasa en lugar de asas; en la porta, grasa alrededor del riñón. El psoas y el cuadrado se ven en las vistas
  transversas y más posteriores del flanco (hipoecoicos, con estrías finas) y no en el plano de la ventana renal: va por
  el hilio hacia la VCI y los deja 20–33 mm por detrás, como en la anatomía (la vena renal va por delante del psoas).
- **Cifras:** tras la grasa perirrenal, intestino en 0 de 1152 direcciones (antes 758) y grasa retroperitoneal en 663 (el cuadrado lumbar en 95);
  en el anillo de la ventana renal, 328 muestras de grasa y ninguna de asas (antes 328 de asas; la congestión grave, 182
  → 0). Márgenes en el adulto de referencia: el psoas a ≥ 8,3 mm del riñón, 0,6 de su grasa (el polo inferior apoya en
  él), 8,9 del hígado, 7,3 de la VCI, 2,3 de la pared aórtica y 0,8 de la vértebra; el cuadrado a ≥ 6,2 del riñón, 2 del
  hígado y 1,5 de la columna.
- **Coste:** `classify` en CPU igual en todo el tronco (200 000 puntos: 1018 → 1019 ms) y algo menos en la ventana renal
  (486 → 416 ms). La textura solo la pagan las muestras de psoas y cuadrado. El texto GLSL de los programas que clasifican
  crece un 4–5 % (`classifyWith`: tres copias en B, dos en A0), y `sampleSide` pasa de dos llamadas a `fieldFor` a una.
  Con SwiftShader y la máquina compartida (carga 10–19), el primer cuadro llega en 60–96 s en `main` y en 55–90 s en la
  rama (arranques en frío y en caliente alternados), y la pareja de la e2e «equivalencia + arranca» dura lo mismo en las
  dos (2,3 + 1,3 min): sin diferencia medible. Ranuras de uniforms de B: 126 → 128 (130 el programa dirigido, el tope).
- **Presupuesto:** con el GLSL de nombres cortos del build (#94), el chunk principal pasa de 304,6 a 310,8 kB (320) y el
  JS total de 939,6 a 947,9 kB (1000).
- **Limitaciones:** `no-psoas` desaparece; queda `simplified-retroperitoneum` (sólidos lisos, sin pilares del diafragma,
  ilíaco ni suprarrenales, el cuadrado que cede su sitio al riñón y, en la hepatomegalia de la congestión grave, el hígado
  que ocupa el origen del psoas en T12–L1, hasta 12 mm). Contra la grasa gruesa, Morison sigue teniendo dos caras reales a
  ≥ 2,5 mm (la de la grasa con el hígado y la de la cápsula), como en la 68.

**Verificación.**

- `retroperitoneum.test.ts`: el psoas junto a los cuerpos vertebrales de T12 a la pelvis, lateral al cuerpo y medial al
  riñón, detrás de la VCI y delante de las transversas, con la sección creciente y en su orden de magnitud; el cuadrado
  contra la pared, lateral y posterior al psoas, de 10–15 mm de grosor, sin nada en la pared anterior y cediendo su sitio a
  la grasa del riñón; los márgenes a riñón, grasa perirrenal, hígado, VCI, aorta y columna en el adulto de referencia; en
  los tres casos, nada retroperitoneal dentro del hígado, la columna o la grasa perirrenal; tras la grasa perirrenal
  nunca asas; el compartimento (grasa delante de los grandes vasos y entre la VCI y la aorta, asas delante); la distancia a
  la frontera como cota inferior (moverse 0,95·bd en 14 direcciones no cambia el tejido); los tejidos nuevos y el gemelo
  GLSL con las constantes del módulo.
- `retroTexture.test.ts`: 1 fuera del psoas y del cuadrado; septos perpendiculares al eje, a ~4 mm y continuos a lo largo
  de él; de frente brillan y de canto no; el psoas queda por debajo del hígado (≤ −2 dB) y de la grasa que lo rodea;
  anclada; en B, en la muestra del medio y en sus planos y nunca en la pared de la serie.
- `shaderLimits.test.ts`: `fascicleSeptum` fuera de todo bucle (el detector ve la regresión si la pared de la serie usa
  `fieldFor`); las ranuras de B y el recuento de tejidos.
- `startPoints.test.ts` (renal): además del riñón y la interlobar, el hígado junto al polo superior y, a 8 mm de la grasa
  perirrenal, grasa retroperitoneal y ninguna asa.
- `anatomy.test.ts`: la grasa fina dibuja la cápsula renal y el hígado junto a ella no dibuja la suya; Morison con una
  línea y una sola, también donde la grasa es fina (lámina de asas o de grasa retroperitoneal de ≤ 3 mm), con pasos de
  los dos grosores; `faceGradient.test.ts` con menos muestras de la cara de la grasa (solo la gruesa contra el hígado).
- e2e `equivalence.spec.ts` (TS ↔ GLSL en 50 000 puntos, la cáscara de caras, con la grasa perirrenal en ella) y la suite
  entera con SwiftShader; capturas con GPU (M4) de las ventanas renal y del flanco, adulto sano y congestión grave,
  frente a `main`, y de dos vistas del flanco con el psoas.

## 82. Casos trampa y contexto clínico: viñeta, confusores que marca el alumno, fiabilidad por territorio y mVExUS

**Contexto.** Sirve a los objetivos 4 (fidelidad fisiológica y clínica: los confusores y los casos trampa de la
literatura revisada), 5 (enseñar a obtener y a interpretar: contexto clínico y fiabilidad por territorio, modo ciego) y 8
(honestidad: lo que el modelo no hace, declarado) de `docs/MISION.md`. El dueño (médico, 26-09-2026) compartió 19
artículos de POCUS y VExUS (Koratala 2022 y 2026, Leyba 2026, Martin 2025, Kidney360 2022, Clin Kidney J 2024, Med Clin N
Am 2025 y otros). Los tres casos enseñaban el protocolo con pacientes que no engañan: el grado de la verdad seguía a la
PAD (0/3/1 con 5/18/13 mmHg). La literatura describe discordancias que el motor ya produce —la presión intraabdominal
(PIA) alta da una VCI pequeña con la PAD alta; la insuficiencia tricuspídea (IT) grave, una S invertida sin congestión;
la ventilación con presión positiva, una VCI dilatada sin PAD alta; la cirrosis, una porta que no sigue a la PAD— y otras
que el operador solo puede tener en cuenta (ERC terminal, deportista, FA, sin ECG). El clasificador ya tenía
`classifyVexusC(input, ctx)`, la VCI a ±2 mm del corte y `classifyModifiedVexus`, el mVExUS sin riñón (Martin 2025: AUC
0,85 frente a 0,87 para PAD > 12 mmHg, κ 0,85).
**Opciones.** (1) Meter el contexto en el `PatientState`: mezclaría la verdad latente con lo que sabe el operador. (2)
Aplicar el contexto real del caso al grado sin que el alumno lo marque: no enseñaría a reconocer el confusor. (3) Quitar
del grado todo el territorio que un confusor puede falsear, en cualquier sentido (la primera versión): con «Deportista» un
estudio normal pasaba de 1 a 1–2, y con «Cirrosis» se perdía una S invertida verdadera, justo la lección de no quedarse
con la porta. (4) La elegida: casos con la fisiología que ya existe, casillas que marca el alumno, y cada confusor quita
solo el hallazgo hacia el que sesga.
**Decisión.** Cuatro casos trampa en `src/cases/index.ts`, cada uno un caso de referencia con solo lo que crea el
confusor (semillas 20260924–27; el id nombra lo que dice la viñeta, no la trampa, porque el valor de la opción está en el
DOM del alumno): `abdominal-hypertension` (la congestión grave, con su IT funcional de 0,7, con PIA 16 y PAD 14),
`tricuspid-regurgitation` (el sano con IT 0,9, PAD 8 y VD 0,7), `mechanical-ventilation` (el sano con presión positiva,
PEEP 10, FR 16 y PAD 7) y `cirrhosis-pulmonary-hypertension` (la congestión grave con la resistencia intrahepática ×5 y la
distensibilidad 0,6). Los parámetros de partida se afinaron con la verdad del motor en respiración tranquila y en apnea
espiratoria, y con capturas como las de la pestaña Medir, porque perdían la trampa: IT 0,8 con PAD 7 daba una S de
−4 cm/s y una VCI de 22,2 mm, junto a dos umbrales; con PAD 5 la ventilada medía 18,9 mm en la pausa espiratoria (grado
0); la porta del cirrótico salía al 53 % en apnea con la distensibilidad 0,4 y, con la resistencia ×4, la envolvente del
alumno (que sobrestima 5–13 puntos la PF de una porta lenta) leía 46–54 %; con PIA 20 la VCI de 8,5 mm llevaba la
retrohepática a 5,4 m/s, y el hígado de 0,9 perdía un cuarto de las ramas procedurales (30 de ≥ 40). Contexto clínico
fuera del `PatientState`, en dos registros por audiencia: `src/cases/vignettes.ts` (la viñeta: historia, ventilador,
presión vesical, ECG; sin el diagnóstico ni el grado) y `src/cases/teaching.ts` (los confusores reales, `VexusContext`, y
la explicación de la trampa). La viñeta la da `caseVignette` (`src/app/blindMode.ts`); las notas del docente,
`caseTeacherNotes` (`src/app/teacherNotes.ts`), que solo importa la pestaña Docente, cargada en su propio chunk en modo
docente: el JS del alumno no lleva las respuestas (`codeSplitting.test.ts`). `cases → vexus` entra en la matriz de capas
por ese tipo. Clasificador: cada confusor quita solo el hallazgo que puede falsear (`Discount`): la ERC el riñón grave y
el deportista la porta grave (dan falsos positivos: el hallazgo normal sigue contando), la cirrosis la porta siempre y la
suprahepática si no está invertida (la aplana, no la invierte); el deportista avisa además de la VCI grande, y el aviso de
la ventilación dice que la VCI varía poco. Pestaña Medir: «Contexto clínico» antes del protocolo, con la viñeta y un grupo
de siete casillas (`fieldset` con leyenda: ERC avanzada o diálisis, Cirrosis, Fibrilación auricular, Sin ECG, Ventilación
con presión positiva, Presión intraabdominal alta, Deportista), sin marcar al empezar y borradas al cambiar de caso (no al
reiniciar el mismo paciente ni al intervenir: la historia no cambia); el resultado usa `classifyVexusC` con lo marcado y
añade un aviso por confusor con su territorio y su motivo, «no fiable» en la línea del hallazgo que deja de contar, la
nota de la VCI a ±2 mm del corte y la línea «mVExUS (sin riñón)»; cuando no falta ninguna medida el estado dice
«intervalo por el contexto» o, si sale un grado, «con el contexto»; el grado se anuncia en una región `aria-live` de la
pestaña, fuera del cuerpo de la medida que el calibrador armado oculta, y la clase portal pasa al español. Pestaña Docente:
«Caso y trampa» con el nombre, los confusores reales y la trampa, y la verdad con el grado que da el contexto del caso; al
apagar el modo docente se vacían las notas, el estado del lazo (PAD, gasto e IT del caso) y la verdad, también en el DOM
oculto. Rótulos en `src/ui/panel/vexusText.ts` (`CONTEXT_LABELS`, un `Record` sobre todas las claves de `VexusContext`).
**Consecuencias.** Verdad del motor (tranquila/apnea espiratoria, 6–18 s). PIA alta: VCI 14,4/15,5 mm con la PAD media
13,0/14,0 mmHg, S −7,5/−7,3 cm/s, PF 27/26 %, renal continuo → grado 0; con «Presión intraabdominal alta», 0–2. Sin la
PIA, el mismo corazón da 29,3/29,6 mm y grado 3; sin la IT funcional, la suprahepática queda en S < D (13,1/15,3 cm/s) y
el intervalo en 0–1. IT grave: PAD media 7,0/8,0, VCI 24,3/25,2 mm, S −7,9/−8,2, PF 33/34 %, renal continuo → grado 2; sin
la IT, suprahepática normal y grado 1. Ventilación: VCI 26,4/23,0 mm con la PAD transmural en 7,7 mmHg (el sano, 8,7),
S/D 1,6/1,8, PF 35/17 %, renal continuo → grado 1; el mismo corazón con el mismo llenado respirando solo (PAD 4,1) tiene
la VCI de 15,7/16,7 mm y grado 0. Cirrosis: PF 32/35 % frente a 69/76 % sin cirrosis, gradiente portal 15,9/14,9 mmHg
(4,4/4,0), S −7,3/−6,8, renal monofásico → grado 3, y con «Cirrosis» sigue en 3 (la porta deja de contar); su lazo
cerrado es otro, porque la resistencia intrahepática queda en el camino del retorno venoso: Pmsf₀ 28,1 frente a 24,2 mmHg
y R_RV 2,32 frente a 1,37 mmHg·min/L. Cadena del alumno en apnea (puerta con ventana acústica, capturas cada 2 s como la
pestaña Medir): todas las capturas de la VSH verdaderas en las cuatro trampas, y la porta al 23–31 % en la PIA, 34–40 %
en la IT, 17–22 % con el ventilador y 34–42 % en la cirrosis. Con el ventilador ciclando, 5 de 10 semillas dan 1–2 de
10 capturas de la VSH con el visto bueno y una S invertida falsa: el texto de la trampa manda medir en la pausa
espiratoria. El alumno ve «Paciente A–G». Límites nuevos: `iah-no-renal-compression`, `iah-collapsed-ivc-velocity` (con
PIA 16 la retrohepática llega a 2,9 m/s con respiración tranquila, 3,4 en apnea inspiratoria y 5,3 tras un diurético de
1 L; la propiedad de las intervenciones solo le exige ahí < 8 m/s), `ppv-hepatic-capture-false-reversal`, `ivc-law-steep`
(el sano con PAD 6/7/8 mmHg mide 20,1/22,2/24,0 mm), `cirrhosis-hepatic-not-flattened`, `no-ascites`,
`small-liver-fixed-vessels`, `no-athlete-physiology`, `no-eskd-physiology`, `no-remodelled-ivc`, `no-stiff-rv-d-reversal`
y `blind-mode-screen-only` (los nombres de los casos y su `PatientState` siguen en el JS principal, y las opciones de los
casos de referencia nombran el diagnóstico).
Tamaño (vite build sobre 50f8390): el chunk principal pasa de 310,4 a 318,1 kB, el de la pestaña Docente de 7,8 a 12,2 kB
y el JS total de 947,5 a 959,6 kB, dentro del presupuesto (quedan 1,9 kB en el principal). Pendiente: una casilla para la
IT grave (hoy se interpreta sin ella) y el contexto que cambian las intervenciones (una PEEP aplicada no marca la
ventilación).
**Verificación.** `traps.test.ts` (lenta): cada trampa con respiración tranquila y en apnea da su discordancia y sus
controles la deshacen (sin la PIA, sin la IT, el mismo llenado sin ventilador y el corazón sin cirrosis); con los
parámetros de partida fallan 5 de las 8 pruebas y la PIA 20 rompe la propiedad de las intervenciones (5,6 m/s).
`examChain.test.ts` (lenta): en apnea, la cadena del alumno da el grado de cada trampa (0/2/1/3) y cada captura de la VSH
es no medible o verdadera; otra prueba afirma la S invertida falsa con el ventilador ciclando (la limitación).
`vexusContext.test.ts`: la ERC y el deportista no quitan un hallazgo normal, la cirrosis no quita una S invertida.
`cases.test.ts`: viñeta y notas para cada caso, semillas y nombres únicos, viñetas cortas, trampas con explicación,
confusores del clasificador y coherentes con la fisiología (FA con el ritmo, ventilación con el modo, PIA ≥ 12 mmHg de la
WSACS, cirrosis con la resistencia ≥ 2, ningún «sin ECG»). `blindMode.test.ts`: ninguna viñeta nombra el grado, la
congestión, la trampa o la PAD, y las notas son `null` para el alumno. `codeSplitting.test.ts`: `cases/teaching` solo lo
importa `app/teacherNotes`, y a este solo la pestaña Docente (falla si otro módulo del chunk principal lo importa).
`contextUi.test.ts`, con un DOM falso (`src/validation/support/fakeDom.ts`): el orden de las secciones, las siete
casillas sin marcar, los avisos y las líneas «no fiable» según el sentido de cada confusor, el intervalo 0–2 en lugar del
grado 0 con la PIA, el estado y la región viva, la nota de ±2 mm, el mVExUS, qué borra lo marcado (otro caso sí;
reiniciar, intervenir o «Borrar mediciones», no) y la pestaña Docente vaciada al apagar el modo; mata las mutaciones sin
borrar el contexto al cambiar de caso, sin sincronizar las casillas, sin pasar el contexto al grado y sin vaciar el lazo.
`interventions.test.ts`: la propiedad recorre también las trampas y otra prueba afirma la velocidad de la retrohepática
con la PIA. `circulation.test.ts`: el sobre del lazo en el punto del caso (Pmsf 10–25 mmHg, R_RV 1,1–1,5) vale para los
seis casos sin cirrosis, y la cirrosis sube la Pmsf₀ y la R_RV frente al mismo corazón. e2e «casos trampa»: el alumno lee
la viñeta, marca «Presión intraabdominal alta» y ve el aviso, sin la trampa en la pantalla ni en el DOM y sin su
explicación en ningún JS que haya descargado; otro caso desmarca; el docente ve las notas, el lazo y la verdad, que salen
del DOM al volver al modo alumno. Revisión adversarial de contexto limpio, en dos rondas: halló la prueba del lazo en
rojo, la S invertida falsa con el ventilador, la exclusión sin sentido, la S invertida de la PIA heredada de la IT (que no
prueba la congestión: la trampa la presenta como discordancia), los valores del docente en el DOM oculto, la ley de la VCI,
las respuestas en el JS del alumno, cifras medidas con otras semillas, «intervalo» para un grado único y el anuncio del
grado dentro de la pestaña oculta; todo corregido o declarado arriba (los nombres de los casos en el JS principal, en
`blind-mode-screen-only`).

## 83. Ventanas clásicas que faltaban: transversa epigástrica (VCI y aorta) y suprahepática subcostal

**Contexto.** El dueño (médico): «ventanas predeterminadas para que se vean las estructuras clásicas», siguiendo las
habituales y preferidas de VExUS de la revisión (`docs/anatomia/revision-normal.md`, sección 1). Las decisiones 69 (porta
lateral) y 75 (las ventanas como tarjetas) dejaron cinco puntos de partida y la tabla de brechas (sección 10) seguía
pidiendo dos: la transversa epigástrica (vértebra con su sombra en el centro de la base, aorta redonda ≤ 2,5 cm justo
delante y a la derecha del centro de la pantalla, VCI oval a la izquierda con hígado delante; hacia caudal el celíaco y la
AMS, hacia craneal las suprahepáticas en la VCI) y la suprahepática subxifoidea (subxifoidea sagital o subcostal
oblicua: VCI, VHM y AD, o las tres suprahepáticas convergiendo; PW de la VHM a 1–2 cm de la VCI).
**Opciones.** Para la suprahepática: (1) el «conejo» desde la punta del xifoides (transversa con el haz 26° hacia la
cabeza): las suprahepáticas se acercan a la VCI (a 1, 3 y 9 mm) pero cortadas de través, la media solo recorre 11 mm
del plano y no hay punto de su luz a 1–2 cm de la VCI donde poner la puerta; el abanico de las tres es casi coronal y la
sonda no bascula más de 40° (`clampPose`). (2) La subxifoidea sagital desde el punto de la subxifoidea de la VCI: su plano
corta el tronco común y la izquierda, no la media, y otro punto de partida a menos de 20 mm del suyo haría ambigua la
ventana actual (decisión 75) y taparía los anillos del 3D. (3) La elegida: la variante sagital (la VCI con la VHM) desde
debajo del reborde costal, con la VSH media en eje largo. Para la transversa: a la altura del celíaco (z −30) el celíaco
queda en el plano de partida y la lista lo pide hacia caudal; a z −40…−50 delante de la VCI están la porta y el colédoco
en lugar del hígado (47 % de hígado a z −40 frente a 87 %). Para el carril: dos columnas de tarjetas (93 px por línea:
recortaban nombres y subtítulos) o solo el nombre en pantallas bajas (quitaba lo que muestra cada ventana, el sentido de
la 75) frente a compactar las tarjetas (la elegida).
**Decisión.** Dos puntos de partida nuevos en `src/app/startPoints.ts`, en el carril tras la ventana de su territorio. Las
poses salen de búsquedas en CPU sobre la escena TS (la misma anatomía que dibuja la GPU) con el marco efectivo de la sonda
hundida y el tejido material (`probeContact` + `uncompress`, como la aplicación): un barrido de la transversa en la línea
media de z +10 a −80 y rejillas de ~40 000 poses (φ, z, giro, basculación e inclinación) para la suprahepática, con la
anatomía de la lista como condición y el ángulo de la VSH media a 1–2 cm de la VCI como objetivo, en espiración y en el
máximo descenso del diafragma de la respiración tranquila.

- **«Epigástrico»** (`epigastric`, anillo coral): línea media 2 cm bajo la punta del xifoides (φ π/2, z −20), transversa
  con el marcador a la derecha del paciente (giro −90°: su derecha a la izquierda de la pantalla) y el haz perpendicular.
- **«Subcostal · VSH»** (`subcostal`, anillo lima): 1,7 cm a la derecha de la línea media y 5,5 cm bajo el xifoides (φ
  1,68, z −55), bajo el reborde costal; marcador craneal girado 23° hacia la izquierda del paciente (0,4 rad), basculado
  14° y abanicado 23° hacia la derecha: el haz va 21° hacia la cabeza y 13° hacia la derecha. El margen es estrecho:
  moverla 1 cm, o girarla o abanicarla 5°, pierde la VSH media en eje largo.

Cada una lleva su línea en la tarjeta (`startPointCards.ts`). La ventana actual pide además el giro: el de la sonda a
menos de 45° del de la ventana por el arco corto (`CURRENT_WINDOW_YAW`, `yawDelta`); girada 180° no es la ventana (el
marcador al otro lado da la imagen en espejo y, con basculación o inclinación, otro plano: la subcostal girada corta la
aorta, la AMS y la vena renal izquierda). Sin el giro, una sonda sagital entre la subxifoidea y la epigástrica, a 15 y 17
mm, se marcaba «Epigástrico». La animación de la tarjeta (`probeAnimation.ts`) gira por el arco corto y termina en la pose
exacta cuando también la basculación, la inclinación y la separación han llegado: antes miraba solo φ, z y el giro, y
volver a pulsar la tarjeta tras abanicar (lo que pide la pista de la epigástrica) dejaba la inclinación en 0,42. La
entrada de teclado de la sonda (`probeInput.ts`) solo cuenta como mantenidas las teclas que la mueven: Intro sobre una
tarjeta, mantenida unos cuadros, llamaba a `setPose` sin mover nada y ese gesto «manual» cancelaba el deslizamiento que
la tarjeta acababa de pedir, así que con el teclado las tarjetas no llevaban a ninguna parte. Tarjetas de 40 px (dos
líneas de 16 px, relleno 3 px) y de 32 px en pantallas bajas (15 px, sin relleno), con 1 px entre ellas; el contorno del
foco, que cae en ese píxel, se pinta por encima de la tarjeta siguiente; en la tarjeta actual la línea lleva el color
del texto: el gris sobre el tinte de la ventana quedaba en 4,48:1 con la lima y en 4,497 con el verde de la subxifoidea
(`styles.css`). En el 3D, `windowLabelPositions` (`navigator3d/labels.ts`) sube hacia la cabeza el rótulo que pisaría
uno ya colocado: el de la epigástrica, a 3,2 cm de la subxifoidea y a su altura, queda 1,8 cm por encima de su anillo.
La estructura honda de la línea central que usa la prueba de la compresión pasa a una tabla por ventana
(`CENTRAL_LANDMARK`, exhaustiva: una ventana nueva declara la suya).
**Consecuencias.** Lo que se ve se cuenta sin lo que queda tras el gas o el hueso de su línea (espejo o sombra).
Transversa epigástrica (adulto sano, 61 líneas a 1 mm): acoplamiento 1,00 con 18,6 mm de hundimiento; la vértebra
centrada (x 0,0 mm) con la cara a 118 mm y 116 dB de sombra en sus primeros 10 mm; la aorta a 17 mm a la derecha del
centro, 21 × 18 mm y a 2 mm de la vértebra; la VCI a 22 mm a la izquierda, 20 × 13 mm, con 87 % de hígado en los 15 mm de
delante (el caudado y la lámina del ligamento venoso); las dos enteras a la vista; el cartílago del reborde costal
derecho en la esquina del campo cercano, sin hueso. La compresión de la sonda (63) acorta en profundidad también la aorta
(21 de alto sin ella; `probe-compression-kinematic`) y la VCI (16): su forma oval se mide frente a la aorta (1,51 frente
a 1,18 de ancho/alto). Deslizando hacia los pies: la esplénica desde 4 mm; el celíaco a 10 mm (z −30), con su luz a 1 mm
de la aórtica y 8,3 mm por delante de su techo; la AMS a 24 mm (z −44), pegada a la aorta, y 1 cm más abajo separada 6 mm
y con el centro 8,7 mm por delante; la vena renal izquierda entre ambas desde 40 mm. Abanicando 26° hacia la cabeza la
derecha y la media quedan a 1 y 3 mm de la VCI y la izquierda a 9, con un tercio tras el pulmón (sin abanicar, a 63 y
27 mm; la izquierda fuera); la aorta, que por encima de la cúpula va rodeada de pulmón, desaparece entera (0 de 103
muestras). Subcostal: acoplamiento 0,89 con 24 mm de hundimiento; la VSH media, entera a la vista, desemboca en el plano (a
1 mm del tronco común y de la VCI) y lo recorre 53 mm, bajando de derecha a izquierda de la pantalla hacia la desembocadura
(centroides a −29 y −62 mm); la derecha desemboca a su lado en un tramo corto (37 muestras); de la VCI se ven 94 de 215
muestras y de la AD ninguna. A 1–2 cm de la VCI la VSH media queda a 40° del haz en espiración y a 47° en la inspiración
tranquila, con peso de ventana 0,048 y 0,036 (la atenuación de 10 cm a 2,5 MHz; una sombra lo bajaría de 10⁻³), y la
puerta del operador (`bestGateOnVessel`) a 42° y 50°, a 27 y 56 mm de la VCI. Por encima de la cúpula todo es pulmón y la
AD no apoya en el diafragma (`mediastinum-is-lung`): no se ve desde la subcostal (0 de 303 muestras en el plano) ni desde
la subxifoidea de la VCI (0 de 669), cuya tarjeta y pista la prometen desde antes; esta decisión no toca las cinco
ventanas que ya había. Con GPU (M4) las dos imágenes muestran lo que promete la lista: la VCI oval junto a la aorta
redonda sobre la vértebra y la sombra, el celíaco y después la AMS con la vena renal izquierda en la pinza; la VSH media
que baja al tronco común y a la VCI, con la vesícula y el riñón en el lado caudal y el espejo del pulmón en el craneal.
Carril, con GPU: a 1600 × 1000 el bloque de las ventanas ocupa 335 px (267 con cinco), el lienzo del 3D 306 (346) y el
corte 190 (218); a 1280 × 800, 271 (229), 232 (257) y 144 (161); ningún texto recortado y ninguno bajo 12 px. Las
ventanas más próximas siguen a 24 mm (flanco e intercostal); las nuevas quedan a 32 y 38 mm de la subxifoidea y a 39 mm
entre sí. La equivalencia TS ↔ GLSL de la e2e barre siete ventanas por caso; la epigástrica tiene 25 celdas interiores de
sangre en el sano (66 y 55 en los congestivos) y su comprobación de dientes pide más de 15. El banco de fidelidad
conserva sus cuatro vistas (como con la porta, 69). Con el retroperitoneo (decisión 81) las pruebas de las ventanas dan
las mismas cifras: la grasa retroperitoneal rodea la aorta y la VCI conserva el hígado delante. Limitaciones nuevas: el mediastino de pulmón (`mediastinum-is-lung`), la vértebra
sin cortical (`vertebra-no-cortex`: su cara anterior no brilla y el cuerpo se ve como una cúpula oscura sobre la sombra,
pendiente desde la 69), la aorta que no late en modo B (`aorta-fixed-caliber`) y la sonda que no pasa de 40°
(`probe-angle-40deg`, el «conejo» incompleto). Pendiente: apoyar el corazón en el centro tendinoso y dar al mediastino su
tejido (la tarjeta y la pista de la subxifoidea prometen la AD), la cortical vertebral y los rótulos «Porta · lateral» y
«Renal», que se pisan en la vista del 3D (desde la 69, a 1,9 cm de altura entre sí).
**Verificación.** `startPoints.test.ts`, sobre lo visible: la epigástrica con la vértebra centrada (±5 mm), > 20 mm por
detrás de la aorta y de la VCI y con la cara a 10–14 cm, su sombra (> 60 dB), la aorta a la derecha del centro (5–35 mm),
apoyada (< 5 mm) y redonda (≤ 25 mm, ancho/alto < 1,3), la VCI a la izquierda y más aplanada que la aorta (+0,15), las
dos enteras a la vista, con hígado delante (> 70 %), sin hueso; hacia los pies el celíaco antes que la AMS, las dos
saliendo de la aorta (< 3 mm, por delante de su techo) y la AMS separada 1 cm más abajo; hacia la cabeza dos
suprahepáticas a < 5 mm de la VCI y las tres a < 12 (a > 20 sin abanicar). La subcostal con la VCI y el tronco común a la
vista, la VSH media en el plano > 45 mm hasta ellos y la derecha desembocando, sin hueso, y la desembocadura a la izquierda
de la VSH media (con el marcador al revés todo lo demás se cumple igual); la VSH media a 1–2 cm de la VCI y la puerta del
operador a ≤ 60° y con ventana (≥ 0,02) en espiración y respirando. Un canario de `mediastinum-is-lung`: la AD que cortan
la subxifoidea y la subcostal y la aorta de la epigástrica abanicada, cortadas y ocultas. `startPointCards.test.ts` (cada
ventana es la actual en su pose; entre la subxifoidea y la epigástrica decide el giro; a 45°, girada 180° o con un giro
NaN no hay ventana), `probeAnimation.test.ts` (de cada ventana a cada ventana termina en la pose exacta; deshace el
abanico; de +172° a −90° gira 98°; un gesto la cancela), `compression.test.ts` (tabla exhaustiva), `styles.test.ts`
(tarjetas de 40 y 32 px; la lista de las siete ≤ 290 y ≤ 230 px; texto ≥ 12 px; ≥ 4,5:1 en la tarjeta actual con el color
de cada ventana; el foco por encima), `navigator3d.test.ts` (la regla de los rótulos en la escena, no en pantalla, y solo
sube el de la epigástrica), la e2e de equivalencia con siete ventanas y una e2e nueva: Intro mantenida sobre la tarjeta
«Epigástrico» mientras el reloj de la simulación avanza medio segundo lleva la sonda desde la pose por defecto hasta
φ 90°, z −2 cm y la deja resaltada. Mutaciones que las pruebas matan: la entrada de teclado de antes (en la e2e la sonda
se queda en φ 166°, z 0,8 cm), el marcador a la izquierda (la aorta a −17 mm y el abanico, hacia los pies), la
epigástrica a z −40 (47 % de hígado y el celíaco por encima), 2 cm a la derecha (la vértebra a 6,3 mm), la subcostal
girada 5° (la VSH media a 7,7 mm de la VCI, sin puerta), sin abanicar (sin VSH media) o con el marcador al revés (la
desembocadura a +62 mm), la animación de antes (3 de sus 4 pruebas: el abanico se queda y el giro da la vuelta larga) y
la tarjeta actual sin su regla de color (4,497:1). Dos revisiones adversariales de contexto limpio. La primera halló la AD que se prometía y no se ve, la
ventana actual sin giro, la animación que no deshacía el abanico, el contraste, una prueba de rótulos que no podía fallar
(ahora dice lo que comprueba: la regla en la escena, no la pantalla), textos que exageraban y la VCI «oval» solo por la
compresión. La segunda, que la ventana actual aceptaba la sonda girada 180°, que el teclado no llevaba a ninguna ventana,
que las pruebas de la subcostal no veían el marcador al revés, la aorta perdida al abanicar sin declarar, el foco tapado y
textos que ya no casaban. Todo corregido arriba, salvo la AD que prometen la tarjeta y la pista de la subxifoidea, que es
de antes y queda declarada. Capturas con GPU (M4) a 1600 × 1000 y 1280 × 800 antes y después, y de las dos ventanas, de
los cortes hacia los pies y del abanico hacia la cabeza.

## 84. PSF que cambia con la profundidad: bajada de la frecuencia central, pulso de la banda de cada modo, emisión apodizada y banda del foco

**Contexto.** Ronda 3 del juez ciego (26-09-2026, `docs/fidelity/juez-ciego.md`): 21/21 detectadas y la pista número uno
en las 7 simuladas, «moteado estacionario»: el mismo grano, contraste y brillo a toda profundidad, sin zona focal, sin
engrosamiento por la bajada de la frecuencia ni estiramiento lateral, bordes igual de borrosos en axial y en lateral. El
haz de la decisión 38 tenía la PSF lateral en ~1,4 mm de 3 a 9 cm, el pulso fijo (σ 0,26 mm), ninguna bajada de la
frecuencia central y un foco de emisión que solo entraba en la anchura lateral: mover «Foco» apenas cambiaba la imagen.
Antes de tocar nada se midió (banco ampliado con el grano de la envolvente en dB y de la imagen mostrada por bandas, y
los paneles del juez con la misma normalización para reales y simuladas; mm con la escala del recorte simulado, que
tomó el campo de visión de cada real, ±30 %):

- Simulador (GPU M4, armónica y compuesto, intercostal a 20–60 / 60–100 / 100–140 / 140–180 mm): grano de la imagen
  0,80 / 0,79 / 0,72 / 0,78 mm en axial y 1,74 / 1,90 / 3,07 / 3,45 mm en lateral; gris 101 / 99 / 96 / 96 con DE
  12,6 / 13,5 / 14,1 / 11,9. El estiramiento lateral en profundidad sí existía: sigue a la PSF (1,41 → 3,42 mm) y
  sobrevive a la conversión de barrido (la imagen, 1,0–1,25 × la PSF). Lo que no cambiaba era el eje axial.
- Paneles del juez (las 7 reales frente a la ronda 3): el grano axial real es más grueso (1,1–1,9 mm frente a 0,8–1,2) y
  crece hacia lo hondo en 5 de 6 parejas (0,87 → 1,29, 0,91 → 1,14, 0,93 → 1,38 mm); el lateral, 1,4–4,0 frente a
  1,8–3,4 mm. La hipótesis del juez de una resolución «casi isótropa» no se sostiene: el simulador era MÁS anisótropo que
  las reales (lateral/axial 1,8–3,2 frente a 1,4–2,9, mediana ~2). Y el contraste del gris (DE/media) real, 0,16–0,31 y
  creciente con la profundidad, frente a 0,12–0,14 plano en el hígado simulado.

**Opciones.** (1) Solo abrir la PSF lateral con otras aperturas: agranda la anisotropía, que ya pasaba de la real. (2) Un
filtro de reducción del moteado del equipo (SRI, XRES): el contraste simulado ya es menor que el real, así que lo alejaría
(punto e, descartado; el grano axial real más grueso con bordes nítidos sugiere un filtro que preserva bordes, pero siete
paneles JPEG de proceso desconocido no bastan para calibrarlo). (3) La elegida: la física del haz que cambia con la
profundidad, en TS (`beamModel.ts`, `bmodeBeam` de `transducerProfile.ts` y, para el banco y los gemelos, `beamEcho.ts`)
y en el GLSL con la misma fórmula.

**Decisión.**

- **(a) PSF lateral.** La recepción conserva D_rx ≤ 26 mm y F# ≥ 2,5: es la cuerda útil de un convexo con la
  directividad del elemento a −3 dB (criterio de Perrot et al. 2021, Ultrasonics 111:106309; para un C5-2 de R 49,6 mm,
  18 / 27 / 29 mm a 4 / 10 / 14 cm) [DERIVADO]. La emisión de la imagen B va apodizada con una ventana de Hann (FWHM en el
  foco 2,0·λ·F#, Harris 1978, Proc IEEE 66:51; fuera de él, medio cono) con la apertura min(26 mm, F/2,5), el número F de
  la recepción [EXTRAPOLACIÓN PROPIA: la apodización de emisión de un equipo no está publicada]. Con la bajada de (b), la
  PSF de dos vías mide 1,5 mm hasta 6 cm, 1,9 mm en el foco por defecto, 2,2 mm a 10 cm y 3,4–3,8 mm a 15 cm (4,9 mm a 18
  cm en fundamental), dentro de la resolución característica de 78 convexos abdominales (1,6–3,0 mm, lateral y elevación
  juntas; Pye y Ellis 2011, J Phys Conf Ser 279:012009) y del peor lateral de 23 convexos en maniquí (2,71 mm; Cilia y
  Camilleri 2023, Med Phys Int 11:304). El Doppler conserva su haz (`CONVEX_BEAM`).
- **(b) Bajada de la frecuencia central.** Con un espectro de ida y vuelta gaussiano, df/dr = −2·β·σ_f² (Samimi y
  Varghese 2015, IEEE TUFFC 62:871; con la atenuación lineal en f la banda no cambia, Narayana y Ophir 1983). Se usa su
  forma de ancho de banda fraccional constante, f(r) = f0/(1 + κ·r) con κ = 2βσ_f²/f0: la del filtro de seguimiento de
  los equipos, que baja la frecuencia central, la banda y el corte alto al ritmo del eco (patentes US 4 016 750, 1977, y
  US 6 516 667, 2003, también en armónica), así que λ(r) = λ·(1 + κr) en las dos vías de la PSF lateral y el pulso axial
  se alarga en la misma proporción (`axialSigmaMm`, pasada C con σ por fila). β es la del hígado del modelo (0,601
  dB/cm/MHz; 0,50–0,55 medido en hígado normal, Taylor et al. 1986, Lu et al. 1999), el tejido que compensa la TGC
  nominal. Banda del eco: 45 % en fundamental (un C5-2 medido centrado en 3,1 MHz con el borde bajo a −6 dB en 2,4 MHz;
  Deng et al. 2017, IEEE TUFFC 64:164) y 35 % en armónica, el segundo armónico de una emisión en el borde bajo, que se
  recibe en el alto [EXTRAPOLACIÓN PROPIA]. Queda 3,5 → 2,97 → 2,77 MHz a 10 y 15 cm en fundamental y 3,16 / 3,02 en
  armónica; la emisión del armónico, a f1, baja la mitad. La armónica, de banda más estrecha, tiene el pulso más largo
  (σ 0,30 mm frente a 0,26, `pulseSigmaMm`: el filtro de la imagen se calibra con el fundamental; el modo armónico pierde
  resolución axial en maniquí, van Wijk y Thijssen 2002, Ultrasonics 40:585). La fase de las miradas dirigidas (decisión 58, y con ella la dirección con que la textura de la pared ve cada mirada) y la coherencia de curvatura del eco de interfaz (decisión 57, lateral y elevacional) van a la frecuencia del eco; la rugosidad fina (Ament) conserva el k0 nominal con que se ajustaron sus σz.
- **(c) Banda del foco.** `focalGain`, la ganancia de haces gaussianos de potencia fija: la intensidad en el eje va
  como 1/FWHM en la emisión y, por reciprocidad, en la sensibilidad de la recepción, y el eco de un medio difuso,
  ∫|h_tx|²·|h_rx|² a lo ancho del haz, como 1/√(FWHM_tx² + FWHM_rx²); en armónica el armónico nace como p1² y su
  intensidad va como la de la emisión al cuadrado. En amplitud, (FWHM_tx,ref/FWHM_tx)^(n − ½)·√(|FWHM_ref|/|FWHM|),
  n = ½ en fundamental y 1 en armónica, con la referencia fija en los haces del foco del preajuste (90 mm) [DERIVADO].
  Con el foco por defecto vale 1 en el foco (el hígado a media escala de la decisión 53) y −4,1 / −3,9 dB a 20 / 150 mm
  en fundamental, −5,0 / −4,7 dB en armónica; con otro foco la banda se mueve y su pico sigue a su cintura (+1,7 dB con
  el foco a 50 mm y −2,2 dB a 140 mm en fundamental, +3,0 y −4,1 dB en armónica), con la cima plana y algo antes de un
  foco hondo (a 122 mm con el foco a 140: pasada la apertura máxima, la recepción se ensancha con r). Multiplica el eco
  en la pasada B, en las dos miradas, antes del transitorio y del ruido (no el Doppler): las líneas A del gas y la serie
  de la pleura la toman a la profundidad mostrada (la imagen de un reflector plano) y las réplicas de la pared de la
  pasada C (decisión 76), a la de su eco de origen. La amplitud media del eco culmina en el foco (Oosterveld, Thijssen y
  Verhoef 1985, Ultrason Imaging 7:142); en el montaje de Bottenus 2018 (IEEE TUFFC 65:30; sectorial de 19,2 mm a 2,98
  MHz con el foco de emisión a 40 mm) la señal cae 8,2 y 9,6 dB a 10 y 95 mm frente a enfocar en cada profundidad, y el
  modelo, con emisión uniforme, da 10–13 y 7,5 dB. La penumbra de la pasada A (decisión 54) usa la apertura de emisión
  del foco. El banco compara ecos de distintas profundidades con la corrección de difracción (`envelopeLine` quita la
  ganancia focal, como el método del maniquí de referencia; Yao, Zagzebski y Madsen 1990, Ultrason Imaging 12:58); la
  imagen mostrada la conserva.
- **(d) Conversión de barrido.** Medido, no cambia: con 192 líneas a 1,1–1,5 mm en lo hondo y σ lateral de 1,1–2,1 mm,
  hay ≥ 1 línea por σ y la bilineal conserva el estiramiento (imagen/PSF 1,0–1,25 en todas las bandas).
- **(e) Suavizado del moteado:** no (arriba).
- Sin ranuras de uniforms nuevas en B (126/128, 128/130 con el retroperitoneo): la bajada viaja en `uBeamTx.zw` (antes
  vec2), la apodización en el cono de `uBeam.y` y en `uBeamTx.x`, y la referencia y el exponente de la ganancia focal
  en `uFocus.yzw` (antes float). La pasada C recibe σ por fila (`uSigmaTexels`, vec2). Gancho `setFocus` (el comando del deslizador).

**Consecuencias.** Banco con GPU (M4), antes (`main` c6c81ad; hasta 59fb7b1 nada toca la imagen) → después, en
armónica y con el compuesto, intercostal a
20–60 / 60–100 / 100–140 / 140–180 mm: grano de la imagen 0,80×1,74 / 0,79×1,90 / 0,74×3,27 / 0,82×3,63 → 0,88×1,79 /
0,88×2,01 / 0,83×3,10 / 0,90×3,59 mm (axial × lateral; 4–20 ventanas por banda, las hondas ruidosas); PSF 1,41 / 1,57 /
2,46 / 3,42 → 1,46 / 1,76 / 2,62 / 3,71 mm; gris 101 / 99 / 96 / 96 → 92 / 98 / 90 / 79 y DE 12,6 / 13,5 / 14,1 / 11,9 →
11,7 / 13,6 / 15,1 / 11,4. Subxifoidea: grano 0,81×1,81 / 0,78×1,84 → 0,91×1,83 / 0,88×2,03 mm; gris 99 / 97 → 91 / 96.
En fundamental, gris 101 / 99 / 96 / 96 → 93 / 98 / 90 / 82. Con el deslizador (fundamental, una mirada, densidad 1),
gris a 20–60 / 60–100 / 100–140 / 140–180 mm: 104 / 94 / 82 / 75 con el foco a 50 mm, 92 / 98 / 94 / 86 a 90 y 88 / 88 /
94 / 88 a 140 (antes, 101 / 99 / 95 / 95 con cualquier foco). Paneles del juez (la misma normalización), pareja 1
(hígado con vena hepática): axial 0,80–0,94 → 0,90–1,06 mm frente a 1,12–1,32 real; lateral 1,83–2,41 → 2,01–2,62 frente
a 1,82–1,96. En las seis parejas con hígado o riñón el axial sube un 4–14 % y el lateral un 0–14 %: la anisotropía no
cambia (lateral/axial 1,8–3,1 frente a 1,4–2,6 real) y el contraste (DE/media), 0,12–0,22, sigue bajo el real
(0,16–0,31). El grano axial real sigue más grueso en cuatro de las seis (hasta un 40–65 % en el riñón) y crece de arriba
abajo del panel (+14–48 % en cuatro de cinco), cuando el simulado apenas cambia (−20 a +17 %); la textura real tiene
además heterogeneidad y proceso del equipo que el modelo no tiene. La banda del foco se ve: en armónica el hígado a 14–18
cm queda 17 grises (−5,5 dB) bajo el del foco y la pared del campo cercano de la pareja 6, 70 → 55 de media frente a 79
real, porque la TGC nominal no compensa la banda (`psf-nominal-tissue`). El campo cercano de la armónica frente al
fundamental, con GPU, −3,4 → −4,7 dB (el tejido, +0,1 → −0,1 dB; el ruido, +3,2 dB). Calibraciones: el gemelo de las
caras (decisión 57) cambia poco a incidencia normal (porta 1,616 → 1,639, VCI 1,610 → 1,645, VSH 1,512 → 1,541, cápsula
1,784 → 1,778, Morison 2,163 → 2,186, diafragma 2,140 → 2,146) y baja algo en las caras oblicuas, que la PSF más ancha
reparte (porta a 40° 1,397 → 1,373, VSH a 40° 1,131 → 1,107). Con GPU (banco completo, fundamental y compuesto) las
paredes de vaso a 0–20° se mueven ±0,05 (subxifoidea 1,44 → 1,40), Morison 2,26 → 2,35 (ya sobre 2,2 desde la decisión
81), las líneas de la pared (+4–14 dB sobre el hígado) se mueven ≤ 1,5 dB, la neblina de la cortina baja 6–7 grises y
la composición no cambia (N_eff 1,48–1,70 a 20–60 mm, como antes). La mediana del hígado entero baja 5–12 grises (98–104 → 86–95: el hígado fuera del
foco) y el perfil en profundidad deja de ser plano (−0,25 → +0,43 dB/cm en la subxifoidea, cuyo hígado sube hacia el
foco); G4 (media escala en la banda del foco: 98) y el hígado de la e2e (92, > 85) se cumplen. Coste (GPU M4, carga
8–28, antes y después intercalados): cuadro 9,59 → 9,70 ms sin compuesto y 10,57 → 10,69 con él; pasada B 3,28 → 3,34
ms. Arranque con SwiftShader frente a 59fb7b1 (carga 5–10, tres rondas intercaladas): 42,4 / 27,3 / 26,5 → 26,3 / 25,1 /
35,3 s, sin tendencia. Chunk principal 313,8 → 315,4 kB de 320 sobre 59fb7b1 (los gemelos en TS de la ganancia focal y
de la bajada, en `beamEcho.ts`, quedan fuera de él).

**Verificación.** `psfDepth.test.ts`: la pendiente −2βσ_f² (−0,092 MHz/cm con 60 % de banda y 0,5 dB/cm/MHz), f(r)
monótona y > 0, el pulso ∝ 1/f(r) y el de la armónica más largo, la PSF lateral 1,4–3 mm a 6–10 cm que crece después y
no pasa de 5,5 mm a 18 cm, la apertura de emisión min(26, F/2,5) (el Doppler, 26), la ganancia focal (1 en el foco del
preajuste, la integral de los haces gaussianos en los dos modos, su pico a ≤ 15 % antes del foco elegido, −3,5 a −5 dB a
2 cm en fundamental y más en armónica, la potencia fija), el GLSL con las mismas fórmulas (también la coherencia de
curvatura de las caras) y el cableado del renderizador real sobre WebGL falso (cono, referencia y exponente, σ por fila,
la penumbra de A, en los dos modos y con el foco a 50 y 90 mm). `harmonic.test.ts`, `pleura.test.ts`,
`steeredSample.test.ts`, `retroTexture.test.ts` (la dirección de la mirada con el k2 de su fase) y `shaderLimits.test.ts`
(huella del main de B d2e0f2cd7f45185c → ca057917ce3a1b32: el eco lleva `focalGain`) al día. Gemelos B → C → D con el
pulso por fila, la PSF de la imagen B y la ganancia focal: `compoundSpeckle.test.ts` (la ley de la composición con k2 a la
frecuencia del eco; el exceso de decorrelación de los tres planos, artefacto fijado, baja a −0,025 a 90 mm),
`interfaceTwin.test.ts` (la tendencia con la profundidad de una cara normal, con el pulso más largo, frente a haces
gaussianos coherentes a la frecuencia del eco; M3 de la porta ≥ 1,36, el borde bajo de las paredes reales),
`wallTwin.test.ts` (métricas con la corrección de difracción), `pleuraTwin.test.ts` (la PSF, el pulso y la ganancia focal
de la imagen B; sus niveles, con la corrección de difracción) y `fidelityScene.test.ts`; `interfaceEcho.test.ts` con la
anchura del eco del pulso a 80 mm (0,77 mm). e2e: «foco (decisión 84)» (el deslizador mueve la banda: +8 de gris o más a
20–60 mm con el foco a 50 frente a 140 mm, y al revés a 140–180 mm), G4 de la composición a media escala en la banda del
foco y el campo cercano de la armónica < −2 dB, como antes. Capturas con GPU antes y después de la intercostal, la
subxifoidea, el flanco y la renal en armónica y en fundamental, y de la intercostal con el foco a 50 y a 140 mm.
Revisión adversarial de contexto limpio: la ganancia focal de la armónica iba como la raíz (corregido: la fuente p1²), la
textura de la pared y la del psoas en las miradas dirigidas con el k2 nominal, la ley del compuesto del banco con el k2
nominal, el gemelo de la pleura sin la PSF nueva y la penumbra de A con la apertura fija (corregidos); la rugosidad con el
k0 nominal y las reverberaciones, documentadas; la recepción en la ganancia focal, añadida. Limitación nueva
`psf-nominal-tissue`.

## 85. Corazón y mediastino: la AD recibe la VCI sobre el diafragma, el VD delante tras el xifoides, pericardio y tejido del mediastino en lugar de pulmón

**Contexto.** Por encima de la cúpula todo lo que no era corazón ni vaso era pulmón, y la aurícula derecha, una esfera de
30 mm de radio centrada en (−15, 15, 95), no apoyaba en el diafragma: su polo inferior (z 65) quedaba 10 mm por encima del
ápice de la cúpula (55) (`mediastinum-is-lung`, decisión 83). Desde el abdomen el haz se reflejaba en ese pulmón (su espejo,
decisión 57) antes de llegar a lo que había detrás: a 1 mm en 61 líneas, la AD no se veía desde la subxifoidea ni desde la
subcostal (0 de 669 y 0 de 303 muestras en el plano) aunque la tarjeta y la pista de la subxifoidea la prometen; la VCI se
veía hasta el borde del espejo (de la suprahepática, 109 de 255 muestras en la subxifoidea y 92 de 213 en la subcostal), y
al abanicar la epigástrica 26° hacia la cabeza la aorta, rodeada de pulmón por encima de la cúpula, desaparecía entera (0
de 103). Entre el diafragma y la VCI supradiafragmática quedaba además una lámina de pulmón de décimas de milímetro
(`lung-sliver-caval-hiatus`). La ronda 3 del juez ciego señaló en la subxifoidea «una zona oscura con un borde curvo y sin
correlato anatómico» y «VCI de paredes paralelas y calibre constante». Para VExUS la zona importa: la VCI se mide a 1–2 cm
de la unión con la AD y la subxifoidea en eje largo muestra la VCI entrando en la aurícula con la VHM desembocando cerca
(`docs/anatomia/revision-normal.md`, sección 1). Un paciente real muestra ahí el corazón y el mediastino posterior.
**Opciones.** (1) Solo bajar la esfera hasta la cúpula: seguiría rodeada de pulmón por delante y por detrás, su espejo
taparía media aurícula y la aorta seguiría perdida. (2) Una malla segmentada de TC: fiel, pero decenas de kB de datos y de
GLSL cuando al chunk principal le quedaban ~2,9 kB y la pasada B está en 130 ranuras de uniforms. (3) El pericardio como
tercer tejido nuevo: con 33 tejidos `TISSUE_VEC4` pasa de 8 a 9 y la pasada B gana dos ranuras (`uTissueBack4`,
`uTissueClump4`). (4) La elegida: un esquema de cuatro elipsoides con su miocardio, tabiques y recorte por la cúpula; el
pericardio como la capa de 1,5 mm del tejido del mediastino que dibuja su cara; el mediastino, grasa alrededor del saco unida
a la columna del mediastino posterior; constantes en el GLSL y ninguna ranura nueva.
**Decisión.** Módulo de órgano `anatomy/organs/heart.ts` (TS y GLSL con los mismos nombres; las constantes del shader salen
del TS en dos arrays, `HV` y `HW`), marco levógiro (x = izquierda del paciente):

- **Cavidades** (sangre anecoica): VI y VD en el marco de los ventrículos, con el eje largo 45° a la izquierda del plano
  sagital y 29° hacia abajo, de la base (atrás, arriba, a la derecha) a la punta (delante, abajo, a la izquierda, x > 50);
  el VI centrado en (39, 30, 50) con semiejes 37 × 21 × 21 mm. El VD es una media luna: su elipsoide (40 × 22 × 32 mm) menos
  lo que queda a menos de 9 mm de la cavidad del VI (el tabique interventricular), delante y a la derecha del VI y apoyado
  en la vertiente anterior del diafragma, detrás del xifoides. La AD, un elipsoide de 22 × 21 × 30 mm centrado en
  (−22, 6, 70) e inclinado 25° hacia delante por arriba (`RA_TILT`): su suelo, atrás, recibe la VCI y su parte alta queda
  delante y a la derecha de la AI; menos lo que queda a menos de 4 mm de la AI (tabique interauricular) y de 6 mm del VI
  (tabique auriculoventricular). La AI (24 × 14 × 23 mm, centrada en (13, 5, 83)), la más posterior, delante de la aorta y
  apoyada en la base del VI. Tricúspide y mitral son orificios abiertos donde las cavidades se solapan (la mitral, de
  14–20 mm), sin valvas. Volúmenes (rejilla de 1,5 mm): VI 63 mL, VD 45, AD 36, AI 32; la AD mide 45 mm craneocaudales y
  41 laterolaterales (ASE/EACVI 2015: ≤ 53 y ≤ 44 mm). El VD basal (23–27 mm en el plano de cuatro cámaras) y la AI (27 mm
  AP) quedan en el límite inferior de la ASE: el tórax del modelo es poco profundo (106 mm de la cara anterior de la
  vértebra a la pared anterior).
- **Miocardio** (tejido nuevo `Myocardium`: IT'IS «heart muscle», c 1561 m/s y ρ 1081 kg/m³, 0,52 dB/cm/MHz de Duck 1990;
  retrodispersión 0,4 de la del hígado, hipoecoico [ESTIMADO]): pared libre del VD 4 mm, de la AD 2, de la AI 2,5, del VI 8 y
  tabique interventricular 9 mm.
- **Apoyo en el diafragma:** el corazón solo existe por encima de la cúpula (`sdDiaphragm` < 0) y sus cavidades y su
  miocardio se recortan a su pared y al pericardio por encima del suelo (`heartFloor`): la cara inferior apoya plana en el
  centro tendinoso y en la hemicúpula izquierda. El suelo es la distancia a la cúpula con su pendiente limitada a 2,
  dDome·max(1, pendiente/2): en el borde de cada hemicúpula su altura sube con tangente vertical, `sdDiaphragm` casi se
  anulaba en toda la columna de encima y el recorte levantaba cortinas de miocardio de 1–1,5 mm que partían el VD (visibles
  en la subcostal de cuatro cámaras, la epigástrica abanicada 39,5°) y aletas de grasa en el pulmón. La GPU saca la
  pendiente de la normal de la cúpula que ya calcula (n.z = −1/pendiente). En el pliegue entre las hemicúpulas, convexas,
  el plano tangente se queda hasta 2,2 mm corto: la pared inferior del VI es allí algo más gruesa.
- **Pericardio:** la capa de 1,5 mm que envuelve el miocardio (y la que queda entre el suelo y el miocardio recortado) es
  tejido del mediastino que dibuja la cara nueva `Interface.Pericardium`, de un lado. Con el modelo de la decisión 65: suelo
  0,15 (el pericardio fibroso es colágeno denso, Z ≈ 1,85–2,0, contra grasa: Γ ≈ 0,15–0,19 [LITERATURA aprox.]; el Fresnel
  mediastino/miocardio es 0,10), σz 0,06 y s 0,2 como las cápsulas [ESTIMADO]: con K = 55 dB, +22,7 dB sobre el moteado del
  hígado a 0°, +16,6 a 20° y −10,9 a 40°, con la difusa a +10,9 dB (la cápsula renal: +21,9, +15,8, −11,7 y +10,1); con
  s 0,3, la de la primera versión, quedaba a +7 dB a 40° y dibujaba el contorno entero del corazón. Su normal en la GPU es la
  del elipsoide de la cámara más cercana (o la de la cúpula donde el saco apoya), con norma 1; en TS, el gradiente numérico
  de su distancia (`faceSdf('pericardium')`: el epicardio recortado), a 0,9995 en la mediana (p01 0,986) y con |∇| a 1,1 %
  de 1 en la mediana y 6,5 % en p95 (≤ 0,6 dB en su eco).
- **Mediastino** (tejido nuevo `Mediastinum`: grasa con tabiques conectivos, c 1460, ρ 940, 0,5 dB/cm/MHz, retrodispersión
  1,0 con grumos 0,6 [ESTIMADO]): 5 mm de grasa alrededor del saco y, alrededor de los ventrículos, 15 mm más junto a la
  cúpula (la grasa de los ángulos cardiofrénicos, que se anula a 20 mm por encima: sin ella quedaba pulmón entre el corazón
  y el diafragma; junto a las aurículas y la VCI el pulmón baja hasta el saco), unida de forma suave (16 mm) a la columna
  del mediastino posterior, un cilindro elíptico en z desde la cúpula hasta z 130 (centro (6, −18), semiejes 27 × 16 mm)
  alrededor de la aorta torácica, el esófago y la ácigos, que no se modelan aparte. El resto del tórax sigue siendo pulmón,
  a los lados y detrás. Una esfera de descarte (centro (22, 16, 60), radio 94 mm; el tejido que no es pulmón llega a 90,7 mm)
  evita evaluar el corazón en el pulmón lateral.
- **VCI:** la suprahepática gana un nodo en el hiato de la cava (z 53, T8) con un 10 % de cintura [ESTIMADO] (radio 10,2 →
  9,2 mm; hasta 1,65 mm menos que antes a z 50–55) y se abre en el suelo de la AD (12 y 12,5 mm; antes se ensanchaba sin
  cintura y seguía 20 mm dentro de la esfera). En el sitio de medida (1–2 cm caudal a la unión, z 37–47) el radio cambia
  menos del 1 % (10,30 → 10,20 mm a z 47). Dentro de la cavidad de la AD, con sus tabiques tallados, su pared es sangre de la
  aurícula (antes, un anillo de pared dentro de la cavidad negra) y su luz conserva el flujo, sin cara; fuera de ella, a
  más de 5 mm sobre el suelo (`IVC_ORIFICE_MM`: el suelo de la aurícula), la VCI no existe y gana el corazón: su embudo no
  atraviesa paredes ni tabiques ni entra en la AI cuando la congestión la dilata (×1,57 en los casos; la primera versión
  miraba el elipsoide de la AD sin tallar y la luz de la VCI, con su flujo, borraba el tabique interauricular y entraba en la
  AI en cinco de los siete casos). Con el calibre del sano la tapa del embudo ya roza el tabique interauricular (el limbo de
  la fosa oval), que sigue siendo tabique. `classify` calcula la cúpula una vez antes de los tubos (en la GPU, la misma
  llamada, antes).
- **Distancia a la frontera:** la del tórax cuenta también la columna y la pared (como el retroperitoneo): sin ellas, junto
  a la vértebra el mediastino daba 5,85 mm con el hueso a 1,17. Con el suelo corregido, ninguna muestra de sangre, miocardio
  o mediastino con la frontera a más de 2 mm y un cambio de tejido a menos de 1,5 (el atajo de la muestra lateral de la
  pasada B): antes, 52 de 3629 de sangre y 95 de 6271 de mediastino. Dentro de las cavidades la distancia del elipsoide
  aproximado sobrestima hasta ~11 mm cerca del centro del VI, donde la de verdad pasa de 15 mm.
- **Presupuestos:** la pasada B sigue en 130 ranuras (se va `uRA`, entra la fila del pericardio en `uIface`); `TISSUE_VEC4`
  sigue en 8 (32 tejidos llenan sus ranuras). El chunk principal crece 3,7 kB (317,1 → 320,8 kB, vite build sobre main
  e37f5d2) y su presupuesto sube de 320 a 325 kB (`tools/ci/bundle-budget.ts`): la documentación de los uniforms de la
  escena, que viajaba en el bundle (~2,1 kB) solo para acabar como comentario del GLSL, pasa a comentarios del TS, y los
  motivos largos de la fila del pericardio y de su gemelo solo GPU, también. La fuente GLSL de los programas (sin minificar)
  crece de 527 a 546 kB (+3,7 %: ~2,7 kB en cada programa que clasifica; el corazón minificado, 2 kB), con una sola llamada
  a `epiNormal`.
- **Espejo:** el pulmón cuya frontera más cercana es la del mediastino (y no la cúpula) deja en `c.n` la normal de esa
  frontera, la del elipsoide de la cámara más cercana, la del costado de la columna o la de su tapa (+z), para el espejo de
  la pasada A (`epiNormal`, solo GPU, la misma que la del pericardio).
- **Docente y 3D:** colores y rótulos del miocardio, del mediastino y de cada cavidad (AD y VD en azul, VI y AI en rojo)
  en el corte; en el 3D, la malla del epicardio (la misma distancia que la imagen) en lugar de la esfera.

**Consecuencias.** Muestras visibles / cortadas a 1 mm en 61 líneas (sano): subxifoidea, AD 0/669 → 296/345, con su centro a
10,7 cm y la luz de la VCI a 1 mm de su cavidad, y la VCI entera (suprahepática 109/255 → 196/196); subcostal, AD 0/303 →
99/143 más allá de la VSH media y la VCI entera (suprahepática 92/213 → 161/161); epigástrica abanicada 26°, aorta 0/103 →
103/103, en el mediastino; flanco, AD 0/18 → 25/76. En la subxifoidea, entre el hígado y la aurícula están el diafragma y
el pericardio, sin pulmón; en su plano ya no hay espejo del pulmón, así que el banco de fidelidad y la e2e de los ecos de
interfaz miden el diafragma en la subxifoidea abanicada 25° hacia la derecha del paciente (18 registros en el gemelo, como
los 17 de antes). El espejo de la cúpula se pierde donde el haz llega a ella bajo el corazón o junto al mediastino
posterior: las líneas de la prueba del espejo de la decisión 61 bajan de 79 a 50 (subxifoidea 52 → 42, flanco 21 → 2,
intercostal 6 → 6), y en las poses de la app, a 61 líneas, la subcostal conserva 10, 7 y 7 (de 20, 9 y 17) y el flanco 0,
0 y 4 (de 4, 5 y 6): lo que antes se reflejaba allí era pulmón sobre la aorta, el esófago y la unión de la VCI con la AD. La
lámina de pulmón del hiato desaparece (ninguna muestra de pulmón a ≤ 2 mm de la pared de la VCI supradiafragmática en los
siete casos a lo largo de 6 s): se retiran `mediastinum-is-lung` y `lung-sliver-caval-hiatus`. Muestras dentro de una
cavidad a más de pared + pericardio + 3 mm de la cúpula que no son sangre (rejilla de 2 × 2 × 1 mm): 258 → 0 (la peor
cortina, a 27 mm de la cúpula). Limitaciones nuevas: `schematic-static-heart` (esquema estático e igual en todos los casos,
sin valvas ni grandes vasos, cavidades sin flujo salvo el chorro de la VCI, el embudo recortado en la congestión, el VD que
llega a la pared anterior y la AI que toca la aorta en un tórax poco profundo) y `mediastinal-mirror-normal-approx` (el
pulmón que se alcanza desde el mediastino se refleja con la normal de la cámara más cercana o de la columna: con la de la
cúpula, como el resto del pulmón, el camino reflejado se perdía y detrás de la aorta de la epigástrica abanicada salía una
zona negra entera, como un derrame, en las capturas con GPU; ahora quedan parches oscuros donde el camino reflejado, casi
rasante, sigue hacia la columna o vuelve al pulmón). La AD no sigue el volumen auricular de la fisiología porque no lo hay
(la aurícula del modelo es una presión, decisión 79): queda declarada. Coste con GPU (Metal, M4, carga 4–9, dos medidas por lado): en
la subxifoidea el cuadro baja de 8,7/9,0 a 8,5/8,6 ms (la pasada A, de 4,2 a 3,6 ms: el haz acaba en la aurícula en lugar de
reflejarse en el pulmón; la B, 3,0/3,4 → 3,3/3,4 ms); en la intercostal no cambia (11,0/10,5 → 11,0/11,0 ms; B 5,3/5,2 →
5,3/5,2); en la epigástrica la B sube 0,2 ms (4,4/4,3 → 4,6/4,6; cuadro 10,2/9,9 → 10,1/10,3), por el tórax que clasifica
junto a la aorta. Arranque con SwiftShader (seis rondas alternas, carga 8–15): mínimo 28,2 s en main y 28,1 en la rama,
mediana 41,3 y 45,4 s, con rondas de 28 a 65 s en los dos (antes de la revisión, medianas de 32,0 y 32,4 s). Pendientes: valvas y grandes vasos, la cortical vertebral y las ventanas cardíacas
propias (subcostal de cuatro cámaras).
**Verificación.** `heart.test.ts`: las cuatro cavidades en su sitio en el marco levógiro (AD a la derecha, VI a la izquierda,
VD delante, AI la más posterior y craneal y, a su altura, la AD delante y a la derecha; la punta en x > 50 y por debajo del
centro del VI), los tamaños de la ASE y las paredes (la del VD, de 3 a 5,5 mm en la anatomía, seguida del pericardio), el
apoyo en el diafragma (ninguna muestra de pulmón a 0,3–4 mm por encima de la cúpula bajo la huella del corazón), el suelo
sin cortinas (dentro de una cavidad, a más de pared + pericardio + 3 mm de la cúpula de verdad, solo sangre; falla con el
recorte por `sdDiaphragm`), la mitral y la tricúspide abiertas, el pericardio (1,5 mm de mediastino con su cara de un lado
a la distancia del epicardio; ni el miocardio ni la sangre la dibujan), el mediastino alrededor de la aorta y los pulmones
a los lados y detrás, la esfera de descarte (su cáscara interior de 3 mm es pulmón), la cintura de la VCI en el hiato y su
luz continua hasta la cavidad, la VCI dilatada (×1,57) que por encima del suelo solo cambia el tejido dentro de la AD
tallada (falla con el elipsoide sin tallar: sangre en el tabique interauricular), la misma geometría en todos los casos y
el GLSL con las constantes del módulo. `anatomy.test.ts` (la VCI dentro de la aurícula: luz con flujo y sin cara, pared de
sangre; en el sano solo la tapa del embudo contra el tabique, que es miocardio). `startPoints.test.ts`: el canario
sustituido por pruebas de lo que se ve (arriba). `organs.test.ts` (gemelos por nombre; `epiNormal`, solo GPU),
`shaderLimits.test.ts` (130 ranuras), `wall.test.ts` (23 caras, 32 tejidos), `fidelityScene.test.ts` (el diafragma en la
subxifoidea abanicada), `pleura.test.ts` (el espejo de la cúpula, 50 líneas). e2e: equivalencia TS ↔ GLSL en las siete
ventanas de tres casos y en 50 000 puntos del tronco (con el corazón y el mediastino dentro), la normal del pericardio de
la GPU frente al gradiente de TS (fila `pericardium`, en la mediana ≥ 0,99), ecos de interfaz con la vista abanicada y la
suite completa: 28 pruebas en verde (22,6 min con SwiftShader y un trabajador). La revisión adversarial de contexto limpio encontró el embudo de la VCI dilatada en el tabique y
en la AI, las cortinas del borde de las hemicúpulas, la mitral cerrada, la distancia a la frontera sin la columna ni la
pared, la normal de la tapa de la columna y cifras de la documentación que no cuadraban; todo corregido arriba.

## 86. Artefactos del líquido: el refuerzo posterior es el de la atenuación, la refracción de las luces deja sombras de borde en el haz enfocado y la penumbra costal lleva la apodización de la emisión

**Contexto.** Sirve al objetivo 2 (fidelidad ecográfica) y al 8 (honestidad). Pista n.º 4 de la ronda 3 del juez ciego
(21/21 detectadas): faltan el refuerzo posterior bajo la VCI y los vasos (el juez esperaba 3–5 dB tras 2 cm de sangre a
3,5 MHz), las sombras de borde por refracción de las estructuras líquidas redondas, el relleno de las luces pequeñas por
el grosor de corte y las sombras costales que se abren con el abanico. Antes de tocar nada se midió con GPU (M4, Metal,
armónica y compuesto, apnea espiratoria; `main` e37f5d2), en cada vista y por luz: el refuerzo bajo cada vaso frente al
hígado de al lado a la misma profundidad (la TGC y la ganancia focal se cancelan) en la transmisión de la pasada A, en la
envolvente compuesta y en el gris mostrado; el relleno del centro de cada luz frente al hígado vecino; y la anchura y la
hondura de las sombras costales del flanco a varias profundidades. Resultados:

- **El refuerzo ya sale bien de la atenuación.** El rayo único de la pasada A da exactamente 2·L·(α_hígado − α_sangre) a
  la frecuencia efectiva de 2,5 MHz (decisión 21): 1,92 dB por cm de sangre, lo que da la literatura a la frecuencia del
  eco a esa profundidad (~3 MHz: 2·(0,5 − 0,18)·3 = 1,92 dB/cm). Suprahepática de 12 mm +2,3 dB, de 19 mm +3,4 dB. La TGC
  y la recepción solo dependen de la profundidad (no normalizan por líneas), la envolvente y el gris lo siguen dentro del
  ruido del moteado (+1,0–2,9 dB; +3–11 grises) y el compuesto lo deja igual (decisión 58). Lo que el juez no ve tiene
  otras causas: (1) **la banda del foco**: en la subxifoidea y la epigástrica, en eje largo, detrás de la VCI hay hígado
  (su tramo abdominal) y la transmisión compensada sube de delante a detrás +2,3 dB en el sano y +4,2 en la congestión
  grave (14,5 y 25 mm de sangre), pero ese hígado está a 120–124 mm y el de delante a 87–93 mm, y la TGC nominal no
  compensa la banda del foco (decisión 84, `psf-nominal-tissue`: −1,8 y −2,2 dB entre esas profundidades con el foco a
  90 mm): el gris solo sube 2 y 9 niveles; (2) donde la VCI no tiene hígado detrás, su pared posterior toca el pulmón de
  encima de la cúpula (`mediastinum-is-lung`) o la vértebra, y en el flanco apoya en la grasa retroperitoneal, ya
  brillante (con +5,6 y +7,1 dB de refuerzo encima); (3) las suprahepáticas de 6–19 mm dan 1–3,4 dB, 4–11 grises con el
  rango de 70 dB (≈ 3,5–4 grises por dB en el gris del hígado) bajo un moteado de desviación ~12; (4) la vesícula no sale
  en ninguna ventana VExUS salvo la subcostal (con asas detrás). Un preajuste cuya curva de TGC aplane la banda del foco
  por defecto, como hace el operador, lo dejaría ver; cambia toda la imagen y va aparte (abajo, pendiente). En la única referencia real limpia (pareja 7, `img13`: una vena ancha con hígado detrás) la
  zona de debajo sale +28,6 grises sobre la de al lado a la misma profundidad (29 de gris: ×2), unos 6–11 dB con un mapa
  de grises desconocido: más de lo que da la atenuación a 3–3,5 MHz (2–4 dB para 1–2 cm de sangre). No se infla la
  atenuación para una sola imagen: el tejido de detrás puede no ser el mismo hígado y la TGC del operador no se conoce.
- **No había refracción**: la transmisión va por rayos rectos. La sangre (1578 m/s frente a 1586 del hígado) refracta
  poco; la bilis de la tabla (1482 m/s), mucho.
- **Las sombras costales no se abrían con el abanico**: la penumbra (decisión 54) promediaba la emisión sin su
  apodización de Hann (limitación declarada en la 84): el borde de la apertura rellenaba el centro de la sombra como el
  centro. Bajo la costilla del flanco (13,7 mm a 22 mm) el núcleo a −12 dB medía 18 mm a 62 mm y 13 mm a 82 mm, donde el
  abanico da 20 y 24 mm, y desaparecía a −20 dB desde 62 mm.
- **Las luces pequeñas no son negras puras**: las de 2–4 mm quedan a −2/−15 dB del hígado (grises 40–90 frente a 60–100),
  las de 5–7 mm a −7/−38 dB según vayan en eje largo (el grosor de corte las rellena) o de través, y las grandes a
  −31/−38 dB (grises 3–15). La física del haz elevacional (la potencia de dos vías fuera de la luz, erfc(√2·h/σ₁) con h la
  semialtura de la luz) da −9, −15 y −27 dB a 3, 4 y 6 mm en eje largo a 5 cm; las referencias reales, un vaso de ~3 mm a
  −14 grises del hígado (`img11`), uno de 4–5 mm en 8 frente a 46 y las luces grandes en 2–5 frente a 29–41
  (`img13`, `img09`). Coinciden; no se cambia.

**Opciones.** (1) Pintar un realce bajo los vasos o sombras en sus bordes: prohibido (§23, criterio 1). (2) Pérdida de
Fresnel a incidencia rasante en cada cruce: con la sangre solo actúa a < 2° de la tangente, por debajo de una línea, y no
explica la sombra de la vesícula. (3) Coherencia de fase sobre el cono de la apertura: es la respuesta de un blanco
puntual, no el eco de un moteado. (4) Transporte de la energía de los rayos de una onda plana por la pantalla de fase de
las luces (la primera versión de esta decisión): da el foco de los libros tras el centro de la vesícula (+2,2 dB con GPU)
y bordes de −23 a −27 dB en el gemelo, pero es la energía de una onda plana, no el eco de moteado de un haz enfocado. La
revisión adversarial montó un banco de ondas 2D (espectro angular en pasos partidos, 3,5 MHz, con la emisión y la
recepción de este haz, métrica ∫I_tx·I_rx; `tools/fidelity/refraction-wave.ts`): tras la vesícula da −8,4 / −8,9 dB en el
borde a 20 / 40 mm, en una sombra de 6–8 mm centrada en él, −0,6 / −2,0 dB en el centro (ningún foco con el foco del
equipo a 90 mm; +1,0 dB con él a 150) y −0,2 a −0,5 dB tras un vaso, donde la onda plana daba −1,2 a −6,6. (5) La
elegida: el eco del haz enfocado cuyos rayos desvía la pantalla de fase, en la pasada A.

**Decisión.**

- **(a) Refracción de las luces** (`transmission.ts`, `aperture.ts`, `transmissionTwin.ts`): A1 escribe en su canal .y el
  camino de más de su segmento en una luz líquida, paso·(c_hígado/c − 1) (sangre 0,51 %, bilis de la tabla 7,0 %; el
  aire pasa al signo del dB). A2 acumula Ψ̃_l(k) = Σ_{s≤k} e_s·(r_k − r_s)/(R + r_s) y su pendiente Σ_{s<k} e_s/(R + r_s)
  a lo largo de cada camino: o1.xy en la mirada 0 (la dirección reflejada del espejo y el tipo de gas, que iban ahí, los
  pone A desde A0) y o3.zw en la dirigida. Se suma término a término con la distancia en filas enteras, e_s·(k − s)·paso:
  todos ≥ 0 y el de la fila k, 0 exacto (la forma r_k·Σe/(R + r) − Σe·r/(R + r) se cancelaba; abajo, la paridad). Lente delgada paraxial: el rayo radial que
  cruza la luz en la línea m aterriza desplazado Δ = (Ψ̃_{m+1} − Ψ̃_{m−1})/(2·dφ) mm. La pasada A forma el eco medio de un
  moteado, E = ∫I_tx·I_rx, con 7 tramos de cada apertura: la emisión (26 mm con su ventana de Hann y foco F; su tramo t
  cruza la luz a t·D_tx·(1 − (r − D)/F) de la línea y, sin la luz, aterriza a t·D_tx·(1 − r/F)) y la recepción (uniforme,
  de min(26, r/2,5) mm, enfocada en la muestra: cruza a t·D_rx·D/r). Cada tramo lleva el desplazamiento medio de sus rayos
  (el gradiente medio de Ψ̃ entre las líneas donde sus bordes cruzan la luz) y es una mancha gaussiana del ancho de
  difracción de su haz (el del modelo del haz, σ = FWHM/(2,355·√2) [DERIVADO]) ensanchada por la difracción de lo
  refractado, σ² += 0,07·λ·D por haz [AJUSTADO al banco de ondas]. La ganancia de amplitud de ida y vuelta es √(E/E0).
  D, la distancia de la luz a la muestra, es Ψ̃ sobre la pendiente de su camino, acumulada sin restar filas (en la
  dirigida, los caminos de las filas k y k − 1 cruzan líneas distintas y la diferencia de sus Ψ̃ sale ≤ 0 en el 0,8–3,5 %
  de las muestras tras una luz de las seis vistas; en la mirada 0, la resta en float32 movía D un 3·10⁻⁵ y con él el
  redondeo de los tramos) o, fuera de la luz, la de la vecina con luz más cercana, de una en una hasta ±8 líneas y de
  cuatro en cuatro hasta ±32 (los conos cruzan la luz hasta a ±26 líneas; cortar en ±8 dejaba un escalón radial de
  0,6–1,2 dB tras la vesícula); sin luz ahí, la ganancia es 1 exacto. En armónica la emisión va a f/2 con la escala 1/√2
  de su haz (decisión 77) en su mancha, en su cono y en su difracción (λ_tx·escala², la de la fundamental). Multiplica la
  transmisión con apertura de la imagen (o0.x en la mirada 0, o3.x en la dirigida), no el rayo único del color y del PW.
  Frente al banco de ondas, en sus nueve casos (vesícula de 29 mm a 20, 40 y 60 mm y con el foco a 50, 90 y 150 mm; vasos
  de 10, 20 y 30 mm; `refraction.test.ts`): la c de la difracción se ajustó sobre esos mismos perfiles, así que su error
  medio, 0,51 dB, es el residuo del ajuste (casi plano entre c = 0,03 y 0,15; con c = 0, 0,71 dB), no una validación; el
  borde de la vesícula sale 1,1–2,4 dB menos hondo y con su mínimo 1–2 mm dentro de la luz, su centro hasta 1,6 dB más
  oscuro (puntos sueltos de sus perfiles, hasta 2,7–3,9 dB), y los vasos a ≤ 0,5 dB. El banco es de fundamental: la
  armónica no está contrastada. La física del
  artefacto: Sommer, Filly y Minton 1979 (AJR 132:973) y Robinson, Wilson y Kossoff 1981 (J Clin Ultrasound 9:181)
  atribuyen las sombras de borde a la refracción en los bordes curvos de las estructuras líquidas.
- **(b) Penumbra con la emisión apodizada**: el cono de la emisión pesa sus 9 tomas con la ventana de Hann de la emisión
  de la imagen B (decisión 84), cos²(πt), y la recepción, casi uniforme (k 1,3 frente a 1,21), pesa 1; las tomas van al
  punto medio de cada tramo (con la de Hann, las de los bordes pesarían 0). Un solo `apConeMean` sobre el prefijo de la
  mirada para las dos.
- **(c) El refuerzo no se toca**: sale de la atenuación, como antes. Tras el centro de una luz la refracción no suma
  foco: el haz, desenfocado por la lente, pierde algo (banco: −2,6 a +1,0 dB según el foco).
- **(d) El relleno de las luces no se toca** (arriba).
- **(e) Los gemelos de TS de A2 y A** (`prefixDb`, `steeredPrefixDb`, `refractionPsi`, `apertureTransmission`,
  `steeredApertureTransmission`, `refractionGain`) pasan a `transmissionTwin.ts`, que solo importan los ganchos de prueba
  y las pruebas: vivían en módulos del chunk principal (su GLSL) y el chunk los llevaba (2,6 kB). La paridad de la
  mirada 0 compara ahora también su transmisión de la imagen con sus gemelos sobre los segmentos de la GPU
  (`look0TransmissionTwin`, con el primer gas y el primer hueso de A0, como la GLSL), como la dirigida; las dos dicen dónde
  está su peor muestra (`worstAperture`) y la de la mirada 0, cuántas compara (`apertureSamples`, el denominador de sus
  empates).

La revisión adversarial de contexto limpio encontró, además de lo de (4): la D de las miradas dirigidas tomada de dos
caminos distintos (arreglado en (a)); una sombra de borde de los vasos que era un artefacto de discretización de la onda
plana (desaparece con el haz enfocado); la derivación de la constante de difracción, mal apoyada (ahora ajustada al
banco); la paridad sin la bilis y con el obstáculo de A1 en lugar del de A0, y el denominador de sus empates (arreglados;
la e2e lleva la subcostal); y riesgos que quedan declarados (abajo y en `refraction-paraxial`). Una segunda pasada sobre
el modelo nuevo encontró la resta de filas de la D de la mirada 0 (ahora acumulada en A2), el escalón del corte de la
búsqueda (ampliada), la difracción de la emisión armónica sin su escala (escalada) y la escalera de A1 como causa del
centro oscuro (pendiente, abajo).

**Consecuencias.** Con GPU (M4, armónica y compuesto; `main` 88346eb → rama):

- **Vesícula** (subcostal, a 20–40 mm bajo la bilis): la refracción de A deja los bordes a −4,2 dB de media (mínimo −9,2)
  y el centro a −0,9 dB (máximo −0,1); la envolvente del centro sobre la del borde pasa de 2,1 a 4,8 dB y el gris, de
  105 / 113 (borde / centro) a 91 / 110: dos sombras de borde a los lados de la banda del refuerzo, sin foco. (La onda
  plana daba −8,5 / +2,2 dB y 82 / 122.) Con la c de la bilis a 37 °C la sombra sería más estrecha (abajo).
- **Vasos**: sin sombras de borde visibles. La refracción queda en −0,1 a −0,8 dB en el borde de los vasos de las seis
  vistas (−0,1 / −0,2 / −0,6 dB tras las suprahepáticas de 12 y 20 mm y un tramo oblicuo de 22 mm), como en el banco
  (−0,2 a −0,5 dB) y en las referencias reales, sin sombras de borde tras las venas (`img11`, `img13`); el refuerzo del
  centro, el de la atenuación (+2,4 / +3,5 dB tras las de 12 / 20 mm, como en `main`).
- **Corazón** (decisión 85): bajo la aurícula derecha de la subxifoidea (41 mm de sangre en su centro, pared honda a
  132 mm) el rayo único sube lo que da la atenuación, 1,8–1,9 dB por cm de sangre frente al miocardio o al hígado (7–8 dB);
  la refracción deja en sus paredes laterales como mucho −1,5 dB (media −0,2) a 10–30 mm y nada en su centro (gemelo
  sobre los segmentos de A1 de la GPU). Al lado y detrás hay pulmón y mediastino: no hay una referencia limpia a la misma
  profundidad para medirlo en la imagen.
- **Sombras costales** (flanco, costilla de 13,7 mm a 22 mm): el núcleo a 62 / 82 / 142 mm pasa de 19,9 / 17,1 / 8,8 a
  32,7 / 27,4 / 15,8 dB bajo el hígado; a 82 mm su anchura a −12 dB pasa de 13,2 a 22,8 mm (el abanico: 23,7) y a −20 dB,
  de 0 a 12,3 mm. Gemelo (costilla de 12 mm a 18 mm): la umbra (−40 dB) acaba a 34,6 mm tras la cara en la mirada 0
  (26–28 antes) y a 31,1 con el compuesto.
- **Coste**: la refracción busca la luz (hasta 30 téxeles) y, cerca de una, lee 28 más y hace 56 exponenciales por
  fragmento de A en cada mirada (sin clasificar); A lee además la dirección reflejada de A0 en las líneas con espejo.
  Con GPU (M4, frente a `main` 88346eb, dos rondas intercaladas) la pasada A pasa de 0,05–0,07 a 0,06–0,08 ms y el
  cuadro, de 10,40–10,42 a 10,48–10,53 ms en la subcostal y de 7,75–7,77 a 7,81–7,83 en la subxifoidea (con compuesto,
  10,95 → 11,03–11,05 y 8,18–8,20 → 8,23–8,26). Arranque con SwiftShader frente a `main` 88346eb (carga 3–7, seis rondas
  intercaladas): 31,4 / 26,6 / 24,4 / 26,9 / 24,2 / 24,1 → 35,7 / 25,2 / 24,5 / 24,6 / 24,6 / 24,6 s, sin tendencia
  (medianas 25,4 y 24,6 s; la primera ronda es la del calentamiento). Chunk principal 320,8 → 321,7 kB de 325 (la GLSL y
  los uniforms nuevos; los gemelos fuera quitan 2,6 kB); los ganchos de prueba, 58,7 → 63,5 kB de 120.
- **Paridad con la GPU** (Metal; seis vistas, las tres miradas): la transmisión de la imagen queda a ≤ 9·10⁻⁵ dB de sus
  gemelos. Con Ψ̃ sumada como r_k·Σe/(R + r) − Σe·r/(R + r), la GPU (con FMA) dejaba un residuo de ±10⁻⁹ mm en la primera
  fila de la vesícula donde el gemelo da 0, la distancia a la luz saltaba de 0 a un paso y la imagen se separaba
  0,01–0,12 dB en su cara (la e2e, sin la subcostal, no lo veía; ahora la lleva).
- **Limitaciones** nuevas: `lumen-refraction-only`, `refraction-paraxial`, `fluid-sound-speed-20c` y `lumen-fill-three-planes`;
  se borra de `psf-nominal-tissue` la penumbra sin apodización.
- **Pendiente**: la fracción de luz de cada segmento en A1: la cuerda de las luces va en segmentos enteros de 1,125 mm y
  sus escalones en Ψ̃ se leen como bordes de lente, que oscurecen el centro de la vesícula (según la revisión, −2,2 dB en
  el banco plano frente a −0,8 con la fracción exacta, y el error medio de 0,51 a 0,39 dB sin reajustar c) y lo ondulan
  ±1 dB entre líneas; la curva de TGC del preajuste que aplane la banda del foco por defecto (el hígado a 14–18 cm, 4–7 dB bajo
  el del foco en armónica, y el campo cercano, 5 dB): expondría el refuerzo de detrás de la VCI y aclararía el campo
  cercano de la pareja 6 del juez, pero cambia el gris de toda la imagen y sus puertas; el corazón y el mediastino
  (decisión 85) cambiarán lo que hay detrás de la VCI por encima de la cúpula; la c de la bilis a 37 °C, con la
  calibración del eco de su cara; y el borde de la vesícula, 1,1–2,4 dB menos hondo que en el banco también con la
  cuerda exacta (la suma incoherente de los rayos).

**Verificación.** `refraction.test.ts`: el camino de más de las luces sale de la c de TISSUES (sangre y bilis, nada más);
sin luces la ganancia es 1 exacto, también en los bordes del sector; Ψ̃ de la mirada 0 es la del prefijo dirigido con θ =
0 bit a bit, su pendiente es la del camino y da la distancia a la luz; Ψ̃ es 0 exacto en la primera fila de cada luz y,
en las miradas dirigidas, la distancia con la pendiente del camino queda entre 0 y r en todas las muestras (la diferencia
de filas sale ≤ 0 en algunas); frente al banco de ondas, sus nueve casos (el borde de la vesícula a ≤ 2,5 dB del banco
en su mínimo y en el borde, su centro sin foco y a ≤ 3,5 dB, los vasos a > −1,2 dB; error medio < 0,8 dB); en el sector,
la vesícula oscurece sus bordes (−4 a −12 dB) más que su centro, su sombra decae fuera sin el escalón del corte de la
búsqueda, una vena queda a > −1,5 dB y más allá del alcance de la búsqueda la ganancia es 1 exacto; la GLSL de A1, A2 y
A con las mismas constantes. `psfDepth.test.ts`: los uniforms de la refracción de A con el haz de cada modo. `aperture.test.ts`: las tomas en el punto medio y
la ventana de Hann (media ½), la sombra más honda en profundidad que con la emisión uniforme (> 3 dB a 60–150 mm), la
umbra y el refuerzo de las miradas dirigidas (este, sin la refracción, que se prueba aparte). `steeredParity.test.ts` con
las tomas nuevas y el camino de más; `shaderLimits.test.ts`, las huellas de A2 y A. e2e: la paridad de la mirada 0
compara también la transmisión de la imagen con sus gemelos sobre los segmentos de la GPU en la subxifoidea, el flanco y
la subcostal (≤ 0,01 dB, empates ≤ 1 % de sus muestras), la dirigida ya lo hacía (G8, ahora con la refracción), y detrás
de la vesícula de la subcostal, en las muestras sin gas ni hueso al alcance de la penumbra, el borde baja de −4 dB y
1,5 dB más que el centro, que no pasa de +1 dB.

## 87. Riñón y venas sin primitivas: pirámides en cono con sus arcuatos, seno en lóbulos, contorno cerrado por la grasa, hilio sin cápsula y extremos venosos que se afilan

**Contexto.** Sirve a los objetivos 3 (fidelidad anatómica) y 2 (fidelidad ecográfica) de `docs/MISION.md`. Ronda 3 del
juez ciego (26-09-2026): 21/21 detectadas, realismo 2,4–2,6 y la pista n.º 3, «anatomía de primitivas». En las parejas
renales: «la cápsula no cierra», «el seno es el mismo moteado, solo más brillante», «las pirámides son tres hendiduras
verticales oscuras equidistantes», «el grano es igual dentro y fuera del órgano» y «la columna oscura central (la pelvis)
cruza el contorno como pintada encima»; en el hígado, «una vena recta que acaba en un círculo, como una piruleta». Antes
de tocar nada se midió: mapas de tejidos y de caras de la ventana renal con la compresión de la sonda, cortes en el marco
del riñón, capturas con GPU real (M4, armónica y compuesto) y el gris mostrado por tejido, clasificado píxel a píxel con
la anatomía TS (`scratchpad/kid/`):

- Las «tres hendiduras» no eran pirámides: eran los tres pares interlobares de las columnas de Bertin laterales (vena de
  1,3–1,95 mm de radio, arteria de 0,95–1,35, a w = ±1,8 mm) en el plano (w de 0,5 a 2,2 mm en el lado lateral). Las
  pirámides eran bandas: por su eje, 4,3–6,3 mm de médula en la fila lateral, 0–1,4 en la anterior y la posterior (dos sin
  médula visible) y 2,8–5 en los polos, porque el dedo del seno (el cáliz, 3,5 mm de radio) pasaba 4 mm de la papila y se
  comía la punta del cono. Médula: el 3,4 % del volumen del parénquima y el 10,6 % del corte coronal.
- La «columna negra» no era la pelvis (en el plano de la ventana renal no hay una sola muestra de pelvis): era la vena
  renal, de 8–9 mm, desde el centro del seno (v = 8 mm) hasta fuera del hilio, en el plano de v = 7 a 34 mm (el plano pasa
  por w = 3,4–5,6 mm en el hilio y el eje de la vena por w = 5). Y la cápsula (tejido y cara) cruzaba la boca del hilio,
  donde la grasa del seno sigue en la perirrenal.
- Contorno: la cara de la cápsula rodea el riñón, pero su eco especular (decisión 65) se apaga, como debe, a incidencia
  rasante en los polos, y el tejido de alrededor no cerraba el contorno. Gris mostrado (sano, ventana renal): hígado 97,8,
  corteza 84,3 (índice hepatorrenal 1,16), médula 68,3, seno 119,3 ± 16,8 (1,22 veces el hígado y 1,3 veces su
  desviación), grasa perirrenal 111,3 y retroperitoneal 108,6. En la referencia real de la pareja 2 (`sueltas/img06`,
  rectángulos a mano): hígado 70,9 ± 9,7, corteza 57,4 (0,81 veces el hígado), seno 156 ± 31 (2,2 veces el hígado y 3,2
  veces su desviación) y la banda de grasa de Morison 180 ± 40 (2,5 veces). Son equipos, ganancias y curvas de grises
  distintas: los cocientes de gris dan la dirección (el seno y la grasa muy por encima del hígado, la corteza por debajo),
  no un número que igualar.
- La «piruleta»: las 56–60 ramas procedurales acababan con 0,9 mm y una tapa esférica (el suelo `max(0,9; 0,6·r0)`: 19–20
  eran tubos uniformes de 0,9 mm); 6 de las 11 madres (las dos portales derechas, las suprahepáticas anterior y posterior
  derechas, la tributaria izquierda y la VSH derecha) no tenían hijas en su extremo y acababan en tapas de 1,6–2,4 mm, y
  las otras 5 en una bola de 1,6–2 mm de la que salían hijas de 1,0–1,24. La de la pareja 1 es sobre todo una confluencia:
  la tributaria de la VSH media, en el plano, llega a la media cortada de través (su nodo central está en el eje de la
  media, r 2,8 frente a 3,77 mm).

**Opciones.** (1) Tejidos nuevos (papila, arcuatos, grasa del seno) o caras nuevas (arcuatos especulares): la decisión 85
llevó `TISSUE_COUNT` a 32, el tope de las tablas por tejido de 4 en 4 (uno más son dos ranuras de B), y la pasada B está en
130/130 ranuras, así que ni tejido ni cara ni uniform. (2) Pintar el contorno con una banda de brillo constante: la pista
de las rondas 1 y 2 («brillo de borde que no depende de la incidencia»). (3) La elegida: la geometría en el módulo del
riñón (TS y GLSL), tejidos existentes para lo nuevo, los niveles de retrodispersión, una textura de lóbulos en el gancho de
textura retroperitoneal de B y el afilado de los extremos en el árbol vascular.

**Decisión.**

- **Pirámides en cono** (`organs/kidney.ts`): la papila a 2 mm del seno (antes 3) y el dedo del cáliz de 2,2 mm de radio
  hasta 1 mm antes de la papila (antes 3,5 mm hasta 0,5 mm después), que la ahueca 1,2 mm; bases de 5,6–8,9 mm de radio
  (antes 5,2–7,4) y el seno más plano de delante atrás (semieje 10 → 8 mm: 15 mm de parénquima delante y detrás, 15–16 en
  la revisión del 25-09). Siguen bajo ≥ 7 mm de corteza (decisión 68). De la papila a la base: 8,9–10,7 mm en la fila
  lateral, 8,6–9,0 en las oblicuas y 16 en los polos (compuestas, se funden con la última lateral); las anteriores y
  posteriores, 5,8–7 mm, siguen más anchas que altas. Entre dos vecinas queda una columna de corteza de ≥ 2 mm. Médula
  visible por su eje: 8,1–10,1 mm en la fila lateral, 4,8–6,3 en la anterior y la posterior, 7,5–8,2 en las oblicuas y 15,1
  en los polos; el 6 % del volumen del parénquima y el 16,4 % del corte coronal. La médula pasa de 0,42 a 0,28 (−8,2 dB
  bajo la corteza) [ESTIMADO]: hipoecoica, no negra.
- **Vasos arcuatos** (`ARCUATE`): un anillo en el borde de la base de cada pirámide, a ≤ 0,6 mm de la unión
  corticomedular y ≤ 2,5 mm dentro del cono, clasificado como pared arterial (`Tissue.ArteryWall`, sin luz ni vaso), la
  región 4 del `kidneyQuery` GLSL [EXTRAPOLACIÓN PROPIA: la sección del anillo]. En el corte por el eje de una pirámide, dos
  focos en las esquinas de su base (Emamian 1993; Radiopaedia; revisión del 25-09).
- **Cotas de `inner`** (revisión adversarial): la seudodistancia del cono redondeado sobrestima la real hasta
  √(1 + pendiente²), 1,52 en las pirámides anteriores y posteriores, así que las distancias de los conos van por
  `PYRAMID_BD` = 0,6589 (la misma constante en la GLSL); y la corteza cuenta la cápsula (−dOuter − 0,6 mm, antes −dOuter).
- **Hilio**: dentro del canal del seno (`hilumChannelSdf`, con su gemelo GLSL) no hay cápsula, ni tejido ni cara, y la
  grasa perirrenal frente a él no dibuja la cara de la cápsula (grasa con grasa): el mismo canal decide las dos mitades de
  la cara, y la distancia a la frontera cuenta ese cambio de dueño.
- **Vena renal**: nace en el borde medial del seno (v = 15 mm, `RENAL_VEIN_SINUS_V`) con 2 mm de radio y se ensancha hasta
  4,5 mm en el hilio (antes 4 mm desde el centro del seno), un tubo que resume las segmentarias que la forman en el hilio
  [EXTRAPOLACIÓN PROPIA]; el `refRadius` no cambia. Las interlobares se afilan hacia la unión corticomedular, donde se
  hacen arcuatas: la vena 1,95 → 1,4 → 0,7 mm (antes 1,3 en su extremo), la arteria 1,35 → 1,0 → 0,5 (antes 0,95)
  [EXTRAPOLACIÓN PROPIA]. Su `refRadius` (el área y la velocidad) no cambia y la puerta de la cadena del alumno sigue junto
  al seno (`interlobarVein2`, θ = 0,127 rad, r = 55,5 mm, v = −6,4 a −7 mm), a 1,45 / 1,41 / 1,32 mm de la pared (antes
  1,47 / 1,43 / 1,35) en el sano, la congestión grave y la FA.
- **Ecogenicidad** (`tissues.ts`) [ESTIMADO]: grasa perirrenal 1,5 → 2,4 y retroperitoneal 1,4 → 2,0; seno 2,3 → 4,5 (+13 dB
  sobre el hígado y +5,5 sobre la grasa perirrenal: lo más ecogénico del riñón) en lóbulos (`SINUS_TEXTURE`:
  0,615·exp(4·(n − 0,5)) de un ruido de valor anclado de 3 mm con sal fija; la desviación de n es 0,186, así que da 6,4 dB
  de desviación, y 0,615 = 1/√E[·²] en 2·10⁶ puntos deja la potencia media en 1). Los lóbulos van en `retroTexture` de la
  pasada B y su gemelo TS, el gancho de los músculos retroperitoneales, en la muestra del medio y en sus planos de
  elevación y fuera del bucle de la pleura; con la potencia media en 1, la retrodispersión de la tabla es la del seno
  también en la puerta PW, que no lleva la textura. La corteza sigue en 0,72. El contorno se cierra por contraste a
  cualquier incidencia (la corteza a −2,9 dB del hígado, la grasa perirrenal a +7,6) y la línea especular de la cápsula
  sigue encima, de frente. El mediastino de la decisión 85 (1,0) queda menos ecogénico que la grasa retroperitoneal.
- **Extremos venosos** (`vesselTree.ts`, `BRANCH_TIP_RADIUS_MM` = 0,3 mm) [EXTRAPOLACIÓN PROPIA]: las ramas procedurales
  sin hijas (las de 4.º orden, las laterales y las de 3.º orden cuyas hijas no caben) se afilan hasta 0,3 mm, por debajo de
  la resolución (PSF de 1–3 mm, rodaja de 3–5 mm), y se apagan en la imagen; la madre se afila en su último tramo hasta el
  radio con que nacen sus hijas (0,62·r, la unión en «Y» sin bola) o, sin hijas, hasta 0,3 mm (`buildHepaticBranches`
  devuelve también `parents`), y sus ramas laterales no nacen más gruesas que ella (≤ 0,8 de su radio). Mismo `refRadius`:
  las áreas y las velocidades no cambian, y las ramas siguen fuera de `vesselById` y de `vesselAreas` (invariante 3).

**Consecuencias.**

- Imagen (M4, armónica y compuesto, apnea espiratoria; `scratchpad/kid/shots-final2`, con los recortes y la normalización
  del juez frente a las reales de las parejas 1–3 y frente a `main`): el riñón es un óvalo oscuro cerrado por grasa
  ecogénica, con el seno en lóbulos brillantes, pirámides oscuras con la punta hacia el seno y las interlobares como trazos
  tenues junto al seno; la vena renal solo asoma en el hilio. Gris mostrado en el sano: hígado 97,6, corteza 84,1 (índice
  hepatorrenal 1,16, normal 1,0–1,25), médula 58,9 (antes 68,3), seno 134,1 ± 27,7 (1,37 veces el hígado y 2,1 veces su
  desviación; antes 1,22 y 1,3), grasa perirrenal 127,9 (antes 111,3) y retroperitoneal 119,7 (108,6); en la congestión
  grave, médula 69,7 → 60,1, seno 119,6 → 134,3 y grasa perirrenal 113,6 → 130,3. En el barrido de la ventana (61 líneas
  cada 2 mm): médula 58 → 89 muestras y vena renal dentro del contorno 17 → 3.
- Hígado: las puntas se afilan y se apagan. En la pareja 1 la tributaria de la VSH media se desvanece hacia la periferia
  (en el plano, 757 → 701 píxeles de luz y sus ramas 352 → 258), pero su confluencia con la media cortada de través, que
  no cambia, sigue ahí: es anatomía real, no una tapa.
- Cotas (`scratchpad/kid/review/bdcheck.mts`: puntos del riñón movidos 0,95·bd en 50 direcciones): corteza ↔ médula
  0,49 → 0,86 de la distancia real, anillo 0,82–0,90, corteza → cápsula 0,01 → sin fallos; el seno baja de 0,72 a 0,56
  (la seudodistancia del elipsoide, más alargado) y la pelvis sigue en 0,59. En los planos de elevación (se = 2,14 mm)
  ninguna muestra reutilizada cambia de tejido (54 de 49 180 en `main`, por la cápsula).
- Doppler renal: la cadena del alumno (`examChain.test.ts`) da los mismos patrones y la misma calidad en los tres casos; en
  el sano el pico D baja un escalón de velocidad (26,7 → 26,0 cm/s) y el resto de medidas, las de la VSH y las de la porta
  son idénticas. `npm run calibrate` da la misma salida byte a byte.
- Coste: el bucle de las pirámides se evalúa en 0,6 mm más de corteza (la franja del anillo) y el de los dos riñones de
  `classifyWith` gana una distancia al canal del hilio (una longitud) en la grasa perirrenal y en la franja de la cápsula;
  nada pesado dentro de un bucle. Arranque con SwiftShader (tres rondas alternadas, carga 5–10, antes del rebase): 33,6 /
  28,4 / 29,8 s en `main` frente a 32,9 / 29,8 / 29,8 s. Índice del build 321,7 → 323,4 kB (325), sin subir el presupuesto.
- Limitaciones: nueva `arcuate-no-lumen` (los arcuatos son difusos y tenues, +3–6 dB sobre la corteza, sin la reflexión de
  sus paredes); `no-left-interlobar-vessels` añade la vena renal de un solo tubo y la falta de pirámides en la cara medial
  (el seno está desplazado hacia el hilio). Quedan: la médula en el 6 % del volumen del parénquima (el de un adulto es
  mayor), las pirámides anteriores y posteriores más anchas que altas, las sombras de borde de los polos, la doble línea
  real de Morison contra la grasa gruesa (decisión 81) y la confluencia de la VSH media de la pareja 1.

**Verificación.** `anatomy.test.ts`: pirámides con médula desde ≤ 3 mm de la papila y ≥ 8 mm (fila lateral) o ≥ 4,5 mm
por su eje, ≥ 15 % de médula en el parénquima del corte coronal, el anillo de los arcuatos en cada pirámide de los dos
riñones (pared arterial sin vaso, a ≤ 0,6 mm de la unión) y corteza en las columnas de Bertin, el radio del canal del hilio
igual en los dos riñones (la GPU usa el del derecho), el hilio sin cápsula ni cara por el eje del canal y la cápsula en
todo el resto del contorno coronal, la vena renal fuera del centro del seno y < 0,2 cm³ dentro del contorno (0,08; 0,71
en `main`), el orden de ecogenicidad médula < corteza < hígado < grasa perirrenal < seno (una guarda: ya se cumplía); el
árbol hepático sin bolas en los siete casos (cada extremo periférico se afila a 0,3 mm o sigue en hijas tan gruesas como
él, y ninguna rama nace más gruesa que el vaso del que sale). Las pruebas de antes siguen (decisión 68). `retroTexture.test.ts`:
los lóbulos (anclados y sin dirección; en 200 000 puntos al azar, potencia media 1 ± 5 % y 5,8–7 dB de desviación; en los
dos senos, potencia 1 ± 10 %; correlados a 0,5 mm e independientes a tres células; el seno ≥ 12 dB sobre el hígado y ≥ 4
dB sobre la grasa perirrenal) y su GLSL con las constantes del módulo en los dos programas de B. `startPoints.test.ts`
(renal): médula > 70 muestras y la vena renal < 8 dentro del contorno. `faceGradient.test.ts`: la referencia de
diferencias centrales yerra ≈ (h/ρ)²/6 junto al eje de las puntas afiladas, así que excluye ρ < 0,3 mm (el analítico,
frente a h = 0,001 mm, queda en 3·10⁻⁶). e2e completa con SwiftShader (equivalencia TS ↔ GLSL en tejido, vaso, velocidad y
caras) y capturas con GPU antes y después. Revisión adversarial de contexto limpio sobre el primer commit: la textura del
seno sin normalizar (su potencia media era 2,7, no 1, y la prueba pasaba por los puntos que tocaban), la cota de `inner`
con la seudodistancia de los conos, una rama lateral más gruesa que su madre afilada, bolas de 1,6–2 mm en las madres con
hijas, dos pirámides casi fundidas, la cara de la grasa y la cápsula que cambiaban de dueño en sitios distintos en el
borde de la boca del hilio, y cifras y comentarios desajustados: corregidos.

## 88. Costillas opacas y sin disco, y pared con relieve: lo que entra en el hueso no vuelve, la difusa de la cortical se apaga en el ángulo crítico y las capas dejan de ser arcos concéntricos

**Contexto.** Sirve a los objetivos 2 (fidelidad ecográfica) y 3 (fidelidad anatómica) de `docs/MISION.md`. Ronda 4 del
juez ciego (27-09-2026, `main` 0e03756), pareja 6 (campo cercano del flanco con la sonda 12 mm más craneal): los dos
jueces vieron «una línea brillante que cruza la parte inferior de la costilla izquierda, dentro de su sombra» (un error
de oclusión), y la pista n.º 1 incluía «costillas idénticas en cúpula con el disco del hueso distinto de su sombra» y
«arcos de pared equidistantes». Antes de tocar nada se midió (`scratchpad/rib/`): el mapa de tejidos y caras de la CPU
por línea en el marco y el contacto de la captura, capturas con GPU real (M4, Metal, armónica y compuesto, apnea
espiratoria; `main` d49aa52) del flanco con y sin el desplazamiento y de la intercostal, y la envolvente, el gris y las
transmisiones de la pasada A por línea:

- La línea era la cara del peritoneo (decisión 62) con la pleura parietal de la cortina (decisiones 61 y 71) a 28,4–28,9
  mm, justo bajo la costilla (el hueso acaba a 27,2–27,9 mm y el pulmón empieza a 29,2). Bajo la costilla izquierda de
  la pareja quedaba a −10/−18 dB del hígado en el centro (gris 18–39) y subía a +10/+37 dB en sus bordes. Dos fugas: (a)
  el hueso dejaba pasar demasiado: 6 dB de entrada y 10 dB por mm a 2,5 MHz dan −67/−79 dB de ida y vuelta por el centro
  de una costilla frente a una pleura +50/+55 dB sobre el hígado, y −16/−26 dB por las cuerdas de 1–2 mm de sus bordes;
  (b) el pedestal de lóbulos laterales de la pasada D (decisión 76) llevaba a las líneas tapadas la pleura y el
  peritoneo de las vecinas, −10/−18 dB. Con solo el hueso opaco la línea seguía (el pedestal); con el pedestal apagado
  bajo el hueso, desaparecía. Las réplicas de la reverberación de C (decisión 76) no intervenían: su transmisión hasta
  la pared es ≈ 0 bajo una costilla.
- El «disco» era el moteado del propio hueso (retrodispersión 0,9) bajo la cortical: una media luna a −9/−12 dB del
  hígado (gris 27–36) entre el arco y la sombra. La componente difusa de la cara de la cortical (decisión 65: Lambert,
  cos θ) seguía a +16 dB sobre el hígado a 60° de incidencia y dibujaba el contorno de media costilla. Las seis
  costillas eran la misma elipse de 12 × 6,4 mm.
- La sombra central que se estrecha con la profundidad es física: un banco de ondas 2D (espectro angular, 3,5 MHz,
  emisión de 26 mm con Hann y foco a 90 mm, recepción dinámica F/2,5, costilla elíptica opaca de 12 × 6,4 mm con la cara
  anterior a 21,5 mm; `scratchpad/rib/ribwave.mts`) da un núcleo bajo −20 dB de ±3,5–4 mm a 29–40 mm y de ±2,5 mm a
  60–100 mm, mientras la anchura a −6 dB crece de ±5,5 a ±7,5 mm y el centro sube de −42 a −28 dB a 100 mm: la
  difracción y la apertura finita rellenan el borde, y el compuesto rellena más. El defecto era otro: la transparencia
  parcial de las cuerdas finas.
- Las ondas de la pared (`wallWave`) medían 2π veces lo documentado (`wallWavenumber` devuelve ≈ 1/λ): 57–400 mm. En el
  sector las capas apenas se movían: en la escena de la pareja, σ de la fascia profunda 0,25 mm, del plano oblicuo 0,36,
  y separaciones entre caras vecinas con un CV de 0,02–0,09.

**Opciones.** (1) Tapar el síntoma: quitar la pleura y el peritoneo bajo las costillas en `classify`, o recortar el
brillo bajo el hueso en la presentación: una cara que existe desaparecería por geometría y no por física, y la próxima
cara bajo un hueso volvería a fugarse. (2) Subir la absorción del hueso (dB/mm): el borde de una costilla es una cuerda
de milímetros; para apagar la pleura por una cuerda de 1 mm harían falta ~60 dB/mm, un número sin significado. (3) La
elegida: el hueso opaco a la entrada, la interpolación de B que no mezcla a través de esa entrada, los especulares con
el rayo central y el pedestal con la sombra de su línea; en las costillas, sin moteado propio, con la difusa de la
cortical limitada por el ángulo crítico y con una sección por costilla; en la pared, un relieve fino y otro lento con
sus longitudes de onda reales. La compresión de la sonda (decisión 63) no cambia: empuja la pared como un bloque, así
que el relieve, material, se conserva bajo la sonda (la grasa real, más blanda, se aplanaría algo:
`wall-generic-layers`).

**Decisión.**

- **Oclusión** (`ultrasound/transmission.ts`, `shaders/passes.glsl.ts`):
  - `BONE_ENTRY_DB` 6 → 100 dB [ESTIMADO]: lo que entra en el hueso no vuelve a formar imagen. Más allá de 26,9° (c 3515
    frente a 1588 m/s) la onda longitudinal se refleja entera; lo que entra se convierte en transversal, se absorbe y se
    dispersa en la esponjosa, y la cortical curva aberra el frente de onda. La sombra se rellena en profundidad por la
    penumbra de la apertura (los rayos que pasan junto a la costilla, decisiones 54 y 86), no a través del hueso. La
    misma regla en A2, sus gemelos (`rayAttenuationDb`, `prefixDb`, `steeredPrefixDb`) y la puerta PW.
  - `transmissionLerp` / `transLerp`: la pasada B lee la transmisión de A lineal en profundidad entre los centros de
    fila, como el filtrado de textura de antes, salvo a través de la entrada en un hueso (una caída de más de 15 dB entre
    dos filas, `BONE_STEP_DB`: el gas cobra 6,75–9 dB por fila, 7,9–10,5 con la apertura; la entrada en el hueso, 100 dB
    en el rayo de la línea y 20–35 en la apertura de las líneas del borde de una costilla), donde lo de delante conserva
    la de su fila. Interpolando, la cortical (el tejido blando de delante, decisión 62) perdía hasta 10 dB según dónde
    cayera la costilla en la rejilla de 1,1 mm. En las miradas dirigidas, también sobre la pleura de la cortina.
  - Los ecos especulares (la especular de las caras, la pleura del diafragma y la parietal de la cortina) llevan a lo
    sumo la transmisión del rayo central (`min(T_apertura, T_rayo)`): su camino de vuelta es el espejo del de ida y bajo
    un hueso uno de los dos lo cruza; la penumbra de la apertura los encendía bajo el borde de una costilla. El moteado
    y la difusa siguen con la de la apertura. `mediumField` y su variante dirigida devuelven la especular aparte.
  - Pasada D: el pedestal de cada línea se escala con la fracción de su haz que sobrevive a los huesos, la transmisión
    con apertura (sin la refracción de las luces, que desvía la energía y no la quita; con la penumbra del gas) sobre la
    del rayo sin lo que cobra el hueso, en dB (A2 publica en o1.z los dB del hueso; A, en o2.z la de la mirada 0 y en
    o2.w la de la dirigida, ≤ 1): una línea tapada por una costilla no recibe lóbulos laterales bajo ella, como una sin
    contacto (decisión 76). D lee `trans` (grafo de pasadas); ningún uniform nuevo en B.
- **Costillas**:
  - El hueso cortical pasa de retrodispersión 0,9 a 0 (`tissues.ts`): lo que devuelve una costilla es el eco de su
    cortical anterior. La vértebra, sin cara (`vertebra-no-cortex`), conserva el suyo.
  - La difusa de la cortical cae con la transmisión de energía de la onda longitudinal en la cara, que la cruza de ida y
    de vuelta: T_E(θ)/T_E(0), T_E = 4·Z₁Z₂·cosθ·cosθ_t/(Z₂cosθ + Z₁cosθ_t)² con las impedancias de `TISSUES` (−2 dB a 20°,
    −8,6 a 26°), y 0 desde el ángulo crítico (`boneDiffuseWindow`, `BONE_CRITICAL_SIN`, `BONE_IMPEDANCE_RATIO`), sin la
    onda transversal, que entra hasta ~60° pero se atenúa en la cortical [EXTRAPOLACIÓN PROPIA]: la difusa de un hueso
    es la energía que la onda que entra devuelve desde la microestructura de la cortical, no una capa de Lambert sobre
    una cara lisa. El arco queda en la cresta.
  - Una sección por costilla (`RIB_SECTIONS`, semialtura × semiespesor): 6,8 × 3,0 / 7,3 × 3,2 / 6,9 × 3,5 / 6,2 × 3,3 /
    5,5 × 3,0 / 4,8 × 2,7 mm de la 5.ª a la 10.ª [ESTIMADO: alturas de 10–15 mm y espesores de 5–7 mm en la línea axilar
    media]; `ribSearchMarginMm` sigue valiendo (semiespesor ≤ 3,5 mm).
- **Pared** (`organs/wall.ts`, TS y GLSL):
  - Relieve fino (`wallWave`): tres senos oblicuos por cara, de 6,5–25 mm en direcciones a 60° (una a ≤ 30° de u y otra
    de z: la cara ondula en cualquier plano de corte), con pesos 0,25 / 0,35 / 0,40 y longitudes, direcciones y fases
    propias; ±0,35 mm los planos, ±0,5 Scarpa y la fascia profunda, y la transversalis 0,25·(grasa preperitoneal − 1).
  - Relieve lento (`wallSwell`): dos senos de 24–52 mm que cambian el espesor de la grasa subcutánea (±11 %, ±2 mm como
    mucho: la fascia sube y baja hasta ±1,5–2 mm en 2–5 cm y el músculo absorbe el cambio), la fracción de Scarpa (±0,06)
    y el reparto del músculo entre sus vientres (±0,06, cada plano por su lado) [ESTIMADO]. Un plano a menos de
    `planeMinMm` de la cara de encima (el otro plano o, si este se ha fundido con la fascia, la fascia) se funde con
    ella y deja de dibujar su cara; en los siete casos los planos no bajan de 1,07 mm entre sí, así que solo pasa con un
    músculo más fino. Piel y peritoneo no ondulan.
  - Cada término lleva un armónico entero fijo del perímetro (el del tronco de referencia: periódico en la vuelta; con
    otro tronco la longitud de onda cambia con el perímetro) y la GLSL solo calcula 2π/P; la documentación de
    `wallWavenumber` dice ahora que su λ es una escala (la longitud de onda es 2π·λ). Inclinación de Scarpa, la fascia y
    los planos sobre la piel: 6–9° de mediana, 15–23° en el p99 y 31–37° como mucho en los siete casos; |∇| de su
    distancia ≤ 1,48 (barrido de 0,5° × 0,5 mm), bajo la cota de la salida barata del eco (1,5). Con 20–30 mm de grasa
    llegaría a 1,50–1,61 aun con el tope de ±2 mm: la salida barata cortaría el perfil del eco a 3,3 σ en lugar de 3,5
    (−47 dB), sin efecto a la vista.
  - El gradiente de una cara de la pared es el de su capa con su pendiente (`wallFaceGradient`, TS y GLSL): −∇τ −
    ∂f/∂u·∇u − ∂f/∂z·ẑ, con ∇u analítico (`wallArcGradient`) y la pendiente por diferencias hacia delante
    (`wallFaceSlope`): tres evaluaciones de su profundidad en lugar de las seis de `wallFaceSd`; lo usa `faceGradient`,
    fuera de bucles. Las copias de la pared de la serie de la pleura (decisión 61, `wallFaceEchoFlat`), en su bucle,
    siguen con la normal de la piel: con la pendiente de la capa el bucle subía la compilación de B con SwiftShader ~3 s
    (medido con `scratchpad/rib/swcompile.mts`), y sin ella el eco de cada cruce queda a ≤ 1,3 dB del completo.
  - Coste en la pasada B (la pared se evalúa en la clasificación de cada plano de elevación, en su textura y en el
    gradiente de su cara): además de los armónicos fijos y del gradiente con tres evaluaciones, `wallFace` recibe las
    profundidades que la clasificación ya tiene.
- **Banco** (`app/fidelity.ts`, W7): en cada línea del haz, la línea de la pared hallada en el perfil se busca en la
  cara de la pared más cercana a ±2,5 mm (`WALL_FACE_SEARCH_MM`) y su pico, a ±0,6 mm de esa cara. Con la profundidad de
  la mediana, la ventana medía el moteado de al lado de una cara que el relieve (y ya las ondas de antes, ±1,2 mm)
  apartaba de ella.

**Consecuencias.**

- Oclusión (M4, flanco con dz +12, la escena de la pareja; `main` 281945d → la rama sobre 281945d, antes de la decisión 90; `scratchpad/rib/informe-88`,
  con el recorte y la normalización del juez junto a la real): bajo las tres costillas, de la cara posterior a 4 mm más
  abajo, la mediana pasa de −26,7 / −25,4 / −7,4 dB del hígado (gris 5 / 7 / 47; máximos +18 / +12 / +37 dB) a −42,8 /
  −44,8 / −43,7 dB (gris 0), el suelo de ruido; en el flanco sin desplazar, de −27,5 / −21,8 / −1,6 a −44,6 / −46,3 /
  −45,0 dB. La línea de la pleura y el peritoneo entra solo por el borde de cada costilla y se apaga en 1–2 mm (+34 dB
  del hígado en la línea del borde, y 25 → 11 → −7 → −28 dB en las líneas a 0,5 / 1,1 / 1,6 / 2,2 mm de él); el banco de
  ondas da −14 dB a 1 mm dentro del borde y 1,2 mm bajo la costilla: el cono de la apertura con el tope especular del
  rayo central apaga el borde algo más deprisa que la onda.
- Costillas: dentro del hueso, de −9/−12 dB (gris 27–36) a −36/−45 dB (gris 0): no hay disco, la sombra empieza en la
  cortical. La cortical sigue a +31–38 dB del hígado (antes +29–35) y su arco queda en la cresta. Sombras (negro en
  pantalla, gris ≤ 12): la costilla central (13,0 mm de hueso a 24 mm; antes 14,0) 10,9 / 9,9 mm a 28 / 40 mm (antes
  11,4 / 11,1), y la derecha (11,4 mm; antes 14,0) 8,7 / 6,8 / 3,5 mm a 28 / 40 / 52 mm, cerrada hacia 54 mm (antes 10,3
  / 8,0 / 6,2 y hacia 62): más estrechas que la costilla y cada vez más, como en el banco de ondas.
- Pared (escena de la pareja, clasificación de la CPU de la captura, líneas sin hueso): σ de la fascia profunda 0,25 →
  0,90 mm y del plano oblicuo 0,36 → 0,97; el CV de la separación entre caras vecinas, de 0,02–0,09 a 0,05–0,21
  (0,08–0,24 → 0,10–0,26 en la intercostal).
- Banco de fidelidad (M4, las ocho escenas, `main` 281945d → rama): W7, con la definición nueva, +9,0–13,1 dB en `main`
  y +8,3–13,0 en la rama, sin picos saturados (CV 0,61–1,00); con la de antes, `main` da 0,9 dB en la intercostal de la
  congestión grave y 4,4 en su flanco (fuera de la meta de +6–14: medía el moteado junto a la cara). W1 (líneas
  dentro): 5 / 5 / 5 / 6 / 5 / 7 / 6 / 6 → 3 / 5 / 5 / 5 / 3 / 7 / 6 / 4 (sano: subxifoidea, intercostal, flanco, renal;
  después la congestión grave): ≥ 3 en las vistas de la meta, la subxifoidea en el borde; la mediana lateral del perfil
  emborrona las caras que ondulan, que W7 encuentra a +8,3–13,0 dB. W4: cortical del flanco +23,3 → +23,6 dB (76 → 70
  líneas) y +21,6 → +24,0 en la congestión grave. G7 (acortamiento de la umbra por el compuesto, meta 1,5–8 mm): 0,85 /
  0,59 → 7,49 / 7,40 mm en los flancos (la umbra de la mirada 0 acaba a 28,8 mm tras la cara del hueso en lugar de
  24,8, y la del compuesto a 21,3 en lugar de 24,0): `main` no la cumplía. Hígado p50 igual (±1 gris); SNR de la
  envolvente ±0,004 salvo la subxifoidea (1,980 → 2,017, el relieve) y el flanco (1,984 → 1,944: las secciones nuevas
  cambian qué parches son hígado puro). El músculo de la intercostal baja de 62 a 52 de gris (0,67 → 0,56 del hígado,
  −3,6 dB; 65 → 55 en la congestión grave): los planos de elevación del haz (±2–3 mm a esa profundidad) entran en el
  borde de las costillas 8.ª y 9.ª, que ya no dan moteado, y la 8.ª es 0,4 mm más alta; con la sección de antes y el
  hueso a 0,9, 59 (el resto no lo separan las variantes: la pared sin relieve o la entrada de 6 dB dan 52; medido sobre
  `main` d49aa52). Es la dirección de la física (la parte del haz que da en la costilla no devuelve eco del músculo),
  sin el eco de volumen parcial de su cortical: `interface-echo-two-scale`.
- Coste (M4, Metal, `main` d49aa52 y la rama alternadas, 4–6 rondas, mediana; `scratchpad/gb/cost.mts`): la pasada B
  +0,7 ms en la intercostal y +0,3 en el flanco; el cuadro de la mirada 0, +0,5 / +0,3 ms, y con el compuesto +1,1 /
  +0,4 ms: la meta W6 de la decisión 62 (≤ +0,6 ms) queda superada con el compuesto en la intercostal, donde la pared
  llena el campo cercano. Casi todo es el relieve (con sus funciones a cero, B queda 0,1–0,3 ms bajo `main`); los
  armónicos fijos, el gradiente con tres evaluaciones y las profundidades compartidas le quitan ~0,15 ms. Compilación
  de B con SwiftShader (`scratchpad/rib/swcompile.mts`: compilar, enlazar y primer dibujo, rondas alternadas): el
  programa de la mirada 0 tarda como en `main` (11–14 s) con las copias de la pared con la normal de la piel, y ~3 s
  más con la pendiente de la capa en su bucle, que por eso no la llevan. Arranque de la aplicación con SwiftShader
  (`scratchpad/gb/boottime.mts`): sin diferencia fuera del ruido (±10 s con la carga de la máquina). `npm run
calibrate` da la misma salida byte a byte. Índice del build 324,9 → 329,5 kB sobre `main` 281945d; integrada tras la
  decisión 90, 329,2 → 333,7 kB sobre `main` c2133e1: el presupuesto sube de 330 a 335 kB (`tools/ci/bundle-budget.ts`,
  con su nota).
- Limitaciones: `vertebra-no-cortex` (la banda de su superficie, 0–0,9 mm), `no-sidelobes` (el pedestal apagado bajo un
  hueso), `interface-echo-scope` (las copias sin el relieve), `interface-echo-two-scale` (los planos de elevación en una
  costilla), `wall-generic-layers` (secciones, relieve, estrías y |∇| con mucha grasa) y `lumen-refraction-only` (el
  relieve desenfocaría). Quedan: la pleura que entra 1–2 mm bajo el borde de una costilla (la penumbra, física), el eco
  de volumen parcial de las costillas en elevación, la aberración de la pared y las capas de un solo hábito.

**Verificación.** `transmission.test.ts`: el hueso opaco (la cuerda más fina deja la pleura, +50 dB, bajo el negro, −30
dB), la interpolación de B sin mezclar a través de la entrada (el gemelo TS frente a la lineal; el umbral por encima de
la caída del gas por fila a 24 cm y por debajo de la de las líneas del borde de una costilla; la GLSL de B y D con
ella), los especulares con el rayo central y el pedestal de D apagado bajo un hueso (la GLSL de A2, A, B y D).
`interfaceEcho.test.ts`: la ventana de la difusa de la cortical frente a T_E(θ)/T_E(0) con las impedancias de `TISSUES`
(−2,0 dB a 20°, < −8 a 26°, 0 desde θ_c, las demás caras sin ella) y sus `#define` en la GLSL. `wall.test.ts`: cada
costilla con su sección, aplanada y en los rangos anatómicos, y el hueso sin moteado; el relieve (inclinación de 5–11°
de mediana y < 28° en el p99, |∇| < 1,5 en los siete casos; la fascia sube y baja ≥ 2 mm a lo largo del flanco y el CV
de la separación entre caras > 0,1; dos planos a < 1 mm se funden; las derivadas analíticas y de la pendiente frente a
las numéricas; el gradiente de las caras internas con la pendiente de su capa frente al de diferencias centrales de su
distancia, en dirección > 0,999 y en norma ±1 %; el eco plano de las copias a ≤ 1,5 dB del completo; la GLSL con los
armónicos enteros de la tabla y el tope de la grasa). `wallTwin.test.ts` (el gemelo A → B → C → D sobre la anatomía
real): bajo una costilla, lejos de su borde, nada entre su cara posterior y 3 mm más abajo pasa de −30 dB del hígado
(falla en `main`: −14 dB); el banco de la pared sigue con las cifras del gemelo (la cara interna contra grasa cae 3,8 dB
con el relieve, umbral 3,5: la transversalis inclinada entra en la ventana del fondo; sin sus muestras cae 6,4 dB, como
en `main`, pero ese fondo aparta también las líneas contra el hígado que la prueba compara). `shaderLimits.test.ts`
(huellas de A2, A y B), `passGraph.test.ts` (D lee `trans`), `steeredSample.test.ts` (la regla de la entrada también
en la rama dirigida de la cortina), `pleura.test.ts`, `refraction.test.ts` y `aperture.test.ts`, al día. e2e completa
con SwiftShader (equivalencia TS ↔ GLSL, paridad de la transmisión, pared) y capturas con GPU antes y después.
Revisión adversarial de contexto limpio sobre el primer commit: la regla de la entrada en el hueso faltaba en las
miradas dirigidas sobre la pleura de la cortina (la cortical perdía allí 0–20 dB según la rejilla); el pedestal se
apagaba también con la refracción de las luces (hasta 7,7 dB tras la vesícula) y el rayo sin hueso se calculaba en
lineal (se anulaba tras mucho gas); la ventana de la difusa era cos²θ_t, el doble del exponente de la transmisión de
energía; el umbral de 40 dB no retenía las líneas del borde de una costilla (20–35 dB en la apertura); el bucle de las
copias con la pendiente de la capa pesaba en la compilación de SwiftShader; |∇| pasaba de 1,5 con más grasa; el plano
profundo se comparaba con el superficial aunque este se hubiera fundido con la fascia; pruebas tautológicas, el umbral
renal sin medida y cifras y comentarios desajustados: corregidos. Al rebasar sobre la decisión 89, D enlazaba `uShadow`
en la misma unidad de textura que su `uRxNoise`: pasa a la 3.

## 89. Textura del parénquima y ruido del receptor: dispersores fuertes por debajo de la resolución, densidad de dispersores a escala de milímetros, tríadas en parte especulares y ruido por línea tras la PSF lateral

**Contexto.** Sirve al objetivo 2 (fidelidad ecográfica) y al 8 (honestidad). Rondas 3 y 4 del juez ciego (21/21 detectadas):
moteado «empedrado», de granos redondos iguales en brillo y tamaño y sin los destellos aislados del tejido real; luces
«con pinceladas» en lugar del ruido electrónico casi blanco; moteado «arrastrado en una dirección, como un desenfoque de
movimiento» en lo hondo y fuera del eje; y focos de tríada como elipses lisas iguales. Antes de tocar nada se midió con GPU
(M4, Metal, armónica y compuesto, apnea espiratoria, siete escenas de las cuatro ventanas de las capturas y de las parejas;
`scratchpad/tex/gpu.mts`) y sobre los paneles del juez con la normalización de la ronda 4 frente a las siete reales
(`panels.mts`, `cmp.mts`):

- **Envolvente de la mirada 0 en hígado despejado.** El m de Nakagami en ventanas de 2,7 mm (unas tres longitudes de
  pulso, como la imagen paramétrica), dividido por el del mismo estimador sobre un moteado de Rayleigh sintético con el
  grano medido: 0,99 (0,91–1,14). Un moteado difuso. El hígado humano sano da 0,81 (0,76–0,88) a 3,5 MHz, y ~1 los
  maniquíes de dispersores difusos con el mismo estimador (Wan et al. 2017, PLoS One 12:e0181789: 30 voluntarios, vista
  intercostal derecha; el m baja de 1,00 a 2 MHz a 0,81 a 3,5 MHz y lo atribuyen a los dispersores coherentes). En parches
  de 8 × 15 mm, SNR 1,79 (1,66–1,93) y m 0,83 (0,56–1,04): la cola la ponían ya las tríadas y la heterogeneidad lenta.
- **Imagen mostrada** (hígado despejado a resolución completa): asimetría del gris −0,01 (−0,11 a 0,14), un 0,33 % de
  píxeles con z robusta > 3 (mediana y 1,4826·MAD del recuadro de 8 mm sin su plano), 0,61 destellos por cm² (máximos
  locales en 1 mm con z > 3) y 0,30 de textura sobre la textura (DE de las medias de bloques de 4 mm sobre la DE dentro de
  ellos).
- **Paneles del juez** (hígado, parejas 1, 4, 5 y 7): reales, asimetría 0,46–0,67, z > 3 en el 1,3–2,1 %, 1,4–2,6
  destellos por cm² y 0,46–0,55 de heterogeneidad a 3 mm; simuladas, 0,04–0,22, 0,30–0,84 %, 0,3–0,7 y 0,41–0,51. La DE
  del gris es la misma (~15 niveles; el CV real es mayor porque los operadores bajaron la ganancia). En la z agregada la real
  tiene la cola brillante más larga (q99 3,84 frente a 2,87; q999 6,8 frente a 4,4) y la oscura más corta (q01 −2,02 frente
  a −2,31). Los píxeles de la cola real están sobre estructuras de milímetros, trazos cortos casi perpendiculares al haz
  (septos y paredes de los espacios porta), no sobre puntos sueltos.
- **Luces.** El ruido del receptor se sumaba en la pasada B y la PSF lateral de D lo correlacionaba entre líneas. En la
  envolvente de la luz (VCI y suprahepáticas de la subxifoidea, la subcostal y la intercostal, restando la media local),
  correlación 0,37 (0,25–0,52) con la línea vecina frente a 0,25 a 0,5 mm en profundidad; en la imagen, autocovarianza de
  1,58 × 0,72 mm (a lo ancho × en profundidad) y 0,39 a 1 mm a lo ancho. En los paneles reales, 1,11 × 0,75 mm y 0,14.
- **Estiramiento.** El eje mayor de la autocovarianza del grano mostrado queda a 1–6° (mediana por banda) de la dirección
  lateral local, también fuera del eje (|θ| ≥ 15°), y su alargamiento sigue a la PSF: 2,0–2,2 a 20–60 mm, 2,3–2,6 a 60–100,
  3,0–3,5 a 100–140 y 3,7–4,8 a 140–180. El grano mostrado es el de la envolvente, el compuesto el de la mirada 0 y la
  escena está quieta: no lo añaden la composición, la persistencia ni la conversión de barrido. Es la PSF lateral, y en las
  luces, el ruido filtrado por ella.

**Opciones.**

- (1) Un filtro de reducción del moteado o de realce del equipo: la cola oscura corta de las reales lo sugiere, pero es
  cosmético (§23) y ya se descartó en la decisión 84 (e).
- (2) Los grumos de la decisión 56 en el hígado: células duras de 1,2 mm, del orden de la PSF, que se ven como ecos
  sueltos y no como dispersores por debajo de la resolución.
- (3) Pocos dispersores muy fuertes (el 0,6 % de los nodos, ×10): m 0,68–0,95, fuera de la banda de la literatura en
  varias bandas, y un «cielo estrellado» de puntos iguales, que es un signo de hepatitis aguda: enseñaría una
  interpretación falsa (criterio 2; la decisión 78 ya lo vio con las tríadas).
- (4) Septos especulares en las fronteras de la densidad (láminas de σ 0,15 mm en el nivel medio del ruido de la densidad,
  con brillo |cos θ|⁴): con ×25 igualan las colas de los paneles reales (asimetría 0,69, z > 3 2,2 %, q99 3,94) pero
  dibujan un rayado regular de trazos brillantes por todo el hígado; con ×5 no se ven. Las métricas de cola se pueden
  igualar con una textura falsa: descartado, y queda como pendiente con un eco coherente y una población escasa.
- (5) Para el ruido: dejarlo en B (física equivocada) o una pasada nueva que lo genere (otro destino en el grafo). Elegido:
  en C, sin pasada nueva.
- (6) Para el estiramiento: estrechar la PSF sin evidencia nueva (es la de la decisión 84). No se toca: se mide y se informa.

**Decisión.**

- **(a) Dispersores fuertes** (`STRONG_SCATTERERS`, `strongScatter` y `strongNode` en `speckleField.ts`; `latticeValueS`
  en la anatomía GLSL; `latticeValuePh` de las miradas dirigidas). El 1,2 % de los nodos de la retícula del moteado del
  hígado (0,42 mm) son reflectores sub-resolución de amplitud ×4,5 sobre los demás: los de hash de fase b ≥ 1 − p, con la
  fase de cada grupo repartida en toda la vuelta ((b − 1 + p)/p y b/(1 − p)).
  - Nivel: cada muestra de la envolvente es la suma coherente de ~15 nodos, así que los fuertes no solo alargan la cola:
    también levantan la muestra típica. Con los demás nodos intactos, la mediana de la envolvente del hígado subía
    +0,48 dB (gemelo de la mirada 0, 16 realizaciones a 20, 45, 90 y 150 mm; +0,44 a +0,52 por profundidad) y con ella el
    gris del hígado y todo lo que el banco mide frente a él (la revisión adversarial lo encontró). Todos los nodos van a
    level = 0,946 (−0,48 dB): la mediana vuelve a la del moteado difuso (−0,03 a +0,06 dB por profundidad) y el hígado a
    media escala (decisión 53); la potencia media sube +0,42 dB. Normalizar la potencia media, en cambio, la bajaba ~1,3 dB.
  - Son nodos de la misma retícula anclada: se anclan, se funden y se decorrelan como el moteado (decisión 55). Son los
    mismos en las tres miradas, cuya fase solo gira la de cada nodo (decisión 58), y los tres planos de elevación los
    promedian como al grosor de corte.
  - Los bits finos de b no sirven para elegirlos: `hash13` sale de la parte fraccionaria de un producto de ~5·10³ y en
    float32 tiene ~2⁻¹¹ de resolución (con fract(991·b) < p la fase de los fuertes se agrupaba, resultante 0,48). Se eligen
    por arriba porque b = 0 exacto se repite en el ~0,04 % de los nodos.
  - Fracción y ganancia [EXTRAPOLACIÓN PROPIA], calibradas para el m de Wan et al.; el mecanismo, el de la literatura: una
    cola de dispersores fuertes da una envolvente pre-Rayleigh (distribución K, Jakeman y Pusey 1976; Tuthill, Sperry y
    Parker 1988, Ultrason Imaging 10:81; m < 1, Shankar 2000, IEEE TUFFC 47:727). En el hígado la dominan las estructuras
    conectivas de los espacios porta, separadas ~1 mm (Fellingham y Sommer 1984, IEEE Trans Sonics Ultrason 31:418).
- **(b) Densidad de dispersores** (`DENSITY`, `densityGain`). Un factor de amplitud 10^(x/20) con x un ruido de valor
  anclado al material, de célula 4 mm y escala 12 dB (DE 2,2 dB, mediana 0 dB), solo en el hígado. Va sobre el campo
  mezclado del plano central, como los grumos (`mediumField`, `mediumFieldPh`), y se suma a la heterogeneidad lenta de
  6,25 mm. Célula y escala [EXTRAPOLACIÓN PROPIA], calibradas con la heterogeneidad por escalas de los paneles reales.
- **(c) Tríadas** (`portalTriads.ts`, `sheathGainAt`). La ganancia de través va en [3, 10] con el cuadrado de su número
  (mediana 4,75 y media 5,3, frente a uniforme en [4, 9]; r·r exacto en la GPU, no `pow`). Es en parte especular: el
  exceso (G − 1) va por ε + (1 − ε)·(1 − (d·b)²)², ε 0,35, la ley |cos θ|⁴ de las láminas de la pared con el haz de cada
  mirada [EXTRAPOLACIÓN PROPIA]: la dirección radial desde el centro de curvatura, como la textura de la pared, sin la
  jacobiana de la compresión de la sonda ni la dirección reflejada en el espejo del diafragma (`portal-triads-diffuse`).
  La vaina sigue multiplicando el moteado del hígado, así que su eco está modulado por él. La consulta de la e2e de
  paridad usa un haz fijo (`TRIAD_QUERY_BEAM`).
- **(d) Ruido del receptor** (`receiver.ts`, `RECEIVER_NOISE_GLSL`). Sale de B: nace en los canales, detrás del
  transductor, y cada línea es otro disparo.
  - La pasada C lo genera por muestra (línea, fila) y cuadro: un complejo de componentes uniformes de varianza 1 (dos
    hashes por toma, sin logaritmos ni senos en el bucle). Lo filtra con su núcleo axial de energía unidad (el filtro de
    recepción, que con 7–25 tomas lo deja casi gaussiano) y lo escribe en su segundo adjunto (RG32F).
  - La pasada D lo suma en su línea tras la PSF lateral y antes de la detección, con su texel exacto (`texelFetch`: D
    escribe la rejilla de C). Su nivel no cambia: con núcleos de energía unidad, el ruido blanco conserva la varianza.
    Pero no es gaussiano del todo: la curtosis en exceso por componente, −1,2·Σw⁴, va de −0,09 a −0,42 según la
    profundidad seleccionada (−0,24 a −0,31 con 18 cm), así que la mediana de su envolvente queda 1,5–4,5 % sobre la de
    Rayleigh con la misma potencia: el suelo de ruido, hasta +0,4 dB con 24 cm (revisión adversarial).
  - B pierde `uNoise`, `uFrame` y `hash12b`: 126 ranuras de uniforms y 128 en el programa dirigido (antes 128 y 130). El
    índice del cuadro va módulo 4096 (`RECEIVER_NOISE_FRAMES`) para que el hash no pierda bits en una sesión larga.
- **(e) Estiramiento.** Sin cambios en la PSF (arriba). Con el foco a 130 mm en lugar de 90, el grano a 140–180 mm apenas
  cambia (3,23 → 3,16 mm; la PSF del modelo a 140 mm, 3,15 → 3,13 mm): en armónica la emisión a 1,75 MHz es ancha y lo
  hondo lo fija la apertura de recepción de 26 mm (decisión 84), no el foco.
- **(f) Guardas y objetivos del moteado con la textura.** Las métricas de la envolvente de la e2e y del banco (SNR por
  parche, fracción oscura, grietas, grano como FWHM de la autocovarianza normalizada por la varianza del parche,
  desviación del gris) se definieron para un moteado difuso (decisiones 52 y 58), y el hígado ya no lo es a propósito.
  Sus bandas se desplazan con lo que predice el gemelo B → C → D de la composición con y sin la textura
  (`parenchymaTextureTwin.test.ts`: la subxifoidea del sano a 20, 45, 90 y 150 mm, 8 realizaciones con las mismas sales),
  comprobado con GPU (M4) y SwiftShader:
  - SNR de la mirada 0 ×0,84–0,88 (1,99–2,01 → 1,69–1,75 en parches de 48 × 16; GPU 1,58–1,77; SwiftShader 1,58–1,65)
    y ×0,90–0,93 en los de 16 × 8 de la guarda de Rayleigh (2,08–2,11 → 1,91–1,95; SwiftShader 1,67–1,85): bandas
    1,45–1,9 (antes 1,75–2,1) y 1,5–2,1 (antes 1,6–2,25), suelos y techos. Los defectos, con la textura en el gemelo: la
    intensidad da 0,78–0,87 y 0,99–1,03; |Re f|, 1,24–1,29 y 1,35–1,39, con oscuros 0,19–0,20; suavizar la envolvente,
    2,09–2,20 (binomial [¼ ½ ¼]²) o 2,42–2,59 y 2,93–3,20 (la caja de 3 × 5 de `speckle.test.ts`): todos fuera, y la
    prueba lo exige. Las magnitudes sumadas antes del haz (≈ 9) también.
  - Compuesto ×0,75–0,80 (2,57–3,08 → 2,06–2,33; GPU 1,86–2,15; SwiftShader 1,91–2,02): la composición promedia el
    moteado, no la textura, que es la misma en las tres miradas, así que N_eff baja (1,61–2,29 → 1,27–1,57) y SNRc/SNR0
    sigue a √N_eff (÷ √N_eff: 1,03–1,08 en el gemelo, 1,03 con SwiftShader, 0,97–1,03 con GPU; G1 admite ± 10 %). G1 pasa
    a 1,7 en 20–60 y 140–180 mm y a 1,6 en 60–140 (antes 2,1 y 2,0); cada mirada, K5, a 1,45–1,9 (antes 1,75–2,1).
  - Fracción oscura de la mirada 0 +0,01 (0,074–0,078; GPU 0,068–0,096; SwiftShader 0,085–0,089): 0,05–0,11 (antes
    0,05–0,09). La del compuesto, 0,007–0,018 (GPU 0,007–0,025): G2 (≤ 0,035) no cambia y es la que separa el compuesto de
    una mirada.
  - Grietas: las zonas de menos densidad quedan bajo 0,3 × la media del parche y se unen (mirada 0 0,07–0,13 en el
    gemelo, 0,14–0,22 con SwiftShader; el valor absoluto de un campo real da 0,30–0,39 sin textura): < 0,25 (antes
    < 0,12). En el compuesto, con un 1–2 % de muestras oscuras, una sola zona alargada da 0,13 con SwiftShader (0 en otra
    corrida de la misma vista; gemelo 0–0,06; GPU 0): G3 pasa a ≤ 0,2 (antes ≤ 0,04) y ya no separa el compuesto de una
    mirada (0,14–0,22): lo hace G2.
  - Grano: la densidad, de 4 mm, añade un pedestal ancho a la autocovarianza. El grano medido crece +11–13 % en
    profundidad y +6–15 % a lo ancho en la mirada 0 (SwiftShader: axial 0,83–0,85 mm, lateral 1,10–1,17 × la PSF), más en
    el compuesto (lateral 1,08–1,17 × la PSF; SwiftShader 1,12–1,26; GPU 1,19–1,22 en las bandas con ≥ 5 parches, las que
    se miden, y 1,02–1,41 con menos), y la razón compuesto ÷ mirada 0 sube
    a 1,03–1,10 (SwiftShader 1,10–1,12). K2 pasa a 0,5–1,0 mm (antes 0,5–0,9), K1 a 0,8–1,4 (antes 0,8–1,25) y la razón
    de grano a ≤ 1,15 con ≥ 10 parches y ≤ 1,2 con menos (antes 1,1 y 1,15): un suavizado del compuesto con la textura da
    1,31–1,59 a lo ancho.
  - Desviación del gris: la del log de la envolvente crece ×1,19–1,27 en el compuesto y ×1,08–1,10 en la mirada 0. G4
    pasa a 12,5–17,5 (antes 10,5–14,0; GPU 13,6–17,0 por banda, SwiftShader 15,2–15,7), dentro de lo real: 10–16 en las
    referencias (decisión 58) y 10,9–17,0 en los paneles reales del juez (los simulados, 11,4–14,0, antes 10,9–12,7). θ
    no se recalibra: se calibró con el moteado difuso para absorber el exceso de N_eff de la mezcla de planos, que no
    cambia; la regla «mediana de 12–13» valía para el moteado difuso. La desviación del gris de una mirada en la imagen de
    la e2e, 18,3 con SwiftShader (antes 16 con GPU): < 21 (antes < 19, ×1,10 del gemelo).
  - Costuras del diafragma (e2e «ecos de interfaz»): los valles de −15 dB bajo la mediana del hígado son más probables
    en las células de poca densidad, también en el espejo tras la línea pleural. En la subxifoidea abanicada (23 registros
    a 40–60°) `main` da 0 costuras en dos corridas y la rama 1, 1 y 1 en tres y 2 en la e2e: se admiten 2 en un tramo de
    ≥ 15 registros (antes 1). La guarda directa de la costura de verdad, el espejo dentro del pulmón, es el desfase del
    espejo (≤ 0,05 mm), que no cambia.

**Consecuencias.**

- **Parénquima** (GPU M4, armónica y compuesto, apnea espiratoria, siete escenas; `scratchpad/tex/gpu.mts`, antes →
  después): m en ventanas de 2,7 mm ÷ el de Rayleigh 0,99 → 0,86 (Wan et al., 0,81 con 0,76–0,88), envolvente > 3 × la
  media del parche 0,57 → 1,16 % (Rayleigh 0,085 %); en la imagen mostrada, asimetría del gris −0,01 → 0,17, píxeles con
  z > 3 0,33 → 0,48 %, destellos 0,61 → 1,16 por cm² y textura sobre la textura 0,30 → 0,41, con el gris medio del hígado
  en 94 → 94 (media escala). En los paneles del juez (parejas 1, 4, 5 y 7) la heterogeneidad a 3 mm pasa de 0,41–0,51 a
  0,50–0,62 (reales 0,46–0,55), pero la cola brillante apenas se mueve (asimetría 0,04–0,22 → 0,09–0,20, reales
  0,46–0,67): la ponen trazos especulares de milímetros que el modelo no tiene (opción 4).
- **Luces**: la correlación de la envolvente con la línea vecina baja de 0,37 a 0,04 y la de 0,5 mm en profundidad queda
  en 0,26 (antes 0,25); en la imagen, la autocovarianza de la luz pasa de 1,58 × 0,72 a 1,27 × 0,74 mm y la correlación a
  1 mm a lo ancho de 0,39 a 0,23 (paneles: 1,72 × 0,71 → 1,43 × 0,79 y 0,39 → 0,24; reales 1,11 × 0,75 y 0,14). El nivel
  del ruido no cambia (la mediana de la luz del banco, 7–20, igual).
- **Banco** (`npm run fidelity`, M4, 2 casos × 4 vistas, `main` d49aa52 frente a la rama): mediana del gris del hígado
  93–95 → 92–94 (la renal del sano, 86 → 83, con 400 píxeles de hígado); interfaces dentro del ruido de la medida
  (peritoneo a 0–20° 1,76–1,98 → 1,74–2,07, pared anterior de la VCI a 0–20° 1,25–1,76 → 1,18–1,82, cápsula renal
  2,08–2,16 → 2,07–2,19); pared: grasa ÷ hígado, septos, estrías y cortical costal iguales (≤ 0,2 dB) y las líneas de la
  pared a −0,5…+0,9 dB de las de `main` (la renal, −1,5); luz igual. Con level = 1 (el primer commit) la mediana subía
  a 94–97 y las líneas de la pared bajaban 0,1–0,6 dB: el nivel de (a) lo corrige. Las métricas del moteado se mueven
  como predice el gemelo (f).
- **Coste** (M4 con Metal, subxifoidea, `frameCostMs(40, { repeatPass, repeatCount: 4 })` intercalado con `main`, carga
  7–12): B 3,22–3,23 → 3,37–3,40 ms (los nodos fuertes y la densidad: una comparación y un ruido de valor por muestra de
  hígado), C 0,09–0,10 → 0,12 ms (dos hashes por toma), D 0,27–0,28 → 0,30 ms (una lectura más); el cuadro, 7,95–8,48 →
  8,11–8,58 ms sin compuesto y 8,48–9,30 → 8,65–9,44 con él. Arranque con SwiftShader (tres rondas alternadas, carga
  10–12): 41,8 / 34,8 / 43,6 s en `main` frente a 40,4 / 42,0 / 44,4 s. Sin uniforms nuevos en B (libera dos) y ningún
  bucle nuevo.
- **Limitaciones**: nuevas `strong-scatterers-lattice` (nodos puntuales de dos niveles, sin septos alargados ni
  especulares, misma fracción en todo el hígado) y `receiver-noise-per-line` (sin recepción en paralelo); reescritas
  `speckle-statistics-uncalibrated` y `portal-triads-diffuse`.
- **Pendiente**: la cola brillante de los paneles reales (trazos especulares de milímetros: un eco coherente de cara y una
  población escasa, no una textura); el grano lateral hondo (1,9–2,2 mm reales frente a 2,6–3,4, la PSF de la decisión
  84); el ruido de las luces hondas, más claro que en las reales (mediana 13–23 frente a 5–7); la recepción en paralelo.

**Verificación.** Gemelos (fallan en `main`): `parenchymaTexture.test.ts` (los nodos fuertes solo en el hígado, ×4,5
sobre los corrientes, todos a −0,48 dB y +0,42 dB de potencia media; la fracción pedida ±5 % sin depender de la
amplitud, con la fase de cada grupo uniforme y sin agruparse por octantes; sin ellos, el nodo de siempre bit a bit, y en
cada mirada los mismos nodos; anclados como el moteado: 0,5° de inclinación los conserva igual; m en ventanas de tres
pulsos ÷ el del moteado difuso 0,74–0,92 (0,85); la densidad solo en el hígado, simétrica en dB, con DE 2,2 dB, y
continua; sus GLSL con las constantes de TS en float32 exacto, aplicados una vez en las dos mallas de B y en la pleura y
no en la pared), `parenchymaTextureTwin.test.ts` (lento: la mediana de la envolvente, la del moteado difuso a ±0,1 dB;
las bandas de (f) en el gemelo de la composición; y que la intensidad, |Re f| y los suavizados de la mirada 0 y del
compuesto siguen fuera de ellas), `receiver.test.ts` (el ruido por muestra de media 0 y varianza 1 por componente,
blanco entre líneas, filas y cuadros; con el núcleo axial de C, la misma varianza, la correlación del pulso a lo largo
de la línea y ninguna entre líneas; en C y D, no en B), `portalTriads.test.ts` (la ganancia de través con cola, la
mediana a un cuarto del intervalo; 1 + ε·(G − 1) a lo largo del haz y monótona entre los dos; la consulta de la e2e con
un haz fijo y unitario), `speckleField.test.ts`, `pleuraTwin.test.ts` y `wallTwin.test.ts` (sus gemelos con la textura
del hígado y el ruido por línea: el deslizamiento a SLIDING_DB y la pared no cambian), `passGraph.test.ts` (C con dos
adjuntos; D lee el del ruido), `shaderLimits.test.ts` (B en 126 y 128 ranuras; huella nueva del programa de la mirada 0)
y `harmonic.test.ts` (la ganancia del ruido de la armónica, ahora en C). e2e completa con SwiftShader (28 pruebas; las
que fallaron por el plazo con la máquina cargada, repetidas solas). Capturas con GPU (M4, armónica y compuesto) de las
ventanas intercostal, subxifoidea, renal y subcostal antes y después, y paneles del juez frente a las reales. Revisión
adversarial de contexto limpio sobre el primer commit, sin defectos bloqueantes: la mediana de la envolvente del hígado
subía +0,48 dB con los nodos corrientes intactos (el nivel de (a)); el techo de K1 lo rompía el banco en bandas de menos
de 5 parches (se miden las de ≥ 5); las guardas de una mirada solo movían el suelo y citaban los defectos del moteado
difuso (techos nuevos y los defectos con la textura en el gemelo); la curtosis del ruido, mal citada; el gemelo del ruido
no seguía el orden de float32 del GLSL; `pow` en la ganancia de las tríadas (ahora r·r) y el ruido leído con `texture`
(ahora `texelFetch`); la ley especular de las tríadas sin la compresión ni el espejo (documentada); texto roto o viejo en
APPROXIMATIONS, ARCHITECTURE y comentarios: corregidos.

## 90. Vasos orgánicos: sección elíptica y radio que ondula en las venas del hígado, y una VCI que se curva y cambia de calibre sin tocar el sitio de medida

**Contexto.** Sirve a los objetivos 3 (fidelidad anatómica) y 2 (fidelidad ecográfica) de `docs/MISION.md`, con el 4 como
restricción: el diámetro de la VCI es la medida de VExUS. Ronda 4 del juez ciego (27-09-2026, 21/21 detectadas): la pista
n.º 1 es la **geometría de primitivas**. La VCI del flanco en la congestión grave (pareja 5, la peor, 1/7) es «un tubo recto
horizontal de paredes paralelas de borde a borde y calibre exactamente constante, la geometría de un maniquí»; en la
subxifoidea, «una banda curva de paredes perfectamente paralelas y líneas de brillo constante»; los vasos pequeños, «círculos
perfectos», y las suprahepáticas de la subcostal (pareja 7), «un cuerpo redondo más un cono recto». Antes de tocar nada se
midió con la anatomía TS en el marco de la captura (lienzo 1744 × 1542, 18 cm, compresión de la sonda y calibre del caso en
apnea espiratoria; `scratchpad/vasc/measure.mts`):

- Flanco, congestión grave, recorte del juez (z −68…16 de la VCI infrahepática): anchura de la luz 30,1–30,8 mm (CV 0,6 %) y
  cada pared a 0,09 mm de su recta de mínimos cuadrados. La VCI del modelo era casi recta en el plano coronal (x −22 a −20
  entre z −64 y 35) y de radio constante (9,8–10 mm), y el plano del flanco la sigue: dos rectas paralelas.
- Subxifoidea, sano (z −47…33): CV 3,2 % y cada pared a 0,14–0,16 mm de una parábola: la «S» sagital de la decisión 69 sin
  nada más.
- Subcostal, congestión grave: la VSH media, un tramo recto de 43 mm con el radio lineal (3,2 → 4,0 mm, ×1,6), que sale del
  plano hacia su extremo: un cono.
- Todas las secciones eran círculos (solo la VCI tenía sección elíptica, la de `apScale`), y todos los radios, lineales
  entre nodos.

**Opciones.** (1) Solo datos: más nodos en todos los vasos. Poligonales con quiebros en las paredes; y la VCI, cuya esfera
envolvente contiene casi todo el abdomen, es un tubo que consulta casi cada muestra: con 8 segmentos en lugar de 6 el cuadro
de la subxifoidea subía 0,3 ms (Metal, M4). (2) Deformar el espacio de todos los tubos con un campo de desplazamiento
suave: la deformación cambia los calibres hasta un 2πA/L (10–30 % con 1–2 mm de amplitud y 4–6 cm de onda), también en el
sitio de medida de la VCI. (3) La elegida: una forma procedural anclada en las venas del hígado (sección y radio), en TS y en
la GLSL, y la VCI con su recorrido y su calibre en sus nodos, fuera de la VCI que puede medir el alumno.

**Decisión.**

- **Forma de las venas del hígado** (`anatomy/primitives.ts`: `TubeShape`, `TUBE_SHAPE`, `tubeShapeOf`, `tubeNoise`,
  `tubeShapeTexel`; su gemelo en `tubeQuery` y `tubeFace` de `anatomy/gpu/anatomy.glsl.ts`). La distancia al eje es la de una
  métrica elíptica fija en el marco material, f(d) = c·√(|d|² + κ(d·ŵ)²) con c = (1 + κ)^(−1/4): en un segmento
  perpendicular a ŵ la sección es una elipse de semiejes r·(1 + κ)^(±1/4) y área πr², y su orientación no salta en los codos
  (f no depende de la tangente del segmento). Donde el segmento se inclina hacia ŵ la sección se redondea y crece, área ×
  √(1 + κ)/√(1 + κ(1 − (ŵ·t)²)). ŵ es la parte perpendicular a la cuerda del tubo (del primer nodo al último) de un vector de
  un hash entero del índice del tubo (lowbias32, el mismo en TS y en la GLSL), así que ese factor queda en ≤ 1,037 en los
  tubos del modelo (con ŵ perpendicular al primer segmento llegaba a 1,14 en el codo de 65° de la rama lateral izquierda de
  la porta: revisión adversarial). κ sale del mismo hash: suprahepáticas 0,2–0,9 (cociente de ejes 0,91–0,73) y porta, de
  pared gruesa, 0,1–0,4 (0,95–0,85); κ medio 0,43 [EXTRAPOLACIÓN PROPIA: los rangos]. κ se divide por el cuadrado de la
  dilatación del instante: la vena distendida se redondea (ley de tubo colapsable; Shapiro 1977), y en la congestión grave
  (×1,6) el cociente de las suprahepáticas queda en 0,96–0,86. El radio ondula a lo largo del eje,
  r = r_lineal·(1 + amp·N(s)), con N un ruido de valor de la longitud de arco (celda de 30 mm, fundido smoothstep, valores en
  [−1, 1], correlación de 1–3 cm) y amp 6 % en las suprahepáticas y 5 % en la porta [EXTRAPOLACIÓN PROPIA]. Lo llevan las
  suprahepáticas y las ramas portales con sus ramas procedurales (70 tubos en el sano).
- **Sin forma** (`tubeShapeClassOf` en `anatomy/vesselTree.ts`): la VCI (su elipse es la de la fisiología), las arterias
  (redondas por la presión), las venas renales (la izquierda cruza la pinza aortomesentérica con milímetros de holgura), las
  interlobares (1–2 mm, junto a su arteria) y los conductos biliares; y los dos vasos que llevan las puertas PW del protocolo
  en la cadena del alumno (`PW_GATE_VESSELS`: la suprahepática derecha desde la intercostal y el tronco portal), porque la
  lectura de una captura depende de la realización del moteado espectral y de la luz junto a la puerta: con la forma también
  en ellos la puerta intercostal se movía 3 mm, la cadena cambiaba de lectura (la renal leía «bifásico» en el sano o en la FA:
  la prueba comparte el generador del volumen de muestra entre territorios) y la limitación
  `ppv-hepatic-capture-false-reversal` dejaba de reproducirse con la puerta del operador.
- **La GPU**: la forma del instante viaja en un quinto téxel de la cabecera de cada tubo (H4 = (ŵ·√κ_ef, amp), escrito por
  cuadro con la dilatación; `TUBE_HEADER_TEXELS`, `NODE_BASE` 512 → 640 téxeles), sin ranuras de uniforms. En el bucle de
  tubos de `classifyWith`, `tubeQuery` solo da la distancia: elige el segmento sin el ruido (continuo en la longitud de arco,
  sin escalón en las uniones) y aplica el ruido una vez, en él, y solo con la muestra a menos de 1,5 mm (+ amp·r) de la luz:
  más allá ninguna pared la alcanza (la periportal llega a 1,4 mm) y el tubo no la clasifica. La cara del tubo que gana
  (`tubeFace`: su eje, el gradiente analítico con el crecimiento del radio por el ruido y la curvatura ĉᵀQĉ/(r·|∇f|), la de
  la elipse) se calcula una vez y fuera de los bucles. El bucle de segmentos lee cada nodo una vez y da las vueltas del tubo
  (no la cota constante): con la cota constante y un cuerpo tan corto, el JIT de SwiftShader lo desenrollaba en cada copia
  de `classify` y el arranque de la e2e pasaba de 55 a 111 s con la máquina cargada. TS da siempre la distancia con ruido
  (`tubeQuery`, `tubeFaceGradient`); en las dos el ruido va con la forma y la métrica elíptica, con `apScale` = 1 (un tubo con
  forma nunca es de la VCI: lo fija la prueba).
- **VCI** (`vesselTree.ts`, 6 segmentos como antes). La VCI que puede medir el alumno no cambia: de z −14 a 35 su radio es
  el de referencia (10 mm), desde 1–2 cm bajo la confluencia de las suprahepáticas (que desembocan a z 39–43) hasta más allá
  de la línea M «más perpendicular» de la e2e (z ≈ 0), y de 35 a 47 el de antes (10–10,2). Por debajo, el eje se curva también
  en el plano coronal (1,0 mm hacia la derecha del paciente a z −40 frente a la cuerda entre el nivel renal y z −14; sube por
  la derecha de la columna, detrás del hígado, y se inclina hacia delante y hacia dentro hasta la aurícula: Gray; PMC8405820),
  a ≤ 0,6 mm del eje sagital de la decisión 69, y el calibre se estrecha: 9,75 mm en el nivel renal (9,8 antes: la arteria
  renal derecha pasa por detrás), 9,3 a z −40 (−7 %, donde la porta le pasa por delante) y de vuelta a 10 en z −14
  [EXTRAPOLACIÓN PROPIA: la curva y la cintura; la TC de 200 adultos sanos no halla diferencias de calibre entre el nivel
  renal y 2 cm bajo la AD, AP 16,3 frente a 16,9 mm: PMC9789330]. Su radio entre nodos es smoothstep (pendiente nula en los
  nodos, `Tube.smoothRadius`, que la GPU recibe como H4.w = −1): sin quiebros en las paredes (con 6 segmentos y el radio
  lineal la pared lateral de la VCI dilatada se doblaba 17° en un nodo). La marca es explícita y solo de la VCI infrahepática:
  la supradiafragmática conserva el embudo lineal de la decisión 85 (con el smoothstep atado a la sección elíptica cambiaba
  su radio un 3 % entre nodos, y la VCI dilatada de la congestión grave llega a `apScale` 0,985, a un paso de perder la
  marca). Quiebros del eje: 5,3° a z −40, 4,5° a z −14 y 2,1° a z 15; 6,8–6,9° en la «S» de la decisión 69 (7,9° y 8,3°
  antes); la unión con la supradiafragmática, la de antes (5,8°).
- **Confluencias**: la suprahepática media se curva 3 mm en el plano de la subcostal y es más tubular (3,2 → 3,8 → 4,0 mm),
  se abre en el tronco común (4,4 → 5,2) y su tributaria desemboca en el eje curvado [EXTRAPOLACIÓN PROPIA: los perfiles]. La
  derecha (puerta PW) entra como antes: un embudo en su ostium (una esfera de 8 mm dentro de la VCI) salía 1–2 mm por detrás de
  la pared posterior de la cava y teñía de su flujo 0,25–1 cm³ de la luz de la VCI (revisión adversarial).
- **Contención de las ramas procedurales**: su recorrido debe caber con el mayor saliente de su forma
  (`tubeShapeMaxFactor`, (1 + amp)·(1 + κ_máx/s²)^(1/4); `branchShapeMax`); las 60/58 ramas de los siete casos no cambian.

**Consecuencias.**

- Recortes del juez con la anatomía TS: flanco grave, anchura de la VCI 28,3–30,8 mm (CV 0,6 → 2,8 %) y la pared inferior a
  0,58 mm de su recta (antes 0,10); subxifoidea sana, CV 3,2 → 6,6 % (la anchura baja de 13,7 a 12,1 mm hacia caudal, donde
  la VCI se aparta del plano sagital: el efecto cilindro de siempre); subxifoidea grave, CV 1,7 → 3,7 %. Capturas con GPU real
  (Metal, armónica y compuesto, apnea espiratoria) antes y después, y los recortes del juez junto a sus reales:
  `scratchpad/vasc/caps-final/` (flanco grave, subxifoidea sana y grave, subcostal grave). La VCI del flanco deja de ser dos
  rectas paralelas (se estrecha y se ensancha con suavidad) pero sigue siendo una banda de borde a borde; la de la
  subxifoidea se estrecha hacia caudal; la VSH media de la subcostal se dobla; las venas del hígado cortadas de través son
  óvalos. Efecto modesto: la cintura de la VCI queda fuera de la VCI que mide el alumno.
- Calibración intacta: `npm run calibrate` da la misma salida byte a byte (áreas de la fisiología por `refRadius` y
  `apScale`). En la imagen, el diámetro AP de la VCI en la vertical por su eje es el de la fisiología a ±1,7 % de z −14 a 20
  en los siete casos, llena y vacía (main, lo mismo; más arriba la luz de las suprahepáticas dilatadas se suma a la de la VCI,
  también en main). La cadena del alumno (`examChain.test.ts`, 7 casos × 3 territorios) da las mismas puertas y 19 de 21
  lecturas idénticas bit a bit: el tronco portal de la cirrosis cambia un escalón de velocidad de la envolvente (vMáx 13,6 →
  12,2 cm/s, FP 40 → 33 %, verdad 32–35 %; la luz de la VCI junto a su puerta cambia la realización del moteado espectral) y,
  tras él, la renal de la cirrosis su fracción de columnas con sangre (0,82 → 0,90; patrón y velocidades idénticos), sin
  cambiar el grado. La lectura renal aislada es idéntica en las 12 realizaciones probadas por caso. La VSH media desde la
  subcostal, que la cadena no medía, queda a 32° del haz a 1–2 cm de la VCI en espiración (40° antes; 47° en la inspiración
  tranquila, como antes; la puerta del operador, 34° y 56°, antes 42° y 50°), y su lectura da el patrón de la verdad en el
  sano, la FA y la congestión grave (prueba nueva); sin corrección de ángulo el pico S del sano sube de 42,6 a 46,2 cm/s. La
  velocidad sigue uniforme por vaso (decisión 6): en el eje de una vena con forma, la misma en todo su recorrido. La VCI
  dilatada de la congestión grave ya tocaba la porta y la arteria renal derecha: su trazado nuevo no empeora ninguna holgura
  (en apnea espiratoria: tronco portal −4,47 → −3,88 mm, rama derecha −2,12 → −1,23, izquierda −1,74 → −0,67, arteria renal
  −4,96 → −4,92).
- Vecinos y uniones: la pared de la rama izquierda de la porta se funde 0,8 mm con la del colédoco (0,3 antes; las luces,
  a ≥ 1 mm: la vaina de Glisson), y la holgura de la suprahepática izquierda con la rama lateral de la porta sigue en 1,1 mm.
  Donde nace una rama procedural, la sección y el ruido de la hija y de la madre no coinciden: la esfera de origen asoma
  ≤ 0,04 mm de la luz de la madre y la luz de la hija con su forma ≤ 0,21 mm (0,17 con la dilatación de la congestión), frente
  a una PSF de 1–3 mm.
- Equivalencia TS ↔ GLSL con GPU real (Metal): acuerdo de tejido y de vaso 1 en 50 000 puntos de cada caso, velocidad a
  ≤ 10⁻⁶, distancia de cara ≤ 2,3·10⁻⁵ mm, cáscara de caras con acuerdo 1 (error ≤ 1,2·10⁻⁴ mm) y normales de los tubos con
  p01 = 1 (norma p95 ≤ 1,1·10⁻⁴).
- Coste (Metal, M4, medianas de 5 rondas alternas, carga 2,5–3,5, sobre main d49aa52): subxifoidea 8,23 → 8,53 ms, flanco
  9,93 → 10,28, subcostal 11,15 → 11,54 (+0,30–0,39 ms, ~+3,5 %); sobre main con la decisión 89 (8 rondas, carga 4–6),
  +0,12–0,26 ms. La primera versión (el hash de la forma en cada consulta, la cara de todos los tubos consultados y la VCI en
  8 segmentos) costaba +1,1 ms. Arranque con SwiftShader (tres rondas alternas, mínimos): 24,7 s en main y 25,7 s en la rama
  con carga 2,7–3,3, y 28,9 y 30,5 s sobre main con la decisión 89 con carga 4,4–4,7 (+4–6 %, sin el desenrollado de la
  decisión 61; con carga 10–16, 39,0 y 36,7). Índice del build 324,9 → 329,2 kB (sobre main con la decisión 89): presupuesto
  de 325 a 330 kB.
- Limitación nueva `procedural-vessel-shape`. Quedan: las fillets de las confluencias (la unión de dos tubos sigue siendo la
  de sus cápsulas), la vena hepática inferior derecha accesoria (una variante frecuente que el flanco vería entrar en la VCI
  retrohepática), la vesícula cortada de través (un círculo, en la subcostal), la forma de las arterias, de los conductos y
  de los vasos de las puertas PW, y la VCI del flanco, que sigue cruzando el recorte de borde a borde.

**Verificación.** `vesselShape.test.ts`: la forma anclada de cada vaso (semilla = su índice en la lista de la GPU, ŵ unitaria
y perpendicular a la cuerda del tubo, κ en su rango; sin forma la VCI, las arterias, la cadena renal, los conductos y los
vasos de las puertas PW; el radio smoothstep solo en la VCI infrahepática y nunca con forma), la sección elíptica de área
conservada con sus curvaturas a/b² y b/a² y la vena distendida que se redondea, el crecimiento de la sección en los
segmentos inclinados hacia ŵ (≤ 4 % en todos los tubos de los siete casos; la fórmula, frente al área medida en el codo de la
rama lateral izquierda de la porta), el ruido (acotado, continuo con derivada nula en las celdas, correlado a 5 mm e
independiente a tres celdas; el hash con valores de referencia de lowbias32 calculados aparte), el gradiente analítico frente
al numérico en todos los segmentos y tapas de las venas con forma (|n·∇| > 0,9999, norma a < 10⁻⁴), la velocidad uniforme en
el eje de la VSH media con el radio que cambia por la forma, la GLSL con las constantes del módulo, la forma en H4 y la marca
del smoothstep, la luz de las ramas en su origen (≤ 0,3 mm fuera de la madre), el alcance del ruido frente a la pared más
gruesa, la VCI que mide el alumno (10 mm de z −14 a 35 y 10–10,2 hasta 47; en la imagen, su diámetro AP a ±2 % de la
fisiología de z −14 a 20 en los siete casos, llena y vacía), la cintura sin quiebros y el eje que se curva en el plano
coronal (> 1 mm; falla con la VCI de main) con quiebros acotados y la unión con la supradiafragmática de antes, la VSH derecha
de antes y las holguras de la VCI dilatada en apnea (ninguna peor que en main). `anatomy.test.ts`: la contención de las
ramas con el saliente de su forma, la pared lateral de la VCI a z 0 (la de antes) y la esfera de origen de las ramas dentro
de la luz con forma de su madre (a ≤ 0,05 mm). `examChain.test.ts`: la VSH media desde la subcostal por la cadena del alumno
en el sano, la FA y la congestión grave. `faceNormals.test.ts` y `faceGradient.test.ts` con la GLSL nueva. e2e completa con
SwiftShader (equivalencia, normales, modo M). Revisión adversarial de contexto limpio sobre `git diff origin/main..HEAD`: sin
bloqueos; un hallazgo mayor, la ondulación del +5 % a z −6 dentro de la ventana subxifoidea, que inflaba un 4,5–5,8 % el
diámetro AP de la imagen en los siete casos (el sano a 0,22 mm del umbral de 2 cm), corregido con la cintura por debajo de
z −14 y la prueba del diámetro de la imagen; y menores, todos corregidos: el área «conservada» que crecía hasta un 14 % en los
codos (ŵ perpendicular a la cuerda), el embudo de la VSH derecha que salía por detrás de la VCI (quitado), el smoothstep atado
a la sección elíptica que cambiaba también el embudo de la decisión 85 (marca explícita), la prueba de holguras sin apnea y
con umbrales que main también pasaba, la prueba del origen de las ramas que quitaba la forma, la puerta de la VSH media de la
subcostal sin cadena y con su comentario de ángulos viejo, el ruido de la GLSL con cualquier `apScale` frente al de TS (el
mismo ahora en las dos), y pruebas y cifras de la documentación. Verificado por el revisor: la paridad TS ↔ GLSL (portó a JS
la consulta, la cara y el bucle de tubos de la GLSL sobre la textura del renderizador: distancia ≤ 4,8·10⁻⁶ mm, normales a
cos ≥ 0,99999998), el alcance del ruido, la disposición de la textura, los gradientes analíticos, la salida de
`npm run calibrate` y la cadena del alumno.

## 91. Costuras y peine: la penumbra es la integral exacta de su cono, los ecos especulares llevan la transmisión de sus pares en la apertura y la mirada dirigida refleja su propio camino en el espejo

**Contexto.** Sirve al objetivo 2 (fidelidad ecográfica) con el 1 (causalidad) como criterio de `docs/MISION.md`: un
artefacto sin causa física. Ronda 5 del juez ciego (27-09-2026, `main` 6c0ba5b), pista n.º 1 de los dos jueces, «costuras y
peines»: en la VCI del flanco de la congestión grave (pareja 5) dos costuras verticales con la textura cambiando de golpe
por encima y por debajo de la VCI y la pared anterior rota en una de ellas («una sombra real seguiría el haz a través de la
luz»); en la subcostal de la congestión grave (pareja 7), en el borde izquierdo, una banda diagonal de estrías
horizontales «en peine», ni paralelas a una cara (reverberación) ni radiales (colas de cometa). Antes de tocar nada se
reprodujo con GPU real (M4, Metal, armónica y compuesto, apnea espiratoria, las escenas y recortes de
`scratchpad/gb/blind5.mts`) y se leyeron en (línea, profundidad) la envolvente del compuesto y de cada mirada, las
transmisiones de A, el campo de B y los impactos de A0 (`scratchpad/seam/cap.mts`):

- **Costuras del flanco.** Caen en las líneas de la sombra de la tercera costilla (hueso en las líneas 77–99, a 21–24 mm).
  La transmisión con apertura de A iba a escalones: a 80 mm, −38,6 / −47,1 / −47,1 / −44,1 / −44,0 / −55,5 dB en las
  líneas 80–85 de la mirada 0, no monótona y con saltos de 5–13 dB que seguían toda la profundidad; el cono se promediaba
  con nueve tomas en líneas enteras (decisiones 54 y 86), y cada toma que cruzaba el borde de la costilla movía la media
  su peso (hasta 0,22 con la ventana de Hann), en una línea y otra vez al abrirse el cono en profundidad. Y los ecos
  especulares llevaban a lo sumo la transmisión del rayo central (decisión 88), −140/−180 dB en las líneas cuyo rayo cruza
  el hueso: la pared anterior de la VCI, a 107 mm, 85 mm bajo la costilla, desaparecía en esas líneas con bordes de una
  línea (gris 19–30 frente a 60–71 al lado), y en el compuesto cada mirada la rompía en otro sitio (la costilla a ±8
  líneas en las dirigidas).
- **Bisección.** Con el hueso transparente en A1 (el mismo moteado, `scratchpad/seam/p_nobone.py`) no queda ninguna
  costura: son de la sombra, no de la VCI. El cociente de la envolvente con y sin hueso aísla la sombra de cada mirada: en `main`, bandas
  verticales en toda la profundidad y la pared en negro. Con 99 tomas la transmisión se vuelve continua (la sombra deja de
  ir a bandas, la pared sigue rota); con la especular por la apertura, la pared vuelve (la textura sigue a bandas); con las
  dos, las tres miradas quedan suaves. No eran las uniones de nodos de la VCI (decisión 90: sin hueso siguen ahí y no hay
  costura), ni la compresión de la sonda (su tabla cambia 0,07–0,09 mm entre nodos en esas líneas y no alcanza los 145 mm),
  ni el pedestal de D (igual al apagarlo), ni la conversión de barrido (las costuras ya están en la envolvente), ni el
  acoplamiento (1 en todas esas líneas).
- **Historia.** c2133e1 (decisión 90, antes de la 88): la pared de la VCI entera y la sombra suave; 6c0ba5b (88): pared
  rota y costuras. El hueso opaco (100 dB a la entrada) hizo que las tomas tapadas pesaran 0 exacto, y el tope del rayo
  central apagó la especular hasta el fondo.
- **Peine de la subcostal.** Es de la mirada +7° (la 0 no llega: el borde de la cara no apoya, acoplamiento 0 desde la
  línea 178; la −7° sale del arreglo): sus caminos por las líneas 174–181 cruzan el pulmón en el espejo de la línea 174, a s = 32,2 mm, y más allá la
  pasada B dibujaba el tejido a lo largo de la reflejada de esa línea para todos los caminos (decisión 58: «el espejo no se
  dirige tras la reflexión»). Apagando el espejo de la mirada dirigida el peine desaparece; apagando su cortina, no; sin
  la fase de la mirada tras el espejo, tampoco. Con el propio camino reflejado (dirK en la normal de la pleura) desaparece.
  El gemelo de la geometría (`steeredSample`) lo explica: con una sola dirección reflejada, el giro del haz de una línea a
  otra no llega a lo reflejado y el mapa de la imagen al tejido lleva una dirección de la imagen casi entera a la elevación,
  donde la retícula del moteado va comprimida hasta el grosor de corte (decisión 55): 0,031 mm de tejido fuera de la
  elevación por mm de imagen, un estiramiento ×30 (las estrías), frente a 0,35 con el propio reflejado. Está desde que
  existe la vista (99ed6d5, decisión 83, más débil) y se ve bien desde la decisión 85 (88346eb), que cambió lo que hay
  detrás del diafragma.

**Opciones.** Para la penumbra: (1) más tomas (99): continua a trozos y cara con los conos anchos; (2) la elegida, la
integral exacta. Para los especulares: (1) el rayo central de la decisión 88 (la pared rota); (2) la de la apertura, la del
moteado: la pleura volvería a asomar bajo el borde de una costilla, lo que la 88 corrigió; (3) los pares puros de espejo:
con una costilla junto a la línea, los pares tienen un lado en el hueso hasta el fondo, y la pared quedaría rota en las
líneas del borde (≈ 0 frente a 0,12 en el centro a 107 mm); (4) la elegida, los pares con el reparto de las facetas.
Para el peine: (1) apagar el espejo en las miradas dirigidas: dejarían de ver tras el borde del pulmón, que el compuesto
real sí ve; (2) la elegida, el propio camino reflejado.

**Decisión.**

- **Penumbra** (`ultrasound/aperture.ts`: `apW`, `apCones`, `apEcho` de `APERTURE_GLSL`; gemelos `apertureWindowIntegral`,
  `apertureCones` y `apertureEcho` de `transmissionTwin.ts`). La media de cada cono es la integral exacta de su ventana
  (la de Hann de la emisión, cos²(π·x/(2h)), y la uniforme de la recepción) sobre la transmisión de ida de las líneas,
  constante en la anchura de cada una ([l − ½, l + ½]), con la del borde fuera del arreglo: continua en el semiancho (la
  profundidad) y en el centro, y un cono más estrecho que una línea es el rayo de su línea. Un solo bucle por los dos
  conos, del centro hacia fuera con la línea y su simétrica (≤ 37 vueltas, dos lecturas cada una) en lugar de 18 tomas.
  La ventana de Hann se integra desde su borde más cercano (`apG`: ∫ sin² de 0 a y), sin la cancelación de la primitiva en
  float32 (la última loncha parcial de un cono, de peso ~10⁻⁵, salía con un 6–12 % de error y movía los pares 5·10⁻³ dB);
  un cono de anchura nula (1 − r₀/r redondeado a 0) es el rayo de su línea; y el obstáculo se busca hasta el mayor de los
  dos conos, `max(D_tx, D_rx)`/2 en la cara (con el foco a 20–30 mm la emisión mide 8–12 mm y la recepción hasta 26: una
  costilla dentro de la recepción y fuera de la búsqueda no contaba, y al entrar en ella la transmisión saltaba hasta
  2,5 dB en una línea). `APERTURE_SEARCH_LINES` (40) cubre el mayor cono de todas las miradas, 35,4 líneas con 8°.
  Sin redondeos: la paridad de la GPU con los gemelos (`steeredParity.ts`) deja de desplazar las tomas y marca el empate de
  la transmisión con apertura desde la mitad de lo que admite la e2e (`TIE_APERTURE_DB`, 5·10⁻³ dB): cada muestra integra
  todas las líneas de su cono y un empate del camino de una vecina la mueve lo que esa línea pesa (con el umbral del prefijo,
  0,3–0,9 % de empates en las cuatro vistas; ahora 0,08–0,51 %, antes 0,2–0,6 %).
- **Ecos especulares.** A calcula en el mismo bucle la transmisión de los pares (el rayo de emisión que cruza el obstáculo
  en u vuelve de una cara lisa por −u: media de T(u)·T(−u) con la ventana de emisión dentro de la recepción) y la mezcla
  con la de la apertura en ρ = min(1, k·s·r/D) (`specularPairSpread`): las facetas de la cara (pendiente rms s, el lóbulo de
  Kirchhoff de `INTERFACES`) desvían lo reflejado con rms 2s, que cruza el obstáculo a τ = 2s·(r − r₀) de −u, y τ frente al
  semiancho del cono da 4s·r/D, sin r₀. Con la cara más lisa de la tabla (`SPECULAR_PAIR_SLOPE` = 0,14, las venas) y
  k = 3 (`SPECULAR_PAIR_FIT`, ajustado a la suma doble con el núcleo gaussiano de los pares: 0,6 dB rms y 5 dB en el peor
  punto, la línea del borde junto a la costilla, sobre cuatro costillas de 5–17 mm a 20–45 mm y hasta 130 mm de
  profundidad, 3–110 mm bajo ellas; k 2 daba 1,0–1,1 dB rms y 4, 0,65; la regla del rayo central, 39 dB rms), ρ vale ≈ 0,45 en la pleura bajo una costilla y 1 desde
  62 mm con los 26 mm del convexo. A la publica en o2.w (la de la mirada del cuadro: la dirigida escribe encima su
  fracción del haz que sobrevive a los huesos y su especular, `o2.zw`; D lee siempre o2.z y pierde `uShadowCh`), y B la usa
  en las dos miradas en lugar del rayo central en las líneas sin cortina (`min(T, tSpec)`); en las de la cortina
  (decisión 61), sobre la pleura y bajo ella, las dos miradas conservan el rayo central de su línea, con su lámina de
  pulmón. Lejos de todo obstáculo es la del rayo, la de antes. El color y el PW siguen con su rayo único (o2.x). Junto al
  borde de una costilla, en las primeras líneas dentro de él, los pares valen 0 (el lado −u cruza el hueso) y queda
  ρ·T_apertura: la penumbra de la especular, que la regla del rayo central apagaba del todo (en el gemelo, 6 mm bajo la
  costilla de `aperture.test.ts`, −22 / −35 dB a 0,26 / 0,79 mm dentro del borde; el banco de ondas de la decisión 88 da
  −14 dB a 1 mm dentro y 1,2 mm bajo ella). Lejos del borde, bajo −40 dB como antes.
- **Espejo de la mirada dirigida** (`STEERED_FIELD_GLSL` de `shaders/passes.glsl.ts`, gemelo `steeredSample` de
  `steering.ts`). Tras el espejo, la muestra sigue el propio camino reflejado, dirK reflejada en la normal de la pleura (que
  sale de la reflexión de la línea del espejo, dR − d0 ∥ n, como ya hacía el eco de la pleura), en lugar de la reflejada de
  la línea del espejo. La transmisión del camino reflejado sigue siendo la de esa línea (A2).

**Consecuencias.**

- **Flanco, congestión grave** (GPU, antes → después; `scratchpad/seam/caps`, recortes y paneles del juez): la
  transmisión con apertura de la mirada 0 a 80 mm en las líneas 80–85, −41,1 / −43,0 / −44,4 / −46,0 / −47,7 / −49,3 dB
  (monótona, 1,4–1,9 dB por línea); la pared anterior de la VCI bajo la costilla, gris 69–80 continuo (antes 19–30 con
  bordes de una línea; sin hueso, 134–150): se atenúa como el moteado, sin hueco. La sombra aislada (cociente con la línea
  base sin hueso) es un cuenco suave en las tres miradas. Por debajo de la VCI queda una rampa de la sombra de ~12 dB en
  ~10 líneas y la textura propia del tejido (la línea base sin hueso tiene sus mismos bordes: un vaso en 80–86 a 56 mm y la
  pared de la aorta a 154 mm).
- **Subcostal, congestión grave:** sin el peine; la banda del borde, lo que solo ve la mirada +7° tras el pulmón (en el
  compuesto, un tercio de ella: la 0 es negra ahí, como en un compuesto real), queda con el moteado de lo reflejado. El
  estiramiento que queda (0,35 mm/mm en el gemelo) es el de la retícula comprimida en la elevación de la sonda y no en la
  del corte reflejado (`mirror-slice-elevation-axis`, también en la mirada 0 con una pleura oblicua).
- **Borde de las costillas** (la oclusión de la decisión 88 con GPU, `main` a386e5e → rama, flanco del sano con y sin dz
  +12, `scratchpad/seam/rib`): bajo las costillas, de la cara posterior a 4 mm más abajo, la mediana sigue en el suelo de
  ruido (−39,8 / −46,2 / −44,2 → −40,5 / −45,3 / −43,7 dB del hígado con dz +12; −42,7 / −46,6 / −45,7 → −42,5 / −45,1 /
  −45,0 sin él; gris 0). La línea del borde no cambia; en las 1–4 de dentro de él, el pico bajo el hueso sube hasta 7 dB
  en unos bordes y queda a ±1,5 dB en otros (en el borde izquierdo de la primera costilla con dz +12, −9,2 / −22,4 / −33,0
  → −4,3 / −15,3 / −28,0 dB a 1,0 / 1,6 / 2,1 mm de la línea del borde; gris 46 / 14 / 0 → 58 / 26 / 7): es la penumbra de
  la especular, ρ·T_apertura, más cerca del banco de ondas de la 88 (−14 dB a 1 mm dentro del borde) que el tope del rayo
  central. Desde 2,5 mm, como antes (≤ −40 dB, gris 0); con 3 líneas de margen en cada borde, el máximo pasa de −22,0 /
  −13,9 / −26,4 a −16,3 / −15,0 / −25,2 dB (gris ≤ 37).
- **Contraste con la evaluación física del panel** (sobre `main` a386e5e: un peine de ~2 mm solo con el compuesto en la
  subcostal del sano, atribuido a que A2 dirigida toma la línea más cercana en cada fila; y la pared de la VCI que
  desaparece en la cola de la sombra de una costilla, atribuida a `Ts = min(T, tRay)`), medido con GPU (`scratchpad/seam/m7`):
  - Peine: es el mismo de la pareja 7. Las líneas 174–184 de la mirada +7° cruzan el espejo del pulmón a s = 31–32 mm
    también en el sano. La transmisión de A en la banda no lleva modulación periódica (espectro del cociente con su media
    de ±4 mm, periodos de 2,25–6 mm: −33,2 dB en `main`, −34,5 en la apertura y −34,7 en la especular en la rama): el
    rayo único de A2 sí salta ±6 dB entre filas a lo largo de un borde de gas (línea 180, 38–65 mm), pero el cono lo
    integra y B solo usa el rayo único en las líneas de la cortina. Las estrías son del mapa de la imagen al tejido tras
    el espejo: la correlación horizontal del gris a 3 mm en la banda pasa de 0,51 / 0,49 (fundamental / armónica, sano)
    y 0,42 / 0,58 (congestión grave) a 0,05 / 0,01 y 0,13 / 0,13, la del hígado de la misma captura (0,04; 0,11–0,13).
  - Pared: por línea, el pico de la pared frente a la mediana del tejido de 3–12 mm por encima, en las 47 líneas de la
    cola de la sombra cuya pared se ve (≥ +6 dB) con el hueso transparente: bajo +6 dB, 43 % (sin compuesto) y 26 % (con
    él) en `main`, 0 % y 4 % en la rama, con la mediana a la de sin hueso (13,1 frente a 12,8 dB).
- **Banco de fidelidad** (M4, las ocho escenas, `main` a386e5e frente a la rama): cambian solo las sombras de costillas y
  de gas. G7, el acortamiento de la umbra por el compuesto, 7,49 → 4,69 mm en el flanco del sano y 7,40 → 5,14 en el de la
  congestión grave (meta 1,5–8 mm): la umbra de la mirada 0 acaba 1–2,4 mm antes (28,8 → 26,4 y 27,8 mm), la del
  compuesto casi igual. La pared anterior de la VCI del flanco sube 0,8 dB en el sano (pico 4,26 → 5,07 dB) y su hueco más
  largo baja de 5,3 a 4,3 mm en la congestión grave. El hígado (gris, SNR, grano, oscuros, grietas) y las demás paredes,
  dentro del ruido de la medida; el diafragma a 40–60° de la subxifoidea del sano, con dos registros (escaso, sin puerta),
  pasa de 0 a 1 hueco.
- **Coste** (M4, Metal, `scratchpad/gb/cost.mts` en puertos propios, `main` y la rama alternados, carga 25): la pasada A
  +0,01–0,04 ms (0,04–0,09 → 0,06–0,12 ms); el cuadro, dentro del ruido (flanco 10,15/10,10 → 10,23/10,12 ms; con el
  compuesto 10,65/10,60 → 10,59/10,60; medido antes de la revisión, que no cambia las vueltas del bucle con el foco por
  omisión). Índice del build 333,7 → 334,7 kB (presupuesto de 335). `npm run calibrate` da la misma salida byte a byte.
- **Limitaciones**: nuevas `specular-pair-single-slope` (una sola pendiente de facetas, los dos límites de la suma doble,
  incidencia normal) y `mirror-slice-elevation-axis` (tras un espejo el moteado sigue comprimido en la elevación de la
  sonda).

**Verificación.** `aperture.test.ts`: cada cono es la integral exacta de su ventana (frente a la regla del punto medio
muy fina, en el borde del arreglo y con conos más estrechos que una línea; la GLSL con las mismas cuentas y sin tomas); la
penumbra es continua: entre líneas vecinas no cambia más que lo que pesa una línea en la ventana del cono más estrecho
(0,60 de esa cota; con las nueve tomas, 2,8) y en profundidad menos de 0,01 por cuarto de milímetro (con las tomas, saltos
de 0,2); los especulares, la del rayo lejos de todo obstáculo, bajo −40 dB tres milímetros bajo la costilla y lejos de su
borde, la de la apertura desde D/(k·s), continuos a través de las líneas de la costilla en profundidad (la regla del rayo
central, 0 hasta el fondo y más de 3 veces la cota) y a 0,6 dB rms de la suma doble (la regla del rayo central, 39); la
pendiente de la cara más lisa, fijada. `steeredSample.test.ts`: tras el espejo la muestra sigue su propio reflejado, y el
mapa de la imagen al tejido con la geometría medida de la subcostal no se degenera (≥ 0,25 mm/mm fuera de la elevación;
falla en `main` con 0,031). `steeredParity.test.ts`: el margen del redondeo sin las tomas del cono y, con el redondeo
desplazado, la apertura y la especular de las muestras no marcadas a menos que su umbral. La e2e de la paridad de la
transmisión compara también la especular de la GPU (o2.w, `readTransmission`) con su gemelo en la mirada 0 (la subxifoidea,
el flanco con sus costillas y la subcostal) y en la dirigida, a menos de 0,01 dB. `transmission.test.ts`, `pleura.test.ts`,
`refraction.test.ts` y `shaderLimits.test.ts` (huellas de A y B), al día. Capturas con GPU antes y después, las de la
bisección y las de la historia (`scratchpad/seam/caps`, `scratchpad/seam/hist`).

Revisión adversarial de contexto limpio (sobre el primer commit de la rama), corregida: (1) B daba a las líneas de la
cortina, sobre la pleura, la de los pares en la mirada 0 y el rayo central en la dirigida; ahora las dos, el rayo central
(pines de `transmission.test.ts`, `pleura.test.ts` y `steeredSample.test.ts`). (2) El texto decía que junto a la costilla
los especulares se apagaban como antes; no en las líneas de dentro del borde (arriba, «Borde de las costillas»). (3)
`aperture.test.ts` prueba ahora esas líneas: la especular es ρ·T_apertura (los pares, 0), por encima de la regla del rayo
central y bajo −40 dB a 2,4 mm del borde. (4) La búsqueda del obstáculo llegaba solo a D_tx/2: con el foco somero, un
borde de hasta 2,5 dB en una línea; la prueba de continuidad con D_tx 8–12 mm falla con la búsqueda de antes (1,2–1,4
veces la cota por línea) y pasa con la de ahora (≤ 0,56). (5) La paridad saltaba las muestras con los dos prefijos bajo −60
dB, justo donde viven la penumbra y los pares, y podía pasar sin comparar nada: cada canal se compara donde él mismo pasa de
−60 dB, la paridad cuenta sus muestras (`apertureSamples`, `specularSamples`, > 500 en la e2e) y `steeredParity.test.ts`
comprueba que una GPU que apagara la apertura o la especular bajo el borde del hueso ya no pasa; y la ventana de Hann se
integra desde su borde (`apG`: 6–12 % → ≤ 0,34 % de error en float32 en la última loncha, `aperture.test.ts`). (6) Un cono
de anchura nula daba 0 y no el rayo de su línea. (7) Prueba del margen de `APERTURE_SEARCH_LINES` (35,4 de 40 líneas con
8°). (8) Comentarios desfasados de `passes.glsl.ts`, `pleura.ts` e `interfaceEcho.test.ts`.

## 92. Contrato de adquisición y medición M con incertidumbre de resolución (30-09-2026)

**Contexto.** En `main` a3a5b1a, E2E4 falló y pasó al reintentar: envolvente 27,900 % frente a verdad 30,420 %;
los cuatro clics redondeados por separado dieron 25 %. `failOnFlakyTests` detectó correctamente el fallo.
Además, cambiar la línea M conservaba columnas de la línea anterior bajo la nueva guía.

**Opciones.** Ampliar tolerancia, ignorar reintentos o modificar la fisiología ocultaría la causa. Se separan
adquisición, conversión CSS → mm y redondeo de presentación, conservando el límite físico de software ±5 puntos.

**Decisión.** El anillo M inicia una franja nueva cuando cambia θ, incluso en pausa. La e2e mantiene clics enteros
accesibles al alumno y comprueba por separado la conversión y presentación (±0,51 puntos por redondeo entero),
el intervalo de cuantización mostrado y el error físico de la banda respecto a la verdad (±5, sin ampliación).
El intervalo propaga ±medio píxel CSS por borde, sin verdad oculta; no incluye selección de pared ni error físico.
Una tentativa subpíxel falló porque el navegador cuantiza los eventos; se descartó en vez de falsear la UI.
Se conserva la resolución de ambos extremos al fijar el tiempo del par; si cambia tamaño/zoom, se usa la peor
resolución. Un diámetro cuyo intervalo incluye cero da 0–100 %, sin NaN. Un drag iniciado antes de congelar
queda bloqueado durante la pausa para conservar la guía de la adquisición congelada.

**Consecuencias.** Una nueva línea necesita adquirir nuevas columnas; lo anterior queda negro en lugar de
atribuirlo al nuevo rayo. No hay lecturas GPU por cuadro ni texturas adicionales. Se retira la promesa documental
de ±2 puntos: estos límites son gates de software, no precisión clínica validada. El blooming y la cadencia
por cuadro siguen pendientes; esta corrección no calibra el modelo físico.

**Verificación.** Regresión pura de cuantización a alturas CSS 180/340/680/1000, cambio de línea con reloj congelado y slots temporales; e2e de la cadena
GPU → banda → clics → calibres mantiene correlación, residual y límite físico. Resultados completos y CI se
registran en el PR, no se presupone que un reintento verde sea éxito.
Extremos numéricos y ancho decreciente al mejorar resolución; e2e con distinta altura por extremo, calibre de
un píxel y congelación durante drag. La captura adjunta muestra el intervalo visible al alumno.

## 93. Preparar el análisis PW al armar la medición (30-09-2026)

**Problema.** El alumno descargaba el análisis espectral antes de necesitarlo. El principal estaba a 11 bytes
del presupuesto de 335 KiB en el build de la decisión 92.

**Decisión.** Preparar un único módulo al armar Suprahepática, Porta o Renal. Mientras llega, el botón dice
«Preparando medición…» y está deshabilitado; un fallo avisa y queda en el registro. Una vez preparado,
Capturar sigue siendo síncrono: lee la adquisición y el equipo en el turno del clic, sin guardar una captura
pendiente que pueda pertenecer a otro paciente. Abrir Medir, usar los calibres o arrancar no pide el módulo.

El grupo Rolldown no incluye dependencias recursivamente: incluirlas hacía que el principal importara el grupo
estáticamente y lo precargara. La mayor parte del estado interno y los métodos de Panel, Medir y Docente usan privacidad nativa
ES2022; el minificador puede compactarlos sin renombrar la API pública. No se cambian shaders ni algoritmos.
Los rótulos de calidad quedan separados del algoritmo y las exportaciones anteriores siguen disponibles.

**Medición.** Frente al build de 9682afd: principal 343.029 → 332.908 bytes (−10.121); total JS de producción,
incluidos Worker y módulos diferidos, 1.015.776 → 1.015.498 (−278). Se conserva la exclusión preexistente de
testHooks y todos los límites. Cifras medidas en2a290ab, antes del ajuste de foco y favicon; el tamaño final se registra en el PR. Es mejora de descarga inicial, no una reducción sustancial del peso total ni
una mejora demostrada de FPS. No se prolonga el bloque con minificación manual de literales.

**Tradeoff y verificación.** La primera medición PW espera una descarga de ~9,5 KiB; Docente también carga
ese grupo porque comparte ventanas de análisis. Al completar se actualiza solo el botón PW en sitio: se conserva el foco de Cancelar y no se reconstruye M/calibrador elegidos entretanto. Un favicon SVG legítimo evita el404 basal en Chrome visible, sin filtrar errores de consola. La e2e sin ganchos demora la descarga y exige cero solicitudes
al arrancar/abrir Medir, una al armar y resultado inmediato en el mismo turno del clic preparado. El humo
existente conserva la captura de señal válida y la de falta de contacto en la cadena real. Checks y CI se
registran en el PR; estos cambios no calibran fisiología ni realismo.

## 94. La medición Doppler del alumno no depende de la escala: porta en su semiplano fijo, envolvente unilateral, aliasing fuerte, identidad del vaso y lo medido a la vista

**Recuperación (30-09-2026).** Procede del PR120 (6eb4113), sobre la decisión93 de carga diferida. Las cifras del banco de168 capturas y seis semillas son evidencia histórica interna de esa rama, no mediciones del SHA recuperado ni validación clínica externa. Se retira el aumento heredado del PR original. Tras corregir presentación y ventana efectiva, se autoriza un aumento acotado de4 KiB solo del totalJS (1.024.000→1.028.096B, ~0,4%) para las correcciones y controles respiratorios. Límites porchunk, conteo y exclusiones permanecen intactos; el bloque cardíaco requiere presupuesto separado. Resultados de la recuperación y corrección de overlay se registran en el nuevo PR.

**Corrección de ventana efectiva.** En la porta, calidad e identidad se juzgan entre el primer y último latido medido; se conservan los latidos interiores sin traza para no seleccionar solo los buenos. Un cambio dePRF no atribuye a la captura el peso de un latido parcial previo. Con respiración tranquila, la referencia sana puede conservar solo dos latidos trazables y se rechaza por pocos latidos, sin entrar al grado.

**Contexto.** Sirve a los objetivos 1 (causalidad: lo que mide el alumno coincide con la verdad) y 5 (enseñar a obtener) de
`docs/MISION.md`, bajo el criterio 2 (seguridad del mensaje clínico). Un agente evaluador en rol clínico, separado del panel de evaluación
(27-09-2026, main a386e5e; `scratchpad/eval/clinico/`) midió en la app la PF portal del sano, con verdad 13–20 %: 100 % a
±20 cm/s, 111–114 % a ±40 (la escala por defecto), 79–95 % a ±60 y 18–24 % a ±80; el grave, 133 % frente a 75 %; la FA, 60
frente a 32; la trampa de la IT, 77 frente a 35; la de la VPP, 80 frente a 17. Todas con el visto bueno de la calidad: una
porta «grave» en un sano. Además, (2) tras «Capturar» no se veía qué se había medido, (3) la fila «Suprahepática» sobre la
porta daba «leve (S<D)», la fila «Porta» sobre la suprahepática «PF 117 %, grave» y la «Renal» sobre la suprahepática
«bifásico», y (4) las pruebas no lo veían: `examChain.test.ts` medía a la PRF máxima con una copia de `updateGate` de
transmisión fija 0,3 (−10 dB), en contra del «pipeline real» de `docs/TESTING.md`. Por la ruta real la porta está a −29 a
−32 dB y su banda queda 6–18 dB sobre el suelo. Volcando el espectro columna a columna (`scratchpad/pf/analyze.mts`):

- la traza tomaba el semiplano dominante columna a columna (`spectralMeasure.ts:247-270` en main). En las columnas con la
  banda débil ganaban el clutter simétrico junto a la línea de base (el tejido que late o respira, los transitorios del
  filtro de pared) o su imagen, y la traza cambiaba de signo: Vmín −1,9 a −3,8 cm/s y PF > 100 %;
- la banda era la «contigua a la línea de base» (`columnBandEnvelopes`): un bin de ruido o de clutter junto a la base abría
  la banda y los 3 bins vacíos que lo separan del flujo portal (casi en pistón, 5–20 cm/s) la cerraban. La envolvente caía a
  2–6 cm/s en columnas sueltas y el cuantil 0,97 del mínimo la recogía;
- una columna sin banda valía 0 cm/s: una caída de señal se leía como una pausa;
- a ±80 (PRF 5200) la interlobar tenía el mismo defecto: el clutter simétrico del riñón llega a ±12 cm/s, sobre el filtro
  de pared, y la vena monofásica del grave «fluía» en sístole («continua» con el visto bueno), y un hueco de una sola columna
  hacía «bifásico» al sano (7 de 49 capturas aceptadas con un patrón falso en el barrido de 7 casos × 3 semillas);
- con la escala muy por debajo de la velocidad (±4–14 cm/s) la sangre se plegaba varias veces, llenaba la banda sin dejar
  banda que detectar y la calidad decía «no hay flujo» o «intermitente» (limitación `severe-aliasing-not-detected`).

**Opciones.** Subir el margen de detección (pierde la porta débil entera); suavizar el espectro más en todos los vasos
(borra la S del sano y las pausas renales de 20 ms); medir la porta sobre la media espectral en lugar de la envolvente (la
VExUS se define sobre la velocidad máxima del trazado); exigir apnea y la escala alta para la porta (el alumno no puede
equivocarse como en un equipo, objetivo 5); para la identidad, adivinar el vaso por la forma de la onda (una porta
pulsátil y una suprahepática se confunden justo cuando importa). Para el aliasing fuerte, un umbral sobre la potencia total
(la puerta fuera del vaso con clutter también la tiene).

**Decisión.**

1. **Porta en su semiplano anterógrado fijo** (`portalTrace`, `measureObservedPortal`): el semiplano del flujo es el de más
   energía unilateral en toda la captura, como la vena en la interlobar; si está vacío en una columna y el contrario tiene
   flujo unilateral, la porta se invierte ahí y la traza es negativa (la PF > 100 % de una porta hepatófuga sigue
   existiendo). Una columna sin flujo trazable es un hueco (NaN), no 0; la mediana temporal de 5 columnas ignora los
   huecos y un promedio móvil de 60 ms quita el temblor del moteado espectral (±3 cm/s sobre una porta de 15 cm/s: por sí
   solo, una PF de ~35 %; a ±20 hay ~10 espectros independientes por segundo). Vmáx y Vmín son los cuantiles 0,97 y 0,03 de
   la traza de cada latido cubierto por el espectro (≥ 90 %, como en la calidad) con traza en ≥ 50 % de sus columnas; la
   PF, la mediana por latido. El sentido del flujo se toma de las columnas de los latidos medidos (la puerta pudo estar antes
   en otro vaso: con la suprahepática 3 s antes, la porta salía «hacia atrás», Vmáx negativa y una PF «no aplicable» con el
   visto bueno), y un latido con Vmáx ≤ 0 no se mide.
2. **Envolvente unilateral** (`halfPlaneEnvelopeHz`, `spectral.ts`): cuentan los bins fuera de la banda del filtro de pared,
   significativos y ≥ 6 dB sobre su espejo (`MIRROR_MARGIN_DB`: el flujo es unilateral; el clutter, los transitorios y la
   imagen, simétricos); la banda crece desde el bin de más potencia hacia los dos lados tolerando un hueco de 60 Hz
   (`BAND_GAP_HZ`, 3 bins a 2600 Hz: a 1300 Hz el bin mide 10 Hz y el moteado parte la banda), y la envolvente es el
   percentil 92 % de la potencia sobre el espejo. Ventana, cuantiles y hueco se eligieron en una rejilla sobre 168 capturas
   volcadas de la cadena del alumno y se validaron con otras tres semillas [EXTRAPOLACIÓN PROPIA]. La interlobar usa la
   misma envolvente en cada semiplano (`observedSideTraces`); `sideEnergyDb` cuenta solo la energía unilateral (el clutter
   simétrico acercaba la vena a su arteria: 4 dB en vez de 20); el mínimo de la vena es el que se sostiene ≥ 20 ms
   (`RENAL_GAP_MIN_S`, la pausa que cuenta la verdad). La suprahepática no cambia: su medición ya era estable con la escala
   (100 de 100 capturas aceptadas con el patrón de la verdad).
3. **La calidad juzga lo trazado** (`QualityOptions.present`): en la porta y la interlobar una columna tiene sangre si tiene
   traza unilateral; con `bloodInColumn`, el clutter simétrico de la respiración «era» sangre. **Aliasing fuerte**
   (`outerBandExcessDb`): si la captura ya no era medible por «no hay flujo» o «intermitente» y la mediana de la potencia
   media en la mitad exterior de la banda (|f| > PRF/4) está ≥ 3 dB sobre el ruido del receptor (`receiverNoiseDb`, que el
   equipo conoce: 2σ²·Σw², −48,1 dB a ganancia 0), el motivo es aliasing, «suba la escala». Medido: sangre plegada en
   apnea (±6–14 cm/s), 3–21 dB; puerta 25 mm más honda, fuera del vaso, −0,2 a +0,3 dB. En la porta, además, es aliasing
   el Vmáx de un latido ≥ 0,85 del Nyquist (el pico se recorta y la PF baja: la FA a ±15–16 salía 25 % con verdad 36 %) y
   la traza «invertida» más allá de medio Nyquist (el pico plegado al otro lado: una porta hepatófuga crece desde la base;
   la cirrosis a ±14 salía 171–202 % con verdad 35 %). **Filtro de pared** (`wall-filter`, «baje el filtro de pared»): si
   Vmín queda en la banda de transición del filtro (hasta 1,5 veces el corte y un bin) o la traza se hunde en un hueco de ≥
   40 ms desde ella, el valle está por debajo del corte y la PF saldría menor: con el filtro a 300 Hz el grave (verdad 76
   %) daba 30–46 % y la FA 21–25 %, aceptadas. Con el filtro por defecto (25 Hz) no se dispara en ninguna captura.
4. **Una sola ruta de captura** (`doppler/capture.ts`, `captureProtocolVessel`): la de «Capturar» y la de las pruebas. Toma
   los 4 últimos latidos completos de los últimos 7 s de espectro con la PRF actual y descarta 0,1 s tras un cambio de escala
   (`captureColumns`, `WALL_SETTLE_S`: el transitorio del filtro de pared con el clutter dentro). La geometría de la puerta es
   `pwGate` (`app/pwGate.ts`), la de `Simulator.updateGate`, que la prueba ya no copia.
5. **Identidad del vaso** (`doppler/vesselIdentity.ts`): el simulador registra en cada actualización de la puerta la sangre
   de cada vaso del volumen de muestra (`Simulator.gateTrack`, los últimos 10 s). Si en los latidos medidos domina otro
   sistema que el de la fila (la
   interlobar admite su arteria), la captura se rechaza antes que por cualquier otro motivo: «no medible: vaso equivocado,
   la puerta está en la porta (esta fila mide una suprahepática: recoloque la puerta)». Sin sangre en la puerta no hay
   veredicto y la calidad dice por qué. Un equipo no sabe qué vaso hay bajo la puerta: es el supervisor junto al alumno.
6. **Lo medido a la vista** (`ui/captureOverlay.ts`, `SpectrogramView.draw`): tras «Capturar», el espectro dibuja la traza
   automática (ámbar; roja si la captura no vale), los latidos analizados (corchetes arriba) y, si la captura vale, las
   marcas donde se leyó cada valor (S/D/A en la suprahepática, Vmáx/Vmín en la porta, S/D/mín en la interlobar;
   `CaptureMark`). Se guarda en Hz físicos con la PRF de sus columnas. Historial y traza usan la misma presentación
   actual: cambiar línea de base, inversión o barrido reconstruye el bitmap desde las columnas, incluso congelado;
   redimensionar o rebobinar el cine también lo reconstruye. Lo que sale de la banda se pliega como el espectro.
   La captura pinta las anotaciones en el mismo evento que publica el resultado, sin esperar la siguiente pasada GPU.
   La cobertura de adquisición ≥90 % del ciclo se aplica a los tres territorios antes de medir o inferir dirección. Los latidos parciales por PRF/settling no contaminan identidad; todos los adquiridos cuentan para calidad, aunque pierdan la señal al principio, interior o final. «Borrar mediciones», el cambio de caso y el PW apagado o reiniciado lo quitan.

**Consecuencias.** La PF del alumno por la ruta de la aplicación, 7 casos × apnea y respiración tranquila × 3 semillas × ±20,
±40, ±60 y ±80 cm/s (`examChainScale.test.ts`, 168 capturas):

|                               | Aceptadas | \|PF − verdad\| ≤ 10, verdad de los latidos medidos | … verdad de 7 s               | «Grave» con verdad < 30 % |
| ----------------------------- | --------- | --------------------------------------------------- | ----------------------------- | ------------------------- |
| main a386e5e                  | 109       | —                                                   | 31 (28,4 %; error medio 44,8) | 26                        |
| con la decisión, semillas 0–2 | 115       | 115 (100 %)                                         | 113 (98,3 %)                  | 0                         |
| semillas 3–5                  | 118       | 117 (99,2 %)                                        | 116 (98,3 %)                  | 0                         |
| semillas 6–8                  | 111       | 111 (100 %)                                         | 105 (94,6 %)                  | 0                         |

La verdad de 7 s es la de la prueba en main (que no da los latidos medidos); la de los latidos medidos compara la medición
con lo que midió. La diferencia está en la FA con respiración: su PF cambia de un latido a otro (12–47 % en una captura) y
4 latidos pueden quedar a > 10 puntos de 7 s (26 frente a 41 %; limitación `af-capture-beat-sampling`). Error medio frente
a la verdad de los latidos medidos: 2,3–2,5 puntos. Mediana de las capturas aceptadas en apnea a ±20/±40/±60/±80
(semillas 0–2, verdad de 7 s; a ±20 el sano y el grave son aliasing): sano —/16/17/14 (13), grave —/70/73/73 (76), FA 33/32/32/32 (35), PIA 24/28/26/26 (26), IT 35/37/35/33 (35), VPP 19/19/17/18
(17), cirrosis 38/35/35/35 (35). Las rechazadas: a ±20, aliasing (25); con respiración a ±40–±80, «intermitente» (28). La interlobar no da ningún patrón falso aceptado (0 de 51 en el barrido; en main, 7 de 49) y la suprahepática sigue igual. Con respiración
tranquila más capturas son no medibles: el sano a ±40 es «intermitente» (algún latido sin traza: pida apnea), la
interlobar pasa a menudo de «intermitente» a «no hay flujo» (la vena ocupa < 20 % de las columnas una vez que el clutter no
cuenta; el texto de «no hay flujo» añade «si respira, pida apnea»), y a ±20 la porta y la interlobar del grave dicen
aliasing. El alumno ve dónde se midió. Queda el aliasing extremo de la porta a ±4–6 cm/s (la banda del filtro de pared, 62,5
Hz, es media banda: «no hay flujo»). La cadena del alumno pasa a la transmisión real y a la captura de la app; las pruebas
lentas crecen ~4 min de CPU en dos archivos que corren en paralelo. El build histórico de la rama original crecía 8,2 kB (333,7 → 341,9 kB sobre a386e5e). En esta recuperación se conserva el presupuesto de335 KiB y se mide el total incluyendo todos los módulos diferidos; no se arrastra el aumento a343 KiB.

**Verificación.** Primero la prueba que falla: `examChainScale.test.ts` (PF de la porta, las 4 escalas, 7 casos, apnea y
respiración, 3 semillas; ≥ 95 % a ≤ 10 puntos, ninguna «grave» con verdad < 30 %, ≥ 80 % medibles en apnea a ±40–±80) falla
en main en los 8 casos; `examChainScalePatterns.test.ts` (suprahepática e interlobar a las 4 escalas, y la interlobar en apnea
a ±60–±80 con sesiones nuevas y 3 semillas) falla en main en 5 casos por patrones renales falsos aceptados. Las dos pasan con
la decisión, como el caso de cerca del Nyquist (±10–16) y del filtro de pared a 300 Hz en la cirrosis, el grave y la FA,
que en main acepta PF falsas. `portalMeasure.test.ts` (sintéticos): la envolvente ignora el clutter simétrico y el bin
suelto; el pico recortado y el plegado son aliasing, el valle en el filtro de pared no se mide y el sentido se toma de los
latidos medidos (las cuatro fallan con esas guardas quitadas); la PF de una banda débil con clutter y caídas de señal sigue a la limpia (falla con la medición de main); el mismo flujo alejándose o
invertido da la misma PF; una porta que se invierte da PF > 100 %; el ruido del receptor de la cadena; la sangre plegada que
llena la banda es aliasing y el ruido solo, «no hay flujo»; la identidad del vaso y su mensaje; las columnas de la captura;
la fila de cada frecuencia en el espectrograma y la traza en Hz físicos. `examChain.test.ts` por la ruta real (`support/
studentChain.ts`). e2e «lo medido a la vista sobre el espectro y el vaso equivocado»: la fila «Suprahepática» sobre el tronco
portal dice «vaso equivocado, la puerta está en la porta», la fila «Porta» mide y su traza se ve en el espectro, también
congelado. `npm run calibrate` idéntico a main. Revisión adversarial de contexto limpio sobre el diff: el pico recortado o
plegado cerca del Nyquist aceptado (cirrosis a ±14: 171–202 %), el filtro de pared alto que convertía el grave en leve, el
sentido del flujo tomado de los 7 s y no de los latidos (PF «no aplicable» aceptada), la identidad juzgada en 7 s y un
registro de la puerta más corto que la captura a 60 fps, el trazado que no seguía a su espectro tras invertir o mover la
línea de base ni se plegaba como él y quedaba tras apagar el PW, latidos a medias en la mediana, y cifras de la
documentación que no cuadraban; todo corregido. También señaló la FA con respiración y otras semillas, 16 frente a 40 %
con el visto bueno: frente a la verdad de sus 4 latidos (27, 12, 21 y 40 %, medidos 17, 12, 15 y 37 %) la medición es
correcta y lo que difiere es el muestreo del ritmo (`af-capture-beat-sampling`); la prueba compara ahora con la verdad de
los latidos medidos y da también la de 7 s. Queda: una porta invertida en toda la captura se lee como anterógrada (como
en main).

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
