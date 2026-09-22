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

S es el pico anterógrado en la ventana sistólica salvo flujo retrógrado ≤ −2 cm/s y ≥ 25 % del máximo,
en cuyo caso S es ese mínimo. «Valor de mayor magnitud» escogía la cola del flujo diastólico previo
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

Riñón como primitiva propia (`primitives.kidneyQuery`): elipsoide orientado (base u/v/w: eje largo
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
laterales de elevación cuando el central está lejos de toda interfaz (`sampleSide`).

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
