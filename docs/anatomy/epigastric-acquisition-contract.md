# Adquisición epigástrica transversal registrada

**Defecto.** La pose atlas de `a37cdfe` corta aorta/VCI aproximadamente a
10 cm pero antepone gas intestinal a ambos rayos; la imagen base no permite
reconocer las relaciones epigástricas. El banco estático lo reproduce a 30 s.

**Mecanismo.** Cambiar únicamente el punto de partida y orientación de esta
adquisición atlas, manteniendo órganos, vasos, gas, cortical y transmisión.
La búsqueda geométrica orienta candidatos; la aceptación requiere render real.
No se modifica la variante legacy ni la referencia anterior.

**Predicción y dominio.** En el adulto registrado normal y congestivo con
apnea espiratoria, la entrada más craneal transmite a aorta y cava por hígado;
la aorta queda posterior a la cava, delante de la vértebra. El marcador
transversal apunta a la derecha del paciente. Son criterios de adquisición
para esta anatomía, no dimensiones clínicas calibradas de una población.

**Invariantes.** Mismos hashes anatómicos y ajustes a 30 s. Se conservan gas,
sombras e interfaces; ninguna estructura se desplaza o se suprime por ventana.
Se distingue la apariencia basal del comportamiento de poses vecinas.

**Refutación.** Gas/hueso/pulmón ante un vaso requerido, corte tangencial,
imagen sin luz reconocible, relaciones invertidas o cambios en geometría
fuente invalidan el ajuste. Mantener los ensayos rechazados, el estado de
contacto y la identidad del cuadro. Un conteo de etiquetas no lo acepta.

**Aceptación.** Capturas antes/después con vaso y referencia vertebral
identificables; rayos centrovasculares sin barrera, hígado anterior y contacto
efectivo, dos casos y exploración de vecinos. El criterio geométrico de 20 mm
de hígado excluye el trayecto sin ventana hepática del defecto, no prescribe
un grosor humano. La inspección interna queda diferenciada de revisión externa.

Referencia de técnica/relaciones: [ACEP FAST](https://www.acep.org/sonoguide/basic/fast).
La calibración de apariencia y la cápsula segmentada siguen pendientes.
