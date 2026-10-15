# Contrato previo: ventana hepática derecha (182)

Defectos reproducidos en 6d332a9: resto abdominal clasificado como mesenterio aun
por fuera de la cara hepática lateral; diafragma dentro del hígado a
[-102.5214446,-7.9255744,-14.6906777] mm (campo hepático −5,39 mm);
cuadrado lumbar heredado entre z −45/−190, frente a costilla 12 registrada
−75/−153 y cresta ilíaca ~−207 mm; lente 3D girada fuera del plano x/z y haz
radial con cuerda 67,1 mm frente a la lente declarada 62 mm.

Mecanismo y predicción: limitar el mesenterio a su territorio digestivo, declarar
el tejido no segmentado restante sin fingir una grasa mesentérica segmentada;
impedir que la aproximación tangente del diafragma entre en el parénquima;
anclar el cuadrado lumbar estimado a los niveles registrados y al compartimento
paravertebral, en CPU/GLSL/3D; hacer coincidir la lente y la huella acústica.
No aumentar el hígado ni mover sus vasos para cubrir un relleno desconocido.

Invariantes: todos los bytes de órganos/costillas se conservan; ninguna muestra
hepática a >2 mm de su superficie será pulmón o diafragma; ningún cuadrado
lumbar fuera de la pared ni encima de su inserción costal; la lente contacta
los orígenes de rayos en mm, con el marcador rígido en el extremo marcado.

Refutación: testigos independientes de huesos FJ3332/FJ3227, L1–L5 y FJ3152/
FJ3288, del archivo BP3D ya fijado; campo hepático embarcado y vértices reales
de la lente. Conservar fallos previos. Aceptación: tipos/lint/formato, pruebas
focalizadas CPU/GPU y producción nativa, nueve ventanas con rotación,
abanico y basculación, sin errores. No bajar presupuestos ni reintentar CI.

Fuentes: AIUM Abdomen/Retroperitoneum 2026, DOI 10.1002/jum.70430 e imágenes
https://aium.s3.amazonaws.com/guidelines/abdomen/imageResources.pdf;
Kratzer 2003 DOI 10.7863/jum.2003.22.11.1155 (diámetro medioclavicular, no
caja global); ASRA 2022
https://asra.com/news-publications/asra-updates/blog-landing/legacy-b-blog-posts/2022/02/06/ultrasound-guided-quadratus-lumborum-block-how-do-i-do-it-
(QL dorsal al psoas, cresta ilíaca–costilla 12). El QL y los tejidos residuales
siguen estimados, no segmentados. El diafragma original tiene conciliaciones
pendientes: no integrarlo como si hubiera pasado esa aceptación.
