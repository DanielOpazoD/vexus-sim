# Normales de interfaces durante la respiración

## Defecto y alcance

El mapa de posición respiratoria ya deformaba las vísceras, pero el eco de interfaz
transformaba sus gradientes únicamente por la compresión de la sonda. En las
transiciones de peso espacial, una cara cambiaba de orientación sin que su
incidencia especular siguiera ese cambio. Una traslación uniforme no presenta este
problema.

Este cambio transporta el gradiente completo (dirección **y magnitud**) en las dos
rutas de campo B-mode, central y compuesta. Las facetas ancladas usan la misma
transformación. La cota de salida temprana incluye el factor respiratorio para no
eliminar ecos antes de evaluar su normal. OFF conserva la identidad respiratoria.

No cambia la forma, posición o excursión de los órganos, ni activa la respiración
por defecto. No es una reconstrucción anatómica ni una validación clínica.

## Contrato matemático

Para el campo existente `F(m) = m + D w(m) d`, con `d` unitario, la jacobiana es
`J = I + D d ⊗ ∇w`. Cuando `det = 1 + D d·∇w` no es cero, el gradiente material se
transporta mediante:

`n' = J^(-T) n = n − [D ∇w / det] (d·n)`

Después se aplica la jacobiana inversa de la compresión de sonda. El orden importa:
la inversa de posiciones deshace compresión y luego respiración; los covectores
recorren las transpuestas en el orden contrario. No se normaliza entre etapas.

La norma del operador respiratorio se acota por `1 + |D ∇w / det|`. Multiplicarla
por la cota existente de compresión conserva una salida temprana conservadora.
El gradiente de `w` se obtiene por regla del producto en las transiciones de pared
(smoothstep de 25 mm) y columna (smoothstep de 30 mm), con la derivada real del
perfil corporal. No se reemplaza por la normal elíptica aproximada.

La fórmula es local: no demuestra inyectividad global. Las uniones del perfil
corporal interpolado son solo continuas por tramos; en ellas no existe una normal
única. No se introduce una saturación silenciosa del determinante para simular
que un mapa singular es físicamente válido. La batería cubre los dos perfiles y
las excursiones usadas por el programa (0, 10 y 30 mm).

## Verificación

- Diferencias centrales independientes del peso en una rejilla desplazada respecto
  de las uniones del atlas
- Derivada numérica del campo escalar completo `n·toMaterial(p)` para cuatro
  covectores, ambos perfiles y las tres excursiones, con y sin compresión
- Puntos dentro del contacto real, con comprobación explícita de que coinciden
  compresión y gradiente respiratorio no nulos
- Cota de norma para cada covector y conservación exacta de OFF/traslación rígida
- Mutación que omite la transformación respiratoria: las dos pruebas de
  composición fallan; las tolerancias no se amplían para aceptar la mutación
- Paridad CPU/WebGL2 de gradientes y cotas en el mismo arnés que verifica la
  inversa; conserva todas las consultas y los límites de la inversa anteriores
- Capturas antes/después de las ventanas portal y subcostal en apnea inspiratoria
  de 30 mm, más las capturas predeterminadas con respiración desactivada

Los resultados GPU, visuales y de CI deben comprobarse para el SHA publicado
antes de considerar el cambio integrable. Una prueba de paridad no sustituye una
revisión anatómica o clínica por ecografistas.

## Límites que siguen abiertos

La curvatura de los vasos mantiene la aproximación local previa; este cambio no
reconstruye una segunda forma fundamental deformada ni transforma integralmente
las bases de flujo Doppler. Las muestras laterales de elevación siguen usando la
jacobiana central del haz como antes. Tampoco resuelve las relaciones pendientes
entre el atlas torácico completo y los órganos procedurales.
