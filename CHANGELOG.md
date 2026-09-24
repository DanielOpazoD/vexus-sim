# Historial de cambios

Formato de [Keep a Changelog](https://keepachangelog.com/es/1.1.0/); versiones semánticas. Los
detalles de cada decisión están en `docs/DECISIONS.md` (número entre paréntesis).

## [Sin publicar]

### Añadido

- Banco de interfaces en el banco de fidelidad: la pared anterior por sistema (VCI, suprahepáticas y porta), la cápsula hepática, el diafragma con la línea pleural y Morison, por tramos de incidencia sobre la normal real de cada cara (gradiente de la nueva `faceSdf`, la misma distancia que decide la clasificación), con cociente, huecos, tramo de hueco más largo, rosario, anchura del eco a −6 dB y pico en dB de envolvente (con la compensación nominal de la atenuación del hígado, para que la cara y su referencia a 3–10 mm estén a la misma escala); en el diafragma, además, la posición de la línea, la costura oscura bajo la pleura y el desfase del espejo de la GPU junto a su suelo con la marcha gruesa de hoy (~1 mm); y la saturación junto a la cúpula, el riñón y la vesícula. `npm run fidelity -- --sweep` agrega cuatro poses más por vista (±6° de basculación e inclinación) y lista por escena los tramos vigilados que no llegan a 10 registros: las suprahepáticas y el diafragma a 0–20° quedan casi vacíos en todas. Una e2e compara por primera vez las normales de la GPU con el gradiente de TS: cúpula, vesícula, el riñón fuera de la escotadura hiliar y casi todo el tubo coinciden (|n·∇| ≥ 0,98); la VCI entera (su sección elíptica aparta la normal 6–10°), las uniones de tubos, la escotadura hiliar y la cápsula hepática (normal por tramos) se apartan y se informan en filas propias; una prueba cuenta las ranuras de uniforms de cada shader de fragmentos (≤ 179 de 224).
- Banco de fidelidad del modo B (`npm run fidelity`, `docs/fidelity/`): textura de la envolvente (SNR, grano frente a la PSF por bandas de profundidad, lóbulo secundario, fracción oscura e índice de grietas) y de la imagen mostrada (gris del hígado, perfil en profundidad, contraste pared/hígado), con GPU real en 2 casos × 4 vistas; y el protocolo de la prueba ciega con referencias de Wikimedia Commons (`npm run fidelity:blind`). La primera prueba ciega dio 21/21 imágenes simuladas reconocidas, nota 2/7 (52).
- Invariantes de la guía §21 sobre la señal de la cadena completa (`invariants.test.ts`): mismo estado y semilla → espectro y medición idénticos bit a bit (y otra semilla, otro espectro); invertir la pantalla y corregir el ángulo no cambian el patrón de una captura real (S y D ×2 exactos a 60°); un vaso que sale de la puerta pierde la señal y la recupera; la inversión del color es solo presentación (51).
- Control de calidad de la captura PW (pestaña Medir): «no medible» con el motivo si no hay flujo fuera del filtro de pared, si el vaso entra y sale de la puerta (algún latido con sangre en < 60 % de sus columnas; en la interlobar se juzga el lado de la vena), si hay pocos latidos, si el flujo se pliega (la sangre toca a la vez los dos bordes de la banda: a PRF baja el pico S del sano plegado se leía como S invertida, «grave») o, en la suprahepática, si la onda no se reproduce entre latidos (S anterógrada en unos e invertida en otros, o D invertida en alguno: otro vaso ocupa la puerta a ratos); esa captura no entra en el grado. Con respiración tranquila la puerta fija daba «grave» en el sano con el visto bueno de la calidad (49). Antes el ruido se clasificaba: la VSH del caso grave en la prueba de la cadena del alumno «acertaba» midiendo ruido (la puerta caía en la confluencia con la VCI dilatada).

### Cambiado

- Moteado por tejido (56): cada tejido es otra población de dispersores, así que su moteado ya no continúa a través de las paredes. El seno renal y la grasa tienen grumos (pocos dispersores dominantes, estadística K) con la misma ecogenicidad media, anclados al medio para que no parpadeen al inclinar la sonda. La heterogeneidad del hígado es continua: antes eran cubos de 6,25 mm con saltos de hasta 4 dB en sus caras.
- Sombras de costillas y columna físicas (54): el hueso atenúa lo que dicen las tablas clínicas (20 dB/cm/MHz efectivos; antes 4,7, y tras una costilla el tejido seguía visible dentro de la sombra) y la sombra del modo B promedia la transmisión sobre el cono de la apertura: es completa junto al hueso, se rellena en profundidad y su borde es una rampa, no un escalón de una línea. La pasada A pasa de ~2,5 millones de clasificaciones por cuadro (cada profundidad remarchaba su rayo) a ~60 000 en cuatro etapas, con la misma transmisión de un solo rayo que la CPU (≤ 0,0001 dB); las profundidades de impacto ya no se interpolan entre líneas. El cuadro entero cuesta 4,6–7,3 ms (antes 12,9–16,3).
- Preajuste abdominal: 70 dB de rango (antes 60) y el hígado a media escala con la ganancia a 0 dB, como en un equipo: mediana 99–103 de gris y desviación 15–16 (antes 141–147 y 22–23, el contraste de un moteado crudo que delataba la imagen en la prueba ciega); la luz vascular baja de 14–37 a 7–24. La prioridad del color se recalibra para bloquear el mismo tejido (el color cubre el 91 % de la sangre de la caja y el 0,07 % del hígado) (53).
- La ganancia de color es en dB (−20 a +24; 0 dB por defecto) sobre una referencia calibrada con GPU real: por defecto la suprahepática se ve desde la ventana intercostal sin una celda de ruido y al máximo el ruido electrónico llena el 64 % de la caja, como en un equipo real. Antes el deslizador (×0,2–×4) no llegaba nunca al ruido (50).
- La técnica del operador para colocar la puerta (`bestGateOnVessel`) evita la confluencia con la VCI (≥ 10 mm) en las venas que desembocan en ella, como pide el protocolo VExUS, y admite un peso de ventana acústica (`acousticWindowWeight`: transmisión real hasta el punto) que usan los ganchos de la e2e: la captura de prueba mide ahora una VSH real en apnea en vez del ruido de una sombra.
- Modo alumno ciego (guía §17): el alumno ve los casos como «Paciente A/B/C» en el selector, el HUD y el panel; el corte ecográfico pierde los rótulos de estructuras y el navegador 3D los vasos (el calibre de la VCI delata la congestión). En producción la casilla «Docente» solo aparece con `?docente` en la dirección; en desarrollo siempre.

### Corregido

- La calidad de la captura renal rechazaba como «intermitente» una vena monofásica real: exigía sangre en el 60 % de cada latido sin mirar la fase, y ese flujo solo ocupa la diástole. Ahora el latido vale si la sangre cubre su ventana diastólica y se repite igual en todos los latidos; un latido distinto sigue siendo intermitente. El texto de «intermitente» ya no culpa siempre a la puerta (49).
- La guarda de Rayleigh podía medir parches con un vaso entre sus puntos de control: solo miraba 9 muestras de cada parche y la distancia del hígado a su frontera, que no cuenta los tubos, así que tampoco guardaba los 6 mm a los vasos. Ahora usa la máscara del banco de fidelidad (hígado a ≥ 6 mm de cualquier otro tejido en el plano, vasos incluidos, con lo de fuera del sector como otro tejido) y, en cada muestra del parche, además los 6 mm al borde del hígado en 3D que ya exigía. En el sano ningún parche de las vistas de la e2e llegaba a contener un vaso (clasificación en CPU); quedan 215–283 parches de 16 × 8 (antes 319–376), todos lejos de los vasos y del borde del sector.
- El moteado del modo B cambiaba entero al girar la sonda medio grado: la compresión elevacional del campo de dispersores usaba la normal actual del plano y el origen del mundo como pivote, así que girar la sonda cambiaba el medio. Ahora el medio está anclado y no sigue a la sonda. El grano se conserva al abanicar (0,95 con 0,5°) y se renueva cuando el plano atraviesa otro tejido (0,11 con 4°), como en un equipo. Pasados 6° de giro el ancla se renueva con un fundido de 8 cuadros, antes de que la célula elevacional se adelgace (55).
- La arteria y la vena renales compartían el nodo hiliar: el 14–21 % del eje arterial se clasificaba como vena y una puerta PW sobre la arteria del hilio daba el espectro venoso. Ahora la vena va delante de la arteria con los ejes a 9 mm, sin tocarse en todo su recorrido (37).
- En la congestión grave una rama procedural de la suprahepática izquierda cruzaba la fisura umbilical: tenía los dos extremos dentro del hígado y el punto medio 4 mm fuera, y una luz con flujo sustituía al ligamento redondo. Ahora cada rama se comprueba en todo su recorrido con el calibre más dilatado y su pared, lejos de la cápsula y de las fisuras; el grave pasa de 48 a 47 ramas y los otros casos no cambian (34).
- El patrón renal «continuo» exigía un mínimo ≥ 30 % del máximo, y el VExUS lo define por la ausencia de interrupción: un flujo pulsátil que nunca llega a la línea de base salía bifásico, o monofásico si S era pequeña, y entonces subía el grado (S 5, D 20, mín 4 cm/s daba grado 2 con hígado y porta normales). Ahora hay interrupción si el mínimo no supera max(suelo, 10 % del máximo). En la captura, el suelo es el borde de la banda del filtro de pared en Hz: el patrón ya no cambia con la corrección angular. El mínimo es el exacto de la traza (el cuantil robusto escondía pausas reales de 30 ms), pero una columna con sangre en el lado de la vena no puede fijarlo: a 2600 Hz la envolvente se hunde en el pico de la vena y el sano salía bifásico en 12 de 72 capturas (también con la regla vieja). La verdad cuenta solo las pausas de ≥ 20 ms, las que el espectro puede mostrar. Los tres casos no cambian (26).
- Documentación alineada con el código tras la revisión externa: el color no comparte la IQ ni el filtro de pared del PW (solo el campo de velocidades y el signo); la PEEP no tiene efecto hemodinámico; el IR arterial medido es 0,53 (renal) y 0,63 (hepático), igual en los tres casos; el atajo de los planos laterales de elevación no ve los vasos. Limitaciones nuevas: sin bazo ni costillas izquierdas, PEEP, IR fijo y planos laterales; una prueba bloquea que se añada una costilla izquierda sin llevar `rightOnly` al shader.
- Con la respiración, el volumen de muestra llenaba todo el espectro de energía falsa: el peso del haz de cada dispersor cambiaba a escalones cada 8 ticks (el clutter del tejido que se mueve, 40 dB sobre la sangre, se replicaba a múltiplos de PRF/8) y los dispersores de tejido aparecían, desaparecían y cambiaban de identidad (×100 de amplitud) de golpe, con un chasquido de banda ancha cada vez. Además la transmisión hasta la puerta, recalculada cada ~32 ms con la anatomía que respira, cambiaba a saltos (sombras costales) y cada salto era una línea vertical en el espectrograma. Ahora el peso cambia en rampa, el tejido entra y sale en rampa, el cambio de identidad se hace en dos rampas y la transmisión se aplica suavizada: en respiración profunda el suelo del espectro baja de 20–40 dB sobre el ruido a su nivel real y el clutter queda junto a la línea de base (51).
- El color veía menos atenuación que el PW en el mismo punto: convertía la transmisión del modo B a la frecuencia Doppler con un exponente fijo (0,714, como si el modo B fuera a 3,5 MHz) cuando el perfil de la sonda tiene ambas a 2,5 MHz. Ahora usa el cociente del perfil: color y PW coinciden a ±0,8 dB en cuatro ventanas (50).
- La envolvente del espectro se hundía justo en el pico S de una vena grande: el suelo de ruido de cada columna era su mediana y, cuando la sangre llena más de media banda (perfil de 0 a vmax a PRF 2600), la mediana es sangre y el umbral suelo + 12 dB la borraba. La S del sano salía 0–18 cm/s en un latido de cada tres y el patrón oscilaba entre normal y leve. Ahora el suelo de cada columna sale de su percentil 25 más la forma del ruido de la captura (`captureNoiseFloorsDb`), sin depender de la ganancia: S/D 1,74 frente a 1,72 de la verdad a PRF 5000 (49).
- El volumen de muestra PW perdía la sangre tras la primera inspiración y no la recuperaba aunque el vaso siguiera en la puerta (tronco portal con respiración tranquila: 0 % de sangre frente al 95 % real; PF medida 167 % en el sano y 136 % en el grave). La comprobación de salida de la caja y la resiembra usaban dos desplazamientos respiratorios distintos. Ahora PF 20 % y 73 % (verdad 19 % y 63 %).
- El volumen de muestra PW se vaciaba con la puerta quieta, incluso en apnea: al salir de la caja, la sangre reentraba por su recta de corriente pero con la dirección reclasificada en el punto de entrada; en un vaso curvo la recta de vuelta no era la de ida, la población derivaba hacia una esquina de la caja y quedaba atrapada en cuerdas cortas. Sobre la suprahepática del sano los dispersores del centro de la puerta pasaban de 30 a 0 en 10 s y la señal se perdía (la VSH acababa «sin señal» a los ~20 s), con 19 000–30 000 clasificaciones anatómicas por segundo. Ahora la sangre reentra con su identidad y su dirección (órbita cerrada): la medición es estable 26 s y el coste baja a ~4 400 clasificaciones por segundo (48).
- La medición renal elegía el lado de la vena al azar cuando la arteria vecina asomaba débil en la puerta: la regla «el lado de mayor S/D es la arteria» comparaba la vena con una traza arterial plana e intermitente. Ahora la vena es el lado que domina la potencia (≥ 6 dB); si los dos son comparables, decide el predominio sistólico (48).
- El color y el PW mostraban flujo con la sonda separada de la piel (modo B en negro; antipatrón §23 de la guía): la transmisión de la puerta (`app/gateTransmission.ts`) y la pasada de color multiplican ahora por el acoplamiento de su línea, como el modo B. Con la sonda levantada 10 mm: 0 celdas de color y el espectro en el nivel del ruido.
- El espectrograma no avanzaba en el mismo eje temporal que el ECG: cada columna ocupaba `round(dtCol·px/s)` píxeles y, cuando una columna medía menos de un píxel (dpr 1, barrido lento o PRF alta), el espectro corría hasta 5,5× más rápido (2× a 25 mm/s y PRF 2600). Ahora el mapa de bits se desplaza con el tiempo real y cada columna se pinta en su intervalo (`ui/sweep.ts`, compartido con el ECG).

## [0.5.0] — 2026-09-22 — bases estructurales (plan de fases 0–3 tras la evaluación 3,8/7; decisiones 41–47)

### Añadido

- Producto (Fase 3): versión y commit visibles en la barra y en el diagnóstico exportable (versión, navegador, GPU, caso, equipo, fps, tiempo de GPU y últimos errores, sin datos del usuario); release por tag (`.github/workflows/release.yml`) con las notas de esta sección; e2e en paralelo y con la duración de cada prueba en el log de CI.
- Guarda de fidelidad de imagen: la e2e mide la SNR de la envolvente en parénquima hepático (parches 16 × 8 lejos de interfaces) y exige la de Rayleigh (1,6–2,25); detectar intensidad o sumar magnitudes antes del haz la hacen fallar (1,11 y 6,18).
- Grafo de pasadas del renderer (`ultrasound/passGraph.ts`), validado como grafo (orden, escritor único, sin pasadas muertas); tiempo de GPU del cuadro, y por pasada donde el navegador lo separa (en WebKit/Metal cada consulta devuelve el cuadro entero y no se publica por pasada), en la pestaña Docente y en el diagnóstico (47).
- Documentación para incorporar a un equipo: `CLAUDE.md` (invariantes que se rompen fácil), `docs/GLOSSARY.md`, `docs/TESTING.md`, plantilla de decisión en `CONTRIBUTING.md`; afirmaciones obsoletas corregidas y el «Estado» del README atado a la versión. ESLint con reglas tipadas, Dependabot semanal (versiones mayores por separado) y hook de pre-push.
- Cortina pulmonar con líneas A (signo de la cortina) que baja con la inspiración; cápsula y pelvis renales; pirámides discretas con columnas de Bertin (43).
- Segmentos de Couinaud derivados de los planos de las suprahepáticas, la fisura umbilical y el plano portal; hígado 3D translúcido coloreado por segmento con rótulos I–VIII; lámina del ligamento venoso (`LigamentumVenosum`) en el modelo acústico y en el corte (42).

### Cambiado

- Anatomía de una sola fuente (Fase 2): esquema único de uniforms (`anatomy/gpu/sceneUniforms.ts`), del que salen las declaraciones GLSL y la subida desde el renderer (45); la anatomía es dueña de su gemelo GPU (`anatomy/gpu/`) y los órganos viven en módulos con gemelos TS/GLSL del mismo nombre y constantes generadas (`anatomy/organs/`: ligamentos hepáticos, cortina pulmonar, riñón, vesícula e hígado; las funciones solo-GPU se declaran con su motivo); equivalencia volumétrica exacta en 50 000 puntos por caso en la e2e (46).
- Modelo de dominio (Fase 1): `VESSEL_META` sustituye a los `startsWith('ivc')`; registro de casos de una sola fuente; la cadena PW recibe un `AudioSink`; matriz completa de dependencias entre capas; estado del ecógrafo inmutable (`EquipmentController`) que solo cambia por comandos con invariantes físicas (puerta, caja y foco dentro de la imagen, PRF ≤ c/2d); `SimulationSession` y `main.ts` como raíz de composición (450 → 319 líneas) con controladores de UI puros; `TransducerProfile` reúne geometría, haz y frecuencias efectivas.
- Rendimiento: carga inicial 760 → 179 kB de JS (navegador 3D y ganchos de prueba con `import()` dinámico). El cambio de caso ya no recompila nada: el `UltrasoundRenderer` pasa al simulador nuevo con `setScene` y el navegador 3D libera los grupos anteriores tras el primer render con los nuevos (three.js recompilaba 5 de 10 programas). Con SwiftShader, parte síncrona 1 750 → 178 ms y cambio completo ≈ 1,7 → 0,3 s.
- Interfaz hígado–riñón sin hueco (cápsula hepática → grasa de Gerota → cápsula renal); pared periportal proporcional al calibre; pared blanda que conserva el acoplamiento al bascular en el epigastrio; punto de partida renal en eje largo (43).
- Vesícula en pera con base propia, afilamiento fondo→cuello, pared ecogénica de 1,5 mm y fosa; la porción umbilical de la porta izquierda termina bajo la fisura umbilical (receso de Rex) (41). Se retira la limitación `axis-aligned-gallbladder`.
- Pestaña «Adquirir» con los mandos básicos de imagen (profundidad, ganancia, foco); profundidad por defecto 18 cm. Costillas con oblicuidad creciente hacia abajo (`ribTiltMm`), misma ley en el SDF y en el 3D.
- Dependencias: Vitest 5, ESLint 10 (con `@eslint/js` 10 y `globals` 17) y Vite 8 (Rolldown: `codeSplitting.groups` en lugar de `manualChunks`), cada una en su PR. TypeScript 7 queda fuera: `typescript-eslint` exige TypeScript < 6.1.

### Corregido

- El intestino (el «resto» de la clasificación) devolvía una distancia a la frontera fija de 5 mm en TS y GLSL: el gate volumétrico daba por interior un punto pegado al diafragma que float32 clasificaba al otro lado (flaky en CI). Ahora es la distancia a las interfaces que ganan antes.
- La e2e «cambia de caso y el HUD lo refleja» fallaba en CI porque el primer cuadro tras el cambio superaba 15 s (recompilación de shaders propios y de three.js); además, si el HUD no cambia, la prueba informa caso, selector, avisos y errores.
- Pruebas por propiedades (fast-check) sobre todo el dominio de pacientes coherentes: hallaron una VCI colapsada que daba 288 m/s → resistor de Starling (R ∝ 1/A² bajo 8 mm, integración implícita) y lumen residual de 3 mm; dos contraejemplos extremos quedan como `it.fails` de las limitaciones `prescribed-ra-contour` y `no-thoracic-waterfall`. Límites del shader derivados de las constantes con prueba de margen. Cobertura de todos los niveles con umbrales en CI. La e2e de medición exige un valor numérico.
- La medición del alumno (pestaña Medir) confundía picos de ruido con ondas: el caso sano salía «leve» y la FA «grave». Envolvente por percentil de la banda contigua con espectro promediado, extremos robustos, vena interlobar leída en su lado y «S invertida» solo si el retrógrado alcanza el 50 % del pico; prueba de la cadena completa del alumno para los 3 casos y los 3 territorios (44).
- Fallos silenciosos: registro de errores único (`errorLog`, visible en Docente) con manejadores globales; el Worker del corte informa sus errores y se reinicia; el audio se activa de forma transaccional; el cambio de caso es transaccional; el bucle se recupera tras errores repetidos; guardia `NonFiniteStateError` en el motor fisiológico; e2e de pérdida y recuperación del contexto WebGL.
- La equivalencia TS ↔ GLSL solo se comprobaba a mano en la pestaña Docente: ahora la e2e (WebGL real con SwiftShader) compara tejido, vaso y velocidad de la sangre en los 4 puntos de partida de los 3 casos y en 50 000 puntos de todo el tronco.
- El Doppler color usaba caudal constante mientras la CPU (PW, medición) usa velocidad media uniforme por vaso (decisión 6): ahora la GPU usa la misma ley.
- La transmisión hasta la puerta PW cobraba 6 dB en cada paso dentro del hueso; la GPU solo al entrar. Regla única `rayAttenuationDb` con test.
- Fuga de memoria de vídeo: cada redimensionado creaba tres destinos de pantalla sin liberar los anteriores.
- CI no ejecutaba `format:check`; añadidos permisos mínimos y auditoría de dependencias de producción.

## [0.4.0] — 2026-09-22 — fidelidad anatómica y ecográfica (evaluación experta, decisiones 33–40)

### Añadido

- Fisura umbilical con ligamento redondo ecogénico (tejido `LigamentumTeres`) entre los segmentos III y IV, en el SDF compartido TS/GLSL y en el 3D (40).
- Árbol vascular hepático procedural de 3.º–4.º orden (~60 ramas confinadas al hígado) y lista de tubos por cuadro (34).

### Cambiado

- Doppler color por celdas (línea × paquete), coherencia y varianza de Kasai por ensanchamiento espectral (moteado real dentro del vaso) y cadencia física PRF/(líneas·ensemble) + cuadro B rotulada en pantalla (39).
- PSF lateral con número F (`beamModel`: FWHM ≈ 1,4 mm hasta el foco, ≈ 3,5 mm a 16 cm), puerta PW con la misma anchura y ensanchamiento espectral intrínseco por dispersión angular de la apertura (38).
- Riñón en judía con escotadura hiliar, 16 pirámides, corteza hipoecoica e interlobares en abanico (37).
- Proporciones craneocaudales referidas al xifoides (cúpula +55, confluencia +50, hilio −45, reborde −56), tronco AP 21 cm y diafragma en dos hemicúpulas sobre la inserción costal (36).
- Columna con arco posterior y apófisis transversas; costillas sin arco retrovertebral; grandes vasos delante del cuerpo vertebral; rótulo «columna» (35).
- La congestión se ve: calibres basales de suprahepáticas reales, plétora ×1,6, hepatomegalia por `sizeFactor`, avatar 3D con el calibre del caso (33).

## [0.3.0] — 2026-09-22 — saneamiento, equivalencia TS ↔ GLSL, FA y e2e

### Corregido

- Ocultar el «Torso 3D» sacaba el carril de la rejilla (`display:none`) y corría la imagen y la consola de columna: el carril queda en su columna de 0 px (`visibility:hidden`); columnas explícitas y test estático de la disposición.
- El riñón 3D era un elipsoide liso: ahora es la misma judía con escotadura hiliar que corta el haz (marching cubes sobre `kidneyOuterSdf`, `meshFromSdf` compartido con el hígado) con test de malla.
- Los puntos de partida «Subxifoideo» y «Flanco · VCI» no cortaban la VCI (abanicaban en vez de bascular; plano coronal por delante de la vena); ahora cada ventana tiene un test que comprueba lo que promete su texto.
- Una ventana de medida NaN (sin onda A) devolvía el mínimo global como «A» y descartaba el latido (31).
- La medición renal sobrevivía al cambio de caso o a «Borrar» (27).
- El navegador 3D no reconstruía la anatomía al cambiar de caso; el renderizador no liberaba recursos GPU (27).
- `tubeQuery` con sección elíptica prolongaba la cava más allá de su último nodo, en TS y GLSL (27).
- `Beat.rr` era el intervalo anterior, no el siguiente; las ventanas de medida terminaban ~26 ms fuera (27).

### Cambiado

- Geometría del sector en un módulo puro con pruebas; árbol vascular en `anatomy/vesselTree.ts`; `classify` por pasos; `CaseId` tipado (29).
- Consola por pestañas en `src/ui/panel/*` y geometría del navegador 3D en `src/ui/navigator3d/*` (28).
- Prettier, reglas de lint adicionales, CI, plantillas; helpers compartidos (`core/series.ts`,
  Nyquist en `core/units.ts`, constantes TS ↔ GLSL, puntos de partida, límites del equipo) (27).
- `main.ts` cede animación de sonda y atajos a módulos propios; ganchos de depuración solo en desarrollo (27).

### Añadido

- Pruebas de extremo a extremo con Playwright en CI (arranque, render, caso, modos, medición) (32).
- Ritmo de fibrilación auricular (RR irregular, sin P ni A, ondas f) y caso «FA · congestión moderada» (31).
- Comprobación en vivo de la equivalencia TS ↔ GLSL en modo docente: 100 % de acuerdo celda a celda (30).
- 20 pruebas nuevas de nivel rápido con valores cerrados y `npm run test:coverage` (27).

## [0.2.0] — 2026-09-22 — iteración 2

### Añadido

- Riñones implícitos con seno, pirámides, grasa perirrenal, vasos renales e interlobares
  derechos; tejidos renales y pared biliar (24).
- Vía biliar: colédoco, hepáticos, cístico (23).
- Suprahepáticas con tributarias y tronco común; porta con porción umbilical y ramas II–III y
  IV (23).
- Compartimento renal en la red venosa; patrón venoso intrarrenal emergente; medición renal
  observada; VExUS C completo (26).
- Corte ecográfico calculado en un Worker con la anatomía TypeScript (25).
- Textura de datos de escena con esferas envolventes para los tubos (24).
- Rótulos de orientación (cabeza/pies/D/I) en el navegador 3D (22).
- Infraestructura: CI en GitHub Actions, plantillas de PR e issue, guía de contribución.

### Cambiado

- Hígado en cuña con borde inferior agudo, fosa vesicular e impresión renal (23).
- Compensación nominal + TGC con techo de 50 dB, frecuencia efectiva 2,5 MHz, ruido −72 dB,
  ecos de gas escalados por la transmisión (21).
- Navegador 3D en espejo para corregir el marco anatómico levógiro (22).
- Ley de tubo de la VCI desplazada (P₀ 0 mmHg) al añadir el caudal renal (26).

### Eliminado

- Gas intestinal del avatar de referencia (queda como confusor opcional) (23).

## [0.1.0] — 2026-09-21 — iteración 1

### Añadido

- Cadena causal completa: reloj único, fisiología emergente (contorno de AD + red venosa 0D con
  ley de tubo), anatomía implícita compartida TS/GLSL, sonda 6DOF, modo B en WebGL2, color
  emulado, PW con volumen de muestra físico, audio direccional, medición observada y
  clasificación VExUS C (1–11, 19).
- Navegador 3D con three.js, disposición de tres columnas y consola por pestañas (14–17).
- Tests por niveles, test de capas, test de documentación, presupuesto de bundle (20).
