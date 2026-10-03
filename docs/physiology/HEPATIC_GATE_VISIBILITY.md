# Sangre visible en la puerta suprahepática

## Contraejemplo

Una captura del caso de ventilación, con respiración activa y semilla base +4,
mostraba inversión S aceptada pese a que los mismos cuatro latidos tenían S
fisiológica +17,41 cm/s y patrón normal. La ventana se compara con sus propios
latidos, no con una media de toda la simulación.

Durante ese intervalo la identidad dominante siempre fue suprahepática. La
explicación histórica de que entraba «otro vaso» no se confirmó. Hubo 320 ms
con menos de 1 % de peso geométrico de sangre en el volumen de muestra. El
espectro residual no representaba de manera fiable toda la onda buscada.

## Regla docente de visibilidad

Se conservan señal, filtro, envolvente, medición y umbrales previos. Solo cuando
la calidad habría sido «medible», la captura suprahepática se rechaza como
intermitente si un tramo observado de poca sangre abarca al menos una ventana
espectral: `fftSize / prfHz`. Se comprueba exclusivamente el intervalo de los
latidos realmente medidos.

- Se suman las ramas suprahepáticas; otra sangre no reemplaza al objetivo
- Se requiere duración, no un único punto bajo ni suma de pérdidas separadas
- Se usa el 1 % de composición ya utilizado como suelo de identidad, ahora en
  el tiempo; no es un umbral clínico validado
- Una pausa de flujo real no implica desaparición de sangre geométrica: el
  algoritmo no recibe velocidades, presión, diagnóstico ni grado
- Se preservan los otros motivos de rechazo y la prioridad del vaso equivocado
- La regla no altera capturas portal o renal
- Sin registro de composición, no inventa evidencia de pérdida; siguen operando
  los controles espectrales existentes

Es una ayuda docente con información del paciente virtual, como el supervisor
que comprueba la puerta. No se atribuye esta información privilegiada a un
sistema clínico real.

## Evidencia y límites

La prueba de la captura concreta falla antes de la corrección y pasa después.
Cuatro contratos rápidos cubren duración, recuperación, recorte al intervalo,
composición y ausencia de dependencia del caudal. La matriz previa de 52 tests
PW permanece completa y sus requisitos de capturas útiles en apnea no cambian.

La auditoría offline se ejecuta con:

```sh
node --import tsx tools/fidelity/hepaticGateAudit.ts /tmp/hepatic-gate-audit.json
```

Incluye 20 semillas consecutivas, diez capturas por semilla, y compara cada
medición con los mismos latidos fisiológicos. Informa commit, árbol de HEAD,
árbol de trabajo modificado y ausencia de validación clínica. No se agrega a CI.

En la auditoría inicial del cambio no hubo falsas capturas aceptadas: las 200
se rechazaron. Esto **no equivale a 200 diagnósticos correctos ni a adquisición
exitosa**. La limitación de medir una puerta fija con ese movimiento respiratorio
permanece. La regla debe conservar capturas útiles cuando la sangre permanece
visible; no basta con lograr una suite verde rechazando todo.

Control de utilidad antes/después con la misma semilla y técnica: sano en apnea,
congestión grave en apnea y ventilación en apnea conservaron 10/10 capturas
aceptadas y correctas cada uno. En el sano con respiración activa, ambos daban
0/10: no es una pérdida nueva causada por esta regla. Los tres tests existentes
de adquisición en el adulto de referencia (hepática, portal y renal) también
conservan su exigencia de captura medible; no se modifica su técnica ni umbrales.
