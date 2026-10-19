# Admisión de evidencia acústica externa

El objetivo actual es un **convexo genérico de 3,5 MHz** (`convex-c35`). Sus parámetros son estimaciones del modelo; este contrato no los convierte en calibración medida. La herramienta admite archivos externos con metadatos y observables explícitos, comprueba su identidad y detecta cruces declarados entre desarrollo y conjunto reservado. No sintetiza imágenes, ajusta parámetros ni emite un veredicto clínico.

Complementa el [proceso de iteración](ITERATIVE_REVIEW.md) y el [protocolo renal emparejado](paired-renal-reference.md). No sustituye la adquisición registrada ni la evaluación humana. Las rondas históricas de [juez ciego](juez-ciego.md) fueron evaluaciones de agentes y referencias de desarrollo; no deben reclasificarse como humanos o evidencia reservada.

## Ejecución

Desde la raíz del checkout y con el entorno Node del proyecto:

```sh
./tools/workspace/run.sh node --import tsx tools/fidelity/externalEvidence.ts --profile
./tools/workspace/run.sh node --import tsx tools/fidelity/externalEvidence.ts \
  --manifest /ruta/datos/manifest.json \
  --out /ruta/evidencia/admission.json
```

`--profile` devuelve la identidad genérica y el SHA256 de `JSON.stringify(CONVEX_C35_PROFILE)` de ese checkout. Copiar ese objeto al manifiesto vincula la admisión a los parámetros actuales; un cambio del perfil invalida el hash anterior. El informe conserva también los parámetros completos y el hash de los bytes originales del manifiesto.

Los archivos referenciados deben estar debajo del directorio del manifiesto. Se rechazan rutas absolutas, `..`, segmentos vacíos y enlaces simbólicos que salgan de ese directorio. Se calculan los SHA256 sobre los bytes reales; las imágenes y clips se leen por streaming. Cada JSON de mediciones tiene un límite de 1 MiB. La carpeta de salida debe existir **fuera del checkout** y el archivo de salida debe ser nuevo: la escritura exclusiva nunca reemplaza evidencia previa. No hay acceso a red ni descargas implícitas.

## Manifiesto versión 1

Este ejemplo es una plantilla; los valores de adquisición son ilustrativos y los marcadores de hash deben reemplazarse por hashes reales. No constituye evidencia:

```json
{
  "schemaVersion": 1,
  "protocolId": "protocolo-local-versionado",
  "profile": {
    "id": "convex-c35",
    "basis": "generic-estimate",
    "parametersSha256": "COPIAR_DE_--profile"
  },
  "references": [
    {
      "id": "phantom-session-01",
      "role": "development",
      "origin": "physical-phantom",
      "subjectId": null,
      "sessionId": "institucion-estudio:sesion-01",
      "source": {
        "citation": "Identificador del original y protocolo de adquisición",
        "rights": "Permiso o licencia de uso documentados",
        "file": {
          "path": "originals/session-01.bin",
          "sha256": "SHA256_REAL_DEL_ORIGINAL"
        }
      },
      "acquisition": {
        "scanner": "Modelo y versión documentados",
        "transducer": "Identificador de transductor documentado",
        "frequencyMHz": 3.5,
        "depthMm": 150,
        "focusMm": 90,
        "dynamicRangeDb": 60,
        "gainDb": 0,
        "tgcDb": [0, 0, 0],
        "harmonic": false,
        "compound": false,
        "mmPerPixel": [0.2, 0.2]
      },
      "measurements": {
        "path": "measurements/session-01.json",
        "sha256": "SHA256_REAL_DEL_JSON"
      }
    }
  ],
  "tuningReferenceIds": ["phantom-session-01"]
}
```

Todos los campos son obligatorios; se rechazan campos extra para no aceptar silenciosamente otra versión del contrato. Los metadatos de adquisición desconocidos se representan con `null`, nunca con cifras supuestas. `tgcDb` contiene los puntos de la curva en dB; su distribución en profundidad debe quedar descrita en el protocolo citado. `mmPerPixel` contiene `[fila, columna]` en mm de la rejilla de análisis: un sector que necesite remuestreo debe documentar esa transformación y la región analizada. No convertir una escala de ganancia arbitraria del fabricante a dB sin documentación.

