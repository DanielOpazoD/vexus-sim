# Registro histórico de la rama del atlas

Fuente: `0d6ed0ae28dc6527000121d7587441bd27b9a051`. Las decisiones178–186 pertenecen a esta rama y conservan su numeración original; no sustituyen decisiones de main ni prueban integración.

## 178. Abdomen común de referencia: contornos, contactos y acústica explícita

**Defecto y aprendizaje.** Unas asas parciales y riñones anteriores enseñan relaciones anatómicas falsas. La columna infinita previa además atraviesa la pelvis. El conjunto BodyParts3D 4.0 contiene interpenetraciones entre superficies de órganos; importar sus vértices sin auditar no garantiza contacto anatómico correcto.

**Mecanismo y dominio.** Un único registro LAS milimétrico de órganos, columna lumbar, sacro, discos y psoas; campos a 1,5 mm compartidos por CPU, GPU y superficie 3D. Adulto de referencia, sin afirmar población representativa. Contornos fuente conservados para hígado, riñones, páncreas, vesícula y vejiga; las superficies de apoyo psoas y discos se reconcilian fuera de esos volúmenes; las asas móviles se conforman también fuera del psoas. Es una modificación derivada explícita del atlas, no nueva segmentación clínica. Bazo, capas digestivas, gas estático y propiedades acústicas son aproximaciones.

**Predicción.** Los riñones quedan posteriores, con el izquierdo superior; la vejiga no contiene hueso. Ningún par de campos interiores debe interpenetrar más de una celda (1,5 mm). La reconciliación no debe crear conexiones ni cerrar cortes digestivos adicionales: se exige el mismo número de componentes y una pérdida de volumen menor de 10% por campo modificado. Dichos límites son controles de derivación, no tolerancias clínicas.

**Invariantes y confusores.** No desplazar o escalar órganos individualmente; conservar el marco fuente y el registro vascular. Mantener el modelo anterior como cohorte de regresión explícita. No pintar flujo sobre tejidos: lumen, dirección del haz, velocidad Q/A y procesamiento deciden el color. Un atlas de superficies no suministra textura ecográfica ni histología.

**Refutación y aceptación.** Fallar si persisten penetraciones profundas, el intestino pierde continuidad, una malla no corresponde a su campo acústico, CPU/GPU discrepan o el banco de ventanas del nuevo abdomen no obtiene las estructuras previstas. Comprobar hueso/gas con su pérdida acústica, lumen vesical anecoico, estratos intestinales y ramas arteriales/venosas. Inspeccionar imágenes reales del programa junto a referencias AIUM. La comparación clínica externa y la revisión docente permanecen pendientes; pruebas verdes no certifican fidelidad máxima.

#### 178 — Incidencias de derivación y resolución de celda

La primera rasterización incluía toda celda atravesada por la superficie y sobredimensionó un disco (~16 ml frente a ~12 ml fuente); se rechazó. La consulta interior inicial sin soldar las costuras OBJ produjo 223 componentes en discos y fue rechazada. La fuente contiene posiciones duplicadas por costuras: se sueldan posiciones coincidentes, sin trasladarlas, se retiran caras duplicadas/degeneradas y se documenta el cierre de orificios pequeños. El interior se determina con intersecciones de triángulos, conservando la resolución de 1,5 mm.

Los componentes de rasterización aislados que caben en una celda de 3 mm (máximo ocho centros a 1,5 mm, 0,027 ml) se excluyen y se registran sus coordenadas antes/después del contacto; ningún fragmento mayor puede retirarse para conseguir aprobación. El rechazo anterior de un fragmento muscular de ~10 ml y de >10% de pérdida permanece válido. Se mantienen los límites de continuidad y de 10% para las superficies modificadas; esos controles no son una tolerancia clínica. El intestino debe adaptarse al apoyo posterior fijo, en vez de recortar el psoas atravesado por un asa. Las propiedades internas renales, intestinales y esplénicas siguen estimadas.

#### 178 — Adquisición y evidencia del abdomen nuevo

Se descartaron dos bancos locales de nueve capturas: mover directamente `sim.frozen` no sale del cine de la interfaz y mantenía un fotograma anterior. Sus mapas numéricos no prueban la imagen mostrada. El banco de adquisición usa tarjetas reales, espera la llegada de la sonda y cuadros nuevos, y congela con el botón del equipo. La rama portal necesita una caja centrada en θ=0 para este registro; los ajustes previos del cuerpo procedimental quedan en su cohorte. La búsqueda offline ahora evalúa `pvRight`, no el tronco extrahepático, para esa ventana. No cambia el signo físico ni pinta sangre fuera del vaso.

