# Misión, objetivos y criterios

Documento rector del proyecto. Cada cambio sirve a uno de los objetivos de abajo sin romper los criterios, y el PR
dice a cuál sirve y cómo se midió. Fuentes: la guía de desarrollo y la base de conocimiento del 21-09-2026 (misión,
objetivo del producto, criterio de calidad y objetivo final) y las indicaciones del dueño, médico, del 22 al 26-09-2026.

## Misión

Construir en el navegador un **gemelo digital ecográfico de la congestión venosa**. Un paciente virtual cuya
fisiología, anatomía y física acústica producen, por causa y no por dibujo, la imagen, el Doppler, el ECG y el audio
que vería un médico con un ecógrafo real. El objetivo es que el médico aprenda VExUS **obteniendo** las señales, no
solo reconociéndolas, y que pueda equivocarse de la misma manera que con un paciente real.

## Para quién

- Médicos y residentes que aprenden POCUS y VExUS: urgencias, cuidados intensivos, nefrología, medicina interna y
  cardiología.
- Docentes que preparan un caso, ven la verdad del paciente y corrigen al alumno.

No es un dispositivo médico. No diagnostica ni sustituye la formación supervisada, y sus pacientes son sintéticos.

## Objetivos

Cada objetivo dice qué significa, cómo se mide y dónde está hoy.

1. **Causalidad.** El grado, las ondas y los calibres emergen del paciente a través de la cadena
   paciente → fisiología → anatomía → sonda → señal → procesamiento del equipo → imagen, espectro y audio → medición
   → grado. Nada asigna un grado ni dibuja una onda. Una mala adquisición da una mala imagen aunque el paciente esté
   bien definido.
   - Se mide con `examChain.test.ts` (lo que mide el alumno coincide con la verdad del caso), los invariantes de
     `invariants.test.ts` y la regla 1 de `CONTRIBUTING.md`.
   - Hoy se cumple y es innegociable.
2. **Fidelidad ecográfica.** Un ecografista experto no debe distinguir a ciegas el simulador de un equipo real en
   las ventanas VExUS: moteado, bordes, ecos parásitos, sombras, ruido, armónica, color y espectro.
   - Se mide con el juez ciego (`docs/fidelity/juez-ciego.md`), el banco de fidelidad (`npm run fidelity`) y la
     equivalencia TS ↔ GLSL.
   - Rondas 1 y 2: 7/7 parejas detectadas y nota global 2/7. Ronda 3 (26-09-2026, tras las decisiones 76–81): 7/7 y
     14/14; el realismo de las simuladas sube de 1,9 a 2,4–2,6, frente a 5,7 de las reales, y la nota sigue en 2/7. Ronda 4
     (tras 65 y 84–87, con escenas distintas): 21/21, pero las sueltas simuladas llegan a 3,1 (reales 6,4) y una
     «requirió estudio». Ronda 5 (tras 88–90): 21/21; sueltas simuladas 3,4 (reales 6,7), dos «requirieron estudio».
   - Las cinco rondas son evaluaciones internas por agentes, no por expertos humanos. Son históricas y anteriores
     al PR118; no validan los nuevos SHA ni constituyen validación clínica independiente.
   - Meta a medio plazo: nota ≥ 4/7, que el juez necesite estudio para detectarlo. Meta final: 7/7, indistinguible.
3. **Fidelidad anatómica.** Anatomía y ecografía normales según `docs/anatomia/revision-normal.md`. Cada ventana
   VExUS muestra sus estructuras clásicas, y su lista de comprobación es una prueba (`startPoints.test.ts`).
   - La tabla de brechas de la revisión (sección 10) es la lista de pendientes.
4. **Fidelidad fisiológica y clínica.** Los patrones de la base de conocimiento y los casos de su matriz. Incluye
   los confusores y los casos trampa de la literatura revisada: presión intraabdominal, insuficiencia tricuspídea,
   ventilación, cirrosis y enfermedad renal. También las intervenciones (bolo, diurético y PEEP) con la respuesta
   que tendría un paciente.
   - Se mide con `npm run calibrate`, `physiology.test.ts`, `interventions.test.ts` y la prueba de cada caso.
