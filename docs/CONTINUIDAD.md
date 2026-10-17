# Continuidad de VExUS LAB

## Alcance vigente al 17 de octubre de 2026

El usuario pausó el desarrollo funcional para ordenar el entorno y autorizó esa limpieza con
autonomía. El 17 de octubre autorizó retomar fidelidad externa y coherencia interna. La primera ronda
registra 18 adquisiciones del atlas (nueve ventanas y dos pacientes), rechaza una rotación PW que
pierde la señal renal de referencia (208) y unifica los límites del mando de presión con la pose (209).
La siguiente ronda aborda interfaz clara y disposición adaptable (210), con invariantes de adquisición.
El usuario añadió arrastre Doppler en vivo y regreso a 2D al elegir otra ventana (211).
Ambas se integraron en PR258 con CI completa. PR259 integró el selector por territorio y el acceso portal subcostal anterior (212). La ronda actual
213 añade el nombre/logo VExUS LAB y mejora el acceso subcostal Atlas hacia la rama portal derecha.
El cierre 213 sigue pendiente de su CI protegida y fusión.
Se conserva el circuito de PR pequeño, evidencia antes/después y CI completa antes de integrar.

Este documento es el punto de entrada. `CONTRIBUTING.md` define el procedimiento de aceptación;
la configuración ejecutable de CI y sus verificadores determinan qué se ejecuta. Los prompts antiguos,
las pestañas abiertas y los JSON de una sesión son antecedentes, no estado vivo.

## Último cierre funcional acreditado

- Repositorio: [DanielOpazoD/vexus-sim](https://github.com/DanielOpazoD/vexus-sim).
- [PR259](https://github.com/DanielOpazoD/vexus-sim/pull/259), fusionado el 17 de octubre a las
  21:31:42 UTC: selector por territorio y porta subcostal (212). Head
  `ad44bb2ac572623c9be52deea511b7a916034283`; main `cf584e47ac9edd98b8f72a02ad80df8ba9f89c4b`.
- Árbol `453c0dc9e2e25aed33e91d26b3c9391f9eff4416`, idéntico al merge probado
  `a108dd4b7a9c5b915fca71e4a8fdaf7c97d1a509`.
- [CI del cierre](https://github.com/DanielOpazoD/vexus-sim/actions/runs/39068831739): 15 trabajos
  aprobados; 145 E2E únicas, una ejecución por prueba y cero reintentos entre 12 informes originales.
  Core: 1.525 aprobadas y 10 fallos esperados; matrices: 54 aprobadas y un fallo esperado.
  Verificadores de fuente e informes aprobados. Se conservan la primera CI fallida por inventarios
  de poses incompletos y el negativo SwiftShader del vigilante del corte.
- [PR258](https://github.com/DanielOpazoD/vexus-sim/pull/258) integró interfaz clara/adaptable (210)
  y arrastre Doppler/cambio de ventana en 2D (211), con adaptación entre 320 y 1.600 px.
- [PR257](https://github.com/DanielOpazoD/vexus-sim/pull/257) conserva el cierre anterior de presión
  (209) y el experimento PW rechazado (208). La entrega nueva no resuelve su transporte/reposición.
- Al iniciar la ronda 212, GitHub no tenía PR abiertos y `origin/main` seguía en `203f6b3`.
  Es una observación fechada, no estado vivo.
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

## Selector aceptado (212) y ronda VExUS LAB (213)

El selector ofrece ocho accesos en cuatro grupos: Porta (intrahepática/subcostal), Suprahepáticas
(intercostal/subcostal), VCI (eje corto/largo) y Renal (focalizada/hepatorrenal). Menú y marcas 3D
comparten la lista. Los presets históricos `flank` y `portalTrunk` siguen disponibles para calibración
interna, fuera del menú; las diez poses no restringen el desplazamiento continuo.

`portalSubcostal` es un acceso anterior nuevo, estimado sobre cada geometría fija: no cambia órganos,
vasos, flujo ni shaders. Se seleccionó una misma pose por modelo para ambos pacientes mediante
trayectoria acústica y composición de la puerta, con adquisición IQ posterior. Las seis pruebas
nuevas exigen tronco dominante >90 %, transmisión >0,01, coseno ≥0,5, calidad útil y PF normal <30 % /
severa >50 %. Pasaron localmente, junto con las cuatro pruebas portales intrahepáticas existentes.
Son controles del simulador; no constituyen calibración humana ni validación clínica independiente.

Al elegir el acceso subcostal portal se usan 15 cm y foco a 10 cm. Se conserva el regreso a 2D,
salida de cine/congelación y cancelación de medición pendiente; mover la sonda libremente conserva
el modo. La ronda 212 se integró con check y CI completa. En 213 solo cambia el apoyo Atlas: bajo el reborde
subcostal derecho, rama `pvRight`, φ 2,85, z −95 mm. El barrido incluye el esqueleto real y descarta
los candidatos intercostales; mejora el ángulo de unos 53° a 29° en la referencia sintética. La puerta
adquirida es 100 % derecha en ambos pacientes, PF 13,71/70,70 %, con calidad útil. Legacy/reference
conservan el tronco anterior. Ver decisión 213 y `docs/evidence/portal-subcostal-213.json`.
La aceptación 213 exige check completo, inspección visual y CI protegida sobre el head final.

## Límites y resultados que no deben perderse

- El corte es asíncrono; las tres presentaciones no son simultáneas durante todo movimiento.
- Hubo un timeout local con cinco referencias históricas adicionales congeladas. Se conserva como
  negativo; la comparación aislada posterior se interrumpió y no cuenta como aprobación.
- Las primeras cifras 150,2 → 67,4 ms incluían otra vista adquiriendo. Su régimen es diferente del
  cierre final; no mezclar las dos series.
- El desborde móvil anterior se corrigió en PR258; en móvil consola y anatomía se alcanzan
  desplazándose verticalmente, sin prometer la simultaneidad de un escritorio.
- La primera CI de PR258 falló en una captura VSH; se conservan sus originales y el diagnóstico.
  El éxito del cierre posterior no demuestra que esa intermitencia esté resuelta.
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

### Observación local durante la ronda212

Una corrida SwiftShader de seis pruebas registró cinco aprobadas y un error «corte sin avance durante
3 s» al exportar la porta intrahepática del modelo reference, antes de entrar al acceso subcostal
nuevo. La pose y el vigilante del corte no cambian en esta ronda. Un control de esa adquisición sobre
main203f6b3 pasó; por tanto no se aisló la causa y no se declara reparada ni se atribuye al entorno.
Se conservan ambos originales. La aceptación sigue dependiendo de la CI completa del head final;
un resultado verde posterior no convierte esa corrida local fallida en aprobada.
