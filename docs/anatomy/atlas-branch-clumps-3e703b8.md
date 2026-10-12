# Continuidad de dispersores — historia de la rama Atlas

Fuente: `3e703b8fe5bdaa766e703fba19a7d35322d9ec2e`, PR222. La decisión 187 conserva su identificador histórico.
El mecanismo CPU/GLSL y sus guardas fueron extraídos e integrados en main por PR241;
la decisión canónica de main es 186. Esta reconciliación conserva la procedencia
y no constituye una segunda modificación del campo ni aceptación clínica del Atlas.

## 187. Concentración de dispersores continua sin saltos de celda

**Contexto.** `clumpGain` era constante en celdas de 1,2 mm. En caras
muestreadas a ±0,00001 mm, el cambio llega a 14,55 dB para agrupación 1,
y a 7,27 dB para 0,5. Son saltos del instrumento, sin interfaz anatómica.
Ablaciones renales previas identifican contribución de la textura, pero no
resuelven toda la separación renal respecto de músculo.

**Opciones.** Borrar cápsula o hacer uniforme el seno elimina información; bajar
ganancia oculta la causa. Interpolar amplitud directamente sesga la potencia
media. No introducir otra PSF ni renormalizar por pose o ventana.

**Decisión.** Interpolar potencia log-uniforme normalizada de ocho nodos mediante
pesos smoothstep convexos y recuperar amplitud. `speckleField.ts` conserva
gemelos TS/GLSL, mismo anclaje y transición de anclas en potencia. La fuente
anatómica común no cambia. Paso, kernel y agrupación siguen siendo estimaciones
NEEDS_CALIBRATION; véase el contrato de grumos continuos.

**Consecuencias.** La concentración del medio dispersor es C1 en caras de celda,
sin nuevos saltos al desplazar/abanicar. Conserva potencia de conjunto y reduce
contraste de bloques; no demuestra aspecto clínico correcto, fascias completas
ni fluidez de la app. Ocho nodos en lugar de uno exigen verificar coste real.

**Verificación.** `tissueSpeckle.test.ts` añade testigos de las caras en tres ejes,
agrupaciones 0,5/0,6/1, muestreo reservado de potencia y retorno del material.
Las guardas anteriores de potencia, contraste no Rayleigh y estabilidad de
inclinación permanecen. Junto con `retroTexture.test.ts`, 14 pruebas pasan.
La versión previa falla la nueva guarda de caras. En 50 000 puntos independientes
la potencia del candidato es 0,9988/0,9986/0,9977 y los saltos <8e−9 dB;
son mediciones de concentración, no del gris adquirido. La comparación visual
y el rendimiento requieren el protocolo registrado del contrato antes de
aceptar el cambio; la revisión externa permanece pendiente.
