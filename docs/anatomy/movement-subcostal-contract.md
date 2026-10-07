# Contrato: movimiento y acceso subcostal (184)

Fecha de evaluación: 2026-10-07 UTC. Base local: `ff932ee`.

Antes de implementar, se reproduce un cambio de eje de 51,38° y de 86,70 mm
en el punto a 100 mm de profundidad al deslizar 0,001 mm sobre el corte z = −100 mm
en subcostal. También hay saltos en las otras ocho ventanas. La causa candidata
es la normal puntual de una piel interpolada por segmentos; una sonda rígida
apoya sobre una región, no sobre la arista infinitesimal de esa representación.

Requisitos y controles de refutación:

- Un deslizamiento infinitesimal que cruce los nudos φ/z no debe girar el plano
  más de 0,1°. Medir los nueve presets, ±15 mm y nudos angulares adyacentes;
  verificar también rotación, basculación y abanico. No aplicar fundidos de imagen
  ni interpolación temporal que oculten una geometría incorrecta.
- La normal de contacto debe derivar de la misma piel que utiliza la adquisición,
  con una región explícita en mm, independiente de FPS y de la ventana elegida.
  Conservar la clasificación y los gradientes puntuales físicos CPU/GLSL.
- En la cara hepática anterior y lateral sin órgano ni costilla interpuestos,
  la pared interna y la superficie hepática deben estar próximas. El umbral de
  ingeniería de 2,5 mm procede del campo de 1,5 mm y su interpolación; no es una
  distancia clínica normal. No cambiar etiquetas para esconder un hueco.
- La grasa mesentérica necesita soporte intestinal. No debe recubrir la superficie
  hepática parietal por ser el tejido residual de un volumen sin segmentar.
- En subcostal dirigido a VCI/VSH, la vía útil debe ser transhepática. Pulmón
  aireado superficial que bloquee esa vía exige revisar pose, contacto y diafragma.
  Un barrido craneal real sí puede salir del abdomen: no prohibir pulmón por nombre
  de ventana ni borrar sombras costales legítimas.
- Conservar órganos, vasos, costillas y registro espacial. Verificar contención de
  mallas fuente y acceso acústico al vaso objetivo, no solo su presencia geométrica.
- En navegador: cuadros realmente adquiridos durante barridos finos y controles
  manuales, tiempos por cuadro, capturas del gris y mapa. Informar FPS y límites;
  continuidad geométrica no equivale a garantizar 30/60 FPS.

El documento de aceptación por ventana debe separar lo esperado, lo condicional,
lo impropio en el adulto sano, evidencia real y pendientes. Las pruebas en Metal
del Mac no sustituyen SwiftShader/CI ni una validación independiente clínica.

## Refutación adicional: presión durante el arrastre

El arrastre real con pasos de 0,5 píxeles detecta otro fallo después de corregir
la orientación. En z −91,9658 → −92,0034 mm, el marco efectivo salta 5,74 mm;
la indentación cambia de 10,32 a 4,59 mm. La distancia de contacto usa el módulo
del gradiente puntual de una piel por segmentos: ese módulo es discontinuo.

Antes de cambiar ese cálculo, se exige que un barrido de 0,01 mm por este
intervalo desplace la cara menos de 0,15 mm por paso. Es un control numérico de
continuidad, no una velocidad o tolerancia clínica. Estimar el gradiente de
contacto sobre la misma piel, con diferencias finitas de semiancho 1 mm, sin
modificar sus ceros, la anatomía ni el gradiente de adquisición CPU/GLSL.
Conservar el cálculo analítico de la elipse legacy y repetir las pruebas de
compresión, lectura de presión y arrastre sin interpolación de imágenes.

La aceptación de apposición es parcial: 36 controles de la cara anterior derecha
(φ1,805–2,22) cumplen el límite, pero el dominio ampliado inferomedial conserva
tres huecos de 3,29–9,01 mm. Se mantienen el contrato y esos fallos; no se toma
el subconjunto favorable como prueba de que toda la superficie cumple.
