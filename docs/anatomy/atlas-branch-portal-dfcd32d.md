# Pose y caja portal — historia de la revisión Atlas

Fuente: `dfcd32db8c9d93ed4e99d4876cf7bdc9ad6bfc20`, PR236, sobre `34ba98e`. Conserva las decisiones
191–197 originales, incluidos ensayos rechazados; no renumera la historia.
Esta reconciliación incorpora la anatomía preparada de PR228 y los contratos
actuales de main: sus mediciones anteriores permanecen históricas y requieren
nuevo contraste sobre el SHA de integración. La elección de pose no certifica
fidelidad clínica ni aceptación de los campos de Atlas.

## 191. Posición portal escogida y copia exacta de los mandos

**Contexto.** Daniel selecciona una adquisición portal del atlas de34ba98e: φ173°, z−40mm, yaw−72°, tilt−2°, rock−6° y presión0mm. Los rótulos redondeados de su captura no permiten recuperar más precisión.
**Opciones.** Se descarta cambiar de atlas durante este ajuste:26cd7b7 contiene datos y campos distintos. Una captura o rótulo redondeado no sustituye la posición exacta.
**Decisión.** `ABDOMINAL_POSES.portal` toma los valores seleccionados. `probePositionText` y `buildProbePositionCopy` ofrecen JSON con seis mandos exactos, unidades, versión, dominio, transductor, caso, reloj, respiración y equipo completo desde Adquirir → Sonda. Se conserva la anatomía original de34ba98e y las otras ocho poses. La nueva adquisición oblicua portal dirige el marcador hacia posterior; se elimina la indicación craneal anterior.
**Consecuencias.** Esta rama es una revisión local del atlas experimental, sin integración en main ni validación anatómica externa. La copia describe los mandos actuales, no el cuadro congelado ni el historial hemodinámico. Si escribir al portapapeles falla, ofrece selección manual sin afirmar éxito; no lee el portapapeles. La posición del dueño no certifica anatomía vascular ni corrige los bloqueos de CI del atlas.
**Verificación.** `probePosition.test.ts` conserva precisión y el estado al pulsar. `e2e/probePosition.spec.ts` cubre imagen congelada, controles, escritura denegada y API ausente. `probeOrientation.test.ts` comprueba el marcador posterior de la nueva pose y conserva aparte los20 rayos del plano especular anterior: el nuevo encuadre no es una inversión del plano previo. La revisión local registra imágenes y movimientos físicos; los resultados y límites van en el plan de fidelidad externo, sin atribuir a esta fuente metadatos de adquisición que no expone.

## 192. Encuadrar la rama portal escogida con la caja de color

**Contexto.** La nueva pose elegida sobre34ba98e muestra la rama oblicua por encima de la caja inicial70–125mm. Un ensayo vivo con clics reales en A/B conserva la sonda y muestra la bifurcación al centrar la caja a75mm. Como la fisiología evolucionó entre imágenes, ese ensayo es exploratorio, no una comparación cuantitativa ni calibración vascular.
**Opciones.** Se descarta aumentar ganancia, pintar señal o mover vasos. Cambiar el volumen de interrogación permite observar la estructura ya presente.
**Decisión.** Solo el ajuste de la tarjeta portal intrahepática del atlas toma r47,5–102,5mm, centro75mm y la misma amplitud55mm. `portalPreset` conserva los ajustes de referencia/legacy y del tronco principal, ángulos de caja, PRF, filtro y ganancia. Es un encuadre empírico para esta fuente y pose, no un valor anatómico universal.
**Consecuencias.** La caja incluye más de la rama intrahepática; el usuario puede desplazarla. No cambia anatomía, circulación ni la puerta PW; la rama intrahepática no sustituye automáticamente la medición del tronco principal para VExUS. Persiste el bloqueo de integración del atlas y la revisión clínica externa.
**Verificación.** Contrato y evidencia del experimento local en el plan externo de fidelidad: comparación con el mismo cuadro/estado y control de señal a igual caja, dos casos, poses vecinas, invariantes de ajustes de otros dominios y presupuesto original. No aceptar solo una captura favorable.

## 193. Recupera coherencia entre pose, contacto y haz en la revisión del atlas

**Contexto.** El atlas34 usado para revisar la pose portal conserva el simulador anterior a
PR233/main18. `setPose` cambia los mandos, pero `frame`, compresión CPU y render siguen con
el contacto anterior hasta el siguiente paso físico. Una prueba sobre la base0c reproduce
el desfase en legacy, referencia y atlas. Es distinto de la pérdida de una rama al salir
físicamente del plano: esta corrección no intenta mantener visible una Y.

