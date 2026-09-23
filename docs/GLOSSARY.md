# Glosario

Términos clínicos, físicos y del código que aparecen en la base, los documentos y los
identificadores. Si un término nuevo entra en el código, entra aquí.

## Clínica y VExUS

| Término                 | Significado                                                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VExUS**               | Venous Excess Ultrasound Score: grado 0–3 de congestión venosa sistémica a partir de VCI, suprahepática, porta y vena interlobar renal.                              |
| **VExUS C**             | Variante de la clasificación que exige VCI ≥ 20 mm para graduar; la implementa `src/vexus/classification.ts`.                                                        |
| **VCI**                 | Vena cava inferior. `ivcInfra` (bajo la desembocadura de las suprahepáticas) e `ivcSupra` (retrohepática).                                                           |
| **VSH / HV**            | Vena suprahepática (hepatic vein): derecha, media, izquierda y tronco común.                                                                                         |
| **Ondas S / D / A / V** | Suprahepática: S sistólica y D diastólica (anterógradas, hacia la aurícula); A (contracción auricular) y V retrógradas. Normal S > D; leve S < D; grave S invertida. |
| **S invertida**         | Retrógrado sistólico ≤ −2 cm/s y ≥ 50 % del pico anterógrado de la ventana (decisiones 5 y 44).                                                                      |
| **PF**                  | Fracción de pulsatilidad portal = (Vmáx − Vmín)/Vmáx en %; < 30 normal, 30–49 leve, ≥ 50 grave.                                                                      |
| **Patrón renal**        | Vena interlobar: continuo (el flujo no llega a la línea de base, aunque sea pulsátil), bifásico (S y D con interrupción), monofásico (solo D).                       |
| **PAD / RAP**           | Presión de aurícula derecha. Aquí es un contorno prescrito (`prescribed-ra-contour`).                                                                                |
| **IT**                  | Insuficiencia tricuspídea.                                                                                                                                           |
| **FA**                  | Fibrilación auricular (sin onda A, RR irregular).                                                                                                                    |
| **Receso de Morison**   | Espacio hepatorrenal: cápsula hepática → grasa de Gerota → cápsula renal.                                                                                            |
| **Couinaud**            | Segmentos hepáticos I–VIII, derivados aquí de los planos de las suprahepáticas, la fisura umbilical y el plano portal (`src/anatomy/couinaud.ts`).                   |
| **Cortina pulmonar**    | El pulmón que baja con la inspiración y tapa la parte alta del hígado; deja líneas A.                                                                                |

## Física y adquisición

| Término             | Significado                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| **Modo B**          | Imagen en escala de grises (brillo = ecogenicidad).                                                    |
| **PW**              | Doppler pulsado: puerta en un punto, espectro velocidad–tiempo.                                        |
| **Color**           | Doppler color: velocidad media por celda con el estimador de autocorrelación (Kasai).                  |
| **Puerta**          | Volumen de muestra del PW (longitud axial × PSF lateral × elevacional).                                |
| **PRF / Nyquist**   | Frecuencia de repetición de pulsos; la velocidad máxima sin plegado es c·PRF/(4·f0).                   |
| **Aliasing**        | Plegado de velocidades por encima de Nyquist.                                                          |
| **Filtro de pared** | Paso alto que elimina el eco lento del tejido (clutter).                                               |
| **Envolvente**      | Borde superior del espectro; aquí, percentil 92 de la banda contigua a la línea de base (decisión 44). |
| **PSF**             | Point spread function: respuesta del sistema a un punto (axial, lateral, elevacional).                 |
| **Número F**        | Profundidad / apertura; fija la anchura lateral del haz (`beamModel.ts`).                              |
| **TGC**             | Compensación de ganancia en profundidad.                                                               |
| **Speckle**         | Moteado por interferencia de dispersores sub-resolución.                                               |
| **Líneas A**        | Reverberaciones horizontales equiespaciadas bajo una interfaz de gas (pleura).                         |
| **Ensemble**        | Número de disparos por línea de color.                                                                 |

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
