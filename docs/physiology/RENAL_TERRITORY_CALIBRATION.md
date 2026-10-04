# Calibración provisional del territorio interlobar

2026-10-04. Decisión 127. Parámetro **NEEDS_CALIBRATION**; no validación clínica
independiente ni proporción anatómica humana demostrada.

## Qué cambia físicamente

Cada interlobar representada recibe 5 % del flujo de un riñón, antes 12 %.
Las tres ramas del derecho representan 15 %; el territorio no representado, 85 %.
El flujo renal total, sus presiones, resistencias, compliances y volumen siguen
saliendo de la misma red. La velocidad local resulta de Q/A y del perfil radial;
ningún grado VExUS entra en esa asignación. No se modifica la escala para ocultar
velocidades, ni se recortan picos, ni se rellenan espectros.

Es una calibración conjunta de territorio/área: la anatomía simplificada no
identifica de manera única qué fracción drena cada rama. El valor anterior tampoco
era una medición humana. Se conserva el calibre geométrico y se documenta la
fracción como hipótesis revisable, sin fingir reconstrucción vascular completa.

## Referencias y magnitudes distintas

La velocidad media seccional Q/A no es el pico de una envolvente PW. En el perfil
parabólico arterial el centro alcanza 2 × Q/A; con exponente venoso 3, 5/3 × Q/A.
Después intervienen ángulo, puerta, PSF, señal, filtro, resolución y estimación.

Lee y Gao (2020; 30 adultos, 60 riñones, edad media 26 años) comunicaron PSV/EDV
interlobares de 34,1 ± 5,2 / 14,7 ± 3,3 cm/s antes y 42,7 ± 7,7 / 17,9 ± 3,8
tras 500 mL de agua. Son datos de una cohorte y protocolo, no límites universales
ni caudales medios seccionales: https://doi.org/10.7556/jaoa.2020.113 .

Iida et al. (2016, figura 1) y Kudo et al. (2017, figura 1 y corrección de leyenda)
aportan ejemplos de morfología y escala renal. No se convierten sus imágenes
individuales en medias normales. La tabla completa de velocidades absolutas de
Jeong et al. (2011) sigue pendiente de acceso; no se inventan sus valores.

- Iida: https://doi.org/10.1016/j.jchf.2016.03.016
- Kudo: https://doi.org/10.1007/s10396-017-0770-0
- Corrección: https://pubmed.ncbi.nlm.nih.gov/29063420/
- Jeong: https://pubmed.ncbi.nlm.nih.gov/21544829/

## Sensibilidad previa: candidatos 6 % y 4 %

En un banco personal con ventana anatómica real, apnea espiratoria, 30 s de
estabilización, 8 s de IQ y escala axial ±80 cm/s, pasar de 12 a 6 % redujo los
picos venosos observados del sano de S/D 31,25/25,63 a 16,25/13,75 cm/s y la D
del grave de 61,25 a 30,63 cm/s. Son resultados del banco, no referencias humanas.
El máximo arterial central teórico sano pasó de 99,38 a 49,69 cm/s, antes de
proyección angular y adquisición. La estimación arterial en puerta mixta todavía
necesita validación independiente; no se usa como certificación de PSV/EDV.

También se ensayó 4 %. Su matriz produjo cuatro fallos, incluidos desacuerdos
aceptados de patrón en FA, PIA elevada y cirrosis; se descartó. Con 6 %, 51/52
contratos previos pasaron: el único fallo esperaba el aliasing del caudal antiguo
a PRF 2600 Hz. Se conserva esa exigencia física con una adquisición realmente
insuficiente a 1300 Hz y se añade su pareja a 2600 Hz, que debe ser medible y
monofásica. No se relajan las tolerancias ni se permiten patrones aceptados falsos.

## Condiciones de integración

Repetir todas las matrices sobre el árbol final, pruebas de conservación/unidades,
CI completa y capturas reales del navegador en sano y grave. Revisar curvas y
valores con los mismos ajustes, sin confundir este avance de amplitud con un
modelo renal completo o una validación clínica. Los mecanismos de compliance,
la incertidumbre de medición y los escenarios hemodinámicos complejos siguen
requiriendo desarrollo y contraste independiente.

