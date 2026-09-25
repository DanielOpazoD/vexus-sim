# Glosario

Términos clínicos, físicos y del código que aparecen en la base, los documentos y los
identificadores. Si un término nuevo entra en el código, entra aquí.

## Clínica y VExUS

| Término                 | Significado                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **VExUS**               | Venous Excess Ultrasound Score: grado 0–3 de congestión venosa sistémica a partir de VCI, suprahepática, porta y vena interlobar renal.                                                          |
| **VExUS C**             | Variante de la clasificación que exige VCI ≥ 20 mm para graduar; la implementa `src/vexus/classification.ts`.                                                                                    |
| **VCI**                 | Vena cava inferior. `ivcInfra` (bajo la desembocadura de las suprahepáticas) e `ivcSupra` (retrohepática).                                                                                       |
| **VSH / HV**            | Vena suprahepática (hepatic vein): derecha, media, izquierda y tronco común.                                                                                                                     |
| **Ondas S / D / A / V** | Suprahepática: S sistólica y D diastólica (anterógradas, hacia la aurícula); A (contracción auricular) y V retrógradas. Normal S > D; leve S < D; grave S invertida.                             |
| **S invertida**         | Retrógrado sistólico ≤ −2 cm/s y ≥ 50 % del pico anterógrado de la ventana (decisiones 5 y 44).                                                                                                  |
| **PF**                  | Fracción de pulsatilidad portal = (Vmáx − Vmín)/Vmáx en %; < 30 normal, 30–49 leve, ≥ 50 grave.                                                                                                  |
| **Patrón renal**        | Vena interlobar: continuo (el flujo no llega a la línea de base, aunque sea pulsátil), bifásico (S y D con interrupción), monofásico (solo D).                                                   |
| **PAD / RAP**           | Presión de aurícula derecha. Aquí es un contorno prescrito (`prescribed-ra-contour`).                                                                                                            |
| **IT**                  | Insuficiencia tricuspídea.                                                                                                                                                                       |
| **FA**                  | Fibrilación auricular (sin onda A, RR irregular).                                                                                                                                                |
| **Receso de Morison**   | Espacio hepatorrenal: cápsula hepática → grasa de Gerota → cápsula renal.                                                                                                                        |
| **Couinaud**            | Segmentos hepáticos I–VIII, derivados aquí de los planos de las suprahepáticas, la fisura umbilical y el plano portal (`src/anatomy/couinaud.ts`).                                               |
| **Cortina pulmonar**    | El pulmón del receso costofrénico que baja con la inspiración y tapa la parte alta del hígado: bajo su pleura parietal, neblina con líneas A y deslizamiento, con un borde blando (decisión 61). |

## Física y adquisición

