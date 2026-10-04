# Continuidad física del volumen de muestra PW

## Defecto y corrección

El espectro deriva de dispersores espaciales → IQ compleja → filtro de pared →
STFT. La frecuencia se calcula como fD = 2 f0 v_axial / c. En la implementación
anterior, la sensibilidad espacial se actualizaba mediante rampas cada ocho
pulsos; la renovación de sangre perdía el sobrepaso de la cara del volumen y la
frecuencia de un dispersor nuevo podía permanecer temporalmente en cero.

Un fantoma de sangre con velocidad constante demostró dos efectos numéricos:
réplicas de banda ancha y densidad ponderada dependiente de PRF/velocidad, sin
haber cambiado ni el caudal ni el volumen de muestra. Se corrigen en la señal:

- Advección, cruce de la cara y sensibilidad espacial evaluados en cada pulso.
- Reentrada conserva el sobrepaso en la misma cuerda, en lugar de concentrar
  partículas a una distancia fija de la cara opuesta.
- Frecuencia inicializada antes de contribuir el primer pulso del dispersor.
- Movimiento tisular reconstruido linealmente dentro de cada paso fisiológico;
  mantener su desplazamiento fijo durante 4 ms creaba escalones en el peso del
  tejido brillante al evaluar la sensibilidad por pulso.

No cambia el modelo circulatorio, la distribución de velocidades, el número de
dispersores, la PRF, el filtro de pared, la FFT o las reglas de captura.

## Verificación independiente

`pwTransportContinuity.test.ts` utiliza sangre uniforme, sin dispersión angular,
con velocidades de 100/300 mm/s y PRF de 2000/4000 Hz. La anchura del entorno
permitido contempla el ensanchamiento físico por tránsito; no exige una línea
infinitamente fina. Dos semillas verifican la regresión de renovación rápida.

- Código previo: percentil 95 de energía fuera del entorno ≈ −20 dB y razón de
  densidad máxima/mínima 1.1364. Falla los contratos nuevos.
- Contratos: energía inferior a −30 dB en 95 % de columnas y razón de densidad
  inferior a 1.03; frecuencia observada por centroide circular a menos de un bin
  de la ecuación Doppler, incluidos flujo inverso, 60° y cruce de Nyquist.
- Tabla de sensibilidad compartida de 32 KiB: interpolación lineal con error
  adicional absoluto <1.2e-7 frente a erf directa, verificado en 100001 puntos.
  Reduce el coste de exponenciales manteniendo evaluación en cada pulso.

La primera tentativa sin interpolación tisular falló dos contratos respiratorios
existentes: las capturas se rechazaban con motivos incorrectos. Se corrigió el
muestreo del tejido, sin ampliar las listas admitidas ni relajar umbrales. Las
matrices completas se ejecutan de nuevo sobre el candidato de integración.

Auditorías reproducibles:

- `node --import tsx tools/fidelity/pwContinuityAudit.ts /tmp/pw-continuity.json 41`
- `node --import tsx tools/fidelity/pwRespiratoryRegressionAudit.ts`

## Límites y fuentes

Esto valida invariantes numéricos, no exactitud clínica. Siguen las aproximaciones
de sensibilidad separable, campo local de velocidad, renovación por cuerdas y
reclasificación geométrica parcial. No es una simulación de onda acústica completa,
CFD ni Field II. La calibración clínica del visor comparativo sigue pendiente y
esta corrección independiente no la declara resuelta.

Referencias para la separación entre física de flujo, señal y estimación:

- Field II, simulación PW con dispersores móviles y adquisición RF:
  https://field-ii.dk/examples/pw_example/example_pw_phantom.html
- Ensanchamiento por tiempo de tránsito:
  https://pubmed.ncbi.nlm.nih.gov/16555761/
- Flow spectra from spectral power density calculations for pulsed Doppler:
  https://www.sciencedirect.com/science/article/pii/S0041624X02002238
