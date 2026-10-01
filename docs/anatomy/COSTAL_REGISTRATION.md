# Registro costal: evidencia y límites

Base del bloque: PR129, `70001ee567b85be4a0abcc8c078e504087c6ce45`. Este bloque establece el registro offline y comprueba adquisición izquierda; no sustituye las seis parejas estimadas por una caja completa.

## Marco fuente y destino

El [diagrama oficial de coordenadas](https://dbarchive.biosciencedbc.jp/data/bodyparts3d/20090209/coordinateSystem.png), encontrado en el índice oficial porque el enlace del README está roto, declara mm, +X izquierda, +Y posterior y +Z superior. Es documentación de release1. El visor oficial sigue declarando `Origin(mm)`/`Radius(mm)`. Los elementos inspeccionados de release4 corroboran lateralidad (costillas izquierdas +X, derechas −X), esternón anterior con Y negativo y cuerpo esternal por encima del xifoides en Z. Esta concordancia respalda el marco, sin convertir un modelo adulto masculino en norma poblacional.

VExUS usa mm, +X izquierda, +Y anterior, +Z superior. La conversión de ejes es `diag(1,−1,1)`, determinante −1: hay que invertir winding y transformar normales. No se cambian los ejes globales de la app.

`tools/anatomy/registration.ts` exige ejes ortogonales y escala exclusivamente por unidad (mm o cm), un origen fuente y un origen destino para **todos** los órganos. Rechaza shear y escala por eje. No normaliza cada órgano por separado. Una evidencia ausente no equivale a validación.

## Landmarks aún pendientes

`bodyparts-candidate-report.json` conserva una traslación **ilustrativa**, no un registro anatómico listo: `eligibleForIntegration=false`. Las cotas son candidatos geométricos. Falta seleccionar y guardar índices de vértices/superficies para unión xifoesternal, línea vertebral y articulaciones costovertebrales, y medir residuales después de una única transformación. No se deben importar esas coordenadas candidatas al runtime.

Ambigüedad de la base: el xifoides 3D ocupa Z0..30mm, cuerpo esternal Z30..140mm y la séptima costilla tiene `zAnterior=0`. «Origen xifoideo» no especifica punta o unión xifoesternal. Resolverlo exige revisar contactos del esternón y costillas junto con diafragma, hígado y VCI, sin desplazar órganos independientemente.

## Provenance y coste medido

[README vigente](https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/README_e.html): datos release4 (2013), licencia actualizada en2025, elementos atómicos OBJ distintos de conceptos compuestos. [Licencia actual](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html): CC BY4.0.

Crédito: BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International.

Siete elementos inspeccionados: FJ3153, FJ3178, FJ3290 (esternón/xifoides) y FJ3232/FJ3342, FJ3225/FJ3330 (quinta/décima bilateral). 22.288 vértices,41.180 caras,2.711.874bytes OBJ;801.327bytes comprimidos en el ZIP fuente. Eso **no** es coste HTTP de producción ni memoria GPU. Hash SHA256 por elemento en el informe; mallas fuera del producto. La herramienta offline verifica hashes antes de producir cotas.

Ejemplo reproducible (manifest con rutas locales autorizado, registro explícito):

```sh
npx tsx tools/anatomy/inspect-bodyparts.ts manifest.json registro.json informe.json
```

No hay assets nuevos en el build, ni aumento del presupuesto JS. Una futura caja completa debe usar un asset geométrico cargado bajo demanda con presupuesto separado y medido (transferencia comprimida, geometría decodificada, memoria GPU, coste de primer uso), preservando un único clasificador para CPU/GPU/3D. No basta añadir una malla decorativa. No se autoriza aquí un presupuesto adicional.

## Adquisición izquierda comprobada

`e2e/costalRegistration.spec.ts`: 12 normales corticales en los seis pares, comparación TS/GLSL y reflexión X; transmisión de rayos reales antes/después del primer impacto óseo, con composición apagada; pose izquierda sobre la octava costilla y pose vecina entre superficies. El marco efectivo se actualiza avanzando el reloj antes del render. El espacio vecino queda parcialmente abierto: el haz finito aún intersecta el borde. No se afirma desaparición total de sombra.

Los umbrales son contratos numéricos del simulador, no medidas clínicas ni validación perceptual. La prueba evalúa transmisión de rayo único; queda pendiente una comparación de intensidad cortical/sombra en clips reales y aperturas compuestas.

## Próximos bloques, después de fijar landmarks

1. Caja completa: 12 pares y cartílagos según referencia, curva/anclajes por pieza; comparar articulaciones y separación entre superficies en 3D y barridos US. Medir error de aproximación del clasificador frente a la malla, sin degradar los gates de adquisición.
2. Hígado y vasos: cúpula/borde inferior y árbol portal/hépatico continuo en el mismo marco; VCI retrohepática y unión AD permeable. Comparar vistas hepatoportales normales con textura homogénea y cine coherente.
3. Vesícula/vía biliar/interfaz renal: cuello-fundus, conductos sin señal Doppler, contacto hepatorrenal sin franja falsa de líquido, corteza/seno/pirámides; aceptación por cortes y barridos, no solo malla.
4. Asas/aorta y corazón: asas continuas y oclusión por gas compartida en B/color/PW; aorta con ramas/taper. EchoTwin requiere adaptador cm/ejes/fase, tejidos acústicos explícitos y unión VCI-AD; bloque dedicado, sin copiar torso ni app.

Ninguno de estos bloques implica aprobación clínica o hiperrealismo ya alcanzado.
