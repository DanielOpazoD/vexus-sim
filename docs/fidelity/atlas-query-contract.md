# Consulta anatómica del atlas sin arrays por punto

La ecografía, el plano anatómico, las puertas Doppler y el torso conservan los
mismos campos y superficies. Este cambio reduce trabajo de consulta CPU: no
crea coordenadas, índices y pesos como arrays ni una función de indexación por
punto; la consulta de distancia no construye un objeto ni lee la etiqueta.
El Worker de plano anatómico conserva su resolución, frecuencia y watchdog.

## Contrato numérico

`sourceVolume.ts` consulta el mismo RG16F en su marco material. La distancia usa
los mismos ocho nodos, pesos trilineales y orden x→y→z. La etiqueta usa el nodo
más cercano, incluidos los límites finales del ladrillo. Distancia saturada16
en el interior no equivale a etiqueta0. Fuera del soporte devuelve16/0.
`HALF` mantiene su exportación anterior y se inicializa una sola vez.

Los dos lectores, abdominal y torácico, comparten esta consulta. No se añade
una representación anatómica ni se interpola la identidad. El GLSL y los bytes
de órganos, huesos, cuerpo y superficies permanecen idénticos. La equivalencia
numérica no constituye validación clínica ni corrige la anatomía posterior.

## Verificación reproducible

```sh
node --import tsx tools/fidelity/atlasQueryAudit.ts \
  /ruta/checkout-base /ruta/checkout-candidato /ruta/informe.json
```

Requiere dependencias del lockfile y dos checkouts legibles. Carga sus módulos
reales y campos, exige hashes idénticos de anatomía/GLSL y registra SHA, diff,
Node y CPU. Compara distancia, etiqueta y gradiente en puntos deterministas,
caras, límites y exteriores. Contrasta la clasificación completa en las nueve
ventanas y cinco poses vecinas, normal y congestión grave. Es una comparación
material con calibre basal; el desplazamiento de presión de la pose no activa
por sí solo el operador físico de compresión.

Mide seis lotes intercalados del lector, después de calentamiento explícito,
y cuatro lotes de clasificación96×128 por ventana y caso, invirtiendo el orden
antes/después. Registra todos los lotes. No es el coste completo del Worker,
el arranque del navegador, FPS ni una prueba de ausencia de saltos de imagen.
Las capturas comparables y movimientos reales complementan este instrumento;
no basta que un test pase para aceptar fluidez.

La guarda analítica `sourceVolume.test.ts` usa un campo afín independiente con
ladrillo desplazado, etiquetas discretas, última celda y vecinos ajenos. Las
pruebas de los atlas y adquisición, `npm run check` y `npm run calibrate` se
conservan. Las tolerancias, presupuestos, protecciones y CI no se modifican.

## Límite de esta iteración

El atlas completo continúa dependiendo de PR219 y del arranque en SwiftShader.
Esta optimización CPU no se presenta como solución de ese bloqueo GPU.
La importación de músculos paravertebrales necesita saneamiento de su fuente
y reconciliación de contactos: el diagnóstico CGAL encontró75 pares de cruces
en el componente principal de cada longísimo fuente. No se importan superficies
inválidas para mejorar una captura.