La adquisición venosa rechazaba perfiles exteriores iguales porque la expansión de hábito crea una copia por escena. Se compara ahora todo el perfil en coordenadas exactas, preservando el rechazo si cambia su longitud, presencia o cualquier radio/centro. Las nuevas pruebas exigen puertas acústicas hepática, portal principal y venosa interlobar, sangre observada y columnas espectrales en sano y congestión grave. Los bancos anteriores se ejecutan explícitamente con `abdomen=legacy`; se añaden bancos del atlas para color portal, planos de órganos y comparación renal venosa/arterial. No se presentan las coordenadas antiguas como validación del abdomen nuevo.

La inspección clínica sigue siendo una comparación cualitativa, no un veredicto externo humano. El gas puede interponer sombra/reverberación sobre la vejiga poco llena; todavía no se afirma imagen vesical limpia en toda posición. Las ventanas de partida no sustituyen la búsqueda ecográfica.

Los capturadores históricos que rotulan «legacy/reference» deben seleccionar explícitamente `abdomen=legacy`: el atlas por defecto impediría la cohorte legacy y haría fallar su aserción de perfil. Su validación no se atribuye al abdomen nuevo, que tiene bancos propios. El generador de superficie comprueba el hash del campo fuente y el banco recorre vértices de las once superficies contra el nivel cero acústico (tolerancia numérica de 0,001 mm, no clínica).

### Contrato de aislamiento de la anatomía compilada (PR 219)

La primera CI del abdomen pierde el contexto WebGL en SwiftShader, incluso con `abdomen=legacy`; el mensaje de subida del atlas consume el error del contexto perdido y no demuestra que la textura sea su causa. Hipótesis por comprobar: el compilador conserva todas las ramas de ambos modelos al depender de un uniform. Cada renderer mantendrá su modelo geométrico durante su vida y compilará ese selector como constante, sin cambiar geometría, señal ni tolerancias. Cambiar entre pacientes del mismo modelo sigue admitido; cambiar de modelo requiere reconstruir el renderer y debe fallar explícitamente. La refutación es cualquier pérdida de contexto, imagen vacía o divergencia CPU/GPU tras la especialización. Se exige comprobar ambos modelos con los bancos reales; una prueba que sólo pase en Metal no basta para aceptar SwiftShader.

La ejecución local `11-cohort-publish-hook.log` se interrumpió tras agotar 60 s en una prueba histórica de equivalencia bajo carga compartida; no es un aprobado ni una validación del árbol posteriormente editado. La CI de la primera cabeza pasó lint/tipos/cobertura/build y matrices de CPU, pero falló bancos WebGL. El primer fixture del selector incluía la pasada de transmisión que sólo consume resultados, sin anatomía; se corrigió al programa real de impactos sin cambiar criterios. Los registros fallidos se conservan.

La primera ejecución rápida con especialización pasó 1171 pruebas y falló 13 de cableado que identificaban programas por el texto original sin especializar. Los fixtures ahora usan las fuentes compiladas del mismo modelo y conservan los controles de uniform, adjunto, programa y rechazo de compilación. Se conserva la textura completa histórica de cuatro bytes para mantener también el contrato de todos los samplers declarados, sin cargar el atlas.

### Interpolación acotada del campo abdominal en GPU (PR 219)

La especialización corrigió los bancos históricos, pero las tres repeticiones de adquisición del atlas aún perdieron el contexto durante el arranque (5743515). La textura aislada de 82.147.520 bytes sí se sube a SwiftShader local sin error/contexto perdido; por tanto no se atribuye el fallo sólo al tamaño. El interpolador explícito de ocho texels se expande en muchas llamadas de distancia/gradiente dentro de las pasadas anatómicas. Se sustituirá por la interpolación lineal RG16F de WebGL2, con coordenadas de centro de texel y límites del mismo ladrillo. La etiqueta categórica conserva `texelFetch` al vecino más cercano. El campo, hashes, coordenadas CPU, geometría y criterios de aceptación se conservan; una divergencia interior o pérdida de contexto refuta la mejora. Debe pasar el banco CPU/GPU completo y los bancos de producción en SwiftShader, además de Metal. La precisión de los pesos de interpolación depende del driver; no se afirmará identidad bit a bit de distancias.

