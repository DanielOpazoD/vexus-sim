# Quince bloques de fidelidad: alcance autorizado

El 24 de octubre de 2026 el usuario autoriza implementar esta ronda iterativamente, con commits,
PR y merge solo al validar el candidato final. Prioridad inicial: **1, 2 y 5**. El producto sigue
en desarrollo después de esta ronda. Un experimento rechazado conserva su evidencia y no cuenta
como entrega. Los bloques grandes pueden requerir varios PR pequeños.

Base comprobada: main `8d7ad19209ac7a375f27ba7466a27c64220f3eee`, PR276. Su CI independiente
postmerge [40087942261](https://github.com/DanielOpazoD/vexus-sim/actions/runs/40087942261)
aprobó 162 E2E únicas sin reintentos. Esto no es validación clínica externa.

| Bloque | Entrega buscada                               | Criterio discriminante                                                                                                          |
| ------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1      | Referencias externas ejecutadas y comparables | Originales, versiones, unidades y diferencias respecto del modelo; separar simulación independiente, medición física y clínica. |
| 2      | Menor desfase completo del corte              | Separación geométrica y antigüedad bajo la misma trayectoria; no rejuvenecer un mapa idéntico para mejorar un contador.         |
| 3      | Navegación continua                           | Recorridos en ambos sentidos, extremos y regreso sin deriva; seis coordenadas como muestras, no regiones permitidas.            |
| 4      | PSF y pérdida de banda por camino             | Blancos tras distintos tejidos, anchura axial/lateral y energía frente a referencia independiente.                              |
| 5      | Moteado estable durante exploración           | Movimientos pequeños y trayectorias cerradas, campo complejo sobremuestreado, receptor separado; conservar resolución/potencia. |
| 6      | Anatomía regional hepatorrenal                | Referencia anatómica, contactos y espesores, cortes vecinos, ambos pacientes y respiración.                                     |
| 7      | Respuesta de fascias y cápsulas               | Reflectores inclinados en dos ejes, anchura/energía angular y evaluación visual.                                                |
| 8      | Propiedades acústicas y refracción            | Parámetros justificados y fantoma de capas/lente; posición y energía del eco.                                                   |
| 9      | Transporte PW                                 | Población/potencia, trayectorias dentro del lumen, ausencia de impulsos falsos y capturas renales preservadas.                  |
| 10     | Balance de una bifurcación portal             | Entradas/salidas/almacenamiento y continuidad de velocidades; no imponer caudal constante a todo tubo afilado.                  |
| 11     | Color con ensemble IQ temporal                | Sesgo/varianza, aliasing, filtro y movimiento; integración condicionada al coste y resolución.                                  |
| 12     | Calendario tríplex                            | Tiempos físicos compatibles y escalas ligadas al muestreo efectivo, política genérica declarada.                                |
| 13     | Recursos sostenibles                          | Memoria estable y trabajo eliminado medido; conservar precisión, resolución y cine.                                             |
| 14     | Feedback de pruebas discriminante             | Negativos conocidos detectados antes; aceptación final completa y sin confundir fixtures con referencias físicas.               |
| 15     | Evaluación humana independiente               | Participantes y respuestas reales, referencias reservadas; apariencia, adquisición y transferencia separadas.                   |

La guía de [evolución de pruebas](../../CONTRIBUTING.md#evolución-de-pruebas) permite superar
contratos obsoletos con justificación y evidencia. No es autorización para bajar resolución,
ocultar errores o cambiar expectativas para conseguir verde. Evitar nueva infraestructura
cuando un comando o contrato existente resuelve la necesidad.

## Estado y dependencias externas

El estado vivo, candidatos, resultados negativos y originales se conservan fuera del checkout:
`../fidelity-next15-evidence/CURRENT_STATE.json` y `PROGRESS.md`. Git y la CI determinan las
entregas aceptadas; esta lista no afirma que estén implementadas.

El perfil sigue siendo convexo genérico de 3,5 MHz. SIMUS/PyMUST puede aportar una referencia
numérica independiente, no una medición de un equipo. La evidencia física/clínica exige originales
con derechos, procedencia y ajustes. El bloque 15 requiere participantes humanos: preparar
herramientas o evaluar con agentes no lo completa. Reunir esas dependencias en paralelo al código.
