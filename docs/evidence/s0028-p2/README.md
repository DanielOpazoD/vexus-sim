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
