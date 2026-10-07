# Contrato de corrección costal

Defecto: las elipses mixtas terminan junto a una columna de niveles uniformes; no representan las cabezas, cuellos ni los niveles de las 24 costillas del abdomen registrado. La primera costilla resulta demasiado ancha.

Mecanismo: derivar un campo esquelético del mismo BodyParts3D 4.0 y registro LAS en mm que las vísceras, sin mover, escalar ni reflejar individualmente costillas. Sustituir las elipses y los cuerpos torácicos genéricos en el adulto registrado. La ecografía, el plano anatómico y la superficie 3D comparten el mismo campo. Conservar la alternativa procedural explícita.

Predicción: 12 pares, primera costilla corta, arcos y separación variables según nivel, cabezas posteriores junto a su vértebra, 11–12 con extremos libres. La sombra depende de cruzar hueso real, no de una máscara de ventana.

Invariantes: origen de vísceras, dimensiones del paciente, identificación bilateral y geometría estática del esqueleto. Los órganos se desplazan por respiración; las costillas se mantienen estáticas por ahora. No reubicar hígado/riñones para ocultar errores costales.

Refutación: muestrear superficies originales independientes de los vóxeles, comparar distancias, bounds, volumen y componentes por cada costilla; rechazar pérdidas de costillas, puentes entre huesos o errores superficiales superiores al paso espacial declarado. Verificar vistas posterior, lateral y anterior, y barridos de ventanas intercostales.

Aceptación y límites: atlas de un adulto, no validación poblacional; discretización de 1.5 mm prevista, con error medido. La relación renal/costal debe conservar su registro retroperitoneal y la hepática/subdiafragmática debe seguir visible en la ventana apropiada. No presentar las articulaciones como huesos fusionados ni afirmar validación clínica por CI. Medir memoria, carga y renderizado.
