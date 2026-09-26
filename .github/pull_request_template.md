## Qué cambia

<!-- Una o dos frases. Si toca física/anatomía: qué observable cambia y por qué. -->

## Objetivo de la misión

<!-- A cuál de los objetivos de docs/MISION.md sirve (causalidad, fidelidad ecográfica, anatómica o clínica,
enseñar a obtener, interfaz, rendimiento, honestidad) y con qué medida se comprueba. -->

## Decisión de diseño

<!-- Número de la entrada añadida o modificada en docs/DECISIONS.md, o «no aplica». -->

## Cómo se verificó

- [ ] `npm run check` en verde (lint, tipos, tests fast+slow, build, presupuesto)
- [ ] Verificado en vivo en el navegador (qué se miró: ventana, medida, captura)
- [ ] Si cambia la anatomía: TS y GLSL sincronizados (`anatomy.test.ts` actualizado)
- [ ] Si añade una limitación o aproximación: `docs/LIMITATIONS.md` / `docs/APPROXIMATIONS.md`
