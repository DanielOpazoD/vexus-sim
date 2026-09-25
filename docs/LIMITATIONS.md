# Limitaciones

Este documento existe para que nadie use el simulador más allá de lo que hace. Cada punto está
verificado en el código a 21-09-2026 y lleva el identificador que lo declara en
`src/validation/limitations.ts` (la suite exige que ambos coincidan).

## Anatomía y fisiología

- **Solo el riñón derecho tiene vasos interlobares** (`no-left-interlobar-vessels`): el izquierdo
  tiene arteria y vena renal pero no vasos intrarrenales; las 16 pirámides, el seno y la pelvis son
  procedurales (decisiones 37 y 43), sin cálices diferenciados.
- **La presión de aurícula derecha es un contorno prescrito** (`prescribed-ra-contour`): media del
  caso + ondas a/c/x/v/y + onda sistólica por insuficiencia tricuspídea. No hay lazo cerrado; las
  amplitudes (3,4 / 5,2·VD / 1,8 / 2,4 / 9·IT² mmHg) son de calibración, no medidas. Hallado por fast-check: con la aurícula muy rígida (compliancia 0,3) y PAD media ≈ 0 el contorno oscila hasta −11 mmHg y la VCI suprahepática supera 2 m/s (`properties.test.ts`, `it.fails`).
- **Velocidad uniforme a lo largo de cada tubo** (`uniform-vessel-velocity`): el caudal local escala
  con el área; no hay conservación explícita en bifurcaciones.
- **El hígado es una forma procedural** (`procedural-liver-shape`): elipsoides recortados por pared,
  cúpula y plano visceral, con fosa vesicular, impresión renal, fisura umbilical y lámina del
  ligamento venoso; los segmentos de Couinaud son una partición por planos de los vasos (metadatos
  del 3D, no una malla segmentada); los ángulos de las venas y conductos son plausibles, no medidos.
- **Sin cascada torácica de la VCI** (`no-thoracic-waterfall`): la unión cavoauricular transmite
  cualquier caída de la PAD; no existe la meseta de Guyton por colapso de la VCI en la entrada
  torácica. Hallado por fast-check: con hipovolemia (volumen 0,6) y PAD media ≈ 0 la VCI se vacía
  hacia la aurícula a > 100 mL/s y su velocidad supera 2 m/s (`properties.test.ts`, `it.fails`).
  Sí existe el resistor de Starling por debajo de 8 mm y un lumen residual de 3 mm.
- **La VCI es un solo compartimento abdominal** (`ivc-single-compartment`): su diámetro observado
  usa la presión del compartimento entero, no la del segmento a 2 cm de la confluencia; la pulsación
  cardíaca del calibre está amortiguada.
- **Sin movimiento cardíaco transmitido a hígado/cava** (`no-cardiac-tissue-motion`); la
  respiración es el único movimiento tisular.
- **Sin bazo ni costillas izquierdas** (`no-spleen-no-left-ribs`): el hipocondrio izquierdo solo
  tiene riñón y vasos; todas las costillas son derechas (`rightOnly`), así que una ventana izquierda
  no muestra sombras costales. El corte del shader (`sdRib`, `x > 15 mm`) supone que todas lo son:
  `shaderLimits.test.ts` falla si se añade una costilla izquierda sin llevar `rightOnly` al GLSL.
- **La PEEP no tiene efecto hemodinámico** (`peep-no-hemodynamic-effect`): se transmite un 40 % a la
  pleura, pero la PAD se prescribe respecto a la pleural de fin de espiración y la PEEP se cancela;
  con 0, 5 o 15 cmH₂O la PAD, la VCI y los caudales son idénticos. Solo cambia el modo ventilatorio.
- **El índice de resistencia arterial es fijo** (`fixed-arterial-resistive-index`): el pulso arterial
  es multiplicativo y el mismo en todos los casos, así que el IR renal (0,53) y el hepático (0,63) no
  cambian entre casos; además el pulso sube 130–170 ms antes de la R. Medir el IR hoy no enseñaría
  nada.

