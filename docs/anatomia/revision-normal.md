# Anatomía y ecografía abdominal normal: revisión para el simulador

Revisión con fuentes (25-09-2026) pedida por el dueño: «falta que hagas una revisión extensa de anatomía y ecografía
normal abdominal y seguir mejorando el modelo». Reúne lo que el modelo debe cumplir, con cifras, y la brecha actual
frente a cada punto. La hicieron cuatro revisores independientes sobre fuentes abiertas (Radiopaedia, PMC,
RadioGraphics y AJR en resumen, libros de texto con vista previa, guías POCUS y VExUS); las cifras marcadas **[E]**
son estimaciones geométricas derivadas de valores publicados, no datos medidos. Las referencias están al final de
cada sección. Marco del modelo: levógiro, x = izquierda del paciente, y = anterior, z = craneal (origen en la línea
media a la altura de la punta del xifoides).

Convención de pantalla abdominal (la del simulador): con el marcador craneal, lo craneal queda a la izquierda de la
pantalla; en transversal con el marcador a la derecha del paciente, la derecha del paciente queda a la izquierda.

## 1. Ventanas VExUS habituales y preferidas

El protocolo (Beaubien-Souligny 2020) mide cuatro cosas: el diámetro de la VCI y el Doppler pulsado de una vena
hepática, de la porta y de las venas interlobares del riñón. Koratala 2024 recomienda hacerlo casi todo desde la
**ventana lateral derecha** con movimientos pequeños (un «nodo» común).

| Ventana                            | Sonda, posición, orientación                                                     | Profundidad         | Estructuras clásicas                                                                   | Qué se mide                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| VCI, eje largo subxifoideo         | Convexa; 1–2 cm bajo el xifoides, paramediana derecha; sagital; marcador craneal | 14–16 cm [E]        | Hígado, VCI que entra en la AD, diafragma, VHM desembocando, caudado                   | Diámetro máximo a ~2 cm de la confluencia de las hepáticas           |
| VCI y aorta, transversa epigástr.  | Epigastrio; transversal; marcador a la derecha del paciente                      | 10–15 cm            | Cuerpo vertebral con sombra; aorta redonda sobre él; VCI oval a su lado; celíaco y AMS | Forma de la VCI (oval o redonda) y diámetro                          |
| VCI coronal lateral («rescate»)    | Axilar anterior–media derecha; coronal; marcador craneal                         | 16–20 cm [E]        | Hígado, diafragma, VCI horizontal y la aorta paralela más honda («doble cañón»)        | Diámetro laterolateral (no intercambiable con el AP)                 |
| Vena hepática, lateral (preferida) | Axilar media, 8.º–9.º espacio [E]; coronal; marcador hacia la axila              | 14–18 cm [E]        | Diafragma; VHD o VHM que convergen hacia la VCI                                        | PW a 1–2 cm de la VCI, con ECG, ángulo < 60°                         |
| Vena hepática, subxifoidea         | Subxifoidea sagital, o subcostal oblicua («conejo»)                              | 14–16 cm [E]        | VCI, VHM y AD; o las tres hepáticas convergiendo                                       | PW de la VHM a 1–2 cm                                                |
| Porta, lateral (preferida)         | Axilar media, ~3 cm anterior o caudal a la ventana hepática; coronal oblicua     | 12–16 cm [E]        | Porta de paredes brillantes a 7–11 cm, roja; VCI detrás; arteria hepática al lado      | PW de la porta principal; fracción de pulsatilidad                   |
| Riñón derecho (preferida)          | Axilar posterior (o media, 10.º espacio); coronal en eje largo; marcador craneal | 12–16 cm y zoom [E] | Hígado arriba a la izquierda; riñón de 9–12 cm con el polo superior a la izquierda     | PW en una interlobar (arteria arriba y vena abajo), escala < 20 cm/s |

Listas de comprobación de cada imagen canónica (adulto de complexión media, [E]):

