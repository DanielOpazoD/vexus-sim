# Centinelas numéricos de una adquisición

El auditor legacy de porta en `35f745e` llegó a la captura correcta, pero rechazó
`compression.summary.neededMm = Infinity`. Es el valor documentado por
`ContactSummary`: ninguna indentación disponible consigue apoyar toda la cara.
No indica por sí mismo una adquisición corrupta. El manifiesto histórico conservó
un `null` y una fila marcada verificada antes de completar el sidecar; ese resultado
se conserva como fallo, sin reinterpretarlo como una captura válida.

`acquisitionJson` declara ahora `finite-numbers-or-acquisition-sentinels-v2`.
Conserva los números finitos y el radio de transductor `planar`. Solo dentro de
`compression` o `frame.anatomy.compression` codifica además:

- `radiusMm = Infinity`: `planar`.
- `summary.neededMm = Infinity`: `unreachable`.
- `summary.skinAlongMm[i] = NaN`: `no-skin-intersection`.
- `summary.wallAlongMm[i] = Infinity`: `no-wall-intersection`.

Son los centinelas que produce `probeContact`; no se sustituyen por medidas ni
se permite otro número no finito. Los lectores deben comprobar `numberEncoding`
y tratar las cadenas como estados, nunca como milímetros. No se migran capturas
antiguas. El auditor escribe primero el sidecar y agrega después al manifiesto
su contenido codificado, evitando filas aceptadas si falla la exportación.

Una regresión usa el contacto real de la pose portal legacy observada y falla
con el serializador anterior. Los controles negativos mantienen el rechazo de
NaN e infinitos fuera de esas ubicaciones y significados. Las capturas nuevas
en navegador, con SHA y dominio explícitos, deben acompañar la verificación.
Esto conserva procedencia; no certifica fidelidad ni aceptación clínica.
