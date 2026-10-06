# Registro craneocaudal esternal y diagnóstico de contactos

Defecto: la decisión 166 colocó la unión xifoesternal en z=0 y la punta en z=−30 mm, mientras scene.ts y el registro corporal usan z=0 en la punta. Puede enseñar una posición incorrecta del reborde y confundir el registro del corazón.

Mecanismo: corregir exclusivamente la referencia craneocaudal del esternón y su división de materiales, con un único parámetro para TypeScript, GLSL y mallas. Punta z=0; unión z=18,2615 mm, tomada del landmark ya documentado en REFERENCE_TORSO.md y reference-skin-source.json. Es una coordenada del adulto BodyParts3D registrado, no una medida normativa. Las anchuras, espesor, altura superior y profundidad procedural siguen estimadas; no se declara ajustado el esternón tridimensional al atlas. La descarga fuente desde este Mac no respondió; no se hace un ajuste nuevo de mallas sin fuente verificada.

Predicción: desaparece el segmento xifoideo artificial en z<0 y el cartílago ocupa 0<z<18,2615. El cuerpo óseo empieza en la unión. La imagen y el navegador usan esa misma separación. Permanecen inmóviles costillas y vísceras; su contacto con el nuevo extremo se mide antes de diseñar una modificación conjunta.

Invariantes: áreas vasculares, fisiología, posiciones de hígado/riñones, reloj y sonda. Los presets se conservan; una pérdida de ventana debe investigarse. Fuera del entorno esternal el campo no cambia.

Refutación: persistencia del xifoides caudal, diferencia de frontera entre GPU/CPU/malla, aparición de cortical ósea sobre cartílago, cambio vascular o captura bloqueada. Un contacto incorrecto no puede declararse corregido porque el clasificador esconda una intersección.

Aceptación: controles positivos y negativos a ambos lados de la unión; mallas dentro de su resolución, paridad GPU, adquisiciones y comprobación de imagen. Medición con signo de campos individuales de hueso frente a hígado, riñones y corazón, antes de la prioridad del clasificador. Muestreo de superficies con residual propio declarado: negativo identifica penetración en el campo consultado; positivo no certifica separación global ni distancia euclídea exacta. Se conserva evidencia anterior y posterior. La continuidad articular y el adulto completo siguen pendientes.

BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International. [Descripción oficial](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html), [licencia](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html).
