# Continuidad en el eje de coordenadas del tronco

Este bloque corrige una singularidad del modelo procedural, no reconstruye el tendón central ni promueve la malla fuente. Base: `10b2c4ede708c5a43422e3ac93e754a749e3763e`.

## Defecto reproducido

La inserción periférica depende de `sin(atan2(v,u))`, con coordenadas corporales normalizadas. Extender ese ángulo hasta `u=v=0` conserva distintos límites según la dirección de aproximación. Como el levantamiento de las cúpulas no es uno en ese eje, la indeterminación se transmite a la altura: una circunferencia de radio 0,001 mm todavía abarca 4,663 mm en legacy y 5,333 mm en referencia. Las dos regresiones de límite único fallan sobre la base.

## Corrección local

La contribución angular se multiplica por `smoothstep(0, 0.1, rho)`, con `rho` el radio elíptico normalizado. El núcleo del 10 % es una regularización estimada, no una estructura anatómica: semiejes 16 y 10,5 mm con el torso actual. `sin(phi)` se calcula como `v/rho` con denominador protegido, evitando `atan(0,0)` en GPU. El peso y su primera derivada se anulan en el eje y llegan suavemente a la fórmula heredada fuera del núcleo. La inserción en el contorno y los ápices no se desplazan.

El informe muestrea 308.321 puntos por perfil a paso 0,5 mm. La altura cambia en 1.018/1.069 puntos; descenso máximo muestreado 4,645/5,320 mm. Fuera del núcleo, la diferencia máxima es menor de 4e−14 mm por redondeo. No es una cota analítica del máximo ni una integración de volumen. Arrays vasculares completos, costillas y riñones coinciden con la base; los recortes hepático/cardíaco compartidos sí pueden cambiar localmente.

## Verificación exigida

- Límite único al reducir el radio, ambos perfiles, con testigo rojo anterior
- Inserción fuera del núcleo, ápices y cotas de la contribución angular preservados
- La regresión de la unión entre cúpulas usa la base radial corregida; sigue verificando independientemente el cruce y la mezcla entre domos, no la extensión angular ya cubierta por el test nuevo
- Paridad dirigida CPU/GPU en el eje exacto y cinco radios alrededor, 244 puntos por perfil, sin situar muestras en el selector discontinuo de cara a 1,25 mm
- Suite completa, contornos hepáticos, corazón, borde 3D, build/presupuesto y capturas finales

Resultados del SHA publicado se registran en el PR. Estas guardas no acreditan fidelidad clínica, inserciones fuente, pilares, hiatos ni caja torácica completa. La aproximación de la pendiente en el borde externo de los domos permanece abierta.
