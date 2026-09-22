# Arquitectura

## Tres estados (guía §3)

| Capa                    | Módulos                                           | Qué contiene                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Estado del paciente** | `physiology/patientState.ts`                      | La verdad latente: ritmo, PAD media, función del VD, IT, distensibilidad auricular, volumen estresado, presiones externas, respiración, hígado, hábito. No contiene ningún grado. |
| **Estado físico/señal** | `physiology/*`, `anatomy/*`                       | Presiones, caudales, calibres (red 0D + contorno de AD + respiración) y la geometría deformable con su campo de velocidades.                                                      |
| **Señal adquirida**     | `probe/*`, `ultrasound/*`, `doppler/*`, `audio/*` | Lo que la sonda, el haz, la transmisión, la puerta, la PRF, el filtro, la ganancia y la presentación producen. Puede ser incorrecta con un paciente perfectamente definido.       |

La medición sobre la señal adquirida (`doppler/spectralMeasure.ts`) y sobre la verdad
(`vexus/measurements.ts`) comparten ventanas y clasificador (`vexus/classification.ts`) pero
nunca se mezclan: el modo docente muestra ambas.

## Un reloj

`core/clock.ts` — `SimulationClock` avanza en pasos fijos de 4 ms. `PhysiologyEngine.step()` es el
único que lo hace avanzar. La cadena PW toma de cada paso las muestras IQ que corresponden a su PRF
(`PwDopplerChain.step`), el espectrograma etiqueta cada columna con el tiempo del centro de la
ventana, el ECG se dibuja desde el mismo historial y el audio se remuestrea desde esa IQ. El render
de imagen es independiente de la cadencia del reloj (lee el último estado); el color se refresca con
cadencia propia (15 Hz) para reproducir el coste de ensembles del equipo.

## Flujo por cuadro (`src/main.ts` → `Simulator`)

```
input.tick(dt) / animación de punto de partida     gestos y teclas → pose
sim.advance(dt)                     n pasos: fisiología → (si PW) puerta + IQ → filtro → STFT → audio
sim.render()                        GPU: A transmisión → B campo+ruido → C/D PSF unitaria+envolvente → F color → G barrido → persistencia
overlay, navegador 3D, corte, ECG, espectrograma, HUD, consola   vistas
```

## Disposición y vistas (`src/ui`)

Rejilla de tres columnas (decisión 16): `src/ui/navigator3d.ts` (three.js, procedural, malla del
hígado por marching cubes sobre el mismo SDF, grupo espejo por el marco levógiro — decisión 22),
`src/ui/cutMapView.ts` + `src/ui/cutMapWorker.ts` (mapa de tejidos del plano calculado en un Worker
con `AnatomyQuery`, decisión 25), `src/ui/displays.ts` (overlay, ECG, espectrograma),
`src/ui/panel.ts` (compone la consola; cada pestaña vive en `src/ui/panel/*` sobre la interfaz
`PanelContext`), `src/ui/navigator3d/*` (constructores de geometría puros: cuerpo, órganos, tubos,
rótulos, sonda), `src/ui/probeInput.ts` (gestos y teclado sobre la imagen),
`src/app/store.ts` (estado de UI). Toda vista lee del `Simulator`; ninguna escribe en él salvo la
pose de la sonda y los ajustes del equipo.

## Anatomía compartida CPU/GPU

La escena es declarativa (`anatomy/scene.ts`: primitivas y riñones orientados; el árbol vascular y
la vía biliar en `anatomy/vesselTree.ts`). Se evalúa en TypeScript (`primitives.ts` + `scene.classify`) para Doppler,
mediciones, corte ecográfico (Worker) y pruebas, y en GLSL (`ultrasound/shaders/anatomy.glsl.ts`)
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
- Color (`ultrasound/shaders/passes.glsl.ts`, pasada F): emulación del estimador de autocorrelación
  sobre la mezcla sangre/clutter/ruido con la misma convención de signo y filtro de clutter.

## Extensión prevista

- **Riñón izquierdo con interlobares / cálices**: mismos `VesselId` + tubos en `scene.ducts`/`vessels`;
  el riñón es una primitiva (`primitives.kidneyQuery`) que admite más pirámides o cálices.
- **Arritmias**: `RhythmGenerator.makeBeat/nextRR` (FA: sin P, RR irregular; extrasístoles: latido
  prematuro con pausa).
- **Nuevos casos**: solo `PatientState`; el resto emerge.
- **Workers**: el corte ecográfico ya corre en uno (`src/ui/cutMapWorker.ts`); `Simulator.advance`
  no toca el DOM, así que la cadena PW y la fisiología pueden migrar igual manteniendo la interfaz
  `PhysiologySample`.
- **Pérdida de contexto GPU**: `main.ts` reconstruye `UltrasoundRenderer` y conserva el paciente.
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
- `.github/workflows/ci.yml`: ejecuta lo mismo que `npm run check` en cada push y PR.
- `tools/ci/bundle-budget.ts`: presupuestos de tamaño por patrón tras `vite build`.
- Niveles de prueba por marcador `// @tier slow` (ver `vite.config.ts`).
