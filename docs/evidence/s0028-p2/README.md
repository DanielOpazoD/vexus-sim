# P2: pared s0028, anotación superficial continua offline

**Pendiente de revisión del propietario.** El candidato `s0028-P2-R1C-surface-v1`,
revisión `logical-surface-v2`, cumple cobertura y gradiente con excepciones costales
fuente enumeradas. No es validación clínica. Esta ronda sólo modifica contratos y
documentación; el trabajo CPU r2a preexistente/concurrente se conserva por separado.

## Cobertura y anatomía

Se leen 92.672 perfiles propios a 0,5 mm, sobre el mismo cero EDT. El gradiente EDT
usa soporte simétrico 13 mm para evitar alternar normales nodales. TAC, 117 máscaras,
resolución y las diez poses permanecen intactos; subxiphoid z−60/rock 0,3/tilt−0,1.
Rejilla 512×181, D=[−210,+60] mm; región anterior/lateral φ[−0,35;3,55],z[−180;0] mm.
Huellas geodésicas de radio 26,5 mm: huella rígida 13 mm más 20 mm de margen.

| Ventana         |  D+E % | Salto med/p95/máx mm | Banda mediana mm | Centro/diseño mm |
| --------------- | -----: | -------------------: | ---------------: | ---------------: |
| subxiphoid      |  91.78 |       0.42/1.30/2.88 |             4.95 |        5.02/6.00 |
| epigastric      |  97.89 |       0.52/1.33/2.88 |             6.52 |        3.67/3.75 |
| intercostal     |  95.71 |       0.78/2.97/5.64 |             9.24 |        8.48/3.00 |
| subcostal       |  93.88 |       0.44/1.62/2.89 |             9.65 |      10.81/11.25 |
| flank           |  98.65 |       0.61/2.11/4.33 |             9.21 |       10.77/9.75 |
| portal          |  92.80 |      0.72/4.22/11.38 |             6.47 |        3.19/9.75 |
| portalTrunk     |  98.49 |       0.59/2.09/3.53 |             9.74 |       10.42/9.75 |
| renal           | 100.00 |       0.44/1.00/2.09 |            10.48 |      10.09/10.50 |
| hepatorenal     |  98.27 |       0.47/1.63/5.52 |            10.83 |       10.03/9.75 |
| portalSubcostal |  95.42 |       0.50/2.22/6.89 |            11.03 |      12.86/12.00 |

D=34446, E=562, U=3470: cobertura global 90.98%≥80%;
diez huellas≥90%. D exige dos fronteras del perfil propio, dentro de incertidumbre
nativa±1,5 mm; E sólo huecos 2D periódicos completos de diámetro físico≤5.782 mm, incluyendo
esquinas bilineales exactas, con al menos tres soportes D. La unión φ=0 se verifica
en el contrato sin TAC; tres E de mitades falsas pasaron a U. El resto queda U. HU no se suaviza.

HU[−29,150] y máscaras fuente separan panículo, complejo y víscera; se cierra sólo
una muestra binaria aislada 0,5 mm. La masa estructural distingue el complejo profundo
de tabiques superficiales. Mediana robusta 2D ajusta confianza; dos superficies
acopladas conservan orden y tope visceral. El esqueleto es material O separado,
nunca músculo ni motivo para borrar toda la geometría parietal.

Salto global mediana/p95/máximo=0.516/2.531/12.00 mm.
Todas las aristas ordinarias≤3 mm. Las 1600 excepciones>3 mm tienen ambos
extremos≤6 mm de perfiles con costilla, esternón o cartílago fuente; máximo 12 mm.
`costal-provenance.json` verifica las 26 máscaras específicas y `continuity.json`
lista cada arista. Dos excepciones de otro hueso se retiraron antes del cierre.
`costal-transitions.png` muestra los ocho peores perfiles y `coverage.png` los localiza.

