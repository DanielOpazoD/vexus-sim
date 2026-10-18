# Continuidad de VExUS LAB

## Alcance vigente al 18 de octubre de 2026

El usuario pausó el desarrollo funcional para ordenar el entorno y autorizó esa limpieza con
autonomía. El 17 de octubre autorizó retomar fidelidad externa y coherencia interna. La primera ronda
registra 18 adquisiciones del atlas (nueve ventanas y dos pacientes), rechaza una rotación PW que
pierde la señal renal de referencia (208) y unifica los límites del mando de presión con la pose (209).
La siguiente ronda aborda interfaz clara y disposición adaptable (210), con invariantes de adquisición.
El usuario añadió arrastre Doppler en vivo y regreso a 2D al elegir otra ventana (211).
Ambas se integraron en PR258 con CI completa. PR259 integró el selector por territorio y el acceso portal subcostal anterior (212). La ronda
213 añadió el nombre/logo VExUS LAB y mejora el acceso subcostal Atlas hacia la rama portal derecha.
La ronda 213 se integró en PR260. La ronda 214 corrige la legibilidad de la leyenda Color; se integró en PR261 con check y CI protegida (149 E2E únicas sin reintentos).
Se conserva el circuito de PR pequeño, evidencia antes/después y CI completa antes de integrar.

Este documento es el punto de entrada. `CONTRIBUTING.md` define el procedimiento de aceptación;
la configuración ejecutable de CI y sus verificadores determinan qué se ejecuta. Los prompts antiguos,
las pestañas abiertas y los JSON de una sesión son antecedentes, no estado vivo.

## Referencia para retomar la entrega actual

La auditoría 228 ordena el trabajo por pared regional, cortical vertebral y desfase del corte.
La decisión 229 limita el soporte posterior de los planos interoblicuos; la aceptación del
candidato debe consultarse en Git/CI, no inferirse de esta descripción.

- La ronda 227 vincula el build local con su fuente y verifica los recursos de la preview externa
  antes de las E2E; ver [entorno y reproducción](engineering/workspace.md). No cambia el simulador
  ni la aceptación. Se conserva la preparación de workflows suplementarios: los datos disponibles
  no prueban que sustituir su instalación por contenedores vaya a ahorrar tiempo.
