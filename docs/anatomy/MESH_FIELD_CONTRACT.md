# Contrato experimental de consulta de malla

Estado: herramientas offline; **no cambia el renderizado ni incorpora la malla al simulador**.
Depende del saneamiento fuente descrito en [DIAPHRAGM_SOURCE_REPAIR.md](DIAPHRAGM_SOURCE_REPAIR.md).

## Por qué este bloque

Una malla 3D decorativa no basta para producir ecos coherentes. Antes de integrar el diafragma
registrado hay que consultar distancia, interior/exterior y normal sobre la misma geometría en
CPU y GPU. Este bloque prueba ese contrato con la fuente completa de 68.490 triángulos y un
oráculo independiente, sin reducirla a una elipse ni alterar los hiatos.

La consulta usa BVH de cajas conservadoras y el pseudonormal ponderado por ángulo de
[Bærentzen y Aanæs (2005)](https://pubmed.ncbi.nlm.nih.gov/15868824/).
El signo es negativo dentro. La validez presupone una superficie cerrada, orientada, embebida
sin autointersecciones. El constructor comprueba aristas, enlaces de vértice, componentes y
volumen, pero **no sustituye** el chequeo de intersecciones de CGAL.

## Fuente y fixture independiente

- Fuente: BodyParts3D FJ3131, registro común LAS en milímetros y reparación local documentados
- NPZ reparado: SHA256 `581c17df0c5b9469d4a0081550652b288f9bac03233ce810c81a85140e6dada3`
- Fixture gzip: SHA256 `6b3d7fa6f679b72f32bef219f3bf8a506ce3bdef1846ad01b57f8308eba73298`
- 34.241 vértices, 68.490 caras; la conversión Float32 desplaza coordenadas como máximo
  0,000007569 mm y conserva cero autointersecciones comprobadas por CGAL
- 8.768 consultas reproducibles: caja ampliada, puntos junto a caras a ±2/0,25/0,01 mm,
  puntos junto a vértices y 64 vértices exactos
- Distancia y lado obtenidos por AABB tree y Side_of_triangle_mesh de CGAL, sin reutilizar
  el algoritmo CPU/GLSL evaluado

El archivo contiene geometría derivada y respuestas de prueba, no un asset público de ejecución.
BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International.
[Licencia oficial](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html).
Modificaciones: registro LAS, soldadura exacta, exclusión de satélites y retriangulación acotada
previas; conversión Float32 y empaquetado de consultas en este bloque. No atribuir respaldo al proveedor.

## Reproducción

Con el candidato y el informe producidos por el bloque de reparación, Python con NumPy 2.3.5,
SciPy 1.17.0 y CGAL 6.0.1.post202410241521:

```sh
python tools/anatomy/prepare_mesh_field_fixture.py \
  --candidate /ruta/diaphragm-repaired-candidate.npz \
  --report /ruta/report.json --output /ruta/nueva/diaphragm-field.json.gz
node node_modules/vitest/vitest.mjs run src/validation/meshField.test.ts
node --import tsx tools/fidelity/meshFieldParity.ts
```

La última orden requiere Chromium de Playwright y WebGL2 con EXT_color_buffer_float.
El workflow `mesh-field.yml` la ejecuta en Chromium/SwiftShader y publica el informe con el SHA
exacto del candidato, hardware declarado y discrepancias, incluso cuando falla la validación.
No necesita iniciar la aplicación ni descargar el atlas en CI.

## Gates previos a cualquier promoción

- CPU: error máximo de distancia menor de 0,000001 mm frente a CGAL en la fixture
- GPU: error menor de 0,01 mm; mismo signo fuera de 0,001 mm de la frontera; producto escalar
  de normales mayor de 0,99 cuando la distancia a la frontera supera 0,05 mm
- Sin NaN, errores de recorrido, desbordamiento de pila ni caras sin resolver
- Presupuesto JS del producto intacto: estos módulos no son importados por el runtime

Son tolerancias numéricas de consulta, **no precisión clínica ni garantía anatómica**.
La fixture finita no demuestra igualdad para todos los puntos ni estabilidad en todos los drivers.
Las normales en aristas, vértices y ejes mediales no tienen necesariamente una derivada única.

## Coste y límites

El BVH de esta fuente tiene 22.291 nodos y profundidad 14; los cuatro buffers ocupan
5.096.544 bytes antes del relleno de texturas. La fixture comprimida ocupa 1.365.631 bytes.
Estos costes impiden tratarlo como una incorporación gratuita al raymarcher.
El informe mide lotes de consultas aisladas; **no mide FPS del simulador** y SwiftShader no
representa Metal, móviles o GPU integrada. No hay una promesa de rendimiento comercial.

Antes de incorporar la fuente faltan: coste por rayo/píxel real, estrategia de aceleración o
representación certificada, registro coherente con órganos y vasos, superficie respiratoria,
clasificación de tejidos, interfaz acústica y revisión visual/anatómica. Los órganos actuales no
se desplazan silenciosamente para encajar en esta malla. Tampoco se declara completa la caja
torácica ni se identifican clínicamente los tres túneles solo por su topología.