## 179. Contacto hepatodiafragmático registrado y suprahepáticas proximales

**Defecto.** La cúpula heredada dejaba una capa de grasa ficticia: en 5.639 cruces superiores hepáticos, mediana 33,75 mm, máximo 46,07 mm y penetración mínima −8,63 mm. Un eje suprahepático heredado cruzaba la superficie superior; las vistas anteriores no resolvían estas incompatibilidades del atlas.

**Mecanismo.** Contrato previo `anatomy/hepatic-diaphragm-contract.md`. Tabla altura/soporte RG16F en un plano libre del volumen existente, sin incrementar dimensiones/memoria/samplers. En contacto, músculo como cáscara 2,5−SDF hepático y transición unilateral inferior 6..12 mm. La malla 3D resuelve el cero del mismo campo. Los once campos/etiquetas de órganos permanecen idénticos. Aproximación explícita; FJ3131 sigue sin integrarse.

**Vasos y adquisición.** FJ2416/FJ2415 proximales registrados en el mismo marco, media/tributarias/conectores estimados, incompatibilidades distales rechazadas documentadas. Continuidad real de uniones y centros dentro del hígado o unión cava, fuera del lumen digestivo. Dos poses recalibradas fuera de línea, sin autoorientación durante examen. La generación periférica se acota a la capacidad común de 128 tubos, reservando todos los principales y conductos. La primera prueba de arranque encontró este exceso; no se elevó el presupuesto. Porta principal PW selecciona profundidad/foco propios 160/130 mm.

**Orientación y aceptación.** Marca física azul en cara superior del transductor, rígida con su rotación. Vista portal equivalente con extremo marcado craneal, sin cambiar sus rayos materiales. Prueba independiente de contacto desplazada respecto de los nodos de construcción; tolerancia 1,5 mm sin ampliar. Testigos CPU/GPU normal/grave, geometría 3D, adquisición PW y controles reales de las nueve ventanas. Los fallos de aproximación tangente, eje vascular, arranque y bracket de malla se conservan; pruebas verdes no certifican fidelidad máxima ni revisión clínica externa.

## 180. Caja costal y columna torácica del mismo adulto que el abdomen

**Contexto.** La mezcla de arcos elípticos, extremos posteriores recortados y cuerpos vertebrales separados 31 mm no reproduce las articulaciones costovertebrales. El primer arco alcanza casi 14 cm lateralmente frente a unos 7 cm de la fuente. El bazo estimado intersectaba las costillas izquierdas 9/10 hasta 3,18 mm en 207 muestras óseas interiores.

**Opciones.** Retocar el dibujo 3D conserva una discrepancia con las sombras ecográficas. Ajustar más elipses no reproduce cabezas, cuellos, torsión ni estrechamiento superior. Se elige un campo de las 24 costillas, 12 vértebras torácicas, manubrio/cuerpo/xifoides y los cartílagos fuente 1–7.

**Decisión.** Contrato previo `anatomy/costal-correction-contract.md`. BodyParts3D 4.0, mismo registro LAS/mm y origen que las vísceras, sin transformaciones individuales de huesos. Campo RG16F de 192×153×256 a 1,5 mm (30.081.024 bytes). Paridad de rayos para el signo y distancias exactas a triángulos en una banda de 3 mm; sin suavizado ni puentes artificiales. Retirada declarada de fragmentos de hasta ocho vóxeles, ninguno de costillas. La asignación de cartílago no sobreescribe hueso en solapamientos de la fuente; el primer banco independiente detectó esta deuda. CPU/GPU leen el mismo campo; la superficie 3D se extrae fuera de línea del cero, con normales compartidas sin cambiar posiciones. T11/T12 ya están presentes en el campo lumbar registrado y no se dibujan dos veces. El bazo estimado se desplaza 5 mm medialmente; todos los demás bytes abdominales se conservan.

