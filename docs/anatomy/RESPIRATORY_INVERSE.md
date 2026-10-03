# Inversión respiratoria coherente con el campo directo

## Qué se corrige

El campo directo es `p = m + D*w(m)*dir`. La inversa anterior hacía dos sustituciones,
insuficientes donde el peso cambia rápidamente. En referencia, a 30 mm de excursión, el testigo
material (80; 35; −85) mm volvía aproximadamente a (80; 37,1302; −99,2012) mm: error euclídeo 14,3601 mm.
Esta discrepancia existe dentro del modelo; no es una comparación con un paciente ni un error
medido en la imagen mostrada.

El informe adjunto reproduce 64.239 puntos legacy y 73.243 referencia, para 10 y 30 mm, con paso 5 mm
y filtro de cavidad corporal. Conserva por separado el resultado de las dos iteraciones originales
y el de la bisección. No se desplazan puntos para evitar las zonas difíciles.

## Ecuación y cota

Tras deshacer la compresión de la sonda, `q = uncompress(p)`. Se busca `a` en [0,1] tal que
`a − w(q − D*a*dir) = 0`. Como el peso está acotado entre 0 y 1, los extremos tienen signos
opuestos o son raíces. Se mantienen esos signos durante 14 bisecciones y se interpola una secante, limitada al intervalo final. La distancia a alguna raíz
del intervalo queda acotada por `|D|/16384`:
aproximadamente 0,001832 mm para 30 mm de excursión, antes del redondeo numérico.

Esta cota no demuestra que el campo sea globalmente inyectivo ni que esa raíz sea siempre la
preimagen deseada. Por eso se comprueban además ida/vuelta y paridad en puntos materiales
conocidos. `globalInjectivityProved` permanece false en el informe. La precisión numérica no
se presenta como precisión anatómica o clínica.

OFF evita consultar el peso y devuelve una copia independiente de la coordenada descomprimida.
Los pesos extremos 0/1 conservan sus soluciones exactas. Los demás puntos usan el mismo número
de iteraciones en CPU y GLSL. Una primera versión que devolvía solo el centro del intervalo
falló la prueba pleural heredada: dejaba un escalón numérico de hasta 0,000915 mm. La secante
acotada conserva la cota y evita ese escalón; la tolerancia original de 0,00005 mm se conserva. La compresión se sigue deshaciendo antes de la respiración.

## Datos de escena y GPU

El sampler de datos geométricos se declara highp explícitamente. La norma
[GLSL ES 3.00](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf),
secciones 4.5.4 y 8, distingue la precisión de un sampler de la precisión general de float.
El cambio evita depender de que un driver exceda voluntariamente el mínimo de precisión;
SwiftShader no acredita el comportamiento de un dispositivo móvil concreto.

El workflow `respiratory-inverse.yml` compila la anatomía GLSL real y comprueba puntos de
material conocidos en ambos perfiles, excursiones 0/10/30 mm y con/sin compresión de sonda.
Se conservan los uniforms declarativos y la tabla RGBA32F real. Las entradas mundo se cuantizan
antes a Float32 y esa misma entrada se entrega a la CPU. Umbrales: error material y discrepancia
CPU/GPU menores de 0,002 mm. Cada lote incluye lectura bloqueante en el cronometraje; no son FPS.

## Reproducción

```sh
node --import tsx tools/anatomy/respiratory-inverse-report.ts
node node_modules/vitest/vitest.mjs run src/validation/respiratoryInverse.test.ts src/validation/compression.test.ts src/validation/sceneUniforms.test.ts
node --import tsx tools/fidelity/respiratoryInverseParity.ts
```

La última orden necesita Chromium de Playwright y WebGL2. El resultado de Actions, con el SHA
exacto y sus artefactos, determina si la GPU aprueba; la existencia del workflow no equivale a
una ejecución aprobada. Se mantienen las pruebas funcionales y visuales de la aplicación.

## Regresión funcional descubierta al invertir mejor

La suite completa de la primera versión encontró una regresión real: la captura portal sana
con respiración tranquila aceptaba PF 31,41 % (clase leve), frente a 19,61 % en la verdad de la
ventana larga y 20,35 % en los mismos latidos medidos. La inversa previa daba 28,85 %.
No se conserva deliberadamente una inversa incorrecta para mantener esa semilla ni se cambian
las clases o la tolerancia de 12 puntos de la prueba.

La traza mostraba deriva lenta: en tres de cuatro latidos, el cambio entre extremos equivalía
aproximadamente al 81 %, 90 % y 91 % de la excursión intralatido. Contar una traza presente
no basta para distinguir esa deriva de una pulsación cardíaca repetible. Las recomendaciones
[Decoding VExUS](https://pmc.ncbi.nlm.nih.gov/articles/PMC11576717/) advierten de esta confusión
entre variación respiratoria y cardíaca; no proporcionan un umbral automático validado.

Se añade una guarda **[EXTRAPOLACIÓN PROPIA, no validada clínicamente]** sobre la traza
adquirida, sin consultar caso, amplitud respiratoria ni verdad fisiológica:

- compara las medianas del 10 % inicial/final de valores finitos de cada latido
- considera deriva dominante si el cambio supera el 75 % de la excursión robusta y esta
  excursión supera dos bins de velocidad, evitando atribuir deriva al ruido de cuantización
- requiere al menos tres latidos y mayoría estricta con esa deriva; además, la variación
  de sus niveles iniciales debe superar la mediana de las excursiones intralatido
- si la captura ya era rechazada, conserva el motivo previo; en caso contrario, informa
  «inconsistent» y propone revisar la puerta/apnea. No altera PF, traza ni marcas

La segunda condición distingue una rampa repetible en cada ciclo o una inversión verdadera,
que no deben rechazarse por comparar los lados de una transición rápida. Las pruebas
sintéticas incluyen rampas lentas en ambos sentidos, flujo constante, rampa cardíaca
repetible, pequeña deriva y la inversión verdadera ya cubierta. La cadena heredada admite
este motivo adicional de rechazo, conservando íntegros clase y error máximo cuando se acepta
la medición. Se exige mantener también la cobertura/aceptación de los siete casos y tres
semillas a las cuatro escalas en `examChainScale.test.ts`; no vale rechazar todas las capturas.

## Coste y límites pendientes

La zona de transición requiere más evaluaciones de peso. OFF y los extremos evitan el bucle;
no se promete aceleración global ni se suben presupuestos para ocultar su coste. Se debe revisar
el arranque, la imagen y los tiempos sobre el build final. Los parámetros respiratorios siguen
siendo estimaciones del simulador, y los conflictos anatómicos fuente no se resuelven con esta
corrección de coordenadas.
