import { describe, expect, it } from 'vitest';
import { ANATOMY_GLSL } from '../anatomy/gpu/anatomy.glsl';
import { TISSUES, Tissue } from '../anatomy/tissues';
import type { Vec3 } from '../core/vec3';
import { PLEURA_GLSL } from '../ultrasound/pleura';
import { glslFloat } from '../ultrasound/receiver';
import { FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED } from '../ultrasound/shaders/passes.glsl';
import {
  DENSITY,
  DENSITY_TISSUES,
  NO_STRONG,
  SPECKLE_TISSUE_GLSL,
  STRONG_SCATTERERS,
  TISSUE_SALT_STEP,
  anchoredSliceField,
  densityDb,
  densityGain,
  hash13,
  latticeValuePh,
  scattererField,
  strongFactor,
  strongNode,
  strongScatter,
  type SpeckleAnchor,
  type StrongScatter,
} from '../ultrasound/speckleField';
import { rng } from './syntheticSpeckle';

/**
 * Textura del parénquima (decisión 89): dispersores fuertes por debajo de la resolución (una fracción de los nodos de la
 * retícula del moteado, con más amplitud) y variación de la densidad de dispersores a escala de milímetros, anclados al
 * material como el moteado. La referencia de la estadística es la del hígado humano sano in vivo: m de Nakagami 0,81
 * (0,76–0,88) a 3,5 MHz frente a ~1 en maniquíes de dispersores difusos con el mismo estimador (Wan et al. 2017, PLoS
 * One 12:e0181789, 30 voluntarios, vista intercostal derecha, ventanas de tres longitudes de pulso).
 */
const LIVER = Tissue.Liver;
const SALT = (1234 % 1000) / 7 + LIVER * TISSUE_SALT_STEP;
const H = 0.42;

/** Nodos al azar de la retícula (índices enteros) y sus dos hashes, como `latticeValueS`. */
function nodes(n: number, seed = 5): { a: number; b: number; c: Vec3 }[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    const c: Vec3 = [Math.floor(r() * 4000 - 2000), Math.floor(r() * 4000 - 2000), Math.floor(r() * 4000 - 2000)];
    return { a: hash13([c[0] + SALT, c[1], c[2]]), b: hash13([c[0], c[1] + SALT + 17.1, c[2]]), c };
  });
}