`origin` admite `physical-phantom`, `clinical`, `literature` y `synthetic`. Solo los dos primeros, con metadatos completos y sesión declarada, cuentan como referencias físicas completas. Las clínicas requieren además un seudónimo de sujeto; no incluir nombres ni otros identificadores personales. Bibliografía y resultados sintéticos pueden registrarse como antecedentes, pero no cuentan como medición física independiente del perfil.

## Mediciones versión 1

Cada archivo de mediciones identifica una sola referencia. Ejemplo numérico **ficticio**, sin umbral de aceptación:

```json
{
  "schemaVersion": 1,
  "referenceId": "phantom-session-01",
  "observables": [
    {
      "metric": "axialFwhm",
      "value": 0.8,
      "unit": "mm",
      "level": "linear-envelope",
      "method": "Anchura a media amplitud de un blanco aislado; documentar extracción, interpolación y escala",
      "region": "Identificador de blanco, profundidad y coordenadas de la región en el original"
    }
  ]
}
```

| Métrica                    | Unidad       | Nivel de señal    |
| -------------------------- | ------------ | ----------------- |
| `axialFwhm`, `lateralFwhm` | `mm`         | `linear-envelope` |
| `envelopeSnr`              | `ratio`      | `linear-envelope` |
| `meanGray`, `stdGray`      | `gray-0-255` | `display-gray`    |

Los valores deben ser finitos y no negativos; las anchuras deben ser positivas y los estadísticos de gris estar dentro de 0–255. Estos son límites de representación, **no tolerancias de fidelidad**. Método y región son texto obligatorio: incluir la definición de SNR, el tratamiento del fondo y cualquier conversión o remuestreo utilizados. La herramienta verifica el contrato declarado; no inspecciona la imagen ni acredita que se aplicó ese método. No etiquetar una captura comprimida como envolvente lineal si no se conoce y verifica su transformación inversa.

## Separación y resultados pendientes

`development` incluye referencias de ajuste o calibración futura. `held-out` significa reservado para evaluación; no puede aparecer en `tuningReferenceIds`. El verificador rechaza cualquier sujeto, sesión o SHA256 compartido entre ambos roles, aunque cambie el nombre del archivo. Usar identificadores estables con espacio de nombres: todos los fotogramas, recortes, exportaciones y transformaciones de un mismo sujeto o sesión conservan su grupo. Los datos ya utilizados para decidir parámetros pertenecen a desarrollo.

La identidad de sujeto/sesión, el origen físico, los derechos y los métodos son **declaraciones del proveedor**, no autenticación independiente. Los hashes prueban integridad de bytes; no descubren por sí solos imágenes recortadas, identidades renombradas o uso previo oculto. Registrar la partición antes del ajuste y conservar el manifiesto original es responsabilidad del protocolo. La CLI no certifica una partición prospectiva ni anonimiza los originales.

El informe devuelve `externalEvidence: admitted` únicamente cuando todas las referencias declaradas tienen los metadatos exigidos y origen físico; devuelve `incomplete` con los campos pendientes en los demás casos. Los errores de esquema, integridad o separación impiden crear el informe. **En ambos estados válidos** conserva `calibration: pending`, `heldOutEvaluation: pending` y `humanValidation: pending`. Un conjunto completo no equivale a un ajuste realizado, a una comparación aprobada ni a revisión humana. Esta versión no admite nombres o puntuaciones inventadas de revisores ni importa evaluaciones humanas; ese cierre requiere un protocolo y resultados reales aparte.

Como fundamento de las mediciones instrumentales se consultó [AAPM Report 65, _Real-Time B-Mode Ultrasound Quality Control Test Procedures_ (1998)](https://www.aapm.org/pubs/reports/detail.asp?docid=64). Distingue el control cuantitativo del equipo de otras tareas de garantía de calidad; aquí se usa como referencia metodológica histórica. No se trasladan sus cifras a umbrales universales del simulador ni se afirma conformidad con una norma clínica vigente.

La API pura `parseExternalEvidence(unknown)` valida el esquema y `validateExternalEvidence(unknown, archivosVerificados, hashPerfil)` comprueba la separación y los observables. `admitExternalEvidence(manifiesto, salida)` realiza las comprobaciones de disco. Las pruebas en `src/validation/externalEvidence.test.ts` usan exclusivamente datos inventados para comprobar rechazos, integridad y estados pendientes.

`stdGray` es desviación estándar poblacional de píxeles 0–255, con máximo
127,5. No representa desviación muestral ni incertidumbre de la media. Los
originales vacíos se rechazan aunque su hash esté bien declarado.
