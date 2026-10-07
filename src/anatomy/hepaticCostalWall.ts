import { abdominalAtlas, abdominalAtlasSdf } from './abdominalAtlas';
import { bodySection, BODY_STRIDE, COSTAL_BODY_ROWS } from './referenceBody';
import { thoracicAtlas, thoracicValue } from './thoracicAtlas';
import { smoothstep, type Vec3 } from '../core/vec3';

/** Estimated patient-specific parietal apposition, NOT a new skin segmentation.
 * Registered viscera/bone remain fixed. Outside the hepatic costal territory,
 * retain the inherited source profile plus the former habitus padding. (183)
 * Cache only for identical loaded fields/profile and wall thickness. */
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
  const profile = new Float32Array(COSTAL_BODY_ROWS * BODY_STRIDE);
  const padding = Math.max(0, wallMm - 10);
  for (let row = 0; row < COSTAL_BODY_ROWS; row++) {
    const z = -400 + row * 10;
    const cy = bodySection(0, z, source)[3];
    profile[row * BODY_STRIDE] = cy;
    for (let k = 0; k < 64; k++) {
      const phi = (k * 2 * Math.PI) / 64;
      const inherited = bodySection(phi, z, source)[0] + padding;
      const weight = smoothstep(1.9, 2.2, phi) * (1 - smoothstep(3.6, 3.9, phi)) * smoothstep(-145, -115, z) * (1 - smoothstep(0, 30, z));
      let radius = inherited;
      if (weight > 0) {
        const point = (r: number): Vec3 => [r * Math.cos(phi), cy + r * Math.sin(phi), z];
        let hepatic = -1,
          other = -1,
          bone = -1;
        // A bounded radial search for outer occupied source surfaces. The last
        // hepatic crossing is refined below; other surfaces get a 2-mm guard.
        for (let r = 0; r < inherited; r += 1) {
          const p = point(r);
          if (abdominalAtlasSdf(p, 4) < 0) hepatic = r;
          if ([0, 1, 2, 3, 5, 6, 7, 8, 9, 10].some((f) => abdominalAtlasSdf(p, f) < 0)) other = r;
          if (thoracicValue(p).d < 0) bone = r;
        }
        if (hepatic >= 0) {
          let lo = hepatic,
            hi = hepatic + 1;
          for (let n = 0; n < 16; n++) {
            const mid = (lo + hi) / 2;
            if (abdominalAtlasSdf(point(mid), 4) < 0) lo = mid;
            else hi = mid;
          }
          const contact = (lo + hi) / 2 + wallMm + 1.5;
          // Preserve all source organs outside wall, and at least skin + 2 mm
          // over cortical bone. A competing organ/too superficial rib wins.
          const protectedRadius = Math.max(contact, other + wallMm + 2, bone + skinMm + 2);
          radius = inherited + weight * (Math.min(inherited, protectedRadius) - inherited);
        }
      }
      profile[row * BODY_STRIDE + 1 + k] = radius;
    }
  }
  cached = { atlas: abdominalAtlas, bone: thoracicAtlas, source, wall: wallMm, skin: skinMm, profile };
  return profile;
}
