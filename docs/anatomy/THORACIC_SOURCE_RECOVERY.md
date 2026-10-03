# Fuente torácica recuperada y verificada

El 03-10-2026 a las 00:30 UTC la misma URL oficial y ruta de red antes bloqueadas respondieron HTTP 200. Se recuperó el archivo completo de 64.888.505 bytes, SHA256 `9fbc713fffeee924a5a657d9813d84d7eb957bded63adb854931dd5e3eb61c97`, sin cambiar permisos ni eludir restricciones.

## Alcance real

El manifiesto reúne 57 piezas: las 27 requeridas (14 cartílagos 1–7, T1–T12 y diafragma) y las piezas ya conocidas (24 costillas, piel, tres piezas esternales y ambos húmeros de control). Cada entrada tiene concepto, nombre, identificador, tamaño, CRC32 y SHA256. Las etiquetas se contrastaron con `partof_element_parts.txt` publicado por la misma fuente oficial, con hash separado del ZIP. Los cartílagos de las costillas flotantes no se inventan.

Se conserva el registro único LPS→LAS anclado al xifoides y se invierte el winding con la reflexión. No hay escalado o desplazamiento por órgano. El registro mantiene pendientes sus criterios de promoción; verificar bytes no los sustituye. Las mallas no se añaden al runtime ni al navegador en este bloque.

## Reproducir

Con Python, NumPy 2.3.5 y SciPy 1.17.0, y el archivo oficial descargado por una ruta autorizada:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tools/anatomy/thoracic_source.py --archive /ruta/partof_BP3D_4.0_obj_99.zip --labels /ruta/partof_element_parts.txt --output /ruta/nueva/source-report.json
PYTHONDONTWRITEBYTECODE=1 python3 tools/anatomy/thoracic_source_test.py
```

La herramienta exige también la tabla oficial de etiquetas, con hash fijado, y comprueba cada asociación concepto/nombre/elemento. No tiene red ni repara mallas. Rechaza archivos de tamaño/hash diferente, entradas ausentes/duplicadas, nombres que no coinciden con su ID, CRC o hashes diferentes. No sobrescribe evidencia previa. Reutiliza el mismo lector, transformación y oráculo topológico del banco costocondral. La CI ejecuta los oráculos sintéticos en un entorno aislado; la reproducción con el archivo completo fue realizada localmente y se conserva en `thoracic-source-recovery-report.json`.

## Hallazgos que impiden una importación ciega

El diafragma fuente tiene 35.527 vértices y seis componentes de superficie: uno principal y componentes diminutos adicionales. Tras soldar únicamente coordenadas idénticas, el oráculo detecta cuatro aristas no-manifold, sin bordes abiertos. No se borraron piezas pequeñas ni se cerraron huecos automáticamente. Cuerpo esternal y varios cartílagos también tienen componentes adicionales; el informe los conserva.

La cota diafragmática registrada es Z −178,722 a +28,007 mm, incluyendo las prolongaciones caudales, mientras el modelo procedural usa ápices +55/+25 mm y borde estimado. Eso no demuestra patología ni un error universal de esas dimensiones, pero demuestra que combinar esta fuente con órganos procedurales sin reconciliación no constituye un adulto registrado coherente.

## Siguiente integración

Antes de promover geometría: resolver representación y topología de superficies, contactos costocondrales/costovertebrales, inserciones y pasos vasculares, y concordancia de órganos en el mismo marco. Deben verificarse CPU/GPU, cortes, navegador, movimiento y adquisición. Ninguno de esos cierres se infiere de que el manifiesto o sus pruebas pasen.

BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International. [Licencia oficial vigente](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html), actualizada el 27-02-2025. Un adulto de referencia y un atlas reducido, no una norma poblacional ni una validación clínica.
