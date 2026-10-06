# Unión cavoauricular con integración simultánea

Defecto: la presión resistiva común se evalúa con caudales del subpaso anterior, mientras cada rama se actualiza con su resistencia propia implícita. El intercambio entre ramas queda explícito y pierde estabilidad si aumenta la resistencia común.

Mecanismo: backward Euler simultáneo de las dos ramas, resolviendo el sistema 2×2 que incluye R_j·(Q_h+Q_i). Conserva todas las resistencias, inercias y presiones de contorno actuales.

Predicción: residual de ambas ecuaciones al nivel de redondeo, equilibrio estático correcto, disipación sin crecimiento numérico bajo resistencia común alta y convergencia al reducir el paso.

Invariantes: conservación de volumen mediante los mismos caudales de salida, reloj, geometría, áreas, Q/A, signo, dominio de controles y anclajes VExUS. No se recortan velocidades. El contraejemplo de cava 19,46 m/s persiste porque su área regional no se corrige aquí.

Refutación: solución asimétrica en ramas idénticas, residual no nulo, potencia resistiva negativa, sentido forzado, cambio de patrón basal o falta de convergencia. Aceptación: oráculos de simetría/estado estacionario/disipación, residuos calculados independientemente, casos y cadena de adquisición completos en CI. No representa validación hemodinámica humana.
