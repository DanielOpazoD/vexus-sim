# Observabilidad de arranque del atlas34

Fuente capturada33a6685, anterior362b09d. La corrección recupera de main/PR234
el registrador antes de hooks y el adjunto conservado por el host; añade dos
etapas alrededor de la carga de superficies atlas. No modifica anatomía,
shaders, física, resolución, relojes, plazos ni presupuestos.

`registered-observer-controls.json` registra18 adquisiciones antes/después
(nueve ventanas normales) y seis portales A/B/basal/z+2mm/tilt+1° comparadas
con seis referencias retenidas. B-mode y campo Doppler serializado coinciden;
pose, equipo, estado, reloj, receptor y dimensiones coinciden. Los dos protocolos
corregidos pasan sin reintentos. El arranque nativo Metal pasa a23,058s.
Las galerías muestran las adquisiciones; igualdad de señal controla regresión,
no certifica fidelidad clínica, reconocimiento anatómico ni continuidad global.

Tres variantes de coste se retiraron por no completar arranque SwiftShader.
`experiment-results.json` conserva fuente, plazo, resultado y última etapa.
Los shaders y guardas finales son idénticos al observador4c2892c, comprobado
en `restored-source-proof.json`. Los resultados sintéticos favorables nativos
no sustituyen el fallo de arranque ni la discrepancia analítica SwiftShader.

Los errores de protocolo previos también se conservan: diferente viewport,
y fase prescrita256 superada durante espera de acciones UI. Se corrige con
igual viewport y congelación por el botón real tras hooks/dos cuadros; no se
reinicia la fase ni se amplían tolerancias. La carga205,92 del Mac se observó,
pero no demuestra por sí sola causa de todos los fallos. Ver QA y JSON de rechazo.

Primera CI7f: agregado38162470866 y validación venosa38162470868 rojos;
las tres adquisiciones venosas fallan antes de hooks/dos cuadros. No hubo rerun.
La CI del HEAD nuevo debe evaluarse por su SHA exacto antes de integrar.
PR236 sigue en borrador; nunca fusionar contra la base temporal34. Faltan
reconciliación con main, arranque SwiftShader y revisión clínica externa.
Localhost3024 preserva32f1c6b; ninguna variante fallida lo sustituye.

Fuentes primarias técnicas: [Chromium SwiftShader](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/swiftshader.md)
y [Google SwiftShader](https://github.com/google/swiftshader/blob/master/docs/Index.md).
Explican el backend, no identifican la causa específica de este bloqueo.
