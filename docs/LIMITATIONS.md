# Limitaciones

Este documento existe para que nadie use el simulador más allá de lo que hace. Cada punto está
verificado en el código a 21-09-2026 y lleva el identificador que lo declara en
`src/validation/limitations.ts` (la suite exige que ambos coincidan).

El abdomen de referencia de la decisión 178 incorpora órganos y soporte posterior del atlas. Las medidas históricas del modelo procedural describen la cohorte `abdomen=legacy`; no validan el nuevo contorno. Sus limitaciones específicas se detallan al final y en [ABDOMINAL_ATLAS.md](anatomy/ABDOMINAL_ATLAS.md).

## Anatomía y fisiología

- **Solo el riñón derecho tiene vasos interlobares** (`no-left-interlobar-vessels`): el izquierdo
  tiene arteria y vena renal pero no vasos intrarrenales; las 14 pirámides, el seno (con un dedo hacia cada papila) y
  la pelvis son procedurales (decisiones 37, 43, 68 y 87), sin cálices diferenciados. La vena renal es un solo tubo que
  nace en el borde medial del seno y resume las segmentarias que la forman en el hilio; dentro del seno solo hay las
  interlobares derechas y el extremo de la arteria renal. Sin pirámides en la cara medial (el seno está desplazado hacia
  el hilio y allí el parénquima no deja sitio): la médula es el 6 % del volumen del parénquima, el 16 % del corte coronal.
- **Vasos arcuatos sin luz ni eco especular** (`arcuate-no-lumen`, decisión 87): los arcuatos son un anillo de pared
  arterial en el borde de la base de cada pirámide (1,2 × 2,5 mm de sección), un dispersor difuso: sin luz, sin Doppler,
  sin la reflexión de sus paredes de frente (que en un equipo los hace focos brillantes) y sin unirse a las interlobares.
  En la imagen quedan a +3–6 dB sobre la corteza, más tenues que en una ecografía real.
- **La forma de onda de la aurícula derecha es un contorno prescrito** (`prescribed-ra-contour`): ondas a/c/x/v/y +
  onda sistólica por insuficiencia tricuspídea, gaussianas centradas por latido sobre la media. La media sale del lazo
  cerrado (decisión 79) y la rigidez auricular y la IT siguen al llenado, pero las ondas no salen de una cámara con
  volumen y válvulas; las amplitudes (3,4 / 5,2·VD / 1,8 / 2,4 / 9·IT² mmHg) son de calibración, no medidas. Hallado por
  fast-check: con la aurícula muy rígida (compliancia 0,3) y PAD media ≈ 0 el contorno oscila hasta −11 mmHg y la VCI
  suprahepática supera 2 m/s (`properties.test.ts`, `it.fails`; el primer contraejemplo, de hipovolemia, ya no la supera
  con la pared viscoelástica de la decisión 73).
- **El lazo cerrado es solo de la media** (`mean-closed-loop`, decisión 79): la PAD media es el cruce de dos curvas en
  cada paso (casi estático), linealizadas en el punto del caso; no hay cámaras ni válvulas y las ondas no realimentan la
  media. La curva de Starling se aplana pero no desciende (sin interdependencia ventricular). La IT funcional dependiente
  de la carga (IT₀·(Ptm/Ptm₀)³) no está calibrada y responde con fuerza en los dos sentidos: con +250 mL la FA moderada
  queda en el umbral de la S invertida (grado 3 en 7 de 9 ventanas, 2 en las otras); el sano con +1500 mL pasa de 0,05 a
  0,44 (S < D) y la congestión grave con −1000 mL de 0,70 a 0,17 (grado 1, o 0 en apnea inspiratoria). Sobre latidos
  enteros el retorno venoso de la red sigue al gasto del lazo a ≤ 2 puntos, también en los transitorios; en ventanas fijas
  que no son un número entero de latidos oscila de una a otra (±8–17 % en la congestión grave, ya en main), por el
  aliasing de las ondas grandes.
- **Sin reflejos autónomos** (`no-autonomic-reflexes`): ni barorreflejo ni venoconstricción. La presión arterial de la
  red sigue al gasto con la resistencia constante (108 mmHg tras 500 mL en el sano, 67 con PEEP 15), la frecuencia no
  cambia y la PEEP no sube la presión abdominal ni la Pmsf, así que el gasto cae más que en la clínica (−19 % con PEEP
  10 en el sano) y la PAD sube menos; hipovolemia más PEEP alta lo hunde (el sano con −500 mL y PEEP 15: 2 L/min y PAM
  43 mmHg) y ese flujo bajo da Doppler de aspecto congestivo que un paciente con reflejos no tendría (con respiración
  tranquila, vena interlobar bifásica y PF 34 % con la VCI de 13 mm, grado 0). El bolo es volumen estresado íntegro, sin
  paso al intersticio.
- **Velocidad uniforme a lo largo de cada tubo** (`uniform-vessel-velocity`): el caudal local escala
  con el área; no hay conservación explícita en bifurcaciones.
- **En la cohorte legacy el hígado es una forma procedural** (`procedural-liver-shape`): elipsoides recortados por pared,
  cúpula y una cara visceral en cuña ajustada a mano (decisión 72), con fosa vesicular, impresión renal, fisura
  umbilical y lámina del ligamento venoso; sin caudado propio ni grasa hiliar (la hepática y el colédoco del hilio van
  por el parénquima); los segmentos de Couinaud son una partición por planos de los vasos (metadatos
  del 3D, no una malla segmentada); los ángulos de las venas y conductos son plausibles, no medidos.
- **La forma de los vasos es procedural** (`procedural-vessel-shape`, decisión 90): las venas del hígado tienen una sección
  elíptica (que crece hasta un 4 % donde el vaso se aparta de su cuerda) y un radio que ondula ±5–6 % a lo largo del eje, de
  un hash anclado a cada tubo, no de una TC; las uniones son las de dos cadenas de cápsulas, sin fillets, y donde nace una
  rama la forma de la hija y la de la madre no coinciden (un escalón de ≤ 0,2 mm); la VCI lleva su recorrido y su calibre en
  6 segmentos (quiebros del eje de ≤ 5,3° en el tramo que se ve y ≤ 6,9° en su «S»), y su cintura queda por debajo de la VCI
  que se mide, así que en el flanco sigue cruzando el recorte de borde a borde; las arterias, las venas renales, las
  interlobares, los conductos y los dos vasos de las puertas PW de la cadena del alumno (la suprahepática derecha y el
  tronco portal) siguen siendo tubos circulares de radio lineal; y el modelo no tiene variantes como la vena hepática
  inferior derecha accesoria.
- **Lámina en el borde de la impresión renal** (`morison-rim-sliver`): el redondeo del borde de la impresión renal (8 mm)
  con la cara visceral en cuña (decisión 72) deja en algún punto, detrás del polo superior y junto a la pared posterior,
  una lámina de grasa retroperitoneal (antes de la decisión 81, «intestino») o de hígado de ~1 mm contra la grasa
  perirrenal gruesa, con dos líneas paralelas (2 de ~150
  pasos en los rayos desde el riñón; ninguno en las vistas renal y del flanco).
- **La viscosidad de la pared de la VCI no está en la red** (`ivc-wall-lag-not-in-network`): la luz que se ve y se
  mide sigue al volumen de la red con τ = 0,2 s (decisión 73), pero la red calcula presiones y caudales con su volumen
  elástico; los dos diámetros se separan hasta un 14 % en los colapsos rápidos del sano (5 % en la congestión grave),
  con la misma media.
- **Segmento intestinal representativo y estático en legacy** (`bowel-segment-static`): eje estimado, no atlas ni reconstrucción
  de todo el tubo digestivo; sin duodeno o colon individualizados o mesenterio vascularizado; pliegues estimados, sin
  peristalsis o desplazamiento de gas/líquido. Contracción radial local estimada, sin aplanamiento anisótropo ni conservación de volumen. Pared y reflectividad por capas estimadas, pendientes de comparación
  clínica. El gas intraluminal participa en transmisión y reverberación; no se interpreta el muestreo como validación
  clínica. La malla 3D suaviza el eje y no representa su mucosa. El cuerpo de referencia se extrapola fuera de −160..120 mm.
