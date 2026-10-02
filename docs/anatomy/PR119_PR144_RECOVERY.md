# Combinación local de PR119 con PR144

Estado actual: **check local aprobado; autorizado únicamente como borrador, pendiente de CI y revisión**.
La sección «Validación final local» contiene los resultados actuales. El registro inicial y sus fallos se
conservan debajo como historial; sus afirmaciones de estado pertenecen a esa etapa. La decisión 108 documenta
la corrección posterior del contorno. No se permite fusionar todavía.

## Registro inicial (histórico)

Estado inicial: **WIP local, no apto para integrar**. Rama `chore/reconcile-pr119-pr144-20261002`, worktree
`/workspace/vexus-pr119-pr144`. Primer padre: PR144 exacto `d6a21f88446b09c86aeb354cf07b6edeb6edc7cc`
(árbol `e2a3a2b7daa87a759ffc9e2fd025eda07843676c`); segundo padre: candidato PR119
`6d6fb6d87d5e460dcf63c38a4dad863e6ab7d638`, que conserva la ascendencia original `bd35838`.

El candidato anterior permanece intacto en `/workspace/vexus-legacy119`. No se modificaron ramas fuente ni main,
no se realizó push, no se abrió un PR ni se desplegó. Las decisiones 106/107 y su índice son idénticos a PR144;
este documento no ocupa un número nuevo. El [registro previo](PR119_RECOVERY.md) conserva su evidencia histórica.

## Conciliación y contratos preservados

Solo hubo conflictos textuales en `primitives.ts` y `gpu/anatomy.glsl.ts`.

- `sdSpine(p, spine, blendMm = 0)` y `spineSd(m, blend)` conservan exactamente la elección de PR144:
  `blend > 0 ? smoothMin(body, arch, blend) : min(body, arch)`. El cuerpo ahora es `spineBodySd`, con la elipse,
  niveles y platillos de PR119; el arco usa `spineArchSd`, equivalente a la caja anterior. No se suaviza la
  clasificación ósea: `classify` sigue tomando `min(body, arch)` y clasifica los discos de PR119 por separado.
- `liver.ts` es idéntico byte por byte a PR144. Conserva el término
  `smoothMax(d, 3 - sdSpine(m, spine, 6), 6)` después del corte medial y antes de la impresión renal,
  en TS y en ambas sobrecargas GLSL. Cambia su entrada geométrica, no la fórmula, sus constantes ni su orden.
- `scene.ts`, tejidos y retroperitoneo son idénticos al candidato PR119 anterior: dueños corticales protegidos
  de PR139 más cartílago exclusivamente dentro del disco, sin sustituir otra interfaz ni reactivar cápsulas suprimidas.
- Cápsula exterior, reflectividad, textura de PR142/144, packing GLSL, presupuestos y pruebas de PR144 permanecen
  idénticos a su SHA base. No se recolocaron los fixtures que fallan ni se redujo ninguna aserción.
- El GLSL conserva las funciones vertebrales antes de los módulos de órgano, para que `liverSdf` invoque la
  envolvente segmentada. Se conserva el clasificador interior de PR119 con los caminos intestinales posteriores.

Un diferencial independiente del coordinador comparó `sdSpine` con argumento omitido y con `0` contra el candidato
PR119 preservado: **203.522 evaluaciones sobre 101.761 puntos, cero diferencias y error absoluto máximo 0**.
Incluye niveles, discos y platillos; prueba el contrato geométrico CPU, no sustituye paridad GPU.

## Resultados dirigidos

| Verificación                                       | Resultado y código de salida                                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                | Pasa, exit 0.                                                                                   |
| `npm run format:check` / `npm run lint`            | Ambos pasan, exit 0.                                                                            |
| Focused de 16 archivos, un trabajador              | 142/144 pasan; 2 fallan, exit 1; 78,82 s.                                                       |
| `shaderLimits.test.ts`, un trabajador              | 18/18 pasan, exit 0; límites y aserciones intactos.                                             |
| `glslPacking.test.ts`, incluido en focused         | 3/3 pasan; igualdad byte por byte de programas ensamblados frente al build sin packing.         |
| `npm run build`                                    | Pasa, exit 0; Vite 2,55 s y todos los presupuestos por chunk/total pasan.                       |
| JS total, incluidos Worker, worklet y testHooks    | 1.044.827 bytes frente a 1.048.576; margen **3.749 bytes**.                                     |
| Guarda subxifoidea original                        | **40** líneas corticales a menos de 30°, exige ≥20; 13 líneas discales y 4 grupos, exige ≥8/≥3. |
| Check completo, cobertura, E2E, GPU y comparadores | No ejecutados en este alcance dirigido; no se declara validación completa ni CI.                |

