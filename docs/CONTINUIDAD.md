# Continuidad de VExUS LAB

## Ronda vigente: quince bloques, prioridad 1, 2 y 5

El usuario autoriza el 24 de octubre de 2026 la [ronda siguiente](fidelity/NEXT15.md): referencias
independientes, desfase completo y moteado primero; luego los demás bloques según dependencias.
Autoriza revisar pruebas obsoletas con justificación y evidencia, sin bajar resolución ni convertir
fallos en aprobación. Los contratos y negativos se preservan según `CONTRIBUTING.md`.

Base local/remota comprobada: main `8d7ad19209ac7a375f27ba7466a27c64220f3eee`, PR276. La ronda
anterior quedó cerrada con CI postmerge40087942261 aprobada (162 E2E únicas, sin reintentos) y
seguimiento automático eliminado. Las cifras y pendientes de las secciones históricas siguientes
no sustituyen este cierre. Estado activo nuevo: `../fidelity-next15-evidence/CURRENT_STATE.json`
y `PROGRESS.md`. No hay entrega aceptada de esta nueva ronda por el mero hecho de iniciar trabajo.

El componente 1a se fusionó mediante [PR277](https://github.com/DanielOpazoD/vexus-sim/pull/277)
en `77a9f9c`, con 162 E2E sin reintentos y originales verificados. Su CI independiente postmerge
`40119491086` también se verificó. Es una referencia puntual sintética PyMUST, sin cambios en la
imagen ni calibración clínica. [PR278](https://github.com/DanielOpazoD/vexus-sim/pull/278) se fusionó
en `fe6b5a9`: elimina trabajo redundante de proyección/clasificación del corte (258–259), sin
acreditar menor desfase geométrico global. Su head final `17de00e` y el postmerge `40127418625`
aprobaron por separado 162 E2E/12 grupos/cero reintentos, con originales verificados. El negativo
ARM/x86 de hashes de contorno y su reemplazo portable discriminante se conservan (260).

[PR279](https://github.com/DanielOpazoD/vexus-sim/pull/279) se fusionó en `bbdf5ad`: consume
coordenadas ignoradas durante un arrastre pausado para evitar el salto al reanudar (261), con
oráculo de paridad que distingue inputs double y Float32 exactos (262). Head `01bdb37` aprobado
por CI `40128645328`: 164 E2E/12 grupos/cero reintentos; recibo, 14 ZIP y 28 informes originales
verificados. Su CI postmerge independiente está pendiente de cierre; consultar el estado vivo.

La candidata 263 conserva campos constantes del atlas y elimina la clasificación mesentérica
espuria del testigo localizado. Metal8/Swift2 aprueban con fuente/build verificados; falta la
aceptación completa del head final. No identifica el tejido humano ni acredita reparar toda la
pared histórica. La observación inicial no localizada de 1/64 permanece separada.

B5 conserva la dependencia de trayectoria como negativo. La referencia material de 65 muestras
retorna y converge en ambos backends, pero su coste completo impide promoverla. La caché de
heterogeneidad se retiró: introduce diferencias numéricas y el coste exploratorio no supera la
variación A/A predeclarada. No cambia la textura productiva. Bloques 1, 2 y 5 siguen abiertos.

Antes de editar se apartaron reversiblemente trece archivos duplicados no seguidos: doce idénticos
a los originales y `dist 2` (enlace simbólico frente al directorio `dist`). Manifiesto y hashes en
`../fidelity-next15-evidence/quarantine-initial-duplicates/`; causa no determinada.

## Ronda 243–256: imagen, Doppler y comprobación (24 de octubre de 2026)

El usuario autoriza al menos diez mejoras adicionales, con commits, PR y merge
cuando estén validados. La [secuencia 243–254](fidelity/ITERATION_243_252.md)
aborda defectos reproducidos en pared muscular/grasa, Doppler y procedencia
de las comparaciones. El candidato conserva diez bloques: 243–248, 250 y 252–254.
249 (ancho muscular) y 251 (métrica septal grasa) se retiran al no satisfacer
sus controles de textura y gradiente. Se conservan los diagnósticos, los
anchos anteriores y los controles intactos.
La validación añade dos reparaciones: lectura GPU válida para medir el coste (255) y reutilización
exacta de A0/A1 con entradas iguales (256). Se mantienen todos los cuadros, ruido, resolución y
plazos. La instantánea se invalida con cambios anatómicos; no congela la imagen ni el movimiento.
El [PR276](https://github.com/DanielOpazoD/vexus-sim/pull/276) reúne el cambio y el cierre verificable.
El perfil sigue siendo convexo genérico de 3,5 MHz.
El estado vivo de cada bloque está en `../fidelity-243-evidence/PROGRESS.md`;
consultar Git/CI para el cierre, sin inferirlo de esta lista.

La base es main `0465256f216f11aeabf90d8505f17b317fa5737a`, PR275 fusionado.
Su CI de PR aprobó 156 E2E sin reintentos; la CI postmerge40071232877 terminó
fallida durante esta ronda por el plazo de720s de registeredComparison. El
negativo se conserva; no se atribuye a los cambios243–252. La optimización242 redujo el primer pintado
del corte alrededor de6%, pero su antigüedad global p95 sigue en≈66,5ms.
La fidelidad clínica externa y el transporte fino PW continúan abiertos.

La nueva referencia visual registra t=30s y fase33–39 en seis accesos y ambos
pacientes, con recursos/build verificados. El banco inicial sin fase fija se
conserva, pero no se usa como igualdad A/B. Ningún resultado interno demuestra
que un experto humano confundiría el simulador con un ecógrafo real.

## Antecedente: ronda 242 del 24 de octubre de 2026

La ronda 242 continúa el desfase del corte mediante una evaluación corporal
que omite derivadas cuando solo se consume profundidad. Conserva fórmula,
coeficientes, orden de Horner y las cinco salidas completas para geometría y
normales. No modifica GLSL, adquisición, resolución ni plazos. El código de
la comparación es `e1b7279`, sobre main `338d123`.

La pareja nueva en Metal M4 conserva seis coordenadas, ambos pacientes,
1728 muestras y 588 peticiones por versión. Primer pintado p95 **26,8 →
25,2 ms**, mejora en 10/12 filas; antigüedad mostrada p95 **66,5 → 66,5 ms**.
Las doce trayectorias convergen a la adquisición congelada sin separación.
La mejora de cálculo/presentación es parcial: no declara resuelto el desfase
global ni mide latencia física. Dos variantes previas excedieron el presupuesto
y se descartaron; el límite original permanece. Evidencias y negativos:
`cut-latency-242-evidence`, fuera del repo, con originales y hashes.

La aceptación de esta ronda exige check completo, hook normal, coherencia
3D/corte/ecografía en Metal, barrido original de dos vistas SwiftShader y CI
completa del último head del PR. Los diagnósticos anteriores no sustituyen
esos controles. Consultar el PR y Git para conocer su cierre efectivo.

La CI posterior al merge anterior de main `338d123`,
[39213603114](https://github.com/DanielOpazoD/vexus-sim/actions/runs/39213603114),
falló en `registeredComparison`: agotó 720 s en `captureBMode → page.evaluate`
al capturar una imagen registrada. No fue un fallo de subida de artefactos.
El stack no separa lectura, serialización o trabajo GPU pendiente; no demuestra
una causa en el Worker del corte. El negativo queda conservado y esa prueba
sigue siendo obligatoria en la nueva CI, sin reintentos automáticos.

## Antecedente del 19 de octubre: ronda 241

El usuario autoriza continuar con el desfase del corte. La decisión 241 elimina
la espera al siguiente RAF para presentar una respuesta del Worker y atender
la última adquisición. El primer candidato `2618ed33` se rechaza: el barrido
original SwiftShader de dos vistas agota 540 s en basculación hepatorrenal.
El segundo limita el callback a `cutMap.draw` y separa el mapa del estado que
invalida ECG/espectro/M; overlay y contorno se atienden en el siguiente RAF.

La pareja nativa de seis coordenadas y ambos pacientes del segundo candidato
(árbol modificado, con recibo propio) registra envío a primer pintado p95
**36,2 → 28,5 ms**, mejora en **11/12** filas, máximo **37,8 → 44,4 ms** y
antigüedad mostrada p95 **66,7 → 66,9 ms**. No resuelve el desfase global ni
hereda los 288 registros renales del primer candidato. La prueba focalizada
conserva 111 respuestas activas sin pintura auxiliar adicional y 707 fondos
ECG adquiridos sin duplicados; las tres pinturas previas a adquisición quedan
explícitas fuera de comparación. Restaurar el callback completo falla con
contador auxiliar 66 → 68.

El estado de aceptación se consulta en
[PR273](https://github.com/DanielOpazoD/vexus-sim/pull/273) y su CI del último
head. Exige check, barrido SwiftShader original e imagen/interacción; los
resultados del primer candidato no lo acreditan. Conservar instantáneas
adquiridas, una petición, resolución, física, plazos y negativos. La
comparación diagnóstica no sustituye esa aceptación.

[PR272](https://github.com/DanielOpazoD/vexus-sim/pull/272) integró 234–240 en
`84c210fe800a73e6025e7ab1a23a669ffe0d4d34`, árbol
`31d08ff0df2f9e1295e17cdf4e0f4f6a1109e6bf`. Su CI aprobó 156 E2E sin reintentos.
La CI independiente de ese main,
[39200993860](https://github.com/DanielOpazoD/vexus-sim/actions/runs/39200993860),
terminó fallida: las 13 pruebas del grupo 12 pasaron, pero dos uploads de
artefactos agotaron la conexión. No es aprobación ni fallo observado del
simulador. Log, metadatos y artefacto parcial original permanecen en la evidencia
241; no sustituye los informes ausentes ni justifica debilitar el gate.

## Antecedentes de alcance

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

## Ronda 234–240: coherencia Doppler y evidencia independiente

El usuario autoriza implementar las prioridades clínicas/acústicas por entregas,
con PR y merge cuando aprueben. Confirma convexo **genérico de 3,5 MHz**. La
[secuencia y criterios](fidelity/ITERATIVE_REVIEW.md#referencia-externa-y-siguiente-secuencia)
separa cambios comprobables de lo que necesita referencias o participantes reales.

- Color adopta la respuesta estacionaria del receptor PW; el corte efectivo se
  refleja también en el equipo. Sigue sin procesar ensembles IQ reales (234).
- La prueba de procedencia de cine usa el regulador GPU ordinario, conserva sus
  cuatro capturas y plazo original (235). La CI independiente de main `46b6443`,
  [39181911250](https://github.com/DanielOpazoD/vexus-sim/actions/runs/39181911250),
  falló en esa prueba; su traza demuestra cola de renders manuales. El negativo
  queda preservado y no se convierte en verde con capturas adjuntas durante teardown.
- Ventilación: aviso condicional y rótulo M contextual, sin modificar grado ni
  medida y sin consultar la verdad oculta para elegir texto (236).
- [Admisión externa](fidelity/external-evidence.md): integridad de archivos y
  separación declarada por sujeto, sesión y hash, con calibración medida,
  evaluación reservada y validación humana pendientes. El
  [protocolo humano](fidelity/human-validation.md) está preparado, sin resultados (237).

El candidato e68029c pasó Metal, pero el barrido local de dos vistas SwiftShader
agotó 540 s durante movimiento hepatorrenal. La decisión 238 completa la valla
que solo cubría ecografía para incluir el contexto WebGL separado de 3D. Es un
defecto de contrato comprobable; su contribución al coste acumulado requiere
medición. La decisión 239 renueva cuatro frases reversibles de transporte GLSL
para mantener 1033 KiB sin modificar tokens. No integrar sin repetir la prueba
original y aceptar el head final.

La repetición original sobre `d3bdfce` terminó con **seis pruebas aprobadas y
una fallida**: `renalCutTracking` volvió a agotar 540 s. La reparación del
contrato multicontexto no acredita haber resuelto ese coste. Un perfil posterior
del mismo head limpio, SwiftShader con readbacks serializados, registró 535,3 ms
de mediana posterior del render instrumentado, 52,1 ms por draw de gradiente
dirigido (tres por adquisición) y 0,55 ms de `advance`. Es diagnóstico de coste,
no fps ni comparación de aceptación. La decisión 240 evita recalcular los
gradientes completos en los dos tiles que el eco no consume, conservando el
eje 0 y las tres ramas de diferencias separadas. El perfil instrumentado de
`6e59ee7` registra 511,65 ms frente a 535,3 ms (−4,42 %), una cohorte por versión,
sin acreditar fps ni aislar una causa de todo el coste. Los oráculos diagnósticos
Metal y SwiftShader conservan los bytes consumidos y detectan 21 mutaciones.
El barrido original de dos vistas pasó en el head limpio `6e59ee7`, en 8,9 min
y con los mismos 540 s: el margen es pequeño. La adquisición ordinaria Metal
usa B directa; el oráculo compila el cuerpo por etapas en ambos backends.
Se conservan negativos y perfiles anteriores. La comparación temporal por
hashes queda como evidencia histórica de alcance, fuera del gate permanente;
el oráculo GPU funcional protege las iteraciones posteriores. Check y CI
íntegros del head final siguen siendo condiciones de aceptación.

PW fino **continúa abierto**: se reprodujo en la referencia renal quieta una
fracción 0,432 y peso 0,0463 frente a 0,568 y 0,0701 frescos a 10,5 s. La
clasificación por anclaje fue rechazada porque emitiría sangre desde tejido.
Un prototipo curvo con Jacobiano permanece fuera del runtime: falta reconciliar
trayectoria, campo de velocidad y reposición con la geometría fuente. No cambiar
gates, ganancia ni calidad para aceptar esa recuperación.

La aceptación y el cierre deben consultarse en el PR y la CI del head final.
Estas notas describen el candidato y no acreditan fidelidad externa ni cierre PW.

## Referencia para retomar la entrega actual

La auditoría 228 ordena el trabajo por pared regional, cortical vertebral y desfase del corte.
Las decisiones 229–232 limitan el soporte posterior de los planos interoblicuos, derivan la
curvatura vertebral de su campo fuente y reducen trabajo repetido del corte sin cambiar muestras.
La aceptación del candidato debe consultarse en Git/CI, no inferirse de esta descripción.

- La ronda 233 reevalúa el entorno por petición del usuario: [mediciones y alcance](engineering/iteration-audit-233.md).
  Añade preflight HTTP, recursos del equipo en las evidencias y lote CPU local acotado con modo
  secuencial explícito. No cambia el simulador ni la distribución de CI. Conserva aceptación,
  inventario, aislamiento y plazos; el PR debe acreditar el check final y la CI completa.

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

- [PR270](https://github.com/DanielOpazoD/vexus-sim/pull/270): pared posterior, curvatura vertebral
  compartida y menor trabajo CPU del corte (229–232). Main `faf5cc19318be65340b87a5d9eac7f35b41bda11`,
  árbol `ee131608fa969d9346855ed0e83e80184e4b1a52`, idéntico al aprobado. La
  [CI del PR](https://github.com/DanielOpazoD/vexus-sim/actions/runs/39173366446) y la
  [CI posterior de main](https://github.com/DanielOpazoD/vexus-sim/actions/runs/39175680502)
  aprobaron 154 E2E únicas, doce grupos y cero reintentos; recibos originales verificados.
  La entrega revisó además los seis workflows suplementarios aplicables y sus 17 trabajos.
  El build de main verificó sus 50 recursos y ocho capturas nativas coincidieron con el candidato.
  El Worker bajó alrededor de 8 % en la muestra nativa; el desfase mediano siguió en dos cuadros
  y la antigüedad del corte no mejoró. No dar esa latencia ni la fidelidad externa por resueltas.

### Cierre funcional anterior

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
