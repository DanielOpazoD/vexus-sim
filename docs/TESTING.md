# Estrategia de pruebas

Qué protege cada capa de pruebas, cuándo corre y qué no cubre. Regla general: una prueba
debe fallar si el comportamiento clínico o físico se rompe; una prueba que repite una
constante o un umbral ajustado a la salida actual no protege nada.

Durante la edición: `npm run feedback -- [archivos]` selecciona diagnóstico local proporcionado;
con el candidato estable, `npm run check` y la CI completa conservan la aceptación.
Ver [criterios de selección, costes observados y recibo CI](engineering/iteration.md).

| Capa               | Dónde                                             | Cuándo corre                                    | Qué protege                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------ | ------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unitarias rápidas  | `src/validation/*.test.ts` sin marcador           | `npm test`, gancho de push, `check`, CI         | DSP (FFT, filtro de pared, envolvente), unidades, clasificador VExUS C (27 combinaciones), anatomía por puntos, sonda y acoplamiento, capas, documentación, límites del shader (tubos, nodos y ranuras de uniforms), eco de interfaz en la distancia por la normal (`faceGradient.test.ts`: el perfil suma 1 en la VCI elíptica), transitorio omitido bajo ruido/10 al sumarse y ≤ ruido/6 tras la PSF (`receiver.test.ts`), opciones de medida del coste del cuadro (`frameCost.test.ts`), lazo cerrado de la aurícula: curvas, cruce, cinética y límites de las intervenciones (`circulation.test.ts`), contexto clínico de los casos y modo ciego (`cases.test.ts`, `blindMode.test.ts`), cableado del contexto en las pestañas Medir y Docente con un DOM falso (`contextUi.test.ts`, `support/fakeDom.ts`), envolvente unilateral de la porta, aliasing fuerte, identidad del vaso y trazado de la captura sobre espectros sintéticos (`portalMeasure.test.ts`), las trampas y los confusores reales solo en el chunk de la pestaña Docente (`codeSplitting.test.ts`) |
| Lentas             | primera línea `// @tier slow`                     | `npm run test:all`, `check`, CI                 | Fisiología emergente por caso, cadena Doppler, **cadena completa del alumno** (`examChain.test.ts`: puerta → espectro → medición → grado, por la ruta de la app de `support/studentChain.ts`), **escalas del alumno** (`examChainScale.test.ts`: PF portal a ±20–±80 cm/s en los 7 casos, apnea y respiración, 3 semillas; `examChainScalePatterns.test.ts`: patrón de la suprahepática y de la interlobar a esas escalas; decisión 94), **propiedades** (`properties.test.ts`, fast-check), **intervenciones** sobre el lazo cerrado (`interventions.test.ts`: bolo, diurético y PEEP en la VCI, los Doppler y el grado, y fast-check de secuencias), **gemelo B→C→D de los ecos de interfaz** (`interfaceTwin.test.ts`: β, deriva con la profundidad, M1–M9 y la regla de antes con `it.fails`), **casos trampa** (`traps.test.ts`: la discordancia de cada uno en respiración tranquila y en apnea, con sus controles; y por la cadena del alumno en `examChain.test.ts`)                                                                                               |
| Cobertura          | `npm run test:coverage`                           | `check`, CI                                     | Umbrales globales (≥ 88 % sentencias, ≥ 83 % ramas) que solo pueden subir; excluye lo que necesita DOM/WebGL/Web Audio                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| e2e                | `e2e/*.spec.ts` (Playwright + SwiftShader)        | `npm run e2e`, CI en paralelo con `check`       | Arranque sin errores, casos, medición numérica, pérdida y recuperación del contexto WebGL, **equivalencia TS ↔ GLSL** en tejido, vaso, velocidad y cara de interfaz (volumen y cáscara de las caras), **SNR de Rayleigh del speckle** hepático, **normales de la GPU** frente al gradiente de `faceSdf`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Banco de fidelidad | `tools/fidelity/bench.ts` (Playwright + GPU real) | `npm run fidelity`, a mano en cada PR de imagen | Textura de la envolvente y de la imagen mostrada, banco de interfaces (paredes por sistema, cápsula, diafragma, Morison; `--sweep` con 4 poses más por vista), cps y coste del cuadro sin y con color; línea base en `docs/fidelity/baseline.json` (decisión 52). La prueba ciega con jueces: `npm run fidelity:blind`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Qué corre dónde (decisión 322, punto 7)

