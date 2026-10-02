# Banco offline de la unión costocondral bilateral

La separación publicada del séptimo par corresponde al campo aproximado, aunque las piezas originales comparten un único registro rígido al xifoides. Una elipse por lado que cierra un vértice no conserva la superficie de unión. Esta investigación **no cambia runtime, adquisición, medición, materiales, poses, presupuesto ni precedencia acústica**; las candidatas se descartan para integración.

## Oráculo y procedencia

Sólo se usan cinco archivos ya disponibles: hueso derecho FJ3346 e izquierdo FJ3234, cartílago derecho FJ3345 e izquierdo FJ3255, piel FJ2810. Cada lectura verifica SHA256; no hay descargas, credenciales, DNS, subprocesses ni red en los scripts Python. Registro LPS origen [−0,3152345, −205,92635, 1164,5735] → LAS [0,85,25,0], reflexión de y con winding invertido. Se conserva la asimetría de lados.

Fuentes existentes: [inventario original](reference-source-manifest.json), [perfil corporal y registro](reference-skin-source.json), [cartílago publicado](reference-cartilage-source.json), [pares originales más próximos](source-costochondral-distances.json) y [alcance incompleto](REFERENCE_TORSO.md). Los datos numéricos derivados mantienen atribución **BodyParts3D, © The Database Center for Life Science (DBCLS), CC BY 4.0**. La fuente original es el archivo release4 identificado en el inventario; no se volvió a solicitar al dominio pendiente. Esta PR no incorpora OBJ, capturas ni archivos personales.

Las distancias entre vértices originales más próximos son 0,013454 mm derecha y 0,030083 mm izquierda: cotas superiores de la distancia mínima entre superficies, no separación uniforme ni tolerancia clínica. En esos vértices, el campo óseo publicado da +4,462492/+9,501169; el cartílago publicado +0,959937/+0,876703. Un valor del campo aproximado **no es distancia euclídea exacta**.

## Diseño del banco

[La herramienta](../../tools/anatomy/costochondral_bench.py) cubre todas las piezas bilaterales con todos sus vértices usados y centroides de todas sus caras; no elimina componentes pequeños ni posiciones coincidentes. Las estadísticas no ponderadas por área describen ese muestreo; no equivalen a Hausdorff exhaustivo ni a precisión anatómica.

1. Fuente → campo: distancia punto/triángulo exacta a una triangulación del nivel cero candidato, incluidos ambos discos de extremo. Se registran también residuos del campo para mostrar cuándo dejan de representar distancia física.
2. Campo → fuente: vértices y centroides de la triangulación candidata contra todos los triángulos originales. La poda por centroide + radio máximo es conservadora: ninguna cara capaz de mejorar la cota del vértice más cercano queda fuera.
3. Región de unión completa observada: todos los vértices originales a ≤0,03/0,1/0,5 mm de la otra superficie. Son bins descriptivos de proximidad geométrica, **no umbrales anatómicos**. Se consulta el campo propio y opuesto en ambos lados. El complemento `costochondral_contacts.py` agrega las distancias geométricas propias/opuestas en todos los vértices y centroides de caras de esas bandas, a ambas resoluciones.
4. Conectividad: componentes, aristas y volúmenes orientados de cada malla original; sólido y espacio libre en la caja de la región de unión a pasos 0,5 y 0,25 mm, con vecindades 6 y 26. «Espacio libre» es el complemento hueso/cartílago en esa caja, no luz vascular. Se cuentan cruces entre caras de caja, solapamiento de sólidos y líneas de rayos ambiguas. La caja incluye dos voxels gruesos de margen computacional. Las separaciones de centésimas de milímetro quedan subvoxel: este banco no demuestra su continuidad topológica exacta.
5. Piel: rayos completos por triángulos a x,z fijos; sólo con dos intersecciones anteriores se comparan cara exterior e interior. La normal radial local no demuestra contención global. Holguras en y y residuos radiales se distinguen de distancia euclídea.
6. Convergencia: repetir la triangulación con 64 y 128 muestras angulares/circunferenciales, conservando todos los nudos del perfil; se informa el residuo de la propia triangulación y el cambio entre resoluciones. No ocultar los máximos ni aceptar una candidata sólo por P95 global.

