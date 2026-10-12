# Revisión de la misma sección física TAC–US

**Contrato.** Conservar centros de voxel, dimensiones y procedencia. Se remuestrea
el TAC sobre el plano US mediante una inicialización rígida explícita. La figura
sirve para refutar alineaciones incorrectas, no para aceptar automáticamente un
registro ni para convertir HU en señal ecográfica.

```sh
python -m pip install -r tools/anatomy/paired-renal-review-requirements.txt
python tools/anatomy/paired_renal_reslice.py plane-manifest.json --output review-plane
python tools/anatomy/paired_renal_plot.py review-plane --output review-plane.png
```

El manifiesto enlaza los artefactos de admisión y registro por contenido:

```json
{
  "schemaVersion": 1,
  "sourceManifest": { "path": "pair-manifest.json", "sha256": "HASH_MANIFIESTO_PAREJA" },
  "admission": { "path": "admission.json", "sha256": "HASH_ADMISION" },
  "registration": { "path": "registration.json", "sha256": "HASH_REGISTRO" },
  "axis": 2,
  "index": 434
}
```

Los índices son base0, en la rejilla original US. `axis` no significa axial,
coronal o sagital del paciente. La salida nueva contiene `plane.npz` con US
original, TAC lineal y máscara de soporte, y `plane.json` con mm/pixel, hashes,
plano, fracción válida y errores de registro. Fuera del soporte TAC es NaN,
representado en violeta; no se interpreta como líquido, sombra ni aire.
La ventana de intensidad TAC es configurable con `--ct-low` / `--ct-high`.
No se ecualizan imágenes ni se ajustan tamaños para mejorar la similitud.
Se admiten planos oblicuos con ejes ortogonales. Una rejilla US con cizalla
se rechaza para no dibujar ángulos físicos falsos como píxeles rectangulares.

## Circuito de evaluación

1. Admitir la pareja y reservar un paciente distinto antes de ajustar.
2. Registrar con hitos separados de la evaluación; revisar TRE y errores por hito.
3. Elegir plano por coordenada/hito y guardar también vecinos, con todos sus índices.
4. Revisar cápsula, seno, polos y relaciones posteriores. Registrar desacuerdos y
   atribuirlos a registro, anotación, plano, compresión o modelo solo con evidencia.
5. Cambiar una causa concreta; repetir la misma adquisición y los controles.
6. Evaluar el paciente reservado después de congelar decisiones, sin reutilizarlo
   para ajustar. Nuevas dudas reabren el contrato.

## Límites

La figura es un corte reconstruido de un volumen, no un cine de movimiento del
transductor ni un ciclo respiratorio. Un rígido puede fallar por postura o presión.
Los gráficos del equipo dentro del US deben excluirse antes de medir textura.
La ausencia de máscara no autoriza inventar un contorno renal. No se instala esta
referencia en el runtime ni se declara fidelidad clínica. Datos y permisos siguen
el contrato de [admisión](paired-renal-reference.md), con fuentes
[TRUSTED](https://www.nature.com/articles/s41597-025-04467-1).
