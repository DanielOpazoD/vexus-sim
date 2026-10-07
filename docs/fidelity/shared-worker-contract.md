# Compartir módulos de anatomía entre aplicación y trabajador

**Defecto.** En `89e0152` el trabajador del plano lleva 83,2 KiB de JavaScript en
un bundle independiente que duplica anatomía usada por la aplicación. El total
es 1094,8 KiB frente al límite vigente de 1078 KiB. Impide integrar el candidato.

El PR se aísla sobre main `8189d36`, sin incluir el atlas pendiente: baseline
1032,4 KiB frente a 1033 KiB; candidata 969,0 KiB. En el candidato completo,
la misma corrección mide 1013,8 KiB frente a 1078 KiB. Ambos builds cuentan
todos los chunks y trabajadores. Las cifras no prueban una mejora de FPS.

**Mecanismo.** Emitir el trabajador como entrada ES del mismo grafo de build.
Rolldown puede compartir sus módulos CPU con la aplicación; el trabajador sigue
ejecutándose en otro entorno, con estado y reloj de petición propios. No cambia
geometría, clasificación, señal ni la transferencia de campos entre entornos.

**Predicción.** La descarga total de JavaScript baja por debajo del límite
vigente, sin excluir activos del cómputo ni alterar shaders. El plano sigue
respondiendo a adquisiciones, cambios de caso y presión.

**Invariantes.** Anatomía y mapas idénticos; singleton independiente en cada
entorno; misma gestión de errores y watchdog; rutas válidas en desarrollo y
producción. No se supone una reducción de latencia por reducir transferencia.

**Refutación.** Dependencias DOM en el trabajador, errores de importación,
compartición accidental de estado, mapa desfasado o presupuesto aún excedido.

**Aceptación.** Build y presupuestos originales; comprobación real del trabajador
en navegador; equivalencia CPU/GPU y mapas; casos y movimiento relevantes; CI
del SHA exacto. El bloqueo SwiftShader se investiga por separado: eliminar
duplicación no demuestra resolverlo ni certificar fidelidad clínica.

Referencia: [Vite 8, referencias a archivos emitidos](https://vite.dev/guide/api-plugin#referencing-emitted-assets).
