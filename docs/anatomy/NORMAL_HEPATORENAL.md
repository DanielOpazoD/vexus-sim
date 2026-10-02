# Interfaz hepatorrenal normal: objetivo y protocolo

Se busca parénquima hepático fino y homogéneo, ecogenicidad comparable o discretamente superior a la corteza renal, vasos y diafragma visibles y plano hepatorrenal creíble, sin introducir signos de esteatosis, fibrosis o líquido libre en el caso normal.

## Referencias y límites

Tres capturas proporcionadas por el usuario orientan el aspecto deseado. Una contiene una razón hepatorrenal de 1,05 y ROIs a aproximadamente la misma profundidad. No se redistribuyen esas imágenes ni se usa ese valor como objetivo universal.

[Petzold et al., PLoS One 2020, doi:10.1371/journal.pone.0231044](https://pmc.ncbi.nlm.nih.gov/articles/PMC7194436/) evalúa B-mode/HRI frente a biopsia y muestra limitaciones para discriminar grados leves. [Chauhan et al., J Clin Ultrasound 2016](https://pubmed.ncbi.nlm.nih.gov/27447717/) estudia dependencia del HRI respecto a tamaño, localización y profundidad de ROIs. Los resultados dependen del equipo y del protocolo. Una razón de grises de pantalla no identifica por sí sola la histología ni permite inferir dB de una captura sin mapa conocido.

## Medición del simulador

- Capturas originales del caso normal, respiración apagada, profundidad 180 mm y controles iguales entre versiones
- Dos cuerpos y poses transhepáticas seleccionadas por geometría, no por escoger el resultado más brillante
- Máscaras anatómicas independientes del gris: hígado/corteza con al menos 2 mm de margen; se excluyen vasos, cápsulas, seno, médula, zonas bajo hueso o gas y líneas con acoplamiento inferior a 0,95
- Comparación en bandas de 5 mm de profundidad, con al menos 30 píxeles por tejido. Peso por la menor población para no favorecer el área hepática mayor
- Se informa saturación; no se borran valores brillantes para mejorar el índice. Sin corteza suficiente o con denominador nulo, no se calcula razón
- Las referencias externas orientan textura, anatomía y coherencia clínica, sin ajustar su brillo absoluto al simulador

La medición es un banco de QA de imagen sintética, no una herramienta diagnóstica de esteatosis. Los resultados finales y revisión de imágenes se registran en el PR; no se sustituyen por este documento.

## Ajustes estimados de esta iteración

La razón basal en fundamental fue 1,040/1,091 en legacy/referencia. Se conservan amplitud hepática 1 y cortical 0,72, junto con sus coeficientes de atenuación. El detalle material hepático pasa de célula 4 mm/escala 12 dB a 3 mm/10 dB; conserva dispersores complejos, fase, PSF, anclaje y medianas de la distribución. La grasa perirrenal usa amplitud difusa 1,8 y agrupación 0,5 en vez de 2,4/0,8; la grasa retroperitoneal adyacente comparte esa agrupación. No cambia el grosor ni se elimina su cara anatómica. Los valores son elecciones de modelo sujetas a evaluación, no mediciones de las referencias.

La ventana Hepatorrenal deja ver más eje renal y tejido hepático adyacente. Su geometría se selecciona sin mirar el brillo. La composición permanece activada y la comparación final enciende explícitamente la armónica, que `?e2e=1` no activa por defecto. El fallo de la primera captura basal (3 de 4 imágenes) no se considera una verificación visual completa.
