# P3: sólidos y compartimento posterior s0028 (321)

**Pendiente de revisión del propietario.** r1 dejó la fuente y el paquete offline; r2 integra la
clasificación en CPU y Worker. La GPU y su paridad son r3; r4 propone, sin instalarla, una anotación del interior
renal desde el propio TAC. Sin validación clínica.

## r4: interior renal candidato (offline, sin runtime)

TAC en fase portal venosa sin contraste excretado; ruido ≈ 19 HU por vóxel. La máscara O renal no contiene el seno
(profundidad interna 12,5/12,2 mm dcho./izq.; 45/27 vóxeles < −30 HU, a ≤ 2,1 mm del borde). Con la EDT de la envolvente
acolchada (el borde de la caja es exterior), el seno es la componente de cavidad, no reclamada por otra máscara, que
contiene el vóxel más profundo (el hilio) y llega a 3 mm: 5.113/5.136 vóxeles; las concavidades someras no son seno.
Separables: grasa del seno D y luz del colector D (orina sin contraste); corteza/médula sólo como hipótesis E (déficit
profundo 27/25 HU, d′ por vóxel 1,43/1,33, 4,5/4,2 σ tras suavizar 1,5 mm). U: boca hiliar < 3 mm del exterior de la
envolvente (1.330/996 vóxeles), vasos y bordes del seno.

Exportador `tools/anatomy/s0028-renal-interior.py` (r4c), payload `a23b4a77…` reproducible byte a byte e igual con numpy
2.5.3 y 2.5.4 (sustituye a `ed757c70…`). Volúmenes dcho./izq. (cm³): corteza E 89,2/90,2; médula E 18,5/18,1; seno graso
D 3,3/5,2; colector D 2,5/2,1; U 9,6 %/8,0 % del dominio máscara ∪ seno. Contrato sintético 14 pruebas, 26/26 mutantes.
Empaquetado medido, no instalado: 46 páginas (188.416 B) tras la grasa P3, reserva de pared 1.633.526/2.113.536 B,
+12.366 B gzip, descarga 20.445.310 B; descriptor 612 B frente a 308 B de margen: compactar los descriptores P2
(−1.194 B). Pendiente r5: grasa de concavidades someras (52/122 vóxeles, hoy U) a grasa compatible D del paquete P3.
[Informe r4](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p3-r4/report.md) ·
[láminas y seis casillas](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p3-r4/review.html) ·
[mediciones](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p3-r4/measurements.json).

## r2: CPU y Worker

El paquete r1 escribía la grasa desde 4096+757.844 B, donde P2 final guarda el bloque derivado
E+rampas: se reexportan los mismos bits (SHA deac8eb8…) tras ese bloque, con páginas comprobadas
contra campos P1, EDT, teselas, centros y rampas; P2 y su derivado no cambian. Descarga
20.433.526/25.000.000 B (+39.756), manifiesto 38.309/38.617 B, metadatos 3.788/4.096 B.

`s0028Owners` reúne todos los dueños antes de cualquier orden; dos son conflicto, U y conservados.
Riñón: borde D, interior U, sin vasos procedurales dentro; quiste izquierdo líquido E; grasa D.
Se retiran en s0028 la arquitectura renal, el estiramiento W, la grasa perirrenal/Gerota y el
ligamento venoso analíticos de la otra persona. En la caja renal, main daba 2.734 puntos U como
tejido renal o perirrenal; ahora 0. Las láminas pasan de 75.008 muestras inventadas a 0.

El solape hígado/pared de r1 es real: 4 vóxeles hepáticos y 2 esplénicos dentro de la banda
directa P2, ≈11,3/5,8 mm³ a 0,25 mm; se conserva como conflicto. Censo global a 1,5 mm: 693
puntos en conflicto (483 grasa D+banda, 136 hueso+cartílago, 31 intestino+vesícula, 18
intestino+páncreas, 11 pulmón+banda, 5 intestino+riñón, 5 hígado+banda, 4 bazo+banda).

Default = main 3c50b18 (82.251 puntos, 10 marcos, 30 contactos), 38 programas GLSL iguales,
CPU = Worker 245.760/245.760 píxeles, contacto s0028 idéntico, 12/12 mutantes, JS 1.061.578 B.
La compresión P2 heredada desplaza y deforma hueso (≤19,4 mm) y riñón (≤12,3 mm), y la
respiración vigente no conserva la forma renal; r2 no los cambia. Vasos procedurales de la otra
persona cruzan sólidos s0028 (P5). [Informe r2](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p3-r2/report.md) ·
[láminas](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p3-r2/review.html) · [códigos](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p3-r2/closure.json).

## r1: fuente y contrato offline

No hubo integración de sólidos P3 en CPU/GPU, validación clínica ni aceptación de láminas en r1.

La fuente es exclusivamente s0028 con marco físico y hashes de P1. Máscaras automáticas
son O, campos derivados D y desconocidos U; ni Gerota, QL aislado, diafragma posterior,
interior renal ni compartimentos de grasa se han trazado. Iliopsoas y autóctonos tienen
identidades de máscara independientes. Los conflictos se conservan sin precedencia.

La grasa compatible D usa [−190,−30] HU en el soporte ≤30 mm, excluye las 117 máscaras
y los candidatos dentro de la envolvente convexa renal. Antes/después de esa exclusión:
108.724/106.839 vóxeles derechos y 124.892/122.583 izquierdos; los retirados quedan U.
Las dos opciones no identifican una fascia ni demuestran un compartimento anatómico.

Paquete exportado y reabierto en r1: 77 páginas, 315.854 B de payload; metadatos contables
P2+P3 3.813/4.096 B; RAW, atlas y tórax +0 B. Descarga real 20.359.991/25.000.000 B,
41.166 B más que P2 (cifras sustituidas por las de r2, que recoloca el paquete tras el bloque derivado P2). Los bits, la tabla y los bytes P2/otras reservas se compararon al
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
