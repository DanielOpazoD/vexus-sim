# Continuidad de VExUS Sim

## Alcance vigente al 17 de octubre de 2026

El usuario pausó el desarrollo funcional para ordenar el entorno y autorizó esa limpieza con
autonomía. El 17 de octubre autorizó retomar fidelidad externa y coherencia interna. La primera ronda
registra 18 adquisiciones del atlas (nueve ventanas y dos pacientes), rechaza una rotación PW que
pierde la señal renal de referencia (208) y unifica los límites del mando de presión con la pose (209).
Se conserva el circuito de PR pequeño, evidencia antes/después y CI completa antes de integrar.

Este documento es el punto de entrada. `CONTRIBUTING.md` define el procedimiento de aceptación;
la configuración ejecutable de CI y sus verificadores determinan qué se ejecuta. Los prompts antiguos,
las pestañas abiertas y los JSON de una sesión son antecedentes, no estado vivo.

## Último cierre funcional acreditado

- Repositorio: [DanielOpazoD/vexus-sim](https://github.com/DanielOpazoD/vexus-sim).
- [PR254](https://github.com/DanielOpazoD/vexus-sim/pull/254): integrado el trabajo acumulado de
  anatomía compartida, movimiento libre y arranque con dos vistas.
- [PR255](https://github.com/DanielOpazoD/vexus-sim/pull/255): fusionado el 15 de octubre a las
  20:40:05 UTC. Head `7539a31a07b24d7a660c886892c39180bf45f781`; merge en main
  `70d1d0df1b7ca65818a430e3e40e9de2732eb336`.
- Árbol del cierre: `9f8b8304967d26ea4818257453205f34e046cf70`, idéntico al head y al merge probado
  `8a954a65413f4567fb22843042d9ea945cc8db8b`.
- [CI del cierre](https://github.com/DanielOpazoD/vexus-sim/actions/runs/38799555332): 15 trabajos
  aprobados; 139 E2E únicas, una ejecución por prueba y cero reintentos entre 12 informes originales.
  Core: 1.514 aprobadas y 10 fallos esperados; matrices: 54 aprobadas y un fallo esperado.
  Informes y procedencia comprobados con los verificadores del repo.
- El 16 de octubre se volvió a consultar GitHub: ese main seguía vigente y no había PR abiertos.
  Es una observación fechada; volver a consultar antes de actuar.
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
- El margen del bundle del cierre era pequeño: 1.032,6 / 1.033 KiB. Se mantiene el presupuesto.

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