## Marco de coordenadas

- **El marco anatómico es levógiro** (`left-handed-anatomy-frame`): x = izquierda del paciente,
  y anterior, z craneal. El navegador 3D lo corrige con un grupo espejo (decisión 22); cualquier
  vista nueva que dibuje la escena en un marco dextrógiro debe hacer lo mismo o verá el hígado a
  la izquierda.

## Imagen

- **Sin lóbulos laterales ni de rejilla** (`no-sidelobes`); una luz vascular no recibe ecos de
  reflectores fuera del eje salvo por el grosor de corte.
- **Sin imagen armónica** (`no-harmonics`); el conmutador no existe en la consola.
- **Tienen eco de interfaz los vasos, la vesícula, la cápsula hepática, el diafragma, el riñón, la pleura
  parietal y la pared, pero no el gas intestinal** (`interface-echo-scope`, decisiones 57, 61 y 62): el gas
  intestinal no dibuja su cara (PR 7); se ve por su reverberación y su cola sucia. Las capas de la pared, la
  cortical costal y el pericondrio la dibujan desde la decisión 62; en las copias de la pared bajo la pleura
  (la serie de la decisión 61) las capas llevan un eco analítico de cara plana paralela a la piel, sin la
  cortical ni el pericondrio.
- **El eco de interfaz es solo la parte coherente de una cara lisa** (`interface-echo-coherent-only`):
  sin destellos ni parte difusa de las superficies rugosas (la pleura del diafragma da solo su parte
  coherente, −28,7 dB a 0°, y la parietal −8,9 dB), una cara por estructura y sin signo, sin la cara pared/hígado (misma impedancia) ni la de
  cápsula renal/corteza, y sin interferencia de capa fina. Su nivel sale de K = 55 dB, un valor derivado
  de un plano liso (± 6 dB) que se calibra con GPU dentro de [53; 57] dB.
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
  el reborde es una recta desde el xifoides; las costillas 11.ª y 12.ª no existen.
- **La compresión de la sonda es cinemática, no elástica** (`probe-compression-kinematic`, decisión 63): no hay
  rigideces ni fuerza. La pared entera (con las costillas y los cartílagos) se lleva como una placa de rigidez
  homogénea y el hígado de debajo absorbe la transición; la capacidad de cierre del contacto y la caída en
  profundidad son [ESTIMADO]. El marco es el de la pose: la sonda no se hunde en el tronco, el tejido sube a la cara
  (en un contacto de Hertz se hundiría la sonda y se comprimiría el centro), así que en los bordes del sector el
  hígado bajo la pared se estira a lo largo de la línea hasta 2,5×. Sin histéresis ni viscoelasticidad (la
  deformación sigue a la pose en el mismo cuadro) y sin velocidad del tejido por el movimiento de la sonda (el
  Doppler no ve el arrastre). Los gemelos de imagen de la pared y la pleura (`wallTwin`, `pleuraTwin`) siguen sobre
  el tronco rígido.
- **La compresión solo mueve el tejido a lo largo de las líneas de la cara** (`probe-compression-in-plane`,
  decisión 63): es radial en el plano de la cara (el tejido no se desliza ni se cizalla de lado), plana en
  elevación (la pared no se amolda a la inclinación fuera del plano: con la sonda abanicada las capas conservan esa
  inclinación) y lineal a tramos entre los 32 nodos de la cara. En las líneas muy oblicuas a la pared la placa llega
  al tope de 25 mm y deja de ser concéntrica (el lado de la punta de la subxifoidea basculada; los bordes de la
  intercostal, más allá de la huella). La dirección de la sangre no se gira con la jacobiana (los vasos hondos casi
  no se mueven; los superficiales no existen).