Intercostal central 8,48 mm frente a 3 mm del diseño: ahora se mide el complejo que
contiene O; los 3 mm del diseño son la primera banda extracostal, no interior intercostal.
Portal central 3,19 mm frente a 9,75 mm: la normal del perfil y la envolvente hepática
fuente delimitan la banda antes del órgano. `thickness-comparison.json` cuantifica
normales, desplazamiento de celda, HU, O y topes; `profiles.png` permite cotejarlos.
Las medianas de huella son magnitudes distintas al centro del diseño. Identidad
alba/rectos/oblicuos/transverso U; fascias/peritoneo U, piel E1,5 mm e interfaz E offset 0.
Intercostal: geometría D/E visible, material U/P8; posterior U/P3, sin anillo renal.

## Comprobación de volumen y presupuesto

La inversa continua usa la banda exportada como semilla y dos respaldos geométricos.
Recupera 100% de los 35008 puntos centrales propios. Un envolvente analítico
de todos los parches contiene todos los puntos posibles de pared; se rasterizan
sus 387,455 vóxeles nativos sin consultar órganos para ocultar conflictos.
Paquete reabierto: invasión visceral 0; envolvente de separación de un vóxel 0;
músculo sobre esqueleto 0; pared posterior 0. Los 9,831 vóxeles óseos y
9,240 cartilaginosos dentro del complejo son material O. Interior intercostal U
20,355 vóxeles. Se corrigió un toque previo del shell bajando controles de pared;
las máscaras no se recortaron. Contactos y bandas<2 mm por órgano: `contacts.json`.
Diez láminas TAC/propuesta a 0,75 mm, mismos puntos físicos y casillas sin rellenar.
U conserva el TAC sin tinte; el contorno violeta señala material intercostal U/P8.

Descarga 20,318,825 B, base 20.152.271 B, incremento 166,554 B≤850.000 B;
metadatos 2,459 B≤4.096 B; payload 757.844 B. Atlas, reserva RAW y tórax+0 B.
Formato RG16F intacto; el negativo torácico+1 B sigue fallando. Ocho estimaciones
estáticas contra techos literales, sin homologar la nueva inversión en GPU/JIT/Metal.
Ninguna evidencia offline equivale a aceptación clínica ni a instalar este paquete.

[Evidencia completa](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p2-r1c/logical-surface-v2/report.md), [review navegable](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p2-r1c/logical-surface-v2/review.html),
[mediciones compactas](measurements.json). Quince imágenes finales abiertas y hashes
en `reviewed-images.json`. Negativos: diez anclas, anillo uniforme, invasión, posterior.
Cierre serial y SHA en `checks.json`, pmset/carga antes y después de cada tiempo.
`s0028-wall_test.py`:13 pruebas sintéticas, sólo biblioteca estándar y numpy; ya figura
en `renal-reference.yml`. Se excluyen explícitamente `diaphragm_relationships_test.py`,
`diaphragm_source_repair_test.py` y `posterior_source_test.py`: CGAL ausente, condición
ambiental preexistente; CI no las ejecuta. No hay agentes ni operaciones remotas.

## Evidencia anterior conservada

R1 y el primer candidato r1c quedan intactos. R1 c anterior tenía 76,57% de cobertura,
salto máximo 28 mm y cinco huellas bajo 90%; no se presenta como aceptado. Sus informes
están en la raíz externa `migration-p2-r1c`; esta revisión vive en `logical-surface-v2`.
R2 a CPU preexistente permanece documentada en [su informe](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p2-r2a/report.md).

## Ronda r2a CPU sobre el paquete v2

El runtime CPU instala logical-surface-v2 conservando formato, poses y default.
Cúpula E/P7 preservada, sin recorte hepático; U explícita, sin normal si el stencil
cruza U. [Diez planos, fracciones U, negativos, presupuestos y códigos seriales](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p2-r2a/report.md).
Las 117 máscaras, mallas fuente y reposo compartido permanecen. La inversa tiene
pliegues:32.108 parches comparados,4 soportes diferentes y7 ramas alternativas,
0 cambios grasa/banda/interior donde ambas conocidas; sin promesa de paridad global.
GPU/Worker/mapa/3D/JIT/Metal son r2b. Decisión 320 aceptada por el propietario el 04-11-2026.

