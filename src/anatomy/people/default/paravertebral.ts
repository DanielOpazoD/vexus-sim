import type { Vec3 } from '../../../core/vec3';
import { PARAVERTEBRAL } from '../../organs/retroperitoneum';

/**
 * Distancia con signo (cota inferior, mm; negativa dentro) a la masa paravertebral; `dPsoasMm` y `dQuadratusMm`, las del
 * psoas y el cuadrado en m. @twin organo-retroperitoneo
 */
export function paravertebralSdf(m: Vec3, insideWallMm: number, dPeriMm: number, dPsoasMm: number, dQuadratusMm: number): number {
  const P = PARAVERTEBRAL,
    r = P.roundMm;
  // sección: caja de |x| ≤ xLateral entre yBack e yFront, con las esquinas laterales redondeadas
  const a = Math.abs(m[0]) - P.xLateral + r,
    b = Math.abs(m[1] - (P.yFront + P.yBack) / 2) - (P.yFront - P.yBack) / 2 + r;
  return Math.max(
    Math.min(Math.max(a, b), 0) + Math.hypot(Math.max(a, 0), Math.max(b, 0)) - r,
    P.xMedial - Math.abs(m[0]),
    -insideWallMm / 1.25,
    -dPeriMm / 1.25,
    P.psoasClearanceMm - dPsoasMm,
    P.quadratusClearanceMm - dQuadratusMm,
    m[2] - P.zTop,
    P.zBottom - m[2],
  );
}
