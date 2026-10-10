# Marco TAC común y procedencia de las adquisiciones

## Defecto y contrato

El cine guardaba tiempo y ajustes, pero no la pose, el marco efectivo, el transductor,
la compresión ni la muestra fisiológica. Al revisar una adquisición antigua, el corte
anatómico y el abanico 3D podían representar los controles actuales. Esa relación
falsa enseña a atribuir una estructura a un plano que no la adquirió.

Predicción: al mover los controles congelados o seleccionar un cuadro histórico,
la imagen conserva su geometría adquirida. Corte y abanico siguen ese cuadro; una
nueva adquisición cambia su marco. La señal, el reloj y las geometrías de órganos
permanecen iguales. Refutan la corrección una pose histórica que cambia, una
reproyección equivocada, un salto de señal introducido o una referencia ajena
aceptada como si fuera el mismo individuo.

## Un caso, una rejilla, un registro

`CtCaseFrame` consume la auditoría original de `ct_vascular_reference.py`: SHA256
del TAC, caso y versión, dimensiones, affine RAS/mm y evidencia de unidades.
Conserva la anisotropía y orientación original. Un único `Registration` rígido
transforma TODOS los tejidos del caso; su inversa recupera las coordenadas fuente.
No se normalizan tamaño, centro o ejes por órgano.

`voxelToPatient` permite localizar el mismo punto en el volumen, las superficies
del torso y un plano. `patientToVoxel` exige el identificador del mismo marco y
devuelve también si el punto está en el soporte físico de la imagen. Un punto
externo nunca se recorta al borde ni se rellena con tejido inventado.

```ts
import { CtCaseFrame, NATIVE_RAS_TO_LAS } from '../../tools/anatomy/ctFrame';
// audit: JSON producido por la auditoría, contrastado con los archivos originales.
const reference = new CtCaseFrame(audit, NATIVE_RAS_TO_LAS);
const pointLASmm = reference.voxelToPatient([100, 160, 210]);
const original = reference.patientToVoxel(pointLASmm, reference.id);
```

RAS→LAS invierte X y conserva Y/Z: es una convención de ejes, no un registro entre
personas. La evidencia de landmarks sigue pendiente en ese ejemplo. El modelo
actual procede de BodyParts3D y aproximaciones; s0028 es otro individuo. Este PR
no los declara alineados ni instala órganos TAC en el simulador.

## Imágenes y cine realmente adquiridos

Cada `CineFrame.anatomy` conserva una copia de los inputs físicos del cuadro.
`displayedFrame` identifica el framebuffer presentado. El Worker del corte usa
su marco, transductor, compresión y muestra; también conserva esos inputs para
que la comparación CPU/GPU no use el contacto actual. El abanico 3D usa el marco,
profundidad y desplazamiento respiratorio del cuadro mostrado.

`exportAcquiredFrame(page, prefix, sourceSha)` lee imagen y metadatos en una sola
evaluación y escribe PNG y JSON con hashes. Incluye caso/paciente, semilla,
muestra, tiempo y número de cuadro, pose adquirida y controles actuales,
transductor, compresión, ajustes y layout del sector. El SHA debe corresponder
al build servido; comprobar esa procedencia es responsabilidad del runner.

`exportAcquiredCine` guarda la secuencia del anillo con esos mismos metadatos,
conserva los tiempos originales y restaura el cuadro seleccionado. No asigna
una tasa de adquisición fija. El cine reconstruye envolvente R16F y persistencia:
no equivale exactamente a cada cuadro en vivo descartado entre guardados.
La selección, presentación y lectura ocurren en lotes atómicos de hasta ocho
cuadros, con restauración del original antes de ceder el hilo al bucle de UI.
El límite acota memoria/transferencia del banco; no es un umbral físico ni reduce
el cine: se exporta todo el anillo. El manifiesto registra cada lote y comprueba
que ningún cuadro del bucle se intercaló dentro de sus lecturas. La CI1da1283
demostró que hacer una llamada remota por cuadro todavía agotaba270s con
SwiftShader, en primera ejecución y reintento automático. Ese fallo se conserva.
Los grises se transportan como bytes en base64 y se decodifican antes del PNG:
evita el array JSON de números, sin compresión de imagen ni pérdida de píxeles.
Se contrasta cada PNG y su geometría con el protocolo anterior sobre el mismo cine;
la mejora del coste debe verificarse en el corredor, no inferirse del nombre del formato.
Las pruebas esperan adquisiciones del bucle real en vez de agregar
renderizados manuales redundantes. Las capturas de tarjetas hepáticas se congelan
después de llegar a su pose, exigen que esa pose sea la adquirida y conservan
tanto el framebuffer con metadatos como la interfaz completa. Se mantienen los
plazos y todas las comprobaciones; un resultado que pasa al reintentar no se acepta.
Para repetir una adquisición controlada se usa `comparisonState`, registrando
tiempo, fase del receptor, historia de composición/persistencia y ajustes.

`acquiredPixelPoint` convierte un píxel del sector mostrado a mm del paciente
con su propia geometría. `acquiredPixelVoxel` rechaza un identificador TAC distinto
o ausente. También rechaza respiración/compresión no nulas: el TAC está en reposo
y falta validar la transformación inversa al material de su futuro modelo.
Las exportaciones actuales tienen `anatomyFrameId: null` y
`ctRegistrationAccepted: false`: el programa todavía no adopta un caso TAC.

## Aceptación y límites

- Phantom oblicuo de espaciado3/2/4mm: coordenadas conocidas e inversa, distancia
  conservada, soporte físico, rechazo de fuente/caso/registro distinto, unidades
  ambiguas, affine singular y shear del registro. Contraste independiente con NiBabel.
- Navegador: reconstruir el mismo cine antes/después de mover controles, comparar
  framebuffer y marco, comprobar cambio real con una nueva adquisición y recuperación
  del anterior. El campo CT incompatible debe fallar antes de superponerlo.
- Revisar capturas y cines del programa, concordancia del corte/abanico, coste por
  cuadro, arranque de producción, todos los tests y CI del SHA exacto.

Estos controles verifican el instrumento y la procedencia, no normalidad clínica
ni fidelidad de la imagen. La adopción del caso TAC, revisión de segmentaciones,
fascias/suprahepáticas, calibración acústica, movimiento material y evaluación
clínica externa siguen pendientes. Las fuentes y sus licencias conservan el
contrato de [referencia vascular](ct-vascular-reference.md).

Fuentes primarias de coordenadas:
[NiBabel, affine y referencia RAS](https://nipy.org/nibabel/coordinate_systems.html),
[3D Slicer, sistemas RAS/LPS](https://slicer.readthedocs.io/en/latest/user_guide/coordinate_systems.html).