- **Retroperitoneo simplificado** (`simplified-retroperitoneum`): el psoas (cuatro conos redondeados) y el cuadrado
  lumbar (una lámina contra la pared) son sólidos lisos y simétricos (decisión 81), sin los pilares del diafragma, el
  ilíaco ni las suprarrenales, y sus fascias no tienen cara (el borde lo da el contraste músculo/grasa). La pared
  posterior del modelo mide 28 mm y el riñón apoya en ella: el cuadrado le deja sitio en lugar de pasar entre ambos. El
  peritoneo parietal posterior es una superficie suave, sin recesos, y el duodeno y el colon ascendente no tienen todavía geometría individual. Los músculos se mueven con la respiración con el peso del campo de desplazamiento (en el psoas,
  de ~0,1 junto a la columna a 1 en su parte lateral e inferior; en el cuadrado, ≤ 0,6), en lugar de quedarse quietos
  bajo el riñón que se desliza. En la hepatomegalia de la congestión grave el hígado ocupa el origen del psoas en
  T12–L1 (hasta 12 mm) y el borde superior del cuadrado (hasta 7 mm): se clasifica antes. La textura de sus fascículos no
  tiene prueba de paridad numérica entre la GPU y su gemelo TS (sí la clasificación).
- **Sin cascada torácica de la VCI** (`no-thoracic-waterfall`): la unión cavoauricular transmite
  cualquier caída de la PAD; no existe la meseta de Guyton por colapso de la VCI en la entrada
  torácica. Hallado por fast-check: con hipovolemia (volumen 0,6) y PAD media ≈ 0 la VCI se vacía
  hacia la aurícula a > 100 mL/s. La decisión 172 corrige el denominador regional del contraejemplo de velocidad y conserva su cota de 2 m/s como regresión normal, pero no introduce esa meseta de caudal.
  Sí existe el resistor de Starling por debajo de 8 mm y un lumen residual de 3 mm. El diurético del sano (decisión 79)
  llega a ella: con −500 mL (PAD 2,3) la VCI baja a 6 mm en la inspiración y pasa por ella a 2,8 m/s; por eso los
  líquidos no bajan el llenado de 2 mmHg.
- **Área regional de cava superior estimada** (`ivc-regional-area-estimated`, 172): la cava abdominal conserva un único compartimento de volumen; la unión/entrada auricular usa una sección propia, dependiente de presión de unión menos pleural y retrasada 0,2 s. Q/A, CPU, GPU y 3D comparten esa elipse. La ley regional y la transición gruesa por el hiato requieren calibración/registro independientes; no existe un volumen torácico adicional ni waterfall completo.
- **Sin movimiento cardíaco transmitido a hígado/cava** (`no-cardiac-tissue-motion`); la
  respiración es el único movimiento tisular, y el corazón (decisión 85) no late.
- **Sin bazo en legacy** (`no-spleen`): el atlas añade un bazo estimado; no es una segmentación fuente.
- **Esqueleto torácico procedural estimado** (`thoracic-skeleton-estimated`, decisión 166; alternativa sin atlas): existen doce pares funcionales y esternón compartidos en CPU, GPU y 3D. Las costillas 11/12 terminan libremente; sus recorridos se ajustan al diseño LUS (errores máximos de ajuste 2,66 y 0,80 mm, no errores clínicos). Los arcos 5–10 y sus inserciones aproximadas se preservan. Falta registrar el conjunto con un mismo adulto, estrechamiento superior, asimetrías, articulaciones, clavículas/escápulas acústicas y región diafragmática completa. Las superficies costales no tienen tapas ni articulaciones detalladas. Manubrio/cuerpo son hueso y xifoides cartílago estimado; no representa variabilidad de osificación. Ninguna validación clínica independiente está cerrada.
- **El corazón es un esquema estático** (`schematic-static-heart`, decisión 85): cuatro elipsoides con su miocardio, los
  tabiques y los orificios auriculoventriculares abiertos, sin valvas, sin grandes vasos de la base (vena cava superior,
  raíz aórtica, tronco pulmonar), sin seno coronario ni venas pulmonares; el pericardio es la capa de 1,5 mm del tejido del
  mediastino que dibuja su cara (no un tejido propio: el 33.º tejido costaría dos ranuras de uniforms de la pasada B), y el
  esófago y la ácigos son parte de ese tejido. No late (`no-cardiac-tissue-motion`) y es el mismo en todos los casos: la AD
  no se dilata con la congestión ni con la insuficiencia tricuspídea grave (la fisiología no tiene volumen auricular del que
  sacarlo). Sus cavidades no tienen flujo en el color ni en el PW, salvo el chorro de la VCI que entra en la AD (la luz de su
  tubo). Con la VCI dilatada de la congestión (×1,57) el embudo que no cabe en la aurícula se recorta en su suelo (a 5 mm de
  la cúpula) y contra el tabique interauricular: un borde de 1–5 mm donde gana el corazón. El suelo del corazón es la
  distancia al plano tangente de la cúpula con su pendiente limitada a 2 (`heartFloor`): en el pliegue entre las hemicúpulas
  la pared inferior del VI queda hasta 2,2 mm más gruesa, y junto al borde de una hemicúpula (su altura sube con tangente
  vertical) el suelo no es una distancia. El tórax del modelo es poco profundo (106 mm de la cara anterior de la vértebra a
  la pared anterior): el VD toca la pared anterior y la AI, la aorta, sin grasa entre ellos; el VD basal y la AI quedan en el
  límite inferior de la ASE.
- **El espejo del pulmón junto al mediastino tiene una normal aproximada** (`mediastinal-mirror-normal-approx`, decisión 85):
  donde el haz llega al pulmón desde el mediastino (detrás de la aorta en la epigástrica abanicada, detrás de la AD en la
  subxifoidea) la pasada A refleja en el cruce exacto (decisión 57) con la normal del elipsoide de la cámara más cercana o de
  la columna del mediastino posterior (o la de su tapa), sin la unión suave de su frontera ni la pendiente de la grasa junto a
  la cúpula; con la normal de la cúpula de antes el camino reflejado se perdía y el pulmón salía como una zona negra entera.
  Quedan parches oscuros donde el camino reflejado, casi rasante, sigue hacia la columna o vuelve al pulmón. La norma de la
  normal del pericardio en la GPU es 1 (la de la distancia aproximada del elipsoide se aparta un 1,1 % en la mediana y un
  6,5 % en p95: ≤ 0,6 dB en su eco). El gemelo de la pasada A en TS (`transmissionHitsLine`, en las pruebas) sigue
  reflejando con la de la cúpula.
- **Columna segmentada con arco posterior provisional** (`vertebra-continuous-geometry`, identificador histórico; decisiones 103 y 108): los cuerpos tienen sección elíptica y segmentación craneocaudal con discos intervertebrales. La cortical de cuerpos y platillos depende de la incidencia y su normal deriva del mismo campo CPU/GLSL. El arco posterior sigue siendo una caja continua sin canal, pedículos ni apófisis anatómicas individualizadas; aporta oclusión pero no eco cortical propio. La separación retrohepática usa una envolvente continua para no transmitir los surcos discales al hígado. Dimensiones, rugosidad y respuesta acústica siguen estimadas; no están calibradas contra clips vertebrales. La sombra conserva el modelo óseo opaco previo (100 dB de entrada), sin corteza/esponjosa ni señales RF intravertebrales. No permite entrenamiento de punción neuraxial ni evaluación de densidad ósea.

- **La aorta no late en modo B** (`aorta-fixed-caliber`): su calibre es fijo; el pulso arterial está en su velocidad
  (color y PW), no en su pared. En la transversa epigástrica (decisión 83) no se ve el latido de 1–4 mm que ayuda a
  distinguirla de la VCI: se reconoce por su pared más gruesa y brillante, su sección redonda, su sitio sobre la vértebra,
  sus ramas y el Doppler.
- **El índice de resistencia arterial es fijo** (`fixed-arterial-resistive-index`): el pulso arterial
  es multiplicativo y el mismo en todos los casos, así que el IR renal (0,53) y el hepático (0,63) no
  cambian entre casos; además el pulso sube 130–170 ms antes de la R. Medir el IR hoy no enseñaría
  nada.

### Confusores de los casos trampa (decisión 82)

- **La presión intraabdominal no comprime la vena renal ni el riñón** (`iah-no-renal-compression`): la PIA sube la
  presión de los compartimentos del abdomen y colapsa la VCI, pero ni la resistencia de la vena renal ni el parénquima
  cambian. En el caso de la PIA el Doppler intrarrenal sale continuo y la porta al 25–27 %, sin calibrar frente al
  patrón real de la hipertensión intraabdominal.
  La decisión 172 retira `iah-collapsed-ivc-velocity`: el pico debido a dividir el flujo combinado por el área abdominal se reproduce como contrafactual, pero la velocidad superior usa su propia sección. No resuelve la cascada torácica ni todas las situaciones de PIA, y no se usa este cambio para validar los confusores clínicos restantes.

