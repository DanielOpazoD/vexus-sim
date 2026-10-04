# Compliance de reservorios venosos: alcance experimental

El control solicitado de distensibilidad venosa se incorpora por etapas. Este
parámetro cambia exclusivamente los reservorios esplácnico y periférico de la red
existente. No representa todavía una compliance uniforme de todas las venas.

## Mecanismo y unidades

`venousReservoirCompliance` es un factor relativo, basal 1, con dominio experimental
0,5–2. Multiplica C esplácnica (40 mL/mmHg) y C del cuerpo inferior (60 mL/mmHg).
Estas constantes y el dominio son aproximaciones del modelo, NEEDS_CALIBRATION;
no son rangos normales obtenidos de una población.

La ley constitutiva conserva P = P externa + (V − V0)/C. El factor cambia su
pendiente dV/dP y, por tanto, la presión ante el mismo incremento de volumen.
Los balances dV/dt = entrada − salida, resistencias, inercia y perfiles Doppler
permanecen intactos. Tampoco cambian C auricular, renal, hepática, la ley de tubo
de VCI ni el volumen no estresado V0. No se multiplica una onda ni su imagen.

El lazo circulatorio existente obtiene su compliance total de los compartimentos;
por eso la respuesta a un bolo utiliza el factor sin añadir una regla por caso.
En un ensayo del propio modelo, tras solicitar 250 mL e integrar 30 s docentes,
entran 237,55 mL con la cinética existente. En el sano, PAD basal 5 mmHg pasa a
7,21/6,35/5,76 para factores 0,5/1/2; en congestión con basal 18, a
21,73/20,05/19,08. Son resultados computacionales, no predicciones terapéuticas
ni parámetros de una intervención humana. El ensayo no prescribe fluidoterapia.

## Qué significa cambiarlo en el laboratorio

Cada ajuste construye un escenario independiente con la PAD basal especificada.
La inicialización usa V = V0 + C·P transmural: cambiar C manteniendo la presión
puede cambiar el volumen inicial. No conserva el volumen del escenario anterior,
no simula una dosis de venodilatador y no debe interpretarse como transición aguda.
A PAD basal fija las diferencias de los espectros de reposo pueden ser pequeñas;
no se exageran para que el deslizador parezca más activo.

La progresión docente 0–3 conserva este factor en 1. Solo los cinco parámetros
anteriores siguen su trayectoria. Un ajuste individual se identifica como
Personalizado. Los casos preexistentes omiten el campo y siguen exactamente la
trayectoria basal anterior. El hígado y la anatomía no se modifican.

## Evidencia que limita la interpretación

Kato et al. midieron compliance periférica en insuficiencia cardíaca y controles,
con relaciones dependientes de la presión. Es evidencia de variabilidad, no una
medida de C esplácnica o una autorización para escalar todo el sistema por igual.
DOI: 10.1177/000331977602701204; resumen primario consultado:
https://pubmed.ncbi.nlm.nih.gov/1078304/.

El estudio de función endotelial venosa de 2001 distingue la pendiente de la
relación volumen-presión (compliance) de su desplazamiento y volumen no estresado
(tono/capacitancia). Esa distinción impide etiquetar este factor como una
venodilatación farmacológica. DOI: 10.1016/S0735-1097(01)01142-1.
https://www.jacc.org/doi/10.1016/S0735-1097%2801%2901142-1.

La investigación de modulación esplácnica de 2023 estudia marcadores indirectos y
reconoce incertidumbre mecanística. No ofrece una calibración universal de este
factor ni de velocidades S/D/A. https://pmc.ncbi.nlm.nih.gov/articles/PMC10382122/.

## Verificación y pendientes

- Solo cambian los dos coeficientes declarados; ΔP = ΔV/C y volumen desplazado
  coinciden con sus ecuaciones y la suma de compartimentos
- Campo omitido y factor 1 producen muestras idénticas en todos los casos
- A igual volumen infundido, el incremento de PAD del modelo decrece con C en los
  ensayos sano y congestivo, manteniendo finitud; no se impone una magnitud clínica
- Se conservan anclajes docentes y aislamiento del paciente original; el navegador
  prueba el control junto con PIA alta y captura la interfaz

Quedan pendientes calibración por territorios, tono/volumen no estresado variable,
compliance no lineal regional, mecánica diastólica VD, pericardio y validación
clínica de respuestas. Los tests verifican el mecanismo, no esos fenómenos.