La suite core también contenía márgenes históricos de mínimo Q/A (>3 y <1
cm/s) ligados al territorio anterior de 12 %. Se conservan ambos límites
expresando la velocidad en ese territorio original, y se exige además que el
mínimo actual del estado intermedio supere el suelo instrumental vigente. No
se cambia el clasificador ni se baja un margen para hacer pasar el caso.

## Identidad arterial/venosa: rechazo conservador

La auditoría de plano/puerta detectó que centrar la adquisición en la arteria
puede hacer que el estimador aislado acepte esa señal como vena continua, incluso
en el caso grave. Se añade un rechazo automático `renal-identity` cuando domina
la arteria en cualquiera de los latidos efectivamente medidos. La supervisión usa
la identidad anatómica de la puerta, no el grado ni el patrón fisiológico oculto;
no altera la IQ, el espectro o su amplitud, y conserva problemas previos como
aliasing. Se prueba el mismo IQ con y sin la guarda en dos cuerpos y dos casos.

Es una limitación de identificación del estimador actual. Clínicamente sí se
adquieren arteria y vena simultáneamente (Iida 2016); esta guarda no prohíbe esa
técnica ni sustituye un futuro separador validado. La mejora del componente
arterial y su identificación espectral independiente siguen pendientes.

Los aproximadamente 30 cm/s de D grave del candidato anterior 6 % eran un resultado del simulador,
no un máximo clínico demostrado. No se usa el extremo de una escala lateral de
una figura como si fuera la velocidad medida del paciente. Su validación requiere
revisar la envolvente, calibración, lugar de muestreo y corrección angular en las
fuentes originales.

## Revisión final propuesta: 5 %, después de las nuevas referencias

La figura 1 de Husain-Syed 2019 (https://pmc.ncbi.nlm.nih.gov/articles/PMC6898799/)
distingue capturas clínicas de un esquema inferior. El extremo −30 cm/s del
esquema no es el pico del paciente. El ejemplo grave tiene picos aproximadamente
20–25 cm/s por lectura visual; el de Iida 2016 es menor. No son medias de cohorte
ni límites poblacionales. Otra captura aportada rotula VSA arterial 30,4 cm/s,
que no debe confundirse con la onda D venosa.

El ensayo 5 % conserva Q renal total y produce, con la misma adquisición axial
±80 cm/s del banco, S/D/mín sanos 13,75/11,25/6,25 y D grave 26,25 cm/s. El
centro arterial teórico sano es 41,41 cm/s antes de proyección angular; no se
presenta como PSV medida. Esta elección mejora la concordancia de magnitudes
con las referencias revisadas respecto a 12 % y 6 %, pero continúa identificada
como parámetro provisional: los ejemplos no identifican una fracción anatómica
real de 5 %. Tampoco imponen D = 26,25 en otros estados.

Las 53 matrices existentes pasan a 5 % sin relajar umbrales. En una auditoría
separada de 168 escenarios (7 casos × 4 fracciones × 3 semillas × 2 patrones
respiratorios), los ocho cambios de patrón al retirar el suelo absoluto de
2 cm/s pertenecieron al candidato 4 %; ninguno de los 42 escenarios a 5 % lo
mostró. No se cambia el clasificador. Quedan exigidas CI y capturas reales del
árbol final con la escala lateral incorporada.

## Reproducción

- `node --import tsx tools/fidelity/renalTerritoryBenchmark.ts`: compara 12/6/5/4 %
  usando la ruta de adquisición y captura compartida con la aplicación; devuelve
  valores Q/A, flujo total y medición observada. No importa módulos del visor
  todavía pendiente de integración. El resultado se guarda en `/tmp` por defecto.
- `node --import tsx tools/fidelity/renalTruthResolutionAudit.ts`: reproduce los
  168 escenarios de estabilidad del suelo de clasificación, sin adoptar el
  clasificador contrafactual.
