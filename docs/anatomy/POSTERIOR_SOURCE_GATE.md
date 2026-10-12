# Fuentes musculares posteriores: puerta de validación

Sirve a los objetivos anatómico, ecográfico y de honestidad de MISION. Es una herramienta offline y una derivación explícita de fuente; no añade musculatura al simulador ni cambia imágenes o fisiología.

## Problema y contrato

No basta una malla cerrada. Fuentes BP3D de longísimo contienen 93 pares de autointersecciones por lado, aunque sus aristas estén cerradas. Las superficies de psoas e iliocostales contienen pequeñas láminas de dos triángulos opuestos coincidentes, de volumen geométrico exactamente cero. Esas láminas impiden mapear caras CGAL de forma biyectiva.

El manifiesto fija bytes SHA, nombres de la tabla oficial y lista explícita de caras fuente excluidas. `posterior_source.py` solo admite excluir componentes completos de dos triángulos exactamente coincidentes y opuestos. Suelda únicamente coordenadas idénticas, conserva caras, orden y orientación restantes. No mueve vértices, tapa huecos, elimina componentes pequeños por umbral ni interpreta componentes negativos como basura.

CGAL 6.0.1 comprueba cruces en toda la superficie y guarda los dos triángulos LAS y los índices originales de cada testigo. `validForContactInvestigation` permite investigar contactos; no aprueba incorporación al runtime ni anatomía normal.

## Resultado reproducido

Tras la derivación explícita: psoas bilateral y cuatro iliocostales tienen 0 pares CGAL; los longísimos conservan 93 por lado y se rechazan para incorporación. Componentes, nesting y contactos necesitan interpretación separada. Una exploración local de 22 flips bajó un longísimo a 20 pares; quedó rechazada y fuera de este PR.

En la candidata anatómica local f7c0e06, el muestreo de interiores fuente cada 1,5 mm encuentra conflicto de la fuente psoas original con campo renal (10,935 ml derecho / 4,694625 ml izquierdo muestreados). Un control distinto exige que sean negativos tanto el campo psoas **ya reconciliado** como el renal u óseo actual: 0 coincidencias en los mismos 148.916 puntos. No se presenta el solapamiento original como una regresión del modelo reconciliado; cero muestras tampoco demuestra no intersección continua.

Los mismos puntos muestran regiones iliocostales clasificadas como grasa o pulmón por el modelo local, incluso sin cortina. Eso identifica una dependencia de compartimentos/torax, no autoriza reemplazar toda grasa o cambiar prioridad por ventana. Este modelo anatómico depende de PR 219/222; main conserva su propia geometría. No se mezclan sus evidencias.

## Reproducción offline

Entorno aislado: Python 3.12, numpy, scipy, cgal 6.0.1.post202410241521. Utiliza superficies y tabla oficiales indicadas en el manifiesto; hashes fijados. Partof completo verificado; ISA adquirido por miembros ZIP con CRC y SHA, checksum global no verificado. ©DBCLS, CC BY 4.0. No descarga desde esta herramienta.

```sh
python -m unittest discover -s tools/anatomy -p posterior_source_test.py
python tools/anatomy/posterior_source.py \
  --manifest docs/anatomy/posterior-muscle-source-manifest.json \
  --source-dir /ruta/fuentes \
  --labels /ruta/isa_element_parts.txt \
  --output /ruta/nueva-auditoria
```

El directorio de salida debe ser nuevo. Las NPZ son superficies diagnósticas con índices fuente, no atlas aceptados. El informe completo incluye mallas inválidas con `validForContactInvestigation=false`; revisar ese campo antes de construir campos.

## Refutación y siguiente paso

Las pruebas adversariales rechazan selección parcial, componente sólido pequeño, orientación coincidente, índices repetidos y soldadura por tolerancia; conservan cavidades negativas y vértices duplicados por seams.

Antes de incorporar una fuente: resolver cruces, nesting, contactos con hueso/órgano, campo pulmonar/diafragma y separación renal grasa/fascia. Reparaciones conservadoras requieren certificados de desviación bidireccional, volumen y topología. No inventar precisión clínica a partir del paso 1,5 mm. Después: cortes registrados, adquisiciones comparables, poses vecinas, barridos y revisión externa. ASRA describe grasa perirrenal y fascias entre polo renal inferior y QL; no calibra el espesor individual de este atlas.

Referencia: https://asra.com/news-publications/asra-updates/blog-landing/legacy-b-blog-posts/2022/02/06/ultrasound-guided-quadratus-lumborum-block-how-do-i-do-it- . Revisión humana externa pendiente.
