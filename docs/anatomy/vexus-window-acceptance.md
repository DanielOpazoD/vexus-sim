# Evaluación y aceptación por ventana VExUS

Revisión local del 7 de octubre de 2026 UTC, decisión 184; base `ff932ee`.
Este documento reúne las correcciones solicitadas y sirve para revisar cada
ventana antes de añadir funciones. Es una evaluación técnica con referencias
clínicas, no el dictamen de un grupo de especialistas ni una validación clínica.

## Reglas comunes

1. Mantener un solo adulto y registro en mm para órganos, vasos, piel, caja
   torácica, plano anatómico y adquisición CPU/GPU. Riñones y psoas deben ser
   posteriores/retroperitoneales; no desplazar vísceras para mejorar un preset.
2. El hígado ocupa su relación fuente con riñón, vesícula y costillas. La cara
   superior contacta el diafragma y la cara parietal derecha se aproxima a la pared
   en su dominio de apoyo. No debe existir una lámina ficticia de mesenterio
   anterior al hígado ni una separación marcada como ascitis en el adulto sano.
   La grasa de la pared y la grasa visceral legítima son compartimentos distintos.
3. La VCI es posterior, a la derecha de la aorta; las VSH desembocan en ella.
   Porta y sus ramas se siguen dentro del parénquima desde el hilio. El trayecto
   extrahepático tiene una función distinta del encuadre lateral intrahepático.
4. Marcador craneal en planos longitudinales abdominales; hacia el lado derecho
   del paciente en el transversal convencional. En el intercostal oblicuo,
   orientar hacia la axila posterior para alinear la huella con el espacio.
   Esto no exige que todos los planos intercostales tengan idéntica orientación.
5. Convexo: cara curva finita, orígenes de líneas sobre ella y sector divergente.
   La posición del transductor 3D, el plano, la escala de profundidad y los
   elementos acústicos deben coincidir. Falta calibrarlo contra un equipo concreto.
6. Gris: parénquima granular, vasos anecoicos, pared portal más ecogénica que VSH;
   cápsula fina, sin rosarios, trazos en X o facetas que provengan de mallas o de
   gradientes discontinuos. La ganancia no debe convertir sangre normal en tejido.
7. Costilla: primero cortical brillante, luego sombra posterior. La sombra puede
   aparecer rápidamente al cruzarla: no debe confundirse con un giro artificial
   del plano completo. Preservar hueso y atenuación, no borrar costillas.
8. Pulmón aireado y artefactos pleurales requieren una vía física torácica. Una
   subcostal transhepática útil no debe estar bloqueada por pulmón superficial.
   Un barrido craneal que abandona esa vía sí puede encontrar tórax; no ocultarlo
   por el nombre del preset. No confundir espejo diafragmático con pulmón real.
9. Color: cubrir luz visible cuando señal, ángulo, ganancia, filtro y PRF lo
   permiten; evitar parches decorativos y color extravascular injustificado.
   Rojo significa movimiento hacia la sonda con mapa convencional; depende del
   haz y la orientación, no de que el vaso sea una vena. Revisar inversión y
   aliasing. Se desea rojo predominante en el encuadre portal solicitado cuando
   su dirección adquirida lo justifique, sin imponerlo a todos los vasos.
10. PW: puerta dentro de luz accesible acústicamente; escala y filtro apropiados,
    ciclos y ECG cuando corresponda. Un objetivo que existe detrás de hueso/gas
    no constituye adquisición válida. No obtener grado VExUS desde etiquetas.
11. Deslizar, rotar, bascular y abanicar debe cambiar el corte continuamente.
    Comprobar salida del vaso, cruce entre costillas y retorno al preset. No usar
    fundidos entre imágenes independientes para disimular errores geométricos.
12. El mapa de estructuras debe usar el mismo perfil corporal y atlas costal que
    el gris. Una demarcación atrasada durante movimiento debe retirarse hasta
    disponer del cuadro correspondiente. El mapa es orientación, no diagnóstico.

## Requisitos por ventana