**Opciones.** Suavizar imágenes, ensanchar vasos o mover el hígado ocultaría el defecto.
Copiar todo main cambiaría campos del atlas y otras adquisiciones. Se recupera el mecanismo
acotado de PR233, conservando la anatomía34 y ampliando el control al atlas.

**Decisión.** `Simulator.setPose` sincroniza el contacto; adquisición y consulta pública de
marco usan ese contacto. El marco del último avance se conserva para estimar velocidad
Doppler. Los ángulos que ya pertenecen al intervalo canónico conservan su número exacto en
`clampPose`: el módulo innecesario cambiaba bits y recalculaba contacto en una pose idéntica.
Las poses fuera del intervalo siguen envolviéndose. No cambia anatomía, haz, color o fisiología.

**Consecuencias.** Un dibujo entre pasos adquiere el plano actual. Mover los mandos con la
imagen congelada mantiene el cine adquirido. La corrección no certifica continuidad vascular,
TAC contrastado ni normalidad anatómica; estas requieren barridos, reconocimiento y comparación
independiente. Esta rama de revisión no es integrable contra la base temporal34; falta
reconciliar atlas y main y resolver el arranque SwiftShader.

**Verificación.** `frameContactCoherence.test.ts`: los tres dominios fallan antes y pasan
con el nuevo contacto; velocidad preservada, congelación intacta y contacto reutilizado en una
pose idéntica. La primera recuperación del mecanismo también detectó el redondeo de la pose,
que se conserva como experimento rechazado. Doce controles focalizados pasan sin modificar
umbrales; barridos nativos y `npm run check` del SHA exacto se documentan en la evidencia del PR.

## 194. Observar el arranque del atlas antes de optimizarlo

**Contexto.** La revisión atlas34 no contiene el observador integrado por PR234. En el SHA7fba26e las tres adquisiciones venosas independientes vuelven a agotar180s antes de hooks/dos cuadros. El control nativo favorable no demuestra arranque en SwiftShader.

**Opciones.** Recuperar el observador ya revisado de main evita otra instrumentación de producción; solo se añaden dos etapas específicas de carga atlas.

**Decisión.** Recuperar el registrador y adjunto host de main/a8570c7 y conservar las etapas alrededor del arranque específico del atlas. Añadir inicio y final de carga de las superficies abdominal y torácica. El host conserva la última etapa recibida incluso cuando el hilo de la página deja de responder; no fabrica una etapa posterior ni exige hooks para informar el fallo.

**Consecuencias.** La traza solo se activa con e2e/startupTrace. No interviene en anatomía, físico, reloj, imagen, calidad, resolución ni presupuestos. No amplía el límite180s de CI y no reejecuta CI fallida. Identifica costes pendientes de medición; no afirma todavía una causa del bloqueo ni corrige fidelidad clínica.

**Verificación.** Catorce controles focalizados pasan en la primera ejecución: etapas únicas, reloj desactivado fuera del diagnóstico, conservación de la última etapa antes de una excepción, capas del torso y coherencia del marco/contacto. La evidencia externa registra la primera adquisición SwiftShader y el control nativo por separado, con fuente exacta, opciones y limitaciones de transferencia Mac/Linux.

## 195. Ensayo acotado de metadatos de cara no consumidos por A0

**Contexto.** Con RAF suspendido y lectura compatible de un píxel por pasada, el atlas4c se bloquea antes de completar transmisiónHits; ninguna pasada posterior se ejecuta. Los tiempos previos de gl.finish se rechazan: eran envíos, no finalización demostrada. No se separa todavía compilación de ejecución.

**Opciones.** No omitir consultas anatómicas ni bajar resolución; ensayar únicamente metadatos no leídos por A0.

**Decisión.** Ensayar una opción de classifyWith que omite solo el postproceso de caras costales y cortical vertebral al consultar A0. A0 consume tejido y normal pulmonar, no iface/ifd/tangent/kc de ese postproceso. Clasificación común de pared, interior, órganos, vasos, obstáculos y normal permanece igual; todas las otras pasadas conservan metadatos completos por la sobrecarga original. No se introduce otra anatomía.

**Consecuencias.** Ensayo rechazado: fuente320e522 vuelve a agotar180s sin hooks ni segundo cuadro. Se conserva su patch y se retira la variante; no se concluye una causa del coste por este resultado. No se considera una corrección demostrada hasta registrar estos resultados. Si no mejora el bloqueo o cambia un observable consumido, conservar y rechazar el ensayo; no ampliar límites ni debilitar pruebas. SwiftShader local tampoco certifica el corredor Linux.

