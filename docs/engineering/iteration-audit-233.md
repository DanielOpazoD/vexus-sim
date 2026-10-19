# Reevaluación del proceso de iteración — 233

18 de octubre de 2026. Alcance: herramientas, pruebas y continuidad. No cambia anatomía,
física, render, controles ni apariencia del simulador. La aceptación sigue en `CONTRIBUTING.md`.

| Evidencia observada                                                                                                                                                          | Coste o riesgo                                                        | Cambio mínimo                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El fixture HTTP esperaba solo el callback de `listen`; un `EPERM` quedaba como error no atendido y terminaba en el plazo de 180 s. El check fallido anterior gastó 363,09 s. | Repetir cobertura para descubrir un permiso ausente.                  | Esperar también el evento de error y comprobar loopback antes de iniciar cobertura/matrices. Conservar la causa original y borrar informes anteriores antes del preflight. |
| Core y matrices locales eran secuenciales; sus informes y selecciones ya eran independientes.                                                                                | CPU disponible mientras se espera una fase.                           | Un lote local con dos procesos, presupuestos explícitos y entornos separados; conservar la reconciliación original. En CI no cambia la organización.                       |
| Los informes comparaban tiempos entre runners sin describir recursos del equipo.                                                                                             | Confundir variación de hardware con una regresión o mejora de código. | Registrar Node, SO, arquitectura, paralelismo estimado, modelos CPU, memoria e imagen del runner. Lista permitida; sin volcar variables de entorno ni hostname.            |
| El punto de entrada de continuidad aún identificaba PR267 como último cierre funcional.                                                                                      | Repetir trabajo o retomar prioridades superadas.                      | Actualizar la referencia a PR270 y enlazar esta reevaluación.                                                                                                              |

## Medición comparable

Apple M4, 16 GiB, Node 24.22.0, diez plazas estimadas. Ambas mediciones diagnósticas usan
el mismo commit `8b90af9d66901719b0c17fbb36729a57acd9e438`, sin editarlo durante las corridas.

| Medición                         | Tiempo observado | Alcance                                                                              |
| -------------------------------- | ---------------: | ------------------------------------------------------------------------------------ |
| Check secuencial completo        |         384,21 s | Formato, índice, lint, tipos, build, presupuesto, cobertura y matrices verificadas.  |
| Fases secuenciales               |         358,28 s | Core 179,87 s + matrices 178,41 s según los informes.                                |
| Lote core 5 workers + matrices 3 |         277,41 s | Solo el bloque de pruebas, medido de principio a fin; no equivale al check completo. |
| Preflight core sin permiso       |           0,61 s | Fallo explícito, ningún informe nuevo de core.                                       |
| Preflight conjunto sin permiso   |           0,54 s | Fallo antes de lanzar ambos pools, informes/sellos anteriores ausentes.              |

El lote reduce **22,6 %** el bloque de pruebas en esta comparación. Los nombres, estados y
archivos de todas las pruebas coinciden exactamente; 236 archivos core y cuatro de matrices.
No se cambian plazos de 180 s, aserciones, cobertura ni aislamiento. Los tests del nuevo
planificador se añaden después del benchmark; el check completo del candidato final y su CI
se acreditan por separado en el PR. No se generaliza una corrida local a otras máquinas ni a CI.

El primer check del planificador (`b80fdec`) falló a los 318,53 s: el contrato de
`coveragePartition.test.ts` todavía exigía el comando secuencial anterior. Las matrices
aprobaron y el lote rechazó la aprobación parcial. Se conserva ese negativo; se actualiza
la entrada esperada manteniendo el verificador y se incluyen los contratos que leen
`package.json` en el feedback. Este coste era evitable y no cuenta como aceptación ni ahorro.

Los logs, informes originales, negativos y comparación están fuera del repo en el grupo
`workflow-performance-233-evidence` del espacio de trabajo; la entrega conserva su manifiesto
y verificación de hashes. No usar un benchmark o una colección `--list` como aprobación.

## Ejecución y controles

Se amplía el lanzador existente `run-validation-phase.ts`; no se añade otra CLI ni dependencias.
`all` selecciona el plan local, mientras `core` y `matrix` siguen sirviendo a los jobs separados
de CI. Cada hijo recibe una copia del entorno con su propia selección. Los informes siguen
vinculados a SHA y bytes; un cambio de HEAD, una fase fallida o una interrupción rechazan el lote.
Una prueba con procesos reales comprueba que interrumpir un hijo que devuelve cero no aprueba.

Con al menos diez plazas estimadas y fuera de CI: core usa `plazas - 5`, matrices tres;
dos plazas no se asignan a esos pools. [Node](https://nodejs.org/api/os.html#osavailableparallelism)
define `availableParallelism()` como estimación, no como reserva exclusiva de CPU.
Para comparar o trabajar bajo carga, usar el modo secuencial:

```bash
VEXUS_VALIDATION_MODE=serial tools/workspace/run.sh npm run check
```

No superponer otros builds, cobertura, hook ni GPU. El diagnóstico temprano evita esperas
inútiles; no concede permisos ni omite la integración HTTP cuando falta loopback.

## Qué se conserva y qué no se promete

- Feedback focalizado durante edición; check completo al estabilizar el candidato; hook normal,
  PR, CI completa del último head, recibo original, comentario de verificación y fusión condicionada.
- Las 154 E2E, sus doce grupos, cero reintentos, un worker GPU por job, repeticiones planificadas,
  resolución, física, límites de cobertura y presupuesto permanecen.
- No se cambia la preparación de workflows suplementarios por intuición: quince instalaciones
  de navegador del PR270 costaron 343 s acumulados, mediana 22 s y rango 17–31 s. Los ejemplos
  observados de arranque del contenedor principal fueron 27–33 s; no prueban ahorro por migrarlo.
- No se declara mejora de cadencia del simulador, de latencia del corte ni de fidelidad clínica.
  Esas mediciones necesitan su protocolo y sus referencias, separados de la velocidad del entorno.