## Ronda r2b: GPU, Worker y 3D con la regla directa

Regla única en CPU, Worker del corte y GPU: proyección `p − τ·∇τ/|∇τ|²`, semilla
polar y carta bilineal; la inversa S−dN queda offline. Los cuatro testigos de
`src/validation/fixtures/s0028-wall-chart.json` conservan la inversa y añaden la
regla directa (|Δ| ≤0,484 mm frontera, ≤0,433 mm profundidad, 3,76 columnas;
tolerancia 0,005 mm contra los valores nuevos). Celda D/E válida a 0, 20 y 60 mm;
celda U inválida a todas. Normal analítica CPU = GPU con la pendiente de las cuatro
esquinas; 17 lecturas por consulta, también con gradiente. GPU por texelFetch: el
filtro trilineal mezclaba el corte z de otra tesela con huecos U en NaN.

Con el HEAD final, en esta máquina (Low Power Mode activo): SwiftShader x64 7/7
(s0028Load, s0028WallGpu, cutMapRafStall, aortaPulse ×4; gpu-ready 55–79 s).
Paridad viva Metal: desacuerdo interior ≤0,002 % (1 px de frontera U), Worker = CPU
100 %, pared 99,83–99,99 %. Pico Metal 1,683 GB en apnea y 1,768 GB respirando
(main 1,789/1,851). Ocho techos especializados dentro, samplers ≤16, JS
1.052.043/1.070.080 B, descarga 20.318.825/25.000.000 B, atlas/reserva/tórax +0 B.
Pliegues de banda 0,35–5,88 % por ventana; quietos al respirar 38 % del hígado y
85 % de la VCI.

Diez láminas TAC/CPU main/CPU r2b/GPU y ecografía real antes y después, abiertas,
casillas vacías. Las ecografías r2b salen negras donde la línea no acopla: el
contacto regional de r2a no acopla sobre celdas U (líneas acopladas: main 1.558,
r2a 1.061, r2b 1.060 de 1.920; portal 11/192). Decisión del propietario en r2c.

[Informe r2b](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p2-r2b/report.md),
[láminas navegables](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p2-r2b/review.html) y
[mediciones compactas](measurements.json). Decisión 320 aceptada por el propietario el 04-11-2026;
sin validación clínica.

## Ronda r2b-U: contacto por piel, cara E de los nodos U y respiración U por rampa

Decisiones del propietario aplicadas (decisión 320, aceptada el 04-11-2026): acoplamiento por piel en todo el dominio; nodo U con
la cara interna E del conocido más cercano a ≤12 mm o sólo piel; respiración U smoothstep(p10, p90, −τ) por fila.
Bloque derivado offline en la reserva de pared tras el payload r1c intacto (`tools/anatomy/s0028-wall-derived.py`,
contrato sintético): mapa E por nodo (contacto, CPU) y rampa por fila (CPU y GPU, columna [0,0,653] del atlas).

Cifras de esta máquina con Low Power Mode: líneas acopladas main/r2b/r2b-U 1.558/1.060/1.607 de 1.920; vértices
quietos hígado 8/59.130 y bazo 4/8.450 (resto 0); costuras 0↔≥0,5 dentro de órganos 0 px; saltos |Δw| ≥ 0,5 en la
frontera D/E↔E 70–398 por plano; paridad Metal con respiración profunda ≤0,043 % (U ≤0,036 %), Worker = CPU 100 %;
pico Metal 1,732 GB respirando (main 1,857); JS 1.058.034/1.070.080 B; descarga 20.393.770/25.000.000 B; ocho techos
dentro; lecturas 17/18. SwiftShader x64 7/7 (gpu-ready 53–61 s; peso respiratorio GPU/CPU |Δw| ≤5,1e-5). Diez láminas TAC/CPU/GPU/cara del contacto/ecografía main y r2b-U abiertas,
casillas vacías.

[Informe r2b-U](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p2-r2b/u-round/report.md),
[láminas navegables](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p2-r2b/u-round/review.html) y
[mediciones compactas](measurements.json) (bloque `r2bU`). Sin validación clínica.