describe('dispersores fuertes del parénquima (decisión 89)', () => {
  const s = strongScatter(LIVER);
  const P = STRONG_SCATTERERS[LIVER]!;

  it('solo el hígado los lleva: los fuertes, ×gain sobre los corrientes, y todos al nivel que conserva la mediana', () => {
    expect(Object.keys(STRONG_SCATTERERS).map(Number)).toEqual([LIVER]);
    for (const t of [Tissue.Muscle, Tissue.RenalCortex, Tissue.Fat, Tissue.Blood]) expect(strongScatter(t)).toEqual(NO_STRONG);
    expect(s).toEqual([P.fraction, P.gain * P.level, P.level]);
    // el nivel baja la envolvente 0,48 dB: lo que la población fuerte sube su mediana (`parenchymaTextureTwin.test.ts`)
    expect(20 * Math.log10(P.level)).toBeCloseTo(-0.48, 2);
    // con muchos nodos: la potencia media sube level²·(1 − p + p·gain²), ±2 % (+0,42 dB en el hígado)
    const ns = nodes(200_000);
    let p0 = 0;
    let p1 = 0;
    for (const { a, b } of ns) {
      const r2 = -2 * Math.log(Math.max(1e-6, a));
      p0 += r2;
      p1 += r2 * strongFactor(b, s) ** 2;
    }
    const expected = P.level ** 2 * (1 - P.fraction + P.fraction * P.gain ** 2);
    expect(Math.abs(p1 / p0 / expected - 1)).toBeLessThan(0.02);
    expect(10 * Math.log10(expected)).toBeCloseTo(0.42, 1);
  });

  it('la elección da la fracción pedida, sin depender de la amplitud, y la fase de cada grupo es uniforme', () => {
    const ns = nodes(400_000, 11);
    const strong = ns.filter(({ b }) => strongFactor(b, s) === s[1]);
    const weak = ns.filter(({ b }) => strongFactor(b, s) !== s[1]);
    const frac = strong.length / ns.length;
    expect(Math.abs(frac / P.fraction - 1)).toBeLessThan(0.05);
    // la amplitud gaussiana de los fuertes es la de todos (±4 %) y la fase de cada grupo es uniforme (resultante < 0,03)
    const meanR2 = (list: typeof ns) => list.reduce((acc, { a }) => acc - 2 * Math.log(Math.max(1e-6, a)), 0) / list.length;
    expect(Math.abs(meanR2(strong) / meanR2(ns) - 1)).toBeLessThan(0.04);
    for (const group of [strong, weak]) {
      const turn = group.map(({ b }) => strongNode(b, s)[1]);
      const cx = turn.reduce((acc, t) => acc + Math.cos(2 * Math.PI * t), 0) / turn.length;
      const sy = turn.reduce((acc, t) => acc + Math.sin(2 * Math.PI * t), 0) / turn.length;
      expect(Math.hypot(cx, sy)).toBeLessThan(0.03);
      // y sin fases vacías ni preferidas: los 12 sectores de 30° llevan cada uno 1/12 ± 20 % (la fase de los fuertes toma
      // ~200 valores: b tiene ~2⁻¹¹ de resolución)
      const bins = new Array<number>(12).fill(0);
      for (const t of turn) bins[Math.min(11, Math.floor(t * 12))]++;
      for (const n of bins) expect(Math.abs((n * 12) / turn.length - 1)).toBeLessThan(0.2);
    }
    // sin patrón espacial: la fracción en cada octante de la caja de nodos es la misma (±15 %)
    for (let o = 0; o < 8; o++) {
      const inO = ns.filter(({ c }) => (c[0] >= 0 ? 1 : 0) + (c[1] >= 0 ? 2 : 0) + (c[2] >= 0 ? 4 : 0) === o);
      const f = inO.filter(({ b }) => strongFactor(b, s) === s[1]).length / inO.length;
      expect(Math.abs(f / P.fraction - 1), `octante ${o}`).toBeLessThan(0.15);
    }
  });

  it('sin dispersores fuertes el nodo es el de siempre, bit a bit; en cada mirada, los mismos nodos fuertes', () => {
    const r = rng(3);
    for (let i = 0; i < 2000; i++) {
      const m: Vec3 = [r() * 200 - 100, r() * 200 - 100, r() * 200 - 100];
      expect(scattererField(m, H, SALT, NO_STRONG)).toEqual(scattererField(m, H, SALT));
      // la fase de la mirada cambia la fase del nodo, no su amplitud (los dispersores son del material)
      const c: Vec3 = [Math.floor(m[0] / H), Math.floor(m[1] / H), Math.floor(m[2] / H)];
      const v0 = latticeValuePh(c, SALT, 0, s);
      const v1 = latticeValuePh(c, SALT, 1.3 + r() * 4, s);
      expect(Math.hypot(v1[0], v1[1])).toBeCloseTo(Math.hypot(v0[0], v0[1]), 5);
    }
  });

  it('el campo con dispersores fuertes está anclado como el moteado: 0,5° de inclinación lo conserva igual', () => {
    // un plano de 30 × 30 mm a 60 mm de un ancla fija; la inclinación gira el plano 0,5° alrededor del eje lateral
    const anchor: SpeckleAnchor = { e: [0, 1, 0], p: [0, 0, 0], parity: 0 };
    const corr = (st: StrongScatter): number => {
      const tilt = (0.5 * Math.PI) / 180;
      const a: number[] = [];
      const b: number[] = [];
      for (let i = 0; i < 60; i++)
        for (let j = 0; j < 60; j++) {
          const x = -15 + i * 0.5;
          const z = 45 + j * 0.5;
          const f0 = anchoredSliceField([x, 0, z], H, 1.8, SALT, anchor, st);
          const f1 = anchoredSliceField([x, z * Math.sin(tilt), z * Math.cos(tilt)], H, 1.8, SALT, anchor, st);
          a.push(Math.hypot(f0[0], f0[1]));
          b.push(Math.hypot(f1[0], f1[1]));
        }
      const ma = a.reduce((x, y) => x + y, 0) / a.length;
      const mb = b.reduce((x, y) => x + y, 0) / b.length;
      let sab = 0;
      let saa = 0;
      let sbb = 0;
      for (let k = 0; k < a.length; k++) {
        sab += (a[k] - ma) * (b[k] - mb);
        saa += (a[k] - ma) ** 2;
        sbb += (b[k] - mb) ** 2;
      }
      return sab / Math.sqrt(saa * sbb);
    };
    const plain = corr(NO_STRONG);
    const strong = corr(s);
    expect(plain).toBeGreaterThan(0.8);
    expect(Math.abs(strong - plain)).toBeLessThan(0.05);
  });

  it('la envolvente del hígado es pre-Rayleigh como la del hígado sano a 3,5 MHz: m en ventanas de 3 pulsos ÷ el del moteado difuso 0,74–0,92', () => {
    // gemelo B → C → D de una mirada sobre un plano de 48 líneas × 640 muestras (0,9 mm × 0,176 mm, ~43 × 113 mm) en
    // el hígado: tres planos de elevación (½ ¼ ¼), la densidad de dispersores del plano central, pulso de σ 0,30 mm y
    // PSF lateral de σ 0,8 mm (la de 60–100 mm), núcleos de energía unidad
    const ratio = windowedMRatio();
    expect(ratio.plain).toBeGreaterThan(1.2); // el estimador en ventanas pequeñas sobrestima m (pocos granos)
    expect(ratio.value).toBeGreaterThan(0.74);
    expect(ratio.value).toBeLessThan(0.92);
  });
});