- **Captura suprahepática con PPV: protección parcial y baja utilidad con puerta fija**
  (`ppv-hepatic-capture-false-reversal`, identificador histórico): el contraejemplo original ya se rechaza cuando
  la puerta pierde sangre suprahepática durante una ventana FFT completa. La identidad media seguía siendo
  suprahepática: no se confirmó la explicación anterior de «otro vaso». En 20 semillas / 200 capturas con
  ventilación y respiración activa no hubo falsas capturas aceptadas, pero ninguna fue medible; esto protege el grado,
  no valida la adquisición bajo PPV. La regla usa composición geométrica privilegiada del simulador como supervisor,
  no una capacidad diagnóstica de un ecógrafo real. La técnica en apnea conserva los controles de utilidad existentes.
  Otros movimientos, casos y señales requieren validación independiente. Véase `physiology/HEPATIC_GATE_VISIBILITY.md`.
- **La VCI se dilata antes que en la tabla de la ASE** (`ivc-law-steep`): la ley de tubo de la VCI da al sano con PAD
  6/7/8 mmHg 20,1/22,2/24,0 mm con 27/23/20 % de colapso, que la tabla leería como una PAD intermedia (8) la primera y
  de 15 las otras dos. Por eso la trampa de la
  IT (PAD 8) y la de la ventilación (PAD 7) abren la puerta del VExUS con la PAD baja; en la clínica la VCI de una IT
  grave o de un ventilado también puede estar dilatada, pero con este modelo no hace falta.
- **La cirrosis no aplana la suprahepática** (`cirrhosis-hepatic-not-flattened`): la cirrosis del modelo es la
  resistencia intrahepática y la distensibilidad sinusoidal; las suprahepáticas no se estrechan ni pierden las ondas,
  así que en el caso trampa conservan la S invertida del fallo derecho (en el cirrótico pueden salir planas). Tampoco
  hay circulación hiperdinámica (gasto alto con resistencias bajas): el caso trampa tiene el gasto del corazón que
  falla (4,4 L/min).
- **Sin ascitis ni líquido libre** (`no-ascites`): el peritoneo no tiene líquido; las viñetas lo respetan (la PIA es
  posoperatoria y la ascitis del cirrótico está controlada).
- **Un hígado pequeño no encoge sus venas** (`small-liver-fixed-vessels`): las venas principales son las del avatar;
  con el hígado a 0,9 sus puntas quedan junto a la cápsula y el árbol procedural pierde un cuarto de sus ramas (30 de
  ≥ 40), así que la cirrosis del caso trampa tiene el tamaño normal.
- **Sin fisiología de deportista** (`no-athlete-physiology`): «Deportista» es solo contexto. La bradicardia sola (FC 45,
  PAD 4) no da la porta pulsátil del deportista (PF 27 %, S/D 2,0) ni el corazón grande.
- **Sin fisiología de ERC terminal** (`no-eskd-physiology`): «ERC avanzada o diálisis» es solo contexto. El riñón del
  modelo no tiene el parénquima que da un patrón intrarrenal alterado sin congestión (en la serie de hemodiálisis
  revisada, el Doppler renal no fue evaluable en un 37 % antes de la sesión) ni el volumen que se acumula entre
  sesiones.
- **Sin VCI remodelada** (`no-remodelled-ivc`): la VCI sigue siempre a la presión; la VCI crónicamente dilatada de la
  hipertensión pulmonar, que no baja al descongestionar, no existe.
- **Sin D invertida del VD rígido** (`no-stiff-rv-d-reversal`): una aurícula poco distensible (0,35) con el VD a 0,6 da
  una onda A de −21 cm/s y la porta al 59 %, no la D invertida de los latidos postinspiratorios; el contorno auricular es
  prescrito (`prescribed-ra-contour`).

## Marco de coordenadas

- **El marco anatómico es levógiro** (`left-handed-anatomy-frame`): x = izquierda del paciente,
  y anterior, z craneal. El navegador 3D lo corrige con un grupo espejo (decisión 22); cualquier
  vista nueva que dibuje la escena en un marco dextrógiro debe hacer lo mismo o verá el hígado a
  la izquierda.

## Imagen

- **PSF de un tejido de referencia** (`psf-nominal-tissue`, decisión 84): la bajada de la frecuencia central, la PSF
  lateral que se ensancha y el pulso que se alarga siguen la profundidad con la atenuación del hígado, como el filtro
  de seguimiento del equipo, no el camino real: bajo la vesícula, la VCI o el riñón la PSF es la del hígado a esa
  profundidad (el eco real, menos atenuado, tendría más frecuencia). La atenuación sigue a su frecuencia efectiva fija
  de 2,5 MHz (decisión 21), no a la central que baja. La ganancia focal es la de haces gaussianos de potencia fija en
  azimut (la emisión y la recepción): sin el foco de la lente de elevación (fijo, que se supone en el preajuste), sin el
  desplazamiento del foco de una apertura de número de Fresnel bajo, sin la aberración de la pared que ensancha el foco
  en el paciente y sin los varios focos de emisión de un equipo. Las líneas A del gas y la serie de la pleura la toman a
  la profundidad mostrada (la imagen de un reflector plano: la copia n es la emisión a n veces su profundidad) y las
  réplicas de la pared de la decisión 76, a la de su eco de origen (1,7 y 3,4 dB más oscuras a 2W y 3W con W 25 mm que
  con la otra regla); ninguna de las dos es la ley de un eco especular. La σ elevacional de la lente no lleva la bajada
  (la coherencia de curvatura de las caras usa el número de onda del eco con esa σ fija) y la rugosidad fina (Ament),
  el k0 nominal con que se ajustaron sus σz. La TGC nominal compensa la atenuación, no la banda del foco: con el foco por defecto el hígado a
  14–18 cm queda 4–5 dB bajo el del foco en fundamental y 4–7 dB en armónica, y los primeros 2 cm, 4–5 y 5–6,5 dB,
  como en un equipo sin tocar su TGC (el preajuste y el operador la corrigen en parte). El Doppler (color y PW) conserva el haz sin
  bajada ni apodización.
- **Solo refractan las luces líquidas** (`lumen-refraction-only`, decisión 86): la pantalla de fase de la refracción es la
  de la sangre y la bilis (la vesícula y los conductos) frente a la c del hígado que las rodea. La grasa (la de la pared,
  la perirrenal, la retroperitoneal y la del seno renal), el músculo, el miocardio y el mediastino (decisión 85), el riñón
  y la orina de la pelvis (rodeada de grasa de su misma c) no refractan, y la sangre de las cámaras del corazón refracta
  frente a la c del hígado aunque la rodeen el miocardio (1561 m/s) y la grasa del mediastino (1460): no hay sombras de borde en los polos del riñón por su grasa, ni aberración de la pared
  abdominal (el relieve de sus fascias, ±0,5 mm en 6,5–25 mm y ±1,5–2 mm en 2–5 cm desde la decisión 88, desenfocaría de
  verdad y cambiaría la calibración de toda la imagen),
  ni el desdoblamiento de los rectos. Las paredes de los vasos tienen la c del hígado: no refractan por sí mismas, así que
  las sombras de borde de los vasos son solo las de la sangre (≤ 0,5 dB: no se ven). Un vaso rodeado de grasa (la VCI
  retroperitoneal, la aorta, las renales: 1578 frente a 1450 m/s) sería de verdad una lente divergente del 8 %; aquí
  refracta como si lo rodeara hígado.
