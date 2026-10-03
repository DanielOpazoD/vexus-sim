# Respiración 3D con el campo material compartido

La respiración sigue apagada por defecto. Esta corrección afecta al navegador anatómico cuando
el usuario la activa o selecciona una maniobra. No altera presiones, flujos ni el motor B-mode.

## Problema y solución

La transformación anterior trasladaba todos los órganos y vasos uniformemente. Eso contradice
el peso espacial del propio simulador: la pared, la inserción periférica y la región vertebral
atenúan o anulan el movimiento. Una traslación completa de 10 o 30 mm no conserva esos anclajes.

Ahora los vértices usan `m + D*w(m)*dir`, con exactamente la función de peso y dirección ya
utilizadas por `RespiratoryDeformation`. Se evalúa el peso en reposo, en milímetros LAS; las
matrices anidadas, escalas no uniformes y la reflexión de presentación no cambian ese marco.

Los buffers se crean solo en la primera excursión no nula. Cada actualización parte de las
posiciones originales. Las normales se recalculan sobre la malla deformada y las cotas espaciales
se actualizan. Al volver a OFF se restauran posiciones y normales originales, incluidos ceros
con signo, sin deriva acumulativa. Los rótulos se mueven por su anclaje; no se deforma el quad
compartido de los sprites. Los buffers compartidos en transformaciones diferentes se separan.

## Verificación

- Inserción diafragmática y región vertebral en ambos perfiles, con excursiones de 10/30/3/0 mm
- Coincidencia con el campo directo de la anatomía, error numérico <0,0001 mm en los puntos probados
- Matrices de grupo anidadas, escala no uniforme y reflexión global
- Cien ciclos sin deriva, restauración exacta de posiciones/normales y actualización de cotas
- Geometrías compartidas, sprites y rechazo de pesos/desplazamientos inválidos
- La mutación que restaura peso 1 (movimiento rígido anterior) hace fallar las siete pruebas
- Workflow pareado: controles reales de apnea espiratoria/inspiratoria/espiratoria, mismo caso,
  cámara, capas y viewport. Cada PNG se obtiene congelado a 0/30/0 mm; el regreso a OFF debe
  producir un PNG idéntico al inicial. Revisar también las imágenes intermedias, no solo el hash

Estos límites son contratos numéricos del dibujo con el modelo directo, no precisión clínica.

## Límites y coste

La anatomía sigue siendo procedural y sus relaciones fuente pendientes no se corrigen por
mover la malla. Tampoco se modifica la inversa respiratoria de dos iteraciones del motor ni
se incorpora la compresión de la sonda al navegador. La correspondencia con el campo directo
no demuestra exactitud de toda la cadena ecográfica.

La actualización activa pasa de mover dos grupos a recorrer vértices, normales y cotas. OFF
inicial conserva la ruta sin buffers; las actualizaciones repetidas con idéntica excursión no
recalculan nada. Se conserva el umbral de redibujado existente de 0,3 mm y la liberación de
geometrías retiradas después del primer render del caso nuevo. No se declara un FPS de Metal,
móvil ni navegador real a partir de pruebas CPU o SwiftShader.
