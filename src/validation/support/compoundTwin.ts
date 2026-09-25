/**
 * Gemelo en CPU de las pasadas B → C → D de la composición espacial (decisión 58) en la rejilla común:
 * cada mirada θ se forma en las muestras (línea j, fila i) de la mirada 0, con la línea dirigida que pasa
 * por cada una (la fase de mirada por nodo de `speckleField.ts` y `steering.ts`), y comparte con la 0 las
 * pasadas C y D. Lo usan `speckleField.test.ts` (estadística por mirada) y `compoundSpeckle.test.ts`
 * (decorrelación entre miradas, N_eff, grano y fracción oscura del compuesto). Nació en el diseño de la
 * decisión 58 (`design-thi/steered-subframes/sim.ts`, en 2D) y aquí usa las funciones de producción:
 *  - B: el medio anclado de tres planos en elevación (`speckleSliceFieldPh`; la mirada 0, `lp` null, es
 *    `speckleSliceField` tal cual), mezclados ½|f₀| + ¼(|f₁| + |f₂|) con la fase del plano central;
 *    elevación σe = 1,6·√(1 + ((r − 80)/45)²) como la pasada B; solo moteado (sin tejido, ruido ni ecos);
 *  - C: gaussiana axial de σ = max(0,6; 0,26/dr) muestras, truncada a ±12 y de energía unidad;
 *  - D: gaussiana lateral de σ = max(0,35; σ_PSF/paso de línea) líneas (`lateralSigmaMm`), ±14, energía
 *    unidad, y envolvente ×2/√π.
 * Sin WebGL ni `probe`/`app` (capa `validation`): el marco de la sonda entra como vectores.
 */
import { add, scale, type Vec3 } from '../../core/vec3';
import { CONVEX_BEAM, lateralSigmaMm, type BeamParams } from '../../ultrasound/beamModel';
import { speckleSliceFieldPh, type SpeckleAnchorState } from '../../ultrasound/speckleField';
import { lookPhase, lookPhaseGrad } from '../../ultrasound/steering';

/** Geometría de la imagen: la de la aplicación por defecto (convexo de 192 líneas a 18 cm, foco 90 mm). */
export interface TwinGeometry {
  depthMm: number;
  lines: number;
  samples: number;
  curvatureRadius: number;
  halfSector: number;
  focusMm: number;
  elevFocusMm: number;
  elevSigma0Mm: number;
  latticeMm: number;
  beam: BeamParams;
}

export const TWIN_GEOMETRY: TwinGeometry = {
  depthMm: 180,
  lines: 192,
  samples: 1024,
  curvatureRadius: 60,
  halfSector: (34 * Math.PI) / 180,
  focusMm: 90,
  elevFocusMm: 80,
  elevSigma0Mm: 1.6,
  latticeMm: 0.42,
  beam: CONVEX_BEAM,
};

/** Marco de la sonda en el mundo: centro de curvatura, ejes y cara (pivote del ancla). */
export interface TwinFrame {
  center: Vec3;
  axial: Vec3;
  lateral: Vec3;
  elevation: Vec3;
  face: Vec3;
}

/** Parche de la rejilla común: líneas [j0, j1] × filas [i0, i1], inclusive. */
export interface TwinPatch {
  j0: number;
  j1: number;
  i0: number;
  i1: number;
}

const AXIAL_MAX = 12;
const LATERAL_MAX = 14;

function unitKernel(sigma: number, max: number): number[] {
  const R = Math.min(max, Math.ceil(sigma * 2.5));
  const w: number[] = [];
  let s2 = 0;
  for (let k = -R; k <= R; k++) {
    const v = Math.exp(-0.5 * (k / sigma) ** 2);
    w.push(v);
    s2 += v * v;
  }
  const n = Math.sqrt(s2);
  return w.map((v) => v / n);
}

export const elevSigmaMm = (r: number, g: TwinGeometry = TWIN_GEOMETRY): number =>
  g.elevSigma0Mm * Math.sqrt(1 + ((r - g.elevFocusMm) / 45) ** 2);

/**
 * Envolvente de las miradas `thetas` (rad, en el elemento) en el parche, índice (i − i0)·nL + (j − j0).
 * `st` es el ancla del medio; `salt`, la sal del campo (otra sal, otra realización); `k2`, el número de
 * onda de ida y vuelta de la fase de mirada (`lookWavenumber`). `planes` = 3 es la pasada B; 1 deja solo
 * el plano central (campo coherente, sin la mezcla de magnitudes: la referencia de la ley de
 * decorrelación).
 */
