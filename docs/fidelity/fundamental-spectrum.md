# Referencia independiente del espectro fundamental

Componente de desarrollo del bloque 4. Es un oráculo matemático escalar, sin cambios
en la imagen, aplicación o dependencias de producción. No es calibración de un
convexo comercial ni validación clínica. Reutiliza el entorno offline de la
[referencia puntual B1](independent-psf.md) y su lector de mitad de amplitud.

## Contrato físico

Frecuencia en MHz (ciclos/µs), tiempo relativo en µs, longitud de ida en mm y
velocidad de sonido de 1,54 mm/µs. La fuente efectiva pulse-echo fundamental tiene
espectro de **amplitud** gaussiano centrado en 3,5 MHz, banda a mitad de amplitud
de 45 % (−6,0206 dB). El filtro electrónico de recepción es otra gaussiana, separado
del pulso y de la propagación; se fija para reproducir σ axial 0,26 mm en la cara.
Estos son parámetros de control genéricos, no mediciones de un equipo real.

Cada capa multiplica amplitud por `10^(−alpha·(L/10)·f/20)` en cada paso. El camino
recíproco usa dos pasos. Al multiplicar una gaussiana por una atenuación lineal en
frecuencia, su centro y nivel cambian, pero su varianza de eje completo no cambia.
Un receptor fijo tampoco convierte ese cambio de centro en un estrechamiento
automático de banda. El ancho de potencia tiene otra varianza, la mitad. Una pérdida
fija cambia nivel, sin convertirse en pendiente espectral.

La referencia multiplica las capas directamente sobre frecuencias **positivas**;
contrasta momentos contra la gaussiana truncada, e inversa por cuadratura directa
contra IFFT. Mide FWHM de la envolvente lineal y conserva el intervalo de celdas.
El caso próximo a DC demuestra por qué la gaussiana completa no siempre sirve.
El ruido blanco introducido después del paciente sólo atraviesa el receptor,
con potencia/momentos comprobados independientemente de fuente y camino.

La derivación lineal coincide con las ecuaciones 9–13 de
[Chen y Zagzebski, 2004](https://www.brl.uiuc.edu/brp/pdfs/Chen-UMB-1297-2004.pdf).
El [resumen de Samimi y Varghese, 2015](https://pubmed.ncbi.nlm.nih.gov/25965681/)
explicita convenciones de potencia y ruido; su texto completo no se presenta como
leído. No se trasladan sus varianzas a amplitud sin conversión.

## Resultado y negativo conservado

Once casos y tres rejillas: cara, hígado, líquido, capas partidas/reordenadas,
un paso, pérdida fija, receptor estrechado, sin receptor y estrés próximo a DC.
Los seis contrafactuales detectan amplitud tratada con 10log, retorno omitido,
pérdida fija convertida en pendiente, ruido a través del paciente o fuente y
confundir el perfil racional actual con un receptor fijo.

La primera corrida falla dos de 378 comprobaciones: error de varianza
`1,27218e−8 > 5e−9`, y diferencia de anchura de estrés DC
`4,61124e−6 > 2e−6 µs`. Se conserva como fallida. V2 sólo divide el paso de
frecuencia por dos (1/256 y 1/512 MHz): mismo código, límites, casos y máximo IFFT
2¹⁹. Pasa 378/378; el cálculo tomó 0,444 s en el entorno registrado. No se subieron
tolerancias ni se recalibró el perfil. `fundamentalSpectrum.v1-negative.json` es
un extracto trazable, no el informe completo del negativo.

Con receptor fijo, 100 mm de hígado llevan el centro de 3,5 a 3,19256 MHz,
manteniendo FWHM axial ≈0,612253 mm. El receptor estrechado produce ≈0,970015 mm.
Esto describe el modelo escalar declarado, no prueba ancho constante en un cuerpo
real. La ley racional productiva representa una hipótesis adicional de seguimiento
que debe separarse de la propagación antes de sustituirla.

## Reproducción sin dependencias nuevas de aplicación

Usar el entorno opcional B1 ya fijado (Python 3.13.5/NumPy 2.3.4 registrados) o preparar
uno según su documentación. No se instala Python/PyMUST en CI. Las salidas deben ser
rutas nuevas; una corrida nunca sobrescribe anteriores.

```sh
/ruta/runtime/venv/bin/python tools/fidelity/fundamentalSpectrum.py \
  --spec tools/fidelity/fundamentalSpectrum.spec.json --out /ruta/evidencia/nueva
/ruta/runtime/venv/bin/python tools/fidelity/fundamentalSpectrum.py \
  --extract-fixture /ruta/evidencia/nueva --out /ruta/evidencia/fixture.json
```

La extracción lee los originales, verifica hashes/inventario/378 controles y
recalcula sus momentos y anchura desde los arrays guardados, sin otra inversa.
Guarda las 11 medidas y 129 muestras complejas existentes de cuatro casos, con
índices exactos, unidades y amplitudes intactas. No interpola, normaliza ni genera
gaussianas para fabricar el fixture. Rechaza una corrida fallida y un resumen JSON
alterado aunque el NPZ y su hash permanezcan válidos. La extracción registrada
tomó aproximadamente 0,30 s; se verificaron además las 516 muestras contra el NPZ.
La identidad numérica de la extracción se comprueba en el runtime fijado; si otra
plataforma difiere, diagnosticar antes de relajarla.

Los tests TypeScript reutilizan `envelopeFwhm` sobre ese fixture, sin repetir la
adquisición ni instalar NumPy. El intervalo de la muestra decimada se diferencia
de la FWHM de la rejilla completa; más relleno con ceros no implica más resolución
física. Un fixture aprobado no demuestra que otra ejecución del oráculo ni la
implementación productiva sean correctas.

Los originales completos están fuera de Git en
`../fidelity-next15-evidence/b4/oracle-run-01` y `oracle-run-02`, con hashes y copia
exacta del script/spec ejecutados. El fixture versionado es **desarrollo observado**;
no se reclasifica como reservado. Los hashes acreditan integridad, no origen físico.

## Siguiente consumidor y límites

A1 ya etiqueta el tejido de cada segmento. El futuro prefijo espectral debe sumar
pendientes materiales antes de promediar apertura y separar gas, entrada ósea y
espejo; no puede deducirlas dividiendo una pérdida total por la frecuencia. La
absorción del tejido óseo sí conserva su pendiente. Tejidos con exponente `b≠1`
requieren comprobar la curva/curvatura: una derivada local no hace exacta una ley
lineal sobre toda la banda.

No se añade una función productiva sin consumidor. La futura implementación deberá
compararse con este mismo banco, fijando su fuente mediante `buildSource`, y
mantener coherencia de centro, núcleo axial, fase, PSF lateral y ruido receptor.
No se confunde el camino de emisión de una vía con el eco filtrado de dos vías.
THI continúa abierto: una fuente armónica distribuida no se resuelve con `k/2`.
Doppler, apertura espacial, refracción, dispersión e imagen clínica quedan fuera
de esta referencia. PICMUS físico y PyMUST espacial tienen otros metadatos y no
se mezclan aquí como calibración directa de un convexo 3,5 MHz.
