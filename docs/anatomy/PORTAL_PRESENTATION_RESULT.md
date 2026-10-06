# Porta roja: resultado local de la decisión 170

La paleta hacia la sonda permanece roja en toda la escala, con brillo creciente; flujo opuesto usa azul. `colorMap.ts` comparte los mismos extremos entre GPU y barra. Al seleccionar **Porta · intrahepática**, la interfaz aplica profundidad 150 mm, foco 100 mm, ganancia B −2 dB, RD 65; caja 70–125 mm, ancho 0,42 rad, centro 0,11 rad procedural / 0,31 rad referencia; escala ±35 cm/s, ganancia color +12 dB, filtro 60 Hz. Modos encendidos, ensemble, TGC y persistencia permanecen; los controles siguen editables. La tarjeta informa de estos ajustes.

El paciente, la geometría y la adquisición del tronco PW conservan su código. La ganancia actúa sobre la señal existente; el procesamiento complejo, la potencia umbral, signos, aliasing, filtro, contacto y transmisión no se sustituyeron por relleno de una máscara. Mover la sonda manualmente no dispara el ajuste. Elegir otra ventana conserva los ajustes actuales, como antes; el ajuste se vuelve a aplicar al seleccionar esta tarjeta.

## Evidencia y controles

Cuatro pruebas de interfaz real, normal/congestión grave × dos cuerpos, seleccionan la tarjeta y Color sin `colorOnVessel`. Semilla/caso registrados; sonda estacionaria y apnea, alrededor de 30,03 s. Una ROI de evaluación identifica la rama derecha; no modifica la imagen. Media de ocho cuadros por ganancia, misma caja y fase:

| Cuerpo / caso       | Relleno a 0 dB | Relleno a +12 dB | Píxeles rojos | Píxeles amarillos |
| ------------------- | -------------: | ---------------: | ------------: | ----------------: |
| Procedural / normal |         39,2 % |           92,2 % |          3187 |                 0 |
| Procedural / grave  |         35,3 % |           92,7 % |          3326 |                 0 |
| Referencia / normal |         26,6 % |           91,1 % |          3722 |                 0 |
| Referencia / grave  |         29,0 % |           93,2 % |          3979 |                 0 |

Relleno = proporción de celdas de rama con fracción de sangre ≥0,8 cuya potencia supera 0,0035. No es el porcentaje de superficie visible, sensibilidad clínica ni un rendimiento universal. Cada ejecución tiene otros cuadros de ruido. Píxeles RGB se cuentan sobre el framebuffer real, por separado del campo. Se conservan píxeles azules cuando corresponde; no se obliga a rojo todo el contenido de la caja.

Inversión: campo de frecuencia/potencia exactamente idéntico, con predominio azul en vez de rojo. Caja superficial sin sangre: cero celdas sobre umbral en cuatro cuadros; filtro 600 Hz: cero celdas de rama sobre umbral. Las pruebas de la decisión 169 mantienen aliasing a PRF 700 Hz, exactitud de filtrado complejo e inversión. Los controles previos de contacto, transmisión/ganancia y cine pasan.

La comparación visual usa PNG originales de la iteración 168 y capturas nuevas de **localhost:3008** mediante tarjeta y botón ordinarios, 1440×900, caso normal, semilla 20260921 y apnea. Antes: 18 cm, ganancia B 0, RD 70, color +8; después: 15 cm, ganancia B −2, RD 65, color +12. Cajas, tiempo fino y ruido difieren. No es comparación píxel a píxel ni permite atribuir todo el cambio a un único parámetro. Las imágenes muestran rama más destacada y rojo con mayor continuidad; persisten sombras costales, grano y estructuras vecinas.

La primera inspección nueva omitió asentar la velocidad de sonda tras el salto de pose; generó clutter y un relleno falso generalizado. Está marcada inválida en `porta-roja/before/INVALID.md` y no se usó para ajustar ni aceptar. El barrido corregido `before-stationary` deja la sonda asentarse antes de medir: +12 dB aporta mejor relleno que 0/+8 y menos extensión que +16; se conservó filtro 60 Hz en vez de bajarlo a 40. Cerca de paredes, ganancia e interpolación pueden extender color fuera del centro clasificado como sangre; el control de caja sin sangre no certifica contención perfecta en todas las interfaces.

## Verificación y entrega

- Suite rápida completa: **147 archivos, 1157/1157**, salida 0, 60,59 s. Incluye mapa, correlación, equipo, adquisición y controles previos. Tras añadir la decisión se regeneró y comprobó el índice documental.
- **10 E2E en Chromium/ANGLE Metal**: cuatro nuevas de interfaz; dos de correlación/aliasing; cine; imagen inicial VCI; ausencia de contacto; transmisión/ganancia. Todas salida 0, en tres ejecuciones de 4/3/3. Capturas de localhost adicionales sin errores de página/consola.
- Compilación Vite, tipos, lint y formato aprobados. Presupuesto **1029,2 KiB ≤1030**, sin ampliarlo. No se añadió textura ni pasada.

Trabajo local en `/Users/daniel/Documents/Codex/2026-10-05/task/vexus-sim-anatomia`, rama `feat/anatomia-ecografica-local`, base `d7f214ff6c4707c25e9d42ec037d0baddb5ec9b5`, sin commit/publicación. Snapshot: **484 archivos**, SHA256 `a6e4531aead7df7d79c5de9cd85dd96e346c2c68e30a6b8dd6e938f482d29788`. Versión exacta del árbol en `evaluacion-vexus/porta-roja/source-snapshot.json`, basada en el inventario de la decisión 169 y archivos nuevos. Evidencias, JSON, logs y **comparacion.html** en `/Users/daniel/Documents/Codex/2026-10-05/task/evaluacion-vexus/porta-roja/`.

Servidor mejorado **http://localhost:3008**, launchd `com.daniel.vexus-sim.anatomia3008.20261006`, PID 62341, Vite con host localhost y puerto estricto; disponible independientemente del turno durante esta sesión del Mac. El main del Escritorio y **localhost:3007** permanecen intactos.

## Fuentes y límites

Las imágenes aportadas por el usuario y las figuras clínicas de [Assavapokee, Rola, Assavapokee y Koratala (2024)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11576717/) orientan el ajuste. Esa revisión describe flujo portal continuo rojo hacia la sonda en su adquisición, recomienda adaptar equipo y advierte que escala baja puede introducir aliasing. [El protocolo institucional de University of Washington (2024)](https://depts.washington.edu/usrad/wordpress/wp-content/uploads/2024/07/PVT-Abdominal-Doppler-Protocol-7.24-3.pdf) distingue porta principal, ramas y confluencia. Ninguna fuente prescribe nuestros valores exactos de RGB, gain, caja, profundidad o foco: son elecciones estimadas y editables.

Falta evaluación independiente con clips reales y máquinas conocidas, más fases/ventanas y variabilidad anatómica. No se afirma equivalencia de rama derecha y tronco principal, ni validación clínica por expertos humanos. Persisten las deudas anatómicas/hemodinámicas documentadas en las decisiones 166–168, incluido el contraejemplo interno de VCI de 19,46 m/s; esta mejora de adquisición/presentación no lo repara. Corazón y pulmón externos siguen pendientes.