- **Refracción de lente delgada paraxial** (`refraction-paraxial`, decisión 86): la desviación de cada rayo es el gradiente
  lateral de su camino de más, acumulado en línea recta, en el plano de imagen (no en elevación); el eco no se desplaza
  (solo cambia su energía), no hay pérdida de Fresnel ni reflexión total a incidencia rasante y el color y el PW no la
  llevan (su rayo es el único). En los bordes de la vesícula la desviación (~40°) sale del dominio paraxial. El eco del
  haz enfocado es la suma incoherente de 7 tramos de cada apertura con manchas gaussianas (y una difracción de lo
  refractado ajustada al banco de ondas, que es de fundamental: la armónica no está contrastada): frente a él, el borde
  de la vesícula sale 1,1–2,4 dB menos hondo y con su mínimo 1–2 mm dentro de la luz, y su centro hasta 1,6 dB más oscuro,
  sobre todo por la escalera de A1 (la cuerda de la luz va en segmentos enteros de 1,125 mm y sus escalones se leen como
  bordes de lente; tras la vesícula ondulan la ganancia ±1 dB entre líneas). Todos los rayos cruzan la luz a la distancia
  D de la línea de la muestra (o de la vecina con luz más cercana: de una en una hasta ±8 líneas y de cuatro en cuatro
  hasta ±32; más lejos, 1 exacto), y con dos luces en la misma línea se suman sus caminos de más como si fueran una sola
  lente a la distancia de su centroide. La refracción y la penumbra se multiplican como si fueran independientes (un rayo
  que cruza una costilla o gas y se desvía cuenta con su energía entera). Tras el primer gas el gradiente de Ψ̃ suma luces
  que ya no reciben eco (sin efecto: ahí no hay transmisión); junto al borde del espejo del pulmón compara un camino
  reflejado con uno recto, y ese efecto no está medido.
- **La bilis y la orina, a 20 °C** (`fluid-sound-speed-20c`): TISSUES da 1482 m/s al líquido de la vesícula y de los
  conductos y a la orina de la pelvis, el agua a 20 °C; a 37 °C el agua va a ~1524 m/s (Del Grosso y Mader 1972, J Acoust
  Soc Am 52:1442) y la bilis, algo por encima. El desajuste con el hígado sale del 7,0 % en lugar del ~4 %: la refracción
  de la vesícula (decisión 86) es ~1,7 veces la real, con sombras de borde más anchas y hondas (gemelo: −22 dB a 4 cm), y
  la cara de la luz de la vesícula refleja con R 0,075 en lugar de ~0,061. Cambiarla toca la calibración del eco de esa
  cara (`interfaceEcho.test.ts`, decisiones 57 y 65).
- **Lóbulos laterales simplificados, sin lóbulos de rejilla ni en elevación** (`no-sidelobes`): desde la decisión 76 el
  núcleo lateral lleva un pedestal gaussiano con una pantalla de fase fija (ISLR −24 dB en el paciente de referencia),
  no el diagrama real de la apertura; la reverberación de la pared es de primer y segundo orden y solo de los ecos
  fuertes (compuerta por módulo del campo, no por la cara que la produce). Desde la decisión 88 el pedestal de una línea
  se apaga con la fracción de su haz que sobrevive a los huesos (la de su transmisión con apertura frente a la de su
  rayo sin hueso, sin la refracción de las luces): bajo una costilla sus lóbulos laterales pierden lo mismo que el principal. Los lóbulos reales que
  pasan junto a la costilla seguirían trayendo algo de la pleura vecina; en las imágenes reales (el «signo del
  murciélago») la pleura no sigue bajo la costilla, y sin el apagado se veía a −10/−18 dB del hígado.
- **La transmisión de los ecos especulares, con una sola pendiente de facetas** (`specular-pair-single-slope`, decisión
  91): la de los pares de la apertura (el rayo de emisión por u vuelve por −u) se mezcla con la de la apertura en
  ρ = min(1, 3·s·r/D) con la pendiente de la cara más lisa de la tabla (s 0,14) para todas: una cara más rugosa llegaría
  antes a la de la apertura. Es la mezcla de los dos límites de la suma doble con el lóbulo gaussiano de las facetas, no
  la suma (0,6 dB rms, 5 dB en la línea del borde de una costilla junto a ella); los pares son los de incidencia normal (una
  cara oblicua devuelve los rayos desplazados, y su lóbulo ya cae con la incidencia) y el obstáculo se concentra a una
  profundidad, como en la penumbra.
- **Tras un espejo, el moteado sigue comprimido en la elevación de la sonda** (`mirror-slice-elevation-axis`, decisiones
  55, 57, 58 y 91): más allá del espejo, la muestra está en el camino reflejado, pero la retícula del moteado se comprime
  hasta el grosor de corte a lo largo del eje de elevación del ancla, no del corte reflejado. Con una pleura cuya normal sale
  del plano (el borde de la subcostal), el moteado reflejado se estira en las direcciones de la imagen que el espejo lleva
  hacia esa elevación: en el gemelo de la mirada dirigida, 0,35 mm de tejido fuera de la elevación por mm de imagen en la
  peor dirección (antes de la decisión 91, con la reflejada de la línea del espejo para todos los caminos, 0,031: el peine).
- **Ruido del receptor por línea, sin recepción en paralelo** (`receiver-noise-per-line`, decisión 89): el ruido es
  independiente entre líneas (cada línea, un disparo) y limitado en banda a lo largo de ella; muchos equipos forman 2–4
  líneas por disparo (recepción en paralelo), que comparten el ruido de los canales y lo correlacionan por grupos. Sin la
  cuantización del ADC ni el ruido de fase; componentes uniformes que el filtro de recepción deja casi gaussianas
  (curtosis en exceso −0,09 a −0,42 por componente según la profundidad seleccionada: la mediana de su envolvente queda
  1,5–4,5 % sobre la de Rayleigh de la misma potencia, el suelo de ruido hasta +0,4 dB con 24 cm); el índice del cuadro
  se repite cada 4096 cuadros (~68 s a 60 cps).
- **Armónica tisular simplificada** (`harmonic-simplified`, decisión 77):
  - la acumulación del armónico es una curva fija del campo cercano (1 − e^(−r/2 mm), compensada desde 4 mm), no la
    integral del haz con el foco (la ganancia focal de la decisión 84 sí lleva la fuente p1²: la intensidad de la
    emisión a f1 en el eje, no su raíz);
  - las líneas A y la cola sucia del gas no cambian con la armónica;
  - el pulso de la armónica es el de su banda (35 % frente al 45 % del fundamental, decisión 84), sin distinguir la
    inversión de pulso del filtrado;
  - la pérdida de conversión se modela como +3 dB de ruido del receptor;
  - no hay penumbra armónica: las sombras usan la penumbra del cono de la apertura de la decisión 54, como en
    fundamental, sin pesar el cono de emisión por p1².
- **Tienen eco de interfaz los vasos, la vesícula, la cápsula hepática, el diafragma, el riñón, la pleura
  parietal y la pared, pero no el gas intestinal** (`interface-echo-scope`, decisiones 57, 61 y 62): el gas
  intestinal no dibuja su cara (PR 7); se ve por su reverberación y su cola sucia. Las capas de la pared, la
  cortical costal y el pericondrio la dibujan desde la decisión 62; en las copias de la pared bajo la pleura
  (la serie de la decisión 61) las capas llevan un eco analítico de cara plana paralela a la piel, sin la cortical ni el
  pericondrio y sin el relieve de la decisión 88 (el eco de cada cruce queda a ≤ 1,3 dB del completo: con la pendiente
  de la capa el bucle de la serie subía ~3 s la compilación de B con SwiftShader).
- **El eco de interfaz es un modelo de dos escalas simplificado** (`interface-echo-two-scale`, decisiones 57 y 65):
  las facetas son un ruido de valor anclado (σ_t = max(tan 5°, 0,5·s), célula de 3 mm) y no una rugosidad medida, y
  se evalúan en el plano central de la rodaja (la rodaja de 3–5 mm promediaría parte de la fragmentación); su fase es
  la 0 común de la cara, así que la PSF suma las facetas vecinas en amplitud y la imagen sigue su amplitud media, que a
  10–20° queda hasta 1–4 dB bajo el lóbulo del conjunto (la media de la potencia por muestra sí lo conserva); el ruido
  de la GPU (float32) y el del gemelo (float64) coinciden en estadística, no punto a punto. La componente difusa es una
  capa fina sobre el fasor del moteado del tejido de la muestra (refuerza su grano en lugar de sumar uno independiente:
  hasta +2,8 dB de potencia cuando iguala al moteado) con la ley de Lambert y κ_d calibrado [ESTIMADO]; el grosor de la línea
  no depende de la inclinación de la cara en elevación (la rodaja la ensancharía). La cara interna de la pared baja a
  una fascia con grasa detrás; contra la columna no se descarta (desde las ventanas abdominales está en la sombra del
  hueso). La pleura del diafragma y la parietal, y las copias de la pared bajo la pleura, dan solo su parte
  coherente del conjunto (−28,7 dB a 0° la del diafragma, −8,9 dB la parietal), sin facetas ni difusa. Una cara por
  estructura y sin signo, sin la cara pared/hígado (misma impedancia) ni la de cápsula renal/corteza, y sin
  interferencia de capa fina. Su nivel sale de K = 55 dB, un valor derivado de un plano liso (± 6 dB) que se calibra
  con GPU dentro de [53; 57] dB. Los planos de elevación que entran en una costilla (en la intercostal, el borde de la
  8.ª y la 9.ª a ±2–3 mm del plano) no devuelven nada: el hueso no tiene retrodispersión propia (decisión 88) y la cara
  de la cortical sale del plano central; un equipo vería ahí el eco de volumen parcial de la cortical, y la sombra de esa
  parte del haz más abajo (la transmisión es la del plano central). El músculo de la intercostal queda 3,6 dB más oscuro
  que antes de la decisión 88, ~2,5 dB por esto.
