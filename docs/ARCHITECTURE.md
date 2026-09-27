# Arquitectura

## Tres estados (guía §3)

| Capa                    | Módulos                                           | Qué contiene                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Estado del paciente** | `physiology/patientState.ts`                      | La verdad latente: ritmo, PAD media, función del VD, IT, distensibilidad auricular, volumen estresado, presiones externas, respiración, hígado, hábito. No contiene ningún grado. |
| **Estado físico/señal** | `physiology/*`, `anatomy/*`                       | Presiones, caudales, calibres (red 0D + lazo cerrado de la media + contorno de AD + respiración) y la geometría deformable con su campo de velocidades.                           |
| **Señal adquirida**     | `probe/*`, `ultrasound/*`, `doppler/*`, `audio/*` | Lo que la sonda, el haz, la transmisión, la puerta, la PRF, el filtro, la ganancia y la presentación producen. Puede ser incorrecta con un paciente perfectamente definido.       |

La medición sobre la señal adquirida (`doppler/spectralMeasure.ts`) y sobre la verdad
(`vexus/measurements.ts`) comparten ventanas y clasificador (`vexus/classification.ts`) pero
nunca se mezclan: el modo docente muestra ambas.

## Reglas de dependencia

Matriz completa en `src/validation/layers.test.ts` (`ALLOWED`); cualquier import fuera de ella
falla la suite, incluidos los dinámicos y los de efecto lateral:

```
core ← physiology ← anatomy ← probe ← ultrasound
             ↑  ↖ cases          ↖
           vexus ← doppler (+ anatomy)      audio (solo core)
             ↖ cases (el tipo del contexto clínico)
app (orquesta todo el motor) ← ui (vistas; hoy aún ven el Simulator concreto) ← main
```

Las utilidades que solo usan las pruebas (`src/validation/support/`, como el gemelo de los ecos de
interfaz) pueden usar `core`, `anatomy` y `ultrasound`, y el contorno del hígado en las vistas de las
capturas (`liverContour.ts`), además, `probe`, `cases` y las poses de partida de `app`; el motor no las
importa.

El Doppler no conoce Web Audio: la app le inyecta un `AudioSink` (`DopplerAudio` en el navegador,
`SILENT_AUDIO` en pruebas). Los vasos se clasifican por `VESSEL_META` (sistema, tipo, ley de
calibre), nunca por el prefijo de su identificador; los casos salen de un único registro. El contexto
clínico va fuera del `PatientState` (decisión 82), en dos registros por audiencia: la viñeta, que ve el
alumno (`src/cases/vignettes.ts`, por `src/app/blindMode.ts`), y los confusores reales con la explicación
de la trampa (`src/cases/teaching.ts`), que solo llegan por `src/app/teacherNotes.ts` a la pestaña
Docente, diferida: el JS del alumno no los lleva (`src/validation/codeSplitting.test.ts`).

## Un reloj

`core/clock.ts` — `SimulationClock` avanza en pasos fijos de 4 ms. `PhysiologyEngine.step()` es el
único que lo hace avanzar. La cadena PW toma de cada paso las muestras IQ que corresponden a su PRF
(`PwDopplerChain.step`), el espectrograma etiqueta cada columna con el tiempo del centro de la
ventana, el ECG se dibuja desde el mismo historial y el audio se remuestrea desde esa IQ. El render
de imagen es independiente de la cadencia del reloj (lee el último estado); el color se refresca con
cadencia física PRF/(líneas·ensemble) + cuadro B (`colorTiming`, decisión 39), como el equipo.

## Lazo cerrado e intervenciones (decisión 79)

`src/physiology/circulation.ts` calcula en cada paso la PAD media y el gasto como el cruce del retorno venoso de la red
con la curva de Frank–Starling del VD, y guarda las intervenciones (`PhysiologyEngine.intervene`: bolo, diurético y
PEEP, con su cinética). El motor pasa la PEEP vigente a `RespiratoryModel`, la carga (media, llenado por volumen, IT) a
`RightAtriumModel`, que la congela por latido, y la presión arterial a `VenousNetwork.step`. Sin intervenciones devuelve
el caso tal cual. La pestaña Docente (`src/ui/panel/teacherTab.ts`) es su interfaz; «Reiniciar paciente» recarga el caso
con `SimulationSession.reloadCase`.

## Composición

