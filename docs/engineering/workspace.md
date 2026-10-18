# Entorno de trabajo y reproducción

## Raíz y runtime

Usar un único checkout principal. La ubicación física actual sigue en `work/vexus-sim` dentro de la
carpeta de esta sesión; no se mueve para conservar las referencias históricas. `README.md` en la
raíz de la sesión enlaza el código y las evidencias. Si existe un alias local, es solo un acceso:
la raíz Git y `tools/workspace/run.sh` determinan dónde se ejecuta cada comando.

```bash
/ruta/al/repo/tools/workspace/run.sh npm ci
/ruta/al/repo/tools/workspace/run.sh npm run workspace:doctor
/ruta/al/repo/tools/workspace/run.sh npm run dev
```

El wrapper puede invocarse desde otro directorio: entra en su checkout y usa la versión de `.nvmrc`.
Si hace falta, carga nvm instalado y selecciona Node 24 solo en ese proceso. No instala Node ni cambia
el perfil de la shell. Sin un runtime disponible falla con instrucciones. No copiar `node_modules`
entre equipos. `engines >=22` es permisivo; solo Node 24 está validado actualmente.

`workspace:doctor` comprueba Node, Git, hooks, dependencias directas contra el lockfile y el Chromium
instalado de Playwright. No abre el navegador, instala paquetes, inicia procesos ni consulta la red.
Un árbol con cambios se muestra para revisión; no es un error por sí solo. `origin/main` es una
referencia local: necesita `git fetch origin` para refrescarse.

## Tres usos distintos

Para el ciclo de edición usar primero `npm run feedback`. La evaluación de costes, selección de
pruebas y cierre compacto de CI están en [Iterar con evidencia y menos espera](iteration.md).
El feedback local no es un sustituto de la aceptación completa.

| Uso                       | Comando / evidencia                                         | Qué permite afirmar                                        |
| ------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| Diagnóstico focalizado    | Perfil local y filtros explícitos                           | Resultado del caso ejecutado en ese entorno                |
| Aceptación de una entrega | `npm run check`, CI protegida y comentario del PR           | Aprobación del SHA publicado con todos los grupos exigidos |
| Rendimiento nativo        | Comparación registrada, renderer real y condiciones iguales | Cambio de los observables medidos en ese equipo            |

Los scripts, umbrales y esperas originales siguen en sus módulos. Nunca alterar resolución, física,
plazos ni aserciones para obtener verde. Un reintento puede diagnosticar; no convierte un fallo en
aprobación. Una medición SwiftShader no representa el rendimiento de una GPU nativa.

## Perfil local de dos backends

Desde el repo, usando el wrapper si la shell tiene otro Node:

```bash
tools/workspace/run.sh npm run workspace:e2e -- --help
tools/workspace/run.sh npm run workspace:e2e -- --backend metal --out .cache/runs/metal-01 -- e2e/renalCutTracking.spec.ts
tools/workspace/run.sh npm run workspace:e2e -- --backend swiftshader --out .cache/runs/swift-01 -- e2e/renalCutTracking.spec.ts
```

Sin `--url`, construye este checkout e inicia una preview propia en 6609 con puerto estricto, sin
reutilizar servidores. Con `--url http://127.0.0.1:3078` usa una preview externa, sin construirla,
abrirla ni cerrarla. Registrar por separado el commit observado de ese build: el SHA del checkout
de pruebas no certifica un servidor externo. El `sourceSha` de las etapas de arranque identifica el
checkout de pruebas; `run.json` declara ese papel y cualquier cambio sin commit. No es procedencia
CI verificada.

El runner crea una carpeta nueva o falla si existe, incluso vacía. Conserva `run.json`, `report.json`,
trazas de fallos en `test-results/` y etapas de arranque en `startup.jsonl`. Registra el checkout,
cambios locales, backend, origen, argumentos, salida y estado. Una interrupción o `--list` no cuenta
como pruebas aprobadas. `CI=true` fija los plazos CI originales (BOOT_MS 180 s); un trabajador y cero
reintentos evitan competición local. No se modifica `playwright.config.ts` ni la CI protegida.
El perfil conserva los observables de las E2E originales; `--backend metal` por sí solo no demuestra
qué GPU se utilizó: comprobar el renderer real cuando se mida rendimiento.

## Protocolo de medición del corte

El manifiesto del cierre conserva el hash y ubicación del arnés original `measure-single-view.mjs`.
Es evidencia de cómo se midió esa entrega, no una segunda implementación del corte. Sus salidas
originales deben viajar con el paquete de evidencias si se reproducirá en otro computador.

Antes de comparar:

1. Identificar cada build por commit observado, cambios sin commit, navegador, viewport, renderer,
   versión de Node y protocolo. No sustituir el build de referencia por un `main` más nuevo.
2. Inventariar las páginas propias: LIVE, congeladas o cerradas. Congelar detiene la adquisición,
   pero no todos los bucles. Mantener las mismas condiciones entre antes y después y declararlas.
3. Ejecutar una carga intensiva local a la vez. Compilación, cobertura, hook y pruebas GPU van en
   secuencia; CI remota puede correr en paralelo. No tocar procesos ajenos para mejorar cifras.
4. Usar las mismas entradas continuas, seis coordenadas como muestras y ambos pacientes. Incluir
   posiciones intermedias, traslación y ángulos. No convertir esas muestras en límites del producto.
5. Separar antigüedad del corte mostrado, tiempo del Worker, separación geométrica y cadencia RAF.
   Etiquetar unidades, profundidad y recorrido. No llamar a todo «latencia de entrada».
6. Exigir convergencia final y revisar errores y procedencia de adquisición. Guardar también fallos,
   condiciones inválidas y ejecuciones interrumpidas con su clasificación.

## Disponibilidad y cierre

```bash
git status --short
git log -1 --oneline
lsof -nP -iTCP:3078 -sTCP:LISTEN
gh pr list --state open
gh pr checks NUMERO
```

Un HTTP 200 no certifica la revisión mostrada; comprobar también el identificador del build.
Revalidar PID, comando y checkout antes de detener un servidor propio. La pestaña puede conservar
una página aunque su servidor haya terminado. No reiniciar todas las previews históricas.

Guardar los logs de cada aceptación en una carpeta nueva y conservar el código de salida real.
No filtrar la salida de `check` para deducir el veredicto. Leer nombres y resultados de todos los
trabajos de CI, no el número parcial de checks verdes. El agregado protegido depende de core/build,
matrices y todos los grupos E2E; sus informes se comprueban con los verificadores existentes.

## Conservación de evidencias

El índice versionado en `docs/evidence/session-20261015/` contiene resultados pequeños, enlaces y
hashes seleccionados; los artefactos pesados siguen fuera del repo. La sesión conserva además un
inventario local en `work/EVIDENCE_INDEX.json`. No son secretos ni una copia de credenciales.

No eliminar negativos, originales ni comparaciones interrumpidas. Los builds congelados son
referencias históricas, no servidores que deban permanecer vivos. Archivar o retirar grandes grupos
requiere comprobar referencias y mantener una copia verificable. No hay borrado automático ni
política nueva de caducidad en esta limpieza. Los documentos futuros deben referenciar evidencia,
no pegar informes completos repetidamente en el chat.