**Consecuencias.** La sombra sigue el hueso registrado al mover la sonda. Marco, escala, asimetría bilateral, recorrido y extremos libres 11/12 conservan la anatomía fuente. Se añade un sampler, dentro del límite WebGL2 de 16, y una textura adicional acotada a 48 MiB. Se mide el coste real de bundle sin aumentar presupuestos para ocultar un incumplimiento. Permanece la alternativa procedural explícita y sus pruebas. El atlas de un adulto no certifica normalidad poblacional ni fidelidad clínica máxima; no se segmentan cartílagos 8–10, discos torácicos ni la movilidad respiratoria costal. La discretización no resuelve íntegramente los espacios articulares.

**Verificación.** 96 puntos interiores de las 24 mallas originales y 40 espacios intercostales verificados por geometría triangular/contención sin consultar el campo acústico. Pruebas CPU y CPU/GPU en adquisición de producción, 72 encuadres con mandos reales en las nueve ventanas, vistas anterior/lateral/posterior y auditoría de relaciones con hígado, riñones, bazo y páncreas. Evidencia local en el informe de entrega; se conservan las primeras capturas dentadas y el fallo de precedencia de cartílago. Una corrida nativa no sustituye la CI Linux/SwiftShader; no se fusiona el borrador #219 por estos resultados.

La auditoría superficial posterior refutó el refinamiento de la unión ya rasterizada: pequeñas separaciones articulares se cierran en la rejilla y algunas superficies quedan a 3,47–5,52 mm del cero, aunque sus separaciones fuente son menores de una celda. Cambiar sólo el vecino elegido no lo corrige. Cada pieza ahora se refina por separado, con su signo interior propio, antes del mínimo de campos; la etiqueta interior conserva la prioridad ósea. Las consultas por cajas de triángulos se contrastan con un oráculo independiente a 1e−6 mm. El mínimo conserva el cero exterior, pero no es distancia euclídea exacta a la superficie de la unión dentro de piezas solapadas. Se conservan las métricas y fallos anteriores, y el contrato de resolución. Tres testigos articulares fuente rechazan la implementación anterior sin cambiar el umbral de una celda; la superficie 3D regenerada se comprueba contra el cero acústico de todas las piezas.

## 181. Cerrar el campo de los cuadrados lumbares en la pared posterior

**Contexto.** Dos bandas rojizas sobresalían detrás del cuerpo y de la columna. Son las superficies del cuadrado lumbar estimado: el campo aislado admitía profundidades negativas respecto de la pared interna y no tenía frontera posterior. La clasificación acústica resolvía antes la pared y ocultaba la extensión; la extracción 3D no tenía esa precedencia. El control negativo falla en ambos cuerpos: exceso máximo de 91,31 mm en el procedural y 56,20 mm en el atlas, medido contra la cara interna corporal.

**Opciones.** Ocultar las mallas impide identificar el músculo. Recortar sólo su dibujo deja dos geometrías. La frontera ausente pertenece al campo compartido y no requiere otro atlas o volumen.

**Decisión.** Contrato previo `anatomy/posterior-muscle-contract.md`. Se añade la frontera externa al campo CPU/GLSL con la misma normalización de pared. La malla conserva la función compartida y ambos músculos; no se ocultan ni se recortan sólo en pantalla. Datos y registro de vísceras/costillas, límites y calibración vascular se conservan.

**Consecuencias.** La forma y las inserciones del cuadrado lumbar siguen estimadas; esta reparación del dominio no certifica anatomía individual ni fidelidad clínica. La validación Metal no sustituye CI/SwiftShader ni habilita integración con presupuesto incumplido.

**Verificación.** Control negativo exterior, inspección de todos los vértices contra la pared en ambos cuerpos (error de extracción <1,5 mm), regresión retroperitoneal y paridad/adquisición nativa. Con la contención, el exceso máximo medido respecto de la cara interna baja a 0,014 mm en el procedural y 0,069 mm en el atlas; ninguna superficie queda fuera de la piel. Ambos músculos permanecen presentes.

El nuevo banco GPU aislado conserva el rechazo exterior pero refuta la paridad de 0,001 mm: el redondeo histórico a cuatro decimales de la cota lateral produce un error de 0,001102 mm. Se aumenta sólo la precisión de ese literal GLSL a ocho decimales, sin cambiar la constante CPU ni el umbral del banco. La primera ejecución fallida se conserva; no se presenta como CI verde ni se acepta mediante reintento sin corregir el defecto.

## 182. Registro posterior, contacto hepático y lente convexa coherentes

