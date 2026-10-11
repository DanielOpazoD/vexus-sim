# Diagnóstico del atlas,11 octubre2026

Esta iteración recupera observabilidad de main/PR234 en la revisión atlas34 del PR236. No se acepta una optimización de coste, una mejora anatómica ni máxima fidelidad. La fuente capturada final es33a6685333ee5d7649d81a1dadfb01e84f592b11. Los shaders y guardas originales4c2892c fueron restaurados byte a byte; `restored-source-proof.json` lo demuestra.

## Bloqueo y experimentos rechazados

El primer arranque SwiftShader4c falla a180,353s sin hooks/dos cuadros. Una lectura compatible de un píxel por pasada, con RAF suspendido, no completa A0/transmissionHits dentro de210s; ninguna pasada posterior ejecuta ese instrumento. Los tiempos JS/gl.finish previos se rechazan como finalización GPU. Un perfil del proceso GPU muestra trabajo en SwiftShader; sus símbolos optimizados no separan compilación de ejecución. Mac no equivale al corredor Linux.

Tres ensayos de coste se conservan y retiran: omitir metadatos de cara no consumidos(320e522), unificar el sitio de clasificación/marcha/bisección(25978ad), y derivar la cota exterior de la rejilla(689bcc6). Los dos primeros fallan a180s. El tercero emite segundo cuadro y hooks, pero bloquea la página después de navigator:construct y vence el presupuesto original de la prueba240s más finalización. No hubo arranque comprobado ni rerun de CI. No se modificaron plazos, muestras, resolución, anatomía, presupuestos o protecciones para obtener aceptación.

El fantoma nativo del ensayo unificado compara70 casos y53.760 valores iguales al cuerpo anterior. SwiftShader falla en la referencia de dirección a trigonometría doble. El instrumento posterior conserva además una contradicción de reflexión:50,712890625 frente a50,674004448mm en el plano50mm,coarse32,depth120,line22. No se amplió ninguna tolerancia. Este banco no acepta calibración clínica y la causa de la discrepancia sigue sin demostrar.

## Controles de adquisición

El control nativo de arranque33a6685 pasa en23,058s, primera tentativa, Metal AppleM4, sin errores. No sustituye SwiftShader ni CI.

La primera comparación portal falla porque la referencia retenida usaba1600×1100 y la nueva1280×800; las dimensiones B son1032×971 y712×671. Los seis campos Doppler registrados y entradas coinciden; el hash B no es comparable. Se conserva toda esa adquisición y su fallo.

Otros dos protocolos fallan porque la adquisición viva supera la fase256 mientras el host espera acciones UI. Se observó carga de sistema205,92/91,25/69,17; el trabajo ajeno se preservó. No se demuestra que esa carga sea la única causa del fallo. El protocolo siguiente congela con el botón real al estar disponibles hooks/dos cuadros, permite animar la pose congelada y después adquiere con reloj30s y fase256 más8cuadros. Mantiene las guardas originales, sin reiniciar fase ni alterar tolerancias. Es un control prescrito, no un barrido manual.

El control portal con dimensiones iguales y congelación temprana pasa: seis adquisiciones frescas A/B y basal/z+2mm/tilt+1°, comparadas con seis retenidas de362b09d. B y campo Doppler serializado coinciden por SHA256; pose, equipo, estado físico, reloj, receptor y dimensiones también. No se fuerza la permanencia de ramas en el plano.

Las nueve ventanas se registran por separado con antes y después frescos. El resultado final y el check exacto deben consultarse en `current-evidence.json`; esta descripción no convierte una prueba parcial en aceptación de las nueve ventanas.

## Inspección y límites

La captura portal muestra flujo rojo, sin error UI observado; conserva salida de rama en vecinos y bordes capsulares segmentados. Igualdad de imagen sirve como control del observador, no como certificado ecográfico. No se realizó aquí un nuevo barrido manual continuo, ni se certifican60fps o todo el dominio. Los108gestos y cines de la iteración362 son evidencia histórica de su fuente, no de una corrección nueva.

Continúan pendientes compartimento posterior renal/retrohepático, pared–hígado–diafragma, sombras costales, desembocadura suprahepática y registro vascular TAC. La anatomía compartida se mantiene: no se borran tejidos por ventana ni se dibujan patrones color para ocultar defectos. Las fuentes TAC actuales requieren confirmar raíces, registro espacial y revisión humana externa antes de adoptar geometría vascular.

PR236 continúa en borrador contra una base temporal34; no es integrable ahí. main18 y atlas34 conservan conflictos que exigen reconciliar ambos lados. Toda la CI del SHA final, incluido el agregado, debe pasar en primera tentativa antes de integrar. Localhost3024 mantiene la revisión32f1c6b anterior, sin sustituirla por ensayos fallidos.