- **VCI subxifoidea:** hígado en los primeros 5–6 cm; VCI anecoica de pared fina casi horizontal (±15°) con la pared
  anterior a 6–9 cm; en el tercio izquierdo el diafragma y la entrada en la AD, con movimiento cardíaco; la VHM entra por
  la cara anterior a 1–2 cm de la AD; calibre que varía con la respiración salvo en la congestión. No debe verse un vaso
  de pared gruesa, pulsátil, con ramas anteriores o fuera del hígado (sería la aorta).
- **Transversa epigástrica:** vértebra en el centro de la base con sombra; aorta redonda (≤ 2,5 cm) y pulsátil justo
  delante de ella, algo a la derecha del centro de la pantalla; VCI oval a la izquierda de la pantalla con hígado
  delante; hacia caudal salen el celíaco y la AMS de la cara anterior de la aorta; hacia craneal las hepáticas
  convergen en la VCI.
- **VCI coronal lateral:** hígado hasta ~10 cm, diafragma a la izquierda; VCI horizontal a 11–14 cm que recibe hepáticas
  y sigue a la AD; aorta paralela a 14–17 cm, de pared gruesa y pulsátil.
- **Vena hepática lateral:** vena de pared casi invisible, lo más vertical posible hacia la VCI; azul en color; S y D
  bajo la línea base y A por encima; al menos 3 ciclos con ECG.
- **Porta lateral:** porta de 10–13 mm con paredes brillantes, roja y continua (15–40 cm/s); VCI más honda; arteria
  hepática al lado con aliasing.
- **Riñón derecho:** hígado arriba a la izquierda; corteza a 3–6 cm y seno a 5–8 cm; interlobares radiales entre las
  pirámides, casi paralelas al haz en la mitad superficial; arteria sobre la línea base y vena continua bajo ella.

Errores frecuentes: efecto cilindro (el corte excéntrico infraestima), confundir la aorta o el caudado con la VCI, medir
en modo M (la cava se traslada ~2 cm con la respiración), confundir hepática y porta (la porta tiene paredes gruesas
ecogénicas y va al hilio; la hepática no tiene pared visible y va a la VCI).

Referencias: Beaubien-Souligny 2020 (PMC7142196) y 2018 (PMC6404886); Rola 2021 (PMC8214649); Assavapokee, Rola y
Koratala 2024 (PMC11576717); Koratala et al. 2024, Cardiorenal Med; Koratala y Reisinger 2022 (PMC9190062); Prager 2023
(PMC10373747); Andrei 2023 (PMC10249288); Finnerty 2017 (PMC5391901); Beltramino 2025 (PMC12658576); POCUS101 (VExUS y
aorta); ACEP Sonoguide; NephroPOCUS 2024; Renal Fellow Network 2020.

## 2. Hígado

| Parámetro                                | Valor normal                                                                                       | Fuente                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Craneocaudal en la línea medioclavicular | 14,0 ± 1,7 cm (hepatomegalia > 15,5–16)                                                            | Kratzer 2003 (n = 2080); Radiopaedia |
| Lóbulo izquierdo (sobre la aorta)        | CC 8,3 ± 1,7 cm; AP 5,7 ± 1,5 cm                                                                   | Niederau 1983                        |
| Caudado / lóbulo derecho                 | < 0,60 (> 0,65: cirrosis)                                                                          | Harbin 1980                          |
| Ángulo del borde inferior                | Izquierdo 30–45°; derecho 45–70° (redondeado sugiere hepatomegalia o esteatosis)                   | Block; Textbook of GI Radiology      |
| Ecogenicidad                             | Iso o levemente hiperecoico a la corteza renal (índice hepatorrenal ~1,0–1,25); hipoecoico al bazo | Marshall 2012; Webb 2009             |
| Atenuación                               | ~0,5 dB/cm/MHz                                                                                     | Maklad 1984; Taylor 1986             |
| Pared portal / suprahepática             | Portal brillante casi a cualquier ángulo; suprahepática solo de frente                             | Chafetz y Filly 1979; Wachsberg 1997 |
| Excursión diafragmática                  | Tranquila 1,6–1,8 cm; profunda 5,7–7 cm                                                            | Boussuges 2009                       |