`src/main.ts` solo compone: `SimulationSession` (`app/session.ts`) es dueña del `Simulator` vivo y
del `EquipmentController` (`app/equipment.ts`, estado del ecógrafo por comandos con invariantes);
las vistas y controladores (`ui/controllers/*`: HUD, clic en la imagen, pérdida de GPU, avisos,
menú de capas) reciben funciones de acceso, no variables globales.

## Flujo por cuadro (`src/main.ts` → `Simulator`)

```
input.tick(dt) / animación de punto de partida     gestos y teclas → pose
sim.advance(dt)                     n pasos: fisiología → (si PW) puerta + IQ → filtro → STFT → audio
sim.render()                        GPU: A transmisión → B campo+eco de interfaz → C/D PSF unitaria+ruido del receptor por línea+envolvente → K composición → F color → G barrido → persistencia
                                    (tabla FRAME_PASSES de ultrasound/passGraph.ts, validada; tiempo de GPU por pasada)
                                    y, fuera del grafo, las tomas del cine y de la línea M (decisión 80)
cine.tick()                         con la imagen congelada: el cuadro elegido del cine, por G (una vez por cuadro elegido)
overlay, navegador 3D, corte, ECG, espectrograma, franja M, HUD, consola   vistas
```

Cine y modo M (decisión 80): tras la presentación, `render` guarda en un anillo de la GPU (`CineRing`,
`src/ultrasound/cine.ts`; ≤ 20 Hz, 6 s) la envolvente compuesta y el campo de color del cuadro, antes de la
conversión de barrido, con sus ajustes; `showCine` los devuelve a `tEnv`/`tColor`, dibuja G con esos ajustes y funde
la persistencia en el mismo destino con la mezcla de la GPU (el último cuadro es la propia historia de la
persistencia). Con el modo M, cada cuadro copia su línea de `tEnv` con los grises de G a una columna de un anillo R8
(`MColumnRing`, `src/ultrasound/mmode.ts`); la vista de la franja (`src/ui/mModeView.ts`) la hace dibujar en una esquina
del lienzo de la imagen, la copia a su lienzo con `drawImage` y devuelve la imagen a la pantalla (`represent`): nada
vuelve a la CPU (un `getBufferSubData` de Chrome es síncrono aunque la valla esté cumplida).

Composición espacial (decisión 58): cada cuadro B forma una mirada, en el orden 0, +θ, −θ, que lleva el
anillo `CompoundRing` de `src/ultrasound/compound.ts` dentro del renderizador. A2, A y B tienen dos
programas cada una, de una sola fuente en `src/ultrasound/shaders/passes.glsl.ts`: el de la mirada 0, byte a
byte el de antes de la composición, y el dirigido (`FRAG_*_STEERED`, el único que declara `uSteer`); el
renderizador usa el de la mirada del cuadro (`LookPrograms`). En un cuadro dirigido, A2 y A calculan la
mirada 0 de siempre y además la de esa mirada, y B solo la dirigida, en la rejilla común (geometría en
`src/ultrasound/steering.ts`; prefijo y penumbra dirigidos en `src/ultrasound/transmission.ts` y
`src/ultrasound/aperture.ts`; fase por nodo en `src/ultrasound/speckleField.ts`). D escribe la envolvente
en la ranura de su mirada (`envLooks`, tres destinos R32F: una historia externa del grafo, como la de la
persistencia) y la pasada K (`FRAG_COMPOUND`) compone las ranuras válidas en `env`, la que convierte G;
con una sola mirada válida (compuesto apagado, color encendido o el cuadro tras un reinicio) es un paso
directo exacto. Las pruebas leen la fuente explícita: `readEnvelope({ source: 'look0' | 'compound' })`,
`readLookEnvelope(ranura)` y `readTransmission({ look })`.

Pleura parietal y cortina pulmonar (decisión 61): A0 escribe una tercera salida por línea (`h2`: el cruce
exacto de la pleura, la distancia al borde de la cortina y la pérdida de la lámina de pulmón) que leen A1 y
los dos programas de B. En las líneas con cortina, B suma la línea pleural, la serie de reverberaciones de la
pared remuestreada en el mismo camino y el deslizamiento, con la fracción de aire del borde blando, y el
tejido de detrás con `classifyWith(m, false)`; gemelos y constantes en `src/ultrasound/pleura.ts`.