| Ventana                      | Objetivo y relaciones que deben reconocerse                                                                                                                                              | Apariciones condicionales                                                                              | Señales de fallo en el encuadre útil                                                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subcostal · VCI longitudinal | VCI en eje largo, pared anterior/posterior, hígado como ventana, confluencia de VSH y continuidad cavoauricular al recorrer cranealmente. Confirmar eje central antes de medir diámetro. | Aurícula/corazón en extremo craneal; aorta al abanicar; tórax si se abandona la vía hepática.          | Pulmón bloqueando campo cercano; mesenterio cubriendo hígado; VCI confundida con aorta; sección oblicua utilizada como diámetro.                          |
| Epigástrico                  | VCI y aorta en transversal con columna posterior; relación derecha/izquierda correcta y transición a longitudinal al rotar.                                                              | Páncreas, estómago/duodeno y gas según plano y contenido; no exigirlos todos simultáneamente.          | Riñones contra pared anterior, hueso delante de grandes vasos, aorta/VCI invertidas o intestino como relleno universal.                                   |
| Intercostal derecho          | Hígado y VSH derecha dirigidas a VCI, huella oblicua entre arcos, marcador posterior. Cortical y sombra preceden estructuras ocultas.                                                    | Cúpula y pleura al recorrer cranealmente; riñón al barrer caudalmente; porta en un plano diferente.    | Lámina mesentérica parietal, costillas sin cortical, VSH fuera de hígado, salto global al deslizar una fracción de mm.                                    |
| Subcostal · VSH              | VSH media en parénquima y desembocadura en VCI; distinguirlas de ramas portales. Mantener una vía hepática visible durante ajustes pequeños.                                             | Otras VSH/porta, vesícula o corazón al variar el plano.                                                | Pulmón superficial en vía útil; VSH centrada solo geométricamente pero en sombra; pared portal asignada a VSH.                                            |
| Flanco · VCI                 | VCI coronal posterior al hígado y confluencia venosa al barrer; marcador craneal.                                                                                                        | VSH, riñón derecho y cúpula según altura.                                                              | VCI anterior a la masa hepática o riñón anterior; grasa mesentérica sobre la pared lateral hepática.                                                      |
| Porta · intrahepática        | Rama portal derecha dentro del hígado y trayecto hacia el hilio; paredes periportales brillantes, parénquima alrededor y ramas con calibre decreciente.                                  | Vesícula, ramas portales y VSH en otros cortes. La cava puede entrar al abanicar hacia posterior.      | Predominio del tramo extrahepático; cava persistente por un plano mal orientado; color escaso a pesar de luz y adquisición adecuadas.                     |
| Porta · tronco PW            | Seguir tronco principal/hilio en plano adecuado, con suficiente luz visible para puerta PW. Mantener continuidad con ramas intrahepáticas.                                               | Porción extrahepática proximal y vasos vecinos cuando pertenecen al corte.                             | Confundir este objetivo con exigir que toda imagen sea exclusivamente intrahepática; puerta en pared, cava o sombra; color fijado por identidad del vaso. |
| Renal                        | Riñón derecho posterior, eje largo reconocible, corteza/médula/seno; vena intrarrenal adquirible para PW.                                                                                | Hígado sobre polo superior, grasa perirrenal y pared posterior; arteria renal al ajustar color/puerta. | Riñón anterior, seno usado como luz venosa, desaparición completa por un cambio mínimo no explicado por gas/hueso.                                        |
| Hepatorrenal                 | Hígado anterior al riñón derecho, polo superior y relación de Morison; órganos visibles acústicamente.                                                                                   | Costillas, diafragma al subir y intestino al bajar. Grasa perirrenal pertenece al riñón.               | Espacio libre amplio ficticio en sano, riñón visible solo en mapa detrás de sombra costal, mesenterio entre pared costal y hígado.                        |

## Gris, color y PW que se deben revisar

| Objetivo    | Control de adquisición                                                                                                                  | Criterio hemodinámico y deuda                                                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VCI         | Eje largo central; medir perpendicular a paredes y registrar lugar respecto de VSH, fase respiratoria y caso.                           | La colapsabilidad depende de respiración/sitio. No inferir estado de volumen exclusivamente del diámetro. Validación clínica del contorno y deformación regional pendiente.                    |
| VSH         | Seguir vaso hasta cava, puerta fuera de confluencia, ángulo útil y ECG.                                                                 | Comparar S/D y reversión sistólica desde la señal adquirida. Dirección y anatomía deben explicar signo; no pintar un patrón por caso.                                                          |
| Porta       | Color de flujo continuo según dirección del haz, baja escala venosa cuando corresponda; no confundir aliasing con reversión patológica. | Medir fracción de pulsatilidad sobre ciclos adecuados. La interpretación y referencia de rama/tronco deben declararse. El kernel de color sigue emulado y necesita contraste con clips reales. |
| Intrarrenal | Identificar vena intrarrenal con color, ajustar filtro y puerta, distinguir señal arterial.                                             | Continuo/discontinuo según señal adquirida. Vasos procedurales e imagen cortical interna aún requieren validación externa.                                                                     |

