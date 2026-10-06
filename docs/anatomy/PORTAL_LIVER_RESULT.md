# Resultado local: porta hepática, color y VCI longitudinal

Implementado en `feat/anatomia-ecografica-local`, sin commit ni publicación. Base y main remoto comprobado: `d7f214ff6c4707c25e9d42ec037d0baddb5ec9b5`. Carpeta: `/Users/daniel/Documents/Codex/2026-10-05/task/vexus-sim-anatomia`.

La comparación del usuario mostró que la primera pose candidata todavía seguía demasiado tronco extrahepático. La adquisición final **Porta · intrahepática** enfoca hilio y rama derecha, rodeados de hígado. **Porta · tronco PW** conserva las poses anteriores del vaso principal para medir VExUS, lejos de la bifurcación. El protocolo virtual y las pruebas de IQ nombran ese sitio explícitamente: la nueva vista de rama no se usa silenciosamente como sustituto del tronco.

Esta iteración cambia adquisición y procesamiento de señal. Conserva tamaño y posición de hígado, vasos, caudales, calibres y deformación. El tamaño hepático de la decisión 72 ya superaba sus controles de 140–165 mm en la medioclavicular del adulto procedural normal; no se agrandó para envolver arbitrariamente la porta. El tronco conserva confluencia retropancreática, trayecto hasta el hilio y diámetro de referencia 11 mm. La rama derecha conserva radios nodales 4,5→4 mm y sus bifurcaciones. Son parámetros del modelo, no nuevas mediciones clínicas.

La cava conserva su geometría y sigue apareciendo en otros planos o cuando se dilata. Su menor presencia en el plano hepático deriva de la pose. La ventana existente de VCI en eje largo se reconoce ahora como **Subcostal · VCI longitudinal**, con las poses originales preservadas y los controles previos de llegada a AD vigentes.

## Comparación geométrica

Muestreo de 61 rayos, paso 2 mm, apnea espiratoria a 30 s. «Interior hepático» cuenta muestras visibles de luz en tronco/rama derecha cuyo campo del órgano tiene margen >3 mm, independiente de la prioridad de clasificación. No es una fracción de longitud, volumen, superficie vascular ni contención de toda la pared. Las cantidades cambian con el plano y no certifican exactitud clínica.

| Cuerpo / paciente             | Interior hepático antes | Interior hepático después | Rama derecha antes→después | Muestras de cava antes→después |
| ----------------------------- | ----------------------: | ------------------------: | -------------------------: | -----------------------------: |
| Procedural / normal           |           36/115 (31 %) |             67/67 (100 %) |                      27→58 |                          79→15 |
| Procedural / congestión grave |           86/136 (63 %) |             77/77 (100 %) |                      29→67 |                         217→78 |
| Referencia / normal           |           12/104 (12 %) |             65/65 (100 %) |                       5→57 |                            0→2 |
| Referencia / congestión grave |           64/118 (54 %) |             73/73 (100 %) |                       6→63 |                          64→21 |

La primera predicción de aumentar el número absoluto de todas las muestras hepáticas no se cumple en el procedural grave: 86→77, porque se deja de seguir un tramo largo. El cambio buscado es predominio de rama intrahepática: su proporción y las muestras de rama aumentan. Se documentó esta distinción y se corrigió la métrica. No se convierte ausencia de cava en regla universal. En las cuatro adquisiciones finales la rama derecha no tiene muestras bajo gas/hueso o líneas sin contacto según este instrumento.

Las poses se estimaron mediante ajuste de planos y barridos de rayos del adulto sintético. La prueba de compresión de la nueva pose oblicua compara el desplazamiento profundo con el empuje máximo de la cara, porque la indentación del eje central no acota el talón. Las poses anteriores, incluido el tronco PW, conservan además su banda histórica del 80 %. Monotonía, ausencia de tracción, alcance finito, sombras, transmisión y calidad PW siguen exigidos.

## Alcance de esta integración

Este PR integra únicamente anatomía de adquisición, separación del tronco PW y rótulo VCI longitudinal. Color complejo y preset rojo se entregan en PR posteriores. El contraejemplo hemodinámico de VCI 19,46 m/s continúa pendiente.

Fuentes: [Assavapokee et al., 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC11576717/) y [protocolo UW 2024](https://depts.washington.edu/usrad/wordpress/wp-content/uploads/2024/07/PVT-Abdominal-Doppler-Protocol-7.24-3.pdf). Estas fuentes apoyan técnica, separación de ventana y vasos; no validan las coordenadas estimadas de estos adultos sintéticos.
