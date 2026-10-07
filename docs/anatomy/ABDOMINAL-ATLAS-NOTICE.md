# Abdomen derivado de BodyParts3D

BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International.

Fuente: [BodyParts3D release 4.0](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html).
Licencia del publicador: [CC Attribution 4.0 International](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html), página actualizada el 27 de febrero de 2025. Los encabezados históricos de algunos OBJ conservan la mención anterior CC BY-SA 2.1 Japan; esta derivación usa la licencia vigente publicada para la base de datos.

Los binarios abdominal-atlas.gzip.bin, abdominal-surface.gzip.bin, abdominal-body.bin, thoracic-atlas.gzip.bin y thoracic-surface.gzip.bin y sus manifiestos son derivados atribuidos de esta base. Su licencia de datos es CC BY 4.0; la licencia MIT del código no sustituye esta atribución.

Transformaciones: registro común LPS→LAS; cierre explícito de bucles de corte abiertos; voxelización a 1,5 mm; reconciliación de contactos declarada en el manifiesto; extracción de superficie del mismo campo acústico. Las superficies BodyParts3D son un atlas anatómico, no verdad de una segmentación de TC. El bazo es estimado y se distingue de los elementos fuente. Las capas y propiedades acústicas no provienen de BodyParts3D.

Las imágenes clínicas AIUM empleadas como referencia no se redistribuyen en este repositorio.

La derivación torácica preserva el registro común y usa distancias triangulares en la banda superficial; el manifiesto `thoracic-atlas-manifest.json` identifica cada elemento, hash y fragmento subcelda retirado. La prioridad de hueso frente a cartílago en intersecciones de la fuente se declara.
