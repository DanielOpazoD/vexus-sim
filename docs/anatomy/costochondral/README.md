# Resultados del banco costocondral

Datos numéricos derivados de **BodyParts3D, © The Database Center for Life Science (DBCLS), CC BY 4.0**, conservando la atribución y los SHA256 del [inventario fuente](../reference-source-manifest.json). No hay modelos OBJ ni capturas en esta carpeta.

- [Snapshot de la candidata descartada](bounded-ellipse-candidate.json): cuatro perfiles completos. El script de ajuste reprodujo exactamente los 384 parámetros con el orden de entradas original.
- [Banco 64](bank64.json) y [banco 128](bank128.json): distancias geométricas bidireccionales por pieza **y conjunto bilateral**, componentes originales, bandas de contacto, conectividad y piel. Incluyen parámetros de muestreo, versiones y hash del snapshot de entrada.
- [Geometría de las bandas completas de contacto](contact-geometry.json): todos los vértices y centroides próximos a la otra fuente; distancias exactas a las triangulaciones candidatas en ambas resoluciones.
- [Reproducción y costos](reproducibility.json): igualdad exacta de parámetros, solver, convergencia numérica y bytes de payload.
- [Campo CPU publicado](published-baseline.json): mismos vértices/centroides originales y bandas completas del banco 64. El valor 1000 de exclusión ósea se cuenta aparte y se excluye de la estadística del campo; no es distancia de 1000 mm. La comparación corporal usa `bodyDepth` y `skinMm` del runtime publicado.

[Método, comandos, interpretación, incertidumbre y decisión técnica](../COSTOCHONDRAL_BENCHMARK.md). Las muestras no están ponderadas por área; los componentes singulares se conservan y el máximo por etiqueta se distingue del conjunto bilateral. Las resoluciones no son tolerancias anatómicas y no se demuestra continuidad subvoxel. Estos resultados no aceptan una candidata runtime ni validan clínica o Metal.
