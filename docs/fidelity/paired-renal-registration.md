# Inicialización renal rígida con evaluación separada

**Contrato previo.** Superponer dos modalidades del mismo paciente sin registro
crea relaciones falsas. El ajuste de tres puntos no demuestra alineación del
resto del órgano. Este piloto preserva escala y no modifica el simulador.

Usa `paired_renal_reference.py` para admitir imágenes originales. Los hitos CT
provienen de `CT_landmarks_inimg`, los US de `US_landmarks`: el README de TRUSTED
indica que estos últimos ya están en el marco de adquisición. Declarar
`image-world-RAS-mm` solo después de comprobar orientación, unidades y FOV; no
convertir índices de voxel en mm por cambiar el nombre del campo.

Los sufijos `1` y `2` en `418R1_ldkUS.txt` y `418R2_ldkUS.txt` identifican
a los anotadores del mismo volumen; el consenso usa `418R_ldkUS.txt`.
No son números de adquisición. El [código fuente de TRUSTED](https://github.com/IRCAD/trusted_code_nsd/blob/main/src/trusted_datapaper_ds/dataprocessing/estimate_gtldks.py)
construye esos nombres y asigna `annotatorID` 1/2. Cada conjunto sigue
vinculado al hash de su imagen admitida y al marco físico comprobado.

Manifiesto local (todos los hashes son SHA-256 completos del contenido):

```json
{
  "schemaVersion": 1,
  "admission": { "path": "admission.json", "sha256": "HASH_ADMISION" },
  "ct": {
    "path": "CT_landmarks_inimg/GT_estimated_ldksCT/418R_ldkCT.txt",
    "sha256": "HASH_HITOS_CT",
    "patientId": "418",
    "side": "R",
    "frame": "image-world-RAS-mm",
    "imageSha256": "HASH_IMAGEN_CT_ADMITIDA"
  },
  "us": {
    "path": "US_landmarks/GT_estimated_ldksUS/418R_ldkUS.txt",
    "sha256": "HASH_HITOS_US",
    "patientId": "418",
    "side": "R",
    "frame": "image-world-RAS-mm",
    "imageSha256": "HASH_IMAGEN_US_ADMITIDA"
  }
}
```

```sh
python tools/anatomy/paired_renal_registration.py registration-manifest.json --output registration.json
python tools/anatomy/paired_renal_registration_test.py
```

Siete filas XYZ, orden original. IDs3/4/5 ajustan rotación propia y traslación;
IDs1/2/6/7 se reservan. La salida conserva matriz US→CT, inversa, RMS de ajuste,
RMS reservado y TRE de pelvis1. No sustituir el error reservado por el de ajuste.
Los controles analíticos incluyen una reflexión con ajuste perfecto de tres
hitos pero TRE24mm; la herramienta sigue sin conceder aceptación clínica.

**Límites.** [TRUSTED](https://www.nature.com/articles/s41597-025-04467-1) utiliza
inicialización por similitud; este método fija escala1 deliberadamente para
conservar dimensiones. No reproduce su benchmark. Postura, respiración y
presión pueden invalidar el rígido; inspeccionar cortes y anotadores antes de
proponer correcciones. Anotadores compartidos no equivalen a revisión externa.
No fijamos un umbral anatómico universal sin evidencia. El paciente reservado
no se utiliza para elegir parámetros o puntos de ajuste. Los datos, acuerdos,
figuras y manifiestos clínicos permanecen locales.