Los 16 archivos son `spine`, `vertebralCortex`, `retroperitoneum`, `startPoints`, `organs`, `faceGradient`,
`glslBindings`, `interfaceEcho`, `wall`, `hepaticBoundary`, `liverCapsuleMedium`, `glslPacking`,
`normalPortalContrast`, `normalHepatorenal`, `parenchymaTextureTwin` y `retroTexture`, todos `.test.ts` bajo
`src/validation`. Comando: `VITEST_TIER=all npx vitest run --maxWorkers=1 --testTimeout=180000` seguido de esos
archivos. `shaderLimits` se ejecutó después, con las mismas opciones: total dirigido **160/162**, sin reintentos.

La hipótesis de que PR144 resolvería los dos bloqueos anteriores se confirma en este candidato: la separación
hepática permite 40 líneas sin ampliar los dueños de cortical, y el packing conservado permite cumplir presupuesto.
Eso no vuelve verde la combinación: permanecen los dos conflictos semánticos siguientes.

## Fallos preservados y diagnóstico

### Hígado en la banda ósea de 1,5 a 3 mm

`spine.test.ts` exige más de 20 muestras `Tissue.Liver` en esa banda para comprobar que su `boundaryDistance`
cuenta el hueso. Obtiene **0**. En la rejilla exacta hay 811 muestras: 171 `RetroperitonealFat/VertebralCortex`,
331 `Cartilage/VertebralCortex`, 27 `Cartilage/None`, 113 `Muscle/Transversalis`, 37 `Muscle/TransversusPlane`,
2 `Diaphragm/DiaphragmLiver`, 20 `Mediastinum/VertebralCortex` y 110 `Lung/None`.
Ninguna de las 811 viola `boundaryDistance <= sdSpine + 1e-9`; el fallo está en exigir hígado allí.

La contradicción se deduce de la fórmula: `smoothMin(body, arch, 6) <= min(body, arch) = dBone` y
`smoothMax(d, 3 - sdSpine(..., 6), 6) >= 3 - dBone`. Por tanto, para `dBone <= 3`, la distancia hepática
no puede ser negativa. Los recortes posteriores usan `smoothMax` y no reducen esa cota. La expectativa antigua
de parénquima dentro de esa banda y la exclusión de PR144 no pueden cumplirse simultáneamente.
Se conserva el test rojo; no se adapta unilateralmente el contrato.

### Fixture fijo intercostal de PR144

`hepaticBoundary.test.ts` espera hígado en `before = [-17.508805707,-34.116796875,15.268222628]`.
Con la elipse de PR119 ese mismo punto pertenece a `LiverCapsule/LiverCapsule`:

| Observable                                  |                  `before` |      `towardBone = [-15,-34,15.3]` |
| ------------------------------------------- | ------------------------: | ---------------------------------: |
| Distancia al cuerpo segmentado y al hueso   |        3,3644641179364903 |                 1,9403702877566267 |
| Envolvente segmentada, blend 6              |        3,3644641179364903 |                 1,9403702877566267 |
| Envolvente circular anterior, misma fórmula |         4,160548050451943 |                 2,2093727122985456 |
| `liverSdf` actual                           |      −0,36446411793649025 |                +1,0596297122433733 |
| Tejido/interfaz                             | LiverCapsule/LiverCapsule | RetroperitonealFat/VertebralCortex |
| `interfaceDistance`                         |       0,36446411793649025 |                 1,9403702877566267 |
| `boundaryDistance`                          |       0,36446411793649025 |                 1,0596297122433733 |

