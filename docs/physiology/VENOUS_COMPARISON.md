# Visor venoso comparativo

## Etapa 1 implementada

`src/physiology/venousComparison.ts` define un observador puro del motor existente.
Proyecta una única secuencia de `PhysiologySample` a tres canales, en este orden:

1. `hvRight`: suprahepática derecha; positivo hacia AD
2. `pvTrunk`: porta; positivo hacia hígado
3. `interlobarVein1`: interlobar derecha; positivo hacia el hilio, no vena renal principal

Cada punto contiene **un solo timestamp**, ECG, índice de latido, fase cardíaca,
fase/volumen respiratorio y estado de respiración. Conserva PAD y PIA
**instantáneas**, no las etiqueta como medias o presiones transmurales.
Las velocidades son medias espaciales Q/A, convertidas de mm/s a cm/s.
Se conservan ceros, signos y amplitudes sin normalización ni clipping.

La salida se identifica obligatoriamente como `physiology-reference`.
No es IQ, espectro adquirido, pico de envolvente ni clasificación VExUS.
La orientación anatómica tampoco fija arriba/abajo en un display PW: depende
del haz y de la inversión de presentación.

El observador no llama a `step`, no modifica el caso, no consume aleatoriedad y
no construye otros motores. Copia los valores; no expone referencias mutables
al estado original. Rechaza valores no finitos y tiempos duplicados o inversos.
No interpola ni oculta huecos temporales. Un historial vacío es válido.

## Capacidad declarada y controles pendientes

El registro `VENOUS_CONTROL_CAPABILITIES` distingue:

- `preset-only`: PAD, PIA, función sistólica VD, IT y compliance AD existen como
  parámetros del motor, pero esta etapa no los expone como controles libres
  clínicamente calibrados
- `not-exposed`: compliance venosa sistémica; no equivale a la compliance hepática
- `not-modeled`: compliance diastólica VD y taponamiento; faltan mecanismos propios

No se añade ningún slider de taponamiento ni se lo imita elevando PAD. Los rangos
numéricos de `validatePatient` no son un dominio clínicamente validado. Las
etapas siguientes deben separar presión impuesta, equilibrio de circulación
cerrada, presión externa y mecánica de cámaras.

## Investigación que orienta la implementación

La revisión previa incluye estudios positivos, negativos y experimentales. Los
anclajes que deben contrastarse al extender el modelo incluyen:

- Onda auricular y fase de interrupción intrarrenal, no solo PAD media:
  [Seo 2020](https://doi.org/10.1253/circj.CJ-20-0332)
- Patrones renales con distribuciones de presión superpuestas:
  [Iida 2016](https://pubmed.ncbi.nlm.nih.gov/27179835/)
- Pulsación portal también en sanos y dependiente de contexto:
  [Gallix 1997](https://pubmed.ncbi.nlm.nih.gov/9207514/)
- Distinción de reversión hepática diastólica espiratoria en taponamiento:
  [Burstow 1989](https://pubmed.ncbi.nlm.nih.gov/2704254/)
- Interacciones de carga y función VD:
  [Balan 2025](https://doi.org/10.1186/s13613-025-01498-0)
- Evaluación multiparamétrica:
  [ASE 2025](https://www.asecho.org/guideline/right-heart-in-adults-pulmonary-hypertension/)

No convertir correlaciones o medias de grupos en reglas deterministas para cada
paciente. La evidencia insuficiente debe quedar visible en el producto.

## Auditoría reproducible

Ejecutar desde el repositorio:

```sh
node --import tsx tools/fidelity/venousModelAudit.ts /tmp/venous-model-audit.json
```

Genera 32 casos independientes: barridos de PAD, PIA, función VD, compliance AD,
IT, compliance hepática y cuatro interacciones. Ritmo regular, semilla fija y
apnea espiratoria; 16 s de integración, medición 6–16 s, paso 4 ms. El informe
incluye SHA, unidades implícitas en nombres, método y `clinicalValidation: false`.
No modifica archivos del repositorio por defecto ni guarda imágenes de pacientes.

El informe observa limitaciones: por ejemplo, elevar PAD aislada no obliga a
perder predominio S; elevar PIA no representa toda la compresión renal. Son
resultados del modelo, no nuevas leyes fisiológicas ni casos certificados.
No se agregan 32 adquisiciones PW o inicializaciones WebGL a la CI.

## Contratos y coste

Siete tests rápidos verifican reloj común, conversión exacta, copias, signos,
casos incluidos con FA, rechazo de datos inválidos y límites de capacidades.
En la etapa 1 no aumentaron escenarios E2E, timeouts, reintentos ni presupuesto.
El módulo todavía no se importaba desde la aplicación. La etapa 2 descrita abajo
lo conecta a una vista rotulada como referencia fisiológica; la vista PW necesita
su propia cadena de señal.

## Secuencia restante

1. Visor de tres filas sincronizadas con ECG, cursor, pausa y escalas explícitas
2. Controles acotados y transiciones con semántica clara
3. Mecánica auricular/ventricular y regurgitación independientes
4. Presión abdominal y propiedades locales
5. Pericardio e interacción respiratoria, antes del control de taponamiento
6. Validación independiente y espectros de alta fidelidad

La respiración permanece desactivada por defecto. Ningún paso habilita una
función inexistente por el solo hecho de añadir su botón.

## Etapa 2: primera vista docente

En Docente → Comparación venosa → Abrir comparación venosa aparecen las tres
velocidades medias sobre el mismo tiempo, además de ECG y respiración. Es una
**referencia fisiológica**, no un espectrograma adquirido. No se presenta como
resultado clínico validado.

- Últimos seis segundos; escala común ±20, ±60 o ±120 cm/s y aviso fuera de rango
- Signo anatómico explícito y valores numéricos sin normalización entre órganos
- Pausar vista conserva una copia; el cursor consulta todas las filas a la vez
- Esta pausa no cambia la congelación ni el tiempo del simulador
- ECG en mV; respiración como fracción inspirada del modelo, no volumen en litros
- PAD y PIA del cursor son instantáneas, no medias ni presiones transmurales
- Cierre/Escape devuelve el foco; cambio de paciente o modo alumno limpia los datos
- Diseño adaptable y controles de teclado; el modal contiene sus propios atajos

Aún no hay sliders fisiológicos libres, taponamiento ni compliance VD. Se deben
incorporar por mecanismos y validar según las etapas restantes. La respiración
conserva el estado del simulador y continúa desactivada al inicio normal.

Mientras el modal está abierto se omiten B, navegador 3D, corte y trazas de fondo
invisibles. El reloj fisiológico y la adquisición IQ continúan; no se modifica
`frozen`. Si M ya estaba activo, se mantienen su adquisición y cine para no
introducir una discontinuidad de columnas. Al cerrar se dibuja el estado actual.
La cabecera de controles permanece visible al desplazarse por la ventana.
