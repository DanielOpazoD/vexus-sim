# Abdomen común: alcance y reproducción

Decisión 178. Adulto anatómico de referencia; propiedades acústicas, bazo, capas digestivas y ramas entre anclajes son estimados. No es una segmentación de TC ni una validación clínica. Las superficies fuente contienen contactos incompatibles y costuras; las modificaciones derivadas se registran explícitamente.

Los ejes, contornos y tamaños de páncreas, estómago, duodeno, yeyuno, íleon, colon, vejiga, hígado, riñones y vesícula parten de BodyParts3D 4.0. El tramo inferior del elemento denominado «descending colon» en la fuente incluye el asa distal: el atlas no suministra una etiqueta sigmoidea independiente, y no se afirma segmentación específica del sigmoides. Un componente conectado no demuestra longitud completa humana ni ausencia de conexiones entre asas adyacentes. La vejiga fuente está poco llena (~76 ml exteriores); no se representa una vejiga distendida de 200–400 ml.

La caja torácica, diafragma y corazón conservan aproximaciones previas. El contacto hepático superior aún requiere revisión. El compartimento retroperitoneal y la arquitectura interna renal son estimados; ubicar el contorno renal posterior no valida sus pirámides, fascia o dimensiones de todas las regiones internas. El factor de tamaño hepático de los casos previos no deforma este adulto fuente: todavía no se modela hepatomegalia en el atlas. El gas intestinal es estático; no hay peristalsis ni contenido adaptativo. No se asigna flujo al contenido de un órgano hueco.

## Datos y derivación

Ver [atribución/licencia](ABDOMINAL-ATLAS-NOTICE.md) y [manifiesto](abdominal-atlas-manifest.json). Se exige el ZIP fuente SHA-256 `9fbc713fffeee924a5a657d9813d84d7eb957bded63adb854931dd5e3eb61c97` y la tabla `3f5f6df1028eb122b30de77c711597b6bb8e5541658e5985859fd228adbf88ea`.

En un entorno Python aislado: numpy 2.5.3, scipy 1.18.1, trimesh 5.1.1, shapely 2.1.2 y rtree. No son dependencias de navegador. Con los archivos fuente en una carpeta externa:

```sh
python tools/anatomy/build-abdominal-fields.py --source-dir /ruta/fuente --output-dir /ruta/candidato
python tools/anatomy/build-abdominal-body.py --source-dir /ruta/fuente --output-dir /ruta/candidato --reference-body src/anatomy/reference-body.bin
```

Revisar el manifiesto y contactos antes de instalar el candidato. El instalador valida y copia conjuntamente el campo, el perfil corporal y sus manifiestos de la misma carpeta candidata:

```sh
python tools/anatomy/install-abdominal-fields.py --candidate-dir /ruta/candidato
npx tsx tools/anatomy/build-abdominal-surface.ts
npx prettier --write src/anatomy/abdominalAtlasData.ts src/anatomy/abdominalSurfaceData.ts
```

Las superficies 3D se extraen del mismo campo acústico; no se sustituye su forma por otra malla decorativa. El generador rechaza cambios de componentes y pérdidas de volumen >10% en la reconciliación. Los pequeños fragmentos inferiores a una celda de 3 mm quedan enumerados en el manifiesto. Esos límites son controles de derivación y no tolerancias clínicas.

## Recursos y dominios

Campo de 1,5 mm, 82.147.520 bytes sin comprimir, textura RG16F de 338×217×280: el dispositivo necesita MAX_3D_TEXTURE_SIZE ≥338. No se afirma compatibilidad con el mínimo WebGL2 de 256. La carga valida tamaños y SHA-256 antes de construir la escena; un fallo se muestra y no reemplaza silenciosamente la anatomía. CPU conserva half floats; el Worker recibe una copia. Memoria y latencia deben medirse también en equipos con recursos menores.

`?abdomen=legacy` conserva las cohortes anteriores para regresión. Las coordenadas de sus fixtures no describen el nuevo abdomen. El banco abdominal del navegador usa explícitamente el abdomen de producción. Los dos conectores esplénicos centrales se desplazaron 10 mm hacia posterior tras detectar cruce de la luz digestiva en la fuente; esos tramos son estimados y no se presentan como secciones originales. La ubicación vascular principal se registra con secciones fuente; conectores y reparto de flujos de ramas auxiliares son extrapolaciones. No se afirma conservación de un árbol arterial/venoso completo.
