# Anatomía abdominal completa y registro retroperitoneal

Contrato previo, 2026-10-06. Petición expresa de Daniel: corregir la ubicación de los riñones y agregar páncreas, intestino delgado y grueso completos, vejiga, grandes vasos y ramas principales, bazo, duodeno y estómago al campo ecográfico real.

## Defecto y dominio

El registro de referencia retrasa la columna 14,02345 mm sin aplicar esa traslación a riñones/psoas. El modelo solo representa una porción yeyunoileal; no hay geometría propia de bazo, páncreas, estómago, colon ni vejiga. No llamar anatomía completa a un grupo de mallas decorativas. Adulto sintético, perfiles procedural y BodyParts3D, normal y congestión, mundo LAS en mm.

## Predicciones y aceptación

- Riñones a ambos lados de la columna, detrás del peritoneo posterior, derecho más caudal, polos superiores mediales/posteriores. Tamaño conservado, hilios anteromediales, arteria derecha posterior a cava, vena izquierda anterior a aorta. No contacto con pared anterior ni invasión de columna/psoas. Muestrear campos individuales antes de prioridad de tejido; la precedencia no demuestra separación.
- Bazo superolateral al riñón izquierdo, bajo hemidiafragma izquierdo; estómago anterior al páncreas; páncreas anterior a aorta/cava y junto a confluencia portal, cabeza en la curva duodenal y cola hacia hilio esplénico. Mantener impresiones renales y vesiculares hepáticas.
- Cadena digestiva continua de píloro a duodeno, yeyuno/íleon, ciego, colon ascendente, flexura hepática, transverso, flexura esplénica, descendente, sigmoides y recto. Declarar longitud representada y cualquier truncación. Cinco estratos sonográficos donde resolución/transductor permiten distinguirlos; luz, pared, pliegues y gas se evalúan físicamente. No dibujar intestino dentro del retroperitoneo para llenar la pantalla.
- Vejiga pélvica medial anterior, luz líquida anecoica y pared fina. Extender dominio corporal/navegación cuando sea necesario, sin comprimir pelvis en abdomen superior.
- Aorta abdominal posterior y a la izquierda de cava, celíaco/AMS/AMI, renales y bifurcación ilíaca; cava con afluentes hepáticos/renales e ilíacos y ramas principales pertinentes. Nuevas ramas con dirección y área coherentes. Los caudales que no forman parte de la red VExUS se identificarán como estimados; no prometer conservación mediante duplicar caudal en cada rama.
- Mismas primitivas, coordenadas y parámetros en CPU, GLSL y 3D. Órganos afectan atenuación, interfaces y sombra; no máscaras de aspecto ni color pintado. Descartes conservadores y datos acotados para no hacer inviable cada cuadro.

## Refutación

Invertir ejes, desplazar solo mallas, ocultar penetraciones por prioridad, normalizar cada órgano al torso por separado, colorear estructuras sin flujo o corregir presets conservando posiciones irreales invalida el cambio. Guardar antes/después, experimentos rechazados, mínimos con signo y límites no certificados; no sustituir pruebas fallidas por reintentos.

## Oráculos y límites

La anatomía de [OpenStax, riñón](https://openstax.org/books/anatomy-and-physiology-2e/pages/25-3-gross-anatomy-of-the-kidney), el registro común del atlas BodyParts3D (DBCLS, CC BY 4.0), y la [biblioteca original de ecografías AIUM](https://aium.s3.amazonaws.com/guidelines/abdomen/imageResources.pdf) son referencias independientes. Evaluar riñón/hígado, riñón/bazo, cabeza-cuerpo-cola pancreáticos, vejiga, aorta/cava en planos longitudinal y transversal. Una instancia de atlas no acredita variación poblacional ni calidad clínica. Geometría, curvas y propiedades estimadas se declaran explícitamente. La integración no equivale a validación clínica humana ni a nota 7/7.
