# Grumos continuos del medio dispersor — contrato previo

Fuente previa: `0d6ed0ae28dc6527000121d7587441bd27b9a051`, atlas abdominal.

**Defecto y aprendizaje.** La ganancia de los grumos usa un hash del piso de
cada coordenada: cambia instantáneamente al cruzar una cara de la retícula de
1,2 mm. Ese salto no representa una interfaz anatómica. Puede añadir focos
cuadrados y cambios artificiales al explorar seno renal, grasa y pared intestinal.
Las ablaciones anteriores demuestran contribución del seno, pero no atribuyen
toda la apariencia intramuscular a este mecanismo.

**Mecanismo y dominio.** Interpolar la potencia positiva de ocho nodos mediante
smoothstep antes de recuperar amplitud. Cada nodo conserva la distribución
log-uniforme y normalización anterior. Pesos no negativos y suma uno conservan
la potencia media del conjunto sin renormalización por pose. Es una aproximación
continua de la concentración de dispersores; no reconstruye grasa, vasos ni
cálices individuales. `[EXTRAPOLACIÓN PROPIA] / NEEDS_CALIBRATION`: paso 1,2 mm,
agrupación por tejido y kernel interpolante; ninguna referencia clínica los calibra.

**Predicción.** El salto de ganancia en una cara de retícula debe tender a cero
con la distancia; para puntos a ±0,00001 mm se exige <0,001 dB. Esa tolerancia
es numérica, no un umbral perceptual ni fisiológico. Potencia media en muestreo
reservado: 1 ±5 %, tolerancia de Monte Carlo. Mantener las pruebas existentes de
potencia, contraste no Rayleigh y estabilidad al inclinar. Menos bloques rígidos
en seno y grasa, sin volverlos uniformes ni borrar la cápsula.

**Invariantes y confusores.** Misma anatomía TS/GLSL/3D, calibres, velocidad,
fisiología, cápsula, PSF, ganancias, semilla, tiempo y fase del receptor. Agrupación
cero devuelve uno exactamente; el interior hepático registrado debe ser idéntico
lejos de interfaces y de la mezcla de la PSF. La grasa de la pared o del campo
profundo puede cambiar incluso en una ventana hepática y no es control negativo.
La nueva textura actúa en todos los tejidos con agrupación, no solo en una
ventana. Carga del Mac, grabación y fase de receptor confunden rendimiento.

**Refutación.** Potencia sesgada, pérdida del contraste del seno, discontinuidad
restante, cambio hepático indebido, regresión visible o coste excesivo rechazan
la propuesta. No aceptar solamente por una captura favorable.

**Aceptación.** Comparar normal/grave, ambos riñones, abanicos vecinos y controles
hepáticos, con estados/tiempo/receptor registrados; inspeccionar barrido manual
y preservar resultados adversos. Check completo y CI del SHA exacto siguen
obligatorios. Referencia independiente: [ACEP, renal](https://www.acep.org/sonoguide/basic/renal-ultrasound)
para seno ecogénico, corteza gris y cubierta perirrenal; no calibra estadística.
Los clips clínicos comparables, phantom y panel humano independiente permanecen
pendientes. El cambio no declara resuelto el límite riñón–músculo ni máxima fidelidad.