Rasgos que hacen real: moteado fino anclado al tejido, heterogeneidad sutil de baja frecuencia, abundantes vasos de
1–4 mm (puntos y líneas ecogénicas portales), cápsula fina que se apaga oblicua, bordes afilados, espejo del hígado
sobre el diafragma, ligamentos redondo y venoso y fisura lobar principal como líneas ecogénicas. Delatan: bordes
redondeados o con aristas, textura idéntica entre órganos, hígado más oscuro que la corteza renal, árbol escaso.

## 3. Vesícula biliar

| Parámetro              | Valor normal                                                                                            | Fuente                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Tamaño                 | 7–10 × 3–4 cm; 30–50 mL distendida (ayunas 24–27 mL, muy variable)                                      | Radiopaedia; Lucius 2025         |
| Pared en ayunas        | < 3 mm (2,6 ± 1,6), **una sola línea ecogénica**; la doble pared es patológica                          | Lucius 2025; Radiology Assistant |
| Forma                  | Pera; cuello curvado y plegado (bolsa de Hartmann); gorro frigio 1–7 %                                  | Radiopaedia; Gerogiannis 2025    |
| Fisura lobar principal | Línea ecogénica del cuello a la rama portal derecha (68 %)                                              | Callen y Filly 1979              |
| Relación con la VHM    | La VHM va por encima y detrás en el plano de Cantlie; solo tributarias de 2–3 mm rozan el lecho (~20 %) | Ball 2006; Zhang 2005            |
| Artefactos             | Refuerzo posterior; sombras de refracción en los bordes laterales del cuello y el fondo                 | POCUS.org                        |

Ningún vaso atraviesa la vesícula: la arteria cística se ramifica sobre la pared y las venas císticas drenan al lecho.

## 4. Porta y suprahepáticas

| Parámetro                   | Valor normal                                                            | Fuente                     |
| --------------------------- | ----------------------------------------------------------------------- | -------------------------- |
| Tronco portal               | ≤ 13 mm (media ecográfica 9,8 mm); ~5 cm de largo a ~50° de la vertical | Radiopaedia; Chau 2023     |
| Relación con la VCI         | La porta por delante de la VCI, separadas por el hiato de Winslow       | Radiopaedia                |
| Flujo portal                | Hepatópeto 15–40 cm/s con ondulación leve                               | Iranpour 2016              |
| Suprahepáticas en el ostium | VHD ~15 mm, VHI ~12, VHM ~11; desembocan 1–3 cm bajo la AD              | Joshi 2009; ASE/EACVI 2015 |
| Confluencia («conejo»)      | Normal en subcostal transverso con inspiración                          | Mumoli y Cei 2005          |

## 5. Riñón derecho

| Parámetro            | Valor normal                                                                                          | Fuente                        |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------- |
| Tamaño               | 10,9 × 5–6 × ~4 cm                                                                                    | Emamian 1993; Glodny 2009     |
| Parénquima / corteza | 15–16 mm / 7–8 mm                                                                                     | PMC12731967; Glodny 2009      |
| Eje                  | Polo superior medial y posterior; inclinación coronal ~15°; hilio anteromedial ~30°                   | Choi 2010; Sanal 2015         |
| Cápsula              | **Una** interfaz especular fina, brillante de frente, perdida en los bordes                           | Radiology Key; ACEP           |
| Grasa perirrenal     | Grosor variable; ≤ 1 mm entre hígado y riñón en la mitad de los casos (1–6 mm)                        | PMC12731967                   |
| Corteza              | Iso o hipoecoica al hígado (nunca más brillante en el adulto normal)                                  | Emamian 1993                  |
| Pirámides            | Hipoecoicas pero no negras, tamaño variable, a menudo tenues; 6–8 por corte; ecos arcuatos en su base | Emamian 1993; Radiopaedia     |
| Seno                 | Lo más ecogénico, bordes digitados, heterogéneo; no llega a los polos                                 | Radiopaedia; urology-textbook |
| Pelvis               | Colapsada (pielectasia ≥ 10 mm en 13 % de sanos)                                                      | PMC12731967                   |
| Movimiento           | 16 ± 8 mm con la respiración tranquila                                                                | Siva 2013                     |