| Dónde                                     | Qué corre                                                                                                      | Tiempo medido en este equipo                                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Gancho de push (`.githooks/pre-push`)     | `npm run feedback -- --all-fast`: formato y lint de lo cambiado frente a `origin/main`, tipos y la capa rápida | pool anterior: 120–122 s en ABBA, pero 230,2 s y timeout en el cierre de d580cac; se acota a cuatro trabajadores como máximo; tope 180 s |
| `npm run check`                           | formato, índice, lint, tipos, build, presupuesto y todas las pruebas con cobertura (core y matrices)           | 62 min en serie con un trabajador (cierre del punto 8); 75–86 min en los cierres de P2 r2b-U y P3 r2                                     |
| CI protegida (`.github/workflows/ci.yml`) | lo de `check` repartido en core y matrices, la E2E en doce fragmentos y el tríplex temprano                    | core y matrices con techo de 25 min, E2E de 40; su recibo es la puerta de fusión                                                         |
| Cierre de ronda (`npm run closure`)       | las etapas de abajo, en serie y con un trabajador                                                              | ≈102 min de etapas en el cierre del punto 8: `check` 62, lentas 29, rápidas 7, gancho 2,3                                                |

El gancho adelanta los errores baratos antes de publicar; no acredita nada. Un push que sólo borra ramas remotas
(`git push --delete`: todas las sha locales que recibe el gancho en ceros) no publica código y no corre nada: 0,02 s
frente a ≈120 s. Lentas, matrices, cobertura, build y E2E
quedan en `check` y en la CI protegida, que ya es la puerta de fusión (`CONTRIBUTING.md`). Una rama sólo puede introducir
errores de formato o de lint en lo que cambia, y la CI sigue comprobando todo el repo; un cambio de configuración de
Prettier o ESLint conviene comprobarlo entero (`npm run format:check`, `npm run lint`). Con carga ajena el gancho sigue
limitado a `max(1, min(4, floor(availableParallelism() / 2)))` trabajadores (cuatro en este equipo),
con el plazo por prueba de 60 s y las aserciones intactos. El pool anterior no garantizaba caber: con carga 7,32 al empezar,
el cierre de `d580cac` tardó 230,2 s y una prueba de `s0028SolidsClassify` 62,8 s. No se cambia su archivo ni se mueve ninguna prueba de capa.
El gancho incluye deliberadamente los archivos sin seguimiento que Git no ignora, igual que el feedback: forman parte del
checkout que compilan y prueban las herramientas y no deben ocultar errores. Los borrados se conservan en el plan pero no se
pasan a formato/lint. Si falta `origin/main`, bloquea con un mensaje que pide `git fetch origin main`, sin traza de Node.

Presupuestos (`tools/ci/testTiers.ts`), medidos en este equipo (10 núcleos: 4 de rendimiento y 6 de eficiencia; modo de
bajo consumo activo):

- **Gancho completo ≤ 180 s sin carga ajena.** La etapa `push-hook` del cierre corre el gancho real, sin `nice` y con los
  trabajadores de un push, y lo marca fuera de presupuesto si lo supera aunque termine en 0.
- **Cada archivo de la capa rápida ≤ 49 s con un trabajador**: el doble del más lento medido en `main` 8555a2c
  (`equivalenceSweep.test.ts`, 24,5 s). La etapa `tests-fast` guarda el informe JSON de Vitest y `tools/ci/tier-budget.ts`
  rechaza un informe incompleto, paralelo (sus tiempos dependen del reparto entre núcleos) o un archivo por encima. Un
  archivo que lo supera se etiqueta `// @tier slow` o se aligera, y el PR dice su tiempo.
