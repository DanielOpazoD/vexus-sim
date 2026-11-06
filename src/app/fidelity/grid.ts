import { Tissue } from '../../anatomy/tissues';
import { type Vec3 } from '../../core/vec3';
import { IFACE_REACH_MM, IFACE_SHIFT_MM } from '../../ultrasound/interfaceEcho';

/**
 * Rejilla de clasificación del banco en CPU (líneas × `GRID_STEP_MM`): los tejidos como número, los umbrales con que el
 * banco la recorre (interfaces, despeje, pureza y penumbra), la transmisión de la pasada A, el gradiente central de las
 * normales y la máscara de despeje.
 */

/** Paso radial (mm) de la rejilla de clasificación en CPU. */
export const GRID_STEP_MM = 0.5;
/** Tejidos que pueden separar el hígado de la luz en el borde de un vaso. */
export const WALL_TISSUES: ReadonlySet<number> = new Set([Tissue.VesselWallThin, Tissue.VesselWallPortal]);
/** La rejilla guarda el tejido como número (Uint8Array). */
export const LIVER: number = Tissue.Liver;
export const BLOOD: number = Tissue.Blood;
export const DIAPHRAGM: number = Tissue.Diaphragm;
export const AIR: number = Tissue.Air;
export const CAPSULE: number = Tissue.LiverCapsule;
export const LUNG: number = Tissue.Lung;
export const MUSCLE: number = Tissue.Muscle;
export const FAT: number = Tissue.Fat;
export const PERIRENAL: number = Tissue.PerirenalFat;
export const RENAL_CAPSULE: number = Tissue.RenalCapsule;
/** Celdas seguidas de tejido previo que exige una interfaz (3 mm). */
export const MIN_BEFORE_CELLS = 6;
/**
 * Alcance del eco del peritoneo parietal hacia la grasa (mm): desplazamiento más alcance del perfil de una
 * cara de un solo lado. Si la cara interna de la pared cae en la ventana del pico de la cápsula ensanchada
 * por él, el registro es de la línea del peritoneo y la cápsula (`peritoneum`), no de la cápsula sola, y su
 * ventana empieza a este alcance por encima del cruce exacto con el peritoneo (no 1,5 mm sobre el borde:
 * ahí está la transversalis).
 */
export const PERITONEUM_REACH_MM = IFACE_SHIFT_MM + IFACE_REACH_MM;
/**
 * La transversalis, al menos a esto (mm de profundidad) por encima del inicio de esa ventana: con el pulso
 * (anchura del eco de una cara ~0,75 mm a −6 dB), su eco llega ~24 dB más bajo. Donde la grasa
 * preperitoneal es más fina, la línea del peritoneo no se mide (su pico sería el de la transversalis).
 */
export const TRANSVERSALIS_CLEAR_MM = 0.7;
/** Enlace de una pared entre líneas vecinas: su borde no se mueve más que esto (mm). */
export const WALL_LINK_MM = 3;
/** Pasos de la bisección del cruce exacto con la pleura (0,5 mm / 2²⁰). */
export const PLEURA_BISECTION_STEPS = 20;
/** Saturación de una cara: píxeles ≥ 250 a ≤ 1 mm de ella. */
export const FACE_SATURATION_MM = 1;
/** Distancia mínima (mm) de la sangre a su pared para medir el centro de la luz (en 3D, más la σ elevacional). */
export const LUMEN_CLEARANCE_MM = 1.5;
/** Acoplamiento mínimo de una línea para medir su textura (el mal contacto la oscurece entera). */
export const MIN_COUPLING = 0.95;
/** Líneas vecinas que también deben estar despejadas: la PSF lateral arrastra la sombra ~2σ. */
export const CLEAR_ERODE_LINES = 2;
/** Margen (mm) antes del primer tejido que hace sombra o refuerza. */
export const CLEAR_MARGIN_MM = 2;
/** Distancia mínima (mm) a cualquier tejido que no sea hígado (vasos incluidos). */
export const ENVELOPE_CLEARANCE_MM = 6;
export const DISPLAY_CLEARANCE_MM = 3;
/**
 * Diferencia de atenuación acumulada (dB, ida y vuelta) respecto al hígado a partir de la cual el
 * hígado de detrás ya no es «puro» para el nivel mostrado: el refuerzo tras un vaso de 2–3 mm.
 */