El fixture `towardBone` sigue cumpliendo ambas expectativas originales aunque el fallo anterior impide que el
test llegue a ellas. No se ha sustituido `before` por otro punto. Las dos rejillas de exclusión hepática de PR144
(cuerpo procedural y de referencia) pasan, igual que sus pruebas del medio exterior capsular.
La regresión de cápsula suprimida `[-14.1,-30.3,46.9]` sigue siendo `LiverCapsule/None`.

## Pendientes

El coordinador debe revisar explícitamente las expectativas incompatibles y la evidencia anatómica requerida:
preservar la propiedad de distancia a la frontera sin exigir hígado en una zona ahora excluida, y determinar
la intención del punto intercostal que la geometría elíptica desplaza a cápsula. No basta mover puntos para obtener verde.
Hasta esa revisión se conserva este merge WIP rojo. Después se requieren check completo, calibración,
paridad TS/GLSL, E2E CPU/GPU y comparadores sobre el SHA final, con ambos perfiles corporales.

Las dimensiones vertebrales y la holgura hepática siguen siendo parámetros aproximados o estimados; los conteos
son evidencia de software y no validación clínica. No se incorporaron referencias clínicas privadas.

## Revisión autorizada de los contratos (2026-10-02)

El operador autorizó conservar la separación de PR144 y sustituir las dos expectativas incompatibles por
regresiones geométricas. Los fallos anteriores se conservan arriba como registro histórico; ya no describen
el estado de las pruebas dirigidas. No cambió código de producción durante esta revisión.

- La rejilla subxifoidea original (61 rayos, 80–175 mm cada 0,25 mm y banda ósea 1,5–3 mm) conserva su cota
  `boundaryDistance <= dBone`. Exige exclusión de parénquima/cápsula y más de 20 muestras de grasa. Para el cuerpo
  de referencia se trasladan las mismas muestras con el eje vertebral: el rango original desde su piel no alcanza
  la columna, por lo que no se presenta ese muestreo homólogo como adquisición clínica del torso de referencia.
- Se conservan ambos testigos intercostales históricos, con solo la traslación AP de la columna para referencia.
  La normal local y una bisección de la superficie ósea generan un recorrido cada 0,1 mm, independiente de la
  clasificación y de la fórmula hepática. Exige hueso → grasa → cápsula → parénquima, más de 20/5/10 muestras
  blandas respectivamente, plano de grasa de 2,7–3,3 mm y espesor capsular dentro de 0,2 mm del parámetro de 0,8 mm.
  La cápsula conserva su interfaz propia y su distancia al hígado; la grasa conserva la cortical del cuerpo.
- Un testigo junto al arco exige que la cota ósea sea activa aunque hígado y disco estén más lejos. Esto evita
  una prueba vacua: junto al costado elíptico la distancia del disco puede ser igual a la del cuerpo.
- Dos testigos de diafragma a menos de 1,3 mm del hueso protegen tanto `None` como `DiaphragmLiver` frente al
  predicado cortical amplio original. Permanecen los guards originales de corteza ≥20, discos ≥8/grupos ≥3,
  dueños permitidos, arco sin cortical y cápsula suprimida.

Pruebas dirigidas: **16/16 pasan** (`spine` y `hepaticBoundary`, un trabajador, 4,51 s). Tres mutaciones temporales
se ejecutaron separadamente contra esas mismas pruebas y luego se restauraron los archivos byte por byte:

| Mutación                                   | Fallos | Propiedad que detecta la regresión                            |
| ------------------------------------------ | ------ | ------------------------------------------------------------- |
| Eliminar separación hepática CPU           | 8      | Exclusión, recorrido capsular y guarda cortical original      |
| Eliminar `dSpine` de la cota de frontera   | 3      | Guard previo y ambas rejillas (rayo 0, profundidad 140,75 mm) |
| Restaurar predicado cortical amplio 1,3 mm | 5      | Interfaz del diafragma y cortical del testigo `towardBone`    |