export function lookPatchEnvelopes(
  frame: TwinFrame,
  st: SpeckleAnchorState,
  thetas: readonly number[],
  patch: TwinPatch,
  salt: number,
  k2: number,
  planes: 1 | 3 = 3,
  g: TwinGeometry = TWIN_GEOMETRY,
): Float64Array[] {
  const L = g.lines;
  const dr = g.depthMm / g.samples;
  const dPhi = (2 * g.halfSector) / L;
  const pitch = (r: number) => (g.curvatureRadius + r) * ((2 * g.halfSector) / (L - 1));
  const rowR = (i: number) => (i + 0.5) * dr;
  const kA = unitKernel(Math.max(0.6, 0.26 / dr), AXIAL_MAX);
  const RA = (kA.length - 1) / 2;
  const kLat = new Map<number, number[]>();
  let RL = 0;
  for (let i = patch.i0; i <= patch.i1; i++) {
    const r = rowR(i);
    const k = unitKernel(Math.max(0.35, lateralSigmaMm(r, g.focusMm, g.beam) / pitch(r)), LATERAL_MAX);
    kLat.set(i, k);
    RL = Math.max(RL, (k.length - 1) / 2);
  }
  const nL = patch.j1 - patch.j0 + 1;
  const nR = patch.i1 - patch.i0 + 1;
  const wL = nL + 2 * RL;
  const wR = nR + 2 * RA;
  return thetas.map((theta) => {
    // B: campo crudo con margen para C y D
    const re = new Float64Array(wL * wR);
    const im = new Float64Array(wL * wR);
    for (let a = 0; a < wL; a++) {
      const alpha = -g.halfSector + (patch.j0 - RL + a + 0.5) * dPhi;
      const dir = add(scale(frame.axial, Math.cos(alpha)), scale(frame.lateral, Math.sin(alpha)));
      for (let b = 0; b < wR; b++) {
        const r = rowR(patch.i0 - RA + b);
        const rho = g.curvatureRadius + r;
        const p = add(frame.center, scale(dir, rho));
        const se = elevSigmaMm(r, g);
        let lp = null;
        if (theta !== 0) {
          const [gx, gz] = lookPhaseGrad(rho, alpha, theta, g.curvatureRadius, k2);
          lp = { ph0: lookPhase(rho, alpha, theta, g.curvatureRadius, k2), g: add(scale(frame.lateral, gx), scale(frame.axial, gz)) };
        }
        const f0 = speckleSliceFieldPh(p, g.latticeMm, se, salt, st, lp);
        let k = 1;
        if (planes === 3) {
          const f1 = speckleSliceFieldPh(add(p, scale(frame.elevation, se)), g.latticeMm, se, salt, st, lp);
          const f2 = speckleSliceFieldPh(add(p, scale(frame.elevation, -se)), g.latticeMm, se, salt, st, lp);
          const m0 = Math.hypot(f0[0], f0[1]);
          const mag = 0.5 * m0 + 0.25 * (Math.hypot(f1[0], f1[1]) + Math.hypot(f2[0], f2[1]));
          k = m0 > 1e-6 ? mag / m0 : 1;
        }
        re[a * wR + b] = f0[0] * k;
        im[a * wR + b] = f0[1] * k;
      }
    }
    // C: axial
    const axRe = new Float64Array(wL * nR);
    const axIm = new Float64Array(wL * nR);
    for (let a = 0; a < wL; a++)
      for (let i = 0; i < nR; i++) {
        let sr = 0;
        let si = 0;
        for (let q = -RA; q <= RA; q++) {
          const n = a * wR + i + RA + q;
          sr += kA[q + RA] * re[n];
          si += kA[q + RA] * im[n];
        }
        axRe[a * nR + i] = sr;
        axIm[a * nR + i] = si;
      }
    // D: lateral y envolvente
    const env = new Float64Array(nL * nR);
    for (let i = 0; i < nR; i++) {
      const kl = kLat.get(patch.i0 + i)!;
      const R = (kl.length - 1) / 2;
      for (let j = 0; j < nL; j++) {
        let sr = 0;
        let si = 0;
        for (let q = -R; q <= R; q++) {
          const n = (j + RL + q) * nR + i;
          sr += kl[q + R] * axRe[n];
          si += kl[q + R] * axIm[n];
        }
        env[i * nL + j] = Math.hypot(sr, si) * 1.1283792;
      }
    }
    return env;
  });
}

/** Correlación de intensidad (|env|²) entre dos envolventes del mismo parche. */
export function intensityCorrelation(a: Float64Array, b: Float64Array): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i] * a[i];
    mb += b[i] * b[i];
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] * a[i] - ma;
    const y = b[i] * b[i] - mb;
    sab += x * y;
    saa += x * x;
    sbb += y * y;
  }
  return sab / Math.sqrt(saa * sbb);
}

// La ley de decorrelación y N_eff son también del banco de GPU (`fidelity.ts`): viven en `compound.ts`.
export { effectiveLooks, lookCorrelationLaw } from '../../ultrasound/compound';
