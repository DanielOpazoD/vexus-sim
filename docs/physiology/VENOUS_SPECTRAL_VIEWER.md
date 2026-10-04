# Visor comparativo de Doppler pulsado simulado

## Contrato visual y de señal

La vista inicial son tres imágenes de potencia espectral, no curvas Q/A engrosadas.
Cada territorio usa la cadena existente de dispersores espaciales persistentes,
IQ compleja, filtro de pared de 15 Hz y STFT Hann de 128 muestras / salto de 16.
El mapa de grises representa potencia con el mismo rango de 45 dB del PW principal.
No se añade ruido en la imagen ni se rellena el área bajo una envolvente.
El ECG, las columnas y el cursor usan segundos del mismo reloj fisiológico;
la columna se sitúa en el centro temporal de su ventana FFT.

El historial es de seis segundos. Las tres PRF pueden diferir; cada columna mantiene
su frecuencia de muestreo y tiempo. La orientación virtual coloca el flujo
anterógrado suprahepático/interlobar bajo cero y portal sobre cero; no se afirma
que todas las ventanas clínicas tengan ese signo. La escala tiene unidades cm/s, cero explícito
y Nyquist independiente por territorio. Los ajustes iniciales 50/30/50 cm/s son
ajustes de equipo para este modelo, no límites clínicos de normalidad. Una escala
insuficiente puede producir aliasing real de la señal; aumentarla reconstruye la
adquisición virtual y conserva el reloj del paciente. No se normaliza la amplitud.

## Qué significa la adquisición virtual

Cada territorio obtiene una ventana mediante las mismas rutinas de contacto,
compresión, transmisión y colocación de puerta que el ecógrafo principal. Se
emplean tres copias anatómicas independientes del mismo paciente, de manera que
la compresión de una sonda virtual no cambie los otros territorios ni el torso de
la vista principal. Las puertas de 4/6/4 mm permanecen fijas en el espacio; la
respiración puede desplazar el vaso respecto a ellas y perder señal. El ángulo,
la profundidad y la sensibilidad del haz afectan la IQ. Se muestra velocidad
axial sin corrección angular, junto al ángulo actual. Esta simultaneidad virtual
es docente; no equivale a tres adquisiciones clínicas validadas.
La señal mantiene el perfil radial y la advección espacial del motor de IQ.
La referencia Q/A sigue disponible como modo secundario claramente rotulado.

## Marcas opcionales

Las marcas provienen de las mediciones espectrales existentes ancladas a los
latidos del ECG, no de máximos de la verdad Q/A. Se muestran solo cuando la
medición pasa su control de calidad. Suprahepática: A/S/D; porta: Vmáx/Vmín;
interlobar: S/D/mín. No se imponen tres ondas auriculares a una porta normal.
La FA no recibe una onda A inventada. Ante aliasing o señal insuficiente se informa
por qué faltan marcas. Esto no convierte la vista en clasificación clínica validada.

