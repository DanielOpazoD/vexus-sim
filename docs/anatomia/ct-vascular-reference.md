# Referencia vascular TAC en coordenadas comunes

El objetivo es contrastar porta, red venosa hepática, cava y aorta con las relaciones
del hígado, riñones y columna. El TAC aporta geometría e interfaces; sus intensidades
no son ecogenicidad y no determinan dirección, velocidad ni ondas Doppler.

## Herramienta offline

`tools/anatomy/ct_vascular_reference.py` audita el TAC y las máscaras **del mismo
caso** antes de reconstruir o registrar anatomía. No modifica el simulador,
descarga datos ni incorpora volúmenes al bundle. Rechaza coordenadas físicas
ausentes, qform/sform contradictorios, unidades incompatibles, máscaras
multicategoría y rejillas desplazadas. No corrige estas entradas por órgano.

El informe conserva hashes, affine RAS en milímetros, procedencia, fase declarada,
volumen voxelizado, centroides, componentes sin unir, contactos con límites de
imagen, intersecciones y cuantiles de intensidad originales. Los límites de los
centros ocupados no son diámetros luminales o longitudes clínicas. La erosión de
un voxel usada para cuantiles no tiene espesor físico constante en TAC anisótropo.
La tolerancia de coordenadas de 0,0001 mm contempla redondeo de cabeceras NIFTI;
no declara esa precisión anatómica.

LAS, la convención de VExUS, invierte solamente el eje X de RAS. Esa conversión
de ejes no registra una persona TAC en el paciente del simulador. Un registro
posterior debe transformar conjuntamente todos los órganos, huesos y vasos;
la evidencia debe conservar tanto las coordenadas originales como la transformación.

Entorno Python separado del checkout; versiones observadas el 10-10-2026:

```sh
python3.14 -m venv /ruta/externa/ct-reference-env
/ruta/externa/ct-reference-env/bin/pip install -r tools/anatomy/ct-reference-requirements.txt
/ruta/externa/ct-reference-env/bin/python tools/anatomy/ct_vascular_reference_test.py
/ruta/externa/ct-reference-env/bin/python tools/anatomy/ct_vascular_reference.py /ruta/externa/manifest.json --output /ruta/externa/audit.json
```

Los paths del manifiesto se resuelven respecto a su directorio. Ejemplo de
contrato de entrada (las etiquetas deben describir la fuente real):

```json
{
  "source": {
    "dataset": "TotalSegmentator",
    "case": "s0028",
    "role": "fit",
    "url": "https://doi.org/10.5281/zenodo.22688904",
    "license": "CC BY 4.0"
  },
  "ct": "ct.nii.gz",
  "millimeterEvidence": "Procedencia documentada cuando el NIFTI omite unidades",
  "intensityUnits": "Intensidad TAC original; documentar calibración y sus límites",
  "contrastPhase": "unknown",
  "masks": {
    "aorta": {
      "path": "segmentations/aorta.nii.gz",
      "sourceLabel": "aorta",
      "identityStatus": "separate-source-label"
    },
    "portal_splenic_joint": {
      "path": "segmentations/portal_vein_and_splenic_vein.nii.gz",
      "sourceLabel": "portal_vein_and_splenic_vein",
      "identityStatus": "joint-source-label"
    }
  },
  "vascularLabels": ["aorta", "portal_splenic_joint"],
  "requiredIdentities": ["aorta", "inferior_vena_cava", "portal", "hepatic_veins"]
}
```

`missingRequiredIdentities` indica qué identidades no tienen una etiqueta fuente
independiente, presente y no vacía. No demuestra que el vaso esté ausente del TAC.
`identityStatus` es una declaración de entrada, no una revisión anatómica automática.
Por ejemplo, una etiqueta de cava puede contener ramas intrahepáticas; conserva
esa red y requiere revisión antes de separar las suprahepáticas. Una etiqueta
arterial conjunta tampoco equivale a una segmentación independiente de aorta.

## Fuentes y hallazgos de la investigación local

- [TotalSegmentator v3](https://doi.org/10.5281/zenodo.22688904), CC BY 4.0:
  s0028 es la referencia inicial de ajuste, con cobertura abdominal y pélvica.
  s0440 permanece reservado para contraste posterior. La clase porta/esplénica
  es conjunta; no hay suprahepáticas separadas en las máscaras disponibles.
  El NIFTI omite unidades; el muestreo de 1,5 mm procede de la
  [publicación y procedencia del dataset](https://arxiv.org/abs/2208.05868).
  La intensidad vascular de s0028 es compatible con realce; la fase no consta.
- [3D-IRCADb-01, caso 11](https://www.ircad.fr/research-and-development/data-sets/liver-segmentation-3d-ircadb-01/):
  132 cortes originales, 0,72 × 0,72 × 1,6 mm según DICOM, sin tumor hepático
  en la tabla publicada. La cobertura es hepática, no toda la pelvis.
  Las etiquetas de porta, cava y arterias permiten estudiar ramificación en
  el mismo individuo. La etiqueta cava incluye ramas venosas intrahepáticas;
  no separa las identidades de las suprahepáticas. Fase y agente de contraste
  no están declarados en el DICOM anonimizado.
  Su licencia CC BY-NC-ND 4.0 limita esta investigación a referencia local;
  **no se adjuntan TAC, máscaras, mallas ni adaptaciones IRCAD a este repositorio**.

Ni `no_pathology` ni ausencia de tumor certifican una anatomía sana. La revisión
debe comprobar los cortes originales: una segmentación puede fragmentarse,
omitir ramas, atravesar interfaces o estar truncada por el campo de visión.
Las máscaras parenquimatosa y vascular pueden ser clases disjuntas: cero
solapamiento no significa que la porta o las venas estén fuera del hígado.

## Circuito para una corrección del simulador

1. Revisar TAC original, contornos y superficies en axial, coronal, sagital y
   oblicuos; identificar troncos y desembocaduras con continuidad entre cortes.
   Mantener fragmentos y experimentos rechazados. Nombrar raíces y ramas con
   revisión anatómica, conservando los identificadores de la fuente.
2. Comparar el modelo actual con un registro común vertebral y hepático
   explícito. Medir relaciones, calibres y uniones en milímetros, incluyendo
   incertidumbre de resolución, fase respiratoria y variación entre personas.
   No acomodar individualmente órganos para que una captura parezca correcta.
3. Implementar geometría compartida torso/plano/ecografía y sus interfaces
   acústicas; preservar la cadena causal y sincronizar TS/GLSL. El TAC no
   sustituye las propiedades tisulares ni la fisiología de la señal Doppler.
4. Repetir las nueve adquisiciones, poses vecinas, controles negativos y
   movimientos reales de sonda, con estados registrados antes/después, imágenes,
   cines y costes. Contrastar también con ecografías independientes y expertos.
5. Integrar únicamente con los controles habituales y CI exacta en verde.
   Actualizar evidencias y mantener pendientes las validaciones no realizadas.

La herramienta y los controles de coordenadas preparan ese circuito. Su salida
no certifica normalidad, fidelidad ecográfica, segmentación clínica ni integración.
No se introduce un umbral de HU para inventar vasos ni un valor de flujo derivado
de la atenuación del contraste.
