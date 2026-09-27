# Jueces ciegos de la prueba de fidelidad

Dos jueces de contexto limpio, lanzados en paralelo, que solo pueden abrir las imágenes que genera
`npm run fidelity:blind` (nunca la carpeta de claves). Se les da el rol de experto, se les dice qué
normalización es común a ambos lados y se les pide un formato fijo para puntuar contra la clave.
Mismo texto en cada punto de control, para que las rondas sean comparables.

## Juez 1: parejas A/B

> Eres un juez ciego y adversarial de imágenes de ecografía abdominal en modo B. Tienes el criterio
> combinado de un ecografista/radiólogo con 15 años de experiencia y de un físico de ultrasonido. Tu
> único trabajo es DETECTAR cuál imagen es sintética.
>
> MATERIAL: solo puedes abrir los archivos `pares/parN.png` indicados, con la herramienta de
> lectura; no abras, listes ni busques ningún otro archivo ni directorio.
>
> Cada archivo muestra dos paneles, A y B, con contenido anatómico parecido (hígado, venas
> hepáticas, vena cava inferior, riñón derecho o pared abdominal; sonda convexa de ~3,5 MHz en
> adulto). En cada pareja, exactamente uno de los paneles es una ecografía real de un equipo clínico
> y el otro sale de un simulador por software. El orden A/B está sorteado en cada pareja.
>
> Normalización aplicada por igual a los dos paneles, así que NO son pistas: escala de grises,
> recorte dentro del sector (sin reglas, textos ni bordes del abanico), la misma resolución nativa
> dentro de cada pareja, el mismo tamaño de panel y la misma recompresión JPEG. La ganancia global y
> el brillo medio dependen del operador y del equipo: no los uses como pista por sí solos. Las
> imágenes reales vienen de equipos y épocas distintos (algunas antiguas y granuladas).
>
> Mira la textura del parénquima, los bordes de órganos y vasos, los artefactos, la coherencia
> anatómica y la física de la imagen.
>
> Formato por pareja: `PAR n: real = A|B · confianza = 50–100 % · tiempo hasta decidir = «<1 s» |
«pocos segundos» | «requirió estudio» | «no distingo»`, las pistas decisivas ordenadas, la nota de
> realismo del panel que crees simulado (1 = sintético a simple vista; 3 = un experto lo detecta en
> menos de 1 s; 5 = hace falta estudiarlo; 7 = indistinguible) y qué tendría que cambiar para
> engañarte. Al final: un JSON `{"1": {"real": "A", "confianza": 90, "tiempo": "<1 s", "nota": 2}, …}`,
> las 5 pistas más repetidas con el fenómeno físico o anatómico que crees que las causa, y las
> parejas en que dudaste de verdad. Sé honesto: si no distingues una pareja, dilo y pon confianza 50.

## Juez 2: imágenes sueltas

> Mismo rol. Decide, imagen por imagen y sin comparar parejas, si cada `sueltas/imgNN.png` es una
> ecografía REAL de un equipo clínico o una imagen SINTÉTICA de un simulador. No se revela cuántas
> son reales: puede ser cualquier proporción, así que juzga cada imagen por sí misma. Misma
> normalización y misma advertencia sobre la ganancia.
>
> Formato por imagen: `imgNN: REAL | SINTÉTICA · confianza = 50–100 % · tiempo hasta decidir = … ·
realismo (1–7) = n` y sus pistas. Al final: un JSON `{"img01": {"veredicto": "REAL", "confianza":
80, "tiempo": "pocos segundos", "realismo": 6}, …}`, las pistas más fiables con su causa probable y
> las imágenes en que dudaste de verdad.

## Cómo se puntúa

- Aciertos contra `claves/pares.json` y `claves/sueltas.json`. Con 21 de 21, la exactitud es ≥ 84 %
  con un 95 % de confianza (Clopper-Pearson); «indistinguible» (nota 7) es ≤ 60 %.
- Realismo medio de las simuladas frente al de las reales (la nota de las reales calibra al juez).
- Las hipótesis de causa de los jueces se comprueban contra el código antes de actuar: en la primera
  ronda, «la envolvente es el valor absoluto de un campo real» era falsa (campo complejo, SNR 1,7–2,05).

Primera ronda (23-09-2026, `main` af57add): 7/7 parejas y 14/14 sueltas; realismo 2,6 (simuladas)
frente a 6,3 (reales); nota global 2/7.

Segunda ronda (25-09-2026, `main` 92f1ae8, tras las decisiones 58–63): 7/7 parejas (confianza
90–97 %) y 13/14 sueltas; el único fallo es la pared real (img01), tomada por sintética con 70 %
(«borrosidad pareja»). Realismo 1,9 (simuladas, sueltas y parejas) frente a 5,9 (reales); nota global
2/7. No mejora a la primera: la pared y la cortina ya no delatan, y lo que delata ahora es la
geometría profunda (vasos elípticos con halo simétrico, VCI de bordes paralelos, cápsula renal de
doble línea, pelvis recortada), el brillo de borde que no depende de la incidencia, el grano igual a
toda profundidad y las luces sin ruido. La pareja mejor puntuada (3/7) fue la pared con costillas.