- **Un tiempo sólo vale con carga ≤ 5** (`TIMING_MAX_LOAD`): con más, un proceso serial pasa parte del tiempo en núcleos
  de eficiencia y la inflación es muy desigual por archivo (la capa rápida serial tardó 541 s con carga media 12 frente a
  395 s con 4,9; mediana de los cocientes `before2 / before3` ×1,16 en los 274 archivos emparejados y ×1,06 en los 48 con base > 2 s). Por encima, el presupuesto se declara no evaluable con la carga medida;
  nunca se da por cumplido ni por incumplido. `tier-budget.ts` mira la media de 5 min al terminar; `push-hook`, la carga
  al empezar. Una etapa con presupuesto no evaluable queda `budget-unavailable`, no `passed`, y el cierre sale con 1;
  el informe de capa devuelve el código reservado 3. Sus pruebas pueden estar verdes sin acreditar el presupuesto.
- Los quince archivos más lentos de cada capa quedan en `runs/tests-{fast,slow}-N/tier.json` de cada cierre.

```bash
npm run closure -- --evidence ../evidencia/cierre-$(git rev-parse --short HEAD) --wait-load 15 \
  --python "$VEXUS_PYTHON" --python-exclude a_test.py --python-exclude-reason 'motivo'
npm run closure -- --evidence ../evidencia/cierre-abc1234 --resume   # sólo las etapas no aprobadas
npm run closure -- --evidence /tmp/plan --only lint,typecheck --dry-run
npm run closure -- --checkout ../otro-worktree --evidence ../evidencia/otro   # cierra otro checkout con esta herramienta
```

Etapas, en orden: `prettier`, `docs-index`, `lint`, `typecheck`, `push-hook`, `tests-fast`, `tests-slow`,
`python-contracts`, `build`, `check`, `calibrate` y, con su bandera, `e2e-swiftshader` / `e2e-metal` (`workspace:e2e`).
Todas salvo `push-hook` corren con `nice -n 10`, `VITEST_MAX_WORKERS=1` y `VEXUS_VALIDATION_MODE=serial`. Antes y después
de cada etapa se anotan la carga (`vm.loadavg`, la de `uptime`) y el modo de energía (`pmset`), y durante, una muestra
cada 30 s. El cierre rechaza un árbol con cambios salvo `--allow-dirty`, se detiene si HEAD o el contenido cambian entre
etapas, comprueba HEAD y árbol al final y añade a `progress.md` una línea «Cierre <etapa>: código N; HEAD …» por etapa.
`--resume` conserva las etapas aprobadas del mismo checkout (ruta real), HEAD, contenido y definición; rechaza otro clon.
Repite las no aprobadas, incluso un presupuesto no evaluable con pruebas verdes. Excluir una etapa antes fallida con
`--skip` o `--only` conserva el fallo y la salida no es 0. Cada intento conserva su log (`logs/<etapa>-<intento>.log`)
y queda en `previousAttempts`. `check` copia sólo informes `.validation/` modificados desde `startedUtc` del intento.
SIGINT, SIGTERM y SIGHUP finalizan `closure.json`, también durante la espera de carga, y terminan el grupo de procesos
de la etapa (incluidos nietos), con SIGKILL si persisten. Un cierre parcial desde cero puede aprobar sólo lo pedido;
`complete` exige todas las etapas obligatorias. Ningún cierre se aprueba antes de comprobar HEAD y contenido al final.

## Principios

- **Pipeline real**: las pruebas de regresión recorren el camino que usa la app, no una copia. La cadena del alumno
  (`support/studentChain.ts`) pone la puerta con `pwGate`, la misma geometría que `Simulator.updateGate` (con la
  transmisión real y el acoplamiento), la actualiza una vez por cuadro de 8 pasos y captura con
  `captureProtocolVessel`, la función de «Capturar» (columnas de la PRF actual, latidos, calidad e identidad del vaso).
  **Nota honesta:** hasta la decisión 94 `examChain.test.ts` incumplía este principio: usaba una copia de `updateGate`
  con la transmisión fija en 0,3 (−10 dB; la real es −29 a −32 dB en la porta) y medía solo a la PRF máxima. Con esa
  copia la PF del alumno salía a ≤ 8 puntos de la verdad mientras en la app, a la escala por defecto, el sano daba 111 %
  «grave» con el visto bueno de la calidad. Una copia «equivalente» del camino de la app no es el camino de la app.
