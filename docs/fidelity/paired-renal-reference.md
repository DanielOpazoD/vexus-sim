# Referencia renal emparejada: admisión antes de comparar

**Defecto y aprendizaje.** Dos imágenes del mismo paciente pueden tener distinto
marco, escala, fase o lado. Superponerlas sin comprobarlo puede aparentar un error
del simulador o esconderlo. El TAC contiene ambos riñones; un volumen US, uno.

**Mecanismo y dominio.** Herramienta offline para TRUSTED: imágenes locales,
SHA-256, identidad por paciente y lado, rejillas NIfTI y máscaras declaradas.
No descarga datos, concede acceso, instala anatomía ni transforma HU en señal US.

**Predicción.** Una pareja conserva dos marcos independientes. Archivo cambiado,
lado intercambiado o rejilla de máscara distinta impiden la admisión. Una
anotación ausente se informa como incompleta, nunca como un caso aprobado.

**Invariantes y refutación.** No remuestrear ni inferir orientación por dimensiones.
El caso queda sin registrar y sin aceptación clínica incluso si todos los archivos
son válidos. Admitir una máscara desplazada o promover admisión a fidelidad refuta
el contrato. Un paciente reservado no debe usarse para ajustar el modelo.

**Uso.** Reutiliza `tools/anatomy/ct-reference-requirements.txt` en un entorno Python
separado. Datos y resultados permanecen fuera de Git. El manifiesto local declara:

```json
{
  "schemaVersion": 1,
  "dataset": "TRUSTED",
  "patientId": "418",
  "side": "R",
  "role": "development",
  "source": "https://doi.org/10.6084/m9.figshare.27981050.v1",
  "accessEvidence": "Describir el acceso real; esto no sustituye el DUA",
  "ct": {
    "path": "418_imgCT.nii.gz",
    "sha256": "SHA256_REAL",
    "patientId": "418",
    "annotations": {}
  },
  "us": {
    "path": "418R_imgUS.nii.gz",
    "sha256": "SHA256_REAL",
    "patientId": "418",
    "side": "R",
    "annotations": {}
  }
}
```

Si las cabeceras no declaran unidades, añadir `millimeterEvidence` por modalidad
con procedencia explícita. Las anotaciones usan claves `annotator1`, `annotator2`
y `consensus`, cada una con `path`, `sha256` y `foregroundValue` (1 o 255).

```sh
python tools/anatomy/paired_renal_reference.py /ruta/manifest.json --output /ruta/admission.json
python tools/anatomy/paired_renal_reference_test.py
```

**Aceptación y límites.** Los controles sintéticos ejercitan identidad, contenido,
codificación y rejillas. El caso 418 local se conserva como evidencia externa al
repo; no sustituye inspección clínica. Faltan registro, error en hitos reservados,
revisión de planos coincidentes y validación en otro paciente. Fascias, músculos y
vasos vecinos no aparecen etiquetados por tener una máscara renal.

Fuentes: [TRUSTED, Scientific Data](https://www.nature.com/articles/s41597-025-04467-1)
y [afines NIfTI de NiBabel](https://nipy.org/nibabel/nifti_images.html). TRUSTED exige
acuerdo de uso firmado antes de descargar; el repositorio no distribuye pacientes.

## Memoria y redondeo explícito

Las máscaras originales TRUSTED pueden ocupar unos5GB al decodificarse como
float64 aunque el archivo gzip sea pequeño. Se leen bloques contiguos de16
cortes con el gzip abierto, sin materializar la máscara entera.

El valor predeterminado exige exactamente0 y el foreground declarado. Algunas
máscaras locales muestran residuos de representación de2,84217e−14 alrededor
de0/1. Solo con evidencia explícita se permite `roundoffTolerance` (entre0 y1e−8)
y `roundoffEvidence`; el informe conserva tolerancia y máximo residuo observado.
Para el piloto se declara1e−12. Este límite numérico no es un umbral de
segmentación: valores intermedios como0,01 siguen rechazándose, y los archivos
originales no se reescriben. No se acepta una máscara probabilística como binaria.
