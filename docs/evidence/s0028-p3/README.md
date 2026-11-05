# P3 r1: fuente y contrato offline s0028

**En curso; pendiente de revisión del propietario.** No hay integración de sólidos
P3 en CPU/GPU, validación clínica ni aceptación de láminas en esta ronda.

La fuente es exclusivamente s0028 con marco físico y hashes de P1. Máscaras automáticas
son O, campos derivados D y desconocidos U; ni Gerota, QL aislado, diafragma posterior,
interior renal ni compartimentos de grasa se han trazado. Iliopsoas y autóctonos tienen
identidades de máscara independientes. Los conflictos se conservan sin precedencia.

La grasa compatible D usa [−190,−30] HU en el soporte ≤30 mm, excluye las 117 máscaras
y los candidatos dentro de la envolvente convexa renal. Antes/después de esa exclusión:
108.724/106.839 vóxeles derechos y 124.892/122.583 izquierdos; los retirados quedan U.
Las dos opciones no identifican una fascia ni demuestran un compartimento anatómico.

Paquete exportado y reabierto: 77 páginas, 315.854 B de payload; metadatos contables
P2+P3 3.813/4.096 B; RAW, atlas y tórax +0 B. Descarga real 20.359.991/25.000.000 B,
41.166 B más que P2. Los bits, la tabla y los bytes P2/otras reservas se compararon al
reabrir. [Detalle y hashes](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p3-r1/representation.json).

Las máscaras cervicales C5–C7 tienen vóxeles fuente y no aparecen como etiquetas P1;
su solape focal con ambos iliopsoas es cero, sin implicar que el atlas las contenga.
Cincuenta y tres máscaras focales coinciden bit a bit con sus etiquetas P1: once
sólidos/músculos, 24 costillas, T1–T12, L1–L5 y sacro. Se incluye el quiste izquierdo;
el derecho vacío no prueba ausencia clínica. Diez pares en los campos P1 reabiertos dan 0 vóxeles de solape cada uno; iliopsoas
frente a vértebras torácicas/lumbares también 0/0. El cierre serial y la aceptación del propietario están pendientes. El archivo [mediciones](measurements.json) explicita este límite.
La primera prueba de pared se detuvo al detectar que `inputs` no era la carta final:
frente a `annotation` difieren 74.034 valores de frontera, 11.193 procedencias y hasta
0,70121 por componente de normal. Los tiles reabiertos coinciden con la anotación final.
En un probe de 1.024 centros renales derechos se contaron 0 en banda, 39 conocidos
fuera de banda, 645 U, 306 fuera por la inversa seleccionada y 34 inversiones no
resueltas. Es una muestra parcial; no demuestra la distribución del riñón completo
ni unicidad de la inversa. No se reutilizan las cifras de la carta anterior.

En todos los centros renales con carta final, las cifras D/I son: banda conocida
0/0; conocida fuera de banda 39/238; U dentro del dominio 11.867/13.156; fuera por
la inversa elegida 14.673/14.183; inversa no resuelta 5.506/4.548, respectivamente.
Los totales son 32.085/32.125. La inversa no garantiza unicidad; 0 en banda observada
no certifica ausencia global de choque. Fallos de inversa no se cuentan como U ni fuera.

La GPU deberá usar acceso directo sin bucles P3 ni helpers e inversas precalculadas;
capacidad, cobertura y coste de esas tablas siguen sin demostrar.

[Informe en curso y checkpoint](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p3-r1/report.md).

La segunda lectura usa la proyección EDT directa de P2 sobre el payload exportado:
`superficie = p − torsoDepth(p) · gradiente / |gradiente|²`, coordenadas polares
y profundidad `−torsoDepth(p)`. Una celda conocida exige cuatro esquinas con las
tres fronteras conocidas. Para los centros renales D/I: banda conocida **0/0**;
conocidos fuera de banda 2.744/364; U en dominio 29.340/31.761; fuera de dominio
1/0. Ningún centro tuvo proyección no resuelta; el fuera de dominio corresponde
a la Z proyectada. Este resultado sustituye la inversa anterior para comparar
con el contrato directo P2; U no acredita ausencia de colisión.
[Detalle y hashes](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p3-r1/p2-wall-direct.json).

Se abrieron las 16 láminas finales: diez ventanas vigentes y tres planos por
riñón. El [índice navegable](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p3-r1/review.html)
y los [hashes revisados](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p3-r1/reviewed-images.json)
conservan la lista del propietario sin rellenar. En el coronal renal derecho
aparecen **tres muestras interpoladas** de solape entre SDF hepática y banda
conocida P2, separadas por 0,75 mm en el plano. Son un hallazgo que requiere
resolución o revisión, no los pares de centros de máscaras fuente ni una medición
de volumen. [Testigos](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p3-r1/clash-coronal.json).
