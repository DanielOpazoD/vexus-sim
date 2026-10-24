# Diez bloques candidatos de fidelidad: 243–254

El usuario autoriza una secuencia de al menos diez mejoras adicionales y su
aceptación por commits, PR y merge. Convexo genérico de 3,5 MHz; ninguna prueba
interna acredita indistinguibilidad clínica o validación educativa humana.

El lote final incluye 243–248, 250 y 252–254: diez mejoras. **249 y 251 quedan
aplazados**: el ancho muscular no satisfizo el banco histórico de textura; la
métrica del septo graso no conservó la alineación de su normal con el peso
escalar en GPU. Se retiran ambos del runtime sin relajar sus controles. Se
conservan diagnósticos y aproximaciones de ancho anteriores; no cuentan como
mejoras entregadas.

## Contrato

Cada bloque corrige un defecto reproducido. Los cambios de presentación dependen
del mismo campo anatómico y del estado adquirido, sin pintar un patrón VExUS.
No se modifican resolución, plazos, física ni presupuestos para conseguir verde.
Las seis zonas son coordenadas de prueba dentro de una exploración continua.

| Bloque | Defecto y resultado buscado                                                                  |
| ------ | -------------------------------------------------------------------------------------------- |
| 243    | Paquete sin margen: transportar el mismo GLSL con menos bytes.                               |
| 244    | Una preview obsoleta comparte HEAD: verificar fuente y todos sus recursos antes de comparar. |
| 245    | Pose y reloj iguales, ruido diferente: registrar también la fase del receptor.               |
| 246    | PRF nueva con memoria anterior: separar la nueva adquisición conservando historia.           |
| 247    | R1 es potencia: aplicar correctamente su ganancia en decibelios.                             |
| 248    | Normal muscular de un marco simplificado: derivarla de la fase material real.                |
| 249    | **Aplazado**: ancho muscular material; se mantiene la aproximación anterior.                 |
| 250    | Promedio de velocidades antes de fase: sumar correlaciones complejas por submuestra.         |
| 251    | **Aplazado**: métrica septal grasa; se conserva la normal y el campo de 221.                 |
| 252    | Costura de textura en el dorso: continuidad periódica sin modificar la pared anatómica.      |
| 253    | Capturas registradas: hashear el PNG adquirido sin repetir lecturas GPU.                     |
| 254    | Cine Color: conservar rango y fase de R1 con precisión de 32 bits.                           |

## Validación y evidencia

Capturas antes/después: t=30 s, apnea, atlas, fase de receptor 33–39; ambos
pacientes y seis accesos. Conservar build, recibo, GPU, imágenes y errores.
Las capturas iniciales sin fase registrada permanecen como diagnóstico, sin
presentarlas como equivalencia píxel a píxel. Evidencia fuera del repo:
`../fidelity-243-evidence/PROGRESS.md`.

Durante implementación, controles focalizados y negativos discriminantes. Al
estabilizar el lote: check completo, paridad GPU, navegación/corte/adquisición,
calibración cuando corresponda y CI íntegra del head final. Cada decisión registra
lo realizado y sus límites. Consultar Git/CI para conocer la aceptación efectiva;
esta lista no declara completados los bloques.

## Referencias de mecanismo

La suma compleja precede a la estimación de fase en el método de
[Kasai et al., 1985](https://courses.healthtech.dtu.dk/22485/documents/kasai_et_al_1985.pdf).
Color sigue siendo una aproximación analítica; no se presenta como ensemble IQ.
La conversión de potencia usa 10 log10, según la
[definición de decibelio](https://www.analog.com/en/resources/glossary/db.html).
Estas referencias sustentan las operaciones, no calibran el simulador completo.

Durante la revisión se añade la decisión253: retirar una lectura duplicada de
las capturas registradas. El timeout de main046 se conserva; los cuatro PNG
y hashes originales prueban equivalencia de datos. No se reducen renders ni
se amplían los720s. 253 y 254 se suman a los ocho bloques conservados de la secuencia inicial.

La revisión añade también 254: el cine RG16F saturaba componentes de Color
adquiridas con movimiento real y alteraba su fase. RG32F preserva el campo
vivo, con 7,37 MB adicionales y sin reducir resolución ni historia. La
regresión compara ambos pacientes a +12/+24 dB y conserva el negativo real;
el positivo y la aceptación dependen del build y CI finales.
