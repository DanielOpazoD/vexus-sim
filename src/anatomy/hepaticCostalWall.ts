import { abdominalAtlas, abdominalAtlasSdf } from './abdominalAtlas';
import { BODY_ROWS, BODY_STRIDE, COSTAL_BODY_ROWS, COSTAL_BODY_STRIDE, COSTAL_BODY_BLEND_Z } from './referenceBody';
import { thoracicAtlas, thoracicValue } from './thoracicAtlas';
import { smoothstep, type Vec3 } from '../core/vec3';

/** Estimated patient-specific parietal apposition, NOT a new skin segmentation.
 * Registered viscera/bone remain fixed. Outside the hepatic/right-flank territory,
 * retain the inherited source profile plus the former habitus padding. (183)
 * Cache only for identical loaded fields/profile and wall thickness. */
const flankApposition = (phi: number, z: number): number =>
  smoothstep(2.65, 2.85, phi) * (1 - smoothstep(3.2, 3.45, phi)) * smoothstep(-240, -190, z) * (1 - smoothstep(-110, -90, z));
let cached:
  | { atlas: Uint16Array; bone: Uint16Array | undefined; source: Float32Array; wall: number; skin: number; profile: Float32Array }
  | undefined;
export function hepaticCostalBody(source: Float32Array, wallMm: number, skinMm: number): Float32Array {
  if (!abdominalAtlas) return Float32Array.from(source, (r, i) => (i % BODY_STRIDE === 0 ? r : r + Math.max(0, wallMm - 10)));
  if (
    cached?.atlas === abdominalAtlas &&
    cached.bone === thoracicAtlas &&
    cached.source === source &&
    cached.wall === wallMm &&
    cached.skin === skinMm
  )
    return cached.profile;
  const profile = new Float32Array(COSTAL_BODY_ROWS * COSTAL_BODY_STRIDE);
  const padding = Math.max(0, wallMm - 10);
  for (let row = 0; row < COSTAL_BODY_ROWS; row++) {
    const z = -400 + (row * 520) / (COSTAL_BODY_ROWS - 1);
    // Conserva el ajuste calibrado a partir de las muestras fuente (183).
    // La superficie C1 se reconstruye sobre el perfil final, no dentro del ajuste.
    const rows = source.length / BODY_STRIDE,
      minZ = rows === BODY_ROWS ? -160 : -400;
    const q = Math.max(0, Math.min(rows - 1, ((z - minZ) * (rows - 1)) / (120 - minZ)));
    const r0 = Math.min(rows - 2, Math.floor(q)),
      f = q - r0;
    const sample = (k: number) => source[r0 * BODY_STRIDE + k] * (1 - f) + source[(r0 + 1) * BODY_STRIDE + k] * f;
    const cy = sample(0);
    profile[row * COSTAL_BODY_STRIDE] = cy;
    for (let k = 0; k < COSTAL_BODY_STRIDE - 1; k++) {
      const q = k / 2,
        sector = Math.floor(q);
      const phi = (k * 2 * Math.PI) / (COSTAL_BODY_STRIDE - 1);
      const inherited = sample(sector + 1) + (sample(1 + ((sector + 1) % 64)) - sample(sector + 1)) * (q - sector) + padding;
      // Include the anterior hepatic face used by subcostal acquisition. The
      // liver crossing and competing source viscera still decide whether to fit.
      const hepaticWeight =
        smoothstep(1.1, 1.4, phi) *
        (1 - smoothstep(3.6, 3.9, phi)) *
        smoothstep(COSTAL_BODY_BLEND_Z[0], COSTAL_BODY_BLEND_Z[1], z) *
        (1 - smoothstep(0, 30, z));
      // La apposición no puede terminar como un escalón donde acaba el hígado:
      // bajo el reborde, el mismo compartimento parietal continúa sobre las
      // vísceras fuente. La transición anterior dejaba hasta ~28 mm de relleno
      // no segmentado en el flanco. Ajuste estimado, no nueva segmentación (222).
      const flankWeight = flankApposition(phi, z);
      const weight = 1 - (1 - hepaticWeight) * (1 - flankWeight);
      let radius = inherited;
      if (weight > 0 && (k % 2 === 0 || flankWeight > 0)) {
        const point = (r: number): Vec3 => [r * Math.cos(phi), cy + r * Math.sin(phi), z];
        let hepatic = -1,
          other = -1,
          bone = -1;
        // A bounded radial search for outer occupied source surfaces. The last
        // hepatic crossing is refined below; other surfaces get a 2-mm guard plus one atlas cell in the flank.
        for (let r = 0; r < inherited; r += 1) {
          const p = point(r);
          if (abdominalAtlasSdf(p, 4) < 0) hepatic = r;
          if ([0, 1, 2, 3, 5, 6, 7, 8, 9, 10].some((f) => abdominalAtlasSdf(p, f) < 0)) other = r;
          if (thoracicValue(p).d < 0) bone = r;
        }
        // Continúa el compartimento parietal sobre las vísceras vecinas al
        // terminar el hígado. Retomar aquí el contorno heredado crea un
        // escalón cutáneo y pliega la pared superficial durante el deslizamiento.
        if (hepatic >= 0 || other >= 0) {
          let lo = hepatic,
            hi = hepatic + 1;
          for (let n = 0; hepatic >= 0 && n < 16; n++) {
            const mid = (lo + hi) / 2;
            if (abdominalAtlasSdf(point(mid), 4) < 0) lo = mid;
            else hi = mid;
          }
          // La grasa preperitoneal ya pertenece al espesor wallMm. El contacto
          // normal no necesita otra banda de tejido residual bajo el peritoneo.
          const contact = hepatic >= 0 ? (lo + hi) / 2 + wallMm : 0;
          // El flanco añade una celda fuente (1,5 mm) al margen de 2 mm:
          // protege los cruces viscerales entre las filas del perfil.
          // Preserve all source organs outside wall, and at least skin + 2 mm
          // over cortical bone. A competing organ/too superficial rib wins.
          const protectedRadius = Math.max(contact, other + wallMm + 2 + 1.5 * flankWeight, bone + skinMm + 2);
          radius = inherited + weight * (Math.min(inherited, protectedRadius) - inherited);
        }
      }
      profile[row * COSTAL_BODY_STRIDE + 1 + k] = radius;
    }
  }
  // Las medias direcciones solo aportan nueva geometría donde continúa el
  // flanco. Fuera de él conservan las observaciones costales previas: ajustar
  // otra vez ese dominio desplazaba el apoyo portal (222).
  for (let row = 0; row < COSTAL_BODY_ROWS; row++)
    for (let k = 1; k < COSTAL_BODY_STRIDE - 1; k += 2) {
      const i = row * COSTAL_BODY_STRIDE + 1 + k;
      const inherited = (profile[i - 1] + profile[row * COSTAL_BODY_STRIDE + 1 + ((k + 1) % (COSTAL_BODY_STRIDE - 1))]) / 2;
      const weight = flankApposition((k * 2 * Math.PI) / (COSTAL_BODY_STRIDE - 1), -400 + row * 10);
      profile[i] = inherited + weight * (profile[i] - inherited);
    }
  cached = { atlas: abdominalAtlas, bone: thoracicAtlas, source, wall: wallMm, skin: skinMm, profile };
  return profile;
}