| Término                       | Significado                                                                                                                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Modo B**                    | Imagen en escala de grises (brillo = ecogenicidad).                                                                                                                                                                               |
| **PW**                        | Doppler pulsado: puerta en un punto, espectro velocidad–tiempo.                                                                                                                                                                   |
| **Color**                     | Doppler color: velocidad media por celda con el estimador de autocorrelación (Kasai), emulado sin IQ.                                                                                                                             |
| **Puerta**                    | Volumen de muestra del PW (longitud axial × PSF lateral × elevacional).                                                                                                                                                           |
| **PRF / Nyquist**             | Frecuencia de repetición de pulsos; la velocidad máxima sin plegado es c·PRF/(4·f0).                                                                                                                                              |
| **Aliasing**                  | Plegado de velocidades por encima de Nyquist.                                                                                                                                                                                     |
| **Filtro de pared**           | Paso alto que elimina el eco lento del tejido (clutter).                                                                                                                                                                          |
| **Envolvente**                | Borde superior del espectro; aquí, percentil 92 de la banda contigua a la línea de base (decisión 44).                                                                                                                            |
| **PSF**                       | Point spread function: respuesta del sistema a un punto (axial, lateral, elevacional).                                                                                                                                            |
| **Número F**                  | Profundidad / apertura; fija la anchura lateral del haz (`beamModel.ts`).                                                                                                                                                         |
| **TGC**                       | Compensación de ganancia en profundidad.                                                                                                                                                                                          |
| **Speckle**                   | Moteado por interferencia de dispersores sub-resolución.                                                                                                                                                                          |
| **Líneas A**                  | Reverberaciones horizontales equiespaciadas bajo una interfaz de gas: en la cortina, las réplicas del eco de la pleura parietal a múltiplos de su profundidad, cada una G veces la anterior (decisión 61).                        |
| **Eco de interfaz**           | Reflexión determinista de una cara lisa (pared, cápsula, diafragma, pleura, Morison): se suma coherente al moteado en la pasada B (decisión 57).                                                                                  |
| **Reflectividad efectiva**    | R_ef = max(\|R_Fresnel\|, suelo): el salto de impedancia de los dos tejidos o, si es menor, el de la capa de colágeno que los separa.                                                                                             |
| **Lóbulo de Kirchhoff**       | Caída del eco de una cara con la incidencia θ: sec²θ·exp(−tan²θ/4s²) en amplitud, con s la **pendiente rms** de la superficie (VSH 0,14: brillante solo a ±12°).                                                                  |
| **Coherencia de curvatura**   | Pérdida del eco de una cara curva dentro del haz (tubos): la fase k0·κx² se descorrelaciona sobre la anchura lateral y elevacional del haz.                                                                                       |
| **Cara de uno o dos lados**   | Una cara la conocen las muestras de los dos tejidos (luz de un vaso: pared y sangre) o solo las de su **dueño** (cápsula, mitad abdominal del diafragma, grasa de Morison); entonces su perfil entra 2,5σh en él.                 |
| **Costura del espejo**        | Banda oscura entre el diafragma y su imagen especular cuando el espejo queda dentro del pulmón; desaparece con el espejo en el cruce exacto.                                                                                      |
| **Pleura parietal**           | La hoja de la pleura pegada a la pared; su eco en el cruce exacto de la cara interna de la pared (A0) es la línea pleural, la más brillante de la imagen (`Interface.PleuraWall`, decisión 61).                                   |
| **Serie de la pared**         | Reverberación entre la pleura y la cara de la sonda bajo la línea pleural: la copia espejo de la pared (a 2D − d) y la directa (a D + d), ×G por cada ida y vuelta, con la pared remuestreada en el mismo camino (decisión 61).   |
| **Deslizamiento pulmonar**    | El pulmón (pleura visceral) que se desliza bajo la pared quieta con la respiración: la neblina bajo la pleura cambia entre fases respiratorias y la pared de encima no (decisión 61).                                             |
| **Fracción de aire**          | f = Φ(dz/σ): la parte del haz que da en el pulmón en el cruce de la pleura, con dz la distancia al borde de la cortina; hace el borde blando (decisión 61).                                                                       |
| **Mirada**                    | Una adquisición del plano con todas las líneas dirigidas el mismo ángulo θ en el elemento (0, +θ o −θ); la composición espacial forma una por cuadro en la rejilla común de la mirada 0 (decisión 58, `steering.ts`).             |
| **Composición espacial (CX)** | Media lineal de las envolventes de varias miradas de la misma celda, ponderada por su cobertura (pasada K): la SNR del moteado sube como √N_eff con el mismo grano. Solo con el color apagado (`compoundActive`); «CX» en el HUD. |
| **N_eff**                     | Número efectivo de miradas independientes, N²/Σρ_ij con ρ_ij la correlación de intensidad entre miradas (ρ_ii = 1): 3 si son independientes, 1 si son iguales.                                                                    |
| **Costura del compuesto**     | Banda lateral junto al borde del arreglo donde una mirada dirigida no llega (su elemento no existe) y el compuesto tiene una mirada menos: 5–15 líneas por lado a ±7°, según la profundidad (`seamStats`).                        |
| **Anillo de miradas**         | Las envolventes de las últimas N miradas, una ranura cada una, que compone K; se vacía con un salto de pose, un cambio de escena, profundidad, foco o modo.                                                                       |
| **Ensemble**                  | Número de disparos por línea de color.                                                                                                                                                                                            |

## Código

| Término                    | Significado                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Marco anatómico**        | Levógiro: x = izquierda del paciente, y = anterior, z = craneal, z = 0 en el xifoides (decisión 22). |
| **Marco material**         | Coordenadas del tejido sin la deformación respiratoria (`toMaterial`).                               |
| **SDF**                    | Signed distance function: la anatomía son funciones de distancia con signo, las mismas en TS y GLSL. |
| **Equivalencia TS ↔ GLSL** | Invariante central: la anatomía que mide la CPU es la que dibuja la GPU (`e2e/equivalence.spec.ts`). |
| **Verdad fisiológica**     | Lo que el caso ES (`measurePhysiologyTruth`), frente a lo que el alumno MIDE sobre el espectro.      |
| **Nivel lento**            | Prueba cuya primera línea es `// @tier slow`: fuera de `npm test`, dentro de `test:all`/`check`.     |
| **`it.fails`**             | Contraejemplo de una limitación conocida: empezará a «pasar» cuando se resuelva.                     |
| **`?e2e`**                 | Parámetro de URL que expone `window.__vexusTest` (ganchos de prueba estables).                       |
