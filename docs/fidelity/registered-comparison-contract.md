# Registro de la fase del receptor para comparar imágenes

**Defecto reproducido antes del cambio.** Main `8189d36` y candidato de empaquetado
`59ec993` producen shaders, poses y muestras iguales, pero solo 3 de 18 pares PNG
iguales al fijar únicamente t=30 s y seis cuadros medidos. El cine registra números
de cuadro diferentes: la pasada axial toma el ruido del receptor de ese número.
`setScene` vacía historias, pero conserva el contador. Con registro explícito
mediante renders ordinarios, los 18 pares y un control basal repetido son idénticos.

**Mecanismo y predicción.** El protocolo de comparación puede solicitar el primer
número de cuadro de su historia. Observa el número real mediante el cine público,
completa los cuadros previos con `sim.render()` sin avanzar la fisiología y reinicia
las historias antes de la adquisición. El calentamiento de `frameCostMs` cuenta
como primer cuadro; n mediciones producen n+1 cuadros. El protocolo registra
principio, final y relleno, y comprueba el número real al terminar.

**Invariantes.** No se modifica contador privado, ruido, semilla, reloj, imagen,
anatomía ni procesamiento de producción. Las historias adquiridas deben coincidir
en serial, pose, ajustes, muestra y semilla. Fallar deja el caso congelado. Color y
modo M quedan fuera: este protocolo es B-mode, no una prueba de Doppler ni cine
respiratorio. Las comparaciones anteriores sin fase registrada se conservan como
diagnóstico; no certifican equivalencia de píxeles.

**Refutación y aceptación.** Rechazar solicitudes fuera del dominio acotado o ya
sobrepasadas y cualquier serial inesperado. Demostrar en navegador que dos
arranques con distinto trabajo previo divergen sin registro y coinciden al
registrarse; conservar PNG, parámetros y muestras. Probar errores de reloj,
render y contador. CI exacta y revisión requerida antes de integrar.

**Límite.** Igualdad del framebuffer bajo la misma GPU demuestra control del
experimento, no fidelidad clínica ni identidad entre GPUs. Los barridos reales,
poses vecinas, artefactos, referencias independientes y panel humano siguen siendo
necesarios. Este contrato precede a la implementación y no certifica los candidatos
anatómicos anteriores; deben repetirse con el protocolo nuevo.

## Corrección del coste tras refutación CI

CI37652959449 (6a7ded2, intento1) agotó20min en ambos perfiles al rellenar120–122cuadros. Ensayo nuevo: congelar inmediatamente tras dos cuadros/hooks; registrar33–39, siete cuadros con las mismas aserciones. Rechazar exceso igual que antes. Distribuir cuatro ventanas×dos perfiles, sin reducir cobertura ni cambiar20min por trabajo. La e2e mantiene11cuadros extra en el control negativo y su presupuesto original. El render ordinario y todos los invariantes se conservan. No atribuir el coste de relleno a rendimiento clínico; registrar padding y frameMs. Conservar el banco129–135 y las capturas parciales fallidas, sin compararlos como si tuviesen la misma fase. Este contrato precede al nuevo ensayo.
