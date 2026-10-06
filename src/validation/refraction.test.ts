import { describe, expect, it } from 'vitest';
import { TISSUES, Tissue } from '../anatomy/tissues';
import {
  REFRACTION_DIFFRACTION,
  REFRACTION_GLSL,
  REFRACTION_SEARCH_FAR,
  REFRACTION_SEARCH_LINES,
  REFRACTION_SPOT,
  REFRACTION_TAPS,
  refractionBeam,
  type ApertureGeometry,
} from '../ultrasound/aperture';
import { CONVEX_BEAM } from '../ultrasound/beamModel';
import { lookTheta } from '../ultrasound/compound';
import {
  FRAG_TRANSMISSION,
  FRAG_TRANSMISSION_STEERED,
  FRAG_TRANS_PREFIX,
  FRAG_TRANS_PREFIX_STEERED,
  FRAG_TRANS_SEGMENTS,
} from '../ultrasound/shaders/passes.glsl';
import { CONVEX_C35_PROFILE, bmodeBeam } from '../ultrasound/transducerProfile';
import { STEERED_PREFIX_GLSL, lumenExcessGlsl, lumenExcessPerMm, type SegmentGrid } from '../ultrasound/transmission';
import { refractionGain, refractionPsi, refractionSlope, steeredPrefixDb } from '../ultrasound/transmissionTwin';
import { REFRACTION_BENCH } from './support/refractionBench';
import { GRID_GEOMETRY, gridLineAngle, segmentGridFromScene, type GridGeometry } from './support/segmentGrid';

/**
 * Refracción en las luces líquidas (decisión 86): pantalla de fase de la sangre y la bilis, lente delgada paraxial y
 * eco de moteado de un haz enfocado cuyos rayos desvía (el solape de los conos de emisión y de recepción). Escenas 2D
 * sobre la rejilla de la pasada A con los gemelos de producción, y el banco de ondas en geometría plana.
 */
const G = GRID_GEOMETRY;
const F = CONVEX_C35_PROFILE.bEffectiveMHz;
const db = (x: number): number => 20 * Math.log10(x);

/** La geometría de la pasada A con el haz de la imagen B en fundamental, foco `focusMm`. */
function sectorAp(g: GridGeometry = G, focusMm = 90): ApertureGeometry {
  const beam = bmodeBeam(CONVEX_C35_PROFILE, { harmonic: false });
  return {
    lines: g.lines,
    halfSector: g.halfSector,
    curvatureRadius: g.curvatureRadius,
    apertureTxMm: 26,
    apertureRxMaxMm: CONVEX_BEAM.apertureRxMaxMm,
    fNumberRxMin: CONVEX_BEAM.fNumberRxMin,
    refraction: refractionBeam(beam, focusMm),
  };
}

/** La ganancia de la mirada 0 en la fila k de la rejilla, con Ψ̃ y su pendiente de las filas k y k − 1. */
function look0Gain(grid: SegmentGrid, ap: ApertureGeometry, l: number, k: number): number {
  const psi = (m: number, j: number) => refractionPsi(grid, ap.curvatureRadius, m, j);
  return refractionGain(ap, grid.stepMm, l, k, (m) => ({ psi: psi(m, k), slope: refractionSlope(grid, ap.curvatureRadius, m, k) }));
}

/** Ganancia (dB) en todas las líneas de la fila de profundidad r, tras una luz circular de radio a en z0. */
function lensRow(tissue: Tissue, a: number, z0: number, r: number): { gainDb: number[]; x: number[]; lensDist: number[] } {
  const g = segmentGridFromScene((x, z) => (Math.hypot(x, z - z0) < a ? tissue : Tissue.Liver), F);
  const k = Math.round(r / g.stepMm - 0.5);
  const rr = (k + 0.5) * g.stepMm;
  const ap = sectorAp();
  // las líneas que cruzan la luz por encima de la fila k (Ψ̃ > 0) y la distancia de cada línea a la más cercana
  const lens = Array.from({ length: G.lines }, (_, l) => refractionPsi(g, G.curvatureRadius, l, k) > 0);
  return {
    gainDb: Array.from({ length: G.lines }, (_, l) => db(look0Gain(g, ap, l, k))),
    x: Array.from({ length: G.lines }, (_, l) => (G.curvatureRadius + rr) * Math.sin(gridLineAngle(l))),
    lensDist: Array.from({ length: G.lines }, (_, l) => Math.min(...lens.map((on, m) => (on ? Math.abs(m - l) : Infinity)))),
  };
}

