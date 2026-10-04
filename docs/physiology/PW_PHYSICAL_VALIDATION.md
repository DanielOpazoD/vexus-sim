# PW: validación física antes de calibración visual

Estado: investigación y corrección experimental, 2026-10-04. El PR 164 permanece
retenido para revisión clínica, aunque su primera versión pasó CI. Una imagen
reconocible y pruebas verdes no demuestran fidelidad clínica.

## Cadena causal y unidades

1. El sistema circulatorio obtiene caudales y presiones. Los balances de volumen
   y los elementos de resistencia, inercia y capacitancia deben conservar masa.
   La presión auricular prescrita y la simplificación del árbol vascular siguen
   siendo aproximaciones del modelo actual, no una simulación cardíaca completa.
2. La velocidad media se calcula desde Q/A. Q en mL/s multiplicado por 1000 y
   dividido por A en mm² da mm/s. La velocidad media de sección, la velocidad
   central y la envolvente espectral NO son intercambiables.
3. Un perfil espacial asigna velocidades a los dispersores dentro del volumen de
   muestra. La sensibilidad depende del pulso, puerta, anchura del haz, elevación
   y posición. Por eso la anchura espectral no se obtiene engrosando una curva.
4. La velocidad relativa sangre + tejido − sonda se proyecta sobre el haz.
   fD = 2 f0 v_axial / c, con unidades homogéneas y c = 1540 m/s en este modelo.
   La fase IQ integra 2π fD Δt en cada pulso. La señal es la suma compleja de los
   dispersores ponderados, más componentes tisulares y ruido electrónico.
5. PRF, filtro de pared y STFT determinan muestreo, rechazo de clutter, resolución
   temporal/frecuencial y aliasing. La imagen muestra potencia espectral medida.
   La línea de base desplaza un intervalo de visualización de anchura PRF; no
   elimina la ambigüedad de muestreo ni cambia la velocidad física.
6. ECG y PW comparten reloj. Las etiquetas A/S/D se obtienen de la señal con
   criterios de calidad; no se dibujan a partir de la verdad fisiológica oculta.

## Defectos reproducidos independientemente de la fisiología

`pwTransportContinuity.test.ts` utiliza un fantoma analítico de sangre uniforme,
con velocidad constante, sin dispersión angular y sin movimiento respiratorio.
El resto de la cadena IQ → filtro → STFT es producción.

La actualización previa del peso espacial cada ocho pulsos, sumada a renovación
con fase inicialmente estacionaria y reentrada a una posición fija, introducía
energía espuria y concentración de partículas dependiente de PRF/velocidad.
En el caso 300 mm/s, PRF 2000 Hz, la energía fuera de un entorno amplio del
Doppler esperado alcanzaba aproximadamente −20 dB en el percentil 95. No se usa
una línea infinitamente fina como referencia: el tránsito por la puerta produce
ensanchamiento físico incluso con velocidad uniforme.

La corrección evalúa transporte y sensibilidad espacial en cada pulso, inicializa
la frecuencia antes del primer pulso del dispersor nuevo y conserva el sobrepaso
al reentrar en la cuerda del volumen. No modifica caudales, perfiles de velocidad,
PRF, ruido, filtro de pared ni FFT para obtener el resultado.

Regresiones rápidas reproducidas con el código previo y corregido:

- Energía fuera del entorno: se exige menos de −30 dB en 95 % de columnas; la
  implementación previa falla (−19.98 dB en la primera semilla).
- Densidad ponderada al variar velocidad/PRF: razón máxima/mínima menor de 1.03;
  la implementación previa falla con 1.1364.
- Frecuencia estimada: centroide circular de potencia dentro de un bin respecto
  a la ecuación Doppler, incluyendo sentido inverso, 60° y cruce de Nyquist.
  El máximo de una columna aislada no es un estimador insesgado con interferencia
  aleatoria y ensanchamiento de tránsito.

