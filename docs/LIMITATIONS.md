# Limitaciones

Este documento existe para que nadie use el simulador más allá de lo que hace. Cada punto está
verificado en el código a 21-09-2026 y lleva el identificador que lo declara en
`src/validation/limitations.ts` (la suite exige que ambos coincidan).

## Anatomía y fisiología

- **Solo el riñón derecho tiene vasos interlobares** (`no-left-interlobar-vessels`): el izquierdo
  tiene arteria y vena renal pero no vasos intrarrenales; las pirámides y el seno son procedurales
  (3 ángulos × 4 posiciones), sin cálices ni pelvis diferenciados.
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
  se validaron solo por inspección.

## Doppler

- **El color es una emulación del estimador** (`color-emulated-estimator`): potencia y fase se
  calculan por celda a partir de la mezcla sangre/clutter/ruido, no de una IQ real por ensemble.
- **Con respiración tranquila la puerta pierde el vaso** (`gate-lost-with-quiet-breathing`): es
  físico (el hígado se desplaza 10 mm), pero un vaso de 4 mm sale de una puerta de 4 mm; el
  operador debe usar apnea espiratoria o un segmento más grueso, como en la práctica.
