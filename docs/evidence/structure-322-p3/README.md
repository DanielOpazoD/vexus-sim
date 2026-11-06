# Decisión 322.3: recibo local de la frontera por persona

Base de comparación: r3 `5d79321c6448888da9fb3cc562495c9d183ed54a`. Primer rebase sobre `12630d9`, que contiene el squash de #336 (`bd2f575`) y 322.10a; antes del push se rebasan sólo los dos commits propios sobre `0e876e7` (#341, 322.7). El único conflicto es de imports de Vite y se conserva el selector de capas de main. Este recibo acredita pruebas locales; la CI protegida y la revisión independiente siguen siendo la puerta de aceptación. No es validación clínica.

## Clausuras de JavaScript

Se incluyen imports estáticos y diferidos, hooks, preloads HTML, Worker y worklet. Sólo se poda la entrada de la otra persona. Cada archivo se cuenta una vez por ruta; se rechaza cualquier JS huérfano o módulo duplicado. La comprobación relee los bytes finales de `dist` y sus hashes.

| Medida               |        r3 |   Después |     Techo | Margen |
| -------------------- | --------: | --------: | --------: | -----: |
| Default              | 1.069.860 | 1.027.918 | 1.029.966 |  2.048 |
| s0028                | 1.069.860 | 1.065.618 | 1.070.080 |  4.462 |
| Unión de ambas rutas | 1.069.860 | 1.077.860 |         — |      — |
| Compartido           | 1.069.860 | 1.015.676 |         — |      — |

No hay módulos privados s0028 en default. Los 12.242 B exclusivos de default se descomponen en CPU (10.126), runtime (1.631) y superficies (485). Salen de la clausura s0028 `classifyKidneys`, `kidneyQuery`, `kidneySinusSdf`, `atlasDepthScale`, la clasificación perirrenal/Gerota, el clasificador default de pared/interior y `hepaticCostalBody`. Los auxiliares geométricos aún consumidos por ambas personas y el ligamento venoso siguen compartidos. El margen s0028 no garantiza cabida para r5/P5/P8.

Descarga: 20.433.526 / 25.000.000 B. Incremento de metadatos: 3.788 / 4.096 B. No se amplían techos de JS, assets ni shaders.

## Paridad y pruebas

Los 38 fragmentos y el vértice conservan los hashes r3 de fuente y transformados, para default y s0028. Un símbolo/uniform privado añadido no altera default. Fixture completa: [person-shaders-r3.json](../../../src/validation/fixtures/person-shaders-r3.json); mapa ABI: [person-glsl-r3.json](../../../tools/build/fixtures/person-glsl-r3.json).

Paridad default exacta: 82.251 puntos, 10 marcos y 30 contactos. SHA-256:

- Salida completa: `3a6c5010a3904d08d7fe5002b23a4cf579300349e218a0d3bf05ceba25e003ee`.
- Clasificación semántica: `e223ec29216fb23c8867486e82ced1149670a54b25a29fccb3642a08ede529c2`.
- Marcos: `adf6e763fd4c5cb1b6c42d546e05c9811a3e8b32b0a4640737fe7b2b122028cb`.
- Contactos: `a8b1b1dd367f1f5c958bfc2e0b71fe7dad00c348db133f757228483e88f318b9`.

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

La lectura de identidad se adelantó a la activación de Docente, conservando todas las comprobaciones de solicitudes posteriores. La repetición post-rebase, acotada a default/Docente y s0028Load, dio **0/2 por arranque de 180 s**; en s0028 se registró `frame:first` a 178.280 ms pero `boot:end` fue falso. No acredita verde posterior al rebase ni demuestra una causa de rendimiento. No hubo tercera repetición, ampliación de plazos ni cambio de programas. Los hashes y las pruebas CPU/GPU aprobadas no sustituyen ese resultado.

Se conservan los registros iniciales fallidos, trazas y reportes de las corridas. No se ejecutó `npm run check` completo, cobertura global ni validación clínica. No se modificaron los activos físicos, las tolerancias, los plazos ni los reintentos para obtener un resultado verde.

Los JSON pequeños de esta carpeta permiten revisar las cifras. Los registros completos están en la carpeta externa de evidencia `structure-322/p3-impl`, con `progress.md`, comandos, hashes, negativos, trazas y recibos de GPU/Worker.
