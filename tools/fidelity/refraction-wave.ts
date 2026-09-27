/**
 * Banco de ondas de la refracción en las luces (decisión 86): eco de moteado de un haz enfocado tras una luz circular,
 * con óptica de ondas 2D (espectro angular en pasos partidos: propagación en k y la luz como pantalla de fase por
 * láminas de 0,05 mm), monocromático a 3,5 MHz, en geometría plana. La emisión es la de la imagen B (26 mm con ventana
 * de Hann, foco F) y la recepción, uniforme de min(26, r/2,5) mm con foco dinámico en la muestra; la métrica es el
 * eco medio de un moteado, ∫I_tx·I_rx, con la luz frente a sin ella (dB). Lo que no lleva: la reflexión total a
 * incidencia rasante, el ancho de banda y la tercera dimensión.
 *
 * Genera las referencias de `src/validation/support/refractionBench.ts` (tarda unos minutos):
 *   npx tsx tools/fidelity/refraction-wave.ts > perfiles.json
 */
import { TISSUES, Tissue } from '../../src/anatomy/tissues';

interface BenchCase {
  id: string;
  tissue: 'bile' | 'blood';
  a: number;
  z0: number;
  behind: number;
  focus: number;
}

const CASES: BenchCase[] = [
  { id: 'A', tissue: 'bile', a: 14.5, z0: 60, behind: 20, focus: 90 },
  { id: 'B', tissue: 'bile', a: 14.5, z0: 60, behind: 40, focus: 90 },
  { id: 'C', tissue: 'blood', a: 10, z0: 90, behind: 20, focus: 90 },
  { id: 'D', tissue: 'blood', a: 10, z0: 90, behind: 40, focus: 90 },
  { id: 'E', tissue: 'blood', a: 5, z0: 70, behind: 20, focus: 90 },
  { id: 'F', tissue: 'bile', a: 14.5, z0: 60, behind: 20, focus: 50 },
  { id: 'G', tissue: 'bile', a: 14.5, z0: 60, behind: 20, focus: 150 },
  { id: 'H', tissue: 'blood', a: 15, z0: 80, behind: 30, focus: 90 },
  { id: 'I', tissue: 'bile', a: 14.5, z0: 60, behind: 60, focus: 90 },
];

const F_MHZ = 3.5;
const D_TX = 26;
const N = 4096;
const DX = 0.05;
const DZ = 0.05;
const C0 = TISSUES[Tissue.Liver].c;
const LAMBDA = C0 / (F_MHZ * 1e3);
const K0 = (2 * Math.PI) / LAMBDA;
const X = Float64Array.from({ length: N }, (_, i) => (i - N / 2) * DX);
const KX = Float64Array.from({ length: N }, (_, i) => (2 * Math.PI * (i < N / 2 ? i : i - N)) / (N * DX));
// bordes absorbentes (supergaussiana) contra el reciclado de la FFT
const ABSORB = Float64Array.from(X, (x) => Math.exp(-Math.pow(Math.abs(x) / (0.45 * N * DX), 16)));

function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ar = re[i + j];
        const ai = im[i + j];
        const br = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const bi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ar + br;
        im[i + j] = ai + bi;
        re[i + j + len / 2] = ar - br;
        im[i + j + len / 2] = ai - bi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  if (inverse)
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
}

/** Propagación de espectro angular una distancia dz (las ondas evanescentes se amortiguan). */
function propagate(re: Float64Array, im: Float64Array, dz: number): void {
  fft(re, im, false);
  for (let i = 0; i < N; i++) {
    const q = K0 * K0 - KX[i] * KX[i];
    const hr = q >= 0 ? Math.cos(Math.sqrt(q) * dz) : Math.exp(-Math.sqrt(-q) * dz);
    const hi = q >= 0 ? Math.sin(Math.sqrt(q) * dz) : 0;
    const t = re[i] * hr - im[i] * hi;
    im[i] = re[i] * hi + im[i] * hr;
    re[i] = t;
  }
  fft(re, im, true);
}

/** Intensidad a la profundidad r de una apertura de ancho D centrada en xc, enfocada a F, con la luz o sin ella. */
function intensity(c: BenchCase, n: number, r: number, xc: number, D: number, F: number, hann: boolean, lens: boolean): Float64Array {
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const u = X[i] - xc;
    if (Math.abs(u) >= D / 2) continue;
    const w = hann ? Math.cos((Math.PI * u) / D) ** 2 : 1;
    const ph = -K0 * Math.sqrt(u * u + F * F);
    re[i] = w * Math.cos(ph);
    im[i] = w * Math.sin(ph);
  }
  if (!lens) propagate(re, im, r);
  else {
    const zA = c.z0 - c.a - 0.5;
    const zB = c.z0 + c.a + 0.5;
    propagate(re, im, zA);
    const ph = K0 * (n - 1) * DZ;
    const cr = Math.cos(ph);
    const ci = Math.sin(ph);
    for (let z = zA; z < zB - 1e-9; z += DZ) {
      propagate(re, im, DZ / 2);
      for (let i = 0; i < N; i++) {
        if (Math.hypot(X[i], z + DZ / 2 - c.z0) < c.a) {
          const t = re[i] * cr - im[i] * ci;
          im[i] = re[i] * ci + im[i] * cr;
          re[i] = t;
        }
      }
      propagate(re, im, DZ / 2);
      for (let i = 0; i < N; i++) {
        re[i] *= ABSORB[i];
        im[i] *= ABSORB[i];
      }
    }
    propagate(re, im, r - zB);
  }
  return Float64Array.from({ length: N }, (_, i) => re[i] * re[i] + im[i] * im[i]);
}

const out = CASES.map((c) => {
  const n = C0 / TISSUES[c.tissue === 'bile' ? Tissue.Fluid : Tissue.Blood].c;
  const r = c.z0 + c.a + c.behind;
  const dRx = Math.min(26, r / 2.5);
  const x: number[] = [];
  const db: number[] = [];
  for (let xi = 0; xi <= c.a + 10; xi += 0.8) {
    const tx = intensity(c, n, r, xi, D_TX, c.focus, true, true);
    const tx0 = intensity(c, n, r, xi, D_TX, c.focus, true, false);
    const rx = intensity(c, n, r, xi, dRx, r, false, true);
    const rx0 = intensity(c, n, r, xi, dRx, r, false, false);
    let s = 0;
    let s0 = 0;
    for (let i = 0; i < N; i++) {
      s += tx[i] * rx[i];
      s0 += tx0[i] * rx0[i];
    }
    x.push(Number(xi.toFixed(2)));
    db.push(Number((10 * Math.log10(s / s0)).toFixed(2)));
  }
  return { ...c, r, x, db };
});
console.log(JSON.stringify(out));
