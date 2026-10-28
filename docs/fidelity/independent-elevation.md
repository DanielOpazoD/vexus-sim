# Referencia independiente del espesor de corte

Protocolo `convex-c35-pymust-elevation-v1`, sintético y de desarrollo. Adquiere RF
con PyMUST 0.1.9 intacto y reconstruye IQ/DAS en el receptor nominal. Es una
referencia de sensibilidad pulso-eco en elevación; no calibra un ecógrafo ni valida
moteado, armónica, anatomía heterogénea o uso clínico. El protocolo
[puntual v2](independent-psf.md) conserva su alcance 2D y sus originales.

## Selección del campo

PyMUST selecciona 2D si todos los Y tienen magnitud menor de 1e-9 m. Cada
adquisición nueva incluye el blanco físico y un segundo blanco con reflectividad
exactamente cero, mismo X/Z y Y=1e-6 m. Este término activa la rama 3D también
para el blanco central; no se modifica la biblioteca. Las llamadas son seriales.
SIMUS determina la malla frecuencial desde X/Z y los delays, que se conservan;
el término adicional no contribuye a la suma de recepción.

Una traza de retorno de `pfield` registra la rama ejecutada y la huella de sus
frecuencias. Los controles comparan **RF y espectro completos**, con error
`||A−B||₂/||A||₂`, sin normalizar la amplitud de las dos señales por separado:

- Blanco fuera de plano solo/acompañado y cambio de posición del término cero:
  error ≤1e-6; ambos dieron cero en la adquisición registrada.
- Blanco central frente a límites ±1/±2 µm: error ≤1e-4. Esos desplazamientos
  superan los dos umbrales internos relevantes del motor.
- Cambiar por separado foco elevacional 80→50 mm o altura 13→6,5 mm debe cambiar
  RF y espectro 3D en más de 1e-3 y conservar los 2D dentro de 1e-6.
- Los pares conservan formas y malla frecuencial. La huella de `pfield`, `simus`
  y `dasmtx` debe coincidir con el motor registrado.

Estos controles demuestran selección y dependencia causal de parámetros. No
demuestran exactitud física del modelo de lente. PyMUST utiliza una aproximación
multigaussiana de cuatro términos y reutiliza sus valores entre frecuencias.
Su fuente y teoría se describen en [PyMUST](https://github.com/creatis-ULTIM/PyMUST)
y [SIMUS](https://doi.org/10.1016/j.cmpb.2022.106726).

## Geometría y medidas

Convexo genérico de 3,5 MHz, radio 60 mm, cuerda activa 26 mm, 65 elementos, altura 13 mm,
lente en 80 mm, TX Hann enfocado lateralmente a 90 mm, RX uniforme con F# 2,5,
banda 45 %, atenuación 0,601 dB/cm/MHz y muestreo 28 MHz. Se mantienen TX y RX
nominales al desplazar el blanco en Y; no se recentra la reconstrucción sobre él.
La lente ya actúa en emisión y recepción antes de DAS.

Se recorre Y de −12 a 12 mm cada 0,5 mm. FWHM usa mitad de amplitud de envolvente
lineal (−6,02 dB), los cruces interpolados que rodean el máximo central y ninguna
selección posterior de otro lóbulo. Se exige máximo en Y=0, simetría RMS ≤1e-5,
señal finita/no vacía y ambos cruces dentro del dominio. Se conservan las colas.

| Profundidad | PyMUST 3D, mm | Gaussiana de dos vías del modelo, mm |
| ----------- | ------------- | ------------------------------------ |
| 60 mm       | 2,0764        | 2,9155                               |
| 80 mm       | 2,7374        | 2,6642                               |
| 150 mm      | 5,0489        | 4,9267                               |

El focal repetido a 0,25 mm mide 2,7371 mm: diferencia 0,0106 %. Con paso frecuencial
reducido a la mitad mide 2,7194 mm: diferencia 0,6548 %. Ambos cumplen el criterio
previo de convergencia ≤1 %. Es convergencia de esas dos discretizaciones en ese
caso; no es una cota total del solucionador ni valida el resto de profundidades.

La comparación utiliza `elevSigmaMm` fundamental dividido por √2 y FWHM gaussiana.
No se ajusta el modelo ni una tolerancia de fidelidad a estas salidas. La diferencia
a 60 mm queda visible; incluye la lente y respuesta multigaussiana frente a una
Gaussiana reducida y no se atribuye automáticamente a un error del render.

## Reproducción y verificación

Usar el entorno Python separado y fijado descrito en
[referencia puntual](independent-psf.md#ejecución-y-evidencia). No se instala en la
aplicación ni en cada CI. Conservar wheels/licencias y manifiesto del entorno.
La instalación registrada es Python 3.13/macOS arm64; otro entorno requiere su
propio registro, no fingir identidad binaria.

```sh
/ruta/venv/bin/python tools/fidelity/independentElevation.py acquire \
  --runtime-manifest /ruta/runtime/independentPsf.runtime.json --out /ruta/evidencia/nueva
/ruta/venv/bin/python tools/fidelity/independentElevation.py verify \
  /ruta/evidencia/nueva/reference.json --out /ruta/evidencia/nueva/verification.json
tools/workspace/run.sh node --import tsx tools/fidelity/independentElevation.ts \
  --input /ruta/evidencia/nueva/reference.json \
  --verification /ruta/evidencia/nueva/verification.json --out /ruta/evidencia/nueva/comparison.json
```

Las salidas van fuera del checkout y no se sobrescriben. El verificador comprueba
los originales, reconstruye RF desde cada espectro y repite RF→IQ→DAS para cada
perfil. La comparación espectro/RF admite como máximo 2e-5 de la amplitud pico
más cuatro épsilon de redondeo: acota la supresión de muestras diminutas del
SIMUS registrado, sin tolerar cambios arbitrarios en la señal. Los negativos
rechazan un espectro o una RF alterados aunque se actualice su hash, así como
perfiles, controles y dimensiones contradictorios.

El comparador enlaza el recibo con el JSON y sus 18 archivos. El recibo acredita
consistencia, no autentica por sí
solo el origen físico de datos arbitrarios. El fixture versionado procede de la
adquisición registrada; probar su lectura en CI no equivale a adquirir RF nueva.

Originales, controles, fuente ejecutada, revisión de protocolo, entorno y negativos:
`/Users/daniel/.t3/scratch/vexus-psf-elevation-evidence-20261028`. La referencia
no resuelve el defecto de retorno del moteado; ofrece una medida independiente
para evaluar el filtro elevacional de una futura corrección.
