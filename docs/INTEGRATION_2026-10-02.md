# Integración de PR abiertos — 2 de octubre de 2026

## Alcance y estado

Base remota inventariada: `a3a5b1a492d13bd76952d942377915ac2fac4c88`.
Rama: `chore/integrate-open-prs-20261002`. Los estados de esta tabla son los del inventario inicial, no una afirmación de fusión a main. La fusión requiere el veredicto CI sobre el árbol combinado final; el PR de integración enlaza la ejecución exacta.

Se preservan las ramas fuente y sus SHA. PR142 y la futura `feat/hepatic-boundary-separation` están excluidos. No se retargetea PR142 ni se modifica su base `feat/gallbladder-interface-normals`. No se crean tags, releases ni despliegues.

## Inventario y dependencias

| PR                                                         | Head inventariado                          | Base inventariada                    | Tratamiento                                                                     |
| ---------------------------------------------------------- | ------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------- |
| [#119](https://github.com/DanielOpazoD/vexus-sim/pull/119) | `bd35838bed6201ce38eaca5ce23948f712290120` | `main`                               | Pendiente: geometría segmentada y discos no equivalentes a PR139.               |
| [#120](https://github.com/DanielOpazoD/vexus-sim/pull/120) | `6eb4113d4bfcc2c47922567d6a22913c9054212b` | `main`                               | Recuperado por PR127; equivalencia de contenido auditada, sin ancestry directo. |
| [#121](https://github.com/DanielOpazoD/vexus-sim/pull/121) | `f7d584a584c814d4f6bc5166203db7a0229d2ab5` | `main`                               | Head completo incluido por ancestry en la rama de integración.                  |
| [#122](https://github.com/DanielOpazoD/vexus-sim/pull/122) | `ec42df509155acd7788057cb831937d5ed242538` | `main`                               | Head completo incluido por ancestry en la rama de integración.                  |
| [#123](https://github.com/DanielOpazoD/vexus-sim/pull/123) | `e405d6d751bf05457dc0c92a8d3ea8a793dbfd47` | `main`                               | Bloqueado: TypeScript 7 fuera del peer admitido por typescript-eslint.          |
| [#124](https://github.com/DanielOpazoD/vexus-sim/pull/124) | `5f370d659d1921b381217a02688081379f5e6435` | `main`                               | Head completo incluido por ancestry en la rama de integración.                  |
| [#125](https://github.com/DanielOpazoD/vexus-sim/pull/125) | `9682afd3f31914b0e883fda9d8634b5c0b592db8` | `main`                               | Head completo incluido por ancestry en la rama de integración.                  |
| [#126](https://github.com/DanielOpazoD/vexus-sim/pull/126) | `070e40646d7e41ee2d593e21859df0320da2f945` | `fix/mmode-measurement-contract`     | Head completo incluido por ancestry en la rama de integración.                  |
| [#127](https://github.com/DanielOpazoD/vexus-sim/pull/127) | `39f93b8ffd672dfdfa87a0a841d37f7d81fff7ca` | `perf/defer-pw-measurement`          | Head completo incluido por ancestry en la rama de integración.                  |
| [#128](https://github.com/DanielOpazoD/vexus-sim/pull/128) | `748a2cb875f9a54ea08d270ff5febb271bf17bcf` | `fix/recover-doppler-capture`        | Head completo incluido por ancestry en la rama de integración.                  |
| [#129](https://github.com/DanielOpazoD/vexus-sim/pull/129) | `70001ee567b85be4a0abcc8c078e504087c6ce45` | `feat/respiration-controls`          | Head completo incluido por ancestry en la rama de integración.                  |
| [#130](https://github.com/DanielOpazoD/vexus-sim/pull/130) | `2128d82c924b5491788e1e429b4854d6a21ae135` | `feat/shared-costal-geometry`        | Head completo incluido por ancestry en la rama de integración.                  |
| [#131](https://github.com/DanielOpazoD/vexus-sim/pull/131) | `9b16d35d1fbb177633bcb25423744f9939ed4e4d` | `feat/costal-registration`           | Head completo incluido por ancestry en la rama de integración.                  |
| [#132](https://github.com/DanielOpazoD/vexus-sim/pull/132) | `75920194a520b29ef4f0827506e2d0129c44f26c` | `feat/reference-torso`               | Head completo incluido por ancestry en la rama de integración.                  |
| [#133](https://github.com/DanielOpazoD/vexus-sim/pull/133) | `f2dde840f343b67d5d93ca575b4a7c68056acccc` | `feat/reference-diaphragm-boundary`  | Head completo incluido por ancestry en la rama de integración.                  |
| [#134](https://github.com/DanielOpazoD/vexus-sim/pull/134) | `5a41284e59d8552ed63a7aaee55745762e310ab1` | `feat/reference-diaphragm-boundary`  | Head completo incluido por ancestry en la rama de integración.                  |
| [#135](https://github.com/DanielOpazoD/vexus-sim/pull/135) | `551b4212ee91845341a3b58e802e93c30ea6b3be` | `feat/reference-diaphragm-boundary`  | Head completo incluido por ancestry en la rama de integración.                  |
| [#136](https://github.com/DanielOpazoD/vexus-sim/pull/136) | `4e8e9d612aeed7a1c902feb735074b42fe94d667` | `test/vascular-junction-integrity`   | Head completo incluido por ancestry en la rama de integración.                  |
| [#137](https://github.com/DanielOpazoD/vexus-sim/pull/137) | `18d9030b79a21e6637346770107fc0f240064644` | `fix/speckle-simulation-time`        | Head completo incluido por ancestry en la rama de integración.                  |
| [#139](https://github.com/DanielOpazoD/vexus-sim/pull/139) | `caa84d77f18fd483cf4fe5e3cdb39fcf38f685e4` | `feat/anatomical-bowel-loops`        | Head completo incluido por ancestry en la rama de integración.                  |
| [#141](https://github.com/DanielOpazoD/vexus-sim/pull/141) | `9d55e9c1a11fb0a7a9b3bf3843e60f63d5250319` | `feat/vertebral-cortical-echo`       | Head completo incluido por ancestry en la rama de integración.                  |
| [#142](https://github.com/DanielOpazoD/vexus-sim/pull/142) | `5c332ab9a8c35ee5525f6f54d5e424fbcb8e226f` | `feat/gallbladder-interface-normals` | Excluido por coordinación; no modificar.                                        |

Orden topológico verificado con el grafo Git:

```text
main → 125 → 126 → 127 → 128 → 129 → 130 → 131 → 132
                                                   ├→ 133
                                                   ├→ 135 → 136
                                                   └→ 134 → 137(+138) → 139(+140) → 141
main → 121 / 122 / 124
main → 119 / 120 / 123 (evaluados por separado)
141 → 142 (excluido)
```

PR138 ya se fusionó en 137 mediante `18d9030b79a21e6637346770107fc0f240064644`; PR140 en 139 mediante `caa84d77f18fd483cf4fe5e3cdb39fcf38f685e4`. Esos merges no significaban integración previa en main.

## Resoluciones

- La cadena 125–141 conserva todos sus commits, incluidos 138 y 140. Se combinan 133,135 y136 mediante merges normales; no se selecciona un lado entero para resolver contenido.
- PR133 conserva el banco costocondral offline y la estabilidad del botón de reinicio docente. PR135 conserva las15 uniones vasculares verificadas. PR136 conserva el transporte material de facetas y su prueba WebGL junto a las corticales nuevas.
- PR121,122 y124 conservan sus commits de dependencias. PR123 falla `npm ci`: TypeScript 7.0.2 no satisface `typescript-eslint@8.70.1`, cuyo peer exige `>=4.8.4 <6.1.0`. No se usa `--force`, `--legacy-peer-deps` ni se desactiva lint.
- PR120 se evalúa por contenido, no por título ni alcance aparente. La recuperación `8ded6701a6e758e1eb5ce7e67ccbd65dcb89ed6a` y correcciones posteriores preservan captura, calidad, identidad, trazado y pruebas. Véase [la auditoría de preservación](PR119_PR120_PRESERVATION.md). Su aumento antiguo del chunk principal a 343 KiB no se recupera.
- PR119 contiene geometría vertebral segmentada y discos que PR139 no recupera. No debe cerrarse como integrado mientras esos aportes no estén preservados y validados.
- Se corrigen filtros de comparadores que nombraban archivos E2E inexistentes y se añade su helper compartido de captura a los filtros.

## Gates y evidencia

La integración mantiene umbrales de cobertura 88/83/84/89, los 12 fallos esperados históricos y la detección de pruebas inestables. El gate requerido sigue siendo «CI verde (check + e2e)» y exige check y los cinco fragmentos E2E. El volumen TS/GLSL mantiene 50 000 puntos por caso y acuerdo exacto; no se reduce precisión ni muestreo.

Se conservan los límites vigentes del stack: 335 KiB para la raíz, 700 KiB para three, 120 KiB para otros chunks y 1024 KiB para todo JS. El contador total ahora incluye testHooks y worklets recursivamente. El contador antiguo de main excluía testHooks y solo contaba assets, con 1000 KiB; se verifican ambas definiciones para evitar una comparación engañosa. No se amplían límites para esta integración.

DECISIONS conserva 1..105 y el índice generado. Los documentos CLOUD_HANDOFF, TORSO_PROGRESS y los estados WIP de decisiones previas describen su momento histórico; no acreditan por sí solos la validación del árbol integrado. El torso de referencia sigue siendo opt-in y sus limitaciones anatómicas continúan vigentes.

Los resultados físicos y visuales son de un simulador con parámetros estimados. Una comparación visual verde no valida clínicamente el modelo. SwiftShader ejecuta GLSL por software y no acredita rendimiento de GPU física. Las referencias clínicas privadas no se añaden al repositorio.

Las ejecuciones, SHA de fusión y cierres posteriores se registran en el PR de integración tras obtener resultados; no se anticipan resultados pendientes.