Cada mutación terminó con exit 1; no se modificó ninguna constante, umbral ni guarda para hacerlas fallar.
La restauración se comprobó con SHA-256 y `git diff`: solo cambiaron los dos archivos de pruebas.
Logs y script reproducible: evidencia externa `pr119-pr144-evidence/mutation-*.log`, `mutations.json` y
`pr119-mutations.py`. La validación completa y visual sigue pendiente en este punto del registro.

La revisión independiente confirmó los contratos y precisó la atribución de las mutaciones: el testigo del arco
verifica la cota total, pero sigue pasando al quitarla solo de `withSpineFace`, porque el clasificador retroperitoneal
también la aplica. La sensibilidad a esa eliminación la prueban ambas rejillas: en el rayo 0 a 140,75 mm, la
frontera mutada mide 2,10456286245 mm frente a una cota ósea de 2,09895745306 mm. El predicado cortical antiguo
falla además en el testigo `towardBone` antes de llegar al recorrido; no se atribuye ese fallo a la exclusividad
capsular. Los testigos del diafragma sí fallan específicamente por una cortical invasora en ambos perfiles.

## Defecto de contorno descubierto y corrección de la causa

La primera suite completa sobre el candidato sincronizado con `main` terminó en 2.557,96 s: **115 archivos
aprobados y uno fallido; 1.079 pruebas aprobadas, 12 fallos esperados y un fallo real**. El fallo de
`liverContour.test.ts:75` informó `spine|spine`. Build y presupuesto no se ejecutaron en esa cadena roja;
las colas de E2E/comparadores se detuvieron sin arrancar. No se declara cobertura aprobada para esa corrida.

