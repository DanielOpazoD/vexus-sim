# Relaciones anatómicas básicas, contra un humano real

Criterio del propietario (decisión 311): el modelo no debe parecerse al promedio, sino mantener las relaciones
habituales de un humano cualquiera. No hacen falta decenas de casos ni percentiles. Basta ver, con uno o dos TAC, que las
relaciones básicas, las posiciones, los bordes, los tamaños generales y las formas se cumplen.

## Cómo se comprueba

1. Se compara el mismo plano físico en el modelo y en el TAC, en cada ventana afectada, más un corte axial, coronal y
   sagital. Las láminas se miran antes de cerrar el bloque.
2. Cada fila de la lista se responde sí o no sobre esa lámina. Los números la apoyan y detectan retrocesos; no son metas
   exactas, porque una cifra de una persona no es una norma.
3. Si una medida no capta lo que se ve, se cambia la medida. La lista crece con lo que encuentre el propietario.
4. Las máscaras del modelo salen de las funciones TS reales. Cada TAC usa un único registro rígido, sin ajustar por órgano.
   El TAC no se traduce a brillo ecográfico. Nada de esto es validación clínica.

Referencia: TotalSegmentator v3.0.0, [CC BY 4.0](https://doi.org/10.5281/zenodo.22688904). `s0028` es la persona de
referencia y `s0440`, el contraste. Los datos no entran en el repositorio.

## Lista, medida el 01-11-2026 sobre `main` 234aa1c

| Relación básica                                                                             | Modelo                                   | `s0028` / `s0440`           | ¿Se cumple? |
| ------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------- | ----------- |
| Riñón derecho inclinado respecto del eje del cuerpo                                         | 9,7°                                     | 32,5° / 33,1°               | No          |
| Riñón derecho alojado bajo el hígado: de centro a centro, en altura                         | 106 mm                                   | 79 mm / 73 mm               | No          |
| Riñón con grasa alrededor: músculo profundo a su altura en el plano renal, y detrás         | 12,3 y 10,2 cm²                          | 9,7 y 28,6 / 3,5 y 32,7 cm² | No          |
| Psoas junto a la columna, separado del riñón por grasa en el plano renal                    | se extiende bajo el riñón                | junto a la columna          | No          |
| Masa paravertebral a cada lado de la columna                                                | ausente, hay grasa                       | 824 / 699 cm³               | No          |
| Contorno hepático lleno frente al riñón y la pared: área / envolvente convexa, renal        | 0,90                                     | 0,98 / 1,00                 | No          |
| Pared que sigue el cuerpo: flecha de la piel a ±70 mm en el plano renal (negativo: cóncava) | −11,7 mm                                 | +3,5 / +3,6 mm              | No          |
| Espesor de la pared que cambia según la zona                                                | anillo casi uniforme                     | variable                    | No          |
| Colon de tamaño razonable                                                                   | 1.084 cm³                                | 471 / 349 cm³               | No          |
| Colon separado del riñón izquierdo                                                          | 1,5 mm                                   | 28 / 17 mm                  | No          |
| Gas digestivo limitado (modelo: tramo z −240 a −40 mm)                                      | 479 cm³                                  | 79 / 41 cm³                 | No          |
| Estómago sobre el páncreas, en altura                                                       | 55 mm                                    | 28 / 33 mm                  | No          |
| Distancia del riñón derecho a la línea media                                                | 59 mm                                    | 62 / 60 mm                  | Sí          |
| Aorta y VCI respecto de la columna, a grandes rasgos                                        | ver `s0028-metrics.json` de la auditoría |                             | Sí          |

Las medidas con HU son descriptivas y no identifican una fascia ni un músculo concreto. La fase de contraste, la fase
respiratoria y el estado de ayuno de los dos casos no constan, y pueden explicar parte de lo que difiere en colon, gas y
base pulmonar. Médula, corteza y fascias no se pueden contrastar con estas máscaras.
