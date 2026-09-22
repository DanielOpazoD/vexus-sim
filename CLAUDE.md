# Guía para agentes y colaboradores

Simulador VExUS: cadena causal fisiología → anatomía → sonda → imagen → Doppler → medición →
grado. Lee primero `README.md`, `docs/ARCHITECTURE.md`, `docs/GLOSSARY.md` y `docs/TESTING.md`.

## Antes de terminar un cambio

- `npm run check > /tmp/check.log 2>&1; echo EXIT $?` — nunca `npm run check | grep`: cuenta el
  código de salida. Tarda ~2–5 min (incluye pruebas lentas con cobertura).
- `npm run e2e` si tocas GPU, UI, medición o anatomía (necesita `vite build` antes).
- Decisión nueva → `docs/DECISIONS.md` con la plantilla de `CONTRIBUTING.md` y `npm run docs:index`.
- Aproximación o limitación nueva → `docs/APPROXIMATIONS.md` / `docs/LIMITATIONS.md`
  (las limitaciones con id en `src/validation/limitations.ts`).

## Invariantes que se rompen fácil

1. **Anatomía TS = GLSL.** Todo cambio en `src/anatomy/*.ts` que afecte a `classify` va también a
   `src/anatomy/gpu/anatomy.glsl.ts` (misma fórmula), con sus uniforms en `anatomy/gpu/sceneUniforms.ts`.
   Los órganos nuevos van como módulo en `src/anatomy/organs/` (TS y GLSL juntos, mismo nombre).
   La e2e `equivalence.spec.ts` exige acuerdo exacto en 50 000 puntos; en la app, pestaña Docente.
2. **Marco levógiro**: x = izquierda del paciente. El navegador 3D lo espeja con `scale.x = −1`.
3. **Ramas procedurales** (`flowFactor` definido) comparten id con su vaso madre: exclúyelas de
   `vesselById`/`vesselAreas` o las velocidades se multiplican.
4. **Tamaños GLSL** salen de constantes (`TISSUE_COUNT`, `MAX_TUBES`, `MAX_TUBE_SEGMENTS`); no
   escribas literales. `shaderLimits.test.ts` exige margen.
5. **Velocidad uniforme por vaso** (decisión 6) en CPU y GPU; nunca Q = cte en tubos afilados.
6. **Ningún fallo silencioso**: todo `catch` informa a `errorLog` con su origen.
7. **Nada de lecturas GPU→CPU por cuadro** (bloquean 50–90 ms): solo PBO asíncrono o pruebas.
8. Al editar coordenadas con expresiones regulares, no toques la z por accidente.
9. Tras `prettier --write`, relee las líneas largas que editaste a mano (el reflujo puede mover
   guardas).

## Flujo de trabajo

Ramas `feat/…`, `fix/…`, `test/…`, `docs/…`; Conventional Commits en español; PR con descripción
de qué cambia y cómo se verificó; squash-merge con CI verde (check + e2e).
