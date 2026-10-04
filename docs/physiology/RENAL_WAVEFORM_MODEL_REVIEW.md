# Revisión del modelo de onda venosa renal

Investigación personal, 2026-10-04. Estado: **no integrado en producción**.
Esta revisión no prescribe tratamiento ni certifica validez clínica del simulador.

## Hallazgo en el código

La velocidad interlobar actual deriva de la misma salida venosa renal global:
Q_interlobar = 0.5 × Q_renal_total × 0.12; u = 1000 Q/A en mm/s. Las tres ramas
representadas usan esa fracción por riñón. Con A = 9.079 mm², el sano en apnea,
tras 30 s de estabilización y durante 10 s, presenta velocidad media de sección
9.22–18.80 cm/s, promedio 14.01. El perfil radial central puede alcanzar 5/3 de la
media antes de proyectarlo sobre el haz. Eso explica por qué una puerta ideal
estrecha y coaxial muestra velocidades mayores que Q/A.

La interlobar no tiene un compartimento independiente de drenaje. El modelo no
puede identificar por separado amortiguación distal, transmisión proximal y
compliance del parénquima. El 12 % y los parámetros de la red son aproximaciones,
no valores medidos de este adulto virtual. Cambiar la escala no identifica cuál
aproximación explica una diferencia con una captura clínica.

## La normalidad no equivale a una línea plana universal

La figura 9 del capítulo renal de EFSUMB muestra una vena interlobar continua
bajo cero junto a una arteria con PSV 29.8 cm/s. Es una referencia morfológica
útil, no una distribución poblacional de velocidades venosas. La figura 10 es
pediátrica y no se usa para calibrar el adulto.

Jeong et al. estudiaron 164 voluntarios sanos y 58 pacientes con nefropatía
diabética: el VII fue menor en interlobares que en segmentarias y el grupo control
presentó VII 0.38 ± 0.18. Nijst et al., con solo seis controles sanos, observaron
VII basal 0.2 ± 0.2 y 0.3 ± 0.1 tras expansión de volumen, sin cambio significativo.
No deben convertirse esas medias en un umbral universal ni combinarse sin revisar
población, rama, respiración y técnica de medición.

La tabla 2 de Kudo et al., verificada en el PDF completo del repositorio
institucional, informa FVOR interlobar derecha 0.55 ± 0.08 en 39 controles;
la izquierda es distinta. Se recuperó el PDF mediante su URL institucional actual
y se inspeccionó la figura 1, teniendo en cuenta la corrección de su leyenda.
Ese dato refuta que un valor próximo a 0.5 sea necesariamente patológico. La
comparación inicial con imágenes más planas justifica estudiar la adquisición;
no basta para cambiar la fisiología basal.

## Compliance: evitar una perilla con efecto universal

Deben distinguirse C = dV/dP, distensibilidad C/V, presión transmural, presión
intersticial, resistencia y compliance de la aurícula/ventrículo derechos.

Bateman y Cuganesan encontraron menor índice de impedancia venosa en el riñón
obstruido que en el contralateral (0.38 frente a 0.80) y mayor velocidad pico;
su hipótesis involucra menor compliance intraparenquimatosa. Kudo et al. también
hallaron menor oscilación en diabetes. Eso impide asumir que toda rigidez renal
produce la misma modificación que una elevación de la presión auricular derecha.
El sitio de la compliance y de la presión externa importa.

## Prototipo exploratorio, no solución publicada

`tools/fidelity/renalReservoirPrototype.ts` separa un compartimento proximal y
un reservorio de drenaje, conectados por resistencias e inercias. Lo impulsan
caudal arterial y presión de cava del motor vigente, sin realimentar esa circulación.
Mantiene dV_prox/dt = Q_art − Q_inter y dV_ven/dt = Q_inter − Q_main.

Una exploración de 18 combinaciones (tres casos, tres compliances venosas y dos
proximales) conserva el balance numérico a aproximadamente 1e-11 mL. Algunas
combinaciones amortiguan la oscilación distal del sano y mantienen oscilación grave
con congestión. Eso es una prueba de mecanismo matemático, **no identificación de
parámetros humanos**. Una primera discretización abandonó el dominio admisible
presión-volumen en congestión; cambiar inicialización/subpasos resolvió esa corrida,
pero todavía falta un estudio de convergencia y estabilidad sobre todo el dominio.
No se adopta la combinación que produzca la imagen más atractiva.

El volumen sanguíneo estimado por RM tampoco determina la compliance: Tofts et
al. comunicaron una fracción vascular de 34 % en ROIs parenquimatosas de 15
voluntarios, dependiente del modelo y de parámetros fijados. No equivale a volumen
venoso aislado ni proporciona directamente dV/dP para este reservorio.

## Criterios antes de implementar una nueva fisiología

1. Definir dónde se mide cada caudal y qué territorio drena cada rama; conservar
   el flujo renal total y contabilizar explícitamente las ramas no representadas.
2. Separar validación numérica (masa, unidades, convergencia, continuidad) de
   validación fisiológica (presiones/volúmenes plausibles, variabilidad normal y
   respuesta a intervenciones) y de validación de adquisición (ángulo, PSF,
   puerta, filtro, PRF, aliasing, ruido).
3. Contrastar cohortes y ejemplos independientes. No convertir controles de una
   cohorte pequeña, embarazadas, animales o pacientes obstruidos en adulto basal.
4. Examinar PAD, presión abdominal, función VD, IT y compliances de distintos
   compartimentos por separado y combinadas. No codificar un grado VExUS dentro
   de las ecuaciones ni usarlo como señal espectral.
5. Validar ventanas anatómicas reales y el cuerpo de referencia. El prototipo de
   ventanas da tres capturas útiles en el sano de referencia con 50/30/30 cm/s,
   pero el cuerpo legacy presenta aliasing renal a 30. Con 40 cm/s el contrato
   normal pasa también en legacy; ese ajuste de adquisición no calibra velocidades
   ni declara resuelta la fisiología renal.
6. Mantener el visor en revisión clínica mientras se contrastan estos puntos.
   Las correcciones numéricas independientes del PW sí pueden verificarse e
   integrarse sin declarar resuelta la calibración del visor.

## Fuentes

- EFSUMB Course Book, Ultrasound of the renal vessels, 2024, figura 9:
  https://efsumb.org/wp-content/uploads/2024/03/ECB2ndUpdate-2024-CH-41-Vascular-Renal.pdf
- Jeong et al., 2011, doi:10.1002/jcu.20835:
  https://pubmed.ncbi.nlm.nih.gov/21544829/
- Nijst et al., 2017, doi:10.1016/j.jchf.2017.05.006:
  https://www.jacc.org/doi/10.1016/j.jchf.2017.05.006
- Kudo et al., 2017, doi:10.1007/s10396-017-0770-0:
  https://pubmed.ncbi.nlm.nih.gov/28150225/ ; tabla institucional:
  https://eprints.lib.hokudai.ac.jp/repo/huscap/all/71770/J%20Med%20Ultrason_44%284%29_305-314.pdf
  Corrección de la leyenda de figura 1: https://pubmed.ncbi.nlm.nih.gov/29063420/
- Bateman y Cuganesan, 2002, doi:10.2214/ajr.178.4.1780921:
  https://pubmed.ncbi.nlm.nih.gov/11906873/
- Tofts et al., 2012, doi:10.1007/s00330-012-2382-9:
  https://pubmed.ncbi.nlm.nih.gov/22415410/
