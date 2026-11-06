# P5 r1: red vascular candidata de s0028, offline

Pendiente del propietario. No instala vasos, no cambia `src/`, el comportamiento por defecto, los presupuestos ni
los techos de shader. La geometría procede de una sola persona, con el registro de `s0028-case.json` y
`CtCaseFrame`: una reflexión RAS→LAS y una traslación comunes, en mm. No convierte HU en brillo ecográfico.
El criterio es la coherencia interna de esa persona, no parecerse a un promedio. No es validación clínica.

## Fuente y extracción

TAC de fase portal y máscaras TotalSegmentator v3, CC BY 4.0; originales fuera de Git. El exportador comprueba
hash del TAC y de las 16 máscaras consumidas, persona, dimensiones, affine, paso y evidencia de mm. No ejecuta
TotalSegmentator ni otro modelo aprendido. Entorno propio fijado en `s0028-vessels-requirements.txt`:
Python 3.14.7, numpy 2.5.4, scipy 1.18.1, nibabel 5.4.2, scikit-image 0.26.0 y matplotlib 3.11.2.
Filtro Frangi y esqueleto Lee de scikit-image, BSD-3-Clause.

Las máscaras de VCI y porta/esplénica se conservan completas. La aorta abdominal se corta en el límite superior
de la máscara hepática (índice nativo K=274); la banda del corte queda U. La VCI llega al extremo craneal de su
máscara (K=279), con 1.142 vóxeles en contacto 26 con `heart`. Esto no identifica por separado la AD ni autoriza
extender la cava dentro de ella. El contacto entre dos máscaras vasculares conserva ambos dueños y U, incluso
si no afecta a un nodo del esqueleto.

Dentro del hígado: Frangi sobre HU crudo a escalas 1,2/1,8/2,5 vóxeles, α=β=0,5, γ=15; respuesta ≥0,04 y
HU suavizado (σ=0,6 vóxeles) ≥115. Dominio: interior hepático a >1,5 vóxeles del borde o halo de dos vóxeles
alrededor de raíces cava/porta, siempre dentro del hígado. Se excluyen las máscaras raíz del candidato.
Se cuentan **todas** las raíces tocadas por cada componente 26-conectada: cava, porta, ambas (conflicto U) o
ninguna (huérfana U). No se elige una por orden ni por proximidad. La familia sólo es D por nodo si conserva la
misma conexión única al variar, por separado, HU ±5 y respuesta ±0,02. No certifica identidad nominal, luz ni flujo
observado. Los nombres `hvRight`, `hvMiddle`, `hvLeft` y las ramas portales individuales permanecen U.

Los candidatos ≥27 vóxeles se esqueletizan; los menores y las componentes borradas por Lee se contabilizan.
No se eliminan ciclos para fabricar un árbol: toda componente cíclica conserva sus aristas U y flujo cero.
Las uniones entre esqueletos recorren únicamente soporte observado (rama ∪ raíz); se conservan como caminos U,
con extremos, máscara y radio EDT verificables. El flujo de referencia distingue drenaje hacia cava de nacimiento
desde porta, sin convertir ese camino en luz aceptada ni habilitar PW.

Renales: exploración en la caja de ambos riñones más cuatro vóxeles, sin máscaras de sólidos/GI, HU suavizado
[100,220] y el mismo filtro. Se conservan tres candidatos hiliares, todos U; no se identifican vena y arteria,
no se inventan interlobares. Conductos biliares no separados: la extracción no demuestra tríadas portales.

Se conservaron los intentos descartados: el umbral HU simple unía cava y porta (29.229 vóxeles conflictivos a
120 HU), y Sato producía una red extensa e inestable. La sensibilidad final se publica sin usarla como norma
anatómica ni como aceptación del propietario.

## Contrato candidato

`candidate/manifest.json` declara marco, hashes de fuente y herramientas, entorno, parámetros, grupos, raíces,
identidad exacta, familia, certezas independientes de geometría/radio, conexiones, pérdidas y puente fisiológico.
El recibo fija tamaño y SHA-256 de todos los archivos descargables, incluido el soporte. Gzip usa `mtime=0`.

`vessels.gzip.bin` contiene little-endian: cabecera `VXV1`, dos uint32 (nodos y aristas); cada nodo ocupa 24 B
(`x,y,z,r` float32, `i,j,k` uint16, grupo uint8, certeza uint8); cada arista ocupa 12 B (dos índices uint32,
sentido int8 −1/0/+1, certeza uint8, grupo uint16). Las aristas son los segmentos entre muestras consecutivas.
Los nodos comparten posición/topología; las conexiones entre grupos conservan radios propios en cada lado.
`support.gzip.bin` conserva coordenadas nativas ocupadas por grupo como JSON canónico comprimido: permite reabrir
la evidencia de soporte, sin volver a ejecutar el filtro. Su coste se incluye aunque un lector futuro pueda
separar esta auditoría de la descarga de producto.