- **Técnica del operador**: la puerta se coloca con `bestGateOnVessel` (dentro de la luz, mejor
  ángulo) y la escala hasta el límite de la profundidad; no con atajos que el alumno no tiene. Y además las escalas
  que usa el alumno (±20–±80 cm/s): una medición que solo es verdadera a la PRF máxima no protege al alumno.
- **Mutación**: al añadir un gate, se comprueba que falla con el defecto que pretende atrapar
  (el de equivalencia se probó reintroduciendo la ley de caudal constante: p95 120 %; el del
  speckle, detectando intensidad o magnitudes antes del haz en el shader: SNR 1,11 y 6,18).
- **Contraejemplos**: lo que fast-check encuentra se arregla o se documenta como `it.fails`
  enlazado a una limitación de `docs/LIMITATIONS.md`.
- **Semillas fijas**: fisiología, dispersores y fast-check son deterministas.
- **Primero la prueba que falla**: una decisión de imagen planificada deja antes sus pruebas con
  `it.fails` y los umbrales del plan, en un PR sin cambio de imagen; el PR de la decisión las pasa a
  `it`. Las decisiones 60 y 64 (contorno de la cápsula) las tienen en `liverContour.test.ts` (aristas y
  extremos del contorno del hígado en las vistas de las capturas), `capsuleTwin.test.ts` (la cápsula
  oblicua en el gemelo B→C→D) y `fidelityScene.test.ts` (salto de incidencia entre líneas), las tres
  lentas.
- **Fronteras**: cerca de un umbral clínico (PF 30/50 %, S/D renal 0,3) una prueba acepta la
  clase vecina y lo dice; lejos de él exige igualdad.

## Mutantes reproducibles (decisión 322, punto 8)

`npm run mutants` repite los mutantes que antes vivían en un script de cada ronda. Cada módulo tiene un manifiesto en
`tools/mutants/manifests/`: nombre, reemplazo exacto `from` → `to` (una sola aparición), qué comportamiento rompe, la
ronda donde se midió y las pruebas focales que deben detectarlo. El ejecutor corre primero esas focales sobre el árbol
original (deben pasar), después aplica cada mutante solo, corre sus focales con un trabajador y restaura el módulo byte
a byte. Escribe `mutants.json` (resultado, tiempo, pruebas rojas y su primer mensaje por mutante) y un log por mutante.

- **Muerto** es una aserción roja. Si todas las pruebas rojas caen por excepciones de ejecución (`TypeError`,
  `ReferenceError`…), el mutante rompe la ejecución sin probar ningún comportamiento: cuenta como error, no como muerto.
- **Restauración**: un diario en `.cache/mutants/` guarda el original mientras el módulo está mutado; ante una señal
  (`SIGINT`, `SIGTERM`, `SIGHUP` al cerrar la terminal) se detiene el Vitest hijo y se restaura, y ante una caída lo
  restaura el manejador de salida o, si el proceso murió sin él, la ejecución siguiente. Un informe de Vitest ausente o
  truncado es un error del ejecutor, no una caída.
- **Una ejecución a la vez** por checkout (cerrojo `.cache/mutants/lock.json` con el pid); `--list` sólo lee y no toca
  el diario de otra corrida en curso.
- **Una edición durante un mutante no se pisa**: si el módulo deja de ser el mutante aplicado, la edición se guarda en
  `.cache/mutants/rescued/`, el diario conserva el original sin mutante y la corrida se detiene.
- **Salida**: 0 todos muertos; 1 alguno sobrevive; 2 error, interrupción o caída (línea base roja, manifiesto inválido,
  cerrojo ocupado, mutante con error, sin correr, árbol cambiado).

```bash
npm run mutants -- --list
npm run mutants -- --module src/anatomy/people/s0028/solids.ts
npm run mutants -- --only grasa-solo-sin-dueno,cajas-sin-OR --out .cache/mutants/prueba
```