Delatan: cápsula doble paralela, pelvis negra recortada, seno ovalado liso, pirámides idénticas y equidistantes, grasa
perirrenal como halo de grosor constante.

## 6. Vena cava inferior

| Parámetro               | Valor normal                                                                                              | Fuente                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Recorrido sagital       | «S» suave: desde la AD baja y se aleja de la pared ~13–15 mm hasta el nivel renal; convexa anterior en L3 | Li 2021; [E]                 |
| Embudo                  | Se ensancha en los últimos 1–3 cm hacia la AD (28 × 18 mm en la unión)                                    | Ansari 2022; Joshi 2009      |
| Calibre                 | Máximo 21,9 ± 4,2 mm; sección elíptica transverso/AP ≈ 1,5–2                                              | Sanfilippo 2023; Ansari 2022 |
| Variación respiratoria  | Colapso 33–43 % en respiración tranquila; > 50 % con sniff                                                | Haroun 2022; Kircher 1990    |
| **Variación cardíaca**  | **~11 % del diámetro (1–3 mm)**, ≈ ¼–⅓ de la respiratoria tranquila                                       | Sonoo 2015; Nakamura 2013    |
| Traslación respiratoria | ~22 mm craneocaudal, ~4 mm mediolateral                                                                   | Blehar 2012                  |

## 7. Aorta abdominal y relación con la VCI

- A la izquierda de la línea media, apoyada en la cara anterior de los cuerpos vertebrales; se estrecha de ~22 mm (T12)
  a ~18 mm (L2–L3); pared gruesa ecogénica; pulsa 1–4 mm en sístole y no cambia con la respiración.
- Ramas por su cara anterior: **tronco celíaco** (T12, «gaviota» hepática/esplénica), **AMS** ~1 cm más abajo, paralela a
  la aorta con grasa ecogénica alrededor; la vena renal izquierda cruza entre ambas; arterias renales ~1 cm bajo la AMS
  (la derecha pasa por detrás de la VCI).
- **Relación:** en L1–L2 los centros están separados ~31 mm lateralmente y la VCI queda 0–8 mm por delante; en T11–T12,
  10–25 mm por delante; en la unión cavoatrial, ~30 mm por delante. En el eje largo subxifoideo, para pasar de la VCI a
  la aorta hay que inclinar hacia la izquierda; la aorta es más profunda.

Referencias: Kot 2021 (PMC8917002); Pedersen 1993; Radiopaedia (aorta, celíaco, AMS); POCUS101; Taming the SRU.

## 8. Diafragma y pulmón en las ventanas abdominales

- Diafragma como línea curva muy brillante con el espejo del hígado encima; sin columna visible por encima.
- **Receso pleural derecho:** borde pulmonar en la 6.ª costilla en la línea medioclavicular, 8.ª en la axilar media y
  T10 detrás; la pleura parietal dos espacios más abajo. La pleura anterior derecha llega a la articulación
  xifoesternal: **bajo toda la pared anterior derecha hay pulmón aireado hasta el 6.º cartílago** (solo el lado izquierdo
  tiene la escotadura cardíaca). En las ventanas intercostales **anteriores y laterales** deben verse la línea pleural,
  el deslizamiento y las líneas A.
- Cortina: el pulmón aireado baja en inspiración sobre el hígado; en inspiración profunda baja 5,7–7 cm.

Referencias: Dartmouth Human Anatomy cap. 22; Kenhub; Lee 2017 (PMC6029316); Laan 2016.

## 9. Doppler color y modo tríplex

- **Relleno:** el color es la velocidad media axial; en un vaso laminar el centro es más claro que la periferia; queda
  un anillo oscuro fino junto a la pared (flujo lento, filtro de pared, prioridad); el borde del color es blando e
  irregular, nunca un recorte limpio de la luz.
