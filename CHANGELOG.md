# Historial de cambios

Formato de [Keep a Changelog](https://keepachangelog.com/es/1.1.0/); versiones semánticas. Los
detalles de cada decisión están en `docs/DECISIONS.md` (número entre paréntesis).

## [Sin publicar]

### Corregido

- El volumen de muestra PW perdía la sangre tras la primera inspiración y no la recuperaba aunque el vaso siguiera en la puerta (tronco portal con respiración tranquila: 0 % de sangre frente al 95 % real; PF medida 167 % en el sano y 136 % en el grave). La comprobación de salida de la caja y la resiembra usaban dos desplazamientos respiratorios distintos. Ahora PF 20 % y 73 % (verdad 19 % y 63 %).
- El color y el PW mostraban flujo con la sonda separada de la piel (modo B en negro; antipatrón §23 de la guía): la transmisión de la puerta (`app/gateTransmission.ts`) y la pasada de color multiplican ahora por el acoplamiento de su línea, como el modo B. Con la sonda levantada 10 mm: 0 celdas de color y el espectro en el nivel del ruido.

## [0.5.0] — 2026-09-22 — bases estructurales (plan de fases 0–3 tras la evaluación 3,8/7; decisiones 41–47)

### Añadido

- Producto (Fase 3): versión y commit visibles en la barra y en el diagnóstico exportable (versión, navegador, GPU, caso, equipo, fps, tiempo de GPU y últimos errores, sin datos del usuario); release por tag (`.github/workflows/release.yml`) con las notas de esta sección; e2e en paralelo y con la duración de cada prueba en el log de CI.
- Guarda de fidelidad de imagen: la e2e mide la SNR de la envolvente en parénquima hepático (parches 16 × 8 lejos de interfaces) y exige la de Rayleigh (1,6–2,25); detectar intensidad o sumar magnitudes antes del haz la hacen fallar (1,11 y 6,18).
- Grafo de pasadas del renderer (`ultrasound/passGraph.ts`), validado como grafo (orden, escritor único, sin pasadas muertas); tiempo de GPU del cuadro, y por pasada donde el navegador lo separa (en WebKit/Metal cada consulta devuelve el cuadro entero y no se publica por pasada), en la pestaña Docente y en el diagnóstico (47).
- Documentación para incorporar a un equipo: `CLAUDE.md` (invariantes que se rompen fácil), `docs/GLOSSARY.md`, `docs/TESTING.md`, plantilla de decisión en `CONTRIBUTING.md`; afirmaciones obsoletas corregidas y el «Estado» del README atado a la versión. ESLint con reglas tipadas, Dependabot semanal (versiones mayores por separado) y hook de pre-push.
- Cortina pulmonar con líneas A (signo de la cortina) que baja con la inspiración; cápsula y pelvis renales; pirámides discretas con columnas de Bertin (43).
- Segmentos de Couinaud derivados de los planos de las suprahepáticas, la fisura umbilical y el plano portal; hígado 3D translúcido coloreado por segmento con rótulos I–VIII; lámina del ligamento venoso (`LigamentumVenosum`) en el modelo acústico y en el corte (42).

### Cambiado

- Anatomía de una sola fuente (Fase 2): esquema único de uniforms (`anatomy/gpu/sceneUniforms.ts`), del que salen las declaraciones GLSL y la subida desde el renderer (45); la anatomía es dueña de su gemelo GPU (`anatomy/gpu/`) y los órganos viven en módulos con gemelos TS/GLSL del mismo nombre y constantes generadas (`anatomy/organs/`: ligamentos hepáticos, cortina pulmonar, riñón, vesícula e hígado; las funciones solo-GPU se declaran con su motivo); equivalencia volumétrica exacta en 50 000 puntos por caso en la e2e (46).
- Modelo de dominio (Fase 1): `VESSEL_META` sustituye a los `startsWith('ivc')`; registro de casos de una sola fuente; la cadena PW recibe un `AudioSink`; matriz completa de dependencias entre capas; estado del ecógrafo inmutable (`EquipmentController`) que solo cambia por comandos con invariantes físicas (puerta, caja y foco dentro de la imagen, PRF ≤ c/2d); `SimulationSession` y `main.ts` como raíz de composición (450 → 319 líneas) con controladores de UI puros; `TransducerProfile` reúne geometría, haz y frecuencias efectivas.
- Rendimiento: carga inicial 760 → 179 kB de JS (navegador 3D y ganchos de prueba con `import()` dinámico). El cambio de caso ya no recompila nada: el `UltrasoundRenderer` pasa al simulador nuevo con `setScene` y el navegador 3D libera los grupos anteriores tras el primer render con los nuevos (three.js recompilaba 5 de 10 programas). Con SwiftShader, parte síncrona 1 750 → 178 ms y cambio completo ≈ 1,7 → 0,3 s.
- Interfaz hígado–riñón sin hueco (cápsula hepática → grasa de Gerota → cápsula renal); pared periportal proporcional al calibre; pared blanda que conserva el acoplamiento al bascular en el epigastrio; punto de partida renal en eje largo (43).
- Vesícula en pera con base propia, afilamiento fondo→cuello, pared ecogénica de 1,5 mm y fosa; la porción umbilical de la porta izquierda termina bajo la fisura umbilical (receso de Rex) (41). Se retira la limitación `axis-aligned-gallbladder`.
- Pestaña «Adquirir» con los mandos básicos de imagen (profundidad, ganancia, foco); profundidad por defecto 18 cm. Costillas con oblicuidad creciente hacia abajo (`ribTiltMm`), misma ley en el SDF y en el 3D.
- Dependencias: Vitest 5, ESLint 10 (con `@eslint/js` 10 y `globals` 17) y Vite 8 (Rolldown: `codeSplitting.groups` en lugar de `manualChunks`), cada una en su PR. TypeScript 7 queda fuera: `typescript-eslint` exige TypeScript < 6.1.

### Corregido

- El intestino (el «resto» de la clasificación) devolvía una distancia a la frontera fija de 5 mm en TS y GLSL: el gate volumétrico daba por interior un punto pegado al diafragma que float32 clasificaba al otro lado (flaky en CI). Ahora es la distancia a las interfaces que ganan antes.
- La e2e «cambia de caso y el HUD lo refleja» fallaba en CI porque el primer cuadro tras el cambio superaba 15 s (recompilación de shaders propios y de three.js); además, si el HUD no cambia, la prueba informa caso, selector, avisos y errores.
- Pruebas por propiedades (fast-check) sobre todo el dominio de pacientes coherentes: hallaron una VCI colapsada que daba 288 m/s → resistor de Starling (R ∝ 1/A² bajo 8 mm, integración implícita) y lumen residual de 3 mm; dos contraejemplos extremos quedan como `it.fails` de las limitaciones `prescribed-ra-contour` y `no-thoracic-waterfall`. Límites del shader derivados de las constantes con prueba de margen. Cobertura de todos los niveles con umbrales en CI. La e2e de medición exige un valor numérico.
- La medición del alumno (pestaña Medir) confundía picos de ruido con ondas: el caso sano salía «leve» y la FA «grave». Envolvente por percentil de la banda contigua con espectro promediado, extremos robustos, vena interlobar leída en su lado y «S invertida» solo si el retrógrado alcanza el 50 % del pico; prueba de la cadena completa del alumno para los 3 casos y los 3 territorios (44).
- Fallos silenciosos: registro de errores único (`errorLog`, visible en Docente) con manejadores globales; el Worker del corte informa sus errores y se reinicia; el audio se activa de forma transaccional; el cambio de caso es transaccional; el bucle se recupera tras errores repetidos; guardia `NonFiniteStateError` en el motor fisiológico; e2e de pérdida y recuperación del contexto WebGL.
- La equivalencia TS ↔ GLSL solo se comprobaba a mano en la pestaña Docente: ahora la e2e (WebGL real con SwiftShader) compara tejido, vaso y velocidad de la sangre en los 4 puntos de partida de los 3 casos y en 50 000 puntos de todo el tronco.
- El Doppler color usaba caudal constante mientras la CPU (PW, medición) usa velocidad media uniforme por vaso (decisión 6): ahora la GPU usa la misma ley.
- La transmisión hasta la puerta PW cobraba 6 dB en cada paso dentro del hueso; la GPU solo al entrar. Regla única `rayAttenuationDb` con test.
- Fuga de memoria de vídeo: cada redimensionado creaba tres destinos de pantalla sin liberar los anteriores.
- CI no ejecutaba `format:check`; añadidos permisos mínimos y auditoría de dependencias de producción.

## [0.4.0] — 2026-09-22 — fidelidad anatómica y ecográfica (evaluación experta, decisiones 33–40)

### Añadido

- Fisura umbilical con ligamento redondo ecogénico (tejido `LigamentumTeres`) entre los segmentos III y IV, en el SDF compartido TS/GLSL y en el 3D (40).
- Árbol vascular hepático procedural de 3.º–4.º orden (~60 ramas confinadas al hígado) y lista de tubos por cuadro (34).

### Cambiado

- Doppler color por celdas (línea × paquete), coherencia y varianza de Kasai por ensanchamiento espectral (moteado real dentro del vaso) y cadencia física PRF/(líneas·ensemble) + cuadro B rotulada en pantalla (39).
- PSF lateral con número F (`beamModel`: FWHM ≈ 1,4 mm hasta el foco, ≈ 3,5 mm a 16 cm), puerta PW con la misma anchura y ensanchamiento espectral intrínseco por dispersión angular de la apertura (38).
- Riñón en judía con escotadura hiliar, 16 pirámides, corteza hipoecoica e interlobares en abanico (37).
- Proporciones craneocaudales referidas al xifoides (cúpula +55, confluencia +50, hilio −45, reborde −56), tronco AP 21 cm y diafragma en dos hemicúpulas sobre la inserción costal (36).
- Columna con arco posterior y apófisis transversas; costillas sin arco retrovertebral; grandes vasos delante del cuerpo vertebral; rótulo «columna» (35).
- La congestión se ve: calibres basales de suprahepáticas reales, plétora ×1,6, hepatomegalia por `sizeFactor`, avatar 3D con el calibre del caso (33).

## [0.3.0] — 2026-09-22 — saneamiento, equivalencia TS ↔ GLSL, FA y e2e

### Corregido

- Ocultar el «Torso 3D» sacaba el carril de la rejilla (`display:none`) y corría la imagen y la consola de columna: el carril queda en su columna de 0 px (`visibility:hidden`); columnas explícitas y test estático de la disposición.
- El riñón 3D era un elipsoide liso: ahora es la misma judía con escotadura hiliar que corta el haz (marching cubes sobre `kidneyOuterSdf`, `meshFromSdf` compartido con el hígado) con test de malla.
- Los puntos de partida «Subxifoideo» y «Flanco · VCI» no cortaban la VCI (abanicaban en vez de bascular; plano coronal por delante de la vena); ahora cada ventana tiene un test que comprueba lo que promete su texto.
- Una ventana de medida NaN (sin onda A) devolvía el mínimo global como «A» y descartaba el latido (31).
- La medición renal sobrevivía al cambio de caso o a «Borrar» (27).
- El navegador 3D no reconstruía la anatomía al cambiar de caso; el renderizador no liberaba recursos GPU (27).
- `tubeQuery` con sección elíptica prolongaba la cava más allá de su último nodo, en TS y GLSL (27).
- `Beat.rr` era el intervalo anterior, no el siguiente; las ventanas de medida terminaban ~26 ms fuera (27).

### Cambiado

- Geometría del sector en un módulo puro con pruebas; árbol vascular en `anatomy/vesselTree.ts`; `classify` por pasos; `CaseId` tipado (29).
- Consola por pestañas en `src/ui/panel/*` y geometría del navegador 3D en `src/ui/navigator3d/*` (28).
- Prettier, reglas de lint adicionales, CI, plantillas; helpers compartidos (`core/series.ts`,
  Nyquist en `core/units.ts`, constantes TS ↔ GLSL, puntos de partida, límites del equipo) (27).
- `main.ts` cede animación de sonda y atajos a módulos propios; ganchos de depuración solo en desarrollo (27).

### Añadido

- Pruebas de extremo a extremo con Playwright en CI (arranque, render, caso, modos, medición) (32).
- Ritmo de fibrilación auricular (RR irregular, sin P ni A, ondas f) y caso «FA · congestión moderada» (31).
- Comprobación en vivo de la equivalencia TS ↔ GLSL en modo docente: 100 % de acuerdo celda a celda (30).
- 20 pruebas nuevas de nivel rápido con valores cerrados y `npm run test:coverage` (27).

## [0.2.0] — 2026-09-22 — iteración 2

### Añadido

- Riñones implícitos con seno, pirámides, grasa perirrenal, vasos renales e interlobares
  derechos; tejidos renales y pared biliar (24).
- Vía biliar: colédoco, hepáticos, cístico (23).
- Suprahepáticas con tributarias y tronco común; porta con porción umbilical y ramas II–III y
  IV (23).
- Compartimento renal en la red venosa; patrón venoso intrarrenal emergente; medición renal
  observada; VExUS C completo (26).
- Corte ecográfico calculado en un Worker con la anatomía TypeScript (25).
- Textura de datos de escena con esferas envolventes para los tubos (24).
- Rótulos de orientación (cabeza/pies/D/I) en el navegador 3D (22).
- Infraestructura: CI en GitHub Actions, plantillas de PR e issue, guía de contribución.

### Cambiado

- Hígado en cuña con borde inferior agudo, fosa vesicular e impresión renal (23).
- Compensación nominal + TGC con techo de 50 dB, frecuencia efectiva 2,5 MHz, ruido −72 dB,
  ecos de gas escalados por la transmisión (21).
- Navegador 3D en espejo para corregir el marco anatómico levógiro (22).
- Ley de tubo de la VCI desplazada (P₀ 0 mmHg) al añadir el caudal renal (26).

### Eliminado

- Gas intestinal del avatar de referencia (queda como confusor opcional) (23).

## [0.1.0] — 2026-09-21 — iteración 1

### Añadido

- Cadena causal completa: reloj único, fisiología emergente (contorno de AD + red venosa 0D con
  ley de tubo), anatomía implícita compartida TS/GLSL, sonda 6DOF, modo B en WebGL2, color
  emulado, PW con volumen de muestra físico, audio direccional, medición observada y
  clasificación VExUS C (1–11, 19).
- Navegador 3D con three.js, disposición de tres columnas y consola por pestañas (14–17).
- Tests por niveles, test de capas, test de documentación, presupuesto de bundle (20).
