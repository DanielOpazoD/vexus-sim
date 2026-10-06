# Contrato siguiente: registro toracoabdominal y corazón

Estado: especificación para trabajo posterior; estas integraciones aún no están implementadas. Prioridad de Daniel: tamaños, posiciones y relaciones en ecografía, antes de funciones educativas.

Avance local 167: corregida la referencia craneocaudal de punta/unión xifoidea y añadido el diagnóstico de campos con signo. El registro tridimensional completo y las uniones siguen pendientes; ver [STERNAL_FRAME_RESULT.md](STERNAL_FRAME_RESULT.md).

## Defecto y predicción

Completar el número costal no reconcilia el adulto. La piel opcional, el esternón estimado, las cúpulas, el corazón procedural y las vísceras conservan registros de distinto origen. La predicción es que un registro único permita seguir continuamente pleura–pulmón–diafragma–hígado y VCI–hiato–AD al barrer, sin huecos, recortes ni superposiciones ocultadas por prioridad del clasificador.

## Trabajo y fuentes

1. Resolver punta xifoidea/unión xifoesternal con landmarks efectivos del adulto elegido, conservar una transformación declarada y aplicarla a cada consumidor. Extender la cobertura cutánea superior antes de promover un tórax de referencia. Registrar costillas, cartílagos, esternón y uniones; clavículas y escápulas siguen pendientes del objetivo de caja completa.
2. Adaptar borde inferior pulmonar, reflexión pleural y zona de aposición desde LUS `7a7def6`. Distinguir el límite de pulmón de la pleura. La PR71 está abierta y sus cambios propios se concentran en la región supraclavicular; no es validación independiente del pulmón.
3. Integrar anatomía dinámica de EchoTwin `8ca72ed` con transformación cm/ejes/origen explícita, preservando licencia y diferencias. El adaptador previo de LUS es una guía de montaje, fija en telediástole. No adoptar sin medir sus recortes por diafragma ni pérdida de valvas al hornear vóxeles.
4. Registrar continuidad VCI–AD y pericardio; conservar una sola fuente de calibre/flujo y el reloj de VExUS. Reconciliar juntos cúpula hepática, confluencias, porta, riñones, hilios y plano de Morison. Buscar poses de sonda después de corregir geometría.

## Medición y refutación

Conservar campos individuales antes de la clasificación final. Medir contacto con signo en interfaces, huecos y penetraciones, dimensiones efectivas en ejes del órgano y cortes de sonda, y continuidad de luces. Registrar regiones y resolución; un muestreo finito no demuestra ausencia global de intersección. Las tolerancias numéricas deben derivarse de la resolución del campo y las anatómicas de las referencias observadas, sin inventar márgenes clínicos.

Revisar planos vecinos y ciclo respiratorio/cardiaco; probar presión de sonda. Verificar el bloqueo común hasta destinos detrás de hueso y pulmón en B, color y PW, con controles en espacio intercostal y debajo del borde pulmonar. Refutar si aparece una vía que solo atraviesa uno de esos consumidores, si una cámara desaparece bajo una cúpula, si el reloj se desvincula del paciente o si se necesita deformar órganos para recuperar un preset.

El contraejemplo hemodinámico aportado por la auditoría queda como prueba causal separada: no se acepta corregirlo recortando Q/A, el espectro o el color. Su reparación debe explicar presión, área y caudal.

## Aceptación

Paridad CPU/GPU y mallas, ventanas con adquisición real, rendimiento y calibración de los siete casos. Separar material de ajuste de exámenes reservados para evaluación; registrar técnica, equipo y planos. La semejanza clínica y las notas requieren revisión ciega humana y referencias externas: ni paridad ni transferir otro simulador permiten declararlas.
