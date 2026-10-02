# Asas intestinales: modelo, evidencia y aceptación

## Qué cambia

El intestino deja de ser una etiqueta genérica para el espacio entre órganos con bordes dibujados por ruido. Un segmento continuo y representativo de intestino delgado ocupa la región central/izquierda caudal al hígado. Su pared, luz líquida y gas tienen la misma geometría para clasificación CPU, GPU, mapa anatómico y adquisición. La grasa mesentérica se clasifica aparte. El navegador 3D usa el mismo eje, suavizado para ilustración.

El recorrido es una construcción propia estimada, no un atlas, una medición en pacientes ni todo el intestino. Los extremos continúan fuera de la región mostrada. No hay duodeno, colon, apéndice, pliegues segmentados de un paciente, vasos mesentéricos o motilidad en esta iteración.

## Fuentes y uso acotado

- [EFSUMB, técnica y hallazgos normales, 2016, doi:10.1055/s-0042-115853](https://doi.org/10.1055/s-0042-115853): distingue las capas e interfaces ecográficas y su dependencia de la resolución. Para discriminarlas bien se necesitan frecuencias superiores a las habituales de una exploración abdominal profunda. Aquí no se dibujan cinco franjas de pantalla: las capas pasan por la PSF existente.
- [Sonographic assessment of the bowel wall, PMID 6784522](https://pubmed.ncbi.nlm.nih.gov/6784522/): observaciones en sujetos normales muestran que la distensión modifica el espesor aparente. No se usa un único espesor como regla diagnóstica.

Radios exteriores de reposo entre 7,6 y 10 mm, pared radial nominal de 2 mm, crestas mucosas de hasta 1,2 mm con periodo de 8 mm, recorrido, distribución intramural y bolsillos de gas son elecciones estimadas para un segmento no dilatado. Las fuentes orientan el diseño, no calibran sus coordenadas, la reflectividad o los umbrales del banco.

## Construcción

- Eje poligonal de 51 nodos, coordenadas en mm/LAS guardadas a 0,1 mm. Esa precisión de almacenamiento no es exactitud anatómica
- Uniones independientes de campos de serosa y luz, radio variable interpolado con smoothstep. Las crestas mucosas entran en la luz: no son brillo añadido ni se dibujan fuera de la pared. Los 2 mm son espesor radial nominal fuera de crestas; no se afirma espesor normal constante en curvas o uniones
- Siete grupos de ocho segmentos con esferas conservadoras; el campo exterior se trunca a +5 mm y nunca dibuja una interfaz ficticia desde ese valor truncado
- Dos inclusiones anteriores estáticas de gas, siempre intersectadas con la luz; no se colocan bolsas libres en el abdomen
- Interfaces serosa/grasa y mucosa/líquido. En la pared, muscular y mucosa hipoecoicas y submucosa ecogénica, con transiciones suaves estimadas
- El gas entra en las pasadas de transmisión y en la cola/reverberación intestinal ya existentes; no se finge con un color brillante
- La semilla del moteado cambia la realización del grano, no el eje, los límites de la pared o los bolsillos de gas

La geometría fuente de piel de referencia solo contiene cortes entre −160 y 120 mm. Su extrapolación fuera de ese intervalo sigue siendo una limitación del cuerpo; comprobar que el segmento cabe en ese campo extrapolado no valida su anatomía clínica.

## Contratos de aceptación

1. Espesor radial nominal fuera de crestas y diámetros de reposo acotados entre 15,2 y 20 mm; pared, luz y mesenterio distinguibles por clasificación
2. Gas exclusivamente intraluminal y mayor pérdida de transmisión que al sustituirlo por líquido
3. Muestreo de pared del segmento representado sin invasión de otros órganos o pared corporal en los siete casos, con cuerpo legacy y referencia
4. Normales e interfaces derivadas del mismo campo, con paridad CPU/GPU dirigida a pared, gas y luz
5. Cadena de imagen, composición y equivalencia existentes aprobadas sin rebajar criterios
6. Capturas antes/después de la misma pose y parámetros, con SHAs exactos; revisión visual explícita y coste medido en el mismo runner
7. Presupuesto JS recursivo de 1024 KiB autorizado para este bloque, incluidos todos los chunks, Workers y worklet raíz

La comparación de rendimiento usa tres lotes de tres cuadros por plano, en orden antes/después. Es una observación bajo SwiftShader, sin intervalo de confianza y sin equivalencia a Metal. No demuestra por sí sola fidelidad percibida por expertos.

## Pendiente de validación clínica

La decisión 102 añade una respuesta local cuasiestática: cada nodo reduce su radio hasta 18 % según el desplazamiento de contacto muestreado en el eje de referencia (factor estimado 0,012 por mm). Al retirar la carga recupera exactamente el calibre de reposo. Esta contracción radial se añade al campo global de compresión; no modela aplanamiento anisótropo, volumen conservado, histéresis ni presión intraluminal. No actualiza el muestreo de carga con el movimiento respiratorio individual. La pared es una aproximación acústica, no histología resuelta en todo corte. Las cápsulas pueden dejar cambios de curvatura en los nodos; la malla 3D suavizada no es una isosuperficie exacta. La motilidad, la gravedad, la redistribución de contenido, los pliegues específicos del paciente y el tracto completo quedan pendientes. El navegador 3D muestra los calibres de reposo, no la respuesta local a carga ni la mucosa interna.

## Geometría y coste de la decisión 102

Los radios se calculan una vez por cambio del contacto y se comparten como Float32 entre CPU y textura GPU. El eje guarda su abscisa en el componente antes libre de cada texel; otro texel por nodo contiene el radio de carga. Los offsets anteriores no cambian y se conserva el número de filas mientras quepa en el presupuesto de textura. El radio máximo no supera los 10 mm del bloque previo, manteniendo las envolventes conservadoras. El gas se intersecta de nuevo con la luz, sin desplazarlo artificialmente fuera de ella.

La distancia de interfaz conserva el valor del campo y su gradiente completo: el eco normaliza con su norma. Las distancias de seguridad del clasificador se dividen por dos para no sobrepasar los pliegues. La gradación y compresión no representan material clínicamente calibrado.

La comparación incluye un plano transversal con lift −6 mm y el mismo ajuste en la base. Su propósito es mostrar el efecto combinado global/local; la prueba de radios aísla el componente local y su restitución. Las fuentes EFSUMB justifican evaluar capas, pliegues y respuesta a compresión; no proporcionan los coeficientes elegidos aquí.