**Contexto.** La captura intercostal atribuye el espacio perihepático no segmentado
al mesenterio; una aproximación diafragmática tangente atraviesa hígado a más de
5 mm de su borde. El QL heredado usa niveles distintos de los huesos importados.
La lente 3D está girada en otro plano y su apertura de 62 mm no coincide con la
cuerda de 67,1 mm del sector radial de 68°.

**Opciones.** Agrandar hígado/ocultar interfaces; mover sólo mallas; o corregir
obstáculos, dominios y registro compartidos, declarando lo que falta segmentar.

**Decisión.** El campo hepático es un obstáculo del diafragma en CPU/GLSL, con
transición continua acotada a 4 mm. El QL atlas queda entre la inserción estimada
sobre costilla 12 y cresta ilíaca registrada: sección oval, dorsal al psoas,
anterior a los arcos lumbares, fuera de hueso, psoas y grasa renal. Su malla usa
el mismo campo. La lente tiene eje elevacional y arco en el plano acústico; su
huella genérica se deriva del radio/sector radial, sin cambiar el sector ni
alegar especificaciones de un fabricante. El residuo sin segmentación no
recibe nombre de mesenterio fuera del territorio estimado del intestino delgado.
Se conservan sus parámetros acústicos y la reflectividad capsular efectiva.
La guía lo muestra gris con aviso de estimación.

La búsqueda geométrica de 180 encuadres conserva el hígado y los vasos:
intercostal φ2,60/z−35 mm/rock−0,08959, flanco φ3,20/z−90 mm/rock0,47078.
En 25 rayos directos con paso2 mm, sin atravesar hueso/pulmón, las muestras
suprahepáticas intercostales pasan de 4 a23, las de cava en flanco de3 a46.
No son una métrica de sensibilidad clínica ni la transmisión de la apertura.

**Consecuencias.** Datos fuente de todos los órganos/costillas sin cambios.
No se elimina un artefacto real ni se blanquea la imagen bajando reflectividad.
El borde capsular periférico, la pared lateral y la entrada del pulmón todavía
requieren conciliación de superficies y revisión humana independiente; el
relleno marcado como estimado no constituye anatomía de alta fidelidad.

**Verificación.** Contrato `anatomy/right-hepatic-window-contract.md`; controles
negativos conservados, campos hepáticos completos, lente vs. orígenes reales de
rayos, vértices 3D y paridad CPU/GPU. Tipos, lint y formato pasan; 97 pruebas CPU en 13 archivos y 16 pruebas
de producción nativa Metal pasan, sin reintentos. Exploración de 72 poses
(nueve ventanas, controles reales ±10° de rotación y ±8° de abanico/basculación;
normal y congestión grave) sin errores. Once poses muestran diferencias
de 1–3 muestras de 2048 en fronteras CPU/GPU: no se declara equivalencia
exacta en esas fronteras. Calibración idéntica a la previa.
El build compila pero el gate de bundle falla: 1090,3 KiB > 1078 KiB.
No se eleva el presupuesto, no hay CI de esta rama ni promoción a main.
Artefactos locales 226: pruebas, auditoría de poses y capturas del programa.

## 183. Apposición hepática costal y marcador intercostal posterior

**Contexto.** La decisión 182 corrige el nombre del relleno, pero deja unos 30 mm
entre la cara interna de pared y el hígado en un rayo lateral. Las costillas
registradas que quedan más profundas que la pared estimada producen atenuación
ósea sin dueño cortical externo. El marcador intercostal apunta hacia anterior.

**Opciones.** Agrandar el hígado, cubrirlo con grasa o pintar un arco brillante
oculta el defecto. Se conserva la fuente visceral/vascular/esquelética y se
reconcilia sólo el contorno corporal estimado y la propiedad de interfaz.

