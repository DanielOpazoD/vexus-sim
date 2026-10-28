# Referencia puntual independiente del convexo genérico

Primera entrega del bloque 1 de [la ronda de quince](NEXT15.md). La referencia es
**sintética y de desarrollo**, calculada con PyMUST 0.1.9 fuera del navegador. No es
calibración de un ecógrafo ni validación clínica. No cambia la imagen del simulador.
La teoría y alcance de SIMUS se describen en [el artículo original](https://doi.org/10.1016/j.cmpb.2022.106726);
[PyMUST](https://github.com/creatis-ULTIM/PyMUST) es la implementación Python independiente.

## Qué se adquiere

Medio homogéneo, convexo genérico de 3,5 MHz, cuerda activa de 26 mm, 65 elementos,
radio 60 mm, emisión Hann, recepción uniforme, banda pulso-eco 45 % y atenuación
0,601 dB/cm/MHz. Discretización de elementos y pulso son estimados. La fuente
tiene y=0. **PyMUST 0.1.9 selecciona entonces su campo 2D**, aunque se suministren
altura de 13 mm y foco elevacional de 80 mm: esos dos parámetros no se aplican.
Esta referencia no mide foco en elevación ni espesor del corte. La descripción
anterior que atribuía desenfoque elevacional a otras profundidades era incorrecta
(decisión 288); las adquisiciones originales se conservan sin recalcularlas.

La referencia lateral v2 desplaza un blanco a través de un haz fijo y recibe
siempre en el punto nominal. Conserva RF por desplazamiento y los perfiles
complejos, de modo que varían **emisión y recepción**. El control de recepción
completa reutiliza exactamente la misma RF/IQ. La referencia axial reconstruye
la respuesta al blanco central. FWHM significa mitad de amplitud de envolvente
lineal (−6,02 dB), no mitad de potencia.

El piloto v1 emitía una vez y desplazaba solo la reconstrucción DAS. Se conserva
como negativo: su perfil lateral no era comparable con la sensibilidad dos vías
del modelo. No se atribuye su discrepancia al simulador.

PyMUST aplica F# respecto de las normales de los elementos convexos; el modelo
reducido utiliza una apertura limitada por profundidad y un ancho RX equivalente
k=1,3. Son políticas diferentes. A 90 mm, F#2,5 en PyMUST selecciona 35 elementos
y una cuerda de 13,8917 mm, frente al máximo de 26 mm del modelo. Por eso el informe
conserva también la recepción completa. No se ajusta F# para fabricar concordancia.

## Resultado observado y límites

Adquisición v2 de cinco casos, 81 desplazamientos laterales. Anchuras en mm:

| Blanco / foco | Axial PyMUST | Axial modelo | Lateral PyMUST F#2,5 | Lateral recepción completa | Lateral modelo |
| ------------- | ------------ | ------------ | -------------------- | -------------------------- | -------------- |
| 60 / 90       | 0,5760       | 0,6772       | 2,4674               | 1,3562                     | 1,5199         |
| 90 / 90       | 0,5999       | 0,7097       | 2,6374               | 1,8559                     | 1,9244         |
| 150 / 90      | 0,6910       | 0,7747       | 4,6497               | 3,3973                     | 3,8216         |
| 90 / 75       | 0,6050       | 0,7097       | 2,6993               | 1,8815                     | 1,9815         |
| 90 / 120      | 0,6075       | 0,7097       | 3,7948               | 2,1399                     | 2,1302         |

En el focal, duplicar la densidad de perfiles cambia el ancho lateral F# de
2,63740 a 2,63463 mm, el de recepción completa de 1,85595 a 1,85504 mm y el axial
de 0,599944 a 0,599936 mm. Es convergencia de muestreo de ese caso, no de todo el
solucionador ni de todas las condiciones.

Las diferencias incluyen política de apertura, pulso y procesamiento. No hay
un umbral de fidelidad ajustado a estas salidas. Estos datos orientan el bloque 4;
no acreditan todavía capas heterogéneas, quistes, flujo, moteado o imagen clínica.
Todos los casos observados son desarrollo; ninguno se reclasifica como reservado.

El cambio de rama se comprobó durante B5: con Y=0 el motor registró
`ElevationFocusing=false` y reprodujo RF/IQ originales exactamente. Una adaptación
aislada que conserva 3D para Y=0 coincidió exactamente con el límite Y=1e-8 m
del motor intacto. Esa adaptación es una referencia distinta; no convierte esta
adquisición v2 en 3D. El generador v2 comprueba la huella de `pfield.py` y declara
el modelo 2D; el comparador lo infiere para originales antiguos y rechaza una
declaración 3D bajo el mismo protocolo. Datos en
`../fidelity-next15-evidence/speckle/material-rf-17-zero-elevation-b/VERIFIED.json`.

## Ejecución y evidencia

El entorno Python es opcional y separado de la aplicación. Sus versiones y
wheels quedan fijados en `tools/fidelity/independentPsf.requirements.txt` y
`independentPsf.runtime.json`; conservar los wheels originales bajo `wheels/`
junto al manifiesto. La referencia registrada usa Python 3.13 en macOS arm64.
Otro sistema requiere registrar su propio entorno, no fingir identidad binaria.
El LICENSE distribuido y el repositorio de PyMUST indican LGPL-2.1; METADATA del
wheel indica LGPL v3. Se conservan ambas observaciones y las licencias originales;
esta herramienta no incorpora ni redistribuye ese código dentro de la aplicación.

Preparación opcional en el sistema registrado, sin instalar paquetes en la aplicación:

```sh
python3.13 -m venv /ruta/runtime/venv
/ruta/runtime/venv/bin/python -m pip download --only-binary=:all: --require-hashes \
  -r tools/fidelity/independentPsf.requirements.txt --dest /ruta/runtime/wheels
/ruta/runtime/venv/bin/python -m pip install --no-index --require-hashes \
  --find-links /ruta/runtime/wheels -r tools/fidelity/independentPsf.requirements.txt
cp tools/fidelity/independentPsf.runtime.json /ruta/runtime/independentPsf.runtime.json
```

Con ese entorno preparado y una carpeta de evidencia fuera del checkout:

```sh
/ruta/venv/bin/python tools/fidelity/independentPsf.py \
  --runtime-manifest /ruta/runtime/independentPsf.runtime.json \
  --out /ruta/evidencia/nueva --cases all
/ruta/venv/bin/python tools/fidelity/independentPsfVerify.py \
  /ruta/evidencia/nueva/reference.json > /ruta/evidencia/nueva/raw-verification.json
tools/workspace/run.sh npm run fidelity:psf -- \
  --input /ruta/evidencia/nueva/reference.json \
  --verification /ruta/evidencia/nueva/raw-verification.json \
  --out /ruta/evidencia/nueva/comparison.json
```

`--spacing-scale 0.5` adquiere un control con doble densidad de perfiles. El
generador no sobrescribe una carpeta; el comparador tampoco sobrescribe un
informe. El verificador enlaza posiciones y envolventes JSON con arrays NPZ,
además de los hashes. Cambiar un perfil manteniendo intacto el NPZ debe fallar.
El recibo comprueba consistencia de archivos, no autentica su origen físico.

Los originales, licencias, wheels, fuentes ejecutadas, comparaciones y negativos
de esta entrega están en `../fidelity-next15-evidence/`, carpetas
`reference-runtime`, `psf-pymust-v2-five-01` y `psf-pymust-v2-convergence-01`.
El fixture compacto versionado procede del focal real y prueba la extracción
sin instalar PyMUST en cada CI. Un fixture aprobado no equivale a ejecutar otra
adquisición independiente.
