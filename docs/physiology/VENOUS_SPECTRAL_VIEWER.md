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
y Nyquist independiente por territorio. Los ajustes iniciales 80/50/60 cm/s son
ajustes de equipo para este modelo, no límites clínicos de normalidad. Una escala
insuficiente puede producir aliasing real de la señal; aumentarla reconstruye la
adquisición virtual y conserva el reloj del paciente. No se normaliza la amplitud.

## Qué significa la adquisición virtual

Se elige un punto central clasificado dentro de cada vaso anatómico: suprahepática
derecha, tronco portal e interlobar derecha. Se conserva la anatomía. Las puertas
siguen el movimiento del vaso, con transmisión ideal y haz alineado a 0 grados.
La velocidad de seguimiento se resta del movimiento global. No es una prueba de
ventana acústica, colocación de sonda ni de tres sondas clínicas simultáneas.
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
