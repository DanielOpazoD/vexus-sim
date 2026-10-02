# Borde del diafragma y pared corporal compartida

La malla 3D existente usaba `(a − wall − 1) cos(phi), (b − wall − 1) sin(phi)` aun cuando el cuerpo de referencia cambiaba el perfil radial y su centro Y. Su altura ya era `diaphragmHeight`, pero el dominio XY podía atravesar la pared interna.

`diaphragmRim` busca por bisección la raíz de `torsoDepth([x,y,diaphragmHeight(x,y)], torso) + wallMm`. Los radios parten de `(0, torso.y0 ?? 0)` y terminan en esa pared. La malla conserva 20 divisiones radiales y 48 angulares, índices, winding, altura, material y transformación LAS del navegador. Las funciones acústicas TS/GLSL y los órganos conservan sus parámetros. No se añade otro diafragma.

Comparación reproducida con el adulto normal y 96 ángulos, en mm materiales; error = valor absoluto de la profundidad respecto a la pared interna, no distancia anatómica a una fuente:

| Campo      | Error máximo previo (mm) | Error máximo nuevo (mm) | Puntos previos fuera de pared interna |
| ---------- | -----------------------: | ----------------------: | ------------------------------------: |
| Legacy     |                 3,543554 |             0,000000019 |                                  0/96 |
| Referencia |                83,131877 |             0,000000270 |                                 21/96 |

`diaphragmRim.test.ts` verifica tres casos, ambos campos, 96 ángulos y puntos interiores: residuo de pared <0,0001 mm, mismo campo diafragmático y winding abdominal conservado. El muestreo anterior incumple el límite de profundidad. La precisión numérica del borde no implica esa precisión anatómica: la superficie sigue siendo las dos cúpulas estimadas existentes. La discretización de triángulos sigue aproximando el campo continuo.

Permanecen pendientes tendón central, pilares, hiatos, inserciones fuente y contactos con los órganos durante la respiración. Faltan 23 piezas fuente según `thoracic-source-requirements.json`; el proxy rechaza CONNECT a `dbarchive.biosciencedbc.jp:443` con 403. Esta corrección no resuelve solapamientos costales/hepáticos ni valida anatomía clínica o rendimiento Metal.
