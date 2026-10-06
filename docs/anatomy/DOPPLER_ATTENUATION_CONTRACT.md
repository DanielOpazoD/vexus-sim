# Atenuación Doppler con pérdidas fijas conservadas

Defecto medido en código antes de implementar: el color eleva toda la transmisión B a fD/fB y aplica un suelo 1e-6. Reduce también los 100 dB de entrada al hueso y los 60 dB/cm de gas, que PW conserva independientemente de frecuencia. Puede crear señal detrás de barreras que la adquisición PW rechaza.

Mecanismo: mantener por separado pérdida acumulada independiente de frecuencia (entrada ósea, gas y 0,5 dB del espejo); convertir solo absorción dependiente de frecuencia. Reutilizar A2.o1.w. Inspección posterior confirma que A.o2.y almacena el rayo dirigido y NO está libre; se preserva. El color lee prefijo dB y pérdida fija de las dos texturas A2 existentes, con un sampler adicional, sin textura/uniform geométrico nuevo. Es el rayo central existente: no cambiar la apertura B ni reclamar un error de apertura inexistente. No crear textura, rellenar vasos, quitar sombras ni cambiar gain/caudal.

Predicción: en tejido blando el resultado anterior permanece; en hueso/gas se conserva la barrera fija para fD/fB menor, igual o mayor que uno. El suelo de transmisión deja de limitar artificialmente la pérdida a 60 dB. El rayo B y señal B permanecen idénticos. Se interpolan los dos prefijos de pérdida en dB con los mismos pesos, y se convierten después; no se mezcla una amplitud interpolada con un prefijo fijo de otra fila. La absorción restante conserva el escalado lineal previo: exponentes tisulares b≠1 siguen siendo deuda declarada y se resolverán en una iteración posterior.

Refutación y aceptación: oráculos analíticos con capas soft/bone/gas y frecuencias diferentes, salida GPU real del prefijo y comparación con integración PW sin espejo; negativo de señal tras hueso/gas. Mantener espejo explícitamente distinto del camino PW y conservar todos los controles de paridad B/apertura existentes. Registrar cualquier diferencia residual por discretización sin relajar reglas anatómicas o clínicas.

La entrada ósea y absorción de gas siguen siendo aproximaciones declaradas por la decisión 88, no coeficientes clínicos nuevos. Crecimiento previsto <0,5 KiB, cabe en el margen 1031 KiB de la decisión 173; verificarlo al compilar.

El pre-push completo identificó dos expectativas antiguas de o1.w=0 y la dependencia F→A obsoleta. Se actualiza el grafo real a F→A2 y se registra el digest del prefijo extendido, sin cambiar los tres primeros componentes ni los hashes B/A. Las guardas de dependencias, de samplers y de refracción se conservan. Fallos originales retenidos en 08-final-push.log.
