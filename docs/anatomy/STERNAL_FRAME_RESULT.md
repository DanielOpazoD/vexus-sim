# Resultado del registro craneocaudal esternal

Estado: corrección implementada y comprobada localmente. Base d7f214ff6c4707c25e9d42ec037d0baddb5ec9b5, rama feat/anatomia-ecografica-local, cambios sin commit, localhost:3008.

Punta xifoidea z=0; unión z=18,2615 mm. Es la referencia del adulto registrado ya documentada en REFERENCE_TORSO.md. CPU, GLSL y mallas usan un único parámetro. Anchuras, espesor, profundidad y forma superior conservan aproximaciones; esta corrección no registra todo el adulto ni traslada vísceras.

Se añadió diagnóstico de contactos con signo independiente de la prioridad de tejidos. Superficies costales muestreadas: 20.564 puntos procedurales y 20.498 de referencia; residual propio máximo <10⁻¹² mm. Superficie lateral esternal actual: 1.476/1.395 puntos, residual máximo <0,004 mm. Son muestras de campos aproximados, no precisión clínica ni mínimos euclídeos globales.

| Superficies costales frente a campo | Procedural: mínimo (mm) | Referencia: mínimo (mm) |
| ----------------------------------- | ----------------------: | ----------------------: |
| Hígado antes de pared/diafragma     |                 −37,792 |                 −44,497 |
| Hígado después de pared/diafragma   |                  +1,001 |                 −19,634 |
| Riñón derecho                       |                  +6,948 |                 +16,784 |
| Riñón izquierdo                     |                  +4,890 |                 +14,921 |
| Epicardio antes de diafragma        |                 +21,587 |                  +9,167 |

El perfil opcional conserva 561 testigos costales dentro del hígado efectivo, tanto antes como después del cambio. Ese número no es fracción de volumen o superficie. Hay que reconciliar pared, parrilla y vísceras antes de promover el atlas a anatomía predeterminada. El campo hepático bruto por sí solo exageraría el problema procedural: su recorte por pared/diafragma elimina los testigos encontrados allí. Una ausencia de muestras negativas no prueba ausencia global de intersección.

Evidencias fuera del repositorio, en `evaluacion-vexus/registro-esternal/`: `contacts-before.json`, `contacts-after-formatted.json`, script de recuperación, capturas y logs. `source-snapshot.json` identifica 476 archivos, digest SHA256 `f89990138963181fb9e1c18732238904900709e8053ec872d828305df1b8c7c6`. La descarga del atlas dio timeout en HTTPS y HTTP desde el Mac; no se recuperaron piezas ni se ajustó una malla nueva. La fuente oficial se pudo consultar mediante navegación. Se conserva un primer informe como `contacts-before.invalid-world-kidney.json`: sus consultas renales usaban el marco equivocado, se descartaron y se protegieron con una prueba de centros y riñón contralateral. El informe válido incluye la conversión mundo→marco renal.

Comprobaciones actuales:

- Suite rápida completa: 144 archivos, 1150/1150 pruebas aprobadas, salida 0; 116,38 s con tres workers. Incluye los controles de geometría, contacto, mallas y ventanas.
- Comprobación focal inicial: 49/49 en cinco archivos; banco relacionado adicional: 94/94 en diez archivos. Son conjuntos con intersección; no se suman como pruebas distintas.
- Navegador Chromium/ANGLE Metal: 8/8 E2E, salida 0, 2,2 min. Paridad volumétrica e interfaces en ambos cuerpos, cortical izquierda, tríadas portales, negativos del xifoides antiguo, ambos materiales en la unión y renal pareada en sano/congestión grave, además del visor PW.
- Formato, lint y TypeScript: salida 0. Compilación Vite y presupuesto aprobados: JS total 1027,2 KiB ≤1028, manteniendo límites por chunk. Calibración completa de los siete casos: salida 0; fisiología sin modificaciones.

Las matrices lentas y la cobertura completa de la decisión 166 pertenecen al hito anterior y no se volvieron a ejecutar en esta corrección. No se atribuyen automáticamente a la nueva geometría ni se presenta este control local como CI del repositorio o validación clínica.

El corazón EchoTwin, el borde pulmonar LUS, las articulaciones y el registro tridimensional del adulto siguen pendientes. El caso hemodinámico de 19,46 m/s permanece sin reparar.

BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International. [Descripción oficial](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html), [licencia](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html).
