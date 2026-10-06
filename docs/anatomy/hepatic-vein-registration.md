# Suprahepáticas del abdomen registrado

La cúpula antigua (+55 mm) y los ejes principales heredados dejaban la VSH derecha en el polo superior fuera del nuevo campo hepático. Testigo: [-60, −15, 19,75] mm, parénquima/superficie superior del atlas, se clasificaba como VSH derecha. Es un defecto geométrico, no se corrige en el shader de color ni tapando el vaso.

Fuentes locales del archivo BodyParts3D 4.0 ya fijado: FJ2416 (derecha, SHA256 `0e239c38accb79c114d9214e97cd2e8c96b29913c37725325e2942e1af2980ee`) y FJ2415 (izquierda, `f6f2d7c03cf24362c80741608d5e8bdcc1c259bd17aaf19fd2ab974be6220a3c`). Se mantiene exactamente el registro LAS/xifoides de todos los órganos. Datos originales y candidatos por sección en `hepatic-vein-source-sections.json`. Crédito y licencia: BodyParts3D / DBCLS, CC BY 4.0, conforme al NOTICE del atlas.

Integración limitada: centroides de secciones proximales derecha (x −70 a −23) e izquierda (x +25 a −8). Los trayectos entre estas secciones, vena media, tributarias y tronco común son estimados y se contrastan contra los campos de órganos antes de clasificar. No son una segmentación vascular completa. Los calibres fisiológicos, paredes, waveform, semilla y escalado por congestión se conservan. Las ramas menores se construyen de nuevo desde las madres registradas y el mismo campo hepático; no se trasladan órganos.

Candidatos rechazados y razón:

- El seguimiento de centroides próximos en cortes de 1 mm a través de todo FJ2416 saltaba entre ramas y originaba un trayecto con vueltas artificiales. No se integra ese seguimiento ni se ocultan las ramas descartadas.
- Las secciones izquierdas distales x +35/+45 penetran el campo gástrico/hepático reconciliado. Mantenerlas literalmente daba un centro venoso a −4,37 mm dentro del campo digestivo. Se conservan como evidencia de incompatibilidad de estos activos; la integración proximal empieza en x +25. Las tributarias distales estimadas se mantienen dentro del hígado.
- El primer origen estimado de la vena media [−43,33,−82] estaba en la fosa hepática, fuera del hígado. Se sustituye por un trayecto intrahepático anterior; no se gana la prueba dando prioridad al vaso sobre la vesícula o rellenando la fosa.

Aceptación: centro venoso hepático dentro del campo hepático, excepto la unión explícita con la cava; sin centros dentro del lumen digestivo; continuidad real de uniones; el testigo superior debe ser diafragma y concordar CPU/GPU. Revisar después las ventanas con los controles reales, pues una pose calibrada para ejes antiguos puede dejar de ser útil. Los datos fuente no certifican aceptación anatómica ni clínica externa.

Las poses atlas intercostal y subcostal se recalibran fuera de línea con `tools/anatomy/find-reference-poses.ts --abdomen <ventana>` usando los nuevos ejes, compresión y rechazo de costilla/pulmón. No hay autoorientación durante la exploración. Intercostal conserva marcador oblicuo hacia la axila; las vistas longitudinales, craneal. Reproducir las secciones fuente: `python tools/anatomy/inspect-hepatic-vein-sections.py --source-dir <OBJ fijados> --output <JSON>` (numpy/trimesh, sin dependencias de ejecución).

El arranque real detectó exceso de ramas estimadas al caber más en el hígado corregido. El generador se acota ahora a la capacidad compartida existente de 128 tubos, descontando previamente todos los vasos principales y conductos. Se omiten sólo ramas periféricas estimadas que ya no caben, en orden determinista; las madres terminales se afilan mediante la misma regla del árbol. No aumenta el límite ni se descartan vasos con nombre. Coordenadas fuente redondeadas a 0,0001 mm; JSON conserva los valores completos.