5. **Enseñar a obtener y a interpretar.**
   - Mandos como los de un ecógrafo: profundidad, ganancia, foco, TGC, armónica, escala, filtro de pared, línea de
     base, puerta, corrección angular, cine y modo M.
   - Control de calidad de la captura y medición sobre lo adquirido.
   - Modo alumno ciego, con la verdad solo para el docente.
   - Contexto clínico y fiabilidad por territorio.
   - Qué es VExUS y qué no: habla de presión y congestión, no de volemia; la VCI es su parte más débil y el grado
     depende de quién adquiere.
6. **Interfaz simple, limpia, esquemática e intuitiva**, en palabras del dueño (25-09-2026).
   - La imagen manda y el flujo es el del examen: ventana → imagen → Doppler → medida.
   - Divulgación progresiva y ⓘ en lugar de bloques de texto.
   - Accesible: teclado, contraste de 4,5:1 y texto de 12 px o más.
   - Se mide con `styles.test.ts`, las e2e de la interfaz y capturas a 1600 × 1000 y 1280 × 800.
7. **Un navegador corriente basta.** Un portátil con GPU integrada debe dar 60 fps, un arranque rápido y un
   bundle acotado.
   - Se mide con `frameCostMs`, el presupuesto del bundle (`tools/ci/bundle-budget.ts`) y el arranque de la e2e con
     SwiftShader.
8. **Honestidad.**
   - Lo que el modelo no hace se declara (`docs/LIMITATIONS.md`, `docs/APPROXIMATIONS.md`).
   - Un valor sin respaldo se etiqueta como `[EXTRAPOLACIÓN PROPIA]` o `NEEDS_CALIBRATION`.
   - Si el modelo no puede reproducir un hallazgo, lo avisa en vez de fingirlo. El simulador nunca enseña algo
     falso.

## Criterios para decidir

Cuando dos objetivos chocan, este es el orden:

1. **Causalidad y honestidad antes que apariencia.** Nada de «efecto bonito» sin causa: vídeos, ruido superpuesto,
   ondas dibujadas, moteado que cambia en cada cuadro o sombras pintadas. Se permiten aproximaciones que conservan
   la causalidad.
2. **Seguridad del mensaje clínico.** Ningún cambio puede enseñar una interpretación errónea. Una trampa clínica se
   enseña como trampa y con su explicación.
3. **Evidencia.** Primero la base de conocimiento, después la literatura revisada y, si no hay nada, una
   extrapolación etiquetada.
4. **Las dos preguntas del experto**, de la guía:
   - «Si un médico experto mueve la sonda o cambia este control, ¿el resultado se comporta como en un ecógrafo
     real?»
   - «¿Esto cambia porque cambió la geometría, la fisiología o la señal, o porque imito el resultado?»
5. **Primero lo que más acerca al alumno a un VExUS real bien obtenido.** Se ordena por valor docente, peso de la
   evidencia y coste.
6. **Rendimiento y sencillez de la interfaz como restricciones.** Se cumplen sin sacrificar la causalidad.

## Cómo guía el trabajo

- **Cada PR** dice a qué objetivo sirve y cómo se midió (plantilla del PR). Un cambio que no sirve a ninguno no
  entra.
- **Calidad.**
  - `npm run check` y la e2e sobre el árbol exacto que se integra.
  - Revisión adversarial de contexto limpio en los cambios grandes: halló defectos reales en casi todos.
  - Decisiones numeradas en `docs/DECISIONS.md`, con las cifras que las sostienen.
- **Hoja de ruta por ejes.** Los ejes son el ecográfico, el anatómico, el clínico, el estético y el funcional; el
  que más se aleja de su meta va primero. Cada ronda del juez ciego y cada revisión clínica reordena los pendientes.
