# Adulto de referencia: registro funcional en revisión

Estado vigente y alcance completo: [TORSO_PROGRESS.md](TORSO_PROGRESS.md); referencia opt-in `?reference=1`.

Base: #130, 2128d82c924b5491788e1e429b4854d6a21ae135. **WIP no listo para integrar**. Estado del WIP original, superado por el saneamiento cloud: la rama cargaba el campo por defecto; `?torso=legacy` permite comparación; no usar este prototipo como anatomía clínicamente validada.

## Fuente y registro único

BodyParts3D release4 (2013), [README oficial](https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/README_e.html), [licencia vigente CC BY4.0](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html). Crédito: **BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International**. Derivados modificados: segmentación, muestreo radial, interpolación, ajuste de curvas y reflexión bilateral. Un adulto masculino de referencia, no norma poblacional ni textura ecográfica.

El diagrama oficial de coordenadas, release1, y las cotas/lateralidad de release4 corroboran mm, izquierda/posterior/superior. El destino es mm, izquierda/anterior/superior. La matriz diag(1,−1,1) tiene determinante −1: también se invierte el ángulo polar de la piel. `reference-body.py` hace explícita esa reflexión; la regresión contrasta cada radio observado contra su índice destino.

Origen fuente: centroide de los20 vértices del milímetro distal del xifoides FJ3153, [−0.3152345,−205.92635,1164.5735]. Destino [0,85.25,0], conservando la punta renderizada del xifoides y Z0 de scene.ts. No hay escalado clínico ni normalización por órgano. La unión xifoesternal fuente transformada queda [−0.35311125,84.1019,18.2615], frente a la unión antigua a Z30: residual craneocaudal11.7385mm. La cara anterior de T9 queda [0.1817725,−43.02345,−3.0935]; se desplaza la primitiva vertebral14.02345mm hacia posterior. Radios/ancho de esa primitiva siguen estimados: no es la malla vertebral fuente completa. Hiato VCI[−18.1,−3.2,53] y terminalAD[−16.9,−0.6,64] permanecen sin mover.

## Perfil cutáneo y cobertura

FJ2810 tiene capa externa/interna y brazos conectados. Se intersectó la superficie con ocho planos Z−160..120 cada40mm y se retuvieron cadenas de piel original que cruzan la línea media, más próximas a vértices de costillas/esternón/T9–T10 que a los dos húmeros. El criterio es un prototipo: sesgo por densidad de vértices y ausencia de vértebras craneales no validados. No confundir el agregado ontológico «segmento torácico» con un mesh de piel.

Direcciones observadas por corte:64,64,64,62,54,52,46,44 de64. El JSON conserva null en cada dirección sin evidencia; el binario ejecutable interpola periódicamente entre las direcciones observadas. No convierte null a cero ni etiqueta las interpolaciones como observaciones. Fuera de Z−160..120 el perfil se prolonga por clamping, no por nueva evidencia. La elipse ajustada a cadenas retenidas deja RMS radial3.5–11.2mm: una elipse simple no representa fielmente esos cortes.

`docs/anatomy/reference-source-manifest.json` conserva IDs/hashes de OBJ inspeccionados. `reference-skin-source.json` conserva los radios fuente, registro y máscaras. Generador determinista: `python3 tools/anatomy/reference-body.py`. Los OBJ no se descargan ni incluyen en producción. La extracción/segmentación completa desde OBJ sigue pendiente de empaquetar; el generador reproduce el binario desde el intermedio inspeccionable.

## Costillas y coherencia

Seis pares5–10, no doce pares ni24 costillas funcionales. Curvas fuente ajustadas por bins angulares con a/b individuales, centroY común y Z armónico; se promedian ambos lados. RMS axial del ajuste por hueso1.2–2.9mm no es error de superficie del clasificador. Se conserva sección estimada; se recorta el extremo anterior a hueso observado, sin inventar cartílago. Cartílagos fuente, articulaciones, asimetría, extremos cerrados y resto de vértebras pendientes. TS/GLSL/malla usan el mismo campo; no una malla decorativa independiente.

## Evidencia actual y bloqueo de promoción

Chrome del Mac, Metal: imagen antes/después con PacienteA, mismos ajustes y pose subxifoidea. La corrección de orientación elimina la sombra central falsa de una versión anterior; **la pose vigente no consigue la VCI en eje largo**. El flanco queda obstruido por costillas y el barrido de equivalencia no contiene sangre interior (0celdas); su vesselAgreement=1 es vacuo, no validación vascular. La renal también tiene obstrucción notable. Epigástrica muestra vasos y vértebra. Estos defectos impiden promover el modelo a default: deben revisarse poses y relaciones anatómicas fuente/órganos antes de alterar órganos para forzar imágenes.

Siete planos con acuerdo de tejido CPU/GPU1.0; sangre interior5/41/20/3/0/33/36 respectivamente. Esto demuestra concordancia del software, no adquisición adecuada ni anatomía clínica. Pruebas focales: piel/depth/gradientes/contacto normal, reflection LPS→LAS, mallas y normales espejo, landmarks vasculares protegidos. No equivalen a validación independiente.

Coste del build de inspección: JS1,037,933bytes, límite autorizado1,040,384, margen2,451. Entrada/cuerpo de app conservan límite335KiB; el patrón identifica bootstrap porque se extrajo el módulo sin cambios de lógica, no eleva su límite. Binario2,080bytes, gzip9 1,890bytes, SHA256 b275a56ca3e08c9038eb5a797aeda9b5e6936f085b3e4bf45b8cefe35911b718. Perfil ocupa cola ya disponible de textura de escena: asignaciónRGBA32F256×6 =24,576bytes, sin nuevo sampler ni lectura GPU por cuadro. Worker recibe2080bytes una vez al iniciar. Microbenchmark12 renders+finishForTiming:23.13ms con carga no controlada; falta comparación pareada de coste y no se declara rendimiento conservado.

No afirmar hiperrealismo, caja completa, fidelidad renal o mejora perceptual por pasar equivalencia. Checks completos/calibración/CI y promoción predeterminada permanecen pendientes.

Cribado de contención: rejilla determinista8mm del tejido visible del modelo previo contra la nueva piel sin compresión. Hígado3331puntos, sangre765, corteza420, médula25, seno46; ninguno fuera. Máxima proximidad muestreada hígado12.31mm, sangre23.41mm. Esto no acota superficies entre muestras ni verifica contacto diafragma/hígado/riñón; no justifica mover órganos. Resultado completo en `reference-containment-report.json`.

Estado posterior: presets recalibrados recuperan VCI longitudinal, VCI del flanco y anatomía renal sin mover órganos. Portal ajustada al promedio/eje de sus cuatro landmarks con mayor margen angular. La antigua regresión visual está preservada; no describe las poses actuales. El gate completo ahora detecta pericondrio ausente: cartílagos fuente pendientes. Ver `CLOUD_HANDOFF.md` para estado vigente y reproducción.
