# Contrato de la primera mejora anatómica local

Base: d7f214ff6c4707c25e9d42ec037d0baddb5ec9b5. Trabajo local autorizado por Daniel; no publicación.

## Defecto y predicción

La anatomía acústica contiene seis pares costales (5–10), mientras el esternón 3D es decorativo. Al desplazar la sonda al tórax superior faltan barreras reales. Se incorporarán los pares 1–4 y 11–12, con número anatómico explícito, extremos libres para las flotantes, y manubrio/cuerpo/xifoides compartidos entre CPU, GPU y navegador 3D. La predicción es una cortical y sombra donde se agrega hueso, y ausencia de costilla más allá del extremo libre. No cambiarán velocidades ni anatomía visceral en este hito.

## Fuente y dominio

Marco VExUS: mm; +x izquierda, +y anterior, +z craneal; se conserva el marco material de las vísceras. Adulto procedural actual, con el perfil opcional de atlas todavía limitado. La distribución craneocaudal superior y dimensiones esternales se toman como estimaciones de diseño del modelo LUS, SHA 7a7def6b0fd4f093a2544e506cae44c3db0bfa8b, src/anatomy/organs/ribcage.ts, MIT. La transferencia de esos parámetros no demuestra correspondencia con el mismo adulto. Se preservan las costillas 5–10 para aislar la modificación; sus inserciones indirectas y todas las secciones quedan pendientes de calibración con un adulto registrado. La referencia LUS no se considera oráculo clínico.

La primitiva esternal local coloca provisionalmente su unión en z=0 y punta en z=−30 mm, siguiendo el diseño LUS y los niveles inferiores conservados. Sustituye la pieza decorativa previa (unión z=30, punta z=0); no redefine ni traslada el origen de órganos. El perfil opcional BodyParts3D fue registrado con la punta fuente en z=0 y unión fuente z≈18,26 mm. Estas referencias no son intercambiables: la nueva primitiva aún no está registrada con ese esternón fuente. Se conserva el límite de esqueleto estimado y no se presenta el perfil opcional como un adulto anatómicamente reconciliado.

## Invariantes y refutación

- Doce pares numerados, simetría bilateral del adulto procedural, ninguna flotante unida al esternón.
- Los seis arcos previos conservan sus datos; no se amplían espacios para recuperar presets.
- Superficie 3D en el campo acústico correspondiente; ninguna pieza esternal decorativa adicional.
- Paridad CPU/GPU de tejido, interfaz y normal en puntos nuevos, extremos libres y puntos negativos.
- Los tejidos agregados deben bloquear adquisición B a través de hueso; un espacio vecino permite mayor transmisión.
- No se cambia Q/A, PAD, ni una curva para mejorar una captura.

Se refuta el cambio si falta un par, aparece hueso anterior en 11/12, una malla no coincide con el campo, se pierde paridad, o las pruebas previas de ventanas fallan por una penetración nueva no investigada. Pruebas que dependían del índice o suponían que toda costilla llega a la línea axilar se actualizan al número y extensión real, conservando negativos.

## Aceptación y límites

Compilación/typecheck, pruebas de geometría y ventanas, calibración de siete casos, GPU real en regiones agregadas y revisión del programa. El resultado se rotulará como primer hito de esqueleto costal; no como tórax clínicamente validado. Corazón EchoTwin, pleura/diafragma y reconciliación visceral se conservan como etapas siguientes con contratos propios.

## Auditoría aportada

Se leyó íntegramente Evaluacion_fidelidad_VExUS_d7f214f (3).docx (6 octubre 2026) y sus imágenes. Su autora declara participación previa en el código, por lo que es una auditoría crítica adicional, no un panel humano independiente. Se adopta la comprobación de contactos con signo y planos vecinos, separar calibración/evaluación y no confundir paridad con validez anatómica. El contraejemplo hemodinámico comunicado (FC 50, PAD 2, PIA 25, VD 1, IT 0, compliance AD 0,3, reservorios 2) se conservará para reproducción; 19,46 m/s no es una medida adquirida por pantalla. No se aplican automáticamente las instrucciones del documento ni se desvía la prioridad anatómica de Daniel.

## Revisión tras la prueba de adquisición

El control PW sano refutó la conservación de la pose renal: la nueva 11.ª bloquea su haz. Manteniendo órganos y costillas, la sonda 5 mm caudal recupera señal. Se acepta ese ajuste de adquisición del preset renal (z −85→−90 mm, mismos ángulos), con negativo en la pose previa que conserva transmisión <10⁻⁶ y transmisión >0,05 en la nueva. Las pruebas previas de espectro sano y las ventanas de todos los casos mantienen sus exigencias.