Fundamento de nomenclatura: guía BSE de corazón derecho, doi:10.1530/ERP-19-0051
(https://pmc.ncbi.nlm.nih.gov/articles/PMC7077526/), y guía ASE 2025,
doi:10.1016/j.echo.2025.01.006 (https://pubmed.ncbi.nlm.nih.gov/40044341/).
Las limitaciones fisiológicas de la investigación previa permanecen: no hay aún
modelo pericárdico/taponamiento ni compliance diastólica VD validada.

## Verificación

Pruebas de puertas en siete casos, ausencia de mutación, potencia multibin,
reproducibilidad por fragmentos, timestamps y discontinuidades de entrada.
Sano en apnea con siete latidos: se exige calidad útil y marcas de señal en los
tres territorios. E2E comprueba píxeles de espectro, ECG/cursor, marcas, escala
independiente, móvil y limpieza al cerrar. El trabajo se limita por cuadro y
se detiene al cerrar; no debe bloquear con seis segundos de IQ de una sola vez.
Las pruebas y el aspecto visual no constituyen un banco de validación clínica.

## Revisión visual móvil

La primera ejecución E2E pasó, pero la captura mostró texto ilegible al reducir
un canvas de 800 píxeles a un teléfono. Se corrige el bitmap al ancho real y DPR
(hasta 2), con fuente de tamaño visual constante. Las vistas congeladas reutilizan
el bitmap mientras no cambien señal, cursor, marcas o tamaño. La prueba espera
la reconstrucción tras cambiar PRF antes de fotografiar y verifica resolución nativa.
Se conserva una captura completa de escritorio y otra inferior móvil con ECG.

## Eje y alineación temporal

La columna lateral de 58 píxeles CSS contiene las marcas de velocidad y sus
unidades, fuera del espectro. ECG y respiración reservan el mismo espacio para
que una posición horizontal corresponda al mismo tiempo en las cinco filas.
La línea cero permanece visible al desplazar la base. El desplazamiento cambia
la ventana de visualización periódica; no elimina aliasing ni altera la señal.

## Estado de validación

Estas mejoras de adquisición y ejes no resuelven por sí solas la calibración
hemodinámica renal. Los índices de pulsatilidad normales publicados dependen del
territorio y método; no se fuerza una onda plana ni se reescala el caudal para
imitar una captura. Véase RENAL_WAVEFORM_MODEL_REVIEW.md. El visor permanece en
borrador clínico hasta revisar las capturas y los límites del modelo.

## Dependencias y presupuesto

El coordinador de ventanas reside en app/venousSpectral.ts, porque reutiliza
colocación de sonda y puerta de la aplicación. El motor Doppler no importa app.
Profundidad y foco se copian del equipo al crear la adquisición; se inyectan
como datos para evitar que el visor importe el renderer completo. El diccionario
reversible de GLSL aprovecha los marcadores disponibles para reducir bytes;
el alfabeto se extiende a 64 símbolos ASCII y las pruebas comparan todos los shaders reconstruidos byte por byte. No se amplían
presupuestos ni se modifica la física de los shaders.

## Revisión de llenado portal y señal arterial renal

A solicitud del propietario se amplían las puertas portal e interlobar a 6 y
4 mm respectivamente. Es un cambio de volumen de muestra físico: puede aumentar
la dispersión de velocidades y captar la arteria adyacente. La fila renal declara
arteria y vena de la misma puerta; no suma dos espectros adquiridos aparte. La
PRF renal corresponde a Nyquist 50 cm/s, con base inicial +0,1: intervalo visible
−40 a +60 cm/s. El intervalo total sigue siendo 100 cm/s. No son valores de
normalidad poblacional ni una corrección angular. La escala permanece ajustable.

La presentación promedia potencia LINEAL de tres columnas contiguas con pesos
1/4, 1/2 y 1/4, conservando bin y tiempo central. A las PRF iniciales, el soporte
se extiende aproximadamente 5–8 ms a cada lado. No mezcla PRF ni huecos. No se
rellena el área bajo una envolvente, no se fabrica señal de flujo ausente y no
cambian las mediciones sobre el espectro fuente. Se cachean arrays de potencia
sin referencias encadenadas a columnas antiguas, para no retener todo el historial.

Ganancia digital de imagen y rango dinámico se muestran en cada fila y pueden
ajustarse en «Imagen». El preset portal usa +15 dB y 25 dB de rango; el renal, +9/30 dB para evitar
saturación de la vena al reforzar la arteria. La suprahepática conserva 0/45 dB. Son decisiones de visualización
explícitas, no una mejora de la relación señal/ruido física ni parámetros clínicos
calibrados. Las pruebas exigen que variar la ganancia cambie píxeles sin reiniciar
IQ, mover timestamps, modificar marcas o alterar la línea cero.

Como contraste técnico, un barrido offline de Nyquist renal 40–100 cm/s sobre el
mismo paciente encuentra envolventes arteriales visibles cerca del extremo a 40. La escala 50 con base desplazada da espacio al componente arterial y conserva
la vena bajo cero. Las variaciones de estimación entre PRF y la incertidumbre de
caudal/área del modelo siguen requiriendo calibración independiente. Se mantienen
los criterios de captura y el borrador clínico. Guía de técnica: AIUM 2020,
doi:10.1002/jum.15260, https://onlinelibrary.wiley.com/doi/10.1002/jum.15260.
