# Arranque del atlas: diagnóstico antes de optimizar

Base7fba26e, atlas34; main18e3ff3. El PR236 permanece en borrador contra una
base temporal. Las tres ejecuciones venosas independientes del SHA7f agotan
180s antes de hooks/dos cuadros, igual que0c. No se repite ninguna ejecución.

Observable: última etapa real de composición, inicialización, primer avance,
ecografía y torso, registrada en el host incluso cuando no se cargan hooks.
Se recupera el mecanismo ya integrado de main/PR234, sin alterar anatomía,
fisiología, imagen, calidad, controles, reloj, budgets ni plazos.

Predicción refutable: con el diagnóstico activado aparecen etapas únicas en
orden causal; sin él no se consulta el reloj del diagnóstico ni se emite un
evento. Un bloqueo inducido conserva la última etapa completada y no inventa
la siguiente. Las adquisiciones comparables antes/después son idénticas.

Experimento: primer arranque con SwiftShader sobre el atlas, mismas opciones
de GPU que el proyecto y límite180s; navegador nativo como control distinto.
Registrar versión, opciones, recursos, eventos, errores, duración host y estado
físico. El Mac no certifica el corredor Linux. Si no se reproduce el mismo
bloqueo, se conserva el límite de transferencia y se investiga la CI nueva
del código instrumentado, sin reintentar para obtener verde.

Solo se optimiza un coste localizado por medición. Se compara antes/después
sobre campos y adquisiciones comunes, incluyendo B/color, poses vecinas y
controles fuera del atlas. No se eliminan órganos ni se reduce resolución para
ocultar el problema. Los seis timeouts locales de check7f se conservan y se
perfilan por separado; un check posterior no borra ese resultado.

Aceptación de integración: conciliación con main preservando ambas versiones,
PR listo, sin conflictos ni solicitudes pendientes y CI completa del SHA
exacto en su primera tentativa. El diagnóstico no acepta por sí solo fidelidad
anatómica, continuidad global, Doppler externo ni el objetivo clínico.
