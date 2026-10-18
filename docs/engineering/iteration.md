# Iterar con evidencia y menos espera

Evaluación del 18 de octubre de 2026, decisión 219. Alcance: herramientas, pruebas y continuidad;
sin cambios en el simulador. La aceptación sigue definida por `CONTRIBUTING.md` y la CI protegida.

La [reevaluación 226](iteration-audit-226.md) mide tres CI completas de 154 E2E, el coste de
workflows adicionales y los desvíos del proceso de la ronda de pared. Actualiza los pesos de
reparto y fija un worker también para E2E locales directas; no añade otro lanzador ni elimina
pruebas. Sus cifras retrospectivas son estimaciones, pendientes de observación en la nueva CI.

La [reevaluación 233](iteration-audit-233.md) mide en el mismo equipo y commit un lote CPU
acotado: cobertura core y matrices mantienen procesos, selección e informes separados, pero se
solapan dentro de `check` en local cuando Node estima al menos diez plazas disponibles. Usa
`availableParallelism() - 5` workers para core y tres para matrices; deja dos plazas sin asignar
a esos pools. Es una estimación de recursos, no una reserva del sistema ni una garantía de tiempo.
En CI, equipos menores o con `VEXUS_VALIDATION_MODE=serial` se conserva la ruta secuencial.
No lanzar otras cargas locales intensivas durante el lote. La unión verificada, las pruebas,
su aislamiento, cobertura, plazos y CI completa permanecen obligatorios.

## Diagnóstico crítico

| Hallazgo observado                                                                                 | Cómo frena la iteración                                                                                     | Corrección mínima aplicada                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Usar el check completo durante cada edición mezcla diagnóstico y aceptación.                       | Las matrices y la cobertura retrasan errores pequeños; se repite trabajo antes de estabilizar el candidato. | `npm run feedback`: formato/lint focales, tipos y pruebas relacionadas, directas o rápidas según el cambio. Declara expresamente lo que no ejecuta.                                    |
| El lanzador `tsx` falló por IPC local al final de un check cuyas pruebas y build ya habían pasado. | Un fallo de entorno obliga a repetir minutos de trabajo para obtener un check completo válido.              | Usar `node --import tsx`; adelantar build y presupuesto a la cobertura. Los mismos controles siguen presentes.                                                                         |
| CI reintentaba automáticamente un fallo aunque `failOnFlakyTests` impedía aceptarlo.               | El negativo renal anterior consumió otros nueve minutos sin poder habilitar la fusión.                      | Cero reintentos automáticos. Repetir un diagnóstico requiere una ejecución explícita y conservar el fallo inicial. Los ensayos planificados de estabilidad mantienen sus repeticiones. |
| Reconciliar otra vez en local todos los informes ya verificados por el gate protegido.             | Descargas y scripts improvisados aumentan tiempo, ruido y riesgo de confundir SHA, intento o colección.     | Publicar un recibo compacto después de ambos verificadores originales y consumirlo con `workspace:ci`, validando proveedor, digest, head, árbol e intento.                             |
| El encabezado de continuidad seguía en PR261 aunque el cierre era PR264.                           | Una nueva sesión puede repetir tareas o tomar un estado histórico por actual.                               | Actualizar el punto de entrada y separar el último cierre del historial.                                                                                                               |

