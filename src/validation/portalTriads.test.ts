import { describe, expect, it } from 'vitest';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene } from '../anatomy/scene';
import { Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import { PhysiologyEngine } from '../physiology/engine';
import { clonePatient } from '../physiology/patientState';
import {
  PORTAL_TRIADS,
  PORTAL_TRIADS_GLSL,
  TRIAD_QUERY_BEAM,
  cellRandoms,
  pcg3d,
  portalTriadGain,
  sheathGainAt,
  triadOfCell,
  type Triad,
} from '../ultrasound/portalTriads';
import { FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED, FRAG_TRIAD_QUERY } from '../ultrasound/shaders/passes.glsl';

/**
 * Tríadas portales finas (decisión 78): segmentos con vaina brillante y luz diminuta, anclados al material, una como
 * mucho por célula y orientados hacia el hilio. Se comprueban la geometría (cada tríada cabe en media célula, así que
 * bastan las 8 células vecinas), la densidad y la orientación en la anatomía real, y que la pasada B lleva la misma
 * fórmula en los dos programas.
 */
const patient = clonePatient(NORMAL_ADULT);
const scene = new AnatomyScene(patient);
const caliber = new AnatomyQuery(scene).caliberFor(new PhysiologyEngine(patient, scene.vesselAreas()).sample);
const isLiver = (m: Vec3) => scene.classify(m, caliber).tissue === Tissue.Liver;

/** Generador de 32 bits (mulberry32): reproducible y sin la pérdida de precisión de un congruencial en doble. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Tríadas portales finas (decisión 78)', () => {
  const P = PORTAL_TRIADS;

  it('cada tríada cabe en media célula alrededor de su centro: las 8 células vecinas dan lo mismo que las 64', () => {
    expect(P.halfLengthMm[1] + P.radiusMm[1] + P.edgeMm).toBeLessThanOrEqual(P.cellMm / 2);
    const r = rng(1);
    for (let i = 0; i < 4000; i++) {
      const m: Vec3 = [-160 + 220 * r(), -100 + 200 * r(), -120 + 160 * r()];
      expect(portalTriadGain(m)).toBe(portalTriadGain(m, TRIAD_QUERY_BEAM, 2));
    }
    // y en puntos pegados a tríadas (donde el factor no es 1)
    let near = 0;
    for (let cx = -8; cx < 4; cx++)
      for (let cy = -6; cy < 6; cy++) {
        const t = triadOfCell([cx, cy, -3]);
        if (!t) continue;
        for (const k of [-1, -0.5, 0, 0.5, 1]) {
          const m: Vec3 = [0, 1, 2].map((a) => t.center[a] + t.dir[a] * k * t.halfLength + (a === 0 ? t.radius * 0.8 : 0)) as Vec3;
          expect(portalTriadGain(m)).toBe(portalTriadGain(m, TRIAD_QUERY_BEAM, 2));
          near++;
        }
      }
    expect(near).toBeGreaterThan(100);
  });

  it('vaina brillante, luz de sangre y bordes suaves; 1 fuera de ellas', () => {
    let lumenSeen = 0;
    let triads = 0;
    let outside = 0;
    for (let cx = -8; cx < 8; cx++)
      for (let cy = -8; cy < 8; cy++) {
        const t = triadOfCell([cx, cy, 1]);
        if (!t) continue;
        expect(t.gain).toBeGreaterThanOrEqual(P.sheathGain[0]);
        expect(t.gain).toBeLessThanOrEqual(P.sheathGain[1]);
        // en el centro: la luz si la hay; si no, la vaina
        const g0 = portalTriadGain(t.center, TRIAD_QUERY_BEAM, 2);
        if (t.lumen > P.edgeMm) {
          expect(g0).toBeCloseTo(P.lumenGain, 6);
          lumenSeen++;
        } else expect(g0).toBeGreaterThan(1.5);
        // perfil radial continuo: sin saltos de más de un 25 % del contraste por 0,02 mm
        const side = Math.abs(t.dir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        const n = [
          t.dir[1] * side[2] - t.dir[2] * side[1],
          t.dir[2] * side[0] - t.dir[0] * side[2],
          t.dir[0] * side[1] - t.dir[1] * side[0],
        ];
        const nl = Math.hypot(n[0], n[1], n[2]);
        let prev = g0;
        for (let d = 0.02; d < t.radius + 2 * P.edgeMm; d += 0.02) {
          const m = [0, 1, 2].map((a) => t.center[a] + (n[a] / nl) * d) as Vec3;
          const g = portalTriadGain(m, TRIAD_QUERY_BEAM, 2);
          expect(Math.abs(g - prev)).toBeLessThan(0.25 * (t.gain - P.lumenGain));
          prev = g;
        }
        // fuera de su vaina el factor vuelve a 1, salvo si otra tríada la toca
        triads++;
        if (prev === 1) outside++;
      }
    expect(lumenSeen).toBeGreaterThan(20);
    expect(outside / triads).toBeGreaterThan(0.9);
  });

  it('en el hígado real: ~1 % del volumen, 0,2–0,5 tríadas por cm² en un corte de 3 mm y orientadas hacia el hilio', () => {
    const r = rng(7);
    let liver = 0;
    let sheath = 0;
    for (let i = 0; i < 120_000; i++) {
      const m: Vec3 = [-160 + 220 * r(), -100 + 200 * r(), -120 + 160 * r()];
      if (!isLiver(m)) continue;
      liver++;
      if (portalTriadGain(m) > 1.5) sheath++;
    }
    expect(liver).toBeGreaterThan(20_000);
    expect(sheath / liver).toBeGreaterThan(0.004);
    expect(sheath / liver).toBeLessThan(0.012);
    // corte axial de 3 mm a z = −30: tríadas cuyo segmento lo corta, por cm² de hígado
    const z0 = -30;
    let area = 0;
    for (let x = -160; x < 60; x += 2) for (let y = -100; y < 100; y += 2) if (isLiver([x, y, z0])) area += 4;
    let hits = 0;
    let radial = 0;
    let n = 0;
    const C = P.cellMm;
    for (let cx = -15; cx <= 6; cx++)
      for (let cy = -9; cy <= 9; cy++)
        for (let cz = Math.floor(z0 / C) - 1; cz <= Math.floor(z0 / C) + 1; cz++) {
          const t = triadOfCell([cx, cy, cz]);
          if (!t || !isLiver(t.center)) continue;
          const rad = [0, 1, 2].map((a) => t.center[a] - P.hilum[a]);
          radial += Math.abs(t.dir[0] * rad[0] + t.dir[1] * rad[1] + t.dir[2] * rad[2]) / Math.hypot(rad[0], rad[1], rad[2]);
          n++;
          const zA = t.center[2] - t.dir[2] * t.halfLength;
          const zB = t.center[2] + t.dir[2] * t.halfLength;
          if (Math.min(zA, zB) - t.radius < z0 + 1.5 && Math.max(zA, zB) + t.radius > z0 - 1.5) hits++;
        }
    const perCm2 = hits / (area / 100);
    expect(perCm2).toBeGreaterThan(0.2);
    expect(perCm2).toBeLessThan(0.5);
    expect(radial / n).toBeGreaterThan(0.6);
  });

  it('el hash es entero y sin simetrías: cada célula y cada parámetro, su número; la GPU recibe los mismos', () => {
    // PCG3D por componentes con aritmética de 32 bits sin signo (el gemelo exacto de uvec3 en GLSL)
    const [x, y, z] = pcg3d(0, 0, 0);
    expect([x, y, z].every((v) => Number.isInteger(v) && v >= 0 && v < 2 ** 32)).toBe(true);
    // las células espejo (a, b) y (b, a) ya no comparten números (con el hash del moteado compartían 3 de 4)
    let shared = 0;
    let pairs = 0;
    for (let a = -6; a < 6; a++)
      for (let b = a + 1; b < 6; b++) {
        const ra = cellRandoms([a, b, 2]);
        const rb = cellRandoms([b, a, 2]);
        shared += ra.filter((v, i) => v === rb[i]).length;
        pairs++;
      }
    expect(shared / pairs).toBeLessThan(0.01);
    // números de 24 bits: múltiplos exactos de 2⁻²⁴, representables sin redondeo en float32
    for (const v of cellRandoms([3, -7, 11])) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(Number.isInteger(v * 16777216)).toBe(true);
      expect(Math.fround(v)).toBe(v);
    }
    // cada parámetro de la tríada sale de su propio número: sin correlación entre ellos
    const L: number[] = [];
    const R: number[] = [];
    const G: number[] = [];
    for (let cx = -10; cx < 10; cx++)
      for (let cy = -10; cy < 10; cy++) {
        const t = triadOfCell([cx, cy, 0]);
        if (!t) continue;
        L.push(t.halfLength);
        R.push(t.radius);
        G.push(t.gain);
      }
    const corr = (a: number[], b: number[]) => {
      const ma = a.reduce((u, v) => u + v, 0) / a.length;
      const mb = b.reduce((u, v) => u + v, 0) / b.length;
      let sab = 0;
      let saa = 0;
      let sbb = 0;
      a.forEach((v, i) => {
        sab += (v - ma) * (b[i] - mb);
        saa += (v - ma) ** 2;
        sbb += (b[i] - mb) ** 2;
      });
      return sab / Math.sqrt(saa * sbb);
    };
    expect(L.length).toBeGreaterThan(200);
    expect(Math.abs(corr(L, R))).toBeLessThan(0.15);
    expect(Math.abs(corr(L, G))).toBeLessThan(0.15);
    expect(Math.abs(corr(R, G))).toBeLessThan(0.15);
  });

  it('la pasada B lleva la misma fórmula, con las constantes de TS, y la aplica solo al hígado', () => {
    for (const frag of [FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED]) {
      expect(frag).toContain(PORTAL_TRIADS_GLSL);
      // una llamada por programa de campo (fieldFor; el dirigido también fieldForPh) y siempre tras T_LIVER, con el haz
      // en el punto (decisión 89): la radial de la mirada 0 y la dirección de la mirada en el dirigido
      const calls = frag.match(/portalTriad\(/g)?.length ?? 0;
      const guarded = frag.match(/if \(tissue == T_LIVER\) het \*= portalTriad\(m, [^;]+\);/g)?.length ?? 0;
      expect(calls - 1).toBe(guarded); // − la definición
      expect(frag).toContain('if (tissue == T_LIVER) het *= portalTriad(m, dir);');
    }
    expect(FRAG_RAWFIELD_STEERED).toContain('if (tissue == T_LIVER) het *= portalTriad(m, normalize(b0 + g / lookK2));');
    expect(FRAG_RAWFIELD_STEERED.match(/if \(tissue == T_LIVER\) het \*= portalTriad\(m, [^;]+\);/g)).toHaveLength(2);
    // las constantes salen de PORTAL_TRIADS, no de literales escritos a mano
    const P = PORTAL_TRIADS;
    expect(PORTAL_TRIADS_GLSL).toContain(`const float TRIAD_CELL = ${P.cellMm.toFixed(4)};`);
    expect(PORTAL_TRIADS_GLSL).toContain(`const float TRIAD_PRESENCE = ${P.presence.toFixed(4)};`);
    expect(PORTAL_TRIADS_GLSL).toContain(`const vec2 TRIAD_GAIN = vec2(${P.sheathGain[0].toFixed(4)}, ${P.sheathGain[1].toFixed(4)});`);
    expect(PORTAL_TRIADS_GLSL).toContain(`const int TRIAD_OFFSET = ${P.cellOffset};`);
    expect(PORTAL_TRIADS_GLSL).toContain(`const uint TRIAD_SALT = ${P.salt >>> 0}u;`);
    // el mismo hash y el mismo reparto de números por parámetro que cellRandoms/triadOfCell
    expect(PORTAL_TRIADS_GLSL).toContain('v = v * 1664525u + 1013904223u;');
    expect(PORTAL_TRIADS_GLSL).toContain('vec3 triadUnit(uvec3 h) { return vec3(h >> 8u) / 16777216.0; }');
    for (const k of [1, 2, 3, 4])
      expect(PORTAL_TRIADS_GLSL).toContain(`triadPcg(b + uvec3(0u, 0u, ${k === 1 ? '' : `${k}u * `}TRIAD_SALT))`);
    expect(PORTAL_TRIADS_GLSL).toContain('vec3 ctr = (c + vec3(r1.y, r1.z, r2.x)) * TRIAD_CELL;');
    expect(PORTAL_TRIADS_GLSL).toContain('return mix(sheath, TRIAD_LUMEN_GAIN, lumen);');
    // el brillo de la vaina (decisión 89): la cola de ganancias y la parte especular con el haz, las de sheathGainAt
    expect(PORTAL_TRIADS_GLSL).toContain(`const float TRIAD_SPEC_FLOOR = ${P.specularFloor.toFixed(4)};`);
    expect(PORTAL_TRIADS_GLSL).toContain('float G = mix(TRIAD_GAIN.x, TRIAD_GAIN.y, r3.y * r3.y);');
    expect(PORTAL_TRIADS_GLSL).not.toContain('pow(');
    expect(PORTAL_TRIADS_GLSL).toContain('float Gb = (G - 1.0) * (TRIAD_SPEC_FLOOR + (1.0 - TRIAD_SPEC_FLOOR) * s2 * s2);');
    expect(PORTAL_TRIADS_GLSL).toContain('float cb = dot(d, beam);');
    // y la GPU la compara punto a punto con el gemelo en la e2e (`triadParity`)
  });
});

/**
 * Eco de la vaina (decisión 89): el juez ciego vio las tríadas como «elipses lisas sin moteado dentro, todas del mismo
 * brillo». Ahora el brillo tiene cola (muchas tenues, pocas brillantes) y es en parte especular: de través brillan más que
 * a lo largo del haz, con la ley |cos θ|⁴ de las láminas de la pared.
 */
describe('Brillo de la vaina de las tríadas (decisión 89)', () => {
  const P = PORTAL_TRIADS;
  const triads: Triad[] = [];
  for (let cx = -20; cx <= 20; cx++)
    for (let cy = -20; cy <= 20; cy++)
      for (let cz = -6; cz <= 6; cz++) {
        const t = triadOfCell([cx, cy, cz]);
        if (t) triads.push(t);
      }

  it('la ganancia de través tiene cola: entre sus dos extremos, con la mediana a un cuarto del intervalo', () => {
    expect(triads.length).toBeGreaterThan(10_000);
    const g = triads.map((t) => t.gain).sort((a, b) => a - b);
    expect(g[0]).toBeGreaterThanOrEqual(P.sheathGain[0]);
    expect(g[g.length - 1]).toBeLessThanOrEqual(P.sheathGain[1]);
    const span = P.sheathGain[1] - P.sheathGain[0];
    // con la potencia 2 del número uniforme: mediana a (½)² = ¼ del intervalo y media a ⅓
    expect((g[g.length >> 1] - P.sheathGain[0]) / span).toBeCloseTo(0.25, 1);
    const mean = g.reduce((a, b) => a + b, 0) / g.length;
    expect((mean - P.sheathGain[0]) / span).toBeCloseTo(1 / 3, 1);
    // pocas brillantes: con g > 8, 1 − √((8 − 3)/7) ≈ 15 %
    const bright = g.filter((x) => x > 8).length / g.length;
    expect(bright).toBeGreaterThan(0.1);
    expect(bright).toBeLessThan(0.2);
  });

  it('en parte especular: la ganancia entera de través, 1 + ε·(G − 1) a lo largo del haz, y monótona entre las dos', () => {
    const t = triads[0];
    const d = t.dir;
    // una perpendicular al eje
    const a: Vec3 = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const n: Vec3 = [d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]];
    const nl = Math.hypot(n[0], n[1], n[2]);
    const perp: Vec3 = [n[0] / nl, n[1] / nl, n[2] / nl];
    expect(sheathGainAt(t, perp)).toBeCloseTo(t.gain, 12);
    expect(sheathGainAt(t, d)).toBeCloseTo(1 + P.specularFloor * (t.gain - 1), 12);
    let prev = Infinity;
    for (let k = 0; k <= 10; k++) {
      const c = k / 10;
      const b: Vec3 = [0, 1, 2].map((i) => c * d[i] + Math.sqrt(1 - c * c) * perp[i]) as Vec3;
      const g = sheathGainAt(t, b);
      expect(g).toBeLessThanOrEqual(prev + 1e-12);
      prev = g;
    }
    // en el centro de la vaina, la ganancia de la tríada con el haz de través supera a la de a lo largo
    const inSheath: Vec3 = [0, 1, 2].map((i) => t.center[i] + perp[i] * 0.5 * t.radius) as Vec3;
    if (t.lumen === 0) expect(portalTriadGain(inSheath, perp)).toBeGreaterThan(portalTriadGain(inSheath, d));
  });

  it('la consulta de la e2e evalúa el brillo con un haz fijo y unitario, el mismo en la GPU', () => {
    expect(Math.hypot(...TRIAD_QUERY_BEAM)).toBeCloseTo(1, 7);
    expect(FRAG_TRIAD_QUERY).toContain(`portalTriad(m, vec3(${TRIAD_QUERY_BEAM.join(', ')}))`);
  });
});