## Registro de comprobaciones y límites

**Verificado técnicamente en esta revisión:** continuidad del marco de contacto
en las nueve ventanas a ambos lados de nudos φ/z; el mismo campo corporal y
costal en el Worker; acceso transhepático central a VCI/VSH sin mesenterio ni
pulmón en los primeros 50 mm comprobados; preservación de cortical/sombra y
ventana hepatorrenal en adulto normal y congestión severa. Esto no certifica
todos los píxeles, todas las respiraciones ni cualquier posición manual.

El control negativo `ff932ee` falla los nuevos criterios de continuidad y
apposición anterior derecha. Antes, el cruce subcostal de 0,001 mm giraba 51,38°.
La normal de una región de contacto de 6,5 mm de semiancho elimina ese salto
puntual sin interpolar imágenes. Es una aproximación de apoyo rígido estimada;
el relieve cutáneo y su gradiente puntual permanecen compartidos CPU/GPU.

La prueba del arrastre real detectó además un salto de presión de 5,74 mm al
deslizar 0,038 mm. El módulo del gradiente utilizado como escala de distancia
también era discontinuo. Se estima ahora con diferencias finitas de ±1 mm
sobre la misma piel. La regresión falla sin esa corrección y pasa con ella;
no se modifica el gradiente acústico ni se funden imágenes. La solución de
presión conserva una tolerancia numérica de 0,05 mm, y el relieve del perfil
corporal sigue siendo estimado: no equivale a una mano o pared biomecánica real.

La VCI longitudinal se centra en el tramo intrahepático: φ1,60/z−40 mm,
marcador craneal y basculación inicial casi neutra. El ajuste previo apuntaba
al extremo torácico con 35° de basculación y sólo 56 % de acoplamiento. La
presencia geométrica de la VCI no justificaba ese campo negro. Se conservan
VCI, hígado, hueso y pérdidas de contacto físicas; se cambia la adquisición.

La apposición pasa en 36 posiciones independientes de la cara anterior derecha
(φ 1,805–2,22; z −83,3 a −37,8 mm), además del dominio lateral previo. Un barrido
anterior más amplio conservado como control detectó tres huecos de 3,29, 8,04 y
9,01 mm hacia el borde inferomedial. **Esos contactos no están cerrados**; no se
declaran conformes ni se esconden cambiando etiquetas. La fuente hepática y su
campo de 1,5 mm difieren: el máximo cruce superficial con la pared ajustada es
0,75 mm; las otras diez mallas auditadas permanecen por dentro.

En navegador se registran barridos de 0,1 mm y movimientos de rotación ±10°,
abanico/basculación ±8° desde las tarjetas reales. El informe local adjunto
identifica capturas, matrices, diferencias CPU/GPU y tiempos observados. Deben
excluirse del cálculo de continuidad los desplazamientos de varios mm entre
vecindarios de nudos. Lecturas de píxeles bloqueantes del banco no son FPS de
uso habitual. No se garantiza una frecuencia universal de cuadros.

**Pendientes para aceptación clínica:** cápsula y ecos puntiformes/estrías frente
a imágenes reales; contactos inferomediales/periféricos y recesos costofrénicos;
respiración completa con todos los grados de sonda; intensidad/resolución/aliasing
de color frente a clips independientes; validación ciega por especialistas;
variabilidad entre adultos. Cada ventana sigue con aceptación clínica parcial.
El corazón, diafragma y compartimentos no segmentados contienen aproximaciones.
Véase también [LIMITATIONS](../LIMITATIONS.md).

## Estado de cada ventana y evidencia que falta

La matriz de movimientos registra las nueve tarjetas, rotación ±10°, abanico y
basculación ±8° en adulto normal, y las nueve entradas en congestión grave.
La prueba de nudos revisa el marco geométrico de las nueve. Una etiqueta en el
mapa no prueba visibilidad acústica; los puntos clasificados y el gris adquirido
se evalúan por separado. Los informes locales `228` conservan las capturas,
poses y controles negativos; el informe de entrega identifica el SHA probado.