Refracción de las luces (decisión 86): A1 escribe en su canal .y el camino de más de su segmento en una luz líquida (la
sangre y la bilis frente a la c del hígado; el aire lleva el dB en negativo), A2 acumula Ψ̃ y su pendiente a lo largo de
cada camino (o1.xy en la mirada 0, o3.zw en la dirigida; la dirección reflejada del espejo y el tipo de gas los pone A en
su o1 desde A0) y A forma el eco del haz enfocado cuyos rayos desvía esa pantalla de fase, el solape de los conos de
emisión y de recepción (`REFRACTION_GLSL` de `src/ultrasound/aperture.ts`, contrastado con el banco de ondas
`tools/fidelity/refraction-wave.ts`): la ganancia multiplica la transmisión de la imagen, no el rayo único del color y del
PW. Los gemelos de A2 y A (prefijos, penumbra y refracción) viven en `src/ultrasound/transmissionTwin.ts`, que solo
importan las pruebas y los ganchos de prueba (la paridad con la GPU, `src/app/steeredParity.ts`): así el chunk
principal lleva la GLSL y no los gemelos.

## Disposición y vistas (`src/ui`)

Rejilla de tres columnas (decisión 16): `src/ui/navigator3d.ts` (three.js, procedural, malla del
hígado por marching cubes sobre el mismo SDF, grupo espejo por el marco levógiro — decisión 22),
`src/ui/cutMapView.ts` + `src/ui/cutMapWorker.ts` (mapa de tejidos del plano calculado en un Worker
con `AnatomyQuery`, decisión 25), `src/ui/displays.ts` (overlay, ECG, espectrograma),
`src/ui/panel.ts` (compone la consola; cada pestaña vive en `src/ui/panel/*` sobre la interfaz
`PanelContext`, con secciones plegables; la pestaña Docente se carga con `import()` la primera vez que se activa el
modo docente, así que el alumno no descarga su código), `src/ui/startPointCards.ts` (ventanas VExUS del carril izquierdo),
`src/ui/disclosure.ts` (plegables y ventanas emergentes), `src/ui/navigator3d/*` (constructores de geometría puros: cuerpo, órganos, tubos,
rótulos, sonda), `src/ui/probeInput.ts` (gestos y teclado sobre la imagen),
`src/app/store.ts` (estado de UI). Toda vista lee del `Simulator`; ninguna escribe en él salvo la
pose de la sonda y los ajustes del equipo.

Carga diferida: el chunk principal no importa de forma estática los ganchos de prueba (`?e2e` o desarrollo), el
navegador 3D (three.js, tras el primer cuadro) ni la pestaña Docente (`codeSplitting.test.ts`). El presupuesto del
bundle (`tools/ci/bundle-budget.ts`) cuenta en el JS total lo que puede descargar un usuario: los ganchos de prueba
quedan fuera, con su límite por chunk.

## Anatomía compartida CPU/GPU

La escena es declarativa (`anatomy/scene.ts`: primitivas y riñones orientados; el árbol vascular y
la vía biliar en `anatomy/vesselTree.ts`). Se evalúa en TypeScript (`primitives.ts` + `scene.classify`) para Doppler,
mediciones, corte ecográfico (Worker) y pruebas, y en GLSL (`anatomy/gpu/anatomy.glsl.ts`, con módulos de órgano en `anatomy/organs/`;
la pared en capas con sus caras es uno de ellos, `src/anatomy/organs/wall.ts`, decisión 62, y su textura de
lóbulos y estrías vive en la pasada B, `src/ultrasound/wallTexture.ts`; el retroperitoneo —psoas, cuadrado lumbar y
grasa— es otro, `src/anatomy/organs/retroperitoneum.ts`, decisión 81, con la textura de sus fascículos en
`src/ultrasound/retroTexture.ts`; el corazón y el mediastino, que ocupan el tórax por encima de la cúpula con el
pulmón a los lados, `src/anatomy/organs/heart.ts`, decisión 85, con sus constantes en el GLSL y no en uniforms)
para imagen y color, a partir de los **mismos datos**: primitivas como uniformes y tubos en una
textura de datos con esferas envolventes (decisión 24). Regla del proyecto: cualquier cambio en una
debe replicarse en la otra; `validation/anatomy.test.ts` fija la versión TS y, en modo docente, el
bucle compara en vivo el mapa de tejidos GPU (`FRAG_TISSUEMAP`) con el del Worker en la misma rejilla
y el mismo instante (`app/equivalenceCheck.ts`, decisión 30): 100 % de acuerdo esperado; cualquier
par CPU→GPU sistemático es una divergencia real.

## Doppler

- `doppler/sampleVolume.ts`: dispersores persistentes en coordenadas materiales; sangre advectada por
  el campo de velocidades (base de flujo × u_ref(t)); tejido movido por la deformación; pesos del haz
  (axial erf de la puerta, gaussianas lateral/elevacional); v_rel = sangre + tejido − sonda; ruido.
