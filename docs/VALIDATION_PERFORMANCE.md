# Validación completa con menor coste de instrumentación

## Contrato

La ruta habitual mantiene todos los archivos y aserciones. No cambia semillas, escalas,
ventanas, tolerancias ni timeouts. Las E2E mantienen un trabajador por runner. Tampoco cambia los archivos
fuente incluidos/excluidos del informe de cobertura ni sus umbrales (88/83/84/89 %).

`npm run test:coverage` ejecuta secuencialmente:

1. `test:coverage:core`: todos los archivos salvo tres matrices IQ, con instrumentación V8
2. `test:matrix`: esas tres matrices completas, sin instrumentación V8
3. `test:coverage:verify`: confirma que ambos informes son exitosos, sin pruebas omitidas,
   y contienen exactamente cada archivo previsto, una vez

La separación es explícita en `tools/ci/coveragePartition.ts`. Un archivo nuevo entra por
defecto en la fase de cobertura. Si falta una matriz, se repite un archivo, se escribe mal
la fase o se combina una partición con un nivel distinto de `all`, la validación falla.
La ruta normal de `npm test`, el modo watch y los niveles previos conservan su selección.

Las tres matrices conservan **52 pruebas** y toda su adquisición:

- `examChain.test.ts`
- `examChainScale.test.ts`
- `examChainScalePatterns.test.ts`

No se reemplaza la señal IQ por la verdad del caso ni por resultados precalculados. Una
matriz que falle sigue bloqueando `check` y el veredicto protegido de CI.

## Medición local inicial, mismo código y dos trabajadores

Base: `6eb30a38a4bbc15dcfa948c92c3f094960050200`. Corridas secuenciales en el mismo entorno,
sin otra suite pesada local en paralelo. La comprobación de la lista de archivos duró
menos de un segundo durante la corrida separada.

| Ruta                                           | Duración observada |
| ---------------------------------------------- | -----------------: |
| Todos los niveles instrumentados               |         1.198,53 s |
| Cobertura sin las tres matrices                |           623,32 s |
| Las 52 pruebas de matrices sin instrumentación |           215,33 s |
| Suma de las dos fases                          |           838,65 s |

Reducción observada de aproximadamente **6 minutos / 30 %**. Son mediciones de ingeniería,
no una promesa universal de duración; CI y máquinas diferentes pueden variar. La ejecución
completa inicial tuvo 1.127 pruebas verdes y 12 fallos esperados preexistentes; las dos fases
sumaron exactamente esos resultados (1.075 + 52 verdes, los mismos 12 esperados).

## Cobertura: diferencia declarada

La cifra habitual ya no incorpora la instrumentación de las matrices. Sigue midiendo todas
las fuentes configuradas, pero es una observación más conservadora del conjunto ejecutado.
No debe anunciarse como idéntica a la auditoría completamente instrumentada.

| Métrica    | Referencia completa | Fase de cobertura separada |
| ---------- | ------------------: | -------------------------: |
| Sentencias |             91,25 % |                    91,19 % |
| Ramas      |             90,29 % |                    89,73 % |
| Funciones  |             91,45 % |                    91,45 % |
| Líneas     |             92,18 % |                    92,15 % |

Los umbrales permanecen intactos. Las rutas que dejan de contarse aquí continúan ejercitadas
por las matrices sin instrumentación. `npm run test:coverage:full` fuerza `all` y conserva
la auditoría original íntegramente instrumentada para contrastar cambios importantes en
adquisición, medición o fisiología. No se usa para sustituir una matriz fallida por otra ruta.

## Revisión recurrente

En cada PR, comprobar los resultados de ambas fases, la cobertura, el informe de archivos y
los tiempos de CI. Los JSON de las fases y el resumen de cobertura se guardan durante 14 días
como `validation-reports`; los E2E conservan sus artefactos de tiempos por fragmento.

La referencia remota previa (`37126779837`) mostró tres archivos de matrices con duraciones
individuales de 510/684/552 s bajo cobertura; esos tiempos se superponen y no se suman como
latencia total. Los cinco fragmentos E2E tardaron 11,6–28,5 minutos y registraron arranques
medianos de 20,1–32,6 s: hay desigualdad de carga y variabilidad de runner. No se aumenta a
ciegas el número de trabajadores dentro de un runner SwiftShader ni se amplían plazos para
ocultar problemas. El trabajo de balancear y reducir arranques E2E es una revisión posterior,
separada de esta optimización de instrumentación.

## Reparto de navegador: ocho runners, un trabajador por runner

La fase de CPU no era ya el camino crítico. En CI de #156, sus fases sumaron
708,35 s, mientras el fragmento E2E más lento tardó 27,5 minutos. Se aumenta el
reparto de cinco a ocho runners independientes; no se aumenta la concurrencia
interna de SwiftShader ni se reduce el contenido de una prueba.

Una reproducción aritmética de los 61 tiempos individuales de
[CI de referencia](https://github.com/DanielOpazoD/vexus-sim/actions/runs/37126779837),
sobre el orden de descubrimiento actual, estima estos máximos por fragmento:

| Fragmentos | Máximo estimado |
| ---------- | --------------: |
| 5          |       27,92 min |
| 6          |       26,14 min |
| 7          |       21,13 min |
| 8          |       19,57 min |

**Es una proyección, no una corrida de ocho runners ni una promesa de duración.**
No incluye nuevas colas ni arranques; los runners anteriores tuvieron velocidades
diferentes. El cambio añade tres arranques independientes y la disponibilidad de
concurrencia puede limitar el beneficio. La duración real de CI debe comprobarse
antes del merge y revisarse en los informes siguientes.

Se usa el reparto nativo de
[Playwright con fullyParallel](https://playwright.dev/docs/test-sharding), sin
planificador propio ni historial obligatorio para ejecutar pruebas nuevas.
La matriz literal es la única fuente del número de fragmentos; el denominador
usa [strategy.job-total de GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#strategy-context).
El veredicto protegido sigue requiriendo `check` y toda la matriz E2E, sin cambiar
reintentos diagnósticos, rechazo de pruebas inestables, plazos ni workers.

Antes de la cobertura, `tools/ci/verify-e2e-shards.ts` ejecuta la recolección real de
Playwright (`--list`) sin navegador: suite completa y cada fragmento. Exige que la
unión contenga cada identificador prueba/proyecto exactamente una vez. Rechaza
listas vacías, omisiones, duplicados, pruebas omitidas y errores de descubrimiento.
Las pruebas nuevas entran en la comparación automáticamente. El validador solo
admite la matriz literal de un eje utilizada aquí; cualquier ampliación del
esquema requiere revisarlo, en vez de aceptar silenciosamente otro reparto.

El plan queda en `.validation/e2e-shards.json`, incluido en `validation-reports`.
Recolectar no sustituye ejecutar: todos los fragmentos reales siguen siendo
obligatorios y sus resultados se revisan por separado.

La recolección y las ejecuciones reales usan `--forbid-only`: una prueba marcada
accidentalmente como exclusiva detiene CI en vez de reducir silenciosamente la suite.