**Decisión.** Contrato previo `anatomy/hepatic-costal-apposition-contract.md`.
Un perfil de pared interpolado de 53 filas apoya su cara interna sobre el campo
hepático en el territorio lateral, con resguardo de órganos y hueso. Piel/pared
siguen estimadas, no una nueva segmentación. Fuera de este territorio se conserva
el contorno anterior. La textura común CPU/GPU pasa de 7 a 10 filas, sin sampler
adicional. No se modifica ningún dato binario de anatomía ni parámetro acústico.
La cortical registrada puede pertenecer al tejido adyacente fuera de la pared;
la entrada ósea y su transmisión permanecen activas. El marcador de la ventana
oblicua se invierte rígidamente hacia axila posterior (ACEP); después se recalibra
la pose atlas sobre el nuevo contorno. La revisión de las nueve ventanas detecta pérdida del
tronco portal y del encuadre subcostal/hepatorrenal; se reorientan estas poses
hacia sus vasos y riñón registrados, sin mover tejidos. Las ventanas coronales
conservan marcador craneal. El barrido virtual hepático mantiene sus 2° físicos con el signo local
correspondiente al marcador invertido, sin corregir velocidades ni puertas.

**Consecuencias.** El espacio costal evaluado deja de representarse como una capa
mesentérica. La piel adaptada no certifica anatomía clínica individual; aún falta
reconciliación costofrénica/respiratoria y revisión ecográfica humana. La malla
fuente del hígado cruza hasta 0,32 mm la cara interna interpolada en el muestreo
completo de vértices: discrepancia superficial subcelda del campo de 1,5 mm, no
contacto geométrico exacto. Los demás órganos fuente quedan dentro de la pared.
Se conserva el fallo del intento con resguardo uniforme de 2 mm: su separación
máxima superaba la tolerancia del contrato; no se relaja ésta para aceptarlo.

**Verificación.** Controles negativos conservados en artefactos locales 227.
42 contactos fuera de retículo cumplen tolerancia de 2,5 mm; cortical anterior
a hueso auditada en CPU/GPU y sombra de adquisición real. Las 1206 pruebas
rápidas y 23 regresiones finales de poses/documentación pasan. Se verifican
16 pruebas nativas distintas de producción (Metal, sin reintentos), incluida
la cortical con imagen actual adquirida tras descongelar por la interfaz.
Exploración de 72 poses con mandos reales en nueve ventanas más 24 poses de
los tres presets recalibrados, normal y congestión grave, sin errores de ejecución.
Los histogramas CPU/GPU difieren en 25 encuadres por 1–9 muestras de 2048: no
se declara equivalencia exacta en fronteras ni se usa el conteo como validación clínica.
Calibración idéntica al registro 226. Tipos, lint y formato pasan. El build compila
pero su presupuesto sigue rojo: 1092,7 KiB > 1078 KiB. Sin aumento de presupuesto,
CI de esta rama ni integración a main; entrega exclusivamente local.

La revisión visual posterior refuta el primer preset hepatorrenal de esta
corrección: atravesar geométricamente el riñón no demuestra que se vea, porque
una costilla interpuesta lo oculta. Se conserva la captura y el control negativo
(49 muestras renales con transmisión >1 % en una rejilla de 2048). Se adopta una
entrada inferior φ3,00/z−115 mm, marcador craneal, con imagen nueva verificada:
94 de126 muestras renales accesibles, hígado presente (164 muestras) y extensión
radial de45 mm. Son métricas instrumentales de este encuadre, no validación
clínica ni medida de la longitud renal. La nueva regresión de adquisición exige
ambos órganos y disponibilidad acústica en normal/congestión, sin ocultar hueso
ni reducir su sombra. Persiste sombra costal periférica física.
Las dos regresiones finales pasan sin reintentos; el total de pruebas nativas
pertinentes verificadas asciende a18. Pasan tipos, lint de los archivos modificados
y siete regresiones de orientación/documentación. El presupuesto del build
continúa incumplido y la entrega sigue siendo local.

## 184. Contacto continuo y criterios anatómicos de las nueve ventanas

**Contexto.** Al deslizar 0,001 mm sobre z−100 mm, la normal puntual del perfil
subcostal gira 51,38° y el punto a 100 mm cambia 86,70 mm. Después de corregir
ese marco, un arrastre real encuentra otro salto de 5,74 mm de la cara por
0,038 mm de deslizamiento: el módulo del gradiente usado para limitar presión
también es discontinuo. En subcostal persiste separación anterior etiquetada
como mesenterio y un preset VCI apunta por tórax. El Worker del plano utiliza
el perfil abdominal crudo y no recibe el atlas costal de la adquisición.

**Opciones.** Fundir cuadros o ocultar tejidos según el nombre de ventana
rompería la causalidad. Duplicar el ajuste corporal en el Worker conservaría
inconsistencias de registro. Densificar a 5 mm el perfil no corrige todos los
contactos y empeora algunos: se conserva ese intento fallido en los artefactos.

