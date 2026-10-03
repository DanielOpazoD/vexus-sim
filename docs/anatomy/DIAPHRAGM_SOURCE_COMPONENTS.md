# Componente diafragmático fuente: limpieza explícita y reversible

El bloque de recuperación conservó seis componentes y cuatro aristas no-manifold del OBJ FJ3131. La inspección posterior localizó las cuatro aristas en un satélite plano de ocho triángulos, de unos 0,005 mm de extensión. No pertenecen a la superficie principal.

## Plan fijado a la fuente

`diaphragm-source-component-plan.json` fija el SHA256 del OBJ y enumera los 32 índices originales de caras que forman cinco satélites desconectados. La herramienta solo aplica esa lista explícita: no elige automáticamente la pieza mayor, no corta componentes, no rellena hiatos, no desplaza vértices y no suelda por tolerancia. Las coordenadas idénticas se unifican sin modificar triángulos.

Los satélites suman 0,124743 mm² de superficie y 0,000599707 mm³ de volumen absoluto firmado. Las cotas del plan son controles específicos de esta limpieza, no umbrales anatómicos universales. Las 68.490 caras del componente principal se preservan exactamente, en orden y orientación. El informe retiene cada índice eliminado y su geometría resumida; el archivo fuente original permanece intacto.

## Resultado y límites

El candidato tiene 34.241 vértices únicos, 102.735 aristas y 68.490 caras; no tiene aristas abiertas, no-manifold, orientaciones inconsistentes ni triángulos degenerados según el oráculo. Los enlaces de los 34.241 vértices también forman ciclos únicos, sin pinzamientos puntuales entre superficies. Su característica de Euler es −4 y su género es 3. Esto conserva la topología del componente principal; no identifica por sí solo qué túnel corresponde a qué estructura anatómica.

La superficie y volumen del componente principal no cambian. Esta etapa no comprueba auto-intersecciones. La comprobación posterior encontró seis pares y su reparación local explícita se documenta en [reparación de superficie](DIAPHRAGM_SOURCE_REPAIR.md). Permanecen pendientes el campo de distancia, su representación GPU, precisión, coste y concordancia con órganos. El candidato no se incorpora al runtime ni sustituye al diafragma procedural. No es validación clínica ni cierre de tendón, pilares, hiatos o caja torácica completa.

## Reproducción

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tools/anatomy/diaphragm_source.py --atlas /ruta/piezas-verificadas --output /ruta/directorio-nuevo
PYTHONDONTWRITEBYTECODE=1 python3 tools/anatomy/diaphragm_source_test.py
```

Requiere NumPy 2.3.5 y SciPy 1.17.0. El lector valida el hash fuente y aplica el mismo registro LPS→LAS de las 57 piezas. La salida contiene un NPZ sin objetos Python (vértices LAS, triángulos e índices fuente) y el informe, ambos con procedencia verificable. No se descarga nada y no se sobrescribe evidencia. La reproducción local produjo un NPZ de 826.688 bytes; dos ejecuciones independientes dieron el mismo SHA256, recogido en el informe. Es coste del artefacto offline, no del bundle o transferencia del producto.

CI ejecuta contratos sintéticos que rechazan cortes parciales, eliminación de piezas grandes, índices/planes inválidos, superficies abiertas/invertidas/degeneradas y falsas fusiones por tolerancia. Conserva los oráculos anteriores. Una superficie cerrada no basta para aprobar promoción física.

BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International. [Licencia oficial](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html).
