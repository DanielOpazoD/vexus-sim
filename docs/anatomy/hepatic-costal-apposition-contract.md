# Contrato previo: apposición costal y cortical visible (183)

Defecto: en la versión local 6d332a9, el relleno se llama mesenterio sobre
el hígado. La corrección 182 evita ese nombre pero deja la separación física.
En los rayos 227-before-rays, la pared termina a 28,5 mm y el hígado comienza
hacia 58,5 mm. Algunas costillas profundas tienen sombra sin dueño cortical.
El marcador de la pose intercostal atlas apunta hacia anterior.

Mecanismo: ajustar sólo el contorno cutáneo estimado del adulto atlas en el
territorio lateral hepático, con capas de pared de espesor configurado para el caso,
acercando la cara interna al contorno hepático registrado. Mantener intactos
los campos y superficies de todos los órganos/vasos/costillas. Proteger la
contención de otros órganos y hueso con testigos independientes. No cubrir el
hígado con una extensión de grasa ni agrandarlo para forzar el encuadre.
La reconstrucción de piel/pared sigue estimada y debe declararse: no es una
segmentación nueva ni una medida poblacional. Rechazar el ajuste si encoge
visceras, expone corticales a la piel o desplaza falsas capas al espacio costal.

Predicción/refutación: contacto lateral de pared/parénquima con discrepancia
compatible con el campo de 1,5 mm, sin mesenterio en trayecto. Auditar fuera
del retículo del ajuste. La cortical tendrá interfaz antes del primer hueso y
sombra después, con normales/campos CPU/GPU concordantes. Mantener entrada y
atenuación ósea; no pintar arcos decorativos. Invertir orientación intercostal
mediante una pose rígida equivalente (yaw−π, rock/tilt invertidos), conservando
el plano y señal para el cambio de marcador. Recalibrar después la pose atlas
sobre la pared ajustada para acceder entre costillas, sin mover el órgano.
El extremo marcado queda hacia posterior. Coronal renal/cava
mantienen marcador craneal; la orientación depende del plano, no de toda la
exploración abdominal.

Aceptación: controles negativos del punto de contacto y cortical; fuente
BodyParts3D ya fijada, marco común en mm; distancias/capturas de la aplicación
real con rotación, abanico y basculación. Tipos, pruebas pertinentes, calibración,
build con presupuesto sin relajar. No sustituir CI SwiftShader por Metal.
Fuente primaria técnica: ACEP Sonoguide E-FAST, apartado intercostal oblicuo,
https://www.acep.org/sonoguide/basic/fast (marcador hacia axila posterior);
ACEP Sonoguide Lung, https://www.acep.org/sonoguide/basic/lung (costillas,
pleura y sombra). Revisión externa clínica permanece pendiente.