Se encontró además un negativo de la herramienta nueva: su fixture Git pasó en shell normal,
pero heredó `GIT_DIR` del hook y alteró metadatos del checkout aislado. Un test puede contaminar
el entorno que debe proteger. Se conserva el negativo; se restauran índice/ref/configuración y
se aíslan las variables Git heredadas. La comprobación debe incluir el hook real, no solo Vitest directo.
El hook conserva tipos y pruebas rápidas y ahora rechaza cambios de HEAD, índice o configuración
durante su ejecución. Fixtures aislados comprueban los tres negativos y el caso sin contaminación.
La [documentación de hooks de Git](https://git-scm.com/docs/githooks#_description) explica por qué
deben limpiarse esas variables al operar sobre otro repositorio.

La propia CI avisó de la migración automática de `ubuntu-latest` a Ubuntu 26.04 desde el 19 de
octubre. Su log confirma Ubuntu 24.04.5, imagen `20261012.334.1`. Los workflows fijan ahora
`ubuntu-24.04`, conservando la distribución observada; una actualización de distribución será
un cambio explícito y comprobable. El [aviso oficial de GitHub](https://github.com/actions/runner-images/issues/14748)
confirma la transición. La etiqueta fija la familia de SO, no congela parches, hardware o carga
del proveedor; el contenedor Playwright sigue fijado por digest. No se atribuye a esta medida
la reparación de los timeouts históricos.

Una regresión con 2 MiB reprodujo `ENOBUFS` en la huella que capturaba `git diff --binary`.
La huella final combina el índice Git y hashes del contenido modificado/nuevo, permisos y borrados;
evita generar un patch binario grande y detecta también cambios del índice con contenido de trabajo
idéntico. El ensayo conserva el negativo y comprueba la ruta de archivos grandes.

La CI de referencia [39110219774](https://github.com/DanielOpazoD/vexus-sim/actions/runs/39110219774)
ejecutó 152 E2E únicas una vez: **244,70 minutos acumulados**, con fragmentos de **12,68–33,89 minutos**
(duración del informe, sin preparación del job). Sus 147 registros de arranque suman 65,76 minutos:
incluyen todo el arranque observado, no solo compilación de shaders. La reconciliación local de esa CI
principal descargó 27 ZIP / 35.953.331 bytes; los cinco workflows juntos, 43 ZIP / 73.956.005 bytes.
Son observaciones de esa entrega, no promesas de ahorro universal.

Primer ensayo local del nuevo comando, con formato/lint y tipos incluidos: **5,95 s** para dos
archivos / 15 pruebas; **29,90 s** para el reloj compartido (49 archivos / 416 pruebas relacionadas);
**40,54 s** para la selección automática de esta rama (203 archivos rápidos, 1.390 aprobadas y
un fallo esperado). No se comparan como trabajo equivalente a una CI completa: sirven para encontrar
errores antes de pagar esa aceptación. Las matrices completas y la GPU no corrieron en esos ciclos.

**Lo que sí aporta valor y se conserva:** matrices fisiológicas, cadena real de adquisición,
paridad TS/GLSL, navegación continua desde seis coordenadas y ambos pacientes, dos vistas,
procedencia de informes, límites de cobertura y presupuesto. Una captura agradable o CI verde no
demuestran fidelidad clínica externa; esta necesita referencias y evaluación independiente.

**Lo que sigue costando y no se declara resuelto:** SwiftShader acumula mucho trabajo y el barrido
renal de referencia pasó en 538.371 de sus 540.000 ms. Hay poco margen; cambiar plazos o borrar
escenarios ocultaría el problema. Los tiempos del recibo permiten identificar el siguiente cuello
de botella. No se cambian ahora pesos del reparto con una sola observación ni se añaden cachés de aceptación.

## Ciclo cotidiano

Desde el checkout, con Node 24 mediante `tools/workspace/run.sh` si hace falta:

```bash
npm run feedback
npm run feedback -- src/validation/miRegresion.test.ts
npm run feedback -- src/core/clock.ts
npm run feedback -- --all-fast
```

Sin archivos explícitos usa diferencias contra `origin/main` y archivos nuevos; incluye commits de
la rama y cambios preparados/sin preparar/borrados. Refrescar esa referencia con `git fetch origin`
cuando corresponda; `--base <ref>` permite elegir otra base. Las rutas se interpretan desde la raíz.
El resultado guarda archivos elegidos, etapas, logs, tiempos, SHA y huella de contenido; rechaza
cambios durante la ejecución y no sobrescribe carpetas de evidencia.

- Documentación: formato; índice cuando cambia el registro de decisiones.
- Tests explícitos: esos archivos; una prueba lenta explícita conserva su plazo original.
- Módulos fuente: pruebas rápidas relacionadas por imports estáticos de Vitest.
- Configuración, herramientas, UI, shaders, bootstrap o borrados: suite rápida completa.

La selección relacionada **no descubre toda dependencia dinámica**. Si el riesgo es transversal,
usar `--all-fast` o un test explícito. No encontrar tests es un fallo, no una aprobación vacía.
Para editar repetidamente un módulo también sirve `npm run test:watch -- <test>`.
La semántica de selección está descrita en la [documentación de Vitest](https://vitest.dev/guide/cli.html#vitest-related).

Si cambia imagen/interacción, añadir una prueba original focalizada en Metal y revisión visual;
si cambia un contrato GPU, también SwiftShader y su paridad. Guardar renderer, build y condiciones
reales. No lanzar otra carga local intensiva a la vez. Un cambio solo documental o de herramientas
no necesita repetir capturas anatómicas locales; la colección completa permanece en CI.

Los negativos de la ronda 223 muestran dos dependencias E2E que la selección de Vitest por imports
no cubre. Al cambiar coordenadas de inicio, incluir `probeRigidTranslation.spec.ts` (llegada exacta
independiente), `hepatorenalVisibleWindow.spec.ts` y `probeFreeNavigation.spec.ts`. Al cambiar
`bootWithoutErrors`, incluir `startupFailure.spec.ts` y el arranque real con dos vistas de
`renalCutTracking.spec.ts`. La prueba de fallo sintético conserva el identificador del error;
la de adquisición conserva el primer cuadro GPU. Así se detectan incompatibilidades en el ciclo
focalizado antes de esperar una CI completa. Sus plazos y aserciones permanecen intactos.

Con el candidato estable: **check completo, hook normal, PR y CI completa del último head**.
Si falla una fase, conservar su negativo y diagnosticar esa fase; no volver a lanzar todo a ciegas.
Tras corregir código se vuelve a acreditar el candidato final. El feedback nunca sustituye la aceptación.

## Leer una CI aprobada sin reconstruirla

```bash
npm run workspace:ci -- --run 123456789
npm run workspace:ci -- --run 123456789 --head <sha-completo> --out .cache/ci/entrega-01
```

Requiere `gh` autenticado y `unzip`. Descarga un ZIP pequeño, compara su SHA256 con el digest de
GitHub y exige CI completa aprobada, todos los trabajos aprobados y correspondencia de repositorio,
head, fuente, árbol e intento. El recibo enumera hashes de los informes originales, inventario y
costes observados; lo publica únicamente el veredicto después de ejecutar los dos verificadores
completos originales. No ejecuta esos verificadores otra vez.

Las ejecuciones anteriores sin recibo requieren sus informes completos: la herramienta las rechaza.
Un recibo local, otro head, un test reintentado o una CI incompleta tampoco se aceptan. Consultar los
workflows adicionales cuando apliquen y descargar trazas/capturas/informes relevantes para investigar
fallos o revisar imagen. Los originales y negativos se conservan; el recibo no es una política de borrado.
La API y el digest están descritos en la [documentación de GitHub](https://docs.github.com/en/rest/actions/artifacts).

## Prioridad y criterio de éxito

1. Obtener feedback útil antes de entrar en cobertura, matrices o GPU completa.
2. Detectar fallos de build/entorno pronto y evitar repeticiones que no permiten aceptación.
3. Cerrar cada entrega con una sola procedencia comprobable y continuidad breve y vigente.

Medir el tiempo real de `feedback` y el tamaño/tiempo de `workspace:ci` en su `run.json` /
`verification.json`. Comparar el mismo alcance; el recibo principal no acredita por sí solo otros
workflows ni realismo clínico. No añadir reglas, pruebas o herramientas sin un fallo concreto que proteger.

El índice de decisiones se comprueba inmediatamente después del formato, antes de lint, build y
cobertura (227). Al editar `DECISIONS.md`: formatear primero y ejecutar después `npm run docs:index`;
sus enlaces dependen de las líneas definitivas. El test documental completo se conserva.
