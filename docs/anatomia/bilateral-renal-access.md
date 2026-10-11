# Acceso posterior renal bilateral

La exploración renal izquierda necesita poder alcanzar el flanco posterior
izquierdo. En la versión de PR231, el límite de posición admitía hasta φ216° a
la derecha y sólo hasta φ−9° a la izquierda. La posición contralateral del
punto renal derecho, φizquierdo = π − φderecho, quedaba recortada.

El control geométrico conserva la superficie corporal real: la referencia es
asimétrica y no se refleja un riñón para crear el otro. El recorte desplazaba
el contacto solicitado 45,97mm en el cuerpo procedural y 7,70mm en el de
referencia. El ensayo nativo con arrastre real confirmó que la sonda dejaba de
avanzar en φ−9°, aunque el operador continuaba desplazándola.

El límite izquierdo pasa a φ−36°, la reflexión del límite derecho existente.
Es un límite de exploración del modelo en decúbito supino, no una medida
anatómica ni una afirmación de que ésa sea la mejor ventana renal clínica.
La superficie, los riñones, la acústica, la presión y los límites de
basculación/inclinación conservan su geometría y sus mecanismos causales.

`bilateralFlankAccess.test.ts` comprueba el contacto y el marco completo del
haz en la superficie de ambos cuerpos y que las nueve posiciones de partida
siguen siendo alcanzables. No certifica reconocimiento anatómico ni calidad
ecográfica. La evaluación de la imagen izquierda, poses vecinas, sombras,
grasa y músculos requiere adquisiciones registradas y movimientos reales.

Las relaciones renales/fasciales y el mapa muscular TAC se revisan en
`posterior-renal-ct.md`. La revisión externa y la incorporación de anatomía TAC
siguen pendientes; alcanzar una posición antes bloqueada no resuelve esas
deudas ni crea un Doppler renal izquierdo validado.
