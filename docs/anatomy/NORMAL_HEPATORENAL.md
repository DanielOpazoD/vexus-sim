# Interfaz hepatorrenal normal: objetivo y protocolo

Trabajo en curso. Se busca parénquima hepático fino y homogéneo, ecogenicidad comparable o discretamente superior a la corteza renal, vasos y diafragma visibles y plano hepatorrenal creíble, sin introducir signos de esteatosis, fibrosis o líquido libre en el caso normal.

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

La medición es un banco de QA de imagen sintética, no una herramienta diagnóstica de esteatosis. Aún faltan resultados y revisión de los ajustes físicos antes de cerrar el bloque.
