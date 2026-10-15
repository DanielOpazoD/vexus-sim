# Contención de los cuadrados lumbares — contrato previo (181)

**Defecto.** Las dos láminas rojizas posteriores de la captura son las mallas de
`Cuadrado lumbar`, no costillas ni órganos nuevos. El campo aceptaba profundidades
negativas respecto de la cara interna de la pared: su volumen se prolongaba fuera
del cuerpo hasta la caja de extracción 3D. El clasificador ecográfico ocultaba ese
error porque resolvía piel y pared primero; la malla consultaba el campo aislado.

**Mecanismo y predicción.** Añadir al mismo campo CPU/GLSL la frontera externa que
le falta, con la cota de gradiente ya utilizada para la pared. El cero debe cerrar
el músculo en la cara interna posterior. Desaparecerán las extensiones externas
sin retirar el músculo ni recortar sólo el dibujo. El interior muscular válido
y las prioridades de riñón/grasa, pared, vasos y hueso se conservan.

**Invariantes.** Registro, órganos, costillas, calibración vascular, datos del atlas
y límites de memoria/bundle no cambian. La superficie 3D sigue extrayéndose del
campo acústico. No introducir otro volumen, desplazamiento o material de ocultación.

**Refutación y aceptación.** Un control negativo fuera de la pared debe fallar con
el campo anterior y pasar con el corregido. En ambos cuerpos (procedural y atlas),
todos los vértices emitidos del músculo deben quedar dentro de la cara interna
con error de extracción inferior a 1,5 mm; el volumen no debe desaparecer. Exigir
regresión retroperitoneal, tipos/lint, calibración, paridad CPU/GPU y adquisición
nativa de las ventanas, más capturas posteriores antes/después sin errores de
navegador. Conservar resultados fallidos; Metal no reemplaza CI/SwiftShader.

**Dominio y límite.** Corrección de una representación estimada, no segmentación
nueva ni validación clínica humana. El cuadrado lumbar real es posterior al
iliopsoas, entre cresta ilíaca y costilla 12, ligado a transversas L1–L4; quedan
pendientes su forma, inserciones y dimensiones propias del adulto registrado.
La selección local del atlas BP3D no incluye superficies identificadas de estos
músculos. Referencia anatómica profesional: [ASRA, 6 de febrero de 2022](https://asra.com/news-publications/asra-updates/blog-landing/legacy-b-blog-posts/2022/02/06/ultrasound-guided-quadratus-lumborum-block-how-do-i-do-it-).
