# Laboratorio de parámetros: primera etapa de estados independientes

## Alcance y límites

El propietario pidió PAD, PIA, función sistólica VD, regurgitación tricuspídea,
distensibilidad venosa/AD/VD y taponamiento, además de progresión gradual 0–3.
Esta etapa expone cinco parámetros que el motor ya acepta al construir un caso.
Cada ajuste crea un **nuevo escenario de equilibrio**, integra la misma red y
adquiere IQ/PW desde sus vasos. No es todavía una intervención causal continua
sobre el paciente previo. La interfaz lo declara antes de activar el laboratorio.

El paciente observado, su reloj, congelación y anatomía no se modifican. El adulto
experimental es sinusal y sin ciclo respiratorio, con hígado y anatomía normales.
La pausa pertenece a la vista. Cerrar o cambiar el caso limpia el experimento.

Taponamiento, distensibilidad sistémica venosa y distensibilidad diastólica VD se
muestran como pendientes. No se simulan alterando el brillo ni multiplicando una
curva. La función VD actual usa la formulación simplificada existente: no equivale
a un ventrículo con elastancia temporal ni a un modelo pericárdico validado.

## Parámetros y progresión

La PAD del caso y PIA se expresan en mmHg; función VD, IT y distensibilidad AD son
parámetros relativos del modelo, no medidas clínicas intercambiables con FEVD,
fracción regurgitante o compliance absoluta. Los rangos numéricos son dominios
experimentales, no umbrales diagnósticos.

Un control continuo combina PAD 5→18, PIA 5→7, VD 0,85→0,30, IT 0,05→0,70 y
AD 1→0,55. No cambia hígado, hábito, frecuencia, semilla ni introduce un grado
en el paciente o en la red. Los botones Guía 0/1/2/3 seleccionan fracciones
0/0,4/0,775/1 de esa trayectoria docente. El grado mostrado se vuelve a calcular
con VCI y patrones fisiológicos, etiquetado **referencia**, distinto de la captura
PW que necesita superar su propio control de calidad. No se fuerza el resultado.

Una auditoría de 41 estados (30 s de integración cada uno) encontró intervalos
desiguales de grado; el grado 2 ocupa un tramo estrecho. El ajuste fino permanece
continuo dentro de cada región. Cuatro ventanas de seis segundos prueban los
cuatro anclajes. Esto calibra una trayectoria de este modelo, no representa todas
las formas de congestión ni valida causalidad entre parámetros correlacionados.
Modificar un parámetro individual muestra «Personalizado»; mover la progresión
vuelve a aplicar los cinco valores de la trayectoria.

## Presión abdominal y confusión

La PIA experimental es una condición mantenida. A partir de 12 mmHg se activa el
contexto ya existente de presión abdominal elevada y se avisa que la interpretación
VExUS es limitada; una VCI pequeña no certifica ausencia de congestión. El umbral
se apoya en las definiciones WSACS, no define por sí solo síndrome compartimental:
https://www.wsacs.org/education/436/wsacs-consensus-guidelines-summary/.

## Coste y verificación

El calentamiento tiene trabajo acotado: 250 pasos por actualización hasta 30 s.
La adquisición inicial reconstruye el historial antes de poner en marcha el
experimento visible. Los cambios sucesivos cancelan el ajuste pendiente y limpian
la señal anterior. Un error numérico se muestra como fuera de dominio; no se
sustituye silenciosamente por otra curva. No se solicitan recursos remotos.

Los contratos comprueban dominios, continuidad paramétrica, aislamiento, ausencia
de un grado en la entrada, reloj acotado, finitud en extremos individuales y grado
calculado en los anclajes. No certifican todas las combinaciones ni transitorios.
La E2E cubre activar, progresar, adquirir, conservar al paciente original, móvil
y limpiar al cerrar. La distribución CI incluye la nueva prueba sin omisiones.

El visor previo conserva el presupuesto mediante transporte GLSL reversible con un segundo banco
de 64 códigos. Los códigos existentes son estables; un prefijo selecciona el nuevo
banco. Los shaders reconstruidos siguen siendo idénticos byte por byte, incluyendo
interpolaciones y escapes. No cambia la física, el shader ejecutado ni los límites.

## Etapas que permanecen abiertas

- Modificación causal continua que conserve volúmenes y estado entre ajustes
- Función sistólica y diastólica VD con mecanismo hemodinámico más completo
- Compliance sistémica y por compartimentos, distinta de rigidez parenquimatosa
- Modelo pericárdico/taponamiento y su interacción con respiración y llenado
- Validación de formas, velocidades, escalas y respuestas con expertos externos

## Hallazgo de revisión visual y ajuste del equipo

La primera captura, anterior a la recalibración territorial renal, mostró
plegamiento con Nyquist 50 cm/s. Ese hallazgo es histórico, no describe la
amplitud del modelo actual. Tras adoptar el territorio provisional del 5 %,
la prueba provoca plegamiento explícitamente reduciendo Nyquist a 20 cm/s
y comprueba recuperación a 80 cm/s, sin cambiar la fisiología. La calidad se calcula y comunica aunque las marcas estén
apagadas. La prueba de navegador exige el aviso, cambia la escala mediante el
control real y verifica que desaparezca la condición no medible.

El filtro de pared pasa a ser configurable por canal (5–50 Hz), aplicado a la IQ
y comunicado al medidor espectral. Bajar su corte no garantiza recuperar una
velocidad inferior a la resolución de la STFT. La porta del anclaje 3 puede
acercarse al filtro; se conserva la advertencia, sin forzar una medición válida.
El grado de referencia fisiológica permanece distinto de esas mediciones.

## Controles y evidencia visual

Los parámetros usan dos columnas en escritorio y una en teléfono, con el valor
al lado de su etiqueta y el deslizador debajo. Se conserva el orden de teclado,
los nombres accesibles y el detalle de mecanismos pendientes. La E2E comprueba
la disposición en ambos anchos y espera que termine la reconstrucción IQ antes
de guardar la captura de controles. Las referencias renales incluyen sano y
congestión en una misma puerta arterial, con el caso explícito en modo docente.