- **Los planos laterales de elevación se saltan los vasos** (`side-plane-skips-tubes`): si el plano
  central está a más de σe + 0,5 mm de una interfaz, los laterales heredan su tejido sin clasificar
  (decisión 24), pero la `bd` del hígado no cuenta los tubos: junto a un vaso fuera del plano, el 1–5 %
  de los píxeles de hígado no ve su borde en elevación.
- **Estadística de speckle sin calibrar** (`speckle-statistics-uncalibrated`): no se ha medido
  célula de speckle, SNR local ni asimetría contra clips reales; los cambios de la decisión 19
  se validaron solo por inspección. Sí se comprueba en la e2e que la envolvente del parénquima
  hepático de una mirada (compuesto apagado) tiene la SNR teórica de Rayleigh (1,7–2,05 medido,
  banda 1,6–2,25): eso descarta defectos de detección, no calibra textura frente a un equipo real.
- **El moteado se submuestrea en las líneas** (`speckle-line-aliasing`): 192 líneas quedan a 0,5–1,5 mm
  (de 20 a 180 mm) frente a un grano lateral de 1,4 mm hasta el foco y 3–4 mm a 15–18 cm, así que en el
  foco apenas hay 1,5 líneas por grano y la pasada D convoluciona un campo muestreado de menos. Mecer la sonda media línea cambia el moteado más que en un equipo (gemelo del
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

## Doppler

- **El aliasing fuerte no se detecta en la captura** (`severe-aliasing-not-detected`): el control
  de calidad detecta el plegado moderado (la sangre toca a la vez los dos bordes de la banda con un
  hueco de ruido entre ambos), pero con la escala más de ~2 veces por debajo de la velocidad el
  flujo llena toda la banda, no queda hueco y se lee a velocidades plausibles: la congestión grave a
  PRF 700 (Nyquist 11 cm/s) sale «leve» con el visto bueno. Lo detectará la retroalimentación
  docente (que conoce la verdad).
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
  Los ganchos de la e2e y la prueba de respiración le pasan `acousticWindowWeight`; las pruebas de
  la cadena del alumno en apnea siguen con la técnica anatómica y una transmisión fija de −10 dB.
  En la app la puerta la pone el alumno.
- **La resolución de las pausas renales depende de la PRF** (`renal-pause-resolution-prf`): la
  verdad cuenta como interrupción una pausa de ≥ 20 ms (decisión 26), lo que resuelve el espectro de
  128 muestras a ~4 kHz. A 1,5–2,6 kHz la captura pierde pausas de 20–30 ms; a 6 kHz ve las de 10 ms.
  Con el filtro de pared muy alto (300 Hz) un valle justo por encima del corte cuenta como línea de
  base y el patrón pasa a bifásico. Los casos actuales no tienen pausas de 10–40 ms.
- **El color es una emulación del estimador** (`color-emulated-estimator`): potencia y fase se
  calculan por celda a partir de la mezcla sangre/clutter/ruido, no de una IQ real por ensemble.
- **Con respiración tranquila la puerta pierde el vaso** (`gate-lost-with-quiet-breathing`): es
  físico solo para vasos finos (el hígado se desplaza 10 mm y una interlobar de 3 mm sale de una
  puerta de 4 mm); el operador debe usar apnea espiratoria o un segmento más grueso, como en la
  práctica. Hasta la 0.5.0 también lo sufrían vasos más gruesos que la puerta (tronco portal: PF
  167 % en el sano) por un defecto del volumen de muestra, ya corregido.
- **Los vasos finos vuelven a la puerta con menos sangre de la real** (`thin-vessel-sample-volume-lag`):
  cuando una interlobar sale de la puerta con la respiración y vuelve, su región queda con menos
  dispersores (30–45 % de sangre frente al 69 % de una siembra nueva en fin de espiración); además
  la reclasificación solo alcanza a un cuarto fijo de la población. Rotarla y reponer la población
  sin más introduce saltos bruscos de amplitud de pared y tejido (30–40 dB sobre la sangre) que el
  filtro de pared no quita: hace falta un control de población con transiciones lentas.