La discontinuidad era real: en `[-13.035898384862241,-34,26.5]`, lejos de pared/cúpula (17,15 mm), el salto de
normal al atravesar el centro discal se mantiene en 135,88° al refinar a 0,001 mm. La distancia a cuerpos
segmentados tiene una cúspide entre platillos; suavizar cuerpo y arco no elimina esa discontinuidad interna.
La [decisión108](../DECISIONS.md#108-envolvente-hepática-continua-frente-a-la-columna-segmentada) introduce un
helper hepático explícito y continuo que incluye el espacio discal. Se conserva `sdSpine`/`spineSd`, hueso,
cartílago, dueños corticales y acústica. Cambian el recorte hepático común en TS, sus dos sobrecargas GLSL y
su atribución en `liverTerms`; no se cambia el test de contorno ni se permite otra etiqueta en su aserción.

La envolvente cumple `E <= dBone`, por lo que el recorte conserva la separación de 3 mm respecto al hueso real.
El helper se comprueba sobre cuerpos, platillos, centros discales y arco en ambos perfiles. La nueva regresión
busca la superficie con un intervalo validado y verifica la convergencia de normales, además de excluir el
antiguo pliegue. Con el arreglo, el salto refinado es aproximadamente cero. Reintroducir el campo segmentado
hace fallar específicamente la guarda angular en ambos cuerpos: **137,236° frente al límite de 1°**.

Resultados dirigidos tras el arreglo: **25 pruebas aprobadas +4 fallos esperados** en `spine`,
`hepaticBoundary` y `liverContour` (86,55 s). Las cuatro mutaciones —sin separación, sin cota ósea,
predicado cortical amplio y envolvente segmentada— fallan y se restauran byte por byte. La guarda original
conserva **40 líneas corticales, 13 discales y 4 grupos** (mínimos 20/8/3). El diferencial de hueso volvió a
comparar 203.522 evaluaciones con PR119 preservado: **cero diferencias, error máximo 0**.

### Cambio geométrico medido frente a PR144

Rejilla de puntos medios de 2 mm, 3.042.000 muestras por perfil, caja `[-180,180] × [-130,130] × [-150,110]` mm.
Ninguna muestra del campo hepático alcanza el borde de la caja. Se mide el campo de superficie hepática
(cápsula y cavidades vasculares incluidas), no un volumen clínico ni una segmentación exacta de parénquima.
Una primera caja insuficiente se descartó mediante esa comprobación y se conserva como diagnóstico incompleto.

| Perfil     | Campo base (ml) | Campo nuevo (ml) | Ganado (ml) | Perdido (ml) | Neto (ml) |
| ---------- | --------------- | ---------------- | ----------- | ------------ | --------- |
| Procedural | 1815,480        | 1812,352         | 0,320       | 3,448        | −3,128    |
| Referencia | 1921,584        | 1918,904         | 0,288       | 2,968        | −2,680    |

Los cambios muestreados se localizan en el plano retrohepático; los puntos perdidos clasifican como grasa
retroperitoneal y los ganados como cápsula. El número de vasos y de ramas procedurales permanece 92/60 y
97/65 respectivamente; la longitud total permanece 3689,689 y 3773,220 mm. Esto no sustituye las guardas
vasculares, de Morison ni la paridad GPU.

### Plan final autorizado

La revisión independiente confirmó la corrección y los comparadores antes de repetir el check completo.
Se mantienen todos los umbrales y los plazos; la repetición usa dos trabajadores, sin navegador concurrente.
Los comparadores nativos de CI ahora cubren ambos perfiles, comprueban el perfil efectivo y añaden la ventana
subxifoidea original al comparador portal: **48 capturas previstas** entre los cinco workflows existentes.
La paridad hepática E2E añade los centros de tres discos a las cinco alturas anteriores, sin reducir ninguna
aserción. Continúan siendo 57 pruebas E2E en ambos perfiles.

El operador autorizó publicar únicamente un **borrador** tras suite/check locales, auditoría, índice y hook
normal verdes. E2E y comparadores pueden ejecutarse en CI después de publicarlo; hasta entonces son pendientes,
no resultados aprobados. No se permite fusionar antes de la revisión del padre y de los resultados completos.

## Validación final local

El check completo se ejecutó sobre `ecbf2c485cf52ab19e9fe6ea58e3041028d8c54b`, árbol
`3fa1a0fd3a6ea5544e64b4244178a1ab8a689d5b`, sincronizado con main
`6e1bd92fad75be2435f6d66188dc2192f0e1291b`. El árbol de ese main es idéntico al de PR144
`d6a21f88446b09c86aeb354cf07b6edeb6edc7cc`; la sincronización previa conservó el árbol candidato.
Esta actualización del registro no modifica código, pruebas, configuración ni comparadores.

| Gate                              | Resultado                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `npm run check`, dos trabajadores | Exit 0; formato, lint, tipos, cobertura, build y presupuesto aprobados       |
| Suite completa                    | 116/116 archivos; 1084 pruebas aprobadas +12 fallos esperados; 1442,90 s     |
| Cobertura                         | Statements 91,32%; branches 90,35%; functions 91,20%; lines 92,28%           |
| JS total                          | 1.045.002 / 1.048.576 bytes; margen 3.574 bytes; límites intactos            |
| Auditoría de producción           | Exit 0; cero vulnerabilidades                                                |
| Índice de decisiones              | Exit 0; secuencia continua 1–108                                             |
| Hueso frente a PR119              | 203.522 evaluaciones, cero diferencias, error máximo 0                       |
| Guarda subxifoidea                | 40 líneas corticales, 13 discales, 4 grupos; umbrales 20/8/3 intactos        |
| Mutaciones                        | Las cuatro fallan por las propiedades protegidas; restauración byte por byte |

La comparación adicional de los arrays vasculares completos confirma igualdad byte por byte frente a PR144
en ambos cuerpos, incluidos nodos, radios e índices (92 y 97 vasos respectivamente). Los hashes y scripts
reproducibles están en `vessel-geometry.json` y en el paquete externo de evidencia.

El hook normal de push debe pasar antes de crear el borrador. E2E CPU/GPU (57 pruebas) y los cinco comparadores
(48 PNG previstos, ambos perfiles y ventana subxifoidea) se ejecutarán en CI sobre el head publicado; **todavía
no son resultados aprobados**. El listado local de E2E únicamente confirma descubrimiento de pruebas. Los
harnesses externos preparados anteriormente no se ejecutaron y fueron sustituidos por los scripts nativos
versionados. Los IDs y estados de CI, el SHA final y la equivalencia de fuentes se registran en la evidencia
transportable y en el PR. No se fusionará sin resultados completos y revisión del padre.
