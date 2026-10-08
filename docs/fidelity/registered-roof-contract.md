# Techo registrado experimental: contrato de contraste

Defecto: en el atlas el contacto hepático se mezcla con cúpulas heredadas
fuera del parche y produce salientes posteriores de relleno retroperitoneal.
El testigo X−31/Y−45 pasa por51,12mm frente al cruce fuente10,17mm.
Son alturas por rayo, no un diagnóstico ni separación normal.

Fuente: FJ3131 saneada, SHA256581c17df0c5b9469d4a0081550652b288f9bac03233ce810c81a85140e6dada3,
registro LAS común intacto. BP3D4.0, ©DBCLS, CC BY4.0. Son referencias
independientes las secciones nativas de CT s0028/s0440 TotalSegmentatorv3,
CC BY4.0; personas diferentes, sin encajar órganos entre ellas ni convertir
HU en ecogenicidad. Normalidad regional, unidades DICOM y revisión humana
siguen sin confirmar; NIFTI omite unidades y la escala se infiere de procedencia.

Cambio: techo del último cruce fuente en rejilla1,5mm, grafo limitado por
la inserción costal estimada previa y extensión armónica solo donde falta
proyección. Composición del contacto hepático ya existente antes de empaquetar.
Plano transpuesto libre de RG16F; misma textura y memoria, TS/GLSL/3D/plano.
No modifica órganos, etiquetas, hueso, musculo, soporte de contacto, calibres,
flujo, reloj, presets ni controles. Superficie3D y borde resuelven el cero
acústico y la pared interna; precisión numérica no añade resolución fuente.

Refutaciones conservadas: ajuste de dos cúpulas con máximo residual72,64mm;
primer instrumento de empaquetado abortado antes de instalación; superficies
3D con dos ceros incorrectos y borde residual2,49mm; primer techo runtime
elimina29muestras de VCI infra y9supra; primer intento de reconciliación
atrial invade una pared miocárdica en la congestión dilatada. No debilitar
ese control. La variante vigente limita el acceso a la entrada inferior de
la aurícula y al labio estimado que se deriva de sus radios y grosor previo
del orificio. Conserva todas las geometrías cardíacas y el recorte de tabiques.
Debe conservar la continuidad vascular y superar los controles anteriores.

La fuente completa tiene conflictos vasculares/esofágicos; no se adopta su
volumen, pilares ni hiatos. Este techo no demuestra reconciliación completa
ni fascia renal. El ensayo renal anterior que cambia2→5piezas cerradas se
conserva rechazado. Un gráfico mejor, un test o CI verde no lo resuelven.

La primera adquisición pareada mantuvo bandas brillantes profundas. El banco
de vecinos encontró tejido diafragmático hasta z−90mm pese a que el nodo más
inferior del techo está en z−50mm: prolongación tangencial, no tejido fuente.
Se conserva ese rechazo. La variante consulta tres proyecciones locales a
puntos reales del grafo bilineal común. El mínimo de esas distancias es una
cota superior de la distancia al grafo: evita inventar proximidad a una
superficie inexistente, pero puede omitir un parche fino si no encuentra el
mínimo global. No acredita una distancia euclídea exacta ni reconstrucción
de pilares. Las pendientes centrales de0,5mm mantienen la continuidad; el
ensayo con pendientes exactas por celda falló el borde0,042mm y se conserva
rechazado. El contacto hepático previo conserva su composición y obstáculo.
Los cuatro nodos se interpolan explícitamente en GLSL para no amplificar
la precisión limitada del filtrado al diferenciar; tolerancias intactas.

Validación obligatoria: hashes de11campos, perfiles y vecinos de tres planos,
ceros3D y borde, contactos de vasos/esófago/riñones (muestreo no es prueba
completa), continuidad de todos los ejes vasculares, control miocárdico/septal
con VCI dilatada, imágenes físicas pareadas, nueve ventanas, caso congestionado
y riñón izquierdo exploratorio, gestos reales de sonda y cine, coste CPU/GPU,
check/calibración, CI exacta sin flakiness. No aflojar límites. Validación
externa y adquisición clínica comparativa siguen abiertas.

Estado y evidencias se registran en el PR y en el circuito local de fidelidad.
El cambio es experimental hasta resolver contactos, imágenes/cines, rendimiento,
dependencias y CI; no se considera finalizada la corrección geométrica completa.
