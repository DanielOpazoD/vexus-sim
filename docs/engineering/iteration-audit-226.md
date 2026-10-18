# Coste de iteración: diagnóstico y cambios de la ronda 226

Evaluación del 18 de octubre de 2026 sobre main `62feab5`, posterior a PR267. Se revisaron
configuración, herramientas, inventarios, módulos y costes de pruebas; no es una auditoría
línea por línea ni una nueva validación clínica. Los datos resumidos están en
[iteration-cost-226.json](../evidence/iteration-cost-226.json).

## Conclusión

El cuello principal es ejecutar muchas adquisiciones completas en SwiftShader. Además, el reparto
seguía usando duraciones históricas de 87 pruebas, de las que solo 83 coinciden con las 154 actuales.
Las otras 71 recibían un coste genérico. Esto deja corredores libres mientras otro termina.
La solución inmediata es actualizar esos pesos, utilizar la GPU real durante la edición y reservar
la aceptación completa para el candidato estable. No hace falta añadir un framework ni borrar pruebas.

También hay un coste de mi forma de trabajar: en la ronda de pared, tres experimentos descartados
de ejecución/gradientes consumieron por sí solos 33,7 minutos locales. Probar variantes grandes
antes de demostrar el cuello causal alarga el ciclo y puede alejar el trabajo del defecto visible.
Cada experimento debe responder una hipótesis medida, compararse en condiciones equivalentes y
cerrarse antes de abrir otro. Un resultado sin mejora demostrada no se integra.

## Cuánto tarda realmente

| Trabajo observado                              | Tiempo                   | Qué significa                                                                                                                  |
| ---------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Pruebas rápidas del push de PR267              | 32,79 s, más tipos       | Útiles para errores ordinarios; el hook permanece.                                                                             |
| Core con cobertura, local                      | 187,38 s                 | 1.566 aprobadas y 10 fallos esperados; 229 archivos.                                                                           |
| Matrices exhaustivas, local                    | 197,42 s                 | 54 aprobadas y un fallo esperado; cuatro archivos.                                                                             |
| Check local completo                           | Más de 6 min 25 s        | Esa suma es solo core/matrices; faltan formato, lint, tipos, build y verificación.                                             |
| 25 E2E locales con Metal                       | 127,11 s                 | Incluyen navegación A/B, pared, Doppler, cine y dos vistas. No son toda la CI.                                                 |
| CI del PR267                                   | 29 min 41 s de workflow  | 154 E2E, 227,81 minutos de pruebas acumulados entre corredores.                                                                |
| CI posterior en main                           | 29 min 9 s de workflow   | Misma colección, 231,77 minutos de pruebas acumulados. También terminó aprobada.                                               |
| 148 arranques satisfactorios de esa CI de main | 68,34 minutos acumulados | Cerca del 29,5 % del tiempo de pruebas. Mediana 28,43 s; p95 36,80 s. Incluye todo el arranque observado, no solo compilación. |