describe('densidad de dispersores a escala de milímetros (decisión 89)', () => {
  it('solo en el hígado, simétrica en dB (mediana 0 dB, DE ≈1,85 dB) y continua (pendiente acotada por la célula)', () => {
    expect(DENSITY_TISSUES).toEqual([LIVER]);
    const r = rng(17);
    const db: number[] = [];
    let maxJump = 0;
    const N = 200_000;
    for (let i = 0; i < N; i++) {
      const m: Vec3 = [r() * 400 - 200, r() * 400 - 200, r() * 400 - 200];
      db.push(20 * Math.log10(densityGain(m, 3.3, LIVER)));
      if (i < 20_000) maxJump = Math.max(maxJump, Math.abs(densityDb([m[0] + 0.1, m[1], m[2]], 3.3) - densityDb(m, 3.3)));
      expect(densityGain(m, 3.3, Tissue.Muscle)).toBe(1);
    }
    db.sort((x, y) => x - y);
    expect(Math.abs(db[N >> 1])).toBeLessThan(0.15);
    const mean = db.reduce((x, y) => x + y, 0) / N;
    const sd = Math.sqrt(db.reduce((x, y) => x + (y - mean) ** 2, 0) / N);
    expect(sd).toBeGreaterThan(0.17 * DENSITY.scaleDb);
    expect(sd).toBeLessThan(0.2 * DENSITY.scaleDb);
    // La pendiente máxima del ruido de valor es 1,5 por célula; se conserva la guarda analítica.
    expect(maxJump).toBeLessThanOrEqual((DENSITY.scaleDb * 1.5 * 0.1) / DENSITY.cellMm + 1e-9);
    // anclada: el mismo punto material da lo mismo, y otra semilla del moteado, otra realización
    expect(densityGain([10, 20, 30], 3.3, LIVER)).toBe(densityGain([10, 20, 30], 3.3, LIVER));
    expect(densityGain([10, 20, 30], 4.7, LIVER)).not.toBe(densityGain([10, 20, 30], 3.3, LIVER));
  });
});

describe('GLSL de la textura del parénquima (decisión 89)', () => {
  it('la retícula de la anatomía elige los nodos fuertes y reparte su fase como el gemelo', () => {
    expect(ANATOMY_GLSL).toContain('bool strong = b >= 1.0 - s.x;');
    expect(ANATOMY_GLSL).toContain('float r = sqrt(-2.0 * log(max(1e-6, a))) * (strong ? s.y : s.z);');
    expect(ANATOMY_GLSL).toContain('float ph = 6.2831853 * (strong ? (b - (1.0 - s.x)) / s.x : b / (1.0 - s.x));');
    // con p = 0 la fase es b exacta: (b − 0)/(1 − 0)
    for (const b of [0, 1e-7, 0.123456, 0.5, 0.999999]) expect(strongNode(Math.fround(b), NO_STRONG)).toEqual([1, Math.fround(b)]);
    // sin dispersores fuertes, la llamada de siempre (el transitorio, la cola del gas y el deslizamiento)
    expect(ANATOMY_GLSL).toContain(
      'vec2 scattererField(vec3 m, float h, float salt) { return scattererFieldS(m, h, salt, vec3(0.0, 1.0, 1.0)); }',
    );
  });

  it('las constantes por tejido salen de TS en float32 exacto', () => {
    const s = strongScatter(LIVER);
    expect(SPECKLE_TISSUE_GLSL).toContain(`if (t == T_LIVER) return vec3(${s.map(glslFloat).join(', ')});`);
    for (const x of s) expect(Math.fround(Number(glslFloat(x)))).toBe(Math.fround(x));
    expect(SPECKLE_TISSUE_GLSL).toContain(
      `return pow(10.0, (valueNoise(m / ${glslFloat(DENSITY.cellMm)}, uSeed + ${glslFloat(DENSITY.salt)}) - 0.5) * ${glslFloat(DENSITY.scaleDb)} / 20.0);`,
    );
    expect(SPECKLE_TISSUE_GLSL).toContain('if (t != T_LIVER) return 1.0;');
    expect(TISSUES[LIVER].speckleClump ?? 0).toBe(0);
  });

  it('las dos mallas de la pasada B los aplican una vez: nodos fuertes en cada plano y densidad en el campo mezclado', () => {
    for (const frag of [FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED])
      expect(frag).toContain('vec2 f = speckleField(m, uLattice, se, float(tissue) * TISSUE_SALT_STEP, strongScatter(tissue));');
    expect(FRAG_RAWFIELD_STEERED).toContain(
      'vec2 f = speckleFieldPh(m, uLattice, se, float(tissue) * TISSUE_SALT_STEP, ph0, g, strongScatter(tissue));',
    );
    // mediumField (mirada 0, en la pleura) y mediumFieldPh (dirigida): la densidad tras los grumos, una sola vez
    expect(PLEURA_GLSL.match(/field \*= densityGain\(m, c\.tissue\);/g)).toHaveLength(1);
    expect(FRAG_RAWFIELD.match(/field \*= densityGain\(m, c\.tissue\);/g)).toHaveLength(1);
    expect(FRAG_RAWFIELD_STEERED.match(/field \*= densityGain\(m, c\.tissue\);/g)).toHaveLength(2);
    // la pared copiada de la serie de la pleura no es hígado: sin densidad
    const wall = PLEURA_GLSL.slice(PLEURA_GLSL.indexOf('vec2 wallField('));
    expect(wall).not.toContain('densityGain');
  });
});

