# Reflexión del espejo pleural bajo deformación

## Error que se corrige

A0 clasificaba posiciones materiales recuperadas del mundo, pero aplicaba
`reflect` directamente a una normal material. Con respiración no uniforme o
compresión, ese plano no tiene la misma orientación en el mundo. B ya transportaba
sus gradientes desde la decisión 116; A0 necesitaba la misma composición.

La normal mundial es la dirección de J inversa transpuesta por n material,
con respiración primero y compresión después. Se normaliza antes de reflejar:
r = d − 2 (d·n) n. La especificación de GLSL requiere una normal normalizada:
https://registry.khronos.org/OpenGL/specs/es/3.2/GLSL_ES_Specification_3.20.html#geometric-functions.
No se modifica la posición del impacto ni el número de bisecciones.

## Pruebas independientes y rápidas

- Dos perfiles corporales, desplazamientos 0/10/30 mm, con y sin contacto real
- Superficies materiales planas deformadas; el oráculo diferencia numéricamente
  el campo escalar completo evaluado con `toMaterial`, sin usar `warpNormal`
- Rayos oblicuos, dirección reflejada, norma unitaria y una sola evaluación del
  transporte por impacto; contadores exigen casos que cambien con la corrección
  y casos con compresión y respiración simultáneas
- Reintroducir la normal material hace fallar ambos perfiles; no se amplía el
  límite de error de dirección de 0,003 para aceptar esa mutación
- Equivalencia exacta del camino TS rígido, incluidos los contratos pleurales
  anteriores, y comprobación de conexión del núcleo en A0
- Banco WebGL2 existente: las mismas 54 incidencias de facetas y tres componentes
  de reflexión por muestra, con el núcleo GLSL de producción y límite 3e−6

## Coste acotado

El transporte se evalúa solo al encontrar el primer espejo de cada línea.
La implementación actual de compresión es analítica. La guarda de compilación
permite esa única llamada condicionada y rechaza duplicarla, quitar su condición,
ponerla en un bucle interior o introducir cualquier otra jacobiana en el bucle.
Las cotas de clasificación, el presupuesto de JavaScript y los plazos no aumentan.
La compilación y el tiempo por cuadro deben revisarse en los artefactos de GPU y
comparaciones visuales de ambos perfiles, con respiración OFF e inspiración.

## Alcance

Los gradientes numéricos son un oráculo matemático del modelo, no una validación
clínica. La normal del mediastino conserva su aproximación previa y el diafragma
sigue siendo procedural. No se modifica la atenuación para ocultar sombras ni se
ajusta ganancia para compensar un camino reflejado incorrecto. La fidelidad visual
se juzga separadamente con capturas reales del renderizador del SHA publicado.