Cubre 29 mutantes en ocho módulos (el clasificador s0028 extraído tiene su propio manifiesto): pared, contacto y gemelo GLSL de P2 (los que detectan pruebas CPU o
estáticas), sólidos, escena, Worker del corte y rótulos de P3, los siete de la revisión de #331 y dos de la de #334
(`hueso-duplicado`, con su prueba focal, y `fuera-de-cajas-false`). `banda-desde-0mm` es equivalente y queda fuera,
documentado en su manifiesto. El conjunto completo tardó 483 s aquí con carga media 11 (línea base 34 s; cada mutante
1–61 s; con 27 mutantes y carga 10–13, 507 s). La capa rápida comprueba que cada `from` sigue apareciendo una vez y que
cada focal existe: un PR que mueve el texto bajo un mutante actualiza su manifiesto en el mismo PR y demuestra que sigue
muerto; no se borra un mutante para obtener verde. Correr los mutantes no entra en el veredicto protegido (25 min de
techo): `.github/workflows/mutants.yml` corre a mano o cuando cambian esos módulos, sus focales, el ejecutor,
`vite.config.ts` o `package.json`, y su rojo no bloquea la fusión (en CI tardó 404 s el paso y 462 s el trabajo).

## Coste del cuadro

`window.__vexusTest.frameCostMs(n, opts?)` (`src/app/testHooks.ts`) mide el coste medio de `n` cuadros
en tiempo de pared, sincronizado con la GPU al principio y al final. El reloj no avanza entre cuadros:
con la caja de color encendida, la cadencia del color (decisión 39) saltaría casi todos los cuadros y la
media saldría ≈ 0 ms. Por eso, con la caja encendida exige `forceColor`, y lanza sin él, con la imagen
congelada o con `n` que no sea un entero ≥ 1.

- `forceColor: true`: cada cuadro es completo y lleva la pasada de color. Si la caja está apagada, la
  enciende con el comando del equipo y la deja como estaba al terminar, aunque algo falle.
- `startPoint: '<vista>'`: coloca antes la sonda en ese punto de partida, para comparar medidas en la
  misma pose (el barrido del banco la deja basculada o inclinada).
- `repeatPass: '<pasada>'` (con `repeatCount`, 1 por defecto): repite el dibujo de esa pasada de
  `FRAME_PASSES` dentro de cada cuadro sin cambiar la imagen. Su coste es (con − sin) / `repeatCount`:
  así se atribuye ΔB (`'rawField'`) o ΔA (`'transmission'` y las etapas A0–A2) en Metal, que no separa
  el tiempo de las pasadas (decisión 47). Una pasada de cadencia de color exige `forceColor`. Cada
  repetición dibuja en un destino de prueba propio (dos alternados, con el tamaño y los formatos de la
  salida de la pasada), así que es su propio pase de render: sobre el mismo destino, una GPU de teselas
  (Apple M) podría sombrear solo el último de los triángulos opacos que se tapan. Cada repetición paga,
  como la pasada real, la carga y la escritura de sus teselas.
- **Comprobación de linealidad** antes de fiarse de un Δ: medir con `repeatCount` 1 y 4 (varias veces,
  alternando) y exigir Δ(4) ≈ 4·Δ(1), con Δ(1) muy por encima de la dispersión entre corridas. Un Δ que
  no crece con las repeticiones es que el driver las descarta o que la pasada no es la que limita.
- Las opciones que no medirían nada lanzan (`frameMeasureOptions`). La aplicación nunca las pasa;
  `frameCost.test.ts` lo comprueba con un renderizador falso, y con el renderizador real sobre un WebGL
  falso que cada repetición va a otro FBO que el dibujo anterior, con las texturas de la pasada.

El banco (`npm run fidelity`) guarda por escena `msPerFrame` (color apagado) y `msPerFrameColor`
(color encendido, `forceColor`), las dos en la pose de partida de la vista.

## Composición espacial en los ganchos (decisión 58)

La imagen de la aplicación es, por defecto, el compuesto de tres miradas intercaladas (una por cuadro), y
un gancho que midiera «la envolvente» sin decir cuál cambiaría de significado en silencio. Por eso:

