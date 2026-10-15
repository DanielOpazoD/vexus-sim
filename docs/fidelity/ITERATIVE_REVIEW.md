# Revisión iterativa de adquisiciones

## Contrato previo: banco de nueve ventanas

**Defecto y aprendizaje.** El banco histórico evalúa cuatro presets y no declara
atlas/legacy. La auditoría del 07-10-2026 capturó inicialmente una VSH antes de
terminar la animación; además, los ajustes portales se heredaban en otras ventanas.
Una comparación así puede atribuir al modelo un error del instrumento.

**Mecanismo y dominio.** Extender las herramientas de revisión, conservando el
render real. Usar el registro `startPointsFor`, una página nueva por adquisición
y estado del cuadro presentado. Dominio inicial: adulto normal/congestivo,
nueve ventanas, atlas o legacy explícitos. No valida una población humana.

**Predicción.** Cada PNG se vincula a versión/árbol, hashes de geometría, caso,
semilla, pose, marco presentado, compresión, instante y ajustes. El protocolo UI
espera el objetivo real del preset y conserva el reloj; el estático controla
instante e historia con `comparisonState`. No se comparan ambos como equivalentes.

**Invariantes y confusores.** No cambia anatomía, señal, controles ni presupuesto.
El navegador y la GPU se identifican. Una imagen de cine antiguo con una pose o
configuración actual diferente no representa una adquisición reproducible.
Los errores y capturas fallidas se conservan; una repetición es otra ejecución.

**Refutación.** Rechazar estado incompleto, tiempos inconsistentes, marco distinto
del presentado, color activo en captura B, atlas incorrecto o datos fuente que
cambien durante la sesión. Una imagen que pase estos controles aún puede ser
anatómica o ecográficamente incorrecta.

**Aceptación.** Capturas reales de las nueve ventanas con manifiestos completos;
controles discriminantes de identidad; inspección visual por ventana y vecinos.
Falta referencia clínica reservada y evaluación externa real. Cada hallazgo se
registra abierto/reprobado/aceptado y se vincula a su captura y versión.

## Uso

```sh
npm run fidelity:audit -- --url http://127.0.0.1:3012 --out /tmp/vexus-review --anatomy atlas --protocol ui
npm run fidelity:audit -- --url http://127.0.0.1:3012 --out /tmp/vexus-static --anatomy atlas --protocol static --time 30
```

El protocolo UI recorre tarjetas y congela con el botón real. El estático
reinicia explícitamente la historia para comparación de señal; no demuestra
fluidez de exploración. `--views portal,subcostal` y `--cases normal-adult`
permiten iteraciones focalizadas; la salida declara el subconjunto utilizado.
Los archivos de evidencia se guardan fuera del repositorio.

## Circuito de cada corrección

1. Registrar defecto observable y consecuencias docentes.
2. Reproducirlo en captura y cine, con estado y fuente conservados.
3. Localizar anatomía/contacto, haz, señal, procesamiento o medición.
4. Cambiar un mecanismo; usar referencia independiente y un control que falle
   con la versión anterior cuando corresponda.
5. Repetir igual estado y explorar poses vecinas, respiración y casos.
6. Revisar apariencia, magnitudes y costes; conservar resultados negativos.
7. Integrar solo con los controles vigentes y CI del SHA exacto. Actualizar
   decisiones y límites; preparar revisión externa desde el inicio.

El contrato por ventana continúa en `docs/anatomy/vexus-window-acceptance.md`.
Las notas internas y los tests no sustituyen reconocimiento/adquisición por
ultrasonografistas ni validación educativa.
