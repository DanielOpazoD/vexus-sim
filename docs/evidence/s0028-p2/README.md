# P2 ronda 1 — contrato listo, anotación incompleta

**Pendiente de revisión del propietario. No está lista como anotación continua completa.**
Base local `d5a8fc0`, rama `feat/s0028-p2-20261103`, apilada sobre #329 sin fusionar.
Objetivos 3, 7 y 8. Sólo herramientas/contratos offline: no se instala ni cablea pared,
esqueleto, acústica, GPU, contacto o poses. El default, los activos y la resolución se conservan.
No es validación clínica.

## Qué está acreditado

- `s0028-wall.py` valida persona, affine, registro y mm; tres fronteras ordenadas,
  ausencia NaN/U, procedencia por valor, halos phi/z y no ocupación de campos ajenos.
  Exporta una copia candidata de la reserva P1; comprueba su relectura, partes intactas,
  techo de metadatos y descarga. `s0028-capacity.py` rechaza incluso +1 B torácico.
- Rojo inicial conservado antes del exportador. Ocho pruebas Python incluyen mutaciones
  sintéticas y reexportación real sin TAC. Dos pruebas TS miden ocho fuentes completas
  y rechazan sampler 17 en ECHO y uniforms extra. No hay tests de runtime nuevos.
- El TAC y el origen LAS se verifican contra SHA/affine; las poses contra el bloque
  `ABDOMINAL_POSES` de `ea20fe0`. Los 363 perfiles iniciales coinciden exactamente con
  el diseño; se abren los nueve barridos y sus vecinos z±1,5 mm antes de trazar.
- Tres límites por muestra: exterior/interior de banda gruesa D y cara interna E +2 mm.
  La identidad regional sigue U con hipótesis explícita alba→vaina→oblicuos→intercostales.
  No se identifica músculo por HU. Piel E 1,5 mm; fascias/peritoneo U; Scarpa 0,4 y
  reparto 35/35/30 únicamente E heredadas, sin convertirlos en observación.

## Frontera que impide cerrar la anotación

| Magnitud                           | Diseño inicial | Borrador tras revisión |
| ---------------------------------- | -------------: | ---------------------: |
| Perfiles / pares                   |        363 / 9 |                363 / 9 |
| Sin banda identificable            |             15 |                    116 |
| Salto máximo entre vecinos válidos |           9 mm |              1,6667 mm |

**No es una mejora de continuidad:** disminuye el soporte al excluir bandas que incluyen
costilla o contactos pared-hígado ambiguos. El trazado no conecta a través de U.
Sólo 364 de 92.672 celdas superficiales tienen geometría D local (radio de soporte 1,5 mm);
el resto sigue U. No es una anotación global. Las curvas centrales se muestran sobre
vecinos para cotejo, no son tres trazados independientes.

La visualización del borrador conserva **62 píxeles de conflicto visceral**, cada uno
2,25 mm²: flank 19, portal 32, portalTrunk 2, portalSubcostal 9. Son áreas de diez planos,
no volumen 3D. No se recorta el hígado ni se rellena la zona posterior renal. La
reproyección aproximada a piel y el escaso soporte también requieren resolver el mapeo
superficie-normal antes del runtime. No se otorga aprobación al resto de cada plano.
El negativo de diez anclas se vuelve a calcular: **700 píxeles** de conflicto en esos
mismos diez planos, además de identidad/continuidad no demostradas; sigue rechazado.

## Descarga, memoria y estimación estática

| Recurso                                                     | Borrador parcial medido |
| ----------------------------------------------------------- | ----------------------: |
| Archivos candidatos, incluido perfil abdominal y manifiesto |            20.157.056 B |
| Base compactada recontada                                   |            20.152.271 B |
| Incremento                                                  |                +4.785 B |
| Reserva gzip antes / después                                |         6.999 / 9.944 B |
| Payload pared con halos + centros                           |               757.844 B |
| Reserva de pared contabilizada / restante                   | 2.113.536 / 1.355.692 B |
| Metadatos adicionales contabilizados                        |        1.919 B ≤4.096 B |
| Atlas / reserva RAW / tórax adicionales                     |             0 / 0 / 0 B |

