# Retorno del moteado: contrato pendiente

Diagnóstico del 28 de octubre sobre `f60e21c4958acd449a9d7daec0b17c63dc2dc1ee`,
decisión 290. El medio estático debería producir el mismo campo complejo en
los mismos puntos materiales al regresar a la pose, con la misma semilla.
El reanclaje actual puede cambiar ese campo y su paridad. Este registro no
acredita una corrección de imagen ni una referencia acústica independiente.

## Reproducción rápida

```bash
tools/workspace/run.sh npx vitest run src/validation/speckleReturn.test.ts
```

La prueba recorre un círculo de yaw/tilt durante 4/3 segundos: yaw ±radio,
tilt entre cero y dos veces el radio. Usa el contacto efectivo de la ventana
intercostal, 30/60 actualizaciones por segundo y espera a que termine el
fundido. Comprueba que no hay teletransportes, que vuelve al mismo marco y
que los valores son finitos. Radio 2° conserva exactamente el campo. Radio
8° cambia el campo al regresar y sus dos cadencias tampoco coinciden.

Los tres contratos incumplidos están marcados `it.fails`: una suite verde
incluye esos fallos esperados, no significa que se haya corregido el medio.
Al retirar únicamente esas marcas, las tres aserciones fallan. Un futuro
modelo coherente debe retirar las marcas y la limitación conjuntamente,
conservar los controles de movimiento y medir calidad/coste en GPU completa.

## Comprobación GPU

Chromium con ANGLE Metal, Apple M4, envolvente 192 × 1024, fundamental,
una mirada, apnea espiratoria y persistencia cero. Misma trayectoria; control
quieto de igual duración. Máscara hepática entre 50 y 110 mm (incluye sombras
y ruido): correlación tras dividir cada muestra por su media local.

| Actualizaciones/s | Quieto | Radio 2° | Radio 8° |
| ----------------- | ------ | -------- | -------- |
| 30                | 0,936  | 0,929    | 0,266    |
| 60                | 0,940  | 0,935    | 0,265    |

La envolvente confirma el cambio al regresar; esta tabla no compara directamente
las dos cadencias entre sí, no mide compuesto/armónica ni aceptación humana.
El diagnóstico conserva el ruido del receptor. No se fija un umbral nuevo de
realismo a partir de estos números ni se interpreta su duración como benchmark.

Originales, script temporal, recibo de build, seis pares de envolventes y métricas:
`vexus-speckle-return-evidence-20261028/gpu-return-01`. La reproducción GPU terminó
con código 0; sus aserciones validan las condiciones del experimento, no la
estabilidad del moteado. Los experimentos CPU amplios de 15/30/60 Hz y sus
controles simétricos están en `closed-path-baseline-01/02` del mismo directorio.

Reiniciar la semilla al volver o memorizar una imagen escondería la dependencia
del camino. Una solución requiere un campo material coherente con filtrado
acústico y coste medido; no se introduce aquí una caché ni otro renderizador.
