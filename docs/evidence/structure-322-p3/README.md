# Decisión 322.3: recibo local de la frontera por persona

Base funcional: r3 `5d79321`. La revisión independiente de `15733a8` encontró dos fallos: el rechazo del import CPU del Worker no se mostraba y 35/39 programas transformados cambiaban frente a main. Esta corrección rebasa sólo los commits propios sobre `8ed26cf` (#338 y #340 fusionadas), regenera la ABI desde esa base limpia y muestra el error del Worker. Este recibo acredita pruebas locales; la nueva CI protegida y la revisión independiente siguen siendo la puerta de aceptación. No es validación clínica.

El propietario pausa la instalación de nuevas fases s0028. Este cierre recupera **41.283 B de JS default frente a main `8ed26cf`** (41.356 B frente a r3), dejando **41.576 B de margen para mejoras del default**. Por decisión del propietario, ambas clausuras conservan el techo de main de **1.070.080 B**; se rectifica la reducción provisional del default. Las pruebas aceptan exactamente ese límite y rechazan 1.070.081 B en cualquiera de las dos personas. [Medición vigente de los dos presupuestos](closures.json); [negativo del techo reducido](../INDEX.md#structure-322-p3-impl-default-ceiling-20261106-red-log).

El gancho de esta rectificación detectó una expectativa dependiente de la carga en `personWorker`: una fila de más de 16 ms publica `progress`, que la prueba rechazaba. Se conserva el [fallo reproducido con reloj controlado](../INDEX.md#structure-322-p3-impl-default-ceiling-20261106-worker-progress-red-log). La prueba comprueba ahora las dos secuencias exactas, con y sin progreso, incluida la fila completada, el último mapa y su identidad; no cambia el Worker ni sus plazos.

## Clausuras de JavaScript

Se incluyen imports estáticos y diferidos, hooks, preloads HTML, Worker y worklet. Sólo se poda la entrada de la otra persona. Cada archivo se cuenta una vez por ruta; se rechaza cualquier JS huérfano o módulo duplicado. La comprobación relee los bytes finales de `dist` y sus hashes.

| Medida               |        r3 | Main `8ed26cf` |   Después |     Techo | Margen |
| -------------------- | --------: | -------------: | --------: | --------: | -----: |
| Default              | 1.069.860 |      1.069.787 | 1.028.504 | 1.070.080 | 41.576 |
| s0028                | 1.069.860 |      1.069.787 | 1.066.204 | 1.070.080 |  3.876 |
| Unión de ambas rutas | 1.069.860 |      1.069.787 | 1.078.446 |         — |      — |
| Compartido           | 1.069.860 |      1.069.787 | 1.016.262 |         — |      — |

No hay módulos privados s0028 en default. Los 12.242 B exclusivos de default se descomponen en CPU (10.126), runtime (1.631) y superficies (485). Salen de la clausura s0028 `classifyKidneys`, `kidneyQuery`, `kidneySinusSdf`, `atlasDepthScale`, la clasificación perirrenal/Gerota, el clasificador default de pared/interior y `hepaticCostalBody`. Los auxiliares geométricos aún consumidos por ambas personas y el ligamento venoso siguen compartidos. El margen s0028 no garantiza cabida para r5/P5/P8.

Descarga: 20.433.526 / 25.000.000 B. Incremento de metadatos: 3.788 / 4.096 B. No se amplían techos de JS, assets ni shaders.

## Paridad y pruebas

Los 38 fragmentos y el vértice conservan los hashes de **main `8ed26cf`**, de fuente y transformados, para default y s0028 (39/39 en cada comparación). La ABI anterior de r3 daba 4/39 transformados iguales a main; se conserva ese negativo. Un símbolo/uniform privado añadido no altera default. Fixture completa: [person-shaders-main.json](../../../src/validation/fixtures/person-shaders-main.json); mapa ABI con SHA de origen: [person-glsl-abi.json](../../../tools/build/fixtures/person-glsl-abi.json). [Recibo histórico de las correcciones](review-fixes.json), anterior a la restitución del techo default de main; las cifras vigentes están en [clausuras y hashes](closures.json).

Paridad default exacta: 82.251 puntos, 10 marcos y 30 contactos. SHA-256:

- Salida completa: `3a6c5010a3904d08d7fe5002b23a4cf579300349e218a0d3bf05ceba25e003ee`.
- Clasificación semántica: `e223ec29216fb23c8867486e82ced1149670a54b25a29fccb3642a08ede529c2`.
- Marcos: `adf6e763fd4c5cb1b6c42d546e05c9811a3e8b32b0a4640737fe7b2b122028cb`.
- Contactos: `a8b1b1dd367f1f5c958bfc2e0b71fe7dad00c348db133f757228483e88f318b9`.

La corrección añade una e2e Metal que permite el import CPU de la página y bloquea el del Worker real. Primero falla por ausencia del aviso. Después comprueba `role=alert` en modo alumno, corte inválido sin `data-acquired-frame`, misma identidad y aviso con el corte plegado. Su clic real recarga la misma selección. El primer botón quedaba capturado por el arrastre de sonda: se conserva ese fallo y se aísla `pointerdown`; la prueba final pasa en 5,2 s. El estado CPU conserva el aviso tras `ready` y tras un mapa aún no pintado, y lo retira tras pintar; ignora errores del Worker reemplazado.

Tras las correcciones: 36 archivos / 254 pruebas rápidas focales y 2 archivos / 3 lentas, incluidos s0028, shaderLimits y registros. Paridad default exacta repetida frente a main; el exportador vascular incorporado desde #338 conserva los 30 hashes binarios y los 20 planos de ambas personas. Metal: 14 verdes en el lote completo (8 navegación, default, protocolo Worker, dos fallos principales, carga y sólidos); el único fallo intermedio de recarga se repite en verde. Tras el rebase final se repite la frontera/carga/sólidos: **7/7 Metal**, sin reintentos. Sólidos: 57 filas / 144.110 puntos, interiores 66.556/66.557, renal analítico GPU 0, quiste 40/40 y conflicto grasa 29/29. Se actualiza el consumidor de P9 para publicar las dos clausuras; sus pruebas nacen rojas con la tabla antigua.

La reanudación final sobre `8ed26cf` regenera build, estado e índices y aprueba **16 archivos / 133 focales**, incluidos los contratos de persona y shaders. El lote Metal de navegación, compresión y frontera da **13/14**: un caso registra «corte sin avance durante 3 s» después de completar la paridad, con carga observada 68,82/181,05/123,39. Se conserva el negativo. Al descender la carga, la repetición explícita de los ocho casos de navegación pasa **8/8 en 1,5 min**, sin cambiar código, plazos, aserciones ni reintentos automáticos. Compresión y los cinco casos de frontera ya habían pasado. La correlación con la carga no demuestra por sí sola la causa. [Recibo de reanudación](../INDEX.md#structure-322-p3-impl-closure-20261106-2022-summary-json).

La CI de `15733a8` ejecutó `s0028Load` en SwiftShader con resultado verde en 22,871 s: `bootCompleted=true` y mapa real del Worker. Corresponde al merge de prueba `7dd1ff5`, run `42214091216`, grupo 9. Los tres fallos inspeccionados de navegación tenían un constructor del arnés sin contexto de persona; se corrigen y los ocho casos pasan en Metal. El trabajo de captura de referencia fue cancelado. No se declara verde global de esa CI ni aprobación de este nuevo head.

## Evidencia de la implementación inicial

Rojos conservados: procedencia y Worker (2 fallos), contaminación de símbolos GLSL (1), protocolo del mapa (1) y preload Vite sin DOM (3). Los tests nuevos también inyectan errores de red/evaluación y +1 B en cada presupuesto. Sus comprobaciones verdes incluyen imports tardíos que terminan fuera de orden, epochs/identidad/assetKey, buffers sin transferencia y errores visibles sin fallback.

- Focales s0028/frontera: 39 archivos y 281 pruebas; los tres fallos iniciales se corrigieron y sus tres archivos se repitieron en verde (37/37). Tras rebase: 5 archivos / 48 pruebas de shaders, clausuras, registro, mutantes y capas verdes.
- Corrida `npm test` sobre la base `12630d9`: **284 archivos, 1.976 aprobadas y cinco fallos esperados existentes**; 261,24 s, tres trabajadores. Incluía accidentalmente dos archivos lentos cuyos imports habían desplazado el marcador: la comprobación incorporada desde 322.7 lo detectó y se restauró `// @tier slow` a su primera línea, como en main; ambos habían pasado en esa corrida. El gancho final vuelve a ejecutar la capa rápida correcta. Formato completo, lint y tipos verdes; índice regenerado. `build` valida ambos presupuestos.
- **62 pares** en el registro de gemelos. **29/29 mutantes muertos por aserciones**, cero supervivientes, errores o no ejecutados; ocho módulos restaurados y árbol sin cambios, 508,8 s. [Resumen](mutants.json).
- Metal post-rebase: **6/6**, cero reintentos; ANGLE Metal Apple M4. Sólidos: 57 filas / 144.110 puntos, interiores 66.551/66.552, renal analítico GPU 0, quiste 40/40 y conflicto grasa 29/29. Incluye carga real, Worker, error de chunk y corrupción de activos. [Resultados GPU y negativos](gpu.json).

La colección E2E nativa detectó un import JSON sin atributo en el módulo ABI de build. Corregido con `with { type: 'json' }`: **54/54 focales verdes**, hashes GLSL conservados, build aprobado y **197 E2E repartidos en 12 grupos sin omisiones**. Esta colección no ejecuta la suite GPU completa.

Comandos, siempre en serie y con `nice -n 10` mediante `tools/workspace/run.sh`:

```sh
npm run mutants -- --out <evidencia-nueva>
VITEST_MAX_WORKERS=3 npm test
npm run format:check
npm run lint
npm run docs:index
node --import tsx tools/docs/decisions-index.ts --check
npm run build
npm run workspace:e2e -- --backend metal --out <evidencia-nueva> -- e2e/personBoundary.spec.ts e2e/s0028Load.spec.ts e2e/s0028SolidsGpu.spec.ts
```

SwiftShader usa el mismo runner, `--backend swiftshader`, un trabajador y cero reintentos. La variante x64 emplea Chromium headless shell revisión 1243 con Rosetta; la ruta/arquitectura/hash están en el recibo externo. [Clausuras y hashes](closures.json), [paridad default post-rebase](default-parity.json).

## Límites conservados

SwiftShader **no cierra en verde** en este recibo local. La primera corrida ARM agotó el arranque de 180 s y se interrumpió (salida 130). La primera corrida x64 dio 4/6: carga s0028, Worker, sólidos y errores de chunks aprobados; falló la lectura de identidad posterior a Docente y el rechazo de superficie corrupta a 15 s. Sus sólidos sumaron 144.110 puntos, interiores 66.573/66.573, quiste 40/40 y conflicto grasa 29/29.

La lectura de identidad se adelantó a la activación de Docente, conservando todas las comprobaciones de solicitudes posteriores. La repetición post-rebase, acotada a default/Docente y s0028Load, dio **0/2 por arranque de 180 s**; en s0028 se registró `frame:first` a 178.280 ms pero `boot:end` fue falso. No acredita verde posterior al rebase ni demuestra una causa de rendimiento. No hubo tercera repetición local ni ampliación de plazos. La corrección posterior de la ABI conserva los programas transformados de main y queda documentada arriba. Los hashes y las pruebas CPU/GPU aprobadas no sustituyen ese resultado.

Se conservan los registros iniciales fallidos, trazas y reportes de las corridas. No se ejecutó `npm run check` completo, cobertura global ni validación clínica. No se modificaron los activos físicos, las tolerancias, los plazos ni los reintentos para obtener un resultado verde.

Los JSON pequeños de esta carpeta permiten revisar las cifras. Los registros completos están en la carpeta externa de evidencia `structure-322/p3-impl`, con `progress.md`, comandos, hashes, negativos, trazas y recibos de GPU/Worker.

La actualización de P9 conserva los párrafos de la 322 por número y la 323 después. Las cifras de las clausuras anteriores a la revisión (1.027.918 B y 1.065.618 B) quedan en `review-fixes.json`; sus techos reducidos son históricos y ambas clausuras conservan ahora el techo de main. La [captura final del aviso](../INDEX.md#structure-322-p3-impl-review-fixes-20261106-worker-warning-main-8ed26cf-png) y la [comparación completa de hashes](../INDEX.md#structure-322-p3-impl-review-fixes-20261106-shader-parity-final-json) se registran por el índice de evidencia.

## Corrección del coste CPU del corte

El congelado recursivo del descriptor de persona hacía que los lectores numéricos consultaran arrays congelados por cada punto. El control del Worker real sin GPU ni transporte midió **437 ms de CPU por corte en `5ac3c96`, frente a 314 ms en main**. Omitir sólo el congelado de arrays en un arnés externo devuelve 312 ms y el mismo hash de tejido/vaso/estructura. Ese control no se instala en el producto.

Los lectores preparan una copia privada del descriptor pequeño al instalarse y conservan los mismos buffers de atlas. El descriptor público sigue congelado. El control corregido consume 288 ms; la prueba de consultas pasa de 1.860 lecturas de arrays públicos a cero. No cambia el Worker, `ready`, el import CPU, los epochs, las cancelaciones ni el aviso de fallo. El testigo E2E cuenta ahora `init`, clave y bytes de buffers copiados por mensaje, incluyendo el perfil de la escena; los cambios de caso no recargan atlas. [Recibo de rendimiento y corridas alternadas](performance.json).

La corrección reduce **101 B** en cada clausura respecto a `5ac3c96`. Se conservan todas las corridas, incluidas las afectadas por picos de carga ajena. Las mediciones Metal y CPU locales no acreditan el cierre del fragmento SwiftShader en CI.

Cierre de rendimiento: 130/130 pruebas focales en 16 archivos. La pareja Metal consecutiva aprueba ambos casos sin reintentos: concurrencia **52,244 s corregido / 61,632 s main `8ed26cf`**; presentación portal `reference=atlas, severe=false` **6,827 s / 6,936 s**. La carga de un minuto alcanza 5,64 y 14,99 respectivamente; no se atribuye un porcentaje controlado a esa pareja. El perfil usa Metal y el sondeo separado de Chromium confirma ANGLE Metal / Apple M4. Las dos vistas conservan un único `init` por Worker y cero bytes de atlas en cambios de caso. Originales, carga y procedencia en [performance.json](performance.json).