- **La coherencia de curvatura solo la tienen los tubos y las costillas** (`interface-curvature-tubes-only`;
  las costillas desde la decisión 62, con la curvatura de su sección elíptica): vesícula, riñón, cúpula y las
  capas de la pared son localmente planos para el eco. Sin la curvatura elevacional del riñón, Morison salía
  ~1,5 dB más brillante que en el diseño (gemelo: 2,23 frente a 2,08 sobre el hígado a 0–20°); la s de la
  cápsula renal, la cara que da su pico, pasa de 0,21 a 0,25 y lo deja en 2,17.
- **La pared es genérica** (`wall-generic-layers`, decisión 62): el mismo modelo de tres músculos con dos
  planos intermusculares en el tórax, el flanco y la espalda (sin intercostales, serrato ni paravertebrales
  propios), sin línea alba ni intersecciones tendinosas del recto, y un solo hábito de lóbulos y estrías cuyos
  tamaños, retrodispersiones y rugosidades efectivas son [ESTIMADO] (se calibran con GPU frente a las
  referencias). u es la longitud de arco de la piel: en la cara interna de la pared del flanco las estructuras
  quedan ~1,5× más largas. La textura tiene una costura en la línea media posterior, sobre la columna. El
  cartílago costal va de la línea media anterior a ±45° en todas las costillas (un ángulo común, no la unión
  costocondral de cada una), más los últimos 25 mm antes del extremo de las que acaban en el reborde costal, y
  el reborde es una recta desde el xifoides; las costillas 11.ª y 12.ª no existen. Cada costilla tiene su sección
  (decisión 88: de 9,6 × 5,4 a 14,6 × 6,4 mm [ESTIMADO]), pero constante a lo largo de su cuerpo, sin el surco
  costal ni la torsión. El relieve de las capas (decisión 88) es una suma de senos anclados (tres de 6,5–25 mm y dos
  lentos de 24–52 mm por cara) [ESTIMADO], no un mapa medido: sus caras se inclinan sobre la piel 6–9° de mediana,
  15–23° en el p99 y hasta 31–37°; con más de 20 mm de grasa, |∇| de la fascia y del plano oblicuo pasa de la cota de
  la salida barata del eco (1,5; 1,54 a 24 mm, 1,61 a 30), que corta entonces el perfil del eco a 3,3 σ (−47 dB).
  Las estrías del músculo siguen a la fascia, pero su
  normal no lleva la pendiente de ese relieve (a la mediana de 7° su ganancia cambia < 3 %; en el 1 % más inclinado,
  ~20 %). Con la sonda apretada (decisión 63) la pared se empuja como un bloque y conserva el relieve: la grasa real,
  más blanda, se aplanaría algo bajo la sonda.
- **La compresión de la sonda es cinemática, no elástica** (`probe-compression-kinematic`, decisión 63): no hay
  rigideces ni fuerza. La sonda se hunde a lo largo de su eje lo que haga falta para que apoye toda la cara, con un
  tope de presión [ESTIMADO] que depende solo de la blandura de la pared (no de la fuerza del usuario, salvo lift
  < 0); la pared entera (con las costillas y los cartílagos, que en realidad no ceden) se empuja como un bloque y el
  tejido de debajo absorbe el empuje en max(32 mm, 6×) con una caída [ESTIMADO]. Consecuencia: todo el campo cercano
  se acerca a la sonda (lo hondo aparece hasta 15–20 mm menos profundo que con el tronco rígido, como al apretar en
  un examen), y lo que queda dentro del alcance se acorta a lo largo de la línea, también una arteria que en realidad no
  cede: en la transversa epigástrica (decisión 83) la luz de la aorta mide 21 × 18 mm (21 de alto sin compresión) y la
  de la VCI 20 × 13 (16). Sin histéresis ni viscoelasticidad (la deformación sigue a la pose en el mismo cuadro) y sin
  velocidad del tejido por el movimiento de la sonda (el Doppler no ve el arrastre). Los gemelos de imagen de la pared,
  la pleura y el contorno del hígado (`wallTwin`, `pleuraTwin`, `liverContour`) siguen sobre el tronco rígido con el
  marco de la pose sin hundir.
- **La sonda no bascula ni se inclina más de 40°** (`probe-angle-40deg`): `clampPose` limita la basculación y la
  inclinación a ±0,7 rad. El «conejo» subxifoideo (las tres suprahepáticas en abanico hasta la VCI), que en un paciente
  sale con la sonda casi plana bajo el xifoides y el haz muy basculado hacia la cabeza, aquí no se forma entero:
  abanicando la transversa epigástrica 26° hacia la cabeza (decisión 83) las suprahepáticas se acercan a la VCI cortadas
  de través (la derecha y la media a 1 y 3 mm; la izquierda a 9 mm y con un tercio tras el pulmón), y la VSH media en eje
  largo, con un ángulo Doppler útil, se busca desde debajo del reborde costal (la subcostal).
- **La compresión solo mueve el tejido a lo largo de las líneas de la cara** (`probe-compression-in-plane`,
  decisión 63): es radial en el plano de la cara (el tejido no se desliza ni se cizalla de lado: el hígado, casi
  incompresible, se comprime a lo largo de la línea hasta un 20 % bajo la pared y a lo ancho se abre hasta 1,4× en
  el flanco y 1,7× en el talón de la subxifoidea basculada), plana en elevación (la pared no se amolda a la
  inclinación fuera del plano: con la sonda abanicada las capas conservan esa inclinación) y lineal a tramos entre
  los 64 nodos de la cara (la pendiente de las capas oscila ≤ 8° con el periodo de un nodo). Como solo empuja, donde
  la cara no consigue la pared paralela con la presión máxima la línea no acopla: los bordes de la intercostal más
  allá de ±21° (el tórax lateral, de 69 mm de radio en la sección) y la punta de la subxifoidea basculada más allá de
  +18°. La dirección de la sangre no se gira con la jacobiana (los vasos se mueven poco; los superficiales no
  existen).
- **El grosor de corte rellena las luces con tres planos** (`lumen-fill-three-planes`, decisión 86): la pasada B mezcla el
  moteado del plano central con el de dos planos a ±σe, así que una luz rellena a unos −6 dB si su semialtura en elevación
  es menor que σe y nada si es mayor, en lugar de la potencia del haz elevacional fuera de la luz, erfc(√2·h/σ₁): −9 / −15 /
  −27 dB a 3 / 4 / 6 mm en eje largo a 5 cm. Medido con GPU, las luces de 2–4 mm quedan a −2/−15 dB del hígado y las de
  5–7 mm a −7/−38 dB según su orientación y dónde caen los planos, dentro de lo que dan la física y las referencias reales.
- **Los planos laterales de elevación se saltan los vasos** (`side-plane-skips-tubes`): si el plano
  central está a más de σe + 0,5 mm de una interfaz, los laterales heredan su tejido sin clasificar
  (decisión 24), pero la `bd` del hígado no cuenta los tubos: junto a un vaso fuera del plano, el 1–5 %
  de los píxeles de hígado no ve su borde en elevación.
- **Tríadas portales difusas** (`portal-triads-diffuse`, decisiones 78 y 89): las tríadas portales finas son dispersores
  brillantes anclados que multiplican el moteado del hígado. Desde la decisión 89 su brillo tiene cola y es en parte
  especular (más de través que a lo largo del haz, con la ley |cos θ|⁴ sobre el exceso de retrodispersión de la vaina),
  pero no dibujan un eco coherente de cara (la línea fina de una pared especular); la ley usa la dirección radial del
  haz, sin la jacobiana de la compresión de la sonda ni la dirección reflejada en el espejo del diafragma; sin Doppler y
  sin unirse al árbol de tubos; la misma densidad en todo el hígado (sin los cambios de la hepatitis o la fibrosis).