Se comprimen/reabren archivos reales; no se usa la suavidad del prototipo del diseño como
predicción. No es una medición HTTP ni el coste de una anotación completa futura. El pico
Metal no se mide en esta ronda sin runtime. La referencia de aproximadamente 1,68 GB
procede de 319; el techo sigue en 2 GB y la previsión adicional temporal en 16 MB, pendiente
de prueba integrada. La memoria del exportador Python no representa residencia de producto.

`s0028-wall-cost.ts` transforma sólo fuentes externas: lector de tiles, códigos nearest,
guardia U en los cuatro vecinos, halos y proyección EDT, sustituyendo W global en las
consultas existentes. Usa literalmente helpers y techos vigentes de `shaderLimits.test.ts`.
No instala el clasificador regional ni demuestra sus normales, contacto, JIT o pico.

| Programa           | Tokens / ramas P2 estimados | Samplers | Slots |
| ------------------ | --------------------------: | -------: | ----: |
| RAWFIELD           |           1.183.460 / 8.956 |       10 |   136 |
| RAWFIELD_ECHO      |             516.201 / 3.861 |       16 |   137 |
| RAWFIELD_CLASS     |             423.774 / 3.370 |       10 |   136 |
| RAWFIELD_ELEVATION |             423.914 / 3.372 |       15 |   137 |
| RAWFIELD_GRADIENT  |             298.780 / 2.201 |       15 |   138 |
| TRANS_HITS         |             479.482 / 3.921 |        6 |   101 |
| TRANS_HITS_GRID    |             234.307 / 1.949 |       11 |   102 |
| COLOR              |             229.542 / 1.920 |        7 |   110 |

Ocho estimaciones bajo techo, cero samplers nuevos. El caso extra de ECHO=17 falla.
[Mediciones y hashes](measurements.json). El código de producto queda intacto.

## Láminas abiertas y revisión pendiente

Evidencia externa autorizada:
`/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p2/`.

Las diez láminas de `figures/` tienen el ID
`s0028-P2-R1-adjacent-CT-draft-v1`, TAC y propuesta en idénticos puntos físicos, y lista
sí/no sin rellenar. Se abren también `orthogonals.png`, `profiles.png`, `axial-source.png`
y `trace-00` a `trace-08` antes/después: 31 imágenes, hashes en `reviewed-images.json`.
[Acta por ventana](/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/migration-p2/plates.json)
(no sustituye una revisión humana).

Dudas principales: alba/vaina medial; límite interno al contacto con hígado; trayecto
costal y pertenencia intercostal; dirección exacta de interfaces fuera de las líneas
trazadas. Posterior U/P3 e intercostal bloqueada/P8. El propietario debe reconciliar el
trazado y pertenencia sobre los cortes señalados y completar su lista sí/no. Una aceptación
de formato/presupuesto no autoriza cablear esta anotación incompleta o sus conflictos.

## Reanudación y verificación

La entrada es `progress.md` en la evidencia externa, junto a protocolo previo y enmiendas
fechadas con sus negativos. `scripts/prepare.py`, `annotate.py` y `plates.py` reproducen el
borrador desde las fuentes autorizadas; no escriben en el producto. `annotation/annotation.json`
conserva procedencia por valor y referencia al perfil trazado; `continuity.json` conserva controles,
huecos y resultados por par. `package/budget.json` lista archivos reales y SHA256.

Usar Python externo de `vexus-ct-20261101/.venv`, `nice -n 10` y BLAS/OMP/VECLIB a un hilo.
Exportación: `tools/workspace/run.sh "$PY" -B tools/anatomy/s0028-wall.py --annotation "$E/annotation" --baseline src/anatomy/s0028 --out "$E/package"`.
Coste: `tools/workspace/run.sh node --import tsx tools/anatomy/s0028-wall-cost.ts "$E"`.
No ejecutar estos dos a la vez con las pruebas/build.

Cierre local serial y códigos de salida: `checks.json` y `logs/` en la evidencia externa,
sobre el commit final indicado en `progress.md`. Se ejecutan formato, índice, lint, tipos,
suite rápida con `--maxWorkers=1`, contratos Python, build y check completo secuencial.
No se atribuye CI, deploy, prueba Metal nueva ni validación clínica. Sin delegación,
push, PR, stash, gh ni uso del puerto 5174.
