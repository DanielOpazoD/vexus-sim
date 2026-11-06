# PR #336: correcciones de la revisión independiente de P3 r3

Base del arreglo: `b0a174d53ae714aa2ca9201a827c928482198680`. Referencia por defecto: `d761509`.
La corrección sólo cambia la selección de tramos de la tabla rígida s0028. Una pareja renal debe cruzar Z para activar
la reserva; L acaba en su salida, sin abarcar otro riñón posterior. El alcance del flanco baja de 303 a 175,5 mm.
No modifica anatomía, poses, presupuestos, plazos ni tolerancias. No es validación clínica.

## Movimiento antes/después

Cada terna corresponde a D = **0 / 10 / 20 mm** de excursión respiratoria E. Se mide el desplazamiento máximo **por
compresión**, no el respiratorio; riñón p95 es |∂s/∂r|, adimensional (0: traslación radial rígida).
129 líneas de todo el sector, 0–320 mm a 0,5 mm, mismo dominio antes y después; vértebra a d < −0,5 mm bajo la cara
interna de la pared; riñón a d < −1,5 mm. «—» significa sin muestras renales en ese sector, no ausencia del órgano.
[Datos completos, con recuentos y todo el hueso](review-fixes-motion.json).

| Ventana         | Vértebra antes (mm)         | Vértebra después (mm) | Riñón antes (mm)            | Riñón después (mm)       | Riñón p95 después  |
| --------------- | --------------------------- | --------------------- | --------------------------- | ------------------------ | ------------------ |
| subxiphoid      | 0 / 0 / 0                   | 0 / 0 / 0             | — / — / —                   | — / — / —                | — / — / —          |
| epigastric      | 0 / 0 / 0                   | 0 / 0 / 0             | 0,0295 / — / —              | 0,0295 / — / —           | 0 / — / —          |
| intercostal     | 0 / 0 / 0                   | 0 / 0 / 0             | — / — / —                   | — / — / —                | — / — / —          |
| subcostal       | 0 / 0 / 0                   | 0 / 0 / 0             | 5,7609 / 5,7051 / 5,7051    | 5,7609 / 5,7051 / 5,7051 | 0 / 0 / 0          |
| flank           | 11,0824 / 11,0824 / 11,0824 | 0 / 0,0127 / 0,0038   | 11,0824 / 11,0824 / 11,0824 | 6,5011 / 6,5011 / 0      | 0 / 0 / 0          |
| portal          | 0 / 0 / 0                   | 0 / 0 / 0             | — / — / —                   | — / — / —                | — / — / —          |
| portalTrunk     | 0 / 0 / 0                   | 0 / 0 / 0             | 0,939 / 0,939 / 0,939       | 0,939 / 0,939 / 0,939    | 0 / 0 / 0          |
| renal           | 0 / 0 / 0                   | 0 / 0 / 0             | 8,2386 / 9,1321 / 10,094    | 8,2386 / 9,1321 / 10,094 | 0 / 0,29 / 0,349   |
| hepatorenal     | 0 / 0 / 0                   | 0 / 0 / 0             | 6,7621 / 6,7621 / 6,7621    | 6,7621 / 6,7621 / 6,7621 | 0 / 0,103 / 0,2226 |
| portalSubcostal | 0 / 0 / 0                   | 0 / 0 / 0             | — / — / —                   | — / — / —                | — / — / —          |

En apnea, las diez ventanas muestreadas dan cero en vértebras; con respiración el flanco conserva residuos por
compresión de 0,0127/0,0038 mm. El test exige ≤ 0,05 mm. Costillas/cartílagos de intercostal y portal que acompañan
la pared conservan su excepción P8 (≤ 19,4 mm en main); también se muestrean y se acotan, sin presentarlos como quietos.
La afirmación anterior de cero provenía de una rejilla cartesiana de ±100 mm que no alcanzaba L2 en el borde profundo.
Los 5,8 mm publicados en esa rejilla a D = 10 eran B1, no una medida del movimiento respiratorio.

## Regresiones y alcance

- B1: dos pruebas rojas con el cuerpo de `compression.ts` de `b0a174d` y verdes corregidas: sector completo en las diez
  ventanas con D = 0/10/20, y reserva limitada al tramo que cruza. En el negativo L era 100 mm frente a los 30 mm exigidos.
- I1: se conservan los 119 testigos originales; se añaden 40 del quiste E y 29 de grasa D + banda P2 en la sub-banda
  de grasa (`q.w < q.x`). Esas filas exigen paridad exacta y al menos 20 muestras. Las cinco clases P3 agregadas en
  apnea exigen más de 30 muestras y ≥ 99 % de paridad, siempre. La e2e registra el renderer real.
- I2/P4/P7: el peso respiratorio sigue usando el cilindro de la otra persona, (0, −60), r = 17 mm. Pesos medios
  L1–L5 0,17/0,38/0,52/0,56/0,31; flanco 0,77–0,92 en la revisión. Este movimiento persiste sin presión y no se corrige.
- I3/P4: la tabla sigue calculada en apnea. El nuevo sector mide p95 renal 0/0,2900/0,3490; la rejilla cartesiana histórica
  da 0,3440/0,3498 a D = 10/20 tras B1, prácticamente igual a 0,34/0,35 antes. No se corrige en esta PR.
- M1: la guarda del instalador comprueba `x + 32 <= W`, con W real del atlas (189).
- M2: se conserva `s28R` y se documenta que `compressionSpline` debe escribirla antes del perfil de la misma línea.
- M3: los vasos procedurales aún entran por orden de evaluación en hígado, páncreas, grasa D y puntos sin dueño (P5).

## Verificación de esta corrección

38/38 programas GLSL por defecto iguales a `d761509`. Igualdad exacta en 82.251 clasificaciones, diez marcos y treinta
contactos por defecto. Metal real: ANGLE Metal Renderer, Apple M4. La e2e base pasa (40/40 quiste E y 29/29 grasa +
banda); `quiste-U` muere con 0/40 y `grasa-en-banda-sin-conflicto` con 0/29, por esas aserciones. `grasa-ignora-vasos`
sobrevivió en la revisión con efecto nulo; se anota sin atribuirle una muerte nueva. Los catorce mutantes históricos
no se vuelven a ejecutar en esta ronda.

JS 1.069.860 / 1.070.080 B: margen **220 B**, coste neto del arreglo **5 B**. Descarga s0028 20.433.526 / 25.000.000 B;
metadatos 3.788 / 4.096 B. Sin subir techos. M2 sólo añade un comentario TS (0 B de JS).

Se regeneran las dieciséis láminas originales y una lámina radial antes/después del flanco, con casillas de revisión
sin rellenar. Sólo cambia la tabla/contacto del flanco; los otros nueve contactos son idénticos byte a byte en JSON.
La clasificación material CPU/GPU permanece igual; la lámina radial extiende la vista al borde profundo que faltaba.
[Láminas y lista del propietario](../INDEX.md#migration-p3-r3-review-fixes-review-html).
Verificación dirigida aprobada: prettier, docs-index, lint, typecheck, 24 archivos/150 pruebas (s0028, compression,
shaderLimits y twinRegistry), calibración y build con sus presupuestos. Las 17 imágenes están abiertas y registradas
por SHA-256; sus casillas no equivalen a aceptación del propietario.

Evidencia local: [`migration-p3-r3/review-fixes/`](../INDEX.md#migration-p3-r3-review-fixes).
La CI protegida «CI verde (check + e2e)» del nuevo SHA sigue siendo la puerta. No se ejecuta otro cierre serial completo.