La certeza D del nodo/arista expresa pertenencia derivada a una familia; no promueve `identityCertainty`,
`geometryCertainty` ni `radiusCertainty`. La orientación es respecto al orden de extremos y a la raíz declarada:
una raíz venosa puede ser salida. U de orientación se codifica con cero; no significa velocidad sanguínea cero.
La velocidad instantánea futura debe poder invertir signo.

Al reabrir se rechazan hash/tamaño/marco distintos, coordenadas con un segundo registro, radios no positivos,
referencias rotas, autoenlaces/duplicados, ciclo parcialmente D, flujo contrario a raíz y promoción de U a una
identidad fisiológica. Un camino conectado exige pertenencia a su soporte conservado y cada radio coincide con
EDT menos medio paso. Los negativos sintéticos incluyen una componente que Lee borra mientras otra sobrevive,
un triángulo D/D/U, fuente U visible, inventario de comparadores incompleto y un puente a través del fondo.

`physiologyId` se separa del identificador del segmento; sólo la aorta tiene mapeo exacto en r1. El futuro adaptador
preservará `refRadius`, `profileN`, `wallMm`, `flowFactor`, ley de calibre y forma de onda; no recalculará ni
normalizará estos parámetros a partir del radio CT. U bloquea elegibilidad PW. Deben conservarse los negativos
vaso equivocado, pérdida de puerta hepática/portal, cambio tronco-rama y puerta arterial renal. El contrato no
acredita su integración.

## Reproducción

Desde la raíz del repositorio, con el caso y la salida fuera de Git. Cada extracción/prueba pesada se ejecuta
sola, con prioridad reducida; no requiere red una vez preparado el entorno fijado.

```bash
python3 -m venv <venv-propio>
<venv-propio>/bin/python -m pip install -r tools/anatomy/s0028-vessels-requirements.txt
nice -n 10 <venv-propio>/bin/python -I tools/anatomy/s0028-vessels_test.py
nice -n 10 <venv-propio>/bin/python -I tools/anatomy/s0028-vessels-plates_test.py
nice -n 10 <venv-propio>/bin/python -I tools/anatomy/s0028-vessels-export.py --case-dir <caso> --out <extraccion>
nice -n 10 node --import tsx tools/anatomy/s0028-vessels-planes.ts <planos-s0028>
nice -n 10 node --import tsx tools/anatomy/s0028-vessels-planes.ts <planos-antiguos> --current
nice -n 10 <venv-propio>/bin/python -I tools/anatomy/s0028-vessels-plates.py --case-dir <caso> --extraction <extraccion> --planes <planos-s0028> --old-planes <planos-antiguos> --out <laminas>
```

Los diez planos usan poses intactas del menú y la sonda convexa: rectángulos físicos de 301×301 a 0,75 mm,
sin respiración ni compresión. Columnas 1–4: TAC, grafo con radios del paquete, procedural vigente en ese mismo
plano s0028, diferencia geométrica. Columna 5: modelo antiguo con sus órganos/vasos y **su propio plano**,
sin poner el TAC de s0028 debajo. Es comparación anatómica, no captura ecográfica. Las listas sí/no del
propietario quedan sin rellenar. U amarillo; contorno vascular fuente blanco punteado.

## Medidas y límites de instalación

Las medidas y hashes finales están en el [índice de evidencia](../evidence/migration-p5-r1/README.md).
Los diámetros son dos veces el radio inscrito EDT menos medio paso, en centros del esqueleto. No son diámetros
clínicos transversales ni ecográficos. Las longitudes incluyen escalones de la rejilla y espículas; los candidatos
U no son árboles anatómicos aceptados. Se miden sólo s0028, sin normas ni percentiles.

Falta el punto 3 de la decisión 322 (chunk propio s0028), aceptar/revisar las láminas y resolver lo necesario de U,
lector/adaptador CPU, Worker y GLSL, representación y techos de shader sin aumentarlos, continuidad/uniones,
colisiones, paridad, negativos PW, coste de descarga/JS/GPU y arranque en SwiftShader y Metal. No se añaden tubos
al runtime en esta ronda ni se atribuye al paquete una equivalencia fisiológica ya demostrada.
