# Registro del navegador 3D con el campo anatómico

Este bloque corrige dos divergencias reproducidas en la geometría que muestra el navegador.
No modifica el clasificador, la fisiología, las ventanas ni las imágenes ecográficas.

## 1. Medio voxel omitido en la transformación

La muestra del campo en el índice i está en `lo + size*(i+0,5)/res`. Three.js 0.186.1
emite el nodo i en `2*i/res−1`; el código anterior aplicaba escala `size/2` y traslación
`lo+size/2`. El resultado quedaba en `lo+size*i/res`, medio voxel por debajo de su
coordenada de muestreo en **cada eje**.

La corrección añade `size/(2*res)` a la traslación. Conserva las muestras de entrada,
triángulos, resolución y normales. Afecta a todos los órganos extraídos por este helper:
la malla vuelve al espacio de su propio campo, sin trasladar la anatomía física.
En el hígado normal el error previo era 2,390625 mm por eje. No era un detalle de iluminación.

Las pruebas usan seis planos analíticos: x/y/z, resoluciones 12/28 y caja no cúbica.
El fallo previo mide 3,333333 o 1,428571 mm según resolución; el límite de aceptación sigue
siendo 0,0001 mm. Este límite es numérico para un plano interpolable exactamente, no precisión
anatómica de las mallas ni del simulador.

## 2. El techo hepático tenía una fórmula distinta

El constructor restaba el espesor de la lámina a la altura vertical del diafragma. El
clasificador y el margen vascular usan distancia corregida por la pendiente. En pendientes
pronunciadas, esos dos recortes son diferentes aunque ambos invoquen la misma altura.

Se sustituye la copia de tres fórmulas por `-scene.liverInteriorMargin(p)`. La misma función
ya incorpora contorno hepático, pared y distancia diafragmática. Una prueba inyecta un margen
plano conocido, comprueba las 64³ consultas y verifica la posición final de todos los vértices.
En la base no había ninguna consulta a ese margen: la prueba fallaba antes del arreglo.

El error geométrico de discretización sigue existiendo: compartir un campo no significa que
cada triángulo plano reproduzca exactamente una superficie curva. El modelo diafragmático
procedural, especialmente sus pendientes periféricas, tampoco sustituye una segmentación.

## Evidencia y límites

- Siete regresiones nuevas: todas rojas en la base, verdes tras la corrección
- Fisura umbilical y escotadura hiliar: pruebas originales conservadas, sin bajar umbrales
- Capturas pareadas del canvas 3D real, misma cámara y viewport, perfiles legacy/referencia,
  capas completas y piel/ventanas ocultas por los controles existentes
- CI completa, presupuesto y ausencia de errores de consola deben aprobarse antes de merge
- La captura es del navegador anatómico; no se presenta como mejora de textura B-mode ni
  como integración del diafragma fuente o del tórax completo
- Se conserva el movimiento uniforme previo de los grupos 3D durante respiración; su relación
  con el campo de deformación espacial sigue requiriendo un bloque específico

Implementación fuente del convenio nodal: `node_modules/three/examples/jsm/objects/MarchingCubes.js`,
versión fijada en el lockfile. La corrección vive en el transformador propio; no se modifica Three.
