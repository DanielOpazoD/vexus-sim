# Evidencia cloud del saneamiento de referencia

Chromium del sistema con SwiftShader, Node24. No mide Metal ni valida anatomía clínica. Build con `?reference=1`, piel/columna y seis pares 5–10; solo el séptimo cartílago tiene fuente recuperada. Respiración apagada al iniciar, ECG/latido activos.

- `reference-subxiphoid.png`: captura congelada en la ventana subxifoidea con VCI visible y navegador 3D renderizado.
- `legacy-subxiphoid.png`: control con el torso previo, mismo equipo y preset. Las poses efectivas son distintas por el registro de referencia; no es un benchmark controlado ni comparación clínica.
- `reference-costal-shadow.png`: adquisición lateral izquierda de la E2E que exige transmisión posterior al primer impacto óseo <1 % de la previa. La imagen también contiene artefactos de interfaces/pulmón; el gate cuantitativo evalúa segmentos y transmisión, no el aspecto de toda la cuña.

La primera corrida del build optimizado falló: dos pruebas registraron error GLSL `ACESFilmicToneMapping` en Three.js; la tercera consultó una cara inexistente con fixtures laterales heredados y lanzó null. Se corrigió el contrato de nombres construidos dinámicamente y se añadió prueba de regresión. Los fixtures de la nueva E2E ahora exigen explícitamente interfaz cortical en las bandas fuente de 6–10; la quinta no queda cubierta porque falta su interfaz exterior profunda. Esto sigue declarado como limitación, sin cambiar umbrales de los gates previos. Tras esos cambios, las tres E2E pasaron con retries=0 (4,2 min).

`npm run check`: 97 archivos, 984 pruebas aprobadas +12 fallos esperados preexistentes; cobertura statements 91,87 %, branches 90,22 %, functions 91,28 %, lines 92,93 %. La nueva regresión Three pasó aparte, y formato/lint/tipos fueron repetidos después. Build total: 1.036.644 bytes JS, 3.740 bytes de margen, todos los chunks/Workers/testHooks incluidos.

Gates adicionales finales: 7/7 para geometría/registro legacy, tríadas portales, respiración legacy, normales, pared y transmisión; 3/3 para equivalencia completa legacy/referencia y respiración de referencia. Total 13/13 E2E pertinentes, retries=0. CI remoto pendiente de registrar en `../TORSO_PROGRESS.md`. Los logs completos están en `/workspace/vexus-evidence/reference-final` en este contenedor; no incluyen tokens ni URLs firmadas.
