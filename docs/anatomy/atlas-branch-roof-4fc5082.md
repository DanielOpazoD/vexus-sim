# Techo registrado — historia de la rama Atlas

Fuente: `4fc508201d9323691bfb2f3220fc7fb708b5fde2`, PR224. Se conservan las decisiones188 y189
sin renumerar. Este archivo recoge hipótesis, resultados y rechazos originales;
no acredita su verificación sobre la nueva integración de main.

## 188. Consulta anatómica escalar sin asignaciones por punto

**Contexto.** El lector abdominal y el torácico creaban arrays de coordenadas,
índices y pesos y una función de indexación en cada punto. La consulta de
distancia también construía un resultado con etiqueta, aunque el clasificador
solo necesitara distancia. El plano anatómico96×128 repite estas consultas.
Los barridos históricos detectaron pérdidas del Worker; esta hipótesis de coste
se contrasta sin atribuirles una causa exclusivamente a priori.

**Opciones.** Reducir resolución o relajar el watchdog cambia el instrumento.
Cachés por ventana arriesgan anatomía obsoleta durante movimientos. Reescribir
la geometría para acelerar modifica la imagen. Se elimina trabajo redundante
en la consulta del mismo campo, sin cambiar esos parámetros.

**Decisión.** `sourceVolume.ts` comparte la interpolación escalar RG16F de los
lectores abdominal y torácico. Distancia y etiqueta tienen consultas distintas:
no se lee identidad cuando solo se necesita distancia. `halfFloat.ts` conserva
la tabla de decodificación y la exportación `HALF` anterior. Mismos nodos,
pesos, suma y soporte; sin modificar el GLSL ni los assets.

**Consecuencias.** Menos asignaciones temporales en las consultas CPU usadas
por el plano, puertas y mediciones. No añade textura, tejido o geometría y no
certifica fluidez, anatomía posterior ni arranque del atlas en SwiftShader.
El contrato y el protocolo pareado constan en `docs/fidelity/atlas-query-contract.md`.

**Verificación.** Campo afín analítico con offsets, etiquetas categóricas,
última celda y exterior en `sourceVolume.test.ts`; pruebas previas de atlas
conservadas. `tools/fidelity/atlasQueryAudit.ts` compara los módulos reales
antes/después, todos los lotes intercalados y nueve ventanas con vecinos en
dos casos. La aceptación requiere además capturas/gestos registrados,
check/calibración y CI exacta; resultados y limitaciones se registran en el PR.

## 189. Techo diafragmático registrado experimental y cero acústico común

**Contexto.** Fuera del soporte hepático del atlas, el techo vuelve a cúpulas
heredadas incompatibles con la fuente registrada: el testigo X−31/Y−45 pasa
por 51,12 mm frente a un último cruce fuente en 10,17 mm. Son alturas por
rayo, no separación clínica. Aparecen cuñas de grasa retroperitoneal en cortes.

**Opciones.** Ajustar dos cúpulas reduce el residual mediano de 29,88 a
4,07 mm, pero mantiene un máximo de 72,64 mm; se descarta. No ocultar grasa
por ventana, mover órganos, alisar la fuente entera ni adoptar una fuente con
conflictos vasculares/esofágicos como si sus hiatos estuvieran validados.

**Decisión.** Variante experimental: `register-diaphragm-roof.py` proyecta
el último cruce de FJ3131 saneada en el registro LAS común, termina el grafo
en la inserción costal estimada existente y extiende armónicamente solo el
dominio sin cruce. Compone el contacto hepático existente y guarda la altura
en una lámina libre de la misma textura RG16F, con XY transpuesto. No altera
campos de órganos, etiquetas, soporte de contacto, radios ni fisiología.
`diaphragmHeight`/GLSL comparten esa tabla. `diaphragmSurfaceZ` resuelve el
cero del obstáculo hepático también cuando el soporte normal es cero; el
borde 3D usa ese mismo cero y la pared interna. El primer ensayo borraba
29 muestras centrales de VCI infra y9 supra; se conserva como rechazado.
`raInferiorZ` calcula el cruce inferior del elipsoide auricular inclinado
existente. El recorte de VCI superior al diafragma espera también a alcanzar
esa entrada; conserva la protección de tabiques y no mueve la AD.
Precisión de raíz numérica,
no resolución anatómica añadida.

