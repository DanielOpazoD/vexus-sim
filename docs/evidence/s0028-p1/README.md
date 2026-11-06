# Evidencia local P1 s0028 · decisión 318

03-11-2026. Base ff6e5b8 y cambios r4/r4b/r4c, rama feat/s0028-p1-20261102.
Los recibos de build y los hashes de resultados están en [evidencia externa](../INDEX.md#migration-p1-r4-r4c-final-measurement-build-json).
Los JSON de esta carpeta conservan cifras pequeñas, procedencia y los diez archivos abiertos;
las capturas, cronologías, carga, footprint por proceso y negativos permanecen fuera de Git.

- [Mediciones](measurements.json): tres pares Metal alternados del candidato final A17 y un par SwiftShader x64 limpio.
  Σ no descuenta compartidos; total único y máximos vitales del kernel son otra contabilidad.
  Muestreo Metal cada 0,57–0,65 s, hasta al menos 15 s tras el primer cuadro; no es máximo continuo.
- [Paridad](parity.json): lector especializado real y crudo, ambos atlas, 1.520 nodos, 6.479
  puntos Float32 (nativos/mitades/cuartos, bordes y costuras), 300 puntos de profundidad/gradiente
  y Worker independiente con los lectores CPU reales. Raw/glsl/worker en [r4c](../INDEX.md#migration-p1-r4-r4c-final).
  No prueba equivalencia del clasificador completo de futuros órganos P2–P8.
- [HTTP](http.json): siete activos reales (incluye perfil provisional y mallas); JS separado.
- [Diez láminas abiertas](plates.json): `r4c/final/plates/01-subxiphoid.png` a
  `10-portalSubcostal.png`, revisión individual registrada tras esperar imagen, mapa y controles.
  ID de bundle, marco, hash de mallas y provisional P2–P8 visibles en cada una.

Contratos reproducibles dentro del repositorio:

```sh
tools/workspace/run.sh npx vitest run src/validation/s0028Precomputed.test.ts src/validation/s0028NearestTies.test.ts src/validation/s0028DepthConsumers.test.ts --maxWorkers=1
tools/workspace/run.sh env VITEST_TIER=all npx vitest run src/validation/s0028SurfaceSource.test.ts --maxWorkers=1
tools/workspace/run.sh node --import tsx tools/anatomy/build-s0028-surfaces.ts
```

El generador verifica ambos atlas antes de extraer; tras regenerar, formatear s0028SurfaceData.ts.
`S0028_SURFACE` fija hashes raw/gzip/expandidos, inventario, CT por hash del bundle, marco LAS/mm
y revisión. La prueba lenta reextrae los 19 campos: conserva 1.781.772 triángulos, orden y
orientación exactos, cota 0 mm; la prueba rápida expande índices y comprueba cada hash.
`flatShading` y el espejo X del navegador conservan normales/iluminación del 3D.

Historial conservado: [r1 genérico rechazado](../INDEX.md#migration-p1-report-md),
[r2 muestra incompleta](../INDEX.md#migration-p1-r2-report-md),
[r3 rechazo bajo presupuesto anterior](../INDEX.md#migration-p1-r3-report-md).
Sus resultados no se reclasifican retrospectivamente con el criterio r4.

Negativos conservados: [primera prueba roja](../INDEX.md#migration-p1-r4-logs-red-precomputed-log) detectó
extracción Worker en ff6e5b8; hashes/marco/inventario corruptos se rechazan en tests y E2E.
Los siete empates nearest del lector real y uno de lung crudo permanecen en
`src/validation/fixtures/s0028-nearest-ties.json`: q double/Float32 a ≤6e-6 voxel de mitad,
CPU/GPU eligen celdas vecinas. Las 16 perturbaciones diagonales ±0,001 mm concuerdan.
No se omiten etiquetas por su distancia +16 mm ni se proclama igualdad exacta en esos empates.
Máximos: distancia 0,011720 mm, hueso 0,000011175 mm, profundidad 0,034684 mm, gradiente
0,020122; Worker/CPU exactos. Estos máximos no son un error anatómico contra TAC.

[Enmiendas A1–A17](../INDEX.md#migration-p1-r4-amendments-md): r4b omitía los picos en el resumen, no en los
originales; sus dos errores eran detach CDP. La corrección de detach r4c no eliminó dos
timeouts de Runtime.evaluate; su [negativo](../INDEX.md#migration-p1-r4-r4c-r4c-swiftshader-current-1-result-json)
se conserva. El par limpio Swift retira sólo autoAttach/pause/heap Worker del observador;
conserva huellas externas de TODOS los procesos, heap de página, etapas y valla. Heap por
isolate Worker en Swift queda no medido; no es cero ni ahorro. No se atribuye causalidad de
velocidad al retirar observación. Las [láminas tempranas](../INDEX.md#migration-p1-r4-r4c-plates-early) abiertas
con mapa/UI atrasados también se conservan.

Carga final compartida registrada cada ~2 s: no se identifica proceso externo ≥100 % CPU
ni dispersión >20 % en los tres pares Metal finales. El pico externo current rep2 a 325,9 %
y el par repetido pertenecen al estado previo a A17, conservado íntegro en r4c/ y A15.
Swift x64/Rosetta no representa
Linux nativo ni certifica todos los PC de 8–16 GB. No se detienen procesos ajenos.
El presupuesto de memoria corregido por el propietario precede a r4: ≤2 GB Metal; el
rechazo r3 bajo ≤1 GB/objetivo 800 MB permanece histórico. La dieta global es otro bloque.

Cierre serial con Node 24 y un trabajador, comandos/códigos/duraciones/carga en
[checks.json](../INDEX.md#migration-p1-r4-r4c-checks-json); progreso recuperable en [progress.md](../INDEX.md#migration-p1-r4-progress-md).
`npm run check` usa VEXUS_VALIDATION_MODE=serial y VITEST_MAX_WORKERS=1; el resto de Vitest
usa --maxWorkers=1 explícito. E2E Metal afectadas y ligera x64 conservan BOOT_MS CI=180 s,
plazos, resolución y cero reintentos. La CI remota y la validación clínica son evidencias pendientes.

La ligera original x64 descubrió un error real del corte: el primer Worker se terminaba
tras 3,242 s con sólo un cuadro JS completo. Bootstrap seguía presentando en RAF mientras
GPU estaba pendiente y consumía el reloj por cuadros activos del watchdog. Se conserva el
fallo y su reproducción instrumentada (r4c/e2e-swift-x64, e2e-worker-trace y worker-diagnostic.json).
`cutMapLifecycle.test.ts` añade la regresión roja y un control de colgado/congelado: los
ticks de presentación GPU-pendiente no cargan el watchdog, pero siguen recibiendo mapas.
`advanceWatchdog=allowGpu` conecta ese contrato sin cambiar 3 s, 250 ms/cuadro ni BOOT_MS.
La ligera original corregida pasa 2/2 en r4c/e2e-swift-x64-fixed. Se repite después el cierre
completo y las E2E finales; no se declara verde un simple reintento sin cambio.
