# Historial de cambios

Formato de [Keep a Changelog](https://keepachangelog.com/es/1.1.0/); versiones semánticas. Los
detalles de cada decisión están en `docs/DECISIONS.md` (número entre paréntesis).

## [Sin publicar]

### Cambiado

- Fase 1: `TransducerProfile` reúne geometría, haz, frecuencias efectivas y densidad de líneas de color (antes en cinco sitios, con dos constantes 2,5 MHz sueltas); renderer y simulador reciben el perfil.
- Fase 1: `main.ts` pasa a raíz de composición (450 → 319 líneas): `SimulationSession` (simulador vivo, equipo y cambio de caso transaccional), `ui/controllers/*` (HUD como función pura, clic en la imagen, pérdida de GPU, avisos, menú de capas) y `ErrorBudget`; el HUD rotula la frecuencia real del transductor.
- Fase 1: estado del ecógrafo inmutable (`EquipmentController`) que solo cambia por comandos y siempre cumple las invariantes físicas: al reducir la profundidad la puerta PW, la caja de color y el foco se quedan dentro de la imagen; la PRF no supera c/2d; la caja y la puerta no salen del sector. Paneles, teclado, clic y ganchos de prueba despachan comandos; el `Simulator` expone ajustes de solo lectura.
- Fase 1 (modelo de dominio), PR 1: `VESSEL_META` (sistema, tipo y ley de calibre) sustituye a los `startsWith('ivc')` de anatomía, renderer, corte, navegador 3D y volumen de muestra; registro de casos de una sola fuente (`CaseId` = claves del registro); la cadena PW recibe un `AudioSink` y el Doppler deja de depender del audio; matriz completa de dependencias entre capas (incluye imports dinámicos).

### Añadido

- Documentación para incorporar a un equipo: `CLAUDE.md` (invariantes que se rompen fácil), `docs/GLOSSARY.md`, `docs/TESTING.md`, plantilla de decisión en `CONTRIBUTING.md`; afirmaciones obsoletas corregidas (CI, cadencia del color, pirámides, e2e de la decisión 32) y el «Estado» del README atado a la versión. ESLint con reglas tipadas, `@types/three` alineado con three, Dependabot semanal agrupado y hook de pre-push.

- Cortina pulmonar con líneas A (signo de la cortina) que baja con la inspiración; cápsula y pelvis renales; pirámides discretas con columnas de Bertin (43).

- Segmentos de Couinaud derivados de los planos de las suprahepáticas, la fisura umbilical y el plano portal; hígado 3D translúcido coloreado por segmento con rótulos I–VIII; lámina del ligamento venoso (`LigamentumVenosum`) en el modelo acústico y en el corte (42).

### Cambiado

- Interfaz hígado–riñón sin hueco (cápsula hepática → grasa de Gerota → cápsula renal); pared periportal proporcional al calibre; pared blanda que conserva el acoplamiento al bascular en el epigastrio; punto de partida renal en eje largo (43).
- Vesícula en pera con base propia, afilamiento fondo→cuello, pared ecogénica de 1,5 mm y fosa; la porción umbilical de la porta izquierda termina bajo la fisura umbilical (receso de Rex) (41). Se retira la limitación `axis-aligned-gallbladder`.

- Pestaña «Adquirir» con los mandos básicos de imagen (profundidad, ganancia, foco; una sola fuente con la pestaña «Imagen»); profundidad por defecto 18 cm.
- Costillas con oblicuidad creciente hacia abajo (`ribTiltMm`: 60 mm la 5.ª, 90 mm la 10.ª), misma ley en el SDF y en el 3D; antes se veían casi horizontales.

### Corregido

- Pruebas por propiedades (fast-check) sobre todo el dominio de pacientes coherentes: hallaron una VCI colapsada que daba 288 m/s → resistor de Starling (R ∝ 1/A² bajo 8 mm, integración implícita) y lumen residual de 3 mm; dos contraejemplos extremos quedan como `it.fails` de las limitaciones `prescribed-ra-contour` y `no-thoracic-waterfall`. Límites del shader derivados de las constantes (tamaño de tejidos, ancho de la textura, segmentos por tubo) con prueba de margen. Cobertura de todos los niveles (87 %) con umbrales en CI. La e2e de medición exige un valor numérico (antes aceptaba «VSH: —»).
- La medición del alumno (pestaña Medir) confundía picos de ruido con ondas: el caso sano salía «leve» y la FA «grave». Envolvente por percentil de la banda contigua con espectro promediado, extremos robustos, vena interlobar leída en su lado y «S invertida» solo si el retrógrado alcanza el 50 % del pico. Nueva prueba de la cadena completa del alumno para los 3 casos y los 3 territorios (44).
- Fallos silenciosos: registro de errores único (`errorLog`, visible en Docente) con manejadores globales; el Worker del corte informa sus errores, tiene vigilante de 3 s y se reinicia con espera creciente; el audio se activa de forma transaccional; el cambio de caso es transaccional (si falla, sigue el anterior); el bucle ya no se detiene para siempre tras errores repetidos (reintenta a 1 Hz y se recupera); un oyente del store que lanza no corta a los demás; guardia `NonFiniteStateError` en el motor fisiológico; e2e de pérdida y recuperación del contexto WebGL.
- La equivalencia TS ↔ GLSL solo se comprobaba a mano en la pestaña Docente: ahora una prueba e2e (`e2e/equivalence.spec.ts`, WebGL real con SwiftShader) compara tejido, vaso y velocidad de la sangre en los 4 puntos de partida de los 3 casos mediante una consulta puntual de la anatomía GLSL (`queryPoints`) y el gancho `?e2e`. Reintroducir la ley de velocidad anterior la hace fallar (error p95 hasta 120 %).
- El Doppler color usaba caudal constante (`uRef·rRef²/rLoc²`) mientras la CPU (PW, medición) usa velocidad media uniforme por vaso (decisión 6): color y PW podían contradecirse en ramas afiladas. Ahora la GPU usa la misma ley.
- La transmisión hasta la puerta PW cobraba 6 dB en cada paso dentro del hueso; la GPU solo al entrar. Regla única `rayAttenuationDb` con test.
- Fuga de memoria de vídeo: cada redimensionado creaba tres destinos de pantalla sin liberar los anteriores.
- CI no ejecutaba `format:check` aunque decía replicar `npm run check`; añadidos permisos mínimos y auditoría de dependencias de producción.

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
