# Contrato de la iteración de arranque

**Defecto.** Los fallos de arranque anteriores al segundo cuadro no conservan
una última etapa en el informe E2E. Hooks ausentes no equivalen a cero cuadros
ni identifican el bloqueo de adquisición que impide integrar el atlas.

**Mecanismo.** Observar composición, sesión, controles, imports, construcción
del torso y los primeros cuadros. Activación explícita por `e2e` o
`startupTrace`; milisegundos de navegación independientes del paciente.

**Predicción.** Un bloqueo posterior al inicio de bootstrap conserva las
etapas emitidas en el proceso de Playwright. No inventa la finalización de una
etapa. Sin diagnóstico no lee su reloj ni emite eventos.

**Invariantes.** Mismos plazos, inicialización, anatomía, imágenes, fisiología,
controles de arranque, shaders, presupuestos, capas y pruebas. La fuente y el
estado adquirido identifican cada comparación.

**Refutación.** Un evento anterior a un bloqueo real no llega al host; se
atribuye una etapa no completada; se acumulan duplicados; cambia una imagen
con historia equivalente; o el examen habitual activa trabajo de diagnóstico.

**Aceptación.** Control de contexto bloqueado en navegador, nueve adquisiciones
emparejadas, cuatro controles puros, capas, check y CI exactos. La traza puede
estar vacía si falla el cargador o la evaluación de módulos antes de bootstrap.
Esta iteración no acepta el arranque del PR219 ni modifica sus defectos clínicos.
