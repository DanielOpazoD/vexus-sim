# Continuidad de las uniones hepáticas y de la cava

## Alcance

Corrección de una unión del árbol existente y ampliación de sus pruebas de integridad.
Aplica la continuidad anatómica de las decisiones 69 y 90; no introduce otra ley de flujo,
un tejido nuevo ni un umbral clínico. La fisiología, los radios de referencia y las puertas
PW del protocolo conservan sus valores.

## Defecto detectado y corrección

La prueba nueva falló en la base de PR132 para `hvLeftTributary → hvLeft` en tres casos:
adulto normal, insuficiencia tricuspídea y ventilación mecánica. No encontró un testigo
interior a ambas luces en el segmento entre el extremo tributario y el eje receptor
más cercano para algunos calibres producidos por el motor.

El extremo anterior `[10, 14, 14]` se sustituye por `[15, 26, 14]`, situado en el
segmento ya existente `[30, 46, 2] → [0, 6, 26]` de la suprahepática izquierda, con
parámetro 1/2. El desplazamiento es de 13 mm. Se corrige la conexión
al vaso receptor, sin aumentar radios para rellenar el hueco. Es una coordenada derivada
del modelo y no una posición anatómica calibrada con pacientes o un atlas.

La primera candidata sobre el mismo eje, con parámetro 2/3, pasó la guarda de unión pero
falló la prueba existente de contención hepática. Se descartó. El punto medio elegido
conserva ese contrato de al menos 95 % del eje muestreado dentro del hígado; una prueba
adicional lo comprueba con 1000 muestras por segmento, incluidas las ramas periféricas.
Este porcentaje preexistente no demuestra contención completa de las paredes vasculares.

El extremo periférico y su siguiente nodo permanecen iguales. El generador de ramas
periféricas conserva su entrada; la orientación de la sección orgánica del tronco
se recalcula por el mecanismo habitual. La GPU recibe los mismos nodos de escena:
no hay una segunda coordenada que modificar en GLSL.

## Qué comprueba la nueva guarda

`src/validation/support/vascularJunctions.ts` declara 15 conexiones esperadas:
continuidad cava infradiafragmática–supradiafragmática; suprahepática derecha y sus
tributarias; suprahepáticas media e izquierda y sus tributarias; tronco común hacia
la cava; bifurcación portal y ramas de segundo orden. Esa lista no se deduce de la
proximidad geométrica, pues esa proximidad es precisamente lo que se comprueba.

En cada uno de los siete casos se integra una ventana de 8 segundos y se observan
20 instantes separados por 0,4 s, desde t=0,004 s. Se usan los calibres, la forma
orgánica y la relación AP de la cava correspondientes a cada muestra fisiológica.
No se sustituye esa evolución por una escala fija elegida para pasar el test.

Para cada unión se muestrea, con paso máximo de 0,1 mm, la línea desde el extremo
tributario hasta la proyección sobre el eje receptor. Se exige:

- Un punto estrictamente interior a ambas luces, que demuestra volumen local compartido
- Sangre en todos los puntos del puente muestreado según el clasificador final de la escena
- Identidad vascular de uno de los sistemas esperados, sin aceptar bilis, pared u otro sistema como puente

El margen es el mínimo de los dos campos con signo cambiado. No es una distancia
Euclídea en secciones elípticas. El épsilon de 0,000001 separa el cero numérico del
interior; no representa un área mínima de ostium ni un criterio clínico.

## Sensibilidad y límites

Un fantoma analítico de dos tubos distingue solapamiento volumétrico, tangencia
sin volumen y separación. Otra prueba reintroduce el extremo anterior y recalcula
su forma orgánica: debe volver a fallar la guarda, mientras la geometría corregida
mantiene un testigo positivo. También se detectan vasos ausentes y pasos inválidos.

La existencia de un testigo interior es constructiva. Su ausencia en una sola línea
no prueba por sí sola que dos volúmenes sean disjuntos en todo el espacio. El muestreo
temporal y espacial tampoco demuestra continuidad para todos los instantes o puntos.
Esta guarda no mide el área del ostium, no resuelve el flujo local tridimensional,
no verifica todas las colisiones entre vasos y conductos y no acredita fidelidad clínica.

La contención de ramas procedurales con calibre máximo y varios cruces vasculares ya
se prueban en `anatomy.test.ts` y `vesselShape.test.ts`; este banco no los reemplaza.
Las intersecciones pendientes del torso de referencia siguen documentadas aparte.

## Verificación del cambio

Antes de la corrección: 3 casos fallaban y 4 pasaban en la prueba nueva. Después:
los siete pasan, junto con los fantomas y la mutación. Los resultados completos de
formato, tipos, lint, cobertura, calibración, build, presupuesto y CI del SHA definitivo
se registran en el PR. Un fallo esperado preexistente no se presenta como una prueba aprobada.