**Verificación.** Contrato y resultados se registran por SHA en la evidencia externa; conservar también ensayos de instrumentos descartados. El check y CI exactos siguen siendo requisitos separados de la fidelidad anatómica externa.

## 196. Un sitio de clasificación para marcha y bisección del espejo

**Contexto.** El readback compatible de4c2892c no completa A0 en210s del diagnóstico; el arranque ordinario falla a180s. El shader llamaba al clasificador común en la marcha y además en un bucle interior de bisección del espejo. Una anatomía compleja puede expandirse dos veces; su coste no se evita ocultando tejidos. La variante de metadatos195 se rechazó por no resolver el bloqueo.

**Opciones.** Mantener un clasificador común; compartir solo el punto de llamada en vez de introducir un campo paralelo.

**Decisión.** A0 utiliza un estado de refinamiento que visita exactamente los seis puntos de bisección originales a través del mismo sitio de clasificación. El índice regular no cambia durante refinamiento; se conserva normal del último punto pulmonar, fronteras, dirección reflejada y actualización de gas. El techo mantiene1024 vueltas regulares más seis de refinamiento, sin agregar muestras regulares. El campo, la clasificación común, geometría, pared, color, resolución y todas las otras pasadas conservan su código original.

**Consecuencias.** No es una segunda anatomía ni un filtro de imagen. La CPU conserva su algoritmo independiente. Ensayo rechazado:25978ad vuelve a agotar180s antes de hooks/dos cuadros; se retira la variante y se conservan su patch y controles. El kernel sintético no certifica fidelidad clínica ni estabilidad de todas las poses. Una diferencia en impactos, dirección o imágenes comparables obliga a rechazar el ensayo.

**Verificación.** e2e/transmissionMirrorState.spec.ts ejecuta el cuerpo real de A0 contra el cuerpo anterior congelado y planos analíticos de pulmón, gas, hueso y cortina, con cinco densidades, dos profundidades y caso de límite de iteraciones. Compara exactamente las tres salidas y verifica dirección y distancia del espejo contra planos independientes. Primer banco nativo de60 casos:46.080 valores idénticos; el banco ampliado y las adquisiciones completas se registran por SHA. Mantener plazos, pruebas, presupuestos y protecciones.

## 197. Ensayo del límite de marcha derivado de la rejilla

**Contexto.** Las variantes195–196 no resuelven el bloqueo. Unificar una consulta anatómica y retirar metadatos no consumidos no prueba que esa sea la causa. El cuerpo de A0 vuelve a4c; cada fila de su marcha regular consume como máximo dos vueltas por cortina.

**Opciones.** Una cota uniforme mínima conserva las muestras. Los tres ensayos fallidos obligan a detener optimizaciones especulativas y obtener una reproducción acotada de coste.

**Decisión.** Ensayar min(1024,2*n) como límite exterior, donde n procede de la uniforme original uCoarseN. Se preservan máximo, todas las muestras posibles, bisección original, clasificación común y salidas. El cambio evita un límite totalmente constante sin afirmar todavía qué hace el compilador.

**Consecuencias.** Ensayo rechazado:689bcc6 emite segundo cuadro y hooks, pero la página sigue bloqueada y agota el presupuesto ordinario de la prueba240s (180s de arranque más60s de trabajo). No completa la comprobación de arranque; se conserva la evidencia y se retira también este límite. No cambia geometría, órganos, rayos, resolución, física, otras pasadas o presupuestos. No se aprueba por tests verdes: exige arranque real, campos e imágenes comparables. Se retirará si no mejora el bloqueo o si cambia un observable. Se conserva la discrepancia del instrumento de trigonometría doble/GLSL, sin esconderla ni ampliar umbrales.

**Verificación.** Los controles heredados de clasificación, jacobiana y bisección se mantienen intactos. Contrato y primeras ejecuciones antes/después por SHA en la evidencia externa. Mac y Linux siguen siendo entornos distintos; fidelidad externa pendiente.

### Reconciliación local del 12 de octubre de2026

Los controles de navegación de `atlasAnatomyHover` y `portalPresentation` conservaban
la pose portal anterior (phi3,25 y z−65mm), incompatible con la tarjeta adoptada
en191. Se sincronizan únicamente sus coordenadas esperadas con la pose elegida
(phi173°, z−40mm, yaw−72°, rock−6°, tilt−2°). No se cambian tolerancias, plazos,
recuentos de cuadros, dominios ni controles de señal/color. La comprobación
unitaria del preset y los20rayos de la pose histórica se conservan. El recorrido
de navegador completo sigue pendiente del arranque Atlas; colección y tipos
no lo sustituyen.