| Ventana             | Comprobación técnica específica                                                                                                                           | Deuda para aceptar su fidelidad                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| VCI longitudinal    | VCI e hígado en la adquisición central; ausencia de mesenterio anterior y pulmón cercano en ese dominio; marcador craneal y movimientos de mandos reales. | Contorno y diámetro central frente a vídeo real, continuidad auricular durante toda la respiración.                   |
| Epigástrico         | Aorta/VCI en el corte compartido y movimientos; marcador transversal.                                                                                     | Validar reconocimiento en el gris, páncreas/gas y ramas arteriales; no basta el conteo de tejidos.                    |
| Intercostal derecho | Cortical antes de hueso, sombra adquirida, marcador posterior; mismo atlas en Worker y gris.                                                              | Revisar secuencia completa de cruces de arcos y cortina pulmonar en respiración profunda.                             |
| Subcostal VSH       | Hígado y VSH media centrales sin pulmón superficial ni mesenterio antes del hígado; mandos reales.                                                        | Calibración visual de paredes/cápsula y contactos inferomediales; PW adquirido en todo el abanico útil.               |
| Flanco VCI          | Corte coronal de VCI y cambios de plano registrados.                                                                                                      | Revisar luz accesible, sombras periféricas y continuidad con VSH por toda la respiración.                             |
| Porta intrahepática | Rama en hígado; color rojo, inversión y controles de ausencia de señal probados en atlas.                                                                 | Comparación ciega con clips laterales independientes y resolución/intensidad de color.                                |
| Porta tronco PW     | Tronco e hilio registrados; regresión de profundidad de puerta y señal.                                                                                   | Morfología del tronco/confluencias y espectro obtenido manualmente; una rama no sustituye el lugar de medición.       |
| Renal               | Riñón posterior y eje adquirido en la matriz manual.                                                                                                      | La prueba venosa disponible usa legacy; falta demostrar PW intrarrenal atlas con puerta manual y correlación clínica. |
| Hepatorrenal        | Gris adquirido con ambos órganos y transmisión renal efectiva en normal/congestión; cortical/sombra preservadas.                                          | Morison, contactos y ecogenicidad córticohepática frente a referencias externas.                                      |

Todas permanecen **parciales para aceptación clínica**. La matriz distingue
regresiones técnicas de revisión docente; no atribuye un dictamen a especialistas
que no han participado ni supone fidelidad máxima por tener pruebas verdes.

## Ficha para la próxima revisión

Para cada ventana y caso registrar: versión/SHA, pose completa, transductor,
profundidad/foco/ganancia, respiración, estructuras visibles y bloqueadas,
distancias anatómicas, marcadores, gris, color/PRF/filtro, PW/puerta/ángulo,
movimientos y retorno, capturas/vídeo, testigo independiente y resultado.
Usar `conforme técnico`, `fallo reproducido`, `parcial` o `no evaluado`; no marcar
conforme por la sola presencia de una estructura en el mapa.

Priorizar: corregir un fallo anatómico reproducido → verificar adquisición y
artefactos → comparar externamente → recién entonces añadir funciones.

## Referencias consultadas

- [ACEP Sonoguide: FAST](https://www.acep.org/sonoguide/basic/fast): relaciones
  hepatorrenales, acceso intercostal oblicuo y marcador hacia axila posterior.
- [ACEP Sonoguide: Lung](https://www.acep.org/sonoguide/basic/lung): cortical
  brillante, sombra costal y artefactos pleurales.
- [Beaubien-Souligny et al., 2020](https://link.springer.com/article/10.1186/s13089-020-00163-w):
  adquisición y combinación VExUS; VCI longitudinal subxifoidea y alternativa lateral.
- [Rola et al., 2021](https://link.springer.com/article/10.1186/s13089-021-00232-8):
  aplicaciones, interpretación y contexto clínico.
- La geometría fuente BodyParts3D 4.0, sus hashes y registro común están en
  [procedencia del atlas](ABDOMINAL-ATLAS-NOTICE.md). No convertir el tamaño de una caja
  envolvente en una longitud clínica hepática ni atribuir normalidad poblacional
  a un solo adulto.
