# E2E completas repartidas por coste observado

## Problema medido

En el run 37157782934, el fragmento 6 acumuló 1597,8 s de pruebas, frente a
809,5–1222,4 s en los otros siete. Playwright repartía por cantidad; varias
pruebas GPU costosas quedaron juntas. Todos los tests pasaron una vez, sin retry.
No se atribuye esa diferencia a un fallo del producto ni se amplían sus plazos.

El conjunto original de pesos fue la mediana en milisegundos de tres ejecuciones completas verificadas:

- https://github.com/DanielOpazoD/vexus-sim/actions/runs/37155688621
- https://github.com/DanielOpazoD/vexus-sim/actions/runs/37157495221
- https://github.com/DanielOpazoD/vexus-sim/actions/runs/37157782934

En aquel conjunto se conservaron los SHA y los 62 IDs con historia.
Entonces había 62 pruebas; cualquier prueba nueva entra con el coste mediano. Los pesos
son pistas de planificación: nunca determinan qué pruebas se incluyen.

## Cambio

Se ordenan todas las pruebas actuales de mayor a menor coste y se asigna cada
una al corredor menos cargado. Empates deterministas. Se mantienen ocho runners,
un worker por SwiftShader y las mismas aserciones, timeouts, cobertura y política
anti-flaky. La suite actual usa `fullyParallel` y cada prueba abre su propia página;
si se incorporan flujos seriales dependientes, su agrupación deberá preservarse.

Se generan listas nativas `--test-list` con proyecto, archivo y jerarquía completa.
La recolección de Playwright sobre cada lista debe devolver exactamente los IDs
previstos. Una prueba nueva sin peso no desaparece; un peso obsoleto no crea pruebas.
Referencia del formato: https://playwright.dev/docs/test-cli#test-list

## Veredicto más fuerte

Un trabajo verde no basta. Cada runner entrega su informe y metadatos de plan,
índice y SHA. El veredicto protegido vuelve a recolectar la suite y exige:

- Ocho informes del mismo commit y plan que la ejecución actual
- Unión exacta de las pruebas actuales, sin faltantes ni duplicados
- Un único resultado pasado por prueba, sin skips, fallos esperados o retries

Se conserva el retry diagnóstico configurado, pero un pase posterior no sirve
para una fusión: la política anti-flaky y el nuevo verificador lo rechazan.
La comprobación de cobertura, lint, tipos, documentación y presupuesto sigue intacta.

## Estimación, todavía no ahorro medido

Con las mismas 62 pruebas y los pesos históricos, el máximo previsto baja de
1544,1 a 1039,3 s: 32,7 % menos en el tramo de pruebas más largo. No incluye colas,
instalación, arranque o transferencia de artefactos, ni garantiza el tiempo de una
máquina futura. El ahorro real deberá compararse después de ejecutar la nueva CI.
La comprobación automática de los informes evita además reconciliarlos manualmente
en cada PR; las capturas visuales relevantes siguen requiriendo inspección.

## Contraste fuera de las ejecuciones usadas para los pesos

Tras la corrección física del PW, la CI del PR165 (run 37167121754, SHA
53264a631b88af587aeb11d0f228fdce958583ac) ejecutó los 62 casos una sola vez.
Su fragmento más lento acumuló 1525,5 s. Al asignar esas mismas duraciones
observadas al plan balanceado calculado con los tres runs anteriores, el máximo
resulta 1088,9 s (28,6 % menos). Es una estimación contrafactual con datos nuevos,
no una ejecución del plan nuevo ni una garantía de ahorro en tiempo de pared.
No se usaron esos resultados para elegir o eliminar pruebas.

## Colección vigente: 87 casos, 8 de octubre de 2026

El run de main 37776977858 agotó los 40 minutos en el fragmento 5 antes de producir
el informe final. Sus once mensajes de aprobación no constituyen una ejecución
completa aceptable. El cierre anterior tardó 30,092 s; en el run cancelado quedaban
25,497 s. No se reejecuta, ni se infiere un cuelgue permanente por esa cancelación.

La herramienta `tools/ci/recalibrate-e2e.ts` verificó tres ejecuciones completas
de los mismos 87 IDs, todas en intento 1 y sin reintentos de pruebas:

- [37719578705](https://github.com/DanielOpazoD/vexus-sim/actions/runs/37719578705)
- [37723071197](https://github.com/DanielOpazoD/vexus-sim/actions/runs/37723071197)
- [37771651239](https://github.com/DanielOpazoD/vexus-sim/actions/runs/37771651239)

Los 24 ZIP oficiales coinciden con los digest publicados. El archivo de pesos
conserva SHA del checkout real y hashes de informes/metadatos. En los runs de PR,
el checkout de integración y el head tienen el mismo árbol. Los pesos anteriores
cubrían 73 casos; los 14 nuevos recibían un coste genérico, incluso el flujo de
comparación registrada que ahora tarda unos 9,6 minutos en SwiftShader.

Con las mismas medianas actuales, el máximo calculado del plan anterior es
2 290 853 ms y el del nuevo es 1 788 137 ms (−21,94%). La suma sigue siendo
14 218 746 ms. Estas cifras excluyen instalación, cierre y artefactos, y no
garantizan tiempos futuros. La primera CI del nuevo SHA y la posterior al merge
deben terminar íntegramente; la CI fallida queda conservada. No cambia la
cantidad de pruebas, workers, fragmentos, timeouts, aserciones ni condiciones
del agregado. Tampoco cambia el simulador o certifica fidelidad clínica.