describe('refracción en las luces líquidas (decisión 86)', () => {
  it('el camino de más sale de la c de TISSUES: sangre y bilis, frente al hígado que las rodea; nada más refracta', () => {
    expect(lumenExcessPerMm(Tissue.Blood)).toBeCloseTo(TISSUES[Tissue.Liver].c / TISSUES[Tissue.Blood].c - 1, 15);
    expect(lumenExcessPerMm(Tissue.Fluid)).toBeCloseTo(TISSUES[Tissue.Liver].c / TISSUES[Tissue.Fluid].c - 1, 15);
    // la sangre apenas (0,5 %: 1578 frente a 1586 m/s); la bilis de la tabla, 7 % (agua a 20 °C: ver LIMITATIONS)
    expect(lumenExcessPerMm(Tissue.Blood)).toBeGreaterThan(0.004);
    expect(lumenExcessPerMm(Tissue.Blood)).toBeLessThan(0.006);
    expect(lumenExcessPerMm(Tissue.Fluid)).toBeGreaterThan(0.06);
    for (const t of [
      Tissue.Liver,
      Tissue.VesselWallThin,
      Tissue.BileDuctWall,
      Tissue.Fat,
      Tissue.PerirenalFat,
      Tissue.RenalPelvis,
      Tissue.Air,
      Tissue.Bone,
    ])
      expect(lumenExcessPerMm(t), TISSUES[t].name).toBe(0);
    // A1 lleva las mismas constantes
    const glsl = lumenExcessGlsl('t');
    expect(glsl).toContain(`t == T_BLOOD ? ${lumenExcessPerMm(Tissue.Blood)}`);
    expect(glsl).toContain(`t == T_FLUID ? ${lumenExcessPerMm(Tissue.Fluid)}`);
  });

  it('sin luces la ganancia es 1 exacto, también junto a los bordes del sector', () => {
    const g = segmentGridFromScene(() => Tissue.Liver, F);
    const ap = sectorAp();
    for (const l of [0, 1, 5, 96, 186, 190, 191]) for (const k of [0, 1, 40, 159]) expect(look0Gain(g, ap, l, k)).toBe(1);
  });

  // una vesícula y una vena bajo el gel (el aire de las primeras filas)
  const lensScene = () =>
    segmentGridFromScene(
      (x, z) =>
        Math.hypot(x, z - 70) < 12 ? Tissue.Fluid : Math.hypot(x + 25, z - 110) < 8 ? Tissue.Blood : z < 3 ? Tissue.Air : Tissue.Liver,
      F,
    );

  it('Ψ̃ de la mirada 0 es la del prefijo dirigido con θ = 0, bit a bit, y crece con la distancia tras la luz', () => {
    const g = lensScene();
    const psi = (l: number, j: number) => refractionPsi(g, G.curvatureRadius, l, j);
    for (let l = 0; l < G.lines; l += 5)
      for (let k = 0; k < G.rows; k += 7) {
        const p = steeredPrefixDb(g, G, 0, l, k);
        expect(p.psi, `línea ${l}, fila ${k}`).toBe(psi(l, k));
        // la pendiente del camino es la de la mirada 0, bit a bit, y la de sus filas k y k − 1 (salvo el redondeo)
        expect(p.slope, `línea ${l}, fila ${k}`).toBe(refractionSlope(g, G.curvatureRadius, l, k));
        if (k > 0) expect(Math.abs(p.slope - (psi(l, k) - psi(l, k - 1)) / g.stepMm), `línea ${l}, fila ${k}`).toBeLessThan(1e-12);
      }
    // tras la luz Ψ̃ crece con pendiente Σe/(R + r): Ψ̃/(dΨ̃/dr) es la distancia a la luz (a su centroide)
    const center = 96;
    const step = g.stepMm;
    const kLens = Math.round(70 / step - 0.5);
    for (const behind of [20, 40, 80]) {
      const k = kLens + Math.round(behind / step);
      const d = psi(center, k) / refractionSlope(g, G.curvatureRadius, center, k);
      expect(Math.abs(d - (k - kLens) * step), `${behind} mm`).toBeLessThan(1.5 * step);
    }
  });

  it('la distancia a la luz no depende de un redondeo: Ψ̃ es 0 exacto en la primera fila de la luz, y la dirigida usa la pendiente de su camino', () => {
    const g = lensScene();
    const R = G.curvatureRadius;
    // En la primera fila de una luz, Ψ̃ = 0 exacto (su término pesa k − s = 0): con la forma r_k·Σe/(R + r) − Σe·r/(R + r),
    // la GPU dejaba ahí un residuo de ±10⁻⁹ mm y la distancia a la luz saltaba de 0 a un paso
    let firsts = 0;
    for (let l = 0; l < G.lines; l++) {
      let k0 = 0;
      while (k0 < G.rows && g.excess[l * G.rows + k0] === 0) k0++;
      if (k0 === G.rows) continue;
      firsts++;
      expect(refractionPsi(g, R, l, k0), `línea ${l}`).toBe(0);
      expect(steeredPrefixDb(g, G, 0, l, k0).slope, `línea ${l}`).toBe(0);
    }
    expect(firsts).toBeGreaterThan(20);
    // Miradas dirigidas: los caminos de las filas k y k − 1 cruzan líneas distintas y la diferencia de sus Ψ̃ no es la
    // pendiente (sale ≤ 0 tras la luz); con la del propio camino, 0 ≤ D ≤ r en todas las muestras
    for (const look of [1, 2]) {
      const th = lookTheta(look);
      let behind = 0;
      let badRows = 0;
      for (let l = 0; l < G.lines; l += 3)
        for (let k = 1; k < G.rows; k++) {
          const p = steeredPrefixDb(g, G, th, l, k);
          if (!(p.psi > 0)) continue;
          behind++;
          const D = p.psi / p.slope;
          expect(D, `mirada ${look}, línea ${l}, fila ${k}`).toBeGreaterThanOrEqual(0);
          expect(D, `mirada ${look}, línea ${l}, fila ${k}`).toBeLessThanOrEqual((k + 0.5) * g.stepMm);
          if (!(p.psi - steeredPrefixDb(g, G, th, l, k - 1).psi > 0)) badRows++;
        }
      expect(behind, `mirada ${look}`).toBeGreaterThan(1000);
      expect(badRows, `mirada ${look}`).toBeGreaterThan(0);
    }
  });

  it('frente al banco de ondas (haz enfocado, ∫I_tx·I_rx): la sombra del borde de la vesícula, su centro y los vasos', () => {
    // la geometría plana del banco (líneas de 0,8 mm) con su haz: emisión de 26 mm con Hann (k_tx 2,0) y foco F,
    // recepción uniforme (k 1,3) de min(26, r/2,5) mm, λ = c_hígado/3,5 MHz
    const p = 0.8;
    const R = 1e6;
    const lines = 256;
    const flat: GridGeometry = { lines, rows: 160, depthMm: 180, curvatureRadius: R, halfSector: (lines * p) / (2 * R) };
    const lambda = TISSUES[Tissue.Liver].c / 3.5e3;
    let sum = 0;
    let n = 0;
    for (const c of REFRACTION_BENCH) {
      const tissue = c.tissue === 'bile' ? Tissue.Fluid : Tissue.Blood;
      const g = segmentGridFromScene((x, z) => (Math.hypot(x, z - c.z0) < c.a ? tissue : Tissue.Liver), 2.5, flat);
      const k = Math.round((c.z0 + c.a + c.behind) / g.stepMm - 0.5);
      const ap: ApertureGeometry = {
        lines,
        halfSector: flat.halfSector,
        curvatureRadius: R,
        apertureTxMm: 26,
        apertureRxMaxMm: 26,
        fNumberRxMin: 2.5,
        refraction: {
          focusMm: c.focus,
          txScale: 1,
          cTxMm: REFRACTION_SPOT * 2.0 * lambda,
          cRxMm: REFRACTION_SPOT * 1.3 * lambda,
          kappaTx: 0,
          kappaRx: 0,
          diffractionMm: REFRACTION_DIFFRACTION * 2 * lambda,
        },
      };
      // el perfil del banco en el centro de cada línea (interpolado), desde el eje hasta su final
      const bench = (x: number): number => {
        const i = Math.min(c.db.length - 2, Math.floor(x / p));
        const t = x / p - i;
        return c.db[i] * (1 - t) + c.db[i + 1] * t;
      };
      const rows: { x: number; bench: number; model: number }[] = [];
      for (let l = lines / 2; (l + 0.5 - lines / 2) * p <= (c.db.length - 1) * p; l++) {
        const x = (l + 0.5 - lines / 2) * p;
        rows.push({ x, bench: bench(x), model: db(look0Gain(g, ap, l, k)) });
      }
      const err = rows.reduce((s, q) => s + Math.abs(q.model - q.bench), 0) / rows.length;
      sum += err * rows.length;
      n += rows.length;
      const minB = Math.min(...rows.map((q) => q.bench));
      const minM = Math.min(...rows.map((q) => q.model));
      const tag = `${c.id} (${c.tissue} a ${c.a}, ${c.behind} mm tras la luz, foco ${c.focus}): banco ${minB.toFixed(1)} / modelo ${minM.toFixed(1)} dB, centro ${rows[0].bench.toFixed(1)} / ${rows[0].model.toFixed(1)}, error medio ${err.toFixed(2)}`;
      if (c.tissue === 'bile') {
        // la sombra del borde: −7 a −9 dB en el banco (6–8 mm de ancho, centrada en el borde); el modelo, algo menos honda
        // y de fondo más ancho hacia dentro
        expect(Math.abs(minM - minB), tag).toBeLessThan(2.5);
        const atEdge = rows.reduce((b, q) => (Math.abs(q.x - c.a) < Math.abs(b.x - c.a) ? q : b));
        expect(Math.abs(atEdge.model - atEdge.bench), tag).toBeLessThan(2.5);
        // el centro: ningún foco (el banco, de −2,6 a +1 dB según el foco); el modelo, hasta 3,3 dB más oscuro
        expect(rows[0].model, tag).toBeLessThan(0.5);
        expect(Math.abs(rows[0].model - rows[0].bench), tag).toBeLessThan(3.5);
        expect(err, tag).toBeLessThan(1.5);
      } else {
        // tras un vaso casi nada (la sangre refracta 14 veces menos que la bilis de la tabla)
        expect(minM, tag).toBeGreaterThan(-1.2);
        expect(err, tag).toBeLessThan(0.5);
      }
    }
    expect(sum / n).toBeLessThan(0.8);
  });

  it('en el sector: la vesícula oscurece sus bordes más que su centro; una vena, casi nada; lejos de las luces, 1', () => {
    for (const behind of [20, 40]) {
      const { gainDb, x, lensDist } = lensRow(Tissue.Fluid, 14.5, 60, 60 + 14.5 + behind);
      const edge = gainDb.filter((_, l) => Math.abs(Math.abs(x[l]) - 14.5) < 3);
      const center = gainDb.filter((_, l) => Math.abs(x[l]) < 3);
      const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
      const tag = `${behind} mm: borde ${Math.min(...edge).toFixed(1)}, centro ${mean(center).toFixed(1)} dB`;
      expect(Math.min(...edge), tag).toBeLessThan(-4);
      expect(Math.min(...edge), tag).toBeGreaterThan(-12);
      expect(Math.min(...edge), tag).toBeLessThan(mean(center) - 1.5);
      // la sombra se extiende fuera de las líneas que cruzan la luz y decae hacia fuera, sin el escalón que dejaba cortar
      // la búsqueda en ±REFRACTION_SEARCH_LINES; más allá de su alcance, 1 exacto
      expect(Math.min(...gainDb.filter((_, l) => lensDist[l] > 0)), tag).toBeLessThan(-1);
      expect(Math.min(...gainDb.filter((_, l) => lensDist[l] > REFRACTION_SEARCH_LINES + 2)), tag).toBeGreaterThan(-1);
      for (let l = 1; l < G.lines; l++)
        if (Math.min(lensDist[l], lensDist[l - 1]) >= REFRACTION_SEARCH_LINES - 1)
          expect(Math.abs(gainDb[l] - gainDb[l - 1]), `${tag}, línea ${l}`).toBeLessThan(1);
      expect(
        gainDb.filter((_, l) => lensDist[l] > REFRACTION_SEARCH_FAR).every((v) => v === 0),
        tag,
      ).toBe(true);
    }
    for (const behind of [20, 40, 60]) {
      const { gainDb } = lensRow(Tissue.Blood, 10, 90, 90 + 10 + behind);
      expect(Math.min(...gainDb), `vena, ${behind} mm`).toBeGreaterThan(-1.5);
      expect(Math.max(...gainDb), `vena, ${behind} mm`).toBeLessThan(0.5);
    }
  });

  it('la GLSL: A1 escribe el camino de más y el aire en negativo, A2 acumula Ψ̃ y A multiplica su transmisión con apertura', () => {
    // A1: el aire con el dB en negativo (el gel previo), el camino de más en .y
    expect(FRAG_TRANS_SEGMENTS).toContain(`oSeg = vec4(c.tissue == T_AIR ? -db : db, ${lumenExcessGlsl('c.tissue')} * step,`);
    // A2 de la mirada 0 y su gemelo dirigido: Σe·(k − s)/(R + r), sin cancelación, con Ψ̃ en o1.x y en o3.z y la pendiente
    // del camino dirigido en o3.w
    for (const src of [FRAG_TRANS_PREFIX, FRAG_TRANS_PREFIX_STEERED]) {
      expect(src).toContain('if (g.x < 0.0 && !entered) continue;');
      expect(src).toContain('psi += e * float(k - s);');
      // y en .z, lo que cobra el hueso (decisión 88: la fracción del haz que sobrevive a los huesos, que lee la pasada D)
      expect(src).toContain('o1 = vec4(step * psi, pa, boneDb, dopplerDb);');
    }
    expect(STEERED_PREFIX_GLSL).toContain('float e = g.y * scale / (uCurvR + rS);');
    expect(STEERED_PREFIX_GLSL).toContain('psi += e * float(k - s);');
    expect(STEERED_PREFIX_GLSL).toContain('if (s < k) pa += e;');
    expect(STEERED_PREFIX_GLSL).toContain('step * psi, pa);');
    expect(FRAG_TRANS_PREFIX_STEERED).toContain('o3 = extra;');
    // A: la ganancia multiplica la transmisión con apertura de la imagen (o0.x y o3.x), nunca el rayo único del Doppler
    for (const src of [FRAG_TRANSMISSION, FRAG_TRANSMISSION_STEERED]) {
      expect(src).toContain('float Tap = apertureTransmission(line, k, r, step, single, spec);');
      expect(src).toContain('float T = Tap * refractionGain(uPre1, 0, 1, line, k, r);');
      expect(src).toContain('o2 = vec4(single, 0.0, clamp(Tap / max(noBone, 1e-30), 0.0, 1.0), spec);');
      expect(src).toContain('uniform vec4 uAperture;');
      expect(src).toContain('uniform vec4 uRefr;');
      expect(src).toContain('uniform vec2 uRefrK;');
      // la dirección y el tipo de gas, que A2 ya no lleva en o1, los pone A desde A0
      expect(src).toContain('vec3 dir = c0.w >= 0.0 ? texelFetch(uHits1, ivec2(line, 0), 0).xyz : lineDir(lineTheta(vUv.x));');
      expect(src).toContain('o1 = vec4(dir, c0.y >= 0.0 ? texelFetch(uHits0, ivec2(line, 0), 0).w : 0.0);');
    }
    expect(FRAG_TRANSMISSION_STEERED).toContain('* refractionGain(uPreSteerX, 2, 3, line, k, r);');
    // las constantes interpoladas de TS
    expect(REFRACTION_GLSL).toContain(`int d = i <= ${REFRACTION_SEARCH_LINES} ? i : ${REFRACTION_SEARCH_LINES} + `);
    expect(REFRACTION_GLSL).toContain(`float Y[${REFRACTION_TAPS}];`);
    expect(REFRACTION_GLSL.replace(/\/\/.*$/gm, '')).not.toMatch(/REFRACTION_[A-Z_]+/);
    // la mancha: 1/(2,355·√2) de la anchura a −6 dB de la amplitud
    expect(REFRACTION_SPOT).toBeCloseTo(0.3003, 4);
  });
});
