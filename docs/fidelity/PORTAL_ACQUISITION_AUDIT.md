# Adquisición del tronco portal: bifurcación y signo Doppler

## Pregunta y mecanismo

Una banda al otro lado de la línea de base no demuestra por sí sola inversión
hepatófuga. El signo del desplazamiento Doppler depende de la proyección del
vector de velocidad sobre el haz. Dos ramas hepatópetas con direcciones
distintas pueden aportar signos opuestos dentro de una puerta que cubre su
bifurcación. También intervienen ruido, aliasing y transitorios.

La investigación local mantuvo fisiología, semilla, longitud de puerta de 6 mm,
filtro de 15 Hz y la misma cadena IQ. Comparó posiciones anatómicas con distinta
distancia al extremo del tronco. Las escalas más altas no eliminaron por sí solas
la energía contralateral: no bastaba atribuir todo a aliasing.

## Ensayo exploratorio, no calibración clínica

Dos cuerpos, sano y congestión grave, apnea espiratoria, adquisición de 6,5 s
tras 30 s del modelo, Nyquist ±50 cm/s. Pesos de identidad del volumen de muestra
no equivalen a potencia espectral: se informan por separado.

| Escenario       | Distancia mínima probada | Fracción del tronco | Vmáx/Vmín observadas, cm/s |      PF |
| --------------- | -----------------------: | ------------------: | -------------------------: | ------: |
| Legacy sano     |                     0 mm |               100 % |                16,89/14,54 | 14,98 % |
| Legacy grave    |                     0 mm |              66,7 % |                 24,91/6,43 | 74,19 % |
| Legacy grave    |                     5 mm |              ≈100 % |                 19,65/5,35 | 72,80 % |
| Referencia sano |                     0 mm |              67,0 % |                22,18/17,61 | 20,28 % |
| Referencia sano |                    10 mm |               100 % |                17,34/14,54 | 15,45 % |

Cifras de una realización determinista, no medias poblacionales humanas.
Vmáx, Vmín y PF son resúmenes por latido: la PF agregada no se recalcula a
partir de los dos extremos agregados.
El barrido geométrico inicial solo estima mezcla espacial instantánea; la IQ
incluye advección y población histórica. Integrar todo un semiplano suma ruido
y exagera la aparente inversión: al exigir 6 dB sobre el suelo y restar ese
suelo, el exceso negativo/positivo del grave legacy cambió de −10,8 a −17,3 dB
al usar el margen de 5 mm. Esto apoya una contribución de las ramas; no demuestra
que toda señal contralateral sea suya ni que el ruido restante deba borrarse.

## Cambio propuesto y límites

El visor automático exige al centro portal una distancia material de al menos
una longitud de puerta (6 mm) respecto al extremo de bifurcación. Es una guarda
geométrica experimental, no un umbral clínico publicado. Mantiene calibre,
flujo, retrodispersión, ganancia, escala y longitud de muestra. No recorta bins
negativos ni impide inversión fisiológica. No cambia cómo el alumno coloca
manualmente la puerta ni los criterios de aceptación de sus capturas.

El selector de puertas admite una restricción opcional y devuelve null si
ningún candidato la cumple; no escoge arbitrariamente un candidato rechazado
con puntuación cero. La disponibilidad se prueba en apnea en todos los casos
y ambos cuerpos; cuatro cadenas IQ comprueban predominio del tronco y patrón
conservado en sano/congestión. No acredita todas las fases respiratorias.

## Fuentes de técnica

- Polish Ultrasound Society, 2015, DOI 10.15557/JoU.2015.0018:
  https://pmc.ncbi.nlm.nih.gov/articles/PMC4579749/
  Recomienda examinar trayecto y ramas, optimizar el ángulo y controlar la
  respiración. No aporta el margen de 6 mm de esta implementación.
- University of Washington, protocolo portal, revisión julio de 2024:
  https://depts.washington.edu/usrad/wordpress/wp-content/uploads/2024/07/PVT-Abdominal-Doppler-Protocol-7.24-3.pdf
  Documenta por separado tronco y ramas y exige corrección angular al medir
  velocidades clínicas. Las cifras del simulador anteriores son axiales,
  sin esa corrección; no deben compararse directamente con sus referencias.

No se incorporan imágenes de terceros a la aplicación. La validación clínica
prospectiva y la calibración de velocidades absolutas siguen pendientes.