- **Dispersores fuertes puntuales y solo en el hígado** (`strong-scatterers-lattice`, decisión 89): los dispersores
  fuertes son nodos de la retícula del moteado de 0,42 mm: puntuales e isótropos, sin la forma alargada de los septos ni
  su especularidad, con dos niveles de amplitud (los fuertes ×4,5 sobre los corrientes, más la dispersión de Rayleigh de
  cada nodo) en lugar del espectro continuo de tamaños del árbol portal, y la misma fracción en todo el hígado (la
  esteatosis y la fibrosis, que cambian el m de Nakagami, no la mueven). La corteza renal, el músculo y el resto de los
  tejidos siguen siendo de Rayleigh. La densidad de dispersores a escala de milímetros es un ruido de valor, sin la
  arquitectura lobulillar. En los paneles del juez la cola brillante real la ponen trazos especulares de milímetros
  (septos y paredes) que el modelo no tiene: una población de septos en las fronteras de la densidad la igualaba, pero
  con un rayado regular, y se descartó.
- **Estadística de speckle calibrada solo en parte** (`speckle-statistics-uncalibrated`): la envolvente del hígado sigue
  el m de Nakagami del hígado sano en ventanas de tres pulsos (Wan et al. 2017; decisión 89) y la imagen mostrada se
  compara con los paneles reales del juez ciego, pero no con clips de RF de un equipo: la forma de la cola en pantalla
  depende del proceso del equipo (reducción de moteado, realce de bordes), que el simulador no tiene, y los paneles reales
  tienen la cola oscura más corta. La e2e exige que la envolvente del parénquima hepático de una mirada (compuesto apagado)
  quede en la banda de un moteado algo pre-Rayleigh, con la SNR de parche de 1,5–2,1: descarta defectos de detección
  (con la textura del hígado, la intensidad da 1,0, |Re f| 1,35–1,39 y un suavizado 2,9–3,2; las magnitudes sumadas antes
  del haz, ≈ 9), no calibra la textura frente a un equipo real.
- **El moteado se submuestrea en las líneas** (`speckle-line-aliasing`): 192 líneas quedan a 0,5–1,5 mm
  (de 20 a 180 mm) frente a un grano lateral de 1,5 mm hasta 6 cm, 1,9 mm en el foco y 3,5–4,9 mm a 15–18 cm (la PSF
  de la decisión 84), así que en el foco hay ~2 líneas por grano y la pasada D convoluciona un campo muestreado de
  menos. Mecer la sonda media línea cambia el moteado más que en un equipo (gemelo del
  diseño de la decisión 58: correlación 0,45–0,53 / 0,05–0,13 / −0,03 a −0,01 a 45 / 90 / 150 mm): el
  hígado «hierve» al deslizar la sonda. La composición espacial lo esquiva entre miradas (se forman en la
  rejilla común), pero el par (−,+) puede correlacionar de más, así que su ρ se informa sin puerta. El
  arreglo previsto (PR 3) es un prefiltro de 3 submuestras por línea, con la fase de la mirada 0 referida
  al ancla.
- **La estadística del medio anclado depende algo de la orientación del plano** (`speckle-anchor-orientation`,
  decisiones 55 y 62): el medio es una red de valores alineada con los ejes del mundo, comprimida a lo largo de
  la elevación del ancla, y un plano oblicuo a esos ejes la corta de otra manera. Justo antes de reanclar
  inclinando (5° de deriva), la SNR del moteado de un parche sube un 2 % en la vista intercostal de antes (casi
  craneocaudal) y un 12 % en la de la decisión 62 (a lo largo del 8.º espacio, yaw −1,15; una realización
  alineada en esa pose, un 5 %), cerca de la cota de 1,12 con la que la 55 eligió `REANCHOR_DEG`: sus pruebas se
  quedan en la pose de antes. Si se nota en la GPU, se baja `REANCHOR_DEG` o se gira la red con el ancla.
- **La serie bajo la pleura remuestrea la pared en la misma línea** (`pleura-series-same-line`, decisión
  61): las copias espejo y directa de la pared y las líneas A se forman con la pared del propio camino, no
  con la de la dirección reflejada por una pleura oblicua; no cambian con la incidencia salvo por la
  coherencia de la pleura (χ) y las líneas A llevan el lóbulo de Kirchhoff una sola vez (el del eco
  pleural), no una vez por rebote. Los caminos del mismo retardo sí se suman (n + 1 en la copia espejo de
  orden n, n + 2 en la directa). Las líneas A tienen la anchura de la línea pleural (en las referencias son
  algo más anchas y tenues).
- **Sin colas de cometa ni líneas B** (`no-lung-comet-tails`, decisión 61): el pulmón bajo la pleura es la
  serie de la pared y el deslizamiento incoherente; no hay líneas Z ni B (ni pulmón patológico), y el
  deslizamiento se ve como neblina que cambia con la respiración, no como el centelleo puntual de la
  pleura visceral.
- **El borde de la cortina muestra el tejido del rayo central** (`curtain-edge-central-ray`, decisión 61):
  en el borde blando la fracción 1 − f del haz ve lo que hay detrás de la lámina en el rayo central
  (`classify` sin la cortina), no la parte del haz que cae bajo el borde; donde detrás de la lámina sigue
  el pulmón del tórax, esa fracción es negra. Su transmisión es la de la línea sin la pérdida de la lámina
  de A0 (ΔL), con el rayo único de la línea por tope, y dentro de la lámina (3 mm) queda hasta ~1 dB alta.
  La lámina no es un obstáculo de la penumbra de la apertura: el borde lo hace solo la fracción de aire.
- **Costura en el límite de la huella del receso** (`curtain-footprint-seam`, decisión 61): la pleura
  parietal se registra solo si la línea cruza la pared dentro de la huella del receso (x ≤ −45 mm,
  y ≤ 40 mm). Una línea que la cruza justo fuera y alcanza después el pulmón de la cortina bajo la pared lo
  ve como el espejo del diafragma de la decisión 57 (en la CPU, 5–7 líneas en la intercostal y 24–36 en la
  subxifoidea, de refilón): allí no hay línea pleural ni neblina, sino lo de antes. Quitar la huella de
  `lungCurtainEdgeMm` lo resolvería cambiando esas ventanas; queda para el dueño.
- **El Doppler atraviesa la cortina** (`curtain-doppler-through-lung`, decisión 61): el color y el PW
  cruzan la lámina de pulmón en línea recta con la atenuación del gas de la CPU (60 dB/cm: ~18 dB en sus
  3 mm), como el modelo de la puerta; un pulmón aireado real no deja pasar nada. Antes el color de detrás
  de la cortina usaba la transmisión del camino reflejado, sin pérdida.
- **Sin composición espacial bajo la cortina** (`compound-off-under-curtain`, decisión 61): bajo la pleura
  de la cortina la pasada K da a las miradas dirigidas el peso 1 − fAir de la mirada 0 (0 en la cortina
  entera, sin costura en el borde blando): cada mirada reverbera a múltiplos de su propio camino y la media
  de tres partía cada línea A en tres arcos (con SwiftShader, la línea A de orden 3 quedaba 6 dB por debajo
  de la de la mirada 0). Allí la imagen es la de una mirada, como en los preajustes de pulmón de los
  equipos, que no componen; sobre la pleura (la pared) sigue compuesta, así que el cambio de textura cae en
  la línea pleural. Las métricas del compuesto del banco (bandas de hígado limpio) no llevan este peso:
  bajo la pleura con 10⁻³ ≤ fAir < 0,01 cuentan 1 donde K pone 0,99–0,999.
- **Sin composición espacial con el color encendido** (`compound-off-in-color`, decisión 58): con la
  caja de color el cuadro B se refresca a la cadencia del color (4–11 Hz, decisión 39) y las tres miradas
  cubrirían 280–715 ms, con estela respiratoria de varios mm; el compuesto se apaga y la textura del
  hígado vuelve a la de una mirada (desviación del gris ≈ 12 → 16 [ESTIMADO]), como en varios equipos. El
  PW lo conserva. Componer con color exige una métrica de estela y otra decisión.
