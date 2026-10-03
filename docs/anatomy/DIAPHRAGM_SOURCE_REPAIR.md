# Fuente diafragmática: corrección local de auto-intersecciones

La limpieza de componentes por sí sola no basta. El componente principal tenía seis pares de auto-intersección según `CGAL.Polygon_mesh_processing.self_intersections`, aunque todas las aristas y enlaces de vértice eran manifold, la orientación era consistente y el volumen positivo.

## Testigo y reparación

Los seis pares estaban contenidos en las caras fuente 36897–36902: los lados de un pequeño anillo triangular que se cruzaban entre sí. Su caja abarca aproximadamente 0,3 × 0,3 × 0,6 mm. El testigo de seis vértices se conserva en `diaphragm-source-repair-witness.json`; CGAL detecta seis intersecciones antes y ninguna después.

El plan explícito `diaphragm-source-local-repair-plan.json` fija el mismo SHA256 del OBJ y cambia únicamente la triangulación de esas seis caras. Usa exactamente los mismos seis vértices fuente y conserva los dos ciclos de borde dirigidos. No rellena un orificio, no desplaza vértices y no aplica suavizado global. Las otras 68.484 caras retenidas quedan idénticas. La característica de Euler −4 y el género 3 permanecen iguales; esto no asigna nombres anatómicos a los túneles.

## Cotas y verificación

La distancia entre las superficies antigua y reparada se acota en ambos sentidos a menos de 0,075 mm. No se usa solo el máximo de unas muestras: para cada celda triangular se suma la distancia de su centroide a la superficie objetivo y su radio máximo; la distancia sin signo es 1-Lipschitz. Las celdas no certificadas se subdividen y agotar el presupuesto produce error. Se añade un margen numérico de 1e−9 mm. Las cotas obtenidas son 0,074439 y 0,074878 mm, con 370 y 374 celdas evaluadas. Son límites de esta reparación geométrica, no tolerancias clínicas.

El volumen del componente principal cambia en −0,012386 mm³ sobre unos 320.645,606 mm³. El informe final contiene los pares fuente originales, planes y hashes, las cotas, la topología y la confirmación CGAL de cero auto-intersecciones en toda la superficie reparada. Los índices retornados por CGAL se asocian por geometría a las caras, comprobando una biyección, sin asumir el orden del lector OFF.

La eliminación previa de 32 caras satélite está registrada separadamente en `diaphragm-source-component-report.json`. La afirmación de preservación exacta de todas las caras de esa etapa corresponde al candidato anterior a esta retriangulación local. El OBJ oficial nunca se modifica.

## Reproducción y dependencias offline

Python 3.12, NumPy 2.3.5, SciPy 1.17.0 y bindings oficiales `cgal==6.0.1.post202410241521`:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tools/anatomy/diaphragm_source_repair.py --atlas /ruta/piezas-verificadas --output /ruta/directorio-nuevo
PYTHONDONTWRITEBYTECODE=1 python3 tools/anatomy/diaphragm_source_repair_test.py
```

[CGAL: API de intersecciones](https://doc.cgal.org/6.0/Polygon_mesh_processing/group__PMP__intersection__grp.html) y [bindings oficiales](https://github.com/CGAL/cgal-swig-bindings). CGAL se usa como herramienta offline de verificación; no se enlaza ni incorpora al runtime navegador. Los tests incluyen el testigo fuente, superficies alejadas, límites de trabajo, fronteras/vértices alterados, referencias inválidas y retriangulación de un cubo cerrado.

## Lo que aún no se promueve

El NPZ reparado sigue siendo un candidato offline. Faltan representación física, paridad CPU/GPU, coste, registro de órganos y validación anatómica/ecográfica. No se incorpora una malla decorativa discordante con B-mode. Cero auto-intersecciones no significa anatomía clínicamente validada ni tórax completo.

BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International. [Licencia oficial](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html).