- `compound` es obligatorio en el tipo de `speckle`, `fidelity`, `speckleMotion`, `speckleCrossfade` y
  `transmissionParity`: con `false`, la imagen de una mirada de siempre (las guardas de una mirada lo
  pasan con sus umbrales de antes); con `true`, el gancho dibuja N cuadros, uno por mirada, para que las N
  ranuras del anillo sean del instante de la medida (con un salto de pose el anillo se reinicia; sin él,
  guardaría miradas de antes) y, si mide la imagen mostrada, asienta después la persistencia. El
  conmutador vuelve a como estaba al terminar, aunque algo falle, y medir «el compuesto» con el color
  encendido (donde no se forma) lanza.
- `readEnvelope()` lee la mirada 0 y lanza si no es la del último cuadro; el compuesto se pide con
  `{ source: 'compound' }` y cada mirada con `readLookEnvelope(ranura)`. `readTransmission({ look })` da la
  transmisión de una mirada dirigida solo tras el cuadro que la forma.
- Nuevos: `setCompound`, `compoundState`, `lookCorrelation` (la parte `compound` del banco),
  `temporalStability` (escena quieta: correlación entre cuadros y modulación de periodo 3) y
  `envelopeGuard` (la guarda de `readEnvelope`). `transmissionParity({ compound: true, look })` compara la
  mirada dirigida de la GPU con sus gemelos de TS sobre los segmentos de A0/A1 de la propia GPU
  (`app/steeredParity.ts`): una muestra cuyo resultado cambia al desplazar los redondeos de los gemelos
  ±10⁻⁴ líneas (`STEERED_TIE_LINES`, el doble del error de float32 emulado) es un empate y se cuenta
  aparte. `steeredParity.test.ts` comprueba el margen y que en las cuatro vistas los empates son ≤ 0,5 %
  (0,04–0,31 % en CPU; con el criterio anterior, θ·(1 ± 2·10⁻⁴), 0,35–1,35 %).
- `frameCostMs` mide con el conmutador como esté: con el compuesto, la media de las tres miradas (la 0
  con los programas de siempre de A2, A y B y las dirigidas con los suyos; `repeatPass` repite el programa
  del cuadro). Para comparar la mirada 0 con `main`, mide con el compuesto apagado.
- `compoundRenderer.test.ts` comprueba el cableado sin GPU: el renderizador real sobre un WebGL falso
  (`support/recordingGl.ts`, que registra programa, destino, texturas y uniforms de cada dibujo, los
  programas liberados y los uniforms subidos con el programa equivocado puesto). Además de la mirada de
  cada cuadro, exige que cada programa de A2, A y B (el de la mirada 0 y el dirigido) reciba todos los
  uniforms y samplers que declara, cada sampler con su textura, que la mirada elija el programa, que las
  repeticiones de medida repitan ese y que la reconstrucción tras perder el contexto libere los seis.
  También el arranque (el registro de llamadas de `recordingGl`): al crear y al reconstruir el
  renderizador, todos los programas se enlazan antes de la primera consulta de estado, que bloquea en un
  navegador, `KHR_parallel_shader_compile` se pide antes de compilar y un fallo de compilación o de enlace
  (`fail`) lanza con el nombre del programa y libera el lote entero.
  `shaderLimits.test.ts` exige que los programas de la mirada 0 no lleven ningún identificador de la
  dirigida (sacados del código) y fija la huella de su main, la de antes de la composición.

## Qué no está cubierto todavía

- Estadística de speckle frente a clips reales (`speckle-statistics-uncalibrated`); la e2e solo
  exige la banda de un moteado algo pre-Rayleigh en el parénquima (`app/speckle.ts`) y los gemelos, el m de
  Nakagami del hígado sano de la literatura (`parenchymaTexture.test.ts`, decisión 89) y el desplazamiento de las
  bandas de las guardas del moteado con esa textura (`parenchymaTextureTwin.test.ts`). El banco de fidelidad
  mide la textura de segundo orden y la imagen mostrada contra imágenes reales de referencia, pero a mano y
  sin umbrales en CI.
