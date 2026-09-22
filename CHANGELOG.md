# Historial de cambios

Formato de [Keep a Changelog](https://keepachangelog.com/es/1.1.0/); versiones semánticas. Los
detalles de cada decisión están en `docs/DECISIONS.md` (número entre paréntesis).

## [Sin publicar]

### Corregido

- La medición renal sobrevivía al cambio de caso o a «Borrar» (27).
- El navegador 3D no reconstruía la anatomía al cambiar de caso; el renderizador no liberaba recursos GPU (27).
- `tubeQuery` con sección elíptica prolongaba la cava más allá de su último nodo, en TS y GLSL (27).
- `Beat.rr` era el intervalo anterior, no el siguiente; las ventanas de medida terminaban ~26 ms fuera (27).

### Cambiado

- Consola por pestañas en `src/ui/panel/*` y geometría del navegador 3D en `src/ui/navigator3d/*` (28).
- Prettier, reglas de lint adicionales, CI, plantillas; helpers compartidos (`core/series.ts`,
  Nyquist en `core/units.ts`, constantes TS ↔ GLSL, puntos de partida, límites del equipo) (27).
- `main.ts` cede animación de sonda y atajos a módulos propios; ganchos de depuración solo en desarrollo (27).

### Añadido

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
