# Mallas s0028 sin pérdida (319)

Bloque local entre P1 fusionada (#328, 318) y P2, base `117e1ca`.
[Mediciones](measurements.json): cinco pares alternados, geometría exhaustiva, memoria, HTTP y JS.
El cambio sólo codifica la descarga de las superficies; el buffer residente es idéntico al de P1.

## Contrato y reproducción

`indexed-delta32-v1`: enteros little-endian de 32 bits, mismos offsets/conteos por campo.
Las palabras de posición son diferencias módulo 2³² de los **bits** Float32, predictor
inicial cero independiente por eje y campo, intercaladas XYZ como antes. Los índices son
diferencias con predictor cero por campo, zigzag32 `(d << 1) ^ (d >> 31)`. Gzip nivel 9.
El cargador verifica gzip/raw y procedencia antes de descodificar **una vez** sobre su buffer
exclusivo; no reutilizar ese buffer como entrada codificada. No crea otra copia de posiciones
ni índices, no cambia orden y conserva hasta los bits de signo.

```sh
tools/workspace/run.sh node --import tsx tools/anatomy/build-s0028-surfaces.ts
tools/workspace/run.sh npx prettier --write src/anatomy/s0028SurfaceData.ts
tools/workspace/run.sh npx vitest run src/validation/s0028Precomputed.test.ts src/ui/navigator3d/s0028Memory.test.ts --maxWorkers=1
tools/workspace/run.sh env VITEST_TIER=all npx vitest run src/validation/s0028SurfaceSource.test.ts --maxWorkers=1
```

Dos extracciones independientes desde ambos atlas P0 versionados emitieron el mismo binario
y metadatos (`reproducibility.json` externo). La prueba lenta reextrae los 19 campos y fija
los hashes expandidos originales; la rápida descodifica y verifica los mismos hashes y el SHA
del buffer P1 completo `a9b82a42…be5642`. No sustituye la fuente por un round-trip del codec.
Regresión roja previa en `red.log`: 9.672.026 >5.672.026 B. Se conservan los negativos de
procedencia/marco/inventario/unidades/formato, corrupción, tamaño e índice negativo.

Consumidores inventariados en `consumers.txt` externo: `bootstrap` → `ui/s0028Surfaces` →
`indexedSurfaces`; después `navigator3d/organs.ts` (15 campos) y `body.ts` (4 óseos).
Ambos conservan las mismas vistas Float32/Uint32, `flatShading`, espejo X e iluminación.
`s0028Memory.test.ts` cubre ambos grupos, ausencia de normales duplicadas y restauración
respiratoria al cambiar de caso. Acústica/Worker del corte no consumen estas mallas.

## Medición y límites

Producción, perfiles limpios 1280×800, Apple M4/24 GiB/10 CPU, en serie. Cinco pares alternados
de la base preservada y el candidato, carga registrada cada 2 s y footprint externo cada
~0,6 s hasta 15 s después del primer cuadro. Pico = suma de **todos** los renderer + GPU
del navegador medido, sin descontar memoria compartida ni volver a sumar heap/texturas.
Es un máximo muestreado. Se verifica cuadro GPU real, persona, ausencia de errores y lost=false.
Los primeros tres pares con proxies y depuración Worker se conservan aparte; retirar el
observador no explica la diferencia con los 1,27 s históricos: la base actual tarda 2,43 s.
Se informa no regresión sobre la base contemporánea, no una aceleración universal. El tiempo
está dominado por construir Simulation/3D; `surfaces:begin→ready` abarca gzip/hash/decoder.
Las asignaciones vivas instrumentadas son idénticas por categoría CPU y GPU.

XOR de posiciones probado: 5.973.906 B, ahorro insuficiente. Cuantización/WASM innecesarios:
deltas exactos ya ahorran 4.331.810 B con sólo 381 B netos de JS añadidos.

## Láminas y cierre

[Evidencia y reanudación](../INDEX.md#migration-mesh-progress-md).
[Seis láminas](../INDEX.md#migration-mesh-plates),
abiertas individualmente: oblicua anterior, lateral y posterior, misma cámara/luz/capas.
ID de formato visible y región 3D idéntica píxel a píxel en las tres parejas. Las transparencias,
pared/poses provisionales y anatomía P2–P8 pendientes se conservan; no acredita relaciones
anatómicas nuevas ni validación clínica.

Metal 5/5 y x64/Rosetta SwiftShader 2/2, cero reintentos/flaky. `s0028Load` x64 tarda
98,644 s en total, primer cuadro GPU s0028 60,491 s (<BOOT_MS CI 180 s); humo legacy
80,666 s de primer cuadro. No se añaden láminas ni nuevos casos E2E a CI; el test rápido
de descarga/codec tarda décimas y la reextracción lenta sigue dentro de 180 s (local 15 s).
Son comprobaciones locales de plazo, no una CI remota aprobada.

[Cierre local aprobado](closure.json): formato, índice, lint, tipos, suite rápida, todos
los contratos Python, build, calibración y `npm run check` con
`VEXUS_VALIDATION_MODE=serial VITEST_MAX_WORKERS=1`. Cobertura: 291 archivos/2.023 casos;
matrices: 7 archivos/80 casos, incluidos los fallos esperados preexistentes; cero omitidos
ni duplicados. `examChainScalePatterns` pasó a la primera, sin timeouts ni repetición.
Matrix local serial 1138,84 s (18,981 min), frente a 25 min del trabajo CI, que no recibe
pruebas nuevas. El grupo E2E conserva 40 min y BOOT_MS 180 s; no se alteran plazos.
El cierre local completo tardó 2723,755 s; no es duración de CI (allí core/matrix son
trabajos independientes y usan su paralelismo). El resumen registra el HEAD base y hashes
del contenido de implementación probado; el commit posterior conserva esos bytes.
Comandos, códigos y carga se conservan en `steps.jsonl` y logs externos. No hay push, PR, gh, stash ni delegación; puerto 5174 intacto. La CI remota queda
pendiente de un PR autorizado.
