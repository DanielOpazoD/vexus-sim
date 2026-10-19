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

## Referencia externa y siguiente secuencia

El usuario acepta continuar con el convexo **genérico de 3,5 MHz**, no con una
calibración comercial. [Admisión de evidencia](external-evidence.md) verifica
procedencia, archivos y separación entre desarrollo y reservado. Un informe
admitido no prueba fidelidad; datos sintéticos o referencias ya usadas para
ajustar nunca se convierten en una evaluación independiente.

Prioridades aceptadas y condición de cierre:

1. Respuesta estacionaria Color/PW y contexto ventilatorio: decisiones 234/236;
   aceptar con negativos discriminantes, GPU y CI del head final. Persisten las
   diferencias de estimador y transitorios, y el reparto tríplex declarado.
2. Reposición PW: reproducida la pérdida de peso renal frente a siembra nueva;
   rotación aislada y clasificación en una posición de referencia distinta de
   la que emite IQ son rechazadas. Exigir densidad, trayectoria anatómica,
   velocidad coherente, potencia, audio/espectro sin impulsos y las capturas
   renales existentes; no cerrar con un fantoma sin flujo.
3. Referencia acústica independiente: PSF/flujo lineal con Field II o SIMUS y
   fantomas heterogéneos seleccionados con k-Wave, offline. Registrar versión,
   ajustes, unidades, ROI, archivos y límites; reservar datos antes de ajustar.
   El banco gaussiano interno y su gemelo no sustituyen ese contraste.
4. Pared hepatorrenal regional: comparar el SHA actual y poses intermedias con
   referencia anatómica independiente. Solo entonces cambiar geometría
   compartida, conservando paridad TS/GLSL y ambos pacientes. No borrar grasa
   humana ni añadir textura para ocultar un límite geométrico.
5. Evaluación educativa: separar política de feedback del modo docente. Un
   intento debe conservar captura original y aplazar todos los juicios hasta
   finalizar, incluidos DOM, anuncios, contadores y marcas. Mantener enseñanza
   actual y no inventar una rúbrica ni notas.
6. Validación humana: evaluadores clínicos e ingeniería independientes, clips
   reservados y tareas de adquisición, discriminación experto/novato y estudio
   de transferencia. Usar [protocolo humano](human-validation.md); las rondas
   históricas de agentes sirven a desarrollo y no acreditan resultados humanos.

Estas son condiciones de trabajo, no una declaración de cierre de los seis
bloques. Las limitaciones se conservan hasta disponer de evidencia suficiente.
