# Estado vigente: imagen

Actualizado: 2026-11-06 sobre main `bd2f575`. Cómo se forma hoy la imagen en la GPU, qué programas la componen y qué
techos los limitan. La explicación de cada pasada está en `docs/ARCHITECTURE.md`; las decisiones, en `docs/DECISIONS.md`.

## Pasadas por cuadro

La tabla `FRAME_PASSES` de `src/ultrasound/passGraph.ts` es la fuente: declara qué lee y escribe cada pasada, y
`passGraph.test.ts` la valida. Orden actual:

| Pasada  | Qué hace                                                                                       | Decisiones     |
| ------- | ---------------------------------------------------------------------------------------------- | -------------- |
| A0      | marcha de cada línea: primer impacto, espejo y cruce de la pleura                              | 54, 61         |
| A1      | segmentos de tejido de cada línea (camino de más en las luces)                                 | 54, 86         |
| A2      | prefijo de atenuación por línea, mirada 0 y dirigida, y Ψ̃ de la refracción                     | 54, 58, 86     |
| A       | transmisión con apertura (conos de emisión y recepción), refracción y especulares              | 54, 88, 91     |
| B       | campo complejo: clasificación, moteado anclado por tejido, ecos de interfaz, pleura y texturas | 55–57, 61, 62  |
| C, D    | PSF axial con el ruido del receptor y lateral con lóbulos y reverberación, por mirada          | 38, 76, 84, 89 |
| K       | composición de las miradas válidas                                                             | 58             |
| F, F1   | color: emulación del estimador de autocorrelación y su filtro                                  | 39, 70         |
| R       | reducción de moteado de la presentación                                                        | 313            |
| G, P, S | conversión de barrido con la TGC y los grises, persistencia y presentación                     | 10, 80         |

Fuera del grafo: el cine y la línea M guardan y devuelven cuadros sin lecturas GPU → CPU (decisión 80); el cine guarda la
envolvente en R16F y el color en RG32F (decisión 254). A0 y A1 se reutilizan mientras sus entradas no cambien
(decisión 256).

Con SwiftShader o un renderer no identificable, B se ejecuta en etapas (clasificación, elevación, gradiente y eco) para
que el JIT de la CI compile cada una; Metal conserva B directa y el oráculo compara las dos (decisión 240).

## Programas

`src/ultrasound/shaders/passes.glsl.ts` exporta los programas de la imagen (`FRAG_*` y `VERT_*`). La anatomía GLSL es una sola fuente
que incluyen todos los que clasifican; la persona s0028 especializa los programas antes de compilarlos (`personShader`,
decisiones 318, 320 y 321). El build quita comentarios, renombra y compacta el GLSL (`tools/build/glslMinify.ts`).

Los ocho programas con techo de coste, medidos en las dos personas (techos de tokens y ramas: decisiones 309 y 320;
samplers y ranuras de uniforms: decisión 317):

<!-- programas: generado por tools/docs/estado.ts -->

Medido sobre main `bd2f575` el 2026-11-06 con `tools/docs/estado.ts`.

| Programa                  | Samplers default / s0028 | Ranuras default / s0028 | Uso de tokens (peor persona) | Uso de ramas |
| ------------------------- | -----------------------: | ----------------------: | ---------------------------: | -----------: |
| `FRAG_RAWFIELD`           |                  10 / 10 |               136 / 136 |                         91 % |         91 % |
| `FRAG_RAWFIELD_ECHO`      |                  16 / 16 |               137 / 137 |                         91 % |         91 % |
| `FRAG_RAWFIELD_CLASS`     |                  10 / 10 |               136 / 136 |                         91 % |         91 % |
| `FRAG_RAWFIELD_ELEVATION` |                  15 / 15 |               137 / 137 |                         91 % |         92 % |
| `FRAG_RAWFIELD_GRADIENT`  |                  15 / 15 |               138 / 138 |                         91 % |         91 % |
| `FRAG_TRANS_HITS`         |                    6 / 6 |               101 / 101 |                         91 % |         92 % |
| `FRAG_TRANS_HITS_GRID`    |                  11 / 11 |               102 / 102 |                         91 % |         92 % |
| `FRAG_COLOR`              |                    7 / 7 |               110 / 110 |                         91 % |         92 % |

<!-- fin de programas -->

## Límites que importan al cambiar la imagen

- Tokens y ramas expandidos, no el texto: el JIT de SwiftShader de la CI muere por tamaño de programa mucho antes que
  Metal, y un bucle con cota constante se desenrolla entero (decisiones 309 y 320). Sin `for` ni `while` en el GLSL
  especializado por persona.
- `FRAG_RAWFIELD_ECHO` está en 16 de 16 samplers: un sampler más no compila en el equipo de referencia.
- Nada de lecturas GPU → CPU por cuadro (`CLAUDE.md`, invariante 7): solo PBO asíncrono o pruebas.
- Un cambio de GLSL se mide en SwiftShader x64 (como la CI) antes de publicarlo; los techos no se suben para pasar.

Valores exactos y márgenes de todos los techos: `docs/estado/presupuestos.md`.
