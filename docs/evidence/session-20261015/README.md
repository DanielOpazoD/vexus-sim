# Evidencias del cierre funcional del 15 de octubre de 2026

El [manifiesto](manifest.json) conserva resultados pequeños, enlaces a CI/PR, condiciones y hashes
SHA-256 de 51 artefactos seleccionados. Es un índice de la evidencia retenida; no una firma del
proveedor ni una nueva ejecución de las pruebas. Los originales permanecen fuera del repo.

Las rutas del manifiesto parten de la carpeta de sesión que contiene `work/` y `outputs/`, no de
este directorio. En este Mac se accede desde `README.md` de la sesión; un clon independiente puede
carecer de esos archivos. Para trasladarlos, copiar los grupos de evidencia preservando sus rutas y
cotejar bytes/SHA-256. No copiar credenciales, perfiles del navegador ni `node_modules`.

| Grupo local                   | Clasificación y uso                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| `work/continuidad`            | Traspaso inicial y estado operativo superado; conservar como historia                |
| `work/renal-iteration`        | Relación renal/grasa/fascia/músculo integrada por entregas posteriores               |
| `work/startup-two-views`      | Diagnóstico histórico del arranque; cierre funcional en PR254                        |
| `work/free-probe-motion`      | Navegación libre y su evidencia de integración en PR254                              |
| `work/continuous-cut-latency` | Cierre de PR255 más negativos, interrupciones y experimentos identificados abajo     |
| `outputs/`                    | Capturas finales y referencias históricas; no acreditan disponibilidad de servidores |

## Lectura del último grupo

- **Aceptado:** `DELIVERY_STATUS.json`, informes finales Metal/SwiftShader `7539a31`, verificación
  de los doce informes originales de CI y sus sellos de procedencia, check con salida cero,
  `comparison-single.json` y `continuous-tour-proof.json`.
- **Medición anterior:** `comparison.json` y `baseline-including-relocation.json`. Condiciones
  diferentes del cierre: otra página adquiría o se incluía el salto entre coordenadas. No mezclarlas.
- **Negativo:** fallo angular de CI `a8df3b5` y timeout SwiftShader local bajo cinco referencias
  congeladas. Conservar informes, diagnósticos y trazas completas asociadas.
- **Interrumpido:** comparación aislada del candidato. No es una aprobación ni un fallo resuelto.
- **Exploratorio/inválido:** perfil HUD, arnés sin `lift` y configuración con error de importación.
  No prueban una causa de rendimiento ni un defecto del modelo.
- **Fuente de medición:** `measure-single-view.mjs`, `measure-registered.mjs`, `measure.mjs` y
  `PLAN.md`. Son los arneses originales de la entrega, conservados junto a sus salidas. Las antiguas
  configuraciones absolutas son parte del registro; para nuevas E2E usar el runner portable.
- **Preservado:** `preserved-untracked/` contiene copias idénticas de dos archivos hallados sin
  seguimiento. No forman parte del código activo ni deben descubrirse como nuevas pruebas.

`ACTIVE_STATUS.json` es ahora un puntero corto al cierre y a la pausa vigente. Su versión anterior,
con tareas ya realizadas, se conserva en `history/ACTIVE_STATUS.before-workspace-cleanup-20261016.json`.
`DELIVERY_STATUS.json` sigue intacto y fechado: su campo preview describe la captura del cierre,
no el estado actual del servidor.

El inventario local `work/EVIDENCE_INDEX.json` resume archivos y bytes de los cinco grupos. No se
ha borrado, movido ni caducado evidencia en esta limpieza. Antes de eliminar originales o builds,
definir conservación, comprobar referencias y mantener una copia verificable.
