# Frontera de la pared cava única — decisión 316

**El ensayo se rechaza: une almacenamiento y luz, pero pierde colapsabilidad sana y altera patrones renales; la producción conserva la decisión 73.**

Base `27b6cf11403f5dd9b0c3187eb761555cc1aa1359`, 2026-11-02. No es validación clínica.
Sin cambios por identificador, grado ni contorno auricular; aorta intacta.

## Protocolo y modelo ensayado

Protocolo fijado antes de medir en `vexus-owner-evidence-20261031/ivc-wall/protocol.md`.
Las tres pruebas iniciales fallaron en la base (269 ms). El prototipo usa dos
volúmenes cavas: `V=L·A/1000`, `dA/dt=1000·(Qin−Qout)/L` y
`Ptm=Pel(A)+ηA(A)·dA/dt`. Backward Euler resuelve simultáneamente las dos áreas y
ramas inerciales con Newton, cuatro subpasos de 1 ms; retira ambos filtros visuales.
Supra almacena volumen y Q/A usa su propia salida a AD, no la suma de entradas.
Su longitud de 50 mm es estimada, común a todos los pacientes.

[Zócalo 2008, tabla II](https://www.scielo.cl/pdf/bres/v41n2/art12.pdf): cava anterior
ovina, siete animales ex vivo, 1,8 Hz; ηD=53,20±7,87 kPa·s/m. Se ensayaron
0,34000296076791 / 0,3990328151964 / 0,45806266962489 mmHg·s/mm.
Como el artículo usa dD/dt, se convierte `ηA=ηD/√(πA)`. No es un τ humano medido.
Se conservaron las leyes elásticas previas, que son estimadas; la combinación es
**[EXTRAPOLACIÓN PROPIA] / NEEDS_CALIBRATION**, no una pared humana calibrada.
Los valores extremos tuvieron inicialmente +0,000005 por transcripción: se
conservaron las salidas erróneas y se repitieron con la conversión correcta, sin
cambiar expectativas. Ninguno conserva la puerta sana; no se optimiza después.

## Amplitudes: antes → ensayo rechazado

18 s de integración, ventana 6–18 s, dt=4 ms, semillas originales.
Cada celda VCI expresa ΔDAP en mm / 100·ΔDAP/DAPmáx en %. En respiración incluye
ambos componentes; no es pulsatilidad cardíaca aislada. Aorta antes=después;
el denominador mínimo da aproximadamente 8 %, frente al 7,4 % con máximo.
CSV completos y amplitudes por cada latido completo en los JSON externos.

| Caso          | Condición   | Infra: mm / %máx            | Supra: mm / %máx           | Aorta: mm / %máx |
| ------------- | ----------- | --------------------------- | -------------------------- | ---------------- |
| Sano          | Apnea       | 0.95 / 5.03 → 0.53 / 2.83   | 2.01 / 9.84 → 1.20 / 5.98  | 1.60 / 7.41      |
| Sano          | Respiración | 5.53 / 30.81 → 2.89 / 17.34 | 2.70 / 12.97 → 1.81 / 8.86 | 1.60 / 7.41      |
| Moderada (FA) | Apnea       | 0.46 / 1.59 → 0.47 / 1.63   | 0.56 / 2.21 → 0.72 / 2.78  | 1.60 / 7.41      |
| Moderada (FA) | Respiración | 2.39 / 8.31 → 2.09 / 7.27   | 0.75 / 2.93 → 0.91 / 3.51  | 1.60 / 7.41      |
| Grave         | Apnea       | 1.01 / 3.24 → 1.28 / 4.07   | 1.20 / 4.45 → 1.79 / 6.53  | 1.60 / 7.40      |
| Grave         | Respiración | 2.07 / 6.70 → 2.13 / 6.83   | 1.27 / 4.70 → 1.85 / 6.76  | 1.60 / 7.40      |
| IT grave      | Apnea       | 2.01 / 7.98 → 1.05 / 4.26   | 2.26 / 9.68 → 1.84 / 7.90  | 1.60 / 7.41      |
| IT grave      | Respiración | 5.35 / 22.01 → 3.55 / 15.07 | 2.69 / 11.40 → 2.21 / 9.40 | 1.60 / 7.41      |

[Nakamura 2013](https://pubmed.ncbi.nlm.nih.gov/27277237/): índice de **área**
24±3 % basal y 11±1 % tras elevar piernas en ocho sanos. No es un rango AP
universal ni exige cero pulso. El índice de área infra del ensayo sano en apnea
se informa en el JSON, sin equipararlo al eje AP. [Patel 2017](https://pmc.ncbi.nlm.nih.gov/articles/PMC6058243/)
mostró en un caso de IT 19–32 mm (Δ13 mm, 40,63 %máx derivado), con dilatación
sistólica y reversión hepática. El ensayo no reproduce esa amplitud. [Moreno 1984](https://pubmed.ncbi.nlm.nih.gov/6695787/)
describe ondas V; su >125 % del diámetro de referencia no es un CI de 125 %.
No se obtuvo un intervalo numérico comparable para la congestión moderada/grave.

En IT/apnea, el máximo supra cae en la sístole mecánica en 13/13 latidos completos,
con demora media tras R de 330,5→339,4 ms; infra queda después de esa ventana,
454,2→388,4 ms. No se fuerza una expansión sistólica abdominal ni se confunde
la mínima variación de una pared pletórica con un defecto.

## Puertas y motivo de parada

| Puerta conservada                   |                                        Base |                        Ensayo medio | Resultado del ensayo              |
| ----------------------------------- | ------------------------------------------: | ----------------------------------: | --------------------------------- |
| Respiración sana histórica >20 %    |                                    23,939 % |                            14,745 % | Falla; extremos 15,866 / 13,762 % |
| Respiración grave histórica <6 %    |                                     2,642 % |                             2,456 % | Pasa                              |
| Residuo cardíaco sano ≤1,5 mm       |                                       1,251 |                               0,591 | Pasa                              |
| Residuo cardíaco grave ≤1,5 mm      |                                       1,448 |                               1,503 | Falla; no se sube el tope         |
| Área visible=almacenamiento         | Hasta 101,98 mm² de separación en la matriz |               Error ≤2,28·10⁻¹³ mm² | Pasa                              |
| Conservación total, siete casos     |               Contratos históricos vigentes |         Residuo ≤4,50·10⁻¹⁰ mL/paso | Pasa en el ensayo                 |
| Ley viscosa / Q/A supra             |                          Separación vigente | ≤1,56·10⁻¹⁵ mmHg / ≤1,71·10⁻¹³ mL/s | Pasa en el ensayo                 |
| Patrones renales y trampas íntegros |                   Conservados en producción | Cambian en intermedio, PIA, VM e IT | Falla                             |

El lote focal del ensayo da 22 pases y **7 fallos**, cuatro archivos, 6,29 s:
`physiology`, `properties`, `traps`, `ivcWallStorage`. Propiedades y cuatro contratos
de almacenamiento pasan; fisiología/trampas fallan. Los grados literales de los
siete casos siguen 0/3/1/0/2/1/3 en apnea y respiración, pero eso NO conserva la
cadena: PIA cambia su intervalo contextual 0–2→0–3 y VM/IT el patrón renal.
Los contraejemplos de `prescribed-ra-contour` no se modifican y pasan en ese lote.
Reducir dt a 2 ms cambia la amplitud infra global como máximo 0,064 mm y QHV medio
0,077 mL/s; prueba de sensibilidad numérica, no demostración de convergencia completa.

Se conserva la decisión 73, su tope de 1,5 mm y `ivc-wall-lag-not-in-network` tanto
en registro como en documentación. Dos `it.fails` rápidos guardan la discrepancia
instantánea de la base; una futura pared unida los hará pasar inesperadamente y
exigirá revisar sus marcadores. No son una aprobación del prototipo rechazado.
No se ejecuta la cadena adquirida con este prototipo como si fuera candidato.
El cierre local y las E2E existentes se ejecutan sobre la producción restaurada.

El cierre CPU completo pasa: núcleo 1977 pases/15 fallos esperados y matriz
79/1, sin omisiones ni duplicados; la suite rápida da 1802/5. Metal conserva
7/8 E2E: modo M atlas falla con 25,383 % adquirido frente a 30,414 % de verdad,
error 5,031 pp, sobre la cota intacta de 5. La repetición aislada pasa con
error 2,382 pp; no convierte el lote fallido en aprobación. El JS coincide con
la base después de normalizar sólo el sello horario de build y los hashes de
sus imports. El fallo, traza y ambas mediciones quedan en el informe externo;
no se corrige la adquisición M dentro de este ensayo de pared rechazado.

## Coste y evidencia visual

Cinco repeticiones alternadas, 20 000 pasos medidos por variante y repetición,
cuatro casos, Node 24.14.1. Calentamiento excluido, checksum finito, cero errores:
11,275 µs/paso (10,695–12,010)→13,598 (13,516–13,664), +20,6 % observado.
Es el paso completo de fisiología con historia/velocidades; no FPS ni tiempo GPU.
Había carga ajena registrada. El perfil separado sitúa trabajo en validación de
muestra y resolución/inversa de la red; no se atribuye una aceleración del producto.
JS de producción: 982,2→983,7 KiB en el experimento, techo intacto 1045 KiB;
la producción restaurada conserva su presupuesto. Sin cambios GLSL ni techos nuevos.

32 originales B/M por variante, cuatro casos × apnea/respiración × subxifoidea/
epigástrica, Metal real Apple M4. Paciente, pose, ajustes, t inicial=6,004 s y línea M
idénticos antes/después; cero errores de página. Son capturas del ensayo rechazado,
no validación de imagen clínica. Los primeros B del compositor estaban negros y
se conservan como arnés fallido; `before-metal-03` y `experiment-metal` usan el
framebuffer real, y M la franja adquirida visible. Una línea elegida por mayor
cuerda VCI puede atravesar supra en subxifoidea: no es el gate protocolar adquirido.

Evidencia externa: `/Users/daniel/.t3/scratch/vexus-owner-evidence-20261031/ivc-wall/`:
`before/`, `experiment-mean/`, `experiment-low-corrected/`, `experiment-high-corrected/`,
`experiment-dt2/`, `mass.json`, `benchmark.json`, perfil CPU, builds, fuentes y logs.
El prototipo reproducible queda en `experiment-source/` y `experiment-files/`;
no entra en el JS de producción ni en CI. Figuras `figures/traces-*.png` y láminas
`figures/before-metal-03-*.jpg` / `figures/experiment-metal-*.jpg`.
El informe externo registra las figuras abiertas, los checks finales y el SHA.

Frontera observada: esta transferencia de viscosidad ovina a las leyes elásticas
actuales no satisface las puertas conjuntas. No prueba que ninguna pared humana
pueda hacerlo; faltan datos humanos simultáneos de presión/área/flujo y una curva
elástica sustentada compatible con todo el circuito. No ajustar por caso.
