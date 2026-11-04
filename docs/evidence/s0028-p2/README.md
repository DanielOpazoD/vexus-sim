# P2 r1c: superficie completa procesada, continuidad pendiente

**Pendiente de revisión del propietario. La anotación continua no está completada.**
ID `s0028-P2-R1C-surface-v1`, base `caca4a6`. Sólo herramientas y evidencia offline.
No hay cambios de producto, poses, resolución ni órganos. No es validación clínica.

La ronda r1 queda intacta en la evidencia externa. Sus 364 celdas D y 62 píxeles de conflicto
se sustituyen como candidato por 92.672 perfiles propios, a 0,5 mm sobre cero y normal EDT común.
La región fija contiene 38.478 celdas: φ[-0,35;3,55] rad y z[-180;0] mm.
La rejilla conserva 512×181 y D=[-210;+60] mm. Las diez huellas usan radio geodésico 26,5 mm.

## Cobertura y espesor medidos

| Ventana         | D+E % | Salto med/p95/máx mm | Banda mediana mm | Centro r1c/diseño mm |
| --------------- | ----: | -------------------: | ---------------: | -------------------: |
| subxiphoid      | 78.77 |              0.5/3/7 |                5 |                  4/6 |
| epigastric      | 91.54 |            0.5/2.5/6 |                7 |             3.5/3.75 |
| intercostal     | 60.43 |              1/4.5/9 |              4.5 |                  U/3 |
| subcostal       | 90.01 |            0.5/3/7.5 |               10 |              8/11.25 |
| flank           | 78.92 |            0.5/3/7.5 |              6.5 |             9.5/9.75 |
| portal          | 67.84 |                1/4/9 |                5 |             1.5/9.75 |
| portalTrunk     | 85.80 |            0.5/3/7.5 |             7.25 |               9/9.75 |
| renal           | 94.90 |              0.5/3/5 |             10.5 |            10.5/10.5 |
| hepatorenal     | 92.51 |              1/3/7.5 |             10.5 |              10/9.75 |
| portalSubcostal | 93.42 |            0.5/3/7.5 |              8.5 |              11.5/12 |

La cobertura cuenta celdas D/E; O no cuenta como músculo. D 28.929, E 535, O 1.950 y U 7.064.
D+E global=76.57% frente a 80%; cinco ventanas superan 90%.
La mediana global del salto es 1 mm, p95 3,5 mm y máximo 28 mm; 2.780 aristas superan 3 mm.
**Fallan cobertura global, cinco huellas y continuidad.** No hay excepciones anatómicas aprobadas.
El detector cambia de corrida en algunos perfiles. `discontinuities.png` muestra ambos extremos.
Estos fallos no demuestran que el TAC haga imposible completar la anotación.

El centro subcostal difiere −3,25 mm del diseño por la normal EDT y la frontera HU del perfil
propio. Portal difiere −8,25 mm al terminar antes del órgano/esqueleto con el margen físico.
`profiles.png` muestra ambos casos. La mediana de huella y el centro del diseño son medidas
distintas; el JSON conserva ambas. Intercostal central U, sin sustituirlo por un vecino.

## Geometría y procedencia

D usa fronteras del perfil propio. Una mediana robusta 2D selecciona corridas existentes;
no suaviza HU. Los outliers quedan U. E interpola huecos cuyo diámetro físico incluye las
esquinas de sus celdas: máximo 5.945 mm. 29 celdas antes E pasan a U al corregir
la estimación entre centros. No se declara cerrado el límite de gradiente de 3 mm.

Conflictos viscerales y esqueléticos: 0 vóxeles. La primera prueba de celda finita detectó 1 visceral y 333 esqueléticos;
se conserva. Se añadió una envolvente fuente de 2 vóxeles viscerales y 1 esquelético, con
residual normal máximo 1,5 mm. Raster nativo del candidato corregido: 5.110.328 vóxeles corporales;
la envolvente de un vóxel se comprueba en 262.733 vóxeles de la envolvente, con 0 conflictos.
El candidato final sólo elimina 29 celdas E. `subset-proof.json` demuestra igualdad de todos
los intervalos retenidos e inclusión exacta; conserva el cero. 124.392 es el recuento medido de
banda del superconjunto, no un nuevo recuento final. Las máscaras fuente se conservan intactas.

`contacts.json` distingue 199 contactos limitados por órgano entre 1.084 celdas con banda <2 mm. Posterior U/P3, sin anillo renal; intercostal
bloqueada/P8. Identidad alba/rectos/oblicuos/transverso U. Piel E 1,5 mm; fascias/peritoneo U.
La interfaz interna E coincide con la cara interna, sin sumar 2 mm hacia la víscera.
Los negativos se recalculan: diez anclas 700 píxeles de invasión; anillo 18–28 mm contradice
28.480 perfiles; invasión y posterior fallan sus contratos. Python 10/10, sin TAC ni CGAL.

## Paquete, límites y reproducción

Paquete reabierto=20.243.190 B, base 20.152.271 B, incremento 90.919 B≤850.000 B.
Metadatos 2160 B≤4.096 B; payload 757.844 B dentro de la reserva. Atlas, reserva RAW y tórax+0 B.
El negativo torácico+1 B sigue fallando. Ocho estimaciones estáticas pasan los techos literales;
samplers≤16, slots≤138. El formato no cambia. El clasificador de prismas finitos y su integración
GPU/contacto/JIT no se homologan. No hay HTTP, memoria pico ni validación clínica nueva.

Evidencia externa: `/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p2-r1c`. `progress.md` permite reanudar cada subpaso; `scripts/` reproduce
perfiles, anotación, pruebas, exportación y láminas. `review.html` navega 15 láminas finales;
17 imágenes abiertas contando las 2 diagnósticas, con hashes en `reviewed-images.json`.
La lista sí/no permanece vacía. [Mediciones compactas](measurements.json).

El cierre serial y sus códigos quedan en `checks.json`, sobre su SHA. `pmset` y carga se
registran antes y después de cada tiempo. El sistema informó `lowpowermode 0` durante esta ronda.
`renal-reference.yml` incorpora `s0028-wall_test.py`, que requiere sólo biblioteca estándar y numpy.
Se excluyen de la ejecución Python local `diaphragm_relationships_test.py`,
`diaphragm_source_repair_test.py` y `posterior_source_test.py`: CGAL ausente, condición ambiental
preexistente indicada por el propietario. No se atribuye a P2. No se ejecutan agentes ni operaciones remotas.
