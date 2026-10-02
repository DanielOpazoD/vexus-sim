# Asas intestinales: modelo, evidencia y aceptación

## Qué cambia

El intestino deja de ser una etiqueta genérica para el espacio entre órganos con bordes dibujados por ruido. Un segmento continuo y representativo de intestino delgado ocupa la región central/izquierda caudal al hígado. Su pared, luz líquida y gas tienen la misma geometría para clasificación CPU, GPU, mapa anatómico y adquisición. La grasa mesentérica se clasifica aparte. El navegador 3D usa el mismo eje, suavizado para ilustración.

El recorrido es una construcción propia estimada, no un atlas, una medición en pacientes ni todo el intestino. Los extremos continúan fuera de la región mostrada. No hay duodeno, colon, apéndice, pliegues mucosos individualizados, vasos mesentéricos o motilidad en esta iteración.

## Fuentes y uso acotado

- [EFSUMB, técnica y hallazgos normales, 2016, doi:10.1055/s-0042-115853](https://doi.org/10.1055/s-0042-115853): distingue las capas e interfaces ecográficas y su dependencia de la resolución. Para discriminarlas bien se necesitan frecuencias superiores a las habituales de una exploración abdominal profunda. Aquí no se dibujan cinco franjas de pantalla: las capas pasan por la PSF existente.
- [Sonographic assessment of the bowel wall, PMID 6784522](https://pubmed.ncbi.nlm.nih.gov/6784522/): observaciones en sujetos normales muestran que la distensión modifica el espesor aparente. No se usa un único espesor como regla diagnóstica.

Radio exterior de 10 mm, pared de 2 mm, recorrido, distribución intramural y bolsillos de gas son elecciones estimadas para un segmento no dilatado. Las fuentes orientan el diseño, no calibran sus coordenadas, la reflectividad o los umbrales del banco.

## Construcción

- Eje poligonal de 51 nodos, coordenadas en mm/LAS guardadas a 0,1 mm. Esa precisión de almacenamiento no es exactitud anatómica
- Unión de cápsulas de radio constante; luz como erosión de 2 mm de su superficie exterior
- Siete grupos de ocho segmentos con esferas conservadoras; el campo exterior se trunca a +5 mm y nunca dibuja una interfaz ficticia desde ese valor truncado
- Dos inclusiones anteriores estáticas de gas, siempre intersectadas con la luz; no se colocan bolsas libres en el abdomen
- Interfaces serosa/grasa y mucosa/líquido. En la pared, muscular y mucosa hipoecoicas y submucosa ecogénica, con transiciones suaves estimadas
- El gas entra en las pasadas de transmisión y en la cola/reverberación intestinal ya existentes; no se finge con un color brillante
- La semilla del moteado cambia la realización del grano, no el eje, los límites de la pared o los bolsillos de gas

La geometría fuente de piel de referencia solo contiene cortes entre −160 y 120 mm. Su extrapolación fuera de ese intervalo sigue siendo una limitación del cuerpo; comprobar que el segmento cabe en ese campo extrapolado no valida su anatomía clínica.

## Contratos de aceptación

1. Espesor y diámetro conservados por la geometría; pared, luz y mesenterio distinguibles por clasificación
2. Gas exclusivamente intraluminal y mayor pérdida de transmisión que al sustituirlo por líquido
3. Muestreo de pared del segmento representado sin invasión de otros órganos o pared corporal en los siete casos, con cuerpo legacy y referencia
4. Normales e interfaces derivadas del mismo campo, con paridad CPU/GPU dirigida a pared, gas y luz
5. Cadena de imagen, composición y equivalencia existentes aprobadas sin rebajar criterios
6. Capturas antes/después de la misma pose y parámetros, con SHAs exactos; revisión visual explícita y coste medido en el mismo runner
7. Presupuesto JS recursivo de 1024 KiB autorizado para este bloque, incluidos todos los chunks, Workers y worklet raíz

La comparación de rendimiento usa tres lotes de tres cuadros por plano, en orden antes/después. Es una observación bajo SwiftShader, sin intervalo de confianza y sin equivalencia a Metal. No demuestra por sí sola fidelidad percibida por expertos.

## Pendiente de validación clínica

El modelo no simula compresibilidad específica de cada asa: acompaña el campo global de compresión. La pared es una aproximación acústica, no histología resuelta en todo corte. Las cápsulas pueden dejar cambios de curvatura en los nodos; la malla 3D suavizada no es una isosuperficie exacta. La motilidad, la gravedad y redistribución de contenido, los pliegues y el tracto completo quedan pendientes.
