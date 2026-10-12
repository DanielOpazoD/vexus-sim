# Contacto y pose adquirida — historia de la rama Atlas

Fuente: `0c6434671a049374290fe2038db9c326dbb4d85f`, PR226. Las decisiones190/191 se conservan
sin renumerar. Main ya contiene el cruce terminal y una instantánea profunda
del cuadro, incluida la semilla; esta reconciliación conserva ese contrato.
La nueva integración requiere CI exacta y no valida retrospectivamente bancos.

## 190. Completar el último tramo de búsqueda de la pared bajo la sonda

**Contexto.** La adquisición hepatorrenal atlas de4fc5082, pose phi2,99,
z−113mm, yaw−0,244525/rock−0,134064/tilt−0,359148rad, muestra una línea fina
desde la pared hacia colon y riñón. Su nodo de contacto27 informa pared a
69,999mm y acoplamiento0, frente a10,599mm en un barrido independiente de
0,05mm del mismo perfil. El extremo de su intervalo,11,199mm, ya supera el
nivel radial28mm de la pared (28,825mm). La búsqueda en pasos de2mm omitía
la fracción final del intervalo y devolvía ausencia de cruce; eso altera
contacto y deformación local. No es un nuevo hallazgo anatómico ni una sombra
que deba pintarse o esconderse.

**Opciones.** Borrar la línea, suavizar la imagen o fijar acoplamiento1
suprime causas físicas y pérdida real de contacto. Cambiar el preset evita
el testigo sin resolver la búsqueda. Reducir globalmente el paso cuesta más
y tampoco garantiza visitar el extremo.

**Decisión.** Cada tramo termina en min(prev+2mm, fin). Se conserva el paso,
el primer cruce, las18 bisecciones, constantes de gel/presión y el tope de
búsqueda. El último tramo se visita aunque mida menos de2mm. Contacto,
deformación, ecografía y plano continúan usando la misma tabla.

**Consecuencias.** Evita pérdidas falsas de contacto y deformaciones locales
cuando existe un cruce en esa fracción. No cambia la piel fuente, riñón,
colon o musculatura; una sonda realmente levantada sigue desacoplándose.
No convierte esta adquisición en una ventana hepatorrenal representativa:
colon líquido, fascia renal, contacto con psoas y selección del receso siguen
pendientes. El supuesto inicial de que lift8mm despejaba toda una huella
inclinada fue refutado; el control negativo verifica hueco>4,5mm en toda la
huella, sin modificar la física para forzarlo.

**Verificación.** `contactWallCrossing.test.ts` contrasta35 rayos de la pose
registrada y cuatro deslizamientos vecinos con una exploración independiente
a0,025mm de la misma pared. Verifica primer cruce y nivel de profundidad,
además de ausencia de contacto con toda la huella levantada. Pruebas previas
de compresión y pared conservadas. Adquisiciones pareadas/vecinas, cines,
check completo y CI exacta se registran en el PR; tests y una captura favorable
no certifican fidelidad clínica ni continuidad universal.

## 191. Retener pose y transductor del cuadro adquirido

**Contexto.** En capturas congeladas, la animación o el operador puede mover
la pose viva sin cambiar la imagen. El snapshot leía `sim.pose`, mientras
marco, señal y cine correspondían a otro instante. Comparar solo marcos no
detecta controles movidos antes de su siguiente actualización. Dos pares
izquierdos antiguos quedaron sin registro estricto por esta causa.

**Decisión.** El cuadro presentado y el anillo de cine conservan copias de
los seis parámetros de pose y del transductor recibidos al adquirir. El
snapshot versión2 lee esos datos del mismo cuadro que su marco, muestra
también `livePose`/`liveTransducer` y mantiene ambas procedencias separadas.
La validación de comparación estática rechaza poses vivas distintas, datos
no finitos y versiones anteriores sin esa distinción; conserva los demás
controles de dominio, tiempo, señal, errores y marco.

**Consecuencias.** Permite identificar de forma honesta la adquisición
antigua aunque el operador explore con imagen congelada. No impide mover
la sonda, no cambia reloj, física, anatomía ni píxeles, no corrige el preset
hepatorrenal ni la confluencia cava–AD. Los bancos históricos no se migran
ni se declaran registrados retrospectivamente.

**Verificación.** Una prueba de navegador muta los controles congelados,
adquiere en la nueva pose y reproduce después el cuadro antiguo. Contrasta
pose adquirida/viva, marco, tiempo, transductor y hash de píxeles originales;
la comparación estática debe rechazar el estado divergente. Check completo
y CI de su SHA siguen siendo requisitos independientes de integración.
