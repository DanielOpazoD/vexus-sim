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
