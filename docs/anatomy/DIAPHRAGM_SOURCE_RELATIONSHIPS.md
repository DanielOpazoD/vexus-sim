# Relaciones fuente: diafragma, grandes vasos, esófago y riñones

**Estado: integración anatómica bloqueada; auditoría offline, sin cambio de imagen.**

La disponibilidad y el saneamiento topológico del diafragma no acreditan que sus relaciones con
otras piezas sean correctas. Este bloque contrasta seis piezas del mismo atlas y del mismo
registro xifoideo, sin desplazarlas, recortarlas ni introducir tolerancias clínicas tácitas.

## Resultado reproducido

La distancia firmada se calcula con CGAL respecto a la superficie diafragmática reparada. Un
valor negativo prueba que ese punto de la otra pieza está dentro del volumen diafragmático.
Son vértices y centroides de caras; las cuentas no miden volumen ni porcentaje de solapamiento.
Además se comprueba la intersección global de todas las caras con CGAL: positiva en las cuatro
piezas vasculares/esofágica y negativa en las dos piezas renales. No depende del muestreo.

| Pieza fuente           | Muestras interiores | Mínimo firmado muestreado (mm) |
| ---------------------- | ------------------: | -----------------------------: |
| Aorta abdominal FJ1932 |                 111 |                      −1,708948 |
| Esófago FJ2563         |                  22 |                      −1,415629 |
| VCI FJ3441             |                   1 |                      −0,013871 |
| VCI FJ3659             |                  12 |                      −1,152414 |
| Riñón izquierdo FJ3145 |                   0 |                      +3,586950 |
| Riñón derecho FJ3147   |                   0 |                      +1,146656 |

Los dos elementos de VCI se conservan por sus IDs; no se supone que constituyen una superficie
unificada y validada. El informe guarda índice original, tipo de muestra, coordenadas LAS y
distancia del peor testigo de cada pieza para poder volver al triángulo exacto.

Un testigo negativo es evidencia geométrica de penetración en estas superficies segmentadas;
no demuestra por sí solo una alteración clínica ni determina cómo corregir la segmentación.
En cambio, **cero muestras interiores no prueba separación global**: un triángulo puede cruzar
la superficie sin que ninguno de sus vértices o su centroide quede dentro. El test adversarial
conserva precisamente ese caso: el muestreo es inconcluso, pero la comprobación de todas las
caras detecta el cruce. Otra prueba distingue superficies separadas de volúmenes contenidos. Los mínimos positivos tabulados no
son distancias mínimas globales entre órganos.

## Consecuencia para la integración

No basta con conservar tres túneles y anunciar hiatos anatómicos permeables. Antes de promover
estas piezas al simulador se requiere resolver las intersecciones detectadas y evaluar contactos, identificar
trayectos y decisión anatómica explícita sobre discrepancias de segmentación. No se agrandan
hiatos, cambian radios vasculares o trasladan riñones para conseguir un informe verde.
El orden de prioridad de tejidos tampoco se acepta como prueba de ausencia de interpenetración.

El registro común es necesario pero insuficiente. Estos resultados se suman a los desacuerdos
ya documentados entre órganos procedurales y atlas; no justifican sustituir solo una pieza y
mantener el resto como si perteneciera al mismo adulto.

## Reproducción y pruebas

```sh
python tools/anatomy/diaphragm_relationships.py \
  --candidate /ruta/diaphragm-repaired-candidate.npz \
  --source-directory /ruta/partes-oficiales \
  --output /ruta/nueva/relaciones.json
python tools/anatomy/diaphragm_relationships_test.py
```

Entorno offline igual al de la reparación: NumPy 2.3.5, SciPy 1.17.0 y
CGAL 6.0.1.post202410241521. La herramienta exige el SHA del candidato reparado y hashes de las
seis piezas. Antes de consultar, vuelve a verificar que el diafragma sea un componente cerrado,
manifold y sin autointersecciones. La fuente de cada órgano se compara sin alterar sus vértices.

Diez contratos cubren signo/distancia analítica del cubo, frontera, testigo negativo en el
centroide con vértices fuera, cruce no detectado por muestras pero detectado por el predicado completo, contención volumétrica,
vértices no usados, entradas
inválidas, rechazo de oráculo abierto o sin soldadura exacta y persistencia explícita del bloqueo del informe.
La CI prueba el comportamiento y la integridad del informe; **no descarga ni repite todo el
atlas**. La corrida completa sobre fuentes fijadas queda registrada en el JSON reproducible.

Fuentes y licencia: `diaphragm-relationship-sources.json` conserva archivo, tabla y hashes por
pieza. El archivo oficial se verificó por SHA256 y cada OBJ contra su entrada del ZIP.
BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International.
[Licencia oficial](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html).
Modificaciones de esta auditoría: transformación LAS común para consultas y muestreo de
superficies; ninguna deformación o reparación de las seis piezas. No implica aval del proveedor.
