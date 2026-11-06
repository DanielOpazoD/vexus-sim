import { S0028_BUNDLE as B } from './descriptor';
export const S0028_RENAL_FACE_MM = 1.2;
/** Colocación xyz de cada página 32×32 RG16F de grasa en el atlas abdominal: x/32 + 6·y/32 + 48·z, tres cifras en base 36. */
export const s0028FatPages = (): number[][] =>
  Array.from({ length: B.solids.pages.length / 3 }, (_, i) => {
    const c = parseInt(B.solids.pages.slice(3 * i, 3 * i + 3), 36);
    return [(c % 6) * 32, (Math.floor(c / 6) % 8) * 32, Math.floor(c / 48)];
  });
