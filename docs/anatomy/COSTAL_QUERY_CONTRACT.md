# Consulta costal exacta con descarte conservador

Defecto antes de implementar: completar doce pares duplica consultas trigonométricas de costilla por muestra/vecino de imagen, aunque casi todas estén lejos en z. En CI SwiftShader la prueba de captura quedó sin su presupuesto de arranque; ese instrumento ya se corrigió, sin ocultar la necesidad de contener el coste de la anatomía.

Mecanismo: cota inferior analítica de distancia costal a partir del intervalo craneocaudal del arco y semiejes de sección. Si no puede mejorar ninguno de los dos mínimos (hueso y cualquier material), omitir la consulta completa. Cota = ((max(0, |z−(zAnterior+tilt/2)|−hypot(tilt/2,c))/halfWidth)−1)·min(halfWidth,halfThickness). La terminación libre solo aumenta distancia. No descartar la costilla con cartílago de fuente registrado, que tiene otro campo. Margen conservador float32 0,01 mm. No alterar SDF, órganos, muestras, interfaces ni su prioridad.

Predicción: exactamente los mismos mínimos y tejidos/interfaz en ambas anatomías, normales y distancias GPU iguales; menos consultas completas. Sin bajar densidad de muestreo, frecuencia de imagen ni umbrales de pruebas. No caché invalidable, índices espaciales generales ni BVH.

Refutación y aceptación: banco independiente que consulta todas las costillas frente al descarte, puntos en superficies, negativos ante extremos libres y cartel fuente, barrido de tejido/vaso/velocidad/interface CPU/GPU existente completo. Medir número de consultas y tiempo pareado, conservar contador y condiciones de medición. Aceptación exige al menos reducción de consultas, sin prometer fps clínicos ni ganancias de GPU basadas solo en CPU.

Presupuesto: verificar crecimiento dentro de 1031 KiB; si lo supera, registrar coste explícito del único helper y su gemelo GLSL. No omitir activos ni quitar bancos.

El primer contador exigió arbitrariamente 25 % de reducción, ajeno al criterio previo; el cuerpo procedural redujo 84994→71551 consultas (15,8 %). Se conserva ese fallo en 09-focal.log y se corrige el instrumento a exigir reducción, como el contrato. Paridad y cota matemática permanecen exactas. La cota se satura en 1000 mm para respetar el valor centinela fuera de los extremos del arco.

Medición pareada CPU (cinco pares, 6279 puntos × ocho repeticiones/cuerpo): 602384→513832 consultas en procedural y 601632→511288 en referencia. La primera implementación usaba Math.hypot por punto y resultó más lenta (medianas 90→97 y 110→118 ms): rechazada. La misma cota con sqrt(a²+b²), gemela del length GLSL, conserva el resultado. En la segunda medición compartiendo Mac con validación, medianas 105→96 y 123→134 ms: variación alta, por lo que no se declara ganancia de tiempo/fps; solo reducción exacta de consultas. Logs completos de ambas mediciones conservados externamente.

Build observado 1031,4 KiB frente a 1031: +1 KiB explícito para el helper TS/GLSL y el diagnóstico (1032 total); no se excluyen assets, Workers ni comprobaciones.
