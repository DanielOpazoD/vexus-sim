# P5 r1 offline: índice de evidencia (323)

Pendiente del propietario. Evidencia externa en la carpeta versionada `migration-p5-r1`; todas las rutas de
este índice son relativas a ella. Los TAC, máscaras, paquete y láminas permanecen fuera de Git. No hay runtime
nuevo ni validación clínica. [Método y reproducción](../../anatomia/s0028-vascular-offline.md).

## Paquete y medidas

Paquete **188.469 B**; base **20.433.526 B**; total hipotético
**20.621.995/25.000.000 B**. El soporte auditable cuenta dentro del presupuesto.
2.067 nodos y 2.148 aristas en el binario; diez caminos U adicionales contienen 60 muestras (incluyen extremos
duplicados). Los diámetros siguientes son EDT inscritos, no diámetros clínicos. D/U por nodo indica familia;
la identidad exacta permanece U salvo aorta. Longitudes incluyen escalones/espículas.

| Grupo                               | Identidad exacta | Familia D/U (nodos) | Diámetro min–media–máx (mm) | Nodos | Longitud (mm) |
| ----------------------------------- | ---------------- | ------------------- | --------------------------- | ----- | ------------- |
| VCI                                 | U                | 136/0               | 10.50–14.59–21.35           | 136   | 235.75        |
| Aorta abdominal                     | D                | 132/0               | 8.45–13.50–18.40            | 132   | 222.78        |
| Porta/esplénica conjunta            | U                | 149/0               | 1.50–6.23–13.20             | 149   | 292.31        |
| Hepáticas a cava (2 componentes)    | U                | 118/79              | 1.50–1.71–2.74              | 197   | 424.97        |
| Ramas a porta (8 componentes)       | U                | 376/201             | 1.50–1.61–3.70              | 577   | 1191.03       |
| Hepáticas sin raíz (23 componentes) | U                | 0/429               | 1.50–1.57–2.74              | 429   | 865.48        |
| Renales candidatas (3 componentes)  | U                | 0/447               | 1.50–1.82–6.99              | 447   | 1123.66       |

VCI: identidad de sistema derivada, partición `ivcInfra/ivcSupra` U. Porta/esplénica: fuente conjunta sin
partición ni orientación. Hepáticas/renales: geometría y radio U; conectividad no demuestra nombres.
El detalle de cada componente está en [measurements.json](measurements.json).

Hígado: 7.802 vóxeles candidatos; 4.822 retenidos y 2.980 pequeños fuera del grafo. Renal: 7.768 candidatos,
2.014 retenidos; los 5.754 restantes son componentes pequeñas o sin contacto renal. Ninguna componente de las
máscaras retenidas desaparece completamente al esqueletizar este caso (el negativo sintético sí lo detecta).

## Diez láminas abiertas

Cada PNG fue abierto con `view_image`; recibo `opened-plates.json`. Cinco paneles: TAC, candidato reabierto,
procedural vigente en el plano s0028, diferencia, modelo antiguo en su propia ventana. Cuatro casillas sí/no
siguen vacías en cada PNG y en `plates-final/OWNER-CHECKLIST.md`. No se ajustaron poses.

| Ventana         | Archivo externo                    | Candidato / procedural (px) | U candidato (px) |
| --------------- | ---------------------------------- | --------------------------- | ---------------- |
| subxiphoid      | `plates-final/subxiphoid.png`      | 1945 / 7318                 | 275              |
| epigastric      | `plates-final/epigastric.png`      | 1453 / 1675                 | 681              |
| intercostal     | `plates-final/intercostal.png`     | 625 / 1381                  | 34               |
| subcostal       | `plates-final/subcostal.png`       | 1698 / 2362                 | 236              |
| flank           | `plates-final/flank.png`           | 4387 / 4757                 | 805              |
| portal          | `plates-final/portal.png`          | 0 / 1202                    | 0                |
| portalTrunk     | `plates-final/portalTrunk.png`     | 2544 / 5440                 | 1216             |
| renal           | `plates-final/renal.png`           | 103 / 604                   | 103              |
| hepatorenal     | `plates-final/hepatorenal.png`     | 118 / 334                   | 118              |
| portalSubcostal | `plates-final/portalSubcostal.png` | 2250 / 3027                 | 715              |

**Hallazgo visible:** `portal` no corta el grafo candidato (0 px); esto no demuestra ausencia de vasos en la
persona. Las ramas hepáticas quedan escasas/dispersas, no tres suprahepáticas identificadas. Las ventanas renal
y hepatorrenal carecen de un árbol renal identificado. La forma circular reconstruida no reproduce toda la
sección de las máscaras; las comparaciones por plano (`sourceComparison`) son descriptivas, no aceptación.
El panel antiguo conserva su otra persona y sólo sirve de comparación.

## Verificación y límites

Contrato Python: 16 pruebas; láminas: 5. Dos rondas independientes encontraron seis defectos, conservados en
logs rojos y corregidos. Tercera ronda: 4 positivos/16 inversiones de flujo y 2 positivos/10 huecos/12 radios
alterados, sin hallazgos en esas correcciones. Sin CT ni runtime en la revisión independiente.

Formato, índice, lint, tipos, build/presupuestos y 46 focales rápidas (5 archivos) pasan. `npm run check`
serial **rojo**: 301 archivos aprobados, 2.101 pruebas aprobadas + 15 fallos esperados y un timeout de 180 s en
`wallDisplayTwin.test.ts:257` (190,7 s, durante carga de cinco minutos ≈49). La fase matrix no llegó a ejecutarse.
No se cambian plazos ni se presenta este resultado como aceptación. Los archivos permanecieron iguales durante
los 1.913,6 s del check. CI y aceptación del propietario pendientes.

Las verificaciones se registran en `validation.json`, `full-check.log`, `full-check-core.json` y `progress.md` externos.
El índice [artifact-index.json](artifact-index.json) fija tamaños y hashes de fuente derivada y láminas.
No se declara equivalencia PW, GPU, aceptación visual del propietario ni clínica. Falta chunk s0028 (322.3),
lectores/adaptador CPU/Worker/GLSL, revisión de U/poses, uniones, colisiones y techos existentes sin aumentarlos.
