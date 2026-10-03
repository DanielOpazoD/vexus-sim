# Relaciones torácicas y diafragmáticas: primer cierre local

Base: `4f7e0fd61c1cc74f1d8bd8c8707efdb04e1a2bc9`. Se corrige la unión medial de las cúpulas, no se declara terminado el tórax completo.

## Causa y corrección

La altura anterior era el máximo duro de dos campos. Sobre la curva donde ambos coinciden, la normal cambia bruscamente y transmite el pliegue a los recortes hepático y cardíaco. Cinco planos de prueba conservan un salto de 93–118° al refinar de 0,1 a 0,005 mm. La regresión `diaphragmJunction.test.ts` reconstruye esa curva independientemente y falla en la base.

La unión local C1 emplea un máximo suave de 4 mm en altura, con elevación acotada a 1 mm y apagado suave junto a la inserción. Es un parámetro estimado de regularización, no un espesor anatómico ni un tendón inventado. Conserva exactamente la altura cuando las cúpulas difieren al menos 4 mm y conserva ápices e inserción exterior. El campo GPU usa la constante CPU. No se pintan bordes ni se ajustan presets.

`diaphragm-junction-report.json` contiene el barrido de altura en 19.481 puntos por perfil y la convergencia angular. Costillas, riñones y arrays vasculares completos coinciden con la base en ambos perfiles; los hashes se refieren al objeto JSON completo, no solo al número de ramas. La relación y el eco deben verificarse también en el build final y sus capturas; los resultados pendientes no se declaran aprobados aquí.

## Lo que permanece abierto

La medición de referencia contra tejidos blandos independientes se repitió sobre main: las superficies de las costillas 5–9 todavía tienen muestras en hígado/cápsula, la sexta tiene cinco muestras en sangre, y el séptimo cartílago alcanza 0,393 mm bajo la piel. Es un diagnóstico muestreado, no una distancia global exacta. Este cambio no oculta ni corrige esos conflictos mediante prioridad de clasificación.

Faltan registrar/reconciliar la caja completa y sus inserciones, tendón central, pilares y hiatos, y cerrar contactos dinámicos. La forma exterior de cada cúpula conserva su aproximación con pendiente pronunciada. La fuente de referencia sigue opt-in. Los consumidores comparten geometría, lo que no acredita por sí solo exactitud anatómica.

## Verificación

- Regresión nueva: continuidad de normales, cotas de desplazamiento y altura fuera de la unión, ambos perfiles
- E2E dirigida: clasificación, distancia y gradiente de las interfaces a ambos lados de la unión, CPU/GPU
- Guardas existentes: corazón, contorno hepático/Morison, borde 3D, normales y shader
- Comparaciones portal/subxifoidea, hepatorrenal y demás vistas existentes sobre ambos perfiles, sin ampliar tolerancias ni presupuestos
- Resultados del SHA efectivamente publicado en la descripción del PR