/**
 * m de Nakagami (mediana en ventanas de 2,7 mm, ~3 longitudes de pulso) de la envolvente del gemelo con los dispersores
 * fuertes y la densidad del hígado, sobre el mismo estimador sin ellos.
 */
function windowedMRatio(): { value: number; plain: number } {
  const NU = 48;
  const NV = 640;
  const DX = 0.9;
  const DZ = 0.176;
  const SE = 1.8;
  const anchor: SpeckleAnchor = { e: [0, 1, 0], p: [0, 0, 0], parity: 0 };
  const m = (strong: StrongScatter, density: boolean): number => {
    const re = new Float64Array(NU * NV);
    const im = new Float64Array(NU * NV);
    for (let u = 0; u < NU; u++)
      for (let v = 0; v < NV; v++) {
        const p: Vec3 = [u * DX, 0, 40 + v * DZ];
        const f0 = anchoredSliceField(p, H, SE, SALT, anchor, strong);
        const f1 = anchoredSliceField([p[0], SE, p[2]], H, SE, SALT, anchor, strong);
        const f2 = anchoredSliceField([p[0], -SE, p[2]], H, SE, SALT, anchor, strong);
        const l0 = Math.hypot(f0[0], f0[1]);
        const side = 0.5 * l0 + 0.25 * (Math.hypot(f1[0], f1[1]) + Math.hypot(f2[0], f2[1]));
        const g = (l0 > 1e-9 ? side / l0 : 0) * (density ? densityGain(p, (1234 % 1000) / 7, LIVER) : 1);
        re[u * NV + v] = f0[0] * g;
        im[u * NV + v] = f0[1] * g;
      }
    const blur = (a: Float64Array, along: 'v' | 'u', sigma: number): Float64Array => {
      const R = Math.ceil(2.5 * sigma);
      const k = Array.from({ length: 2 * R + 1 }, (_, j) => Math.exp(-0.5 * ((j - R) / sigma) ** 2));
      const nk = Math.hypot(...k);
      const out = new Float64Array(a.length);
      for (let u = 0; u < NU; u++)
        for (let v = 0; v < NV; v++) {
          let acc = 0;
          for (let j = -R; j <= R; j++) {
            const uu = along === 'u' ? Math.min(NU - 1, Math.max(0, u + j)) : u;
            const vv = along === 'v' ? Math.min(NV - 1, Math.max(0, v + j)) : v;
            acc += k[j + R] * a[uu * NV + vv];
          }
          out[u * NV + v] = acc / nk;
        }
      return out;
    };
    const fr = blur(blur(re, 'v', 0.3 / DZ), 'u', 0.8 / DX);
    const fi = blur(blur(im, 'v', 0.3 / DZ), 'u', 0.8 / DX);
    const wv = Math.round(2.7 / DZ);
    const wu = Math.round(2.7 / DX);
    const ms: number[] = [];
    for (let u0 = 2; u0 + wu <= NU - 2; u0 += wu)
      for (let v0 = 10; v0 + wv <= NV - 10; v0 += wv) {
        let s2 = 0;
        let s4 = 0;
        let n = 0;
        for (let u = u0; u < u0 + wu; u++)
          for (let v = v0; v < v0 + wv; v++) {
            const x2 = fr[u * NV + v] ** 2 + fi[u * NV + v] ** 2;
            s2 += x2;
            s4 += x2 * x2;
            n++;
          }
        s2 /= n;
        s4 /= n;
        ms.push((s2 * s2) / (s4 - s2 * s2));
      }
    ms.sort((x, y) => x - y);
    return ms[ms.length >> 1];
  };
  const plain = m(NO_STRONG, false);
  return { value: m(strongScatter(LIVER), true) / plain, plain };
}