- Imagen de referencia (golden) del modo B y del color.
- Rendimiento por cuadro medido en CI (solo presupuesto de bundle).
- Cobertura exhaustiva de todos los flujos de UI y combinaciones de tamaños. Las E2E actuales sí incluyen
  navegación 3D, movimiento libre, cine y coherencia del corte; no equivalen a una aprobación integral móvil.
  El DOM falso de `src/validation/support/fakeDom.ts` también protege el contexto clínico de Medir y Docente.

### Procedencia de las fases de validación

En CI, core con cobertura y las matrices IQ corren en trabajos independientes.
El veredicto protegido exige ambos y todos los fragmentos E2E. Los artefactos
`validation-core` y `validation-matrix` contienen informes JSON y sellos
`*.source.json` con fase, commit y SHA256; el cierre comprueba sus bytes, el
commit del checkout y la lista completa de archivos, sin omisiones ni duplicados.
No basta un informe exitoso procedente de otra revisión.

En local, `npm run test:coverage` verifica la unión de las dos fases. Con diez o más plazas
estimadas por Node, fuera de CI, ejecuta un lote CPU acotado con `plazas - 5` workers core
y tres matrix; no cambia el aislamiento de archivos. En otros casos conserva la secuencia
original. `VEXUS_VALIDATION_MODE=serial npm run check` permite elegirla explícitamente.
`.validation/local-schedule.json` describe el plan y el equipo, sin acreditar aceptación.
El preflight HTTP rechaza la falta de loopback antes de iniciar los pools y borra informes
anteriores; un fallo o interrupción de cualquiera de las fases nunca aprueba el lote.
Para ejecutarlas por separado, usar `npm run test:coverage:core`,
`npm run test:matrix` y finalmente `npm run test:coverage:verify`, sin cambiar
HEAD entre fases. Invocar Vitest manualmente no produce el sello exigido.
La referencia `npm run test:coverage:full` sigue disponible. El SHA local no
certifica cambios sin commit; la aprobación de PR depende de su checkout en CI.

### Matriz de poses hepáticas y cobertura representativa

`liverContour.test.ts` mantiene las vistas representativas, guardas de contacto,
normales y métricas bajo instrumentación de cobertura. El barrido repetitivo de
56 poses vive en `liverContourPoseMatrix.test.ts`, en la fase exhaustiva sin
instrumentación, con los mismos casos, ángulos, malla de 0,25 mm y umbral de aristas.
El veredicto exige ambas fases y todos sus archivos con procedencia del mismo SHA.

El cálculo de la matriz ocurre en `beforeAll`, fuera del `it.fails` que representa
la limitación anatómica conocida. Un error numérico o excepción en la construcción
falla el setup; no puede pasar como el defecto esperado del umbral geométrico.
Una prueba ordinaria exige 56 poses únicas con conteos enteros válidos.
La referencia totalmente instrumentada sigue disponible y los umbrales globales
no se reducen ni se añaden exclusiones de fuentes.

Los contratos de pared se reparten en `wallTwin.test.ts` (física) y
`wallDisplayTwin.test.ts` (presentación) para evitar una única cola secuencial.
`support/wallFixture.ts` comparte las condiciones iniciales, no las aserciones;
las dos suites conservan sus cachés locales y todas sus muestras y umbrales.

## Revisar el coste E2E sin reducir la cobertura

Los tiempos históricos solo reparten la colección **actual completa** entre los
shards. No seleccionan qué pruebas se ejecutan, no amplían timeouts y no convierten
reintentos en éxitos. Revisarlos cuando cambien los flujos o el coste del render,
contrastando la duración real de los jobs con la estimada; no recalibrar para ocultar
un timeout o una regresión sin investigar.

1. Obtener los artefactos oficiales `e2e-tiempos-N` de **tres ejecuciones completas**
   de CI recientes. Verificar repositorio, run, SHA y digest de cada descarga. No
   usar runs parciales, fallidos o con reintentos, aunque el job figure verde.
2. Extraer cada run a un directorio separado, conservando en cada shard
   `.validation/e2e-execution.json` y `e2e-results.json`.
