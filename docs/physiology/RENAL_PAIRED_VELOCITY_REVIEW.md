# Revisión de velocidades renales pareadas

Revisión personal del 4 de octubre de 2026 sobre el árbol de producto del PR171.
El usuario observó una vena excesivamente rápida respecto a la arteria en una
captura cuya etiqueta de alumno «Paciente B» no explicitaba congestión grave.
La etiqueta ciega pertenece al ejercicio; las capturas de revisión deben usar
modo docente e identificar siempre el escenario.

## Qué se comparó

`node --import tsx tools/fidelity/renalPairedAcquisitionAudit.ts baseline`
reproduce dos pacientes, dos cuerpos y tres posiciones. `plane` explora pequeñas
inclinaciones con margen de pared 1,2 mm; `edge` permite 0,2 mm para estudiar el
volumen parcial. Son diagnósticos offline; no cambian los presets ni los caudales.
La puerta arterial a −2° coincide con la captura enviada al propietario. Se usa
la semilla del paciente, apnea, 30 s de estabilización, 8 s de IQ, Nyquist 50 cm/s
y filtro 25 Hz. Se informa el percentil temporal 97 de la envolvente de cada
semiplano, no un detector clínicamente validado de PSV/EDV.

En esa puerta del cuerpo legacy: sano, arteria 29,7 y vena 10,2 cm/s; congestión,
arteria 26,6 y vena 21,9 cm/s. En el cuerpo de referencia: 32,0/9,4 y 29,7/22,7.
La adquisición dominada por vena, en otra puerta legacy, da 21,1/25,8 en el grave:
no se pueden mezclar los valores de dos puertas como si fueran un par simultáneo.
La captura automática rechaza la puerta arterial dominante por identificación
incierta; este rechazo no borra el espectro que puede inspeccionar el operador.

## Interpretación y límites

- La fracción territorial del 5 % multiplica ambos caudales interlobares. Cambiarla
  otra vez no identifica por sí solo la causa de una proporción arterial/venosa.
- La velocidad deriva de Q/A y un perfil radial, y después de su proyección sobre
  el haz. El área de referencia, la transmisión, el plano y la posición dentro
  del volumen de muestra condicionan la envolvente observada.
- El motor actual concentra el drenaje grave en diástole. En el banco previo del
  mismo modelo, Q renal venoso total osciló entre −10,2 y 57,4 mL/s, con media
  18,9; esos números describen el modelo, no valores humanos validados.
- Las venas y arterias representadas están separadas en elevación. La ventana
  que maximiza señal venosa puede captar poco del centro arterial. Un pequeño
  cambio de plano modifica el par observado sin cambiar la fisiología.
- Los barridos no identifican todavía un preset pareado superior en ambos cuerpos.
  No se adopta la combinación que haga la imagen más atractiva ni se impone
  «vena = fracción fija de arteria» o un techo universal de 30 cm/s.

## Contraste clínico primario

Yoshihisa et al. (2020), 341 pacientes con insuficiencia cardíaca, midieron VTI
arterial interlobar y patrones venosos simultáneos. La figura 3 aporta ejemplos
pareados y separa hipoperfusión de congestión; no establece un cociente universal
entre sus picos. DOI: 10.1038/s41598-020-79351-6.
https://pmc.ncbi.nlm.nih.gov/articles/PMC7746684/

Yoshihisa et al. (2022), 388 pacientes con insuficiencia cardíaca, presentan en la
figura 1 patrones continuos, bifásicos y monofásicos con RVSI. Los ejemplos muestran
variación de las alturas relativas; el foco es tiempo sin drenaje, no una
calibración poblacional de velocidad D. Se revisó la figura original, no solo
el resumen. DOI: 10.3389/fcvm.2022.772466.
https://pmc.ncbi.nlm.nih.gov/articles/PMC8934863/

Ambas figuras son referencias, no texturas del simulador. No se extrapolan
velocidades de perros, embarazadas o venas pulmonares a este adulto virtual.
No se confunde la escala de color de 10–20 cm/s con el pico de una onda PW.
La calibración clínica permanece abierta y requiere más que consistencia numérica.

## Ventana opcional del visor

La adquisición comparada mantiene la puerta venosa como opción inicial. La opción
«Par arteria/vena: inspección» reproduce la pose auditada de −2° y búsqueda de
arteria interlobar, con margen de pared de 0,2 mm y puerta de 4 mm. La opción
venosa conserva su margen de 1,2 mm. Cambia geometría de adquisición, no caudal,
área vascular, perfil de velocidad ni ganancia relativa.

No se fuerza que la vena alcance una fracción predeterminada de la arteria. La
captura automática conserva el control de identidad: el predominio arterial puede
invalidar una medición venosa aunque el par sea útil para inspección visual. Las
otras dos adquisiciones y la fisiología permanecen iguales. Esta selección no
reemplaza la calibración pendiente ni la habilidad de obtener una puerta venosa.