La malla fuente funciona como **oráculo geométrico observado**, no como verdad clínica. La incertidumbre de malla/registro no está cuantificada y queda pendiente.

## Reproducción local y segura

Requiere Python, NumPy y SciPy ya instalados; la corrida registrada usa NumPy 2.3.5 y SciPy 1.17.0. No se añaden dependencias al navegador. Pasar una carpeta local con los cinco OBJ cuyos hashes constan en el código; las salidas deben ser nuevas. Los scripts no sobrescriben entradas ni assets del repositorio.

```bash
PYTHONDONTWRITEBYTECODE=1 python tools/anatomy/costochondral_oracle_test.py
PYTHONDONTWRITEBYTECODE=1 python tools/anatomy/costochondral_fit.py --atlas /ruta/local/atlas --output /ruta/salida/candidata.json
PYTHONDONTWRITEBYTECODE=1 python tools/anatomy/costochondral_bench.py --atlas /ruta/local/atlas --candidate docs/anatomy/costochondral/bounded-ellipse-candidate.json --output /ruta/salida/banco64.json --baseline-points /ruta/salida/puntos64.json
PYTHONDONTWRITEBYTECODE=1 python tools/anatomy/costochondral_bench.py --atlas /ruta/local/atlas --candidate docs/anatomy/costochondral/bounded-ellipse-candidate.json --angular 128 --circumference 128 --output /ruta/salida/banco128.json --baseline-points /ruta/salida/puntos128.json
PYTHONDONTWRITEBYTECODE=1 python tools/anatomy/costochondral_contacts.py --atlas /ruta/local/atlas --candidate docs/anatomy/costochondral/bounded-ellipse-candidate.json --output /ruta/salida/contactos.json
npx tsx tools/anatomy/costochondral-baseline.ts /ruta/salida/puntos64.json /ruta/salida/campo-publicado.json
```

Los cinco contratos sintéticos comprueban distancias de cara/arista/esquina, rayos sobre aristas compartidas, paridad de una capa con cara interior, distinción entre componente superficial y volumen encerrado, conectividad diagonal de voxels, y nivel cero/cierre de extremos y selección de lado. El ajuste reproduce la candidata descartada: centros acotados por caja de corte, ejes por diámetro observado, penalización de exceso de caja, vértice nativo restringido y 16 cortes adaptativos por pieza. Esos pesos son parámetros de optimización investigativa, no calibración clínica. El snapshot publicado permite repetir el banco independientemente del optimizador; cualquier nuevo ajuste necesita pasar el banco completo.

## Hallazgos preservados

El cartílago derecho original tiene un componente principal y tres componentes diminutos separados: dos próximos al extremo anterior y uno con x positivo, al otro lado del cuerpo. Los tres consisten en pares de caras sin volumen encerrado. Se conservan en las métricas y se reportan explícitamente; «vértice usado» no garantiza pertenencia a un sólido anatómico. El máximo fuente→candidata de aproximadamente 62,77 mm proviene del componente opuesto; no se confunde con error de la región de unión principal ni se borra del informe. Es una métrica por etiqueta de pieza: el conjunto bilateral se mide aparte y ese fragmento también puede quedar próximo a una pieza de etiqueta izquierda.

La candidata restringida cierra el vértice elegido a <0,001 mm de residuo, pero en las regiones originales próximas a ≤0,03 mm el P95 del campo opuesto alcanza 3,277 mm derecha y 2,607 mm izquierda. Las vistas de cortes originales mostraron una región de interfaz, no sólo un punto. La distancia geométrica bilateral conjunta con triangulación 128 tiene P95 fuente→candidata 1,725 mm y candidata→fuente 1,404 mm, con máximos 3,473/3,807 mm. Al pasar de 64 a 128, esos P95 cambian −0,031/+0,039 mm: estabilidad numérica de ese muestreo, no aceptación anatómica. Los cinco contratos sintéticos pasaron y los cuatro perfiles se reprodujeron sin diferencia de parámetros; ninguna sección agotó el solver sin converger.