- `doppler/wallFilter.ts`: 4.º orden IIR sobre IQ.
- `doppler/spectral.ts`: STFT y utilidades de envolvente.
- `audio/directional.ts`: Hilbert → z⁺/z⁻; `public/doppler-worklet.js`: remuestreo.
- Color (`ultrasound/shaders/passes.glsl.ts`, pasada F): emulación analítica del estimador de
  autocorrelación sobre la mezcla sangre/clutter/ruido. Solo comparte con el PW el campo de
  velocidades y la convención de signo: no procesa la IQ del volumen de muestra, y su filtro de
  clutter es un modelo propio, (f²/(f²+fc²))⁴, no el IIR del PW; con el mismo corte, el color atenúa
  ~6 dB más en fc (`color-emulated-estimator`).

## Extensión prevista

- **Riñón izquierdo con interlobares / cálices**: mismos `VesselId` + tubos en `scene.ducts`/`vessels`;
  el riñón es un módulo de órgano (`anatomy/organs/kidney.ts`, TS y GLSL juntos) que admite más
  pirámides o cálices.
- **Arritmias**: la FA ya existe (`Rhythm = 'atrial-fibrillation'`, decisión 31); extrasístoles y
  bloqueos entran por `RhythmGenerator.makeBeat/nextRR` (latido prematuro con pausa, P sin QRS).
- **Nuevos casos**: solo `PatientState`; el resto emerge.
- **Workers**: el corte ecográfico ya corre en uno (`src/ui/cutMapWorker.ts`); `Simulator.advance`
  no toca el DOM, así que la cadena PW y la fisiología pueden migrar igual manteniendo la interfaz
  `PhysiologySample`.
- **Pérdida de contexto GPU**: `main.ts` reconstruye `UltrasoundRenderer` y conserva el paciente.
- **Cambio de caso**: el renderizador pasa al simulador nuevo con `setScene` (los shaders no
  dependen de la escena, solo sus uniforms y la textura de datos): no se recompila nada.
- **Entradas de sonda**: cualquier dispositivo produce `ProbePose` (`src/probe/probe.ts`); el
  navegador 3D (`src/ui/navigator3d.ts`) y la imagen (`src/ui/probeInput.ts`) son dos ejemplos.

## Convenciones de código

- **Idioma**: identificadores en inglés (términos de programación: `render`, `dispose`, `getPose`) y
  nombres de dominio en español cuando son los de la base de conocimiento (`Subxifoideo`, `VSH`);
  comentarios, mensajes y documentación en español. Prosa y código no se mezclan en un identificador.
- **Constantes compartidas TS ↔ GLSL** (`DIAPHRAGM_THICKNESS_MM`, `LIVER_CAPSULE_MM`,
  `C_RECONSTRUCTION_MM_S`, los `#define` de tejidos generados desde `TISSUE_GLSL_NAME`) se
  interpolan en la plantilla del shader: nunca se copian a mano.
- **Sin duplicar física en la UI**: velocidad de Nyquist, PRF, plegado (`core/units.ts`),
  estadísticos de series (`core/series.ts`), límites del equipo (`EQUIPMENT_LIMITS`) y puntos de
  partida (`app/startPoints.ts`) tienen un único dueño.
- **Recursos GPU**: todo objeto que crea programas, texturas o mallas expone `dispose()` y se llama
  al cambiar de caso o reconstruir tras una pérdida de contexto.
- **Ganchos de depuración** (`window.__sim()`, `window.__views()`) solo existen en desarrollo
  (`app/devtools.ts`).

## Garantías mecánicas

- `src/validation/layers.test.ts`: fronteras de capas y ciclos (Tarjan) sobre los imports reales.
- `src/validation/docs.test.ts`: numeración de decisiones, índice generado, referencias a archivos,
  limitaciones citadas y README al día con la última iteración cerrada.
- `.github/workflows/ci.yml`: en cada push y PR, lo mismo que `npm run check` (formato, lint con tipos,
  tipos, todas las pruebas con umbrales de cobertura, build, presupuesto) + auditoría de dependencias;
  después, la e2e (arranque, casos, medición numérica, pérdida de contexto WebGL y gate de
  equivalencia TS ↔ GLSL en tejido, vaso y velocidad).
- `tools/ci/bundle-budget.ts`: presupuestos de tamaño por patrón tras `vite build`.
- Niveles de prueba por marcador `// @tier slow` (ver `vite.config.ts`).