3. Crear un manifiesto JSON: una matriz de tres objetos con `runId`, `sourceSha`
   y `directory`. Ejecutar desde la raíz del repositorio:
   `node --import tsx tools/ci/recalibrate-e2e.ts manifest.json tools/ci/e2eTimingWeights.json`.
   Solo se recoge la lista de Playwright; no se abre ningún navegador.
4. La herramienta exige todos los IDs actuales, shards completos, particiones
   disjuntas coherentes, un único resultado aprobado por prueba y cero reintentos.
   Calcula la mediana exacta de tres duraciones positivas por ID y conserva hashes
   SHA-256 de los informes y metadatos usados. **La identidad auténtica de los
   artefactos se verifica al descargarlos**; esos hashes y el análisis estructural
   no sustituyen una firma del proveedor.
5. El destino se reemplaza atómicamente solo después de validar todas las fuentes.
   Si cambió la colección, obtener tres runs que ya incluyan las nuevas pruebas;
   no completar huecos con valores inventados. Los tests nuevos siguen entrando en
   CI mediante el fallback existente, aunque los pesos aún no se hayan actualizado.
6. Revisar el diff, comprobar la nueva partición y seguir la CI completa y el
   posmerge. Comparar predicción y ejecución real: una estimación más equilibrada
   no demuestra por sí sola menor tiempo de pared ni menos consumo total.

### Etapas de arranque en grupos cancelados

El runner escribe `.validation/e2e-startup.jsonl` de forma incremental en el
host. Cada arranque conserva SHA, id de prueba, consulta, reintento, etapas del
navegador y tiempo transcurrido del host. Una cancelación puede dejar solo un
prefijo: sirve para localizar la última operación observada, nunca para aceptar
el arranque ni la ejecución E2E. El artefacto `e2e-tiempos-N` conserva ese prefijo
junto a la identidad del grupo, incluso si no pudo generarse el informe final.
Los requisitos del veredicto y el rechazo de reintentos siguen intactos.

Para un diagnóstico local fuera del runner, declarar `E2E_SOURCE_SHA` con el
SHA del checkout y `E2E_STARTUP_EVIDENCE` con el destino deseado. Sin destino no
se escribe evidencia incremental; los adjuntos de Playwright se mantienen.
Estos registros no contienen imágenes, muestras ni datos clínicos. No prueban
el coste de compilación ni la causa de una etapa larga por sí solos.

## Perfiles locales y medición nativa

`docs/engineering/workspace.md` distingue reproducción focalizada, aceptación de CI y medición
nativa. `npm run workspace:e2e -- --help` ofrece un perfil portable de un trabajador, sin reintentos,
con los plazos CI existentes. No cambia la configuración ni la colección de la CI protegida.
Los resultados locales nunca sustituyen el veredicto remoto del head publicado.

## Diagnóstico de adquisición que no avanza

`bootWithoutErrors` observa las llamadas originales a vallas WebGL2, sin agregar esperas o comandos GPU. Si una prueba con `checkAfterEach` falla, adjunta `failed-acquisition`: reloj, cuadros, modos, errores internos, contadores por contexto y reservas Web Locks. La captura fallida se conserva aunque no llegue al assert final de errores de la app. No demuestra por sí sola la causa de un bloqueo.

El observador identifica también el host del lienzo sin id (`nav3d`). El barrido
renal exige vallas productivas tanto de ecografía como de 3D tras cada arranque;
no crea vallas para hacer pasar esa comprobación. Conserva muestras, paridad,
capturas y plazo de dos vistas. Los tests del regulador retienen un contexto
lento aunque el otro complete o se pierda (238).

El job `triplex-early` ejecuta el caso móvil existente de `colorLegend.spec.ts` con un trabajador, cero reintentos y sus plazos/aserciones originales. Es una repetición intencional adicional y conserva un artefacto propio, separado de los doce informes `e2e-tiempos-N`. El caso permanece en la colección completa; el veredicto exige también este gate temprano. No cambian sus inventarios, física ni resolución. Los informes de un job cancelado se suben como evidencia incompleta y no autorizan fusión.