- **El modo M toma una columna por cuadro de imagen** (`m-mode-frame-rate`, decisión 80): la franja copia la
  línea M de la envolvente de cada cuadro B (16 ms a 60 Hz; con SwiftShader, hasta 250 ms), compuesta como la
  imagen (con la composición espacial, la media de los tres últimos cuadros: 50 ms a 60 Hz, 0,75 s con SwiftShader),
  y no una línea dedicada a ~1 kHz como un equipo. Basta para la VCI y la respiración; no resuelve el movimiento de
  una válvula ni el latido fino de una pared.
- **De frente, el eco de la pared de enfrente estrecha la luz de la VCI en el modo M** (`m-mode-lumen-blooming`,
  decisión 80): con la línea M casi perpendicular a la VCI (≥ 84°) el eco especular de la pared posterior, máximo de
  frente, se come 1–1,5 mm de la luz en la presentación logarítmica y la colapsabilidad medida de borde interno a
  borde interno sale ~6 puntos por encima de la verdad del motor en el sano (37 frente a 31 %); con la línea
  2 cm por debajo de la desembocadura de las suprahepáticas (~80°), no se sostiene una garantía de ±2 puntos.
  En la CI de `a3a5b1a` la envolvente dio 27,90 % frente a 30,42 % del motor; redondear por separado los cuatro
  clics a píxeles CSS enteros redujo la medida a 25 %. La prueba separa ahora transformación de coordenadas,
  redondeo de presentación y error físico de la envolvente (límite de software ±5 puntos, no precisión clínica
  validada). La cuerda geométrica de la luz a lo largo de la línea sigue a la verdad (31,3 frente a 31,0 %).

## Doppler

- **El aliasing extremo de la porta se lee como «sin flujo»** (`severe-aliasing-not-detected`, decisiones 49 y 94): la
  calidad reconoce el plegado moderado (la sangre toca los dos bordes de la banda con un hueco entre ambos) y, desde la
  decisión 94, el fuerte (la sangre plegada varias veces llena la mitad exterior de la banda ≥ 3 dB sobre el ruido del
  receptor). Pero con la escala a ±4–6 cm/s la banda del filtro de pared (62,5 Hz con el filtro a 25 Hz) es media banda y
  la porta, débil, no llega a llenar el resto (tampoco la suprahepática del sano a ±4): la captura dice «no hay flujo en
  la puerta» en vez de «suba la escala». Nunca da un valor.
- **Con respiración, el clutter del tejido tapa el flujo venoso lento en el espectro**
  (`respiratory-clutter-masks-slow-flow`): el tejido que se mueve a 10–30 mm/s da un clutter 60–70 dB
  sobre el ruido a 30–100 Hz, por encima de un filtro de pared de 25 Hz; con la ventana de la FFT
  su falda ocupa hasta ~±450 Hz, la banda de una vena lenta, y la sangre no se distingue del
  tejido ni en inspiración máxima. Es lo que pasa en un equipo real (por eso se pide apnea o se
  sube el filtro), pero el simulador no modela un filtro de pared de alto orden (> 60 dB de
  rechazo) como los de regresión de los equipos.
- **La calidad no tiene criterio de señal débil** (`weak-signal-not-flagged`): con la sangre a
  ~15 dB sobre el suelo (VSH a 11 cm desde la pose inicial, transmisión −32 dB) la envolvente, con
  su margen de 12 dB, recoge picos sueltos del moteado espectral y S varía entre capturas
  (18–29 cm/s en el sano). La captura suele dar el patrón correcto pero no lo garantiza; desde la
  ventana intercostal la banda sube a 28 dB. Falta calibrar un umbral de SNR por captura.
- **La colocación anatómica de la puerta ignora las sombras** (`gate-placement-ignores-shadows`):
  sin peso, `bestGateOnVessel` evita la confluencia con la VCI pero no mira la transmisión y desde
  algunos puntos de partida elige un punto en la sombra de una costilla o de la cortina pulmonar.
  Los ganchos de la e2e, las pruebas de escala y la de respiración le pasan `acousticWindowWeight`; las pruebas de la
  cadena del alumno en apnea siguen con la técnica anatómica, ya con la transmisión real hasta la puerta (decisión 94;
  antes, una copia de la puerta con −10 dB fijos). En la app la puerta la pone el alumno.
- **La resolución de las pausas renales depende de la PRF** (`renal-pause-resolution-prf`): la
  verdad cuenta como interrupción una pausa de ≥ 20 ms (decisión 26), lo que resuelve el espectro de
  128 muestras a ~4 kHz. A 1,5–2,6 kHz la captura pierde pausas de 20–30 ms; a 6 kHz ve las de 10 ms.
  Con el filtro de pared muy alto (300 Hz) un valle justo por encima del corte cuenta como línea de
  base y el patrón pasa a bifásico. Los casos actuales no tienen pausas de 10–40 ms.
- **En tríplex la PRF del PW no se reparte con la imagen** (`triplex-prf-not-shared`): la imagen
  (B + color) pierde la fracción del tiempo que se lleva el PW intercalado (decisión 66), pero la
  escala del PW sigue siendo la del dúplex; algunos equipos limitan la PRF del PW en tríplex
  simultáneo (o pasan a «actualizar», con la imagen congelada) y el Nyquist baja.
- **El color es una emulación del estimador** (`color-emulated-estimator`): potencia y fase se
  calculan por celda a partir de la mezcla sangre/clutter/ruido, no de una IQ real por ensemble.
- **Con respiración tranquila la puerta pierde el vaso** (`gate-lost-with-quiet-breathing`): es
  físico solo para vasos finos (el hígado se desplaza 10 mm y una interlobar de 3 mm sale de una
  puerta de 4 mm); el operador debe usar apnea espiratoria o un segmento más grueso, como en la
  práctica. Hasta la 0.5.0 también lo sufrían vasos más gruesos que la puerta (tronco portal: PF
  167 % en el sano) por un defecto del volumen de muestra, ya corregido.
- **La traza de la porta está ajustada sobre la propia cadena** (`portal-trace-tuned-on-chain`, decisión 94): el promedio
  móvil de 60 ms, los cuantiles 0,03/0,97 de Vmín/Vmáx y el hueco de 60 Hz de la banda se eligieron en una rejilla sobre
  168 capturas de la cadena del alumno y se validaron con otras seis semillas (a ≤ 10 puntos de la verdad de los latidos
  medidos: 99–100 % de las aceptadas; de la de 7 s: 94,6–98,3 %), no contra el trazado automático de un equipo real ni
  contra clips. Con respiración tranquila la porta del sano sale a
  menudo «intermitente» a ±40–±60: su banda, a −32 dB, pierde la traza en algún latido.
- **Cuatro latidos no bastan en la FA** (`af-capture-beat-sampling`, decisiones 49 y 94): la captura mide los 4 últimos
  latidos completos, y en la FA la PF portal cambia de un latido a otro (12–47 % en una misma captura de la cadena del
  alumno, con respiración). La mediana de esos 4 puede quedar a más de 10 puntos de la de los ~11 latidos de 7 s (26 frente
  a 41 %): la medición sigue a la verdad de sus latidos, pero el alumno debería promediar más latidos, como en la clínica.
- **Los vasos finos vuelven a la puerta con menos sangre de la real** (`thin-vessel-sample-volume-lag`):
  cuando una interlobar sale de la puerta con la respiración y vuelve, su región queda con menos
  dispersores (30–45 % de sangre frente al 69 % de una siembra nueva en fin de espiración); además
  la reclasificación solo alcanza a un cuarto fijo de la población. Rotarla y reponer la población
  sin más introduce saltos bruscos de amplitud de pared y tejido (30–40 dB sobre la sangre) que el
  filtro de pared no quita: hace falta un control de población con transiciones lentas.

## Enseñanza

- **La identidad del vaso la da el modelo, no la imagen** (`vessel-identity-from-model`, decisión 94): una captura cuya
  puerta estaba sobre otro sistema vascular que el de su fila se rechaza como «vaso equivocado» con el vaso que había; el
  simulador lo sabe por la sangre del volumen de muestra, como lo sabría un supervisor, no un ecógrafo. La atribución
  general usa la composición adquirida. Desde la decisión 127, la captura renal añade una guarda conservadora sobre
  los latidos realmente medidos: si domina una arteria interlobar, rechaza la medición venosa automática. El espectro
  pareado sigue visible para inspección; no se asegura que el estimador separe ambas componentes con fiabilidad.