**Consecuencias.** Es un grafo de techo y una cáscara acústica estimada, no
el diafragma completo: cruras, hiatos, espesores fuente e inserciones por
pieza siguen sin validar. La extensión sin cruce no acredita normalidad.
La separación renal-fascial y las fuentes musculares siguen abiertas;
se conserva el ensayo rechazado que fragmentó psoas. No añade textura ni
memoria volumétrica; el coste de consultas, arranque y gesto debe medirse.

**Verificación.** Hashes independientes de los once campos previos,
testigos de cruces fuente fuera de la transición hepática, testigos rechazados
de cero 3D y borde registrado en `registeredDiaphragmRoof.test.ts`; paridad
CPU/GPU y normales en `registeredRoof.spec.ts`. Auditoría de todos los
vértices/centroides de vasos/esófago/riñones, cortes de CT independientes,
3065 ceros y96 bordes, adquisiciones antes/después y barridos registrados.
Estos instrumentos no certifican contactos completos ni fidelidad clínica.
El PR conserva fallos, limitaciones y estado real; integración requiere CI
exacta sin reintentos que oculten fallos y revisión anatómica pendiente.

**Refutación numérica.** El primer ensayo nativo del techo encontró errores
de norma CPU/GPU de hasta0,367 en el banco de vecinos. La interpolación lineal
del hardware cuantiza pesos fraccionales; las diferencias centrales anidadas
de0,5 y0,02mm los amplifican cerca de pendientes pronunciadas. El lector GLSL
del techo interpola explícitamente sus cuatro nodos RG16F en precisión float,
con el mismo orden escalar de TS. Conserva nodos y geometría; no se amplían
las tolerancias. Su coste adicional requiere medición y la prueba original
debe pasar. Las consultas previas de órganos/contacto permanecen intactas.

**Refutación geométrica.** Una paridad correcta no validó el techo: el campo
tangencial daba diafragma en z−63..−90mm, aunque todos sus nodos son z≥−50mm.
La normalización local prolongaba planos pendientes fuera de su superficie.
La variante usa tres proyecciones locales a puntos del grafo bilineal común
y conserva el menor recorrido euclídeo obtenido, con signo de la altura.
Es una cota superior de la distancia al grafo, no un mínimo global garantizado:
puede omitir un parche fino, pero no inventa proximidad a un punto inexistente.
Se conserva el contacto/obstáculo hepático y el modelo legacy. La pendiente
bilineal sirve a la proyección; el eco diferencia la distancia efectiva como
antes. Los testigos profundos rechazados quedan protegidos. Capturas, cines,
contactos y rendimiento requieren nuevo contraste; no se da fidelidad por
demostrada al eliminar solo esos testigos.
Las pendientes exactas por celda produjeron una discontinuidad y un residual
de borde0,042mm: ensayo rechazado. Se usan las mismas diferencias centrales
continuas de0,5mm, con consultas explícitas a la tabla compartida.

**Refutación de coste.** 76e0cdd pasó check completo y paridad, pero la prueba
del navegador falló con el Worker del corte sin respuesta dentro de3s. Se
conserva ese fallo. La tabla libre260 guarda pendientes nodales derivadas de
las mismas alturas decodificadas: paso1,5mm, interpolación bilineal continua.
Guían la proyección; no definen normales fuente ni resolución adicional. La
consulta válida pasa de16lecturas de altura a cuatro muestras de altura/guía,
y evita repetir la fórmula de cúpulas heredadas. La altura, los once campos,
el soporte, la textura y su memoria no cambian; la distancia aproximada puede
variar por las propuestas de búsqueda y exige nuevas imágenes/paridad. No se
cambia el watchdog ni su presupuesto. Fuera del registro conserva fallback.
