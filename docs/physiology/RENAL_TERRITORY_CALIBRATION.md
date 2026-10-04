# Calibración provisional del territorio interlobar

2026-10-04. Decisión 126. Parámetro **NEEDS_CALIBRATION**; no validación clínica
independiente ni proporción anatómica humana demostrada.

## Qué cambia físicamente

Cada interlobar representada recibe 6 % del flujo de un riñón, antes 12 %.
Las tres ramas del derecho representan 18 %; el territorio no representado, 82 %.
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

## Sensibilidad y elección provisional

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
