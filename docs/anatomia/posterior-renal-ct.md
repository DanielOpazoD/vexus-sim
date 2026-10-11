# Compartimento posterior renal: fuente, campo y límites

El riñón no está incluido en el cuadrado lumbar. Su polo inferior queda anterior
a ese músculo, separado por grasa perirrenal, fascia renal posterior y fascia
toracolumbar anterior. [ASRA, revisión del 6 de febrero de 2022](https://asra.com/news-publications/asra-updates/blog-landing/legacy-b-blog-posts/2022/02/06/ultrasound-guided-quadratus-lumborum-block-how-do-i-do-it-)
describe esas relaciones y sus imágenes ecográficas; no proporciona un espesor
universal para trasladarlo al paciente sintético.

## Corrección del soporte muscular

En `c9421cb`, el campo aislado del cuadrado lumbar tenía límite anterior, lateral
y craneocaudal, pero carecía del límite posterior contra la pared. La prioridad
de piel/pared impedía verlo fuera del cuerpo en el corte ecográfico, mientras la
malla 3D extraía el campo sin esa prioridad. Sus vértices sobresalían hasta
91,63 mm en el cuerpo procedural y 72,29 mm en el cuerpo de referencia.

`quadratusSdf` cierra ahora su soporte en la misma cara interna de la pared, con
la cota de gradiente ya utilizada. TS y GLSL contienen la misma frontera; la
malla, el plano y la adquisición conservan su fuente común. No se desplazan
riñones, hígado, costillas, psoas ni columna. No se añade una línea ecográfica ni
un recorte por ventana.

La repetición del barrido registra cero muestras musculares fuera de la pared,
conservando 1.334 muestras interiores procedurales y 1.909 de referencia. Todos
los vértices emitidos quedan dentro de la pared con desviación numérica máxima
de 0,033 mm. Son medidas de este instrumento y su rejilla, no volúmenes ni una
validación de forma, inserciones, fascia o normalidad clínica del QL estimado.

## Contraste con TAC independiente

`tools/anatomy/ct_posterior_reference.py` recibe un manifest que fija SHA de TAC
y máscaras del **mismo caso**. Exige rejilla, affine, unidades y datos binarios
válidos. Conserva componentes y estudia:

- Distancias físicas entre centros de voxeles de frontera de riñón y músculos,
  hígado, columna y costillas, con pares de puntos testigo.
- Columnas AP originales entre riñón e iliopsoas, incluyendo adyacencia de
  etiquetas, ausencia de músculo en el rayo e intensidades interpuestas.
- Forma y dimensiones originales, componentes y límites de cada máscara.

La auditoría local utiliza TotalSegmentator v3.0.0, s0028, TAC SHA256
`d11b8acbf137277d157930f7d0cb3a5f259364a5e5af18dafcd3cac0ecf4168c`.
El muestreo original es de 1,5 mm; las unidades ausentes del header requieren
evidencia de procedencia explícita. Fuente:
[datos](https://doi.org/10.5281/zenodo.22688904) y
[publicación](https://arxiv.org/abs/2208.05868), © Jakob Wasserthal / University
Hospital Basel, CC BY 4.0. No se incluyen datos de pacientes en este PR.

## Puertas que permanecen abiertas

`iliopsoas` no es psoas aislado, y `autochthon` no identifica por separado QL,
iliocostales y longísimos. Estas máscaras no incluyen fascias renales ni QL.
La tarea adicional `abdominal_muscles` de TotalSegmentator puede producir QL;
una predicción nueva necesita revisión, procedencia y contraste antes de
incorporarse. Una fracción de intensidades compatibles con grasa no crea una
segmentación de grasa ni de fascia.

El TAC y el modelo proceden de personas distintas. Se comparan relaciones, sin
ajustar órganos por separado ni instalar sus máscaras en el runtime. La fase
de contraste, la normalidad y las interfaces acústicas siguen sin aceptación.
El caso s0440 queda reservado; s0119 sigue excluido del ajuste renal normal.

Esta corrección acota un soporte estimado en `main`. El atlas de PR219 es otro
dominio pendiente de integración: su recorte del psoas contra cápsula/grasa
renal necesita una corrección independiente, y este cambio no la certifica.
La revisión ecográfica externa, los barridos completos y la anatomía fascial
real permanecen pendientes.
