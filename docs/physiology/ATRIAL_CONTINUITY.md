# Continuidad del centrado de presión auricular

## Defecto reproducido

El modelo suma contribuciones gaussianas por latido y resta su integral dividida
por RR únicamente dentro del intervalo RR correspondiente. Al cambiar RR o
amplitudes, ese término constante cambia bruscamente en R. Las ondas mecánicas
son continuas, pero el centrado añade un escalón que no procede de ellas.

En los siete casos incluidos, comparando presión a R ± 0,1 microsegundos entre
2 y 20 s, se observaron saltos de hasta 0,343 mmHg. El nuevo test falla antes
de la corrección, incluso en el adulto normal (0,0172 mmHg en la primera R
comprobada). Es una discontinuidad numérica; no se atribuye una consecuencia
clínica cuantitativa a ese tamaño de salto.

## Corrección y conservación

Se mantiene cada onda y su integral. Solo se sustituye el indicador rectangular
RR del término de centrado por:

`w(t) = H(t − R) − H(t − R − RR)`

H es una transición cúbica C1 de cero a uno entre −20 y +20 ms. Equivale a
convolucionar el rectángulo con un núcleo simétrico, no negativo, de área uno:

- Integral de w igual a RR, independientemente de su duración
- Pesos adyacentes suman uno donde existe cobertura de latidos
- Si las medias son iguales, se conserva el mismo nivel de centrado
- Fuera de los 20 ms a cada lado del límite, el peso coincide con el anterior
- La media total se conserva por área; no se fuerza cada ciclo irregular aislado
  a tener exactamente la misma media

Los 40 ms son una regularización numérica declarada, no un tiempo valvular
validado ni una nueva propiedad de la aurícula. No se filtran las ondas a/c/v/x/y
ni la señal IQ, y no se cambian eventos mecánicos, amplitudes, compliance,
resistencias, reloj o aleatoriedad. Los parámetros por latido siguen congelados
durante intervenciones, como antes.

## Pruebas y límites

- Continuidad a ambos lados de R en los siete casos, incluida FA
- Área del peso para RR 0,3–2,5 s mediante integración independiente
- Partición de unidad con intervalos desiguales
- Continuidad del valor y de su primera derivada en los bordes
- Contratos existentes del lazo y de la media auricular, sin relajar umbrales
- Matrices PW completas y validación del motor antes de fusionar

La auditoría de 32 casos regulares mide cambios numéricos y categorías; no es
un banco clínico independiente. Informa commit, árbol de HEAD y modificaciones
locales para distinguir un experimento sin commit del código publicado.
El modelo sigue teniendo amplitudes extrapoladas y necesita calibración clínica.

La primera investigación detectó que el contraejemplo de captura hepática con
PPV cambiaba de semilla al modificar esta presión. No se ocultó cambiando la
semilla del test: antes se implementó la protección por pérdida geométrica de
sangre de la decisión 121. Esta continuidad debe validarse junto con esa protección.
