# Corte continuo al mover la sonda y cambiar de caso

El trabajador clasificaba toda la rejilla en una sola tarea. Un cálculo lento podía superar los 3 s del vigilante aun estando sano; la terminación descartaba el trabajo y volvía a cargar los atlas. Cada cambio de caso copiaba también 112.228.544 bytes en el modo atlas.

El trabajador ahora conserva esos datos inmutables y reconstruye solo la escena del paciente. Clasifica filas con el mismo algoritmo, resolución y muestra adquirida. Tras unos 16 ms de cálculo comunica las filas completadas y cede el hilo; un cambio de escena puede cancelar el corte anterior. No publica mapas parciales. El vigilante sigue detectando 3 s activos sin avance, con el límite por cuadro anterior. Las respuestas se comprueban por trabajador y petición, incluidos los errores, y un reinicio del mismo caso invalida su escena anterior.

La vista abandona la petición anterior antes de consultar su vigilante. Conserva una sola petición en vuelo; al terminar toma la adquisición más reciente, sin acumular movimientos en una cola. El mapa y su procedencia usan la misma instantánea adquirida, también en congelación y cine.

Los deslizadores y el botón de reinicio de sonda pasan por la misma entrada manual que los gestos: cancelan la transición automática hacia una ventana. Antes la animación podía sobrescribir el ajuste manual en el cuadro siguiente.

## Verificación local

- Regresión con dos vistas vivas, alternancia normal/congestión severa y rotación, inclinación y basculación.
- Carga controlada: una petición usa una rejilla 16 veces mayor por eje, con el clasificador real. La referencia f40c890 cancela el trabajo por timeout; el candidato lo completa con progreso. Es una prueba de resistencia, no una medición de latencia de la rejilla normal.
- Cambio de paciente durante otro cálculo pesado: se abandona el mapa anterior y se recibe el nuevo, sin otra copia de los atlas.
- Regresión de los cuatro deslizadores durante la animación: falla en f40c890 porque la pose manual cambia sola.
- Vigilante de un trabajador sin avance, errores obsoletos, reinicio del mismo caso y fallo de inicialización; paridad del clasificador, volumen renal/grasa/fascia CPU–GPU, redimensionado y procedencia del cine.

No cambia la geometría, los materiales, los campos anatómicos ni el algoritmo de formación de la ecografía. Las pruebas locales con Metal no sustituyen CI con SwiftShader ni validación clínica.