Fuentes completas aprobadas, un intento y cero reintentos:
[PR266](https://github.com/DanielOpazoD/vexus-sim/actions/runs/39123181714),
[PR267](https://github.com/DanielOpazoD/vexus-sim/actions/runs/39154581661) y
[main posterior](https://github.com/DanielOpazoD/vexus-sim/actions/runs/39156988840).
Se verificaron los digests de los ZIP originales y los hashes de informes/planes del recibo protegido.
Los tiempos locales y remotos son observaciones de entornos distintos, no un benchmark pareado.

## Qué frena y qué se hace

| Hallazgo                                                                                                    | Cómo degrada el ciclo                                                                                                   | Cambio mínimo / estado                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pesos desactualizados: solo 83/154 identidades actuales tenían duración propia.                             | El reparto parece equilibrado con datos que ya no describen la carga.                                                   | **Aplicado:** recalibración existente, mediana de tres CI completas; 154 pesos, 12 corredores y unión exacta conservados.                                                                                                 |
| `npm run e2e` dejaba los workers locales por defecto de Playwright.                                         | Podía competir con varias cargas GPU aun cuando nuestra regla exige una a la vez.                                       | **Aplicado:** un worker por defecto también en local. Regresión sobre la configuración real, negativa con el valor anterior.                                                                                              |
| Se usa aceptación completa como diagnóstico durante una edición.                                            | Un error pequeño cuesta matrices, cobertura y una espera de CI.                                                         | **Proceso:** test explícito/relacionado y Metal primero; check y CI completos una vez estable. Los comandos ya existen: no añadir otro lanzador.                                                                          |
| Los helpers y la configuración no prueban el mismo nivel que el simulador.                                  | Una suite rápida verde no valida imagen; una captura agradable no valida fisiología.                                    | **Proceso:** identificar el contrato afectado y ejecutar su prueba original. Si cambia una coordenada, incluir llegada, visibilidad y navegación; si cambia arranque, fallo sintético y primer cuadro con dos vistas.     |
| 149 inicios de navegador/adquisición en la CI de main, 148 satisfactorios y un fallo sintético intencional. | El arranque acumula coste importante.                                                                                   | **Siguiente estudio:** usar las etapas ya registradas para distinguir carga, compilación y primer cuadro. Conservar aislamiento entre casos; no reutilizar una página global ni rebajar resolución para aparentar ahorro. |
| Ocho workflows adicionales ejecutaron 32 jobs y 190,27 minutos de job acumulados en PR267.                  | Añaden carga a la colección protegida; algunos aportan comparación base/candidato, otros repeticiones de estabilidad.   | **Sin suprimirlos:** documentar su propósito y decidir su frecuencia con evidencia. El visor venoso repite 14 pruebas tres veces, además de la colección completa.                                                        |
| Instalación de Chromium/dependencias en 30 jobs suplementarios: 10,75 minutos acumulados.                   | Preparación repetida antes de medir el simulador.                                                                       | **Siguiente simplificación acotada:** comprobar esos workflows con la misma imagen Playwright ya fijada en CI principal. No añadir una caché de navegador sin demostrar ahorro.                                           |
| La CI completa corre en PR y vuelve a correr en main.                                                       | Duplica trabajo sobre árboles a veces idénticos, aunque el segundo run es independiente y detectó negativos históricos. | **Decisión de política, no limpieza:** una futura reutilización exigiría prueba del árbol y procedencia, y una decisión explícita sobre perder esa repetición independiente. Esta ronda conserva ambas ejecuciones.       |
| Módulos grandes y pruebas extensas: `fidelity.ts` 2.948 líneas, renderer 2.277, smoke E2E 1.702.            | Cambios transversales y dependencias dinámicas dificultan elegir el diagnóstico.                                        | **Sin refactorización masiva:** usar contratos y pruebas focalizadas; extraer responsabilidades solo al intervenir el módulo y con beneficio medido. El tamaño por sí solo no justifica otra migración.                   |
| Mucha evidencia temporal e historial en el chat.                                                            | Una sesión puede reconstruir estados viejos, repetir capturas y confundir un ensayo con el candidato.                   | **Proceso:** un índice vigente, SHA/árbol/recibo y negativos separados. Se mantiene el worktree reutilizable, las dependencias compartidas y un único servidor estable.                                                   |

Los 48 jobs de los nueve workflows de PR267 sumaron 459,90 minutos de job. Es tiempo acumulado,
no latencia del usuario ni facturación. Las repeticiones de estabilidad no son reintentos para
conseguir verde. Las comparaciones base/candidato tampoco son automáticamente pruebas duplicadas.

Playwright recomienda [un worker en CI](https://playwright.dev/docs/ci#workers) y distingue
[repartir por pruebas de repartir por archivos](https://playwright.dev/docs/test-sharding).
Su documentación [no recomienda por defecto cachear los binarios del navegador](https://playwright.dev/docs/ci#caching-browsers).
La decisión local usa además el negativo previo de contención GPU del proyecto.

## Ahorro que podemos afirmar y ahorro que falta medir

La recalibración no acelera una adquisición ni reduce trabajo físico. Redistribuye las mismas pruebas.
Con los tiempos ya medidos de cada prueba, una simulación retrospectiva da:

| CI usada para el cálculo | Máximo anterior, suma de tests | Máximo con nuevo reparto | Reducción simulada |
| ------------------------ | ------------------------------ | ------------------------ | ------------------ |
| 39123181714              | 26,84 min                      | 22,13 min                | 17,56 %            |
| 39154581661              | 27,30 min                      | 20,65 min                | 24,35 %            |
| 39156988840              | 27,61 min                      | 21,06 min                | 23,73 %            |

Esto es un backtest con las mismas tres fuentes empleadas para calibrar. No es validación independiente
ni tiempo ganado ya observado: cambia el orden de arranque y varían los corredores. La primera CI
completa del PR de esta ronda medirá el reparto nuevo; su veredicto, inventario, coste y recibo son
la aceptación real. La suma de muestras/pruebas y los plazos no se modifican.

## Ciclo cotidiano más corto

1. Reproducir el defecto del usuario sobre el build vigente; si es imagen, mirar pronto el ángulo
   y el tejido correcto. Anotar un criterio visible y otro causal.
2. Ejecutar la prueba original más estrecha con `npm run feedback -- src/validation/miRegresion.test.ts`.
   Para un módulo puro, `npm run feedback -- src/core/clock.ts` selecciona relacionadas rápidas.
3. Si cambia render/interacción, ejecutar solo las E2E originales afectadas con
   `workspace:e2e --backend metal`; usar SwiftShader para un contrato GPU específico o un fallo
   de ese backend. Preservar dimensiones, reloj, controles y renderer en las comparaciones.
4. Antes de aceptar: check completo, calibración si cambia anatomía, hook normal y CI completa.
   Un fallo se investiga en su etapa, conservando el negativo; no se repite toda la batería a ciegas.
5. Verificar el recibo pequeño con `workspace:ci`, revisar los workflows aplicables y fusionar el
   head aprobado. Durante CI se prepara la entrega; no se abren experimentos sobre el candidato.

Una ronda solo documental/de herramientas no necesita nuevas capturas anatómicas locales. Una
nueva captura del mismo comportamiento no debe hacerse solo por cambiar texto o transporte reversible;
la procedencia y la equivalencia tienen que quedar acreditadas. Esto no sustituye ninguna prueba obligatoria.

## Tres prioridades

1. **Reparto actualizado y una carga GPU local:** cambios pequeños ejecutables en esta ronda.
2. **Diagnóstico focalizado, imagen temprana y una hipótesis medida por experimento:** reduce las
   vueltas que yo mismo estaba añadiendo; no requiere más herramientas.
3. **Preparación y frecuencia de workflows suplementarios:** abordar por separado la instalación
   repetida y la necesidad de repeticiones; conservar comparaciones útiles y no mezclar esta política
   con el arreglo de una imagen clínica.