**Decisión.** `probeFrame` estima el plano de apoyo sobre cuerdas de la misma
piel a medio espesor elevacional. `contact.skinGap` estima su escala de distancia
con diferencias finitas de ±1 mm; la elipse analítica legacy no cambia. Ambos
son controles espaciales, sin interpolación temporal de imágenes. Se amplía
el ajuste parietal anterior derecho preservando vísceras/hueso y el campo fuente;
no se modifican órganos para fabricar una ventana. `cutMapWorker` recibe el
perfil efectivo y el atlas torácico exactos, y construye la escena con ese
perfil sin reajustarlo. El picking usa coordenadas polares de la piel registrada.
Las entradas atlas de VCI longitudinal y VSH se reorientan transhepáticamente;
la primera se centra en VCI intrahepática con marcador craneal y basculación
casi neutra, evitando el 56 % de acoplamiento del encuadre anterior.

El [contrato](anatomy/movement-subcostal-contract.md) precede las correcciones.
La [matriz de aceptación](anatomy/vexus-window-acceptance.md) reúne por ventana
estructuras esperadas, condicionales e impropias, marcadores, cortical/sombra,
gris, color y PW, movimientos y validación pendiente. Sirve al objetivo de
adquisición/anatomía antes de añadir funciones.

**Consecuencias.** Se elimina el giro discontinuo al cruzar celdas y el salto
reproducido de presión. La normal de apoyo, el perfil corporal y la presión
siguen estimados: no son una pared biomecánica validada ni prueban fidelidad
máxima. 36 contactos anteriores derechos cumplen 2,5 mm, tolerancia instrumental
del atlas de 1,5 mm; el dominio ampliado inferomedial aún tiene tres huecos de
3,29–9,01 mm. El máximo cruce de la malla hepática fuente con la pared ajustada
es 0,75 mm, discrepancia subcelda. No se ocultan ni se dan por resueltos estos
fallos, los ecos capsulares pendientes ni la variabilidad clínica.

**Verificación.** La base `ff932ee` falla los nuevos controles de normal y
apposición. El test adicional de presión reproduce 5,72 mm sin la corrección
y pasa con ella; 20 pruebas de apposición/compresión y 1209 pruebas rápidas
pasan, junto con tipos y lint. Las pruebas de adquisición nativa incluyen Worker
real, campo central hepático, cortical/sombra, hepatorrenal normal/congestión,
color portal/inversión y controles de mala adquisición. Los artefactos locales
`228` conservan capturas, barridos, diferencias CPU/GPU y el informe de entrega
con el SHA final y resultados, sin reintentos. El conteo de etiquetas no se
considera visibilidad acústica ni validación humana. El build compila, pero el
presupuesto sigue rojo: 1094,7 KiB frente a 1078 KiB. No se cambia el límite;
esta iteración se entrega localmente y no se integra a main por esa deuda.

La verificación nativa de `e8481ff` detecta una regresión hepatorrenal real:
sólo 78/126 muestras renales superan 1 % de transmisión (61,9 %, frente al
criterio instrumental >65 %). Se conserva el fallo normal y grave, sin reducir
el umbral. Un barrido espacial de 15 poses confirma que desplazar la entrada
2 mm cranealmente y φ−0,01 despeja la costilla tangencial: 88/109 muestras
accesibles (80,7 %), con 214 hepáticas y 42,19 mm de extensión radial. Se adopta
esa adquisición; no se cambia el riñón, la sombra ni el contacto corregido.
La regresión espera ahora el punto exacto antes de medir. Los resultados finales
se registran sobre el nuevo SHA, separadamente de la ejecución fallida.

## 185. Evidencia reproducible de las nueve ventanas

**Contexto.** El banco anterior recorre cuatro presets y no declara el modo
anatómico. Una primera captura de VSH tomada antes de concluir la animación
y ajustes portales heredados muestran que el instrumento puede introducir
errores de comparación. La auditoría visual sigue encontrando interfaces
hepáticas segmentadas y una adquisición epigástrica poco reconocible.

**Opciones.** Duplicar las poses o generar ilustraciones separaría la evidencia
de la adquisición real. Un número fijo de cuadros no acredita asentamiento.
Una comparación con reloj/historia distintos tampoco aísla un cambio de señal.

