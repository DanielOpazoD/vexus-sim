# Cómo contribuir

## Arquitectura git

```
main ──●──●──●──●──●──●──►   siempre verde; solo recibe merges de PR con CI en verde
        \      /   \    /
         ●──●──     ●──●      ramas cortas: feat/…, fix/…, docs/…, chore/…
```

- **`main`** es la única rama larga. Cada commit de `main` pasa `npm run check` (lo ejecuta
  también CI en `.github/workflows/ci.yml`). No se empuja directamente a `main`.
- **Ramas de trabajo** cortas (uno o pocos días) con prefijo por intención: `feat/`, `fix/`,
  `docs/`, `chore/`, `perf/`, `test/`. Ejemplo: `feat/rinon-izquierdo-interlobares`.
- **Pull request** por cada rama, con la plantilla (`.github/pull_request_template.md`): qué
  cambia, número de decisión, cómo se verificó. Se integra con _squash_ o _merge_ normal, nunca
  con historia reescrita de `main`.
- **Etiquetas** `vN.N.N` en `main` al cerrar una iteración (`docs/DECISIONS.md` lleva el informe
  de cierre correspondiente; `CHANGELOG.md` lo resume).

## Mensajes de commit

[Conventional Commits](https://www.conventionalcommits.org/es/) en español, tiempo presente:

```
feat(anatomy): riñones implícitos con seno, pirámides e interlobares
fix(ultrasound): techo de 50 dB a la compensación nominal + TGC
docs: decisiones 23–26 e informe de cierre de la iteración 2
test(doppler): banda de señal frente a cola alta del ruido
chore(ci): workflow con npm run check
```

Ámbitos: `core`, `physiology`, `anatomy`, `probe`, `ultrasound`, `doppler`, `audio`, `vexus`,
`cases`, `app`, `ui`, `tools`, `ci`, `docs`.

## Antes de abrir un PR

```bash
npm run check
```

Ejecuta lint, tipos, **todas** las pruebas (rápidas y lentas), build y presupuesto de bundle.
No se acepta `npm run check | grep …`: el código de salida es lo que cuenta. Si el cambio toca
la anatomía, también:

```bash
npm run calibrate
```

y se comprueba que los observables de referencia (S/D, PF, VCI, patrón renal, grado) siguen en
sus rangos; los nuevos valores van al informe de la decisión.

## Reglas del proyecto (resumen de `docs/DECISIONS.md`)

1. **Nada asigna un grado VExUS**: emerge de la señal adquirida. Un PR que «pinte» un patrón se
   rechaza.
2. **Un solo reloj** (`core/clock.ts`); todo lo temporal deriva de él.
3. **Anatomía compartida TS ↔ GLSL**: cualquier cambio en `anatomy/scene.ts` o
   `anatomy/primitives.ts` se replica en `ultrasound/shaders/anatomy.glsl.ts` y se fija con un
   punto en `validation/anatomy.test.ts`.
4. **Valores clínicos**: no se inventan. Lo que no está en la base de conocimiento se etiqueta
   `[EXTRAPOLACIÓN PROPIA]` / `NEEDS_CALIBRATION` en el código y en `docs/APPROXIMATIONS.md`.
5. **Decisiones numeradas, nunca renumeradas** (`docs/DECISIONS.md`); una decisión superada se
   marca `[Estado: superada por N]` y `npm run docs:index` regenera el índice (CI lo comprueba).
6. **Limitaciones con id** (`src/validation/limitations.ts` ↔ `docs/LIMITATIONS.md`): se añade o
   se borra en ambos sitios en el mismo cambio.
7. **Capas**: `validation/layers.test.ts` fija las fronteras entre módulos; la lista de ciclos
   aceptados solo puede encoger.

## Pruebas

- Rápidas por defecto (`npm test`). Una prueba cuya primera línea es `// @tier slow` sale de la
  suite rápida y entra en `test:slow` / `test:all`.
- Sin WebGL ni DOM en los tests unitarios: todo lo físico se prueba en TypeScript puro. Lo que solo
  el navegador puede ver (arranque, render, cableado de la UI) va en `e2e/` (Playwright, `npm run
e2e`; CI lo ejecuta tras `check`).
- Los umbrales de una aserción se justifican en un comentario (qué observable, de dónde sale).

## Estilo

`.editorconfig` (2 espacios, LF, UTF-8), `eslint` estricto y `prettier` (`npm run format`).
Nombres de dominio en español (como la base de conocimiento), identificadores de código en inglés
cuando son términos técnicos de programación; comentarios en español.

## Herramientas locales

- `npm install` activa el hook `.githooks/pre-push` (tipos + pruebas rápidas antes de empujar).
- Dependabot abre cada lunes una PR agrupada por ecosistema; entra si CI (check + e2e) está verde.
- ESLint usa las reglas con información de tipos (`recommendedTypeChecked`).

## Plantilla de decisión (desde la 45)

Cada decisión nueva de `docs/DECISIONS.md` sigue este esquema (las 1–44 son registro histórico):

```markdown
## N. Título en una línea

**Contexto.** Qué problema o evidencia la motiva (con cifras o la prueba que falló).
**Opciones.** Alternativas consideradas y por qué no.
**Decisión.** Qué se hace, con los nombres de código y archivos.
**Consecuencias.** Qué cambia para el alumno, el rendimiento y las pruebas; qué queda pendiente.
**Verificación.** Qué prueba lo protege (y, si es un gate, cómo se comprobó que falla sin el cambio).
```
