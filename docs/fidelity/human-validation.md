# Protocolo de evaluación humana independiente

Estado: **preparado, sin participantes ni resultados**. Los cinco juicios
históricos de agentes son desarrollo. No representan especialistas humanos ni
el SHA actual. El perfil de trabajo es convexo genérico de 3,5 MHz; no se afirma
que reproduzca una marca, equipo o preset comercial.

## Antes de recoger respuestas

Fijar versión/árbol, perfil completo, protocolo, preguntas, métricas y análisis.
Un responsable distinto de quien ajusta el simulador reserva originales por
paciente y sesión, con identificadores seudónimos. Registrar archivos, derechos,
ajustes conocidos/desconocidos y mediciones mediante
[admisión externa](external-evidence.md). No reutilizar las referencias que ya
orientaron el desarrollo como conjunto reservado. Mantener claves aparte.

Reclutar por separado clínicos con experiencia ecográfica/VExUS, especialistas
en ingeniería de ultrasonido y alumnos. Registrar experiencia y conflictos de
interés. Definir tamaño muestral y precisión antes del estudio; no fijar un
porcentaje de acierto después de ver resultados ni tratar muchos fotogramas
del mismo sujeto como observaciones independientes.

## Tres tareas distintas

1. **Aspecto y comportamiento:** clips B, Color y PW pareados por ventana y
   ajustes conocidos. Incluir pared hepatorrenal, porta, suprahepáticas, VCI y
   riñón. Normalizar exportación por igual y registrar qué información se perdió.
   Solicitar origen probable, confianza, realismo 1–7 y defectos con causa
   anatómica/acústica sospechada. Mantener desacuerdos, no solo nota media.
2. **Adquisición:** localizar el vaso y obtener señal útil moviendo libremente
   la sonda desde coordenadas iniciales distintas, también intermedias. Registrar
   pose/instante/ajustes de cada captura, tiempo y maniobras, identificación e
   interpretación. Separar calidad instrumental de feedback anatómico del modelo.
   Hasta implementar intentos sin feedback, el flujo actual es enseñanza guiada
   y no una prueba ciega de desempeño.
3. **Aprendizaje y transferencia:** evaluación antes/después con tareas nuevas,
   asignación y comparador definidos, retención y adquisición supervisada fuera
   del simulador. Un juicio de realismo ni una diferencia experto/novato prueban
   transferencia por sí solos.

Para cada respuesta guardar: protocolo, versión, id de evaluador, grupo,
experiencia, id de estímulo/intento, fecha, respuesta, confianza, tiempo, nota,
comentario y si hubo asistencia o acceso a la clave. No poner respuestas ni
identidad en nombres visibles de estímulos. El motor y la clave conservan la
verdad; el evaluador no la recibe hasta finalizar el lote.

## Interpretación y siguiente iteración

Informar participantes reales, pérdidas, asistencia y material excluido.
Analizar por evaluador y por paciente/sesión, con incertidumbre y efecto del
agrupamiento. Diferenciar capacidad de detectar lo sintético, fidelidad de cada
observable, adquisición e interpretación. Un resultado no significativo no
prueba equivalencia. Publicar fallos y discrepancias junto a aciertos.

Elegir después un defecto reproducible, mecanismo causal y predicción; ajustar
solo con desarrollo y evaluar el nuevo SHA contra otro lote reservado. Una vez
revelado o usado para ajustar, el lote deja de ser reservado para esa decisión.
La herramienta de admisión no autentica a participantes ni ejecuta este estudio.