- **Textura:** manchas de 1,5–4 mm (del tamaño de la PSF) que cambian en cada cuadro de color; huecos ocasionales en
  profundidad y junto a las paredes; «confeti» fuera de los vasos solo con ganancia alta. Nunca celdas o bloques visibles
  (los equipos suavizan: mediana, relleno de huecos, sobremuestreo 4 × 4) ni ruido por píxel de pantalla.
- **Persistencia:** promediado de cuadros de color (α 0,4–0,6; adaptativo a la potencia); la tasa de cuadros con color
  es de 4–20 Hz y el relleno «late» con el ciclo cardíaco.
- **Ángulo:** mide solo la componente axial respecto al haz local (radial en la convexa): un vaso horizontal cambia de
  rojo a azul con una franja negra donde el haz lo corta a 90°.
- **Blooming:** con ganancia alta el color desborda la pared, más lateral que axialmente.
- **Aliasing:** envuelve al color opuesto pasando por los tonos claros, sin negro entre ambos.
- **Tríplex:** con PW activado desde color, los equipos mantienen la caja de color con el cursor y la puerta
  (simultáneo, con menos cuadros por segundo) o congelan la imagen mientras corre el espectro («actualizar»).
- **Caja y escala:** en la convexa la caja es un sector que sigue las líneas; barra vertical con ±v_N en cm/s.

Referencias: Evans, Jensen y Nielsen 2011 (PMC3262272); Radiopaedia (color flow, flash, wall filter); ECR EPOS 2006,
2019, 2025; 123sonography; patentes de GE, Acuson, BK, Mindray, Clarius y Siemens sobre persistencia, prioridad y
dúplex; GE Vscan Air.

## 10. Brechas del modelo frente a esta revisión

| Punto                                                                        | Estado                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Color en pantalla con PW (tríplex)                                           | Resuelto: decisión 66                                                                                                                                                                                                                                       |
| Vesícula geométrica con doble pared; VHM que la atraviesa                    | Resuelto: decisión 67 (pera curvada, pared única, sin vasos)                                                                                                                                                                                                |
| Riñón: doble cápsula, pelvis negra, seno liso, rayas                         | Resuelto en parte: decisiones 68, 74 y 81 (grasa retroperitoneal alrededor, psoas y cuadrado lumbar detrás; la cápsula cercana y Morison, una sola línea). Faltan sombras de borde y ecos arcuatos                                                          |
| VCI recta; relación con la aorta; aorta sin ramas                            | Resuelto: decisión 69 (VCI curva con embudo, por delante de la aorta arriba; celíaco y AMS; hilio reordenado)                                                                                                                                               |
| VCI demasiado pulsátil en el sano (21 % cardíaco frente a 26 % respiratorio) | Resuelto: decisión 73 (pared viscoelástica con τ 0,2 s: el latido mueve la pared 1,2 mm, 7 %, en el sano, antes 2,9 mm; la respiración sigue en 24 %)                                                                                                       |
| Doppler color en bloques                                                     | Resuelto: decisión 70 (estimación continua, grano correlado a la celda de resolución y barra de escala)                                                                                                                                                     |
| Líneas A solo por lateral                                                    | Resuelto: decisión 71 (pleura y líneas A en todo el hemitórax derecho, también bajo la pared anterior)                                                                                                                                                      |
| Hígado: tamaño, bordes, textura                                              | Hecho: decisión 72 (CC 15,7 cm en la medioclavicular; borde 34–57° en el sano y romo, 78–88°, en la congestión grave; lóbulo izquierdo 9,5 × 6,9 cm) y 78 (tríadas portales: focos y trazos ecogénicos finos anclados al parénquima). Pendiente: el caudado |
| Ventanas predeterminadas                                                     | Resuelto en parte: decisiones 69 (porta lateral) y 75 (las ventanas como tarjetas con lo que muestran). Faltan la transversa epigástrica (VCI y aorta sobre la vértebra) y la hepática subxifoidea                                                          |
| Luces vasculares demasiado limpias                                           | Resuelto: decisión 76 (lóbulos laterales con la aberración de la pared y reverberación de sus caras); con la armónica (77) bajan 12 dB por orden, como en un equipo                                                                                         |