- **El modo ciego es de pantalla, no de código** (`blind-mode-screen-only`, decisión 82): el alumno no ve el nombre del
  caso, sus confusores reales ni la trampa en la pantalla ni en el DOM, y las explicaciones de las trampas con los
  confusores reales solo viajan en el chunk de la pestaña Docente, que su navegador no descarga. Pero el JS principal
  lleva el registro de casos con la verdad latente (el `PatientState`: la PAD, la PIA, la IT…) y sus nombres para el
  modo docente, y los valores de las opciones del selector de los casos de referencia (`severe-congestion`,
  `af-moderate-congestion`) nombran el diagnóstico: quien lea el código o el DOM puede saber el caso.

## Adulto de referencia en revisión (`?reference=1`)

- `reference-thorax-incomplete` (alternativa procedural; el adulto abdominal usa el campo de la decisión 180): solo los pares 5–10 conservan el ajuste del atlas. Los pares restantes y el esternón son procedurales estimados, no piezas registradas de los 24 OBJ. El perfil corporal superior sigue limitado y la columna es procedural desplazada; no existe un adulto de referencia reconciliado completo. [Plan y estado](anatomy/TORSO_PROGRESS.md).
- `reference-skeletal-organ-overlap` (hallazgo del modelo anterior; el campo de la decisión 180 no detecta intersecciones costales interiores con hígado, riñones, bazo ni páncreas en el muestreo declarado): un muestreo denso del esqueleto sin compresión contra los tejidos originales detecta intersecciones con hígado y cinco muestras sanguíneas en la sexta costilla. La precedencia de hueso en el clasificador no elimina este defecto geométrico. No se movieron órganos ni se ensancharon ventanas para ocultarlo. La superficie del séptimo cartílago queda a un mínimo muestreado de 0,39 mm de la piel externa: también necesita reconciliarse con el espesor cutáneo. [Medición](anatomy/reference-relationships-report.json).
- `reference-cartilage-seventh-only` (alternativa procedural; el adulto abdominal integra los cartílagos fuente 1–7): solo el séptimo cartílago bilateral tiene secciones medidas en los OBJ incluidos; los otros cartílagos siguen pendientes. Las 16 elipses interpoladas tienen residual de superficie RMS 0,94 mm, p95 2,10 mm, máximo 3,15 mm. Promedio bilateral, extremos cerrados y sección elíptica son aproximaciones; pasar CPU/GLSL no constituye validación clínica.

- `reference-diaphragm-incomplete`: el campo actual comparte dos cúpulas asimétricas e inserción periférica continua entre TS/GLSL, pero no distingue tendón central, pilares ni hiatos. El borde 3D sigue ahora la pared interna del campo corporal compartido; esto no reconstruye las inserciones anatómicas por pieza. Respiración coherente entre consumidores no acredita contactos anatómicos bajo movimiento; véase `anatomy/DIAPHRAGM_AUDIT.md`.

## Identificación automática en el PW renal

- `renal-arterial-dominance-identity`: el estimador automático puede confundir una
  arteria dominante con una vena continua. La ruta de captura rechaza de forma
  conservadora una adquisición renal dominada por arteria en los latidos medidos,
  sin alterar el espectro ni ocultar problemas de calidad previos. Esto limita el
  estimador, no la posibilidad clínica de registrar arteria y vena simultáneamente.
  Una futura identificación fiable de ambas componentes requiere validación
  independiente; no se introduce un patrón desde la fisiología para corregirlo.

## Resolución numérica del volumen PW

- `pw-adaptive-sampling-resolution`: el refinamiento 320→1280 depende del
  calibre máximo del tubo y su peso geométrico frente al ancho lateral del haz.
  No representa una densidad humana de eritrocitos ni garantiza convergencia
  para todo vaso fino o rama procedural. La potencia se conserva en esperanza
  estadística; cambian las realizaciones de speckle. El máximo de cuatro veces
  acota el coste. No resuelve la limitación previa de reclasificación parcial,
  el vaso acompañante fuera de plano ni la separación arterial/venosa.

## Compliance venosa experimental

- `venous-reservoir-compliance-scope`: el factor relativo del laboratorio cambia
  solo C esplácnica y del cuerpo inferior. No cambia tono/volumen no estresado,
  AD, riñón, hígado o VCI. Cada ajuste es otro escenario a PAD basal especificada;
  no representa una venodilatación que conserve el volumen previo. Dominio 0,5–2
  y magnitudes basales son aproximaciones pendientes de calibración clínica.
  [Mecanismo, referencias y ensayos](physiology/VENOUS_RESERVOIR_COMPLIANCE.md).

`color-complex-kernel-estimated`: el kernel complejo del color es procesamiento espacial estimado sobre autocorrelación emulada; no se han validado resolución ni mezcla de velocidades contra clips independientes. Ganancia/interpolación pueden extender color junto a paredes y no se añade máscara vascular para esconderlo.

Corregida `color-absorption-linear-scaling` (174→176): A2 integra α_t(fD) por segmento usando los exponentes tisulares vigentes y conserva hueso/gas/espejo fijos. Continúan el muestreo grueso, la aproximación de barreras y la falta de calibración clínica de coeficientes; no se declara paridad de apertura ni idéntico muestreo PW/color. No hay suelo de transmisión 1e-6.

## Abdomen de referencia (decisión 178)

- `abdominal-atlas-reference-adult`: contornos de superficies de un adulto BodyParts3D 4.0 a 1,5 mm; no TC clínica ni población representativa. Los contactos se reconcilian y sus pérdidas de volumen se registran. Incluir todos los elementos digestivos disponibles no prueba longitud humana ni conexiones de cada asa. La fuente no etiqueta separadamente el sigmoides.
- `abdominal-viscera-internals-estimated`: bazo, capas digestivas, arquitectura renal interna, fascia y gas estático estimados. Sin peristalsis, flujo del contenido hueco ni vejiga distendida; el contorno vesical fuente tiene ~76 ml exteriores. El gas puede interponer reverberación/sombra sobre su luz.
- `abdominal-vascular-branches-estimated`: ejes principales registrados donde hay secciones fuente; conectores y flujos de ramas auxiliares extrapolados. Sin árbol arterial/venoso completo ni conservación en todas las bifurcaciones. Los dos conectores centrales de la arteria esplénica se adaptaron hacia posterior para no atravesar la luz digestiva.
- `abdominal-liver-size-fixed`: el factor de tamaño hepático de los casos anteriores no deforma el adulto fuente; no se simula su hepatomegalia. El contacto normal superior hígado/diafragma usa la cáscara del campo hepático y una transición estimada (179). La transición periférica, hemidiafragma izquierdo, hiatos y relación con corazón todavía deben reconciliarse externamente.
- `abdominal-3d-texture-minimum`: la textura 338×217×280 requiere MAX_3D_TEXTURE_SIZE ≥338, por encima del mínimo WebGL2 de 256. Cada copia del campo ocupa ~82 MB, incluida la del Worker; memoria y latencia en dispositivos pequeños no están validadas. La carga dañada o un dispositivo incompatible falla visiblemente, sin cambiar la anatomía silenciosamente.

- `hepatic-contact-estimated`: el diafragma atlas se apoya en la superficie superior del hígado de este adulto mediante su SDF; no es una segmentación muscular. Dominio independiente auditado: superior z > −45 mm, pendiente < 1, margen al borde proyectado > 13,5 mm, tolerancia de resolución 1,5 mm. No certifica contactos periféricos, patológicos ni respiratorios en toda la superficie. Véase `anatomy/hepatic-diaphragm-contract.md`.
- `hepatic-proximal-veins-partial`: secciones proximales derecha/izquierda de fuente; vena media, conectores y tributarias estimados. Fuente izquierda distal incompatible con el estómago del atlas, conservada como evidencia rechazada. Capacidad de 128 tubos limita las ramas periféricas generadas, sin eliminar vasos principales. Véase `anatomy/hepatic-vein-registration.md`.

- `thoracic-atlas-resolution` (decisión 180): las 24 costillas y 12 vértebras torácicas del adulto registrado sustituyen las elipses, pero el paso de 1,5 mm limita superficies y articulaciones. Distancias a triángulos en banda superficial; cabeza/cuello/tubérculo y torsión conservan la fuente. La prioridad ósea en solapamientos de cartílago y la retirada declarada de fragmentos subcelda son derivaciones, no validación clínica. Faltan cartílagos fuente 8–10, discos torácicos y clavículas/escápulas acústicas.
- `thoracic-atlas-static-respiration` (decisión 180): el esqueleto permanece fijo mientras se mueve el diafragma. No representa aún elevación/rotación respiratoria de cada arco costal.