- La ronda 226 revisa el coste de iteración y el entorno, sin cambios funcionales: ver
  [auditoría y prioridades](engineering/iteration-audit-226.md). Actualiza pesos E2E con tres CI
  completas y evita workers GPU locales simultáneos por omisión; mantiene aceptación, física,
  resolución y plazos. Integrada en [PR268](https://github.com/DanielOpazoD/vexus-sim/pull/268):
  [CI protegida](https://github.com/DanielOpazoD/vexus-sim/actions/runs/39161264500), 154 E2E únicas,
  cero reintentos. La primera medición independiente fue 27m29s frente a 29m41s del PR267
  (−7,41 % de workflow), menor que la predicción retrospectiva de 18–24 %; no confundir ambos datos.
  La aceptación posterior y la de cada ronda nueva deben consultarse en Git/CI.

### Último cierre funcional acreditado

- [PR267](https://github.com/DanielOpazoD/vexus-sim/pull/267): pared abdominal y cuña de relleno
  (222), lectura ósea precisa y diagnósticos de arranque/corte (223). La segunda anotación corrige
  la lectura inicial: la masa roja es tejido no segmentado. Fusionado en main
  `62feab58544803f4430a76ad4fcfc9b514577f09`, árbol `18b9cddabf202b2ab274a85730964f25d370b102`,
  idéntico al aprobado. La [CI del PR](https://github.com/DanielOpazoD/vexus-sim/actions/runs/39154581661)
  acredita 154 E2E únicas, cero reintentos, core/matrices íntegros y recibo original verificado;
  nueve workflows y 48 comprobaciones aprobadas. La [CI posterior de main](https://github.com/DanielOpazoD/vexus-sim/actions/runs/39156988840)
  también terminó aprobada. Los negativos de 57189da y los timeouts de 50934f6 se conservan.
  La ronda 224 reduce transporte de capturas. La 225 evita grabación continua adicional durante
  el barrido sin cambiar sus comprobaciones. Hubo además 25 E2E Metal y diez capturas A/B
  controladas del head final, y revisión nativa del merge en ambos pacientes.
  El inicio renal se registra sobre la nueva piel y el hepatorrenal se bascula 6° para conservar
  visibilidad A/B. El campo fuente, resolución, plazos y movimiento libre siguen siendo los mismos.

### Cierre acreditado anterior

- [PR266](https://github.com/DanielOpazoD/vexus-sim/pull/266): seno renal más fino (220)
  y normales septales derivadas de su campo material (221). Main `3e4614cfa3ffd0695b3fd12cc438229dce20799a`,
  árbol `8df306c471ce3ff33b0da6857626cbb51488272a`. La [CI del PR](https://github.com/DanielOpazoD/vexus-sim/actions/runs/39123181714)
  aprobó 154 E2E únicas sin reintentos; seis workflows y 30 comprobaciones aprobadas.
  La [CI posterior del push](https://github.com/DanielOpazoD/vexus-sim/actions/runs/39125336068)
  falló por el plazo original de 540 s durante la captura final de `renalCutTracking`.
  No es aprobación ni prueba de una nueva causa aislada; el negativo se conserva en la ronda 222.
  Las comprobaciones locales del cierre fueron 13 Metal y 5 SwiftShader, sin ampliar plazos.

### Cierre anterior

- [PR264](https://github.com/DanielOpazoD/vexus-sim/pull/264): transición costal localizada (217)
  y pausa sin vallas GPU vacías (218). Main `f031e438eec59b3a74633cb058307447f6449115`, árbol
  `9e3f91434a9168dd1a10b274af7db5b100429226`. La [CI del PR](https://github.com/DanielOpazoD/vexus-sim/actions/runs/39110219774)
  verificó 152 E2E únicas una vez, cero reintentos, core y matrices completos. La [CI posterior del push](https://github.com/DanielOpazoD/vexus-sim/actions/runs/39112783065)
  también terminó aprobada. El barrido renal del PR pasó en 538.371 de 540.000 ms: sigue habiendo
  poco margen y no se dan por aisladas todas las intermitencias previas. Se conservan los negativos.
- La decisión 219 ordena el proceso: feedback local focalizado, build/presupuesto temprano,
  cero reintentos automáticos y recibo compacto después del veredicto completo. No modifica
  comportamiento, anatomía ni física. Ver [criterios y comandos](engineering/iteration.md).
  La aceptación de cada entrega debe consultarse en su PR; este documento no sustituye Git/CI.

## Historial de cierres anteriores

- [PR261](https://github.com/DanielOpazoD/vexus-sim/pull/261), fusionado el 18 de octubre a las
  01:20:18 UTC: escala Color legible en píxeles CSS (214). Main
  `1da143a6601b744862da2f328ea0781521f556e8`, árbol `c1acd4f997b401fc5d1b8f6e5c48f57b4fc1bf68`.
  [CI protegida](https://github.com/DanielOpazoD/vexus-sim/actions/runs/39081851788): 149 E2E únicas,
  una ejecución y cero reintentos, core/matrices íntegros y procedencia verificada. La comprobación
  venosa adicional ejecutó 14 pruebas tres veces sin reintentos. El push posterior
  [39086118287](https://github.com/DanielOpazoD/vexus-sim/actions/runs/39086118287) también terminó
  correctamente; no demuestra que las intermitencias históricas hayan sido aisladas.

- [PR260](https://github.com/DanielOpazoD/vexus-sim/pull/260), fusionado el 17 de octubre a las
  22:52:53 UTC: VExUS LAB y acceso subcostal Atlas a la rama portal derecha (213).
  Main `e368c838db9f59b5a1c30a468711579fa7f34ef3`, árbol `8e5cefdda0a86ab1082424cbed4025cf90addc5f`,
  idéntico al árbol probado. [CI del PR](https://github.com/DanielOpazoD/vexus-sim/actions/runs/39074433956):
  147 E2E únicas, una ejecución y cero reintentos; core y matrices íntegros verificados.
  La ejecución posterior al merge [39076839522](https://github.com/DanielOpazoD/vexus-sim/actions/runs/39076839522)
  falló en `renalCutTracking`: Rotación conservó −3° cuando la pose hepatorrenal ya estaba en −14,0103°.
  El reintento diagnóstico repitió el fallo. No es un timeout de arranque ni prueba de error geométrico;
  deja pendiente aislar por qué el mando no se sincronizó. La ronda 214 no lo da por resuelto.

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
adquirida es 100 % derecha en ambos pacientes. La pose publicada, redondeada a seis decimales,
registró PF 15,01/70,84 % con calidad útil; 13,71/70,70 % corresponde al candidato de precisión completa. Legacy/reference
conservan el tronco anterior. Ver decisión 213 y `docs/evidence/portal-subcostal-213.json`.
La aceptación 213 quedó acreditada en el PR; el fallo posterior se conserva arriba como evidencia independiente.

## Ronda 214: leyenda Doppler y siguiente comparación de fidelidad

El degradado compartía la paleta de la imagen, pero `H/800` reducía sus cifras al activar PW.
Se dimensiona en píxeles CSS, con 12 px de texto y barra de 12 × 113 px aproximadamente, en la esquina
superior izquierda. Incluye cero y ±Nyquist de la adquisición mostrada; conserva PRF e inversión al
congelar/cine. No se modifica el flujo, la paleta del vaso, la textura ni la señal PW.

El siguiente paso de fidelidad debe comparar capturas del SHA vigente con referencias independientes,
a igual ventana y ajustes: primero interfaces y contraste hígado/corteza/grasa/músculo; después tamaño
y relaciones anatómicas del modelo compartido; PW continúa condicionado por transporte/reposición (208).
Cada ronda elige un defecto reproducible y un mecanismo causal. No se añaden grano, sombras o trazas
superpuestas para aparentar realismo. Es una prioridad de trabajo, no una validación del aspecto actual.

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

## Prioridad actual: pared abdominal (216)

El plan se integró en [PR262](https://github.com/DanielOpazoD/vexus-sim/pull/262), con 149 E2E
únicas sin reintentos y los 26 ZIP originales verificados; no cambió la imagen.

El usuario señala bordes rectos y cambios abruptos al mover la sonda. La implementación sustituye
la interpolación lineal por parches C1 limitados, conserva nodos/ajuste previo y comparte coeficientes
entre CPU/GPU. La malla refina sus intervalos y usa las normales del mismo campo. Los primeros
ensayos se rechazaron al fallar apposición/malla; no se relajaron sus guardas. El aspecto estático
cambia poco; no presentar esta ronda como realismo global ni validación humana.
La aceptación se acredita con el PR, check y CI protegida sobre su head, más movimiento desde seis
coordenadas y ambos pacientes. El contrato del seno renal (215) queda planificado y su cambio de
imagen no se integra en esta ronda. Los pendientes PW/transportes e intermitencias anteriores
siguen abiertos hasta aislar sus causas; una nueva ejecución positiva no los resuelve por sí sola.

La primera CI de imagen39095291930 es negativa: bloqueo de avance Color+PW (móvil y escritorio), adquisición portal y una cortical de referencia perdida; los fragmentos 1/6 terminaron cancelados por su plazo original. No aceptar una repetición positiva como reparación. La corrección numérica de la cortical mantiene los coeficientes Atlas ajustados y no amplía dueños de tejidos. El tríplex temprano39100173993 pasó con el evaluador anterior, por lo que no aisló aquel bloqueo. Una comparación consecutiva sí reprodujo un coste evitable del bucle de coeficientes GLSL:178,7 s frente a123,5 s con las mismas cuatro lecturas explícitas, prueba móvil original y cero reintentos en Mac SwiftShader (estable124,5 s). Se conserva la evaluación explícita con una guarda; no se atribuyen automáticamente a ese mecanismo todas las intermitencias anteriores. El código final requiere su propia CI completa, con plazos y aserciones intactos.

## Seguimiento de la captura de pared (217)

PR263 integró216 en e5c22c0. La nueva captura del usuario demuestra que la continuidad C1 de esa
entrega no elimina por sí sola la esquina visible de la fascia. La ronda217 reconstruye únicamente
las muestras auxiliares del soporte caudal del ajuste; mantiene margen, nodos, órganos y shader.
Sus regresiones fallan con216 en ambos pacientes. La decisión217 documenta los ensayos rechazados;
no retomarlos como variantes aprobadas ni confundir sus capturas con el candidato localizado.
La aceptación efectiva y sus límites deben consultarse en el PR y CI del head final. Los pendientes
del seno renal215, transporte PW208 y las intermitencias anteriores no quedan cerrados por esta ronda.

### Negativo y corrección de recursos al pausar (218)

La CI39106183480 de321eccb es negativa por tiempo total del barrido con dos vistas, tanto en el
intento principal como en el reintento automático. Se completaron288 movimientos y cuatro
paridades sin diferencias antes del timeout final en pausa. Se conservan30 ZIP originales y
ambas trazas. La corrección218 evita vallas/flush vacíos al permanecer congelado sin cambios;
cámara, cine, tamaños, adquisición y recuperación siguen invalidando la presentación. No cambia
el plazo de540000ms ni el barrido original. La nueva prueba de recursos debe fallar con el código
anterior y el head final necesita su propia aceptación completa. No presentar el Metal/Swift
local de321eccb como aprobación de esa CI ni dar el PR264 por fusionado antes de verificarlo.

## Ronda 220: seno renal, contrato 215 activado

El usuario retoma bloques de fidelidad ecográfica. La ronda 220 implementa la célula material de
1,5 mm del contrato 215, tras conservar el negativo del campo de 3 mm; distribución y potencia
se mantienen. No confundir con el experimento histórico `9dff00a`: la nueva entrega parte de
main `5700415` y necesita sus propias adquisiciones y CI. Ver decisión220 y el PR de esta ronda
para aceptación efectiva. La escala no es una calibración clínica.

Secuencia de trabajo siguiente: comparar interfaces/pared bajo angulación (incluido el marco
material de septos y estrías sobre perfiles reales); después textura/contraste a profundidad
emparejada y, por separado, señal Color/PW. Cada bloque requiere un defecto visible y un
mecanismo causal antes de cambiar la imagen. La meta de indistinguibilidad necesita revisión
ciega humana independiente; las métricas internas y CI no la acreditan.

La ronda 221 corrige una discrepancia entre la orientación de los septos subcutáneos y su
campo material. Conserva posición y peso; usa los gradientes completos de profundidad y arco
en TS/GLSL, con negativos CPU/GPU y una prueba del shader de producción. Es un error físico,
no una nueva calibración estética. La orientación de las estrías musculares y la costura polar
posterior siguen pendientes de evaluación. Ver decisión 221 y la CI final del PR para su cierre.

## Ronda actual: pared deformada por una cuña de relleno (222)

La segunda anotación del usuario sitúa la masa roja en tejido no segmentado, no en hígado:
el diagnóstico inicial invirtió la orientación angular de la imagen. La cuña de 18–28 mm aparece
al terminar el ajuste costal y conservar relleno del perfil heredado en el flanco. La corrección
continúa el ajuste sobre las vísceras fuente y refina las direcciones del perfil, con el mismo
campo compartido en CPU, corte Worker, GLSL y piel 3D. El experimento previo de compresión C1 no
solucionó la masa y queda fuera de esta entrega. Ver decisión 222 y sus aproximaciones declaradas.

Antes de darla por cerrada: check y calibración del head final, GPU Metal/SwiftShader, navegación
continua y adquisición con dos vistas, capturas A/B y CI completa del PR. No confundir pruebas
locales del experimento anterior con aceptación. El timeout posmerge de PR266 sigue como negativo
independiente; no se declara reparado por una ejecución posterior aprobada.

La GPU del primer candidato 57189da detectó además un error de lectura en un platillo vertebral:
el corte CPU conservaba hueso y GPU devolvía grasa. La decisión 223 interpola los mismos ocho nodos
cerca de las interfaces óseas. Las pruebas conservan el plano original que reveló el error y la
exigencia de cero discrepancias; los mensajes de fallo explícito de arranque terminan la espera
sin ampliar su plazo. La aceptación del head final se acredita en PR267, no con esos ensayos previos.