**Decisión.** `fidelity:audit` reutiliza `startPointsFor`, `comparisonState` y
`captureBMode`. Exige atlas/legacy explícito y registra versión, árbol fuente,
hashes anatómicos, caso, semilla, pose/marco presentado, reloj, compresión,
respiración, ajustes y GPU. El protocolo UI usa las tarjetas y congelación
reales; el estático declara el reinicio de historia y un instante físico común.
Los PNG y manifiestos se guardan fuera del checkout en ejecuciones únicas.
`acquisitionSnapshot` rechaza cuadros con geometría/tiempo inconsistentes.
El [contrato previo](fidelity/ITERATIVE_REVIEW.md) fija dominio y refutación.

**Consecuencias.** No cambia anatomía ni render y no añade código al bundle.
La integridad de adquisición se separa de `clinicalAcceptance: pending`:
no certifica la ventana ni valida una población. El banco actual cubre dos
casos y nueve ventanas; aún faltan cines/barridos y referencia clínica reservada.

**Verificación.** 18 adquisiciones UI y 18 estáticas a 30 s sobre `a37cdfe`,
Metal Apple M4, sin errores del navegador y con procedencia conservada. Los
fallos iniciales del instrumento se retienen en otras ejecuciones. Cinco
controles negativos detectan cine atribuido a otra pose, tiempo inconsistente,
modo/caso incorrecto, color activo, valores no finitos y errores del render.
Los 16 tests focalizados, tipos, lint y formato pasan. Las verificaciones
completas y la CI exacta son requisitos separados antes de integrar.
La primera comprobación completa pasa 187 suites pero falla los dos casos
de `abdominalAcquisition`: `AcousticWindowUnavailableError` en renal. El cambio
de instrumento no modifica fuentes de anatomía/adquisición ni render; el fallo
se conserva en `fidelity-loop-20261007/p01-check.log` y bloquea integración.

## 186. Ventana epigástrica transhepática y plano venoso renal

**Contexto.** En el banco basal, gas intestinal oculta ambos vasos posteriores
en epigastrio. Además, la adquisición venosa renal no encuentra un margen
parietal de 1,2 mm en normal/grave. La prueba inicial no cargaba atlas torácico;
con la misma fuente costal del usuario falla igualmente. Una imagen de riñón
no demuestra que se pueda adquirir una interlobar.

**Opciones.** Suprimir gas, mover órganos o reducir el margen de puerta
alteraría el problema. Se investigan poses vecinas conservando campos fuente,
sombras y criterios de adquisición. La selección geométrica no basta: los
candidatos se capturan con el render real antes del ajuste.

**Decisión.** Solo `ABDOMINAL_POSES` cambia. La entrada epigástrica se desplaza
45 mm cranealmente con marcador transversal y pequeño abanico; alcanza aorta
y VCI por hígado, con vértebra detrás. La renal conserva piel, giro y
basculación, abanicando 0,05 rad hacia la vena. No cambia ningún órgano/vaso,
señal, sombra ni pose legacy/referencia. Los contratos
[epigástrico](anatomy/epigastric-acquisition-contract.md) y
[renal](anatomy/renal-acquisition-contract.md) preceden el código.

**Consecuencias.** Se recupera una entrada epigástrica interpretable y una
puerta renal con el criterio vigente. Las interfaces punteadas y apariencia
renal siguen siendo deudas: no se certifica fidelidad por el gate. La revisión
humana, barridos completos, presupuesto y CI exacta continúan requeridos.

**Verificación.** Los dos controles epigástricos fallan en la base por gas;
con el ajuste pasan en normal/grave, con hígado anterior, marcador derecho,
aorta posterior a cava y hueso detrás. Los dos tests de adquisición atlas
fallan antes y pasan después del abanico renal, sin cambiar 1,2 mm ni sus
aserciones de sangre/espectro. El banco UI produce cuatro capturas completas
sin errores sobre `2d2c51f` con árbol modificado/hashes conservados: vasos y
sombra vertebral epigástricos reconocibles en ambos casos, riñón mantenido en
plano. Se conservan candidatas rechazadas y resultados previos. `calibrate`,
tipos y lint pasan. La prueba de otro minificador se rechaza: sube el total
de 1094,8 a 1146–1148 KiB; se retira la dependencia sin aumentar presupuestos.
