# Facetas especulares en el marco material comprimido

## Problema y corrección

Las paredes vasculares ya tienen respuestas angulares diferentes: la suprahepática usa un
lóbulo más estrecho que la porta. Este cambio no vuelve a introducir esa distinción ni altera
sus reflectividades, pendientes, rugosidades o espesores.

El defecto estaba en la composición de dos modelos existentes (decisiones 63 y 65). La
normal de la cara se llevaba al mundo con la jacobiana de la compresión; después se añadía
la inclinación de la faceta, que sigue anclada en coordenadas materiales. Mezclar ambos
marcos cambia la incidencia al presionar la sonda.

Para una normal material unitaria n y la inclinación material t, la normal local de faceta es
f = n + t − (t·n)n. Debe transportarse completa: f_mundo = Jᵀf, siendo J la derivada de la
transformación mundo → material. El ángulo del eco se calcula entre f_mundo normalizada y
el haz del mundo. Inclinar Jᵀn después de normalizarlo no da en general el mismo resultado.

El helper TypeScript `facetCosine` admite ahora el Warp existente. Su núcleo GLSL compartido
usa la misma composición. `interfaceEcho` conserva la normal material antes de transformar
la cara media y la entrega al nuevo cálculo de faceta. Las dos pasadas B incluyen ese mismo
núcleo. Sin compresión se conserva la incidencia anterior.

No es un nuevo modelo físico ni una nueva calibración: es la aplicación consistente de la
regla de transporte ya usada por las caras a su normal microscópica estimada.

## Evidencia y pruebas

- Antes del cambio, dos regresiones nuevas fallaban y la identidad pasaba
- Un plano material local independiente se compone con `uncompress`; su gradiente se obtiene
  por diferencias centrales y se compara con la incidencia calculada, en 27 combinaciones de
  posición, orientación y facetas de cava, porta y suprahepática
- La prueba se limita a la franja elevacional plana de la compresión existente, donde se
  define su jacobiana; no usa su cola elevacional como si esa derivada estuviera implementada
- Una deformación afín analítica detecta la regla anterior de inclinar después del transporte
- La identidad comprueba que el modo sin compresión conserva el cálculo previo
- Una prueba WebGL2 compila el núcleo GLSL de producción junto con `warpNormal` extraído de
  su fuente y lo compara con TypeScript en 27 muestras; no usa una segunda implementación GLSL
- Las pruebas E2E ya existentes ejercitan las pasadas completas y sus métricas ecográficas;
  la prueba de kernel no se presenta como validación de toda la imagen

Los resultados y cualquier bloqueo local o remoto se registran en el PR. No se modifican
umbrales, reintentos, tolerancias clínicas ni el presupuesto de tamaño para pasar los gates.

## Relación con la fidelidad ecográfica

La diferente apariencia angular de porta y suprahepáticas tiene fundamento histológico:
la organización de sus paredes influye en su respuesta especular. El estudio de Wachsberg
et al. no atribuye esa diferencia simplemente a una pared portal más gruesa o a grasa
perivascular intrahepática. Aquí esa evidencia motiva conservar una respuesta angular
coherente; no permite deducir el valor de los parámetros del simulador ni valida esta
corrección frente a imágenes clínicas.

Referencia primaria: Wachsberg et al., J Ultrasound Med 1997;16:807–810,
[PMID 9401994](https://pubmed.ncbi.nlm.nih.gov/9401994/),
[doi:10.7863/jum.1997.16.12.807](https://doi.org/10.7863/jum.1997.16.12.807).

## Límites conservados

- La inclinación local y su escala de correlación siguen siendo aproximaciones del modelo
- No se ajusta la rugosidad a la frecuencia desplazada: conserva la calibración nominal
  documentada en la decisión 84
- No se cambia la respuesta difusa, la coherencia de curvatura, el perfil de la cara o la
  detección de incidencia rasante de la superficie media
- Se corrige la compresión de la sonda; no se añade aquí la jacobiana de la respiración
- La comparación matemática y CPU/GPU no acredita equivalencia clínica ni mejoría perceptual
  medida por expertos; eso requiere revisión de imágenes y validación independiente
