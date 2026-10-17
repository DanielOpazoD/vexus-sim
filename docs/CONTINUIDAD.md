# Continuidad de VExUS Sim

## Alcance vigente al 17 de octubre de 2026

El usuario pausó el desarrollo funcional para ordenar el entorno y autorizó esa limpieza con
autonomía. El 17 de octubre autorizó retomar fidelidad externa y coherencia interna. La primera ronda
registra 18 adquisiciones del atlas (nueve ventanas y dos pacientes), rechaza una rotación PW que
pierde la señal renal de referencia (208) y unifica los límites del mando de presión con la pose (209).
La siguiente ronda aborda interfaz clara y disposición adaptable (210), con invariantes de adquisición.
Se conserva el circuito de PR pequeño, evidencia antes/después y CI completa antes de integrar.

Este documento es el punto de entrada. `CONTRIBUTING.md` define el procedimiento de aceptación;
la configuración ejecutable de CI y sus verificadores determinan qué se ejecuta. Los prompts antiguos,
las pestañas abiertas y los JSON de una sesión son antecedentes, no estado vivo.

## Último cierre funcional acreditado

- Repositorio: [DanielOpazoD/vexus-sim](https://github.com/DanielOpazoD/vexus-sim).
- [PR257](https://github.com/DanielOpazoD/vexus-sim/pull/257), fusionado el 17 de octubre a las
  17:35:59 UTC: límites compartidos del mando de presión (209) y evidencia del experimento PW
  rechazado (208). Head `dba48ab3da6aef9af4e0d05561de975c567d9822`; main
  `b1cced43936678a7d17ccda911321cd4d79b7815`.
- Árbol `2001078b233c8bc25e984ca656373379eae8e6f3`, idéntico al merge probado
  `e40ed01488d4c68930e99ca40dac386a7e1836c9`.
- [CI del cierre](https://github.com/DanielOpazoD/vexus-sim/actions/runs/39052321451): 15 trabajos
  aprobados; 141 E2E únicas, una ejecución por prueba y cero reintentos entre 12 informes originales.
  Core: 1.517 aprobadas y 10 fallos esperados; matrices: 54 aprobadas y un fallo esperado.
  Informes y procedencia comprobados con los verificadores del repo.
- Coherencia en Metal: seis coordenadas × dos pacientes, traslación y todos los ángulos;
  2.560 puntos corte/GPU sin discrepancias y 4.254 puntos de envoltura renal concordantes.
  Dos vistas SwiftShader: 509.591 ms bajo el plazo original de 540.000 ms.
- El 17 de octubre, antes de la siguiente iteración visual, GitHub no tenía PR abiertos y
  `origin/main` seguía en `b1cced4`. Es una observación fechada, no estado vivo.
- Cierres anteriores: [PR254](https://github.com/DanielOpazoD/vexus-sim/pull/254), anatomía/movimiento/arranque;
  [PR255](https://github.com/DanielOpazoD/vexus-sim/pull/255), corte durante movimiento;
  [PR256](https://github.com/DanielOpazoD/vexus-sim/pull/256), entorno y continuidad.
  La evidencia de PR255 sigue en `docs/evidence/session-20261015/`.
- No se realizó despliegue, release ni etiqueta durante ese cierre.

## Qué funciona y qué se decidió

Aplicación TypeScript/Vite, WebGL2/GLSL y Three.js. La cadena paciente → fisiología → anatomía →
sonda → adquisición → imagen/Doppler → medición conserva su causalidad y la paridad TS/GLSL.

Las seis zonas son coordenadas de prueba. El movimiento de la sonda es continuo, con traslación y
tres ángulos, también entre coordenadas y en ambos pacientes (decisión 205). No deben convertirse
en zonas permitidas, imanes ni límites de navegación.

El corte pide el último cuadro realmente adquirido en cuanto termina el cálculo pendiente durante
el movimiento. Mantiene una petición en vuelo, rejilla 96×128, clasificador completo y refresco
fisiológico de reposo a 8 Hz. No sustituye la adquisición por el gesto vivo (decisión 206).

La comparación final en Apple M4/ANGLE Metal registró 1.728 muestras por versión, seis coordenadas
y dos pacientes: antigüedad del corte mostrado p95 **151,2 → 84,2 ms**. Solo la página medida
adquiría; cinco referencias estaban congeladas, con sus bucles todavía presentes. No equivale a un
navegador sin otras páginas ni a una promesa universal. El recorrido enlazado adicional cubrió 576
coordenadas intermedias. Física, anatomía, GLSL, resolución, presupuestos y plazos se conservaron.

La espera del barrido renal/hepatorrenal se fortaleció con `windowAcquired` antes de capturar los
ángulos: corte y marco podían coincidir durante la animación anterior al destino. El cierre pasó
también con dos vistas en SwiftShader: 502.232 ms en CI frente al plazo original de 540.000 ms.

## Límites y resultados que no deben perderse

- El corte es asíncrono; las tres presentaciones no son simultáneas durante todo movimiento.
- Hubo un timeout local con cinco referencias históricas adicionales congeladas. Se conserva como
  negativo; la comparación aislada posterior se interrumpió y no cuenta como aprobación.
- Las primeras cifras 150,2 → 67,4 ms incluían otra vista adquiriendo. Su régimen es diferente del
  cierre final; no mezclar las dos series.
- La disposición móvil 390×844 tenía desborde previo; no quedó aprobada una adaptación móvil.
- Un perfil exploratorio del HUD no demostró la causa del timeout ni produjo un cambio integrado.
- La paridad del modelo y las pruebas automatizadas no acreditan validación clínica independiente.
- El margen del bundle del cierre era pequeño: 1.032,7 / 1.033 KiB. Se mantiene el presupuesto.

## Retomar sin reconstruir el chat

1. Leer este archivo y `docs/engineering/workspace.md`; seguir la instrucción actual del usuario.
2. Ejecutar `tools/workspace/run.sh npm run workspace:doctor`. Revisar rama, cambios y `origin/main`.
3. Refrescar GitHub antes de hablar de PR pendientes, CI actual o ramas remotas. No asumir que
   `main`, un servidor o un PID histórico siguen igual.
4. Consultar [el manifiesto del cierre](evidence/session-20261015/manifest.json) y
   [el índice de evidencias](evidence/session-20261015/README.md). Un clon puede no incluir los
   artefactos locales originales: declararlo y usar los enlaces remotos disponibles.
5. Elegir un defecto reproducible y un mecanismo por ronda. La siguiente corrección PW necesita
   resolver transporte/reposición antes de integrar la rotación; no basta el fantoma de frontera.
   Las mejoras visuales requieren referencias independientes y evaluación del SHA actual.

Al cerrar una nueva entrega, añadir aquí su referencia comprobada y límites. Conservar los cierres
previos como historia, retirar tareas ya terminadas del estado operativo y fechar toda afirmación
que dependa de GitHub, procesos o pestañas.