En la banda original de proximidad ≤0,03 mm, el muestreo incluye 130/101 puntos derechos de hueso/cartílago y 115/78 izquierdos. Con triangulación 128, los puntos del cartílago original tienen P95 de distancia **geométrica** al hueso candidato de 2,238 mm derecha y 2,487 mm izquierda, con máximos 2,739/2,719 mm. Esa región observada sigue desplazada aunque se cierre un anchor. Estos valores se distinguen de los residuos del campo aproximado anteriores.

A paso 0,25 mm, el solapamiento hueso/cartílago pasa de 113 a 2235 voxels en la caja derecha y de 84 a 1165 en la izquierda; son volúmenes muestreados, no intersecciones exactas. El sólido candidato derecho cambia de 1 a 2 componentes con vecindad 6 al refinar 0,5→0,25 mm, mientras conserva 1 con vecindad 26. El espacio libre también cambia de componentes al refinar: el diagnóstico no concede una continuidad subvoxel.

El banco de sólidos registra mayor solapamiento candidato y cambios de conectividad dependientes de resolución: no hay base para aceptar una unión local por el resultado de un anchor.

En los 3988/3681 puntos originales de cartílago (vértices usados + centroides, con posiciones coincidentes), 154/147 están entre caras de piel. Tres muestras derechas cruzan el exterior, hasta **0,043317 mm en y**; ninguna izquierda lo cruza. La holgura exterior mínima izquierda es 0,057368 mm. Se preserva como discrepancia observada, con **incertidumbre de malla/registro pendiente**, sin convertirla en tolerancia clínica ni desplazar piel/cartílago para eliminarla. No se afirma una búsqueda exhaustiva de intersecciones triángulo/triángulo.

Ambos cartílagos abarcan z aproximadamente −62..22 mm, dentro de los cortes corporales −160..120 mm. No interviene clamping por altura. El frente del perfil publicado de 8 cortes/64 radios difiere del original en y hasta −2,555..+0,763 mm derecha y −2,466..+0,732 mm izquierda: interpolación declarada, no otro registro rígido.

Los [resultados completos](costochondral/) incluyen parámetros candidatos y medidas; no son pruebas clínicas ni validación Metal. Las capturas originales inspeccionadas quedan en el checkpoint local, sin afirmación de entrega Library.

## Decisión técnica y costo antes de runtime

El banco no sustenta integrar las primitivas elípticas ensayadas. Una sustitución por lados limitada a la caja podría conservar algebraicamente el campo exterior mediante peso cero fuera de ella, pero conserva los errores del candidato dentro y exige verificar las costuras y conectividad del nuevo nivel cero. El ajuste ya falla ahí; mezclarlo no reconstruye la superficie observada. Se detienen modificaciones geométricas sin otra hipótesis fundamentada. Una representación futura necesitaría preservar el contorno/interfaz fuente y justificar la partición de los componentes singulares; todavía no se selecciona ni implementa.

Cuatro perfiles ×16 filas ×6 parámetros = 384 valores: 1536 bytes Float32 (1514 bytes gzip6 sólo para transporte) o 3072 bytes Float64, excluyendo metadatos, CPU/GLSL, gradientes y malla. El esquema de dos vec4 por fila consumiría 128 vec4 más metadatos, frente a 50 vec4 de cola fija disponible: no cabe en ese layout. Una cola dinámica tras las seis parejas existentes tendría 166 vec4, pero requeriría contratos nuevos de capacidad/layout y coherencia; no está implementada ni se acepta por este cálculo. El margen JS del head 132 es 3280 bytes (1037104/1040384); estos datos no prueban que código+decoder+GLSL quepan. No se aumenta ningún límite.
