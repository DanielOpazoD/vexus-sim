# Filtro color y frecuencia muestreada

Defecto antes de implementar: wallResp evalúa la frecuencia Doppler física sin plegar, mientras el estimador de fase ya muestrea a PRF. Dos señales indistinguibles (f y f+PRF) reciben distinta potencia. En f=0 y corte=0 calcula 0/0 y contamina la correlación con NaN.

Mecanismo: evaluar el mismo filtro aproximado de cuarto orden en el dominio periódico de frecuencia muestreada, con identidad exacta al desactivarlo. Compartir TS y GLSL desde un módulo pequeño. No cambiar caudal, velocidad, color-map, máscara, ganancia ni fase del estimador. La potencia de clutter estacionario sin filtro debe poder aparecer: no esconderla mediante la anatomía.

Predicción: f+n·PRF conserva respuesta; a múltiplos de PRF el filtro activo suprime la señal aliased a DC; filtro desactivado retorna 1 finito incluso en DC. Se conserva la respuesta actual dentro de Nyquist y la supresión por corte alto.

Refutación y aceptación: oráculo independiente con secuencias IQ muestreadas y fase de correlación, barrido positivo/negativo de múltiplos PRF, cero/corte alto; compilación GPU real con puntos sintéticos conocidos y captura portal adquirida normal/grave en dos cuerpos. Documentar modelo de filtro estimado, no afirmar filtro temporal clínico medido. Un KiB de crecimiento máximo explícito si el presupuesto actual 1030,0 KiB lo exige; no quitar partidas.

Base: Evans, Jensen y Nielsen (2011), Ultrasound colour Doppler imaging, https://pmc.ncbi.nlm.nih.gov/articles/PMC3262272/. La periodicidad también es identidad de muestreo exp(i·2π·f·n/PRF); la fórmula de respuesta sigue siendo aproximación propia.
