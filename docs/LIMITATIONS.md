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

## Marco de coordenadas

- **El marco anatómico es levógiro** (`left-handed-anatomy-frame`): x = izquierda del paciente,
  y anterior, z craneal. El navegador 3D lo corrige con un grupo espejo (decisión 22); cualquier
  vista nueva que dibuje la escena en un marco dextrógiro debe hacer lo mismo o verá el hígado a
  la izquierda.

## Imagen

- **Sin lóbulos laterales ni de rejilla** (`no-sidelobes`); una luz vascular no recibe ecos de
  reflectores fuera del eje salvo por el grosor de corte.
- **Sin imagen armónica** (`no-harmonics`); el conmutador no existe en la consola.
- **Estadística de speckle sin calibrar** (`speckle-statistics-uncalibrated`): no se ha medido
  célula de speckle, SNR local ni asimetría contra clips reales; los cambios de la decisión 19
  se validaron solo por inspección. Sí se comprueba en la e2e que la envolvente del parénquima
  hepático tiene la SNR teórica de Rayleigh (1,7–2,05 medido, banda 1,6–2,25): eso descarta
  defectos de detección, no calibra textura frente a un equipo real.

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