Tercera ronda (26-09-2026, rama del retroperitoneo 75cfbaf sobre `main` 8e83d9a, tras las decisiones 76–81, en
armónica): las mismas 7 reales de la ronda 2 (sin descargar nada) frente a capturas nuevas con la misma normalización
(`scratchpad/gb/blind3.mts`). 7/7 parejas (confianza 96–98 %, todas en «< 1 s») y 14/14 sueltas. Realismo de las
simuladas 2,57 (parejas) y 2,43 (sueltas) frente a 5,71 de las reales; nota global 2/7. Sube el realismo (1,9 →
2,4–2,6), sobre todo el hígado (la pareja 1 llega a 3–4), pero no la detección. Pistas, por peso:

1. **Moteado estacionario** (las 7): mismo grano, contraste y brillo a toda profundidad; sin zona focal, sin
   engrosamiento por la bajada de frecuencia ni estiramiento lateral por la divergencia de las líneas de la convexa;
   resolución casi isótropa (bordes de vaso igual de borrosos en axial y lateral) cuando la real es ~0,5 mm axial
   frente a 1–3 mm lateral; «sal y pimienta» sin el suavizado del equipo.
2. **Interfaces como trazos** de brillo y grosor constantes que siguen brillando oblicuas y salen del órgano: sin la
   caída especular fuera de la perpendicular, sin componente difusa ni fragmentación por rugosidad, sin grosor ligado
   al haz.
3. **Anatomía de primitivas**: venas que acaban en círculo («piruleta»), focos de tríada como elipses sueltas sin luz,
   VCI de paredes paralelas y calibre constante, riñón con la cápsula abierta, seno igual al moteado pero más brillante,
   pirámides como hendiduras regulares, zonas negras de borde curvo sin correlato.
4. **Faltan los artefactos del líquido y del hueso**: refuerzo posterior bajo la VCI y los vasos, sombras de borde por
   refracción, relleno de las luces pequeñas por el grosor de corte, sombras costales que no se abren con el abanico.
5. **Una sola escala de textura**: sin heterogeneidad de milímetros a centímetros ni textura propia por tejido (grasa
   con septos, músculo con fibras, corteza frente a seno), ni firma del equipo (suavizado o estrías de líneas).

Defecto del diseño: las parejas 1 y 7, 2 y 3, y 4 y 5 comparten escena simulada (el juez lo notó; no le hizo falta). En
la ronda 4 cada pareja tendrá su propia escena (ventana, pose o caso distintos).

Cuarta ronda (27-09-2026, `main` 0e03756, tras las decisiones 65 y 84–87: interfaces según la incidencia, PSF con la
profundidad, corazón y mediastino, artefactos del líquido, riñón y venas), en armónica, con una escena propia por pareja
(`scratchpad/gb/blind4.mts`: riñón del caso con FA desplazado, VCI ancha por el flanco, pared desplazada y
suprahepáticas anchas por la subcostal). 7/7 parejas (confianza 90–98 %, todas en «< 1 s»; nota 2,29) y 14/14
sueltas, pero el realismo de las sueltas simuladas sube de 2,43 a 3,14 (reales 6,43): la suprahepática ancha
subcostal «requirió estudio» (60 %, realismo 5) y el hígado intercostal quedó en 75 % (realismo 4). La VCI del
flanco, un tubo recto de paredes paralelas, fue la peor (1/7). Pistas, por peso:

1. **Geometría de primitivas**: VCI como tubo recto de calibre constante, vasos pequeños circulares perfectos,
   costillas idénticas en cúpula con el disco del hueso distinto de su sombra, arcos de pared equidistantes.
2. **Una línea brillante dentro de la sombra de una costilla** (los dos jueces, pareja 6): error de oclusión.
3. **Interfaces aún como trazos** cerca de la perpendicular (cápsula renal, paredes de la VCI).
4. **Moteado «empedrado»**: granos redondos iguales, sin los destellos aislados del tejido real; y **luces con
   textura ordenada** (pinceladas) en lugar de ruido electrónico casi blanco.
5. Lo que convenció de las reales: brillo de pared según el ángulo, refuerzo bajo la VCI, estrías de líneas de
   barrido, procesado de equipo moderno y detalles anatómicos finos.

Quinta ronda (27-09-2026, `main` 6c0ba5b, tras las decisiones 88–90: costillas opacas y pared con relieve, textura del
parénquima y ruido del receptor, vasos orgánicos), con la pared de la pareja 6 por la subcostal, sin costillas como su
real (`scratchpad/gb/blind5.mts`). 7/7 parejas (confianza 82–94 %; nota 2,57, la pared 4) y 14/14 sueltas; el realismo
de las sueltas simuladas sigue subiendo: 1,9 → 2,43 → 3,14 → 3,43 (reales 6,71), con dos que «requirieron estudio» al
65 % (el hígado intercostal y la pared subcostal, realismo 5). Pistas nuevas y persistentes:

1. **Costuras y peines**: dos costuras verticales en la textura de la VCI del flanco, con la pared quebrada en ellas, y
   un peine de estrías horizontales en el borde de la subcostal; no siguen la geometría del haz.
2. **Tras el diafragma**: en la subxifoidea el tejido termina en un arco liso contra una zona negra, sin eco de
   interfaz ni espejo.
3. **Grano uniforme** en todo el campo y **paredes capilares** (grosor y brillo constantes) cerca de la perpendicular.
4. **Luces**: ruido uniforme, sin reverberación bajo la pared anterior ni refuerzo visible.
5. **Firma del equipo**: las siete simuladas comparten una firma y las reales vienen de equipos distintos (reducción de
   moteado, estrías de líneas, ganancia baja).