El ensayo completo reproducible es `node --import tsx tools/fidelity/pwContinuityAudit.ts`.
Sus umbrales son contratos numéricos del fantoma, no criterios diagnósticos.
La verificación de matrices clínicas, coste y navegador debe completarse antes
de publicar esta corrección como lista para integrar.

### Movimiento tisular entre pasos fisiológicos

La primera integración pasó 1129 pruebas del bloque con cobertura, pero falló
2 de las 52 pruebas de matrices IQ: cambió el motivo de rechazo en dos capturas
respiratorias (no convirtió esos rechazos en diagnósticos aceptados). El análisis
identificó un segundo reloj discreto: el desplazamiento tisular quedaba constante
entre pasos fisiológicos de 4 ms. Al evaluar la sensibilidad en cada pulso, esos
saltos del tejido brillante introducían potencia de banda ancha.

Se reconstruye ahora el desplazamiento intrapaso mediante la velocidad tisular
local (aproximación lineal), manteniendo intactas las reglas de calidad y sus
umbrales. Las tres pruebas respiratorias enfocadas vuelven a pasar: la PF portal
observada grave es 66.92 % frente a 65.75 % de referencia, y la renal sin señal
suficiente se rechaza. Esto exige repetir la matriz completa; no basta esa muestra.

La sensibilidad axial usa una tabla compartida de 32 KiB, con interpolación
lineal y error adicional absoluto inferior a 1.2e-7 frente a la función directa.
Se comprueba el límite sobre 100001 puntos y se mantienen todas las evaluaciones
por pulso. Es una optimización numérica, no una reducción de dispersores o PRF.

## Calibración clínica pendiente

- Comparar ventanas anatómicas reales con las puertas ideales iniciales del visor.
  Las primeras puertas coaxiales de 0° y anchura reducida sobrerrepresentaban el
  centro del vaso; no representan una técnica de adquisición habitual.
- Separar el efecto del ángulo, perfil radial, longitud de puerta, elevación,
  transmisión, ruido y escala, variando un parámetro por experimento.
- Verificar la escala PW, no confundirla con la escala Doppler color publicada.
  Diferenciar velocidades medias de máximas, con/sin corrección angular, y adulto
  sano de embarazo, pediatría o patología.
- La prueba exploratoria con ventanas reales y PRF bajas aún produjo aliasing.
  No justifica comprimir las velocidades o ampliar escalas para ocultar un fallo.
- Validar sano, congestión, insuficiencia tricuspídea y FA por separado. Las
  referencias del usuario muestran patrones distintos; no todas son normalidad.
- Persisten limitaciones de campo de velocidad local, recirculación de dispersores
  y reclasificación parcial documentadas en el código. No es Field II ni CFD.

## Fuentes primarias y referencias clínicas consultadas

- Jensen / Field II, ejemplo de simulación PW desde dispersores móviles y señales
  RF: https://field-ii.dk/examples/pw_example/example_pw_phantom.html
- Transit-time broadening y modulación de amplitud:
  https://pubmed.ncbi.nlm.nih.gov/16555761/
- Flow spectra from spectral power density calculations for pulsed Doppler:
  https://www.sciencedirect.com/science/article/pii/S0041624X02002238
- Decoding VExUS, 2024, doi:10.1186/s13089-024-00396-z:
  https://theultrasoundjournal.springeropen.com/articles/10.1186/s13089-024-00396-z
- Registro clínico comentado y figuras publicadas por NephroPOCUS, 2025:
  https://nephropocus.com/2025/03/27/hepatic-vein-doppler-and-ekg-are-there-any-workarounds/amp/
- Kudo et al., 2017, doi:10.1007/s10396-017-0770-0:
  https://pubmed.ncbi.nlm.nih.gov/28150225/ . El resumen fue consultado; el PDF
  completo no se pudo descargar. No se extraen valores numéricos de tablas no vistas.

Las imágenes privadas aportadas por el usuario son referencias de revisión, no
activos distribuidos en el repositorio. No se atribuye validación externa a los
autores de estas fuentes ni aprobación clínica al simulador.
