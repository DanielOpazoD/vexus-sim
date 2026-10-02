# Cortical vertebral: método y límites

## Objetivo

En la ventana abdominal, la cara anterior del cuerpo vertebral debe devolver una línea curva ecogénica, dependiente del ángulo del haz, delante de una sombra. La línea se calcula desde la superficie material; no se añade a coordenadas de pantalla.

## Fuente primaria

[Garra et al., Ultrasound in Medicine & Biology 2009;35:165–168, doi:10.1016/j.ultrasmedbio.2008.06.004](https://pmc.ncbi.nlm.nih.gov/articles/PMC8243223/) estudia adquisición transabdominal en nueve mujeres a 2,5 MHz. Identifica el cuerpo vertebral por su reflexión anterior brillante. También logra aislar señales RF de hueso esponjoso: por eso no debe interpretarse nuestro interior sin moteado como ausencia física de dispersión en todo hueso real.

La publicación orienta el fenómeno, no calibra la geometría, amplitud, rugosidad ni precisión de este simulador.

## Contrato

- La unión de cilindro y arco existente conserva posición y tamaño. No se desplaza la aorta ni la VCI
- La interfaz pertenece a las muestras exteriores de tejido blando, a menos de 5 mm de la superficie y cuando es su cara más cercana. Hueso/gas/aire no la emiten
- Distancia y normal analítica TS/GLSL corresponden al cuerpo cilíndrico, solo donde es la superficie ósea más cercana. Eje craneocaudal y curvatura 1/r. El arco rectangular es un oclusor provisional y no emite esta interfaz: hacerlo producía dos barras brillantes artificiales en la revisión visual
- Fresnel de la tabla existente, suelo cero; rugosidad RMS 0,045 mm y pendiente RMS 0,15, extrapoladas de cortical costal
- Perfil de eco filtrado por la resolución y orientado por la normal deformada, con caída de la difusa tras el ángulo crítico del modelo longitudinal
- No se ilumina desde dentro la cortical opuesta. La sombra sigue la transmisión existente, sin nueva máscara o aumento de pérdida

## Límites

No hay cuerpos vertebrales individualizados, discos, canal ni anatomía neuraxial. El arco rectangular no es un arco posterior anatómico. La ley óptica/acústica es una aproximación de interfaz; no resuelve ondas de corte, corteza y esponjosa, ni permite estudiar densidad ósea. La selección de una sola cara por muestra mantiene la limitación previa en contactos subresolución. La cortical se interrumpe donde el arco pasa a ser el hueso más cercano; ese arco solo aporta oclusión hasta disponer de anatomía posterior real. No hay validación clínica independiente.

## Evidencia reproducible

- `vertebralCortex.test.ts`: geometría, propiedad, incidencia y transmisión en ambos registros
- `vertebralCortex.spec.ts`: puntos dirigidos al cuerpo y arco, paridad de tejido/interfaz/distancia/normal
- `spineComparison.ts`: misma pose y controles en la base exacta y el cambio, transversal, longitudinal y presión; originales sin retoques
- `glslBindings.test.ts`: renombrado invertible de fuentes/definiciones, familias dinámicas preservadas y colisiones rechazadas

El perfil corporal externo conserva todos sus bytes. Su límite separado es 2080 bytes; el presupuesto JS permanece 1024 KiB. El PR informa JS y binario por separado para no confundir menor base64 con eliminación de datos.