export const MAX_PATH_EXCESS_DB = 0.5;
/**
 * Fracción de aire de la cortina (decisión 61) a partir de la cual, bajo la pleura, el hígado ya no es puro:
 * con 0,01 el hígado pierde 0,09 dB y la réplica de orden 2 de la línea pleural queda ≤ −12 dB bajo él (gemelo:
 * +28 dB con la cortina entera); con 10⁻³, el umbral de la imagen, el borde se come la mitad del hígado de la
 * ventana intercostal sin cambiarlo.
 * @twin gemelo-pleura
 */
export const CURTAIN_LIVER_MAX_AIR = 0.01;
/**
 * Pérdida por la penumbra de la apertura (dB, transmisión con apertura frente a la de un solo rayo)
 * a partir de la cual el hígado ya no es «puro»: junto a una costilla el cono queda tapado en parte
 * aunque la línea no lo esté (decisión 54), y ese tejido más oscuro es física, no el nivel del hígado.
 * Desde la decisión 86 la transmisión con apertura lleva también la refracción de las luces: la máscara deja
 * fuera el hígado de sus sombras de borde (y el de detrás de la vesícula, algo más oscuro).
 */
export const MAX_PENUMBRA_DB = 0.5;

/**
 * Transmisión de ida y vuelta de la pasada A (`readTransmission`): un solo rayo, con apertura y la
 * profundidad del espejo (mm, −1 sin espejo hasta esa fila).
 */
export interface TransmissionFrame {
  lines: number;
  samples: number;
  single: Float32Array;
  aperture: Float32Array;
  mirrorHit: Float32Array;
}
/** Paso (mm) de las diferencias centrales de `faceSdf` para la normal de una cara. */
export const NORMAL_EPS_MM = 0.02;

/**
 * Gradiente por diferencias centrales (paso `eps`) de un campo que puede no estar definido (null):
 * null si alguna evaluación no lo está. Normal de las caras del banco y de la e2e de normales.
 */
export function centralGradient(f: (p: Vec3) => number | null, p: Vec3, eps = NORMAL_EPS_MM): Vec3 | null {
  const g: Vec3 = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const plus: Vec3 = [p[0], p[1], p[2]];
    const minus: Vec3 = [p[0], p[1], p[2]];
    plus[a] += eps;
    minus[a] -= eps;
    const dp = f(plus);
    const dm = f(minus);
    if (dp === null || dm === null) return null;
    g[a] = (dp - dm) / (2 * eps);
  }
  return g;
}

/**
 * Celdas de `kind` a ≥ `mm` de cualquier celda de otro tejido en una rejilla líneas × `stepMm`
 * (distancia euclídea en el plano; `spacingAt(k)` es el paso lateral entre líneas en la fila k). Lo que
 * cae fuera de la rejilla (fuera del sector o del campo) no se conoce y cuenta como otro tejido: una
 * celda a < `mm` del borde de la imagen no está despejada.
 */
export function clearanceMask(
  tissue: Uint8Array,
  lines: number,
  nr: number,
  stepMm: number,
  spacingAt: (k: number) => number,
  mm: number,
  kind: number,
): Uint8Array {
  const ok = new Uint8Array(lines * nr);
  const K = Math.ceil(mm / stepMm);
  for (let u = 0; u < lines; u++)
    for (let k = 0; k < nr; k++) {
      if (tissue[u * nr + k] !== kind) continue;
      const spacing = spacingAt(k);
      const U = Math.ceil(mm / spacing);
      let clear = true;
      for (let du = -U; clear && du <= U; du++) {
        const uu = u + du;
        for (let dk = -K; dk <= K; dk++) {
          const kk = k + dk;
          const inGrid = uu >= 0 && uu < lines && kk >= 0 && kk < nr;
          if (inGrid && tissue[uu * nr + kk] === kind) continue;
          if (Math.hypot(du * spacing, dk * stepMm) <= mm) {
            clear = false;
            break;
          }
        }
      }
      ok[u * nr + k] = clear ? 1 : 0;
    }
  return ok;
}
