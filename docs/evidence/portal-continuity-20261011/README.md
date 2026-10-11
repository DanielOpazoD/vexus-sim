# Contacto coherente durante movimientos entre pasos físicos

Fuentes adquiridas:32f1c6b antes y362b09d después, ambos sobre atlas34. Este
informe posterior no cambia el SHA de las capturas. Los campos anatómicos,
vasos, haz y física son idénticos; se recupera la sincronización de PR233.

- Doce adquisiciones frescas: A/B, basal/z+2mm/tilt+1°, t30 y fase del receptor
  registrada. Los seis pares B-mode/campo Doppler son idénticos después de
  estabilizar contacto. El control incluye equipo y fisiología iguales por caso.
- Dieciocho movimientos entre pasos por fuente, tres ventanas y seis mandos.
  La imagen se genera sin avanzar el reloj. Antes, el marco inmediato difiere
  del contacto al próximo paso: hasta0,825mm de cara y1° de eje. Después, diferencia
  cero. El ángulo se mide con atan2 de producto vectorial y escalar, evitando
  error de acos al comparar vectores idénticos.
- Ciento ocho gestos reales de ratón y sliders, A/B y nueve ventanas: respuestas
  de los seis mandos, marco/contacto coherentes e imagen visible. Se guardan
  poses suministradas, reloj y duración host. No se expone la pose adquirida en
  el cine de esta fuente; no se inventa metadato de adquisición.
- Tres pruebas nativas Playwright/Metal pasan a la primera, sin reintentos ni
  inestabilidad. La prueba de coherencia falla sobre0c en los tres dominios;
  la recuperación parcial detecta el módulo angular innecesario; doce controles
  focalizados pasan con la corrección completa.

`registered-contact-controls.json` conserva medidas y huellas de señal;
`controlled-after-gallery.png` muestra las seis adquisiciones posteriores.
**La pérdida de rama en las poses vecinas persiste.** Corregir el desfase de
adquisición no corrige ni valida geometría vascular, salida del plano, espesor
elevacional o muestreo de volumen parcial del Doppler.

La inspección es interna y no certifica60fps, reconocimiento por ecografista,
TAC vascular independiente, normalidad ni validación hemodinámica. La CI del
SHA0c falló en las tres adquisiciones venosas independientes, al arrancar atlas
con SwiftShader. No se pidió reintento ni se ampliaron límites. PR236 permanece
en borrador y nunca debe fusionarse contra la base temporal34: requiere
reconciliar con main y revisar la CI exacta de una corrección nueva.
