# Validación completa con menor coste de instrumentación

## Contrato

La ruta habitual mantiene todos los archivos y aserciones. No cambia semillas, escalas,
ventanas, tolerancias, timeouts ni los cinco fragmentos E2E. Tampoco cambia los archivos
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
