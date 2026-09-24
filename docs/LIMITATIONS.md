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
- **Solo tienen eco de interfaz las caras de vasos, vesícula, cápsula hepática, diafragma y riñón**
  (`interface-echo-scope`, decisión 57): las fascias de la pared, las costillas, la piel y el gas
  intestinal no dibujan su cara (PR 6 y 7); se ven por su moteado y su sombra.
- **El eco de interfaz es solo la parte coherente de una cara lisa** (`interface-echo-coherent-only`):
  sin destellos ni parte difusa de las superficies rugosas (la pleura da solo su parte coherente, −28,7 dB
  a 0°), una cara por estructura y sin signo, sin la cara pared/hígado (misma impedancia) ni la de
  cápsula renal/corteza, y sin interferencia de capa fina. Su nivel sale de K = 55 dB, un valor derivado
  de un plano liso (± 6 dB) que se calibra con GPU dentro de [53; 57] dB.
- **La coherencia de curvatura solo la tienen los tubos** (`interface-curvature-tubes-only`): vesícula,
  riñón y cúpula son localmente planos para el eco. Sin la curvatura elevacional del riñón, Morison salía
  ~1,5 dB más brillante que en el diseño (gemelo: 2,23 frente a 2,08 sobre el hígado a 0–20°); la s de la
  cápsula renal, la cara que da su pico, pasa de 0,21 a 0,25 y lo deja en 2,17.
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
