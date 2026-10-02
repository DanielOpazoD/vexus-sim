import { Interface } from './interfaces';

/** Lámina de colágeno dentro de la grasa (fascias de la pared, decisión 62). */
const FASCIA_IN_FAT = 'capa fina de colágeno en grasa: 2Γ·sen(kt), Γ colágeno (Z ≈ 1,85, Duck 1990) / grasa ≈ 0,17';
/** Nivel de las caras de la pared (decisión 62): la rugosidad efectiva deja su parte coherente en el de las referencias. */
const WALL_ROUGH =
  'rugosidad efectiva σz 0,075 mm y s 0,3 de una fascia ondulada a la escala del haz (volumen parcial en la rodaja): en la imagen sus líneas quedan a +6–14 dB sobre el hígado (mediana por vista a incidencia normal, gemelo 6,4–13,7 dB y ≤ 0,2 % de píxeles saturados), gris-blancas, bajo la pleura y la cortical, como las de las referencias; con σz 0,05, +15–29 dB y cinco líneas saturadas cruzando el flanco (capturas con GPU, 25-09-2026); con 0,10, al nivel del hígado; lisa (0,03), +30–40 dB y su falda llenaba el músculo [ESTIMADO]';
/** Plano intermuscular de la pared lateral (decisión 62). */
const INTERMUSCULAR = 'fascia con grasa entre dos músculos: 2Γ·sen(kt) con Γ grasa/músculo 0,14 y t ≈ 0,03 mm ≈ 0,08 [ESTIMADO]';
const WALL = 'Z de TISSUES (IT’IS); suelo por la pared vascular (IT’IS «blood vessel wall», |R| ≈ 0,024) [LITERATURA aprox.]';
/** Scientific provenance, retained in source without shipping unused prose in each scene worker. */
export const INTERFACE_SOURCES: Readonly<Record<Interface, string>> = {
  [Interface.None]: '—',
  [Interface.VeinLumen]: `${WALL}; s de la VSH, brillante solo a ±12° [ESTIMADO]`,
  [Interface.IvcLumen]: `${WALL}; pared más gruesa y ondulada [ESTIMADO]`,
  [Interface.PortalLumen]: 'colágeno de tipo tendón con grasa, Z ≈ 1,85 (Duck 1990) [LITERATURA aprox.]; visible hasta ~25° [ESTIMADO]',
  [Interface.ArteryLumen]: 'pared arterial con elastina y colágeno [ESTIMADO]',
  [Interface.DuctLumen]: 'Fresnel pared biliar / bilis (TISSUES)',
  [Interface.GallbladderLumen]: 'Fresnel pared vesicular / bilis (TISSUES)',
  [Interface.LiverCapsule]:
    'capa de colágeno sub-resolución, 2Γ₁·sen(kt) ≈ 0,02–0,045 [ESTIMADO]; s 0,2 (decisión 65; antes 0,25, «continua hasta el borde del sector»: el lóbulo ancho la dibujaba como un trazo a 20–40°; bajo la pared la línea que llega al borde es la del peritoneo, rugoso, con su componente difusa) [ESTIMADO]',
  [Interface.DiaphragmLiver]: 'fascia diafragmática [ESTIMADO]',
  [Interface.Pleura]: 'Fresnel tejido / gas; σz es el mando de nivel de su parte coherente, en [0,085; 0,095] [ESTIMADO]',
  [Interface.RenalCapsule]:
    'Fresnel grasa perirrenal / cápsula renal (TISSUES); es la cara que da el pico de Morison, en [1,6; 2,2] [ESTIMADO]: s 0,2 y σz 0,06 (decisión 65; antes 0,25 y 0,05, con la s de mando del nivel: su lóbulo ancho y χ(θ) la dejaban a +18 dB a 20–40°, la «U» del contorno profundo del riñón; ahora el nivel lo fija χ(0) y el lóbulo, el ángulo)',
  [Interface.PerirenalFat]:
    'Fresnel hígado / grasa (TISSUES); s 0,2 y σz 0,06 como la cápsula renal (decisión 65; antes 0,3 y 0,05: +12 dB a 40–60°, el brazo de la «U» que sale del riñón) [ESTIMADO]; no mueve el pico de Morison, que es la cápsula renal',
  [Interface.PleuraWall]:
    'Fresnel músculo / gas (TISSUES), |R| ≈ 0,9995; s 0,15 [ESTIMADO 0,10–0,15]: la línea pleural es la más brillante cerca de la normal y se apaga en los bordes del sector (Lee 2017, J Med Ultrasound 25:101, fig. 5B; PMC10132878 fig. 2A); σz 0,05 mm [ESTIMADO, calibrable 0,04–0,07]: su parte coherente (−8,9 dB a 0°) la satura 1,2–1,3 mm a 0–15° con K = 55 dB (gemelo) y es la reflexión coherente de cada rebote de la serie bajo la pleura; de un lado: la dibuja el músculo (la pared es su dueña, decisión 61)',
  [Interface.SkinFat]: 'Fresnel piel / grasa 0,146 (TISSUES); cara ondulada (papilas, folículos): s 0,35 y σz 0,075 [ESTIMADO]',
  [Interface.Scarpa]: `${FASCIA_IN_FAT}; t 0,05–0,1 mm daría 0,2–0,3, 0,07 por su irregularidad y ${WALL_ROUGH} (PMC7441131)`,
  [Interface.DeepFascia]: `Fresnel grasa / músculo 0,138 (TISSUES); ${WALL_ROUGH}`,
  [Interface.ObliquePlane]: `${INTERMUSCULAR}; ${WALL_ROUGH}`,
  [Interface.TransversusPlane]: `${INTERMUSCULAR}; ${WALL_ROUGH}`,
  [Interface.Transversalis]: `Fresnel músculo / grasa 0,138 (TISSUES); ${WALL_ROUGH}`,
  [Interface.Peritoneum]:
    'Fresnel grasa / hígado 0,132 (TISSUES); cara irregular por los lóbulos de la grasa preperitoneal (σz 0,08, s 0,4) [ESTIMADO]: junto al hígado su eco y el de la cápsula quedan a 0,7 mm y se ven como una línea, calibrada en el rango de la cápsula de la decisión 57 (gemelo 1,82–1,83 a 0–20°; con σz 0,06, 1,88–1,97; con σz 0,04 y s 0,3, 2,24–2,40)',
  [Interface.RibCortex]:
    'Fresnel músculo / hueso 0,59 (TISSUES, IT’IS); s 0,15 y σz 0,045 (periostio y cortical algo irregulares a 3,5 MHz) [ESTIMADO]: su parte coherente queda bajo la de la pleura parietal (σz 0,05, |R| ≈ 1), la cara más brillante de la tabla (decisión 61); coherencia de curvatura de su sección',
  [Interface.Perichondrium]:
    'Fresnel cartílago / músculo 0,021 (TISSUES); lámina densa de colágeno: suelo 0,025, σz 0,06 y s 0,3 como las fascias [ESTIMADO]: su eco especular (K·|R|·Λ·χ a 2,5 MHz) queda en 9,8 dB a 0° y 5,9 a 30°; con el suelo 0,06, σz 0,03 y s 0,2 (25,8 y 10,6), en la subxifoidea los cortes de los cartílagos del reborde eran una cadena de rizos blancos (capturas con GPU, 25-09-2026)',
  [Interface.Pericardium]: 'pericardio fibroso (colágeno / grasa, Duck 1990): suelo 0,15 [LITERATURA aprox.]; σz 0,06, s 0,2 [ESTIMADO]',
  [Interface.BowelLumen]: 'EFSUMB 2016; doi:10.1055/s-0042-115853. Rugosidad y pendiente estimadas (decisión 101).',
  [Interface.BowelSerosa]: 'EFSUMB 2016; doi:10.1055/s-0042-115853. Rugosidad y pendiente estimadas (decisión 101).',
};
