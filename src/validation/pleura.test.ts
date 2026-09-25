import { describe, expect, it } from 'vitest';
import { INTERFACES, INTERFACE_GLSL_NAME, Interface, interfaceReflectivity } from '../anatomy/interfaces';
import { LUNG_CURTAIN, lungCurtainEdgeMm } from '../anatomy/organs/lungCurtain';
import { AnatomyScene, type VesselCaliber } from '../anatomy/scene';
import { ANATOMY_GLSL } from '../anatomy/gpu/anatomy.glsl';
import { torsoNormal } from '../anatomy/primitives';
import { TISSUES, Tissue, attenuationDbPerCm } from '../anatomy/tissues';
import { START_POINTS } from '../app/startPoints';
import { NORMAL_ADULT } from '../cases';
import { cross, normalize, type Vec3 } from '../core/vec3';
import { CONVEX_C35, lineDirection, pointOnLine, probeFrame, type ProbeFrame } from '../probe/probe';
import { CONVEX_BEAM, lateralSigmaMm } from '../ultrasound/beamModel';
import {
  IFACE_K_DB,
  IFACE_SHIFT_MM,
  IFACE_SLOPE_REF,
  facetLobe,
  interfaceEchoField,
  interfaceUniforms,
  roughnessCoherence,
} from '../ultrasound/interfaceEcho';
import {
  CURTAIN_GAS_KIND,
  CURTAIN_MIN_AIR,
  CURTAIN_RECORD_MM,
  CURTAIN_TAPER_MM,
  PLEURA_GLSL,
  PLEURA_RP,
  PLEURA_RT,
  PLEURA_SERIES_FLOOR,
  PLEURA_WALL_FIELD_BOUND,
  SLIDING_AX_MM,
  SLIDING_DB,
  SLIDING_EFOLD_MM,
  SLIDING_LAT_MM,
  SLIDING_PSF_GAIN_DB,
  aLineGain,
  aLineOrder,
  curtainAirFraction,
  curtainEdgeSigmaMm,
  edgeWidth1090Mm,
  elevSigmaMm,
  forwardGain,
  mirrorGain,
  normalCdf,
  pleuraCapMm,
  pleuraCoherence,
  pleuraRoundTrip,
  pleuraSeriesDepths,
  pleuraTerms,
  slidingAmplitude,
  slidingField,
  slidingLattice,
} from '../ultrasound/pleura';
import { FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED, FRAG_TRANS_HITS, FRAG_TRANS_SEGMENTS } from '../ultrasound/shaders/passes.glsl';
import {
  GAS_DB_PER_CM,
  MIRROR_BISECTION_STEPS,
  STEERED_PREFIX_GLSL,
  lineHits,
  mirrorCrossing,
  segmentDb,
  steeredPrefixDb,
  transmissionHitsLine,
  type HitsLine,
  type HitsLineQuery,
} from '../ultrasound/transmission';
import {
  CURTAIN_FULL_AIR,
  CURTAIN_LIVER_MAX_AIR,
  clearLiverGrid,
  curtainEdgeFit,
  curtainLines,
  slidingCorrelation,
  type CurtainLine,
} from '../app/fidelity';
import type { Simulator } from '../app/simulator';
import { AnatomyQuery } from '../anatomy/query';
import { PhysiologyEngine } from '../physiology/engine';
import { clonePatient } from '../physiology/patientState';
import { CONVEX_C35_PROFILE } from '../ultrasound/transducerProfile';
import { rng } from './syntheticSpeckle';
import { emptyGrid } from './support/segmentGrid';

/**
 * Pleura parietal y cortina pulmonar (decisión 61): la cara nueva de la tabla, las amplitudes de la serie
 * de reverberaciones frente a los caminos acústicos, sin doble eco pleural, la fracción de aire del borde
 * blando, la clasificación sin la cortina, el deslizamiento anclado al pulmón y la pleura de A0 (tipo 3, sin
 * espejo) frente al espejo del diafragma, que no cambia. El gemelo B → C → D con los niveles de la imagen
 * está en `pleuraTwin.test.ts` (lento) y la geometría del camino dirigido en `steeredSample.test.ts`.
 */
const K0 = (2 * Math.PI) / CONVEX_BEAM.lambdaMm;
const db = (x: number) => 20 * Math.log10(x);
const deg = Math.PI / 180;

describe('la cara de la pleura parietal (decisión 61)', () => {
  it('entrada de la tabla: Fresnel músculo/gas, un lado (la dibuja el músculo), s 0,10–0,15, con su fuente', () => {
    const p = INTERFACES[Interface.PleuraWall];
    expect(p.sides).toEqual([Tissue.Muscle, Tissue.Lung]);
    expect(interfaceReflectivity(Interface.PleuraWall)).toBeCloseTo(0.9995, 4);
    expect(PLEURA_RP).toBe(interfaceReflectivity(Interface.PleuraWall));
    expect(p.twoSided).toBe(false);
    expect(p.slopeRms).toBeGreaterThanOrEqual(0.1);
    expect(p.slopeRms).toBeLessThanOrEqual(0.15);
    expect(p.source).toMatch(/Lee 2017/);
    expect(p.source).toMatch(/ESTIMADO/);
    expect(INTERFACE_GLSL_NAME[Interface.PleuraWall]).toBe('IF_PLEURA_WALL');
    // el uniform de la pasada B lleva su fila: (A, 2·k0·σz, 1/(4s²), un lado)
    const u = interfaceUniforms(K0);
    const row = Array.from(u.subarray(4 * Interface.PleuraWall, 4 * Interface.PleuraWall + 4));
    expect(row[1]).toBeCloseTo(2 * K0 * p.roughnessMm, 5);
    expect(row[2]).toBeCloseTo(1 / (4 * p.slopeRms * p.slopeRms), 5);
    expect(row[3]).toBe(0);
  });

  it('la línea pleural es la cara más brillante de la tabla y se apaga en los bordes del sector', () => {
    const p = INTERFACES[Interface.PleuraWall];
    const s = (i: Interface, a: number) =>
      10 ** (IFACE_K_DB / 20) *
      interfaceReflectivity(i) *
      facetLobe(Math.cos(a * deg), INTERFACES[i].slopeRms) *
      roughnessCoherence(Math.cos(a * deg), INTERFACES[i].roughnessMm, K0);
    // S sobre el moteado del hígado a incidencia normal: +45 dB (la del diafragma, +26)
    expect(db(s(Interface.PleuraWall, 0))).toBeGreaterThan(40);
    const others = Object.values(Interface).filter(
      (v): v is Interface => typeof v === 'number' && v !== Interface.None && v !== Interface.PleuraWall,
    );
    for (const i of others) expect(s(Interface.PleuraWall, 0), Interface[i]).toBeGreaterThan(s(i, 0));
    // −6 a −8 dB a 15° y < −25 dB a 35°: brillante cerca de la normal, apagada en los bordes
    const rel = (a: number) => db(s(Interface.PleuraWall, a) / s(Interface.PleuraWall, 0));
    expect(rel(15)).toBeLessThan(-4);
    expect(rel(15)).toBeGreaterThan(-9);
    expect(rel(35)).toBeLessThan(-25);
    expect(facetLobe(1, p.slopeRms)).toBeCloseTo(IFACE_SLOPE_REF / p.slopeRms, 12);
    // perfil de un lado: centrado 2,5σh dentro del músculo (por encima de D)
    const at = (delta: number) => interfaceEchoField(Interface.PleuraWall, 1, 1, delta, K0);
    expect(at(IFACE_SHIFT_MM)).toBeGreaterThan(at(0));
    expect(at(IFACE_SHIFT_MM)).toBeGreaterThan(at(2 * IFACE_SHIFT_MM));
  });
});

/** Transmisión de una vía al cuadrado (ida y vuelta) de una pared con atenuación uniforme: T(0) = 1. */
const wallT = (tD: number, D: number) => (d: number) => tD ** (Math.min(d, D) / D);

/**
 * Los caminos acústicos de la reverberación entre la pleura (reflexión coherente R_p·χ) y la cara de la sonda
 * (R_t), escritos uno a uno: para un dispersor a la distancia d de la pared (eco directo E = f·T(d)) y la
 * pleura (eco E_p):
 *  - M_n: sonda → pleura → d → pleura → sonda, con n idas y vueltas pleura–sonda más: a 2D − d + nD,
 *    E·(R_p·χ)²·(T(D)/T(d))²·Gⁿ;
 *  - F_n: sonda → pleura → sonda → d, con n idas y vueltas más: a D + d + nD, E·G^(n+1);
 *  - P_k: la pleura con k − 1 idas y vueltas: a kD, E_p·G^(k−1);
 * con G = R_p·χ·R_t·T(D).
 */
function pathsAt(s: number, D: number, tD: number, chi: number, T: (d: number) => number, maxOrder = 12) {
  const G = PLEURA_RP * chi * PLEURA_RT * tD;
  const out: { family: 'mirror' | 'forward'; order: number; d: number; ampOverF: number }[] = [];
  for (let n = 0; n <= maxOrder; n++) {
    const dM = 2 * D + n * D - s;
    if (dM >= 0 && dM < D)
      out.push({ family: 'mirror', order: n, d: dM, ampOverF: T(dM) * (PLEURA_RP * chi) ** 2 * (tD / T(dM)) ** 2 * G ** n });
    const dF = s - D - n * D;
    if (dF >= 0 && dF < D) out.push({ family: 'forward', order: n, d: dF, ampOverF: T(dF) * G ** (n + 1) });
  }
  return out;
}

describe('serie de reverberaciones bajo la pleura: amplitudes frente a los caminos', () => {
  it('cada muestra bajo la pleura recibe exactamente una copia espejo y una directa, con la amplitud de su camino', () => {
    const rnd = rng(611);
    let checked = 0;
    for (let t = 0; t < 3000; t++) {
      const D = 15 + 35 * rnd();
      const tD = 0.1 + 0.8 * rnd();
      const chi = pleuraCoherence(Math.cos(40 * deg * rnd()), K0);
      const T = wallT(tD, D);
      const s = D + 1e-6 + 5 * D * rnd();
      const terms = pleuraTerms(s, D, tD, chi, T, Infinity);
      const paths = pathsAt(s, D, tD, chi, T);
      const series = terms.filter((x) => x.family !== 'pleura');
      // los caminos con d en [0, D): uno de cada familia, con el mismo orden
      expect(paths.map((p) => p.family).sort()).toEqual(['forward', 'mirror']);
      for (const p of paths) {
        const got = series.find((x) => x.family === p.family)!;
        expect(got.order).toBe(p.order);
        expect(got.depth).toBeCloseTo(p.d, 9);
        expect(got.gain / p.ampOverF).toBeCloseTo(1, 9);
        checked++;
      }
    }
    expect(checked).toBe(6000);
  });

  it('las líneas A son las réplicas del eco pleural: la copia directa con d = D, a kD, con G^(k−1)', () => {
    for (const D of [18, 27.3, 41]) {
      const tD = 0.34;
      const chi = pleuraCoherence(1, K0);
      const G = pleuraRoundTrip(tD, chi);
      expect(G).toBeCloseTo(PLEURA_RP * chi * PLEURA_RT * tD, 12);
      for (let k = 1; k <= 6; k++) {
        const s = k * D - IFACE_SHIFT_MM; // el pico del perfil de un lado de la réplica k
        const [p] = pleuraTerms(s, D, tD, chi, wallT(tD, D));
        expect(p.family).toBe('pleura');
        expect(p.order).toBe(k);
        expect(p.depth).toBeCloseTo(IFACE_SHIFT_MM, 9);
        expect(p.gain).toBeCloseTo(tD * G ** (k - 1), 12);
        // la réplica k es F_{k−2} con d = D (salvo el eco pleural directo, k = 1)
        if (k >= 2) expect(aLineGain(G, k) * tD).toBeCloseTo(forwardGain(tD, G, k - 2), 12);
      }
      // cada réplica pierde G (una ida y vuelta más): la k = 3 es más débil que la 2
      expect(aLineGain(G, 3)).toBeLessThan(aLineGain(G, 2));
    }
  });

  it('sin doble eco pleural: la pleura sale una sola vez en cada réplica y las copias de la pared no la llevan', () => {
    const D = 27.3;
    const tD = 0.34;
    const T = wallT(tD, D);
    const dr = 180 / 1024;
    const chi = pleuraCoherence(1, K0);
    const G = pleuraRoundTrip(tD, chi);
    for (let k = 1; k <= 4; k++) {
      // la integral del perfil de las réplicas en ±2 mm de kD: tD·G^(k−1) × la integral de una cara (una vez)
      let sum = 0;
      let unit = 0;
      for (let s = k * D - 2; s <= k * D + 2; s += dr / 16) {
        for (const x of pleuraTerms(s, D, tD, chi, T, Infinity))
          if (x.family === 'pleura') sum += x.gain * interfaceEchoField(Interface.PleuraWall, 1, 1, x.depth, K0) * (dr / 16);
        unit += interfaceEchoField(Interface.PleuraWall, 1, 1, k * D - s, K0) * (dr / 16);
      }
      expect(sum / (unit * tD * G ** (k - 1))).toBeCloseTo(1, 6);
    }
    // la copia espejo nunca muestrea la pleura: sus distancias están en [0, D) y cerca de kD caen en la piel
    for (let s = D + 0.01; s < 5 * D; s += 0.37) {
      const m = pleuraTerms(s, D, tD, chi, T, Infinity).find((x) => x.family === 'mirror')!;
      expect(m.depth).toBeGreaterThanOrEqual(0);
      expect(m.depth).toBeLessThanOrEqual(D);
    }
    // la GLSL: el eco de la pleura parietal solo en la réplica (además de su #define); la pared remuestreada no
    // lo dibuja
    for (const src of [FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED]) {
      const code = src.replace(/\/\/.*$/gm, '');
      // el #define, la coherencia de su reflexión especular (su fila de uIface) y el eco de la réplica
      expect(code.match(/IF_PLEURA_WALL/g)?.length).toBe(3);
      expect(code.match(/interfaceProfileEcho\(IF_PLEURA_WALL, cosI, 1\.0, k \* (D|sD) - (r|s)\)/g)?.length).toBe(1);
    }
    const wall = PLEURA_GLSL.slice(PLEURA_GLSL.indexOf('vec2 mediumField('));
    expect(wall).not.toMatch(/IF_PLEURA_WALL|pleuraEcho/);
  });

  it('la serie se trunca bajo la décima del ruido del receptor (órdenes 2–5 con la pared y la pleura de la tabla)', () => {
    const chi = pleuraCoherence(1, K0);
    for (const tD of [0.2, 0.34, 0.6]) {
      const D = 27;
      let last = -1;
      for (let s = D + 0.1; s < 20 * D; s += 0.25) {
        const terms = pleuraTerms(s, D, tD, chi, wallT(tD, D));
        const m = terms.find((x) => x.family === 'mirror');
        if (m) last = Math.max(last, m.order);
      }
      const G = pleuraRoundTrip(tD, chi);
      expect(G ** last * tD * PLEURA_WALL_FIELD_BOUND).toBeGreaterThan(PLEURA_SERIES_FLOOR);
      expect(G ** (last + 1) * tD * PLEURA_WALL_FIELD_BOUND).toBeLessThanOrEqual(PLEURA_SERIES_FLOOR);
      expect(last).toBeGreaterThanOrEqual(2);
      expect(last).toBeLessThanOrEqual(5);
    }
  });

  it('cada reflexión de la pleura en la serie es la coherente, R_p·χ: la misma χ de Ament que da el nivel de la línea', () => {
    const p = INTERFACES[Interface.PleuraWall];
    for (const a of [0, 10, 25, 40]) {
      const c = Math.cos(a * deg);
      expect(pleuraCoherence(c, K0)).toBeCloseTo(roughnessCoherence(c, p.roughnessMm, K0), 12);
    }
    // la parte coherente de la pleura parietal a 0°: −8 a −10 dB (la del diafragma, −28,7)
    expect(db(pleuraCoherence(1, K0))).toBeGreaterThan(-10);
    expect(db(pleuraCoherence(1, K0))).toBeLessThan(-8);
    expect(PLEURA_GLSL).toContain(
      'float pleuraCoherence(float cosI) { float x = uIface[IF_PLEURA_WALL].y * cosI; return exp(-0.5 * x * x); }',
    );
    expect(PLEURA_GLSL).toContain('float pleuraRoundTrip(float tD, float chi) { return PLEURA_RP * chi * PLEURA_RT * tD; }');
    for (const src of [FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED]) {
      expect(src).toContain('float chi = pleuraCoherence(cosI);');
      expect(src).toContain('float G = pleuraRoundTrip(tD, chi);');
      expect(src).toContain('air += f * (j == 1 ? PLEURA_RP * PLEURA_RP * chi * chi * tD * tD / max(td, 1e-6) * gn : td * G * gn);');
    }
  });

  it('la transmisión hasta la pleura se lee en la última fila de A sin gas (sin mezclar la pérdida del pulmón)', () => {
    const step = 180 / 160;
    for (let D = 5; D < 60; D += 0.013) {
      const cap = pleuraCapMm(D, step);
      // el centro de la fila tope está por encima de D (su segmento no es pulmón) y a menos de 1,5 filas
      expect(cap).toBeLessThan(D);
      expect(D - cap).toBeLessThanOrEqual(1.5 * step + 1e-9);
      // la fila siguiente ya tiene su centro en la pleura o por debajo
      expect(cap + step).toBeGreaterThanOrEqual(D - 1e-9);
    }
  });
});

describe('borde blando de la cortina: fracción de aire del haz', () => {
  it('Φ de Abramowitz y Stegun a < 2·10⁻⁷ de los valores tabulados', () => {
    const table: [number, number][] = [
      [0, 0.5],
      [1, 0.8413447461],
      [-1, 0.1586552539],
      [1.2815516, 0.9],
      [-1.2815516, 0.1],
      [1.959964, 0.975],
      [-3.0902323, 0.001],
      [3.5, 0.9997673709],
    ];
    for (const [x, p] of table) expect(Math.abs(normalCdf(x) - p), `Φ(${x})`).toBeLessThan(2e-7);
  });

  it('σ² = (σe·e_z)² + (σl·l_z)² + σ_taper²; f(0) = ½, monótona, 10⁻³ a −3,09σ y ancho 10–90 % de 2,56σ', () => {
    expect(curtainEdgeSigmaMm(0, 0, 0, 0)).toBe(CURTAIN_TAPER_MM);
    expect(curtainEdgeSigmaMm(3, 4, 1, 1, 0)).toBeCloseTo(5, 12);
    expect(curtainEdgeSigmaMm(3, 4, 0.5, 0, 0)).toBeCloseTo(1.5, 12);
    const sg = 4.2;
    expect(curtainAirFraction(0, sg)).toBeCloseTo(0.5, 7);
    let prev = 0;
    for (let dz = -20; dz <= 20; dz += 0.1) {
      const f = curtainAirFraction(dz, sg);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
    expect(curtainAirFraction(-3.0902323 * sg, sg)).toBeCloseTo(CURTAIN_MIN_AIR, 5);
    const x10 = -1.2815516 * sg;
    expect(curtainAirFraction(x10, sg)).toBeCloseTo(0.1, 6);
    expect(edgeWidth1090Mm(sg)).toBeCloseTo(2 * 1.2815516 * sg, 9);
    // A0 registra la pleura bastante antes de que el aire importe: con el σ más ancho de la imagen (σ_taper 5)
    const widest = curtainEdgeSigmaMm(elevSigmaMm(0, CONVEX_C35.elevationFocusMm) * Math.SQRT1_2, 1.5, 1, 1, 5);
    expect(curtainAirFraction(-CURTAIN_RECORD_MM, widest)).toBeLessThan(CURTAIN_MIN_AIR);
  });

  it('en los puntos de partida con cortina el borde mide 5–15 mm (10–90 %) y baja con la inspiración', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    for (const id of ['intercostal', 'flank'] as const) {
      const sp = START_POINTS.find((p) => p.id === id)!;
      const fr = probeFrame(
        { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 },
        scene.torso,
        CONVEX_C35,
      );
      for (let i = 0; i < CONVEX_C35.lines; i += 16) {
        const th = -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * (i + 0.5)) / CONVEX_C35.lines;
        const dir = lineDirection(fr, th);
        const lat = normalize(cross(fr.elevation, dir));
        for (const D of [20, 30, 50]) {
          const sg = curtainEdgeSigmaMm(
            elevSigmaMm(D, CONVEX_C35.elevationFocusMm) * Math.SQRT1_2,
            lateralSigmaMm(D, 90, CONVEX_BEAM),
            fr.elevation[2],
            lat[2],
          );
          expect(edgeWidth1090Mm(sg), `${id} línea ${i} D ${D}`).toBeGreaterThanOrEqual(5);
          expect(edgeWidth1090Mm(sg), `${id} línea ${i} D ${D}`).toBeLessThanOrEqual(15);
        }
      }
    }
    // el borde sigue al descenso de la cortina: 10 mm de respiración tranquila mueven dz 10 mm
    const m: Vec3 = [-120, 10, 5];
    expect(lungCurtainEdgeMm(m, 10)! - lungCurtainEdgeMm(m, 0)!).toBeCloseTo(10, 9);
    expect(lungCurtainEdgeMm([0, 10, 5], 0)).toBeNull();
    expect(lungCurtainEdgeMm([-120, LUNG_CURTAIN.yMax + 1, 5], 0)).toBeNull();
  });

  it('la GLSL calcula la fracción con el haz de dos vías y lo que ve del tejido de detrás con 1 − f', () => {
    expect(PLEURA_GLSL).toContain(
      'return normalCdf(dz / curtainEdgeSigmaMm(elevSigma(dRow) * 0.70710678, lateralSigmaMm(dRow), uElev.z, lat.z));',
    );
    expect(PLEURA_GLSL).toContain('return sqrt(se2 * se2 * ez * ez + sl * sl * lz * lz + CURTAIN_TAPER_MM * CURTAIN_TAPER_MM);');
    for (const src of [FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED]) {
      expect(src).toContain('float wTissue = under ? 1.0 - fAir : 1.0;');
      expect(src).toContain('out2 += air * (fAir * coupling);');
      expect(src).toContain('out2 = tissue * wTissue;');
    }
  });
});

const caliberOf = (caudal: number): VesselCaliber => ({ radiusScale: () => 1, ivcApScale: 0.8, diaphragmCaudalMm: caudal });

describe('clasificación sin la cortina (gemelo de classifyWith(m, false))', () => {
  it('es classify en todas partes salvo en la lámina de pulmón, donde da lo que hay detrás', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    const rnd = rng(612);
    let curtain = 0;
    let other = 0;
    for (const caudal of [0, 10, 30]) {
      const cal = caliberOf(caudal);
      // sin cortina: el borde tan arriba que no la hay (el descenso solo mueve la cortina en classify)
      const noCurtain = caliberOf(-1e4);
      for (let t = 0; t < 4000; t++) {
        // la mitad de los puntos en la lámina bajo la pared del receso; el resto en todo el tronco
        let m: Vec3;
        if (t % 2 === 0) {
          const phi = Math.PI * (0.8 + 0.4 * rnd());
          const z = -60 + 120 * rnd();
          const inset = scene.wallThickness() + 4 * rnd() - 0.5;
          const k = 1 - inset / 150;
          m = [scene.torso.a * k * Math.cos(phi), scene.torso.b * k * Math.sin(phi), z];
        } else m = [-170 + 340 * rnd(), -110 + 220 * rnd(), -200 + 300 * rnd()];
        const a = scene.classify(m, cal);
        const b = scene.classify(m, cal, false);
        const inCurtain = a.tissue === Tissue.Lung && scene.inLungCurtain(m, cal);
        if (inCurtain) {
          curtain++;
          // lo de detrás: el hígado, el diafragma o el pulmón del tórax (que sigue a la lámina en el receso)
          expect(b).toEqual(scene.classify(m, noCurtain));
        } else {
          other++;
          expect(b).toEqual(a);
        }
      }
    }
    expect(curtain).toBeGreaterThan(1000);
    expect(other).toBeGreaterThan(5000);
  });

  it('la GLSL: classify es classifyWith(m, true) y la cortina solo se mira con withCurtain', () => {
    expect(ANATOMY_GLSL).toContain('Cls classify(vec3 m) { return classifyWith(m, true); }');
    expect(ANATOMY_GLSL).toMatch(/if \(withCurtain\) \{\n\s+float dCurtain = lungCurtainDistance\(m, -depth - wall\);/);
    expect(ANATOMY_GLSL).toContain('float insideWallMm(vec3 m) { return -torsoDepth(m) - (uWall.x + uWall.y + uWall.z); }');
    // el tejido que se ve a través del borde y sus planos laterales usan la variante bajo la pleura (la muestra de
    // la imagen, j = 0); la pared que copia la serie, la de siempre
    expect(PLEURA_GLSL).toContain('Cls c = classifyWith(m, withCurtain);');
    expect(PLEURA_GLSL).toContain('vec2 f1 = sampleSide(p + uElev * se, se, c, withCurtain);');
    expect(FRAG_RAWFIELD).toContain(
      'vec2 f = mediumField(j == 0 ? p : pointOnLine(dir0, d), j == 0 ? dir : dir0, elevSigma(d), d, j != 0 || !under, j == 0);',
    );
    expect(FRAG_RAWFIELD_STEERED).toContain('vec2 f1 = sampleSidePh(p + uElev * se, se, c, ph0, g, withCurtain);');
    expect(FRAG_RAWFIELD_STEERED).toContain('j != 0 || !under, j == 0,');
  });
});

describe('deslizamiento pulmonar anclado al pulmón', () => {
  const scene = new AnatomyScene(NORMAL_ADULT);
  // puntos de la pleura parietal del receso (cara interna de la pared) en una franja craneocaudal
  const pleuraPoints = (n: number, seed: number): Vec3[] => {
    const rnd = rng(seed);
    return Array.from({ length: n }, () => {
      const phi = Math.PI * (0.85 + 0.3 * rnd());
      const k = 1 - scene.wallThickness() / 150;
      return [scene.torso.a * k * Math.cos(phi), scene.torso.b * k * Math.sin(phi), -30 + 60 * rnd()] as Vec3;
    });
  };
  const corr = (a: number[], b: number[]) => {
    const ma = a.reduce((s, x) => s + x, 0) / a.length;
    const mb = b.reduce((s, x) => s + x, 0) / b.length;
    let sab = 0;
    let saa = 0;
    let sbb = 0;
    for (let i = 0; i < a.length; i++) {
      sab += (a[i] - ma) * (b[i] - mb);
      saa += (a[i] - ma) ** 2;
      sbb += (b[i] - mb) ** 2;
    }
    return sab / Math.sqrt(saa * sbb);
  };
  const env = (p: Vec3, caudal: number, h: number) => {
    const f = slidingField(p, torsoNormal(p, scene.torso), caudal, h, 3.1);
    return Math.hypot(f[0], f[1]);
  };

  it('la misma fase respiratoria da la misma neblina; otra fase, otra (el pulmón ha bajado)', () => {
    const pts = pleuraPoints(3000, 613);
    for (const h of [2, 4, 6]) {
      const a = pts.map((p) => env(p, 12, h));
      const same = pts.map((p) => env(p, 12, h));
      expect(same).toEqual(a);
      // 5 mm de descenso: más que el grano a lo largo de la pleura; la correlación de la envolvente cae
      const moved = pts.map((p) => env(p, 17, h));
      expect(corr(a, moved)).toBeLessThan(0.2);
      // y el mismo pulmón visto en otro punto: el punto que baja con él conserva su neblina
      const followed = pts.map((p) => env([p[0], p[1], p[2] - 5], 17, h));
      expect(corr(a, followed)).toBeGreaterThan(0.999);
    }
  });

  it('grano alargado a lo largo de la pleura (≥ 3 veces más largo que hondo) y nivel −8 a −12 dB con caída 10–20 mm', () => {
    expect(SLIDING_LAT_MM / SLIDING_AX_MM).toBeGreaterThanOrEqual(3);
    expect(SLIDING_DB).toBeGreaterThanOrEqual(-12);
    expect(SLIDING_DB).toBeLessThanOrEqual(-8);
    expect(SLIDING_EFOLD_MM).toBeGreaterThanOrEqual(10);
    expect(SLIDING_EFOLD_MM).toBeLessThanOrEqual(20);
    // el campo va SLIDING_PSF_GAIN_DB por debajo: la imagen lo muestra a SLIDING_DB (medido en pleuraTwin.test.ts)
    expect(slidingAmplitude(0)).toBeCloseTo(10 ** ((SLIDING_DB - SLIDING_PSF_GAIN_DB) / 20), 12);
    expect(slidingAmplitude(SLIDING_EFOLD_MM) / slidingAmplitude(0)).toBeCloseTo(Math.exp(-1), 12);
    // correlación de la envolvente a 0,5 mm: a lo largo de la pleura alta, en profundidad baja
    const pts = pleuraPoints(3000, 614);
    const base = pts.map((p) => env(p, 0, 3));
    const alongZ = pts.map((p) => env([p[0], p[1], p[2] + 0.5], 0, 3));
    const deeper = pts.map((p) => env(p, 0, 3.5));
    expect(corr(base, alongZ)).toBeGreaterThan(0.8);
    expect(corr(base, deeper)).toBeLessThan(0.5);
    // la retícula: la z del pulmón (z + descenso) a escala del grano lateral y h hacia dentro a la del axial
    const q = slidingLattice([-120, 10, 5], [-1, 0, 0], 7, 2);
    expect(q[0]).toBeCloseTo(-120 / SLIDING_LAT_MM + 2 / SLIDING_AX_MM, 12);
    expect(q[2]).toBeCloseTo((5 + 7) / SLIDING_LAT_MM, 12);
    expect(PLEURA_GLSL).toContain(
      'vec3 q = (m + vec3(0.0, 0.0, CURTAIN_Z0 - uCurtain.x)) / SLIDING_LAT_MM - torsoNormal(m) * (h / SLIDING_AX_MM);',
    );
  });
});

/**
 * A0 de antes de la decisión 61 (la de la decisión 57): el primer pulmón, sea el de la cortina o el del tórax,
 * es el espejo. Referencia para comprobar que el espejo del diafragma no cambia.
 */
function hitsBefore61(q: HitsLineQuery, origin: Vec3, dir0: Vec3, depthMm: number, coarseN: number): Omit<HitsLine, 'pleura'> {
  const step = depthMm / coarseN;
  const at = (p0: Vec3, d: Vec3, r: number): Vec3 => [p0[0] + d[0] * r, p0[1] + d[1] * r, p0[2] + d[2] * r];
  let dir: Vec3 = dir0;
  let hitPoint = origin;
  let hitR = 0;
  let mirrorSeg = -1;
  let gasSeg = -1;
  let boneSeg = -1;
  let gasKind = 0;
  let entered = false;
  for (let s = 0; s < coarseN; s++) {
    const r = (s + 0.5) * step;
    const p = mirrorSeg >= 0 ? at(hitPoint, dir, r - hitR) : at(origin, dir0, r);
    const c = q.at(p);
    if (c.tissue === Tissue.Air && !entered) continue;
    entered = true;
    if (TISSUES[c.tissue].gas) {
      if (c.tissue === Tissue.Lung && mirrorSeg < 0) {
        let nn = c.normal;
        hitR = mirrorCrossing(
          (x) => {
            const cm = q.at(at(origin, dir, x));
            if (cm.tissue === Tissue.Lung) nn = cm.normal;
            return cm.tissue === Tissue.Lung;
          },
          r,
          step,
          MIRROR_BISECTION_STEPS,
        );
        mirrorSeg = s;
        hitPoint = at(origin, dir, hitR);
        if (nn[0] * dir[0] + nn[1] * dir[1] + nn[2] * dir[2] > 0) nn = [-nn[0], -nn[1], -nn[2]];
        const dd = dir[0] * nn[0] + dir[1] * nn[1] + dir[2] * nn[2];
        dir = [dir[0] - 2 * dd * nn[0], dir[1] - 2 * dd * nn[1], dir[2] - 2 * dd * nn[2]];
        if (gasSeg < 0) {
          gasSeg = s;
          gasKind = 1;
        }
        continue;
      }
      if (gasSeg < 0) {
        gasSeg = s;
        gasKind = 2;
      }
      continue;
    }
    if (TISSUES[c.tissue].bone && boneSeg < 0) boneSeg = s;
  }
  return { mirrorSeg, gasSeg, boneSeg, gasKind, mirrorR: hitR, dir };
}

/** Consulta de A0 sobre la escena real (sin deformación: la pared y la cortina no se mueven con ella). */
function sceneQuery(scene: AnatomyScene, cal: VesselCaliber): HitsLineQuery {
  return {
    at: (p) => {
      const c = scene.classify(p, cal);
      const normal = c.tissue === Tissue.Lung ? (scene.faceGradient(p, cal, 'dome')?.normal ?? [0, 0, 1]) : c.boundaryNormal;
      return { tissue: c.tissue, normal, curtain: c.tissue === Tissue.Lung && scene.inLungCurtain(p, cal) };
    },
    behind: (p) => scene.classify(p, cal, false).tissue,
    insideWall: (p) => scene.insideWallMm(p),
    curtainEdge: (p) => lungCurtainEdgeMm(p, cal.diaphragmCaudalMm),
  };
}

describe('A0: la pleura parietal es su propio tipo (3) y el espejo del diafragma no cambia', () => {
  const scene = new AnatomyScene(NORMAL_ADULT);
  const fB = 3.0;
  const dbOf = (t: Tissue, step: number) => segmentDb(t, step, fB);
  const depth = 180;
  const N = 160;
  const frames: { id: string; fr: ProbeFrame }[] = [];
  for (const id of ['intercostal', 'flank', 'subxiphoid'] as const) {
    const sp = START_POINTS.find((p) => p.id === id)!;
    for (const rock of [0, -0.35, 0.35])
      frames.push({
        id: `${id}${rock}`,
        fr: probeFrame(
          { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: (sp.rock ?? 0) + rock, tilt: sp.tilt ?? 0 },
          scene.torso,
          CONVEX_C35,
        ),
      });
  }

  /**
   * Primer segmento de pulmón de la cortina en el camino recto (−1 si el primer pulmón es el del tórax o no lo
   * hay) y el último del pulmón pegado a él (la lámina y el tórax que la sigue sin tejido en medio).
   */
  const curtainRunOf = (q: HitsLineQuery, fr: ProbeFrame, th: number, step: number): { first: number; last: number } => {
    let first = -1;
    let last = -1;
    for (let s = 0; s < N; s++) {
      const c = q.at(pointOnLine(fr, CONVEX_C35, th, (s + 0.5) * step));
      if (first < 0) {
        if (c.tissue !== Tissue.Lung) continue;
        if (!c.curtain) break;
        first = last = s;
      } else if (c.tissue === Tissue.Lung) last = s;
      else break;
    }
    return { first, last };
  };

  it('las líneas que cruzan la cortina: tipo 3 en el cruce exacto de la cara interna de la pared, sin espejo en ella', () => {
    let curtainLines = 0;
    let edgeLines = 0;
    let thoraxBehind = 0;
    for (const caudal of [0, 30]) {
      const cal = caliberOf(caudal);
      const q = sceneQuery(scene, cal);
      for (const { id, fr } of frames)
        for (let i = 0; i < CONVEX_C35.lines; i += 3) {
          const th = -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * (i + 0.5)) / CONVEX_C35.lines;
          const origin = pointOnLine(fr, CONVEX_C35, th, 0);
          const dir = lineDirection(fr, th);
          const got = transmissionHitsLine(q, origin, dir, depth, N, dbOf);
          const old = hitsBefore61(q, origin, dir, depth, N);
          const step = depth / N;
          // ¿pasa el camino recto por el pulmón de la cortina antes de cualquier espejo?
          const run = curtainRunOf(q, fr, th, step);
          const firstCurtain = run.first;
          const tag = `${id} línea ${i} descenso ${caudal}`;
          if (firstCurtain >= 0) {
            curtainLines++;
            expect(got.pleura, tag).not.toBeNull();
            const p = got.pleura!;
            expect(p.kind).toBe(CURTAIN_GAS_KIND);
            // el cruce exacto de la cara interna de la pared (bisección de 6 pasos: ≤ 0,009 mm en la línea)
            expect(Math.abs(scene.insideWallMm(pointOnLine(fr, CONVEX_C35, th, p.D))), tag).toBeLessThan(0.01);
            // el borde queda a menos de un segmento grueso del primer pulmón de la línea
            expect(p.dz, tag).toBeGreaterThan(-1.2);
            // donde el cruce ya está en la cortina, el pulmón empieza ahí (sin costilla delante)
            if (p.dz > 0.1) expect(q.at(pointOnLine(fr, CONVEX_C35, th, p.D + 0.05)).tissue, tag).toBe(Tissue.Lung);
            // la decisión 57 ponía el espejo en la cortina; ahora no hay espejo en ella ni en el pulmón del tórax
            // pegado a ella (aire con aire), y el primer gas de h0 es el siguiente (intestino o el diafragma visto
            // desde el hígado)
            expect(old.mirrorSeg, tag).toBe(firstCurtain);
            expect(got.mirrorSeg < 0 || got.mirrorSeg > run.last + 1, tag).toBe(true);
            expect(got.gasSeg < 0 || got.gasSeg > run.last, tag).toBe(true);
            expect(p.curtainLast, tag).toBe(run.last);
            // ΔL: lo que el gas de la lámina cuesta de más frente al tejido de detrás, segmento a segmento
            let dL = 0;
            for (let s = run.first; s <= run.last; s++) {
              const pp = pointOnLine(fr, CONVEX_C35, th, (s + 0.5) * step);
              dL += GAS_DB_PER_CM * (step / 10) - dbOf(q.behind(pp), step);
            }
            expect(p.dL, tag).toBeCloseTo(dL, 9);
            // con el tórax detrás no cuesta nada de más (detrás también hay gas)
            if (q.behind(pointOnLine(fr, CONVEX_C35, th, (run.first + 0.5) * step)) !== Tissue.Lung) expect(p.dL, tag).toBeGreaterThan(5);
            else thoraxBehind++;
          } else {
            // sin cortina en el camino: h0 y h1 son los de antes, espejo del diafragma incluido
            expect(got.mirrorSeg, tag).toBe(old.mirrorSeg);
            expect(got.gasSeg, tag).toBe(old.gasSeg);
            expect(got.boneSeg, tag).toBe(old.boneSeg);
            expect(got.gasKind, tag).toBe(old.gasKind);
            expect(got.mirrorR, tag).toBe(old.mirrorR);
            expect(got.dir, tag).toEqual(old.dir);
            if (got.pleura) {
              edgeLines++;
              // cerca del borde por el lado del hígado: la pleura existe aunque el rayo central no dé en el pulmón
              expect(got.pleura.dz, tag).toBeLessThan(1.5);
              expect(got.pleura.dz, tag).toBeGreaterThan(-CURTAIN_RECORD_MM);
              expect(got.pleura.dL).toBe(0);
              expect(got.pleura.curtainLast).toBe(-1);
            }
          }
        }
    }
    expect(curtainLines).toBeGreaterThan(150);
    expect(edgeLines).toBeGreaterThan(20);
    expect(thoraxBehind).toBeGreaterThan(20);
  });

  it('el espejo del diafragma queda igual donde la línea llega a la cúpula sin cruzar la cortina', () => {
    let mirrors = 0;
    for (const caudal of [0, 10]) {
      const cal = caliberOf(caudal);
      const q = sceneQuery(scene, cal);
      for (const { fr } of frames)
        for (let i = 0; i < CONVEX_C35.lines; i += 5) {
          const th = -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * (i + 0.5)) / CONVEX_C35.lines;
          const origin = pointOnLine(fr, CONVEX_C35, th, 0);
          const dir = lineDirection(fr, th);
          const got = transmissionHitsLine(q, origin, dir, depth, N, dbOf);
          if (curtainRunOf(q, fr, th, depth / N).first >= 0) continue;
          const old = hitsBefore61(q, origin, dir, depth, N);
          if (old.mirrorSeg < 0) continue;
          mirrors++;
          expect(got.mirrorSeg).toBe(old.mirrorSeg);
          expect(got.mirrorR).toBe(old.mirrorR);
          expect(got.dir).toEqual(old.dir);
          expect(got.gasKind).toBe(1);
        }
    }
    expect(mirrors).toBeGreaterThan(40);
  });

  it('A1 marca el pulmón de la cortina con 3 y los gemelos de A2 no lo toman por un impacto de gas', () => {
    expect(FRAG_TRANS_SEGMENTS).toContain('float curtainLast = h2.x >= 0.0 ? floor(h2.w / 4.0) - 1.0 : -1.0;');
    expect(FRAG_TRANS_SEGMENTS).toContain(`float lung = !reflected && float(s) <= curtainLast ? ${CURTAIN_GAS_KIND.toFixed(1)} : 1.0;`);
    expect(STEERED_PREFIX_GLSL).toContain('if (g.w > 0.5 && g.w < 2.5 && sGas < 0.0) { sGas = crossing ? sMirror : sRow; gasKind = g.w; }');
    // una línea con 3 segmentos de cortina bajo la pared y gas intestinal más hondo
    const grid = emptyGrid();
    for (const s of [24, 25, 26]) {
      grid.gas[s] = CURTAIN_GAS_KIND;
      grid.db[s] = 6.75;
    }
    grid.gas[90] = 2;
    const h = lineHits(grid, 0);
    expect(h.gasSeg).toBe(90);
    expect(h.gasKind).toBe(2);
    const pre = steeredPrefixDb(grid, { curvatureRadius: 60, halfSector: (34 * Math.PI) / 180 }, 0, 0, 120);
    expect(pre.sGas).toBeCloseTo((90 + 0.5) * grid.stepMm, 9);
    expect(pre.gasKind).toBe(2);
    // pero su pérdida sí se suma
    expect(pre.db).toBeCloseTo(3 * 6.75, 9);
  });

  it('la GLSL de A0 lleva la misma marcha que el gemelo', () => {
    for (const line of [
      'layout(location = 2) out vec4 h2;',
      'float inside = insideWallMm(m);',
      'if (inside >= 0.0 && prevInside < 0.0) {',
      'if (insideWallMm(toMaterial(origin + dir0 * mid)) >= 0.0) hi = mid; else lo = mid;',
      'float dz = lungCurtainEdgeMm(toMaterial(origin + dir0 * rp));',
      `if (dz > -${CURTAIN_RECORD_MM.toFixed(1)}) { pleuraD = rp; pleuraDz = dz; }`,
      'curtainRun = c.tissue == T_LUNG && mirrorSeg < 0.0 && (curtainRun || inLungCurtain(m, insideWallMm(m)));',
      'curtainDb += segmentDb(c.tissue, step) - segmentDb(classifyWith(m, false).tissue, step);',
      'curtainLast = float(s);',
      `h2 = pleuraD >= 0.0 ? vec4(pleuraD, pleuraDz, curtainDb, ${CURTAIN_GAS_KIND.toFixed(1)} + 4.0 * (curtainLast + 1.0)) : vec4(-1.0, 0.0, 0.0, 0.0);`,
    ])
      expect(FRAG_TRANS_HITS, line).toContain(line);
    expect(dbOf(Tissue.Lung, 1.125)).toBeCloseTo(GAS_DB_PER_CM * 0.1125, 12);
    expect(dbOf(Tissue.Liver, 1.125)).toBeCloseTo(2 * attenuationDbPerCm(Tissue.Liver, fB) * 0.1125, 12);
  });
});

describe('la rama de la cortina de la pasada B (mirada 0)', () => {
  it('lleva las expresiones del gemelo: tope de la transmisión, réplicas, serie, deslizamiento y transmisión de detrás', () => {
    for (const line of [
      'vec4 h2 = texelFetch(uHits2, ivec2(tc.x, 0), 0);',
      'float fAir = D > 0.0 ? curtainAirFraction(h2.y, D, dir0) : 0.0;',
      'float rCap = pleuraCapMm(max(D, 0.0), uDepth / float(ts.y));',
      'float tD = curtain ? texture(uTrans0, vec2(vUv.x, rCap / uDepth)).x : 0.0;',
      'float T = (curtain ? (under ? min(t0.x * gain, tD) : texture(uTrans0, vec2(vUv.x, min(r, rCap) / uDepth)).x) : t0.x) * coupling;',
      'float k = aLineOrder(r, D);',
      'air += vec2(seriesPow(G, k - 1.0) * tD * interfaceProfileEcho(IF_PLEURA_WALL, cosI, 1.0, k * D - r), 0.0);',
      'vec3 ser = under ? pleuraSeriesDepths(r, D) : vec3(0.0);',
      'bool series = under && gn * tD * PLEURA_WALL_FIELD_BOUND * coupling > PLEURA_SERIES_FLOOR;',
      'int j1 = series ? 3 : 1;',
      'float d = j == 0 ? r : (j == 1 ? ser.y : ser.z);',
      'float td = texture(uTrans0, vec2(vUv.x, min(d, rCap) / uDepth)).x;',
      'air += f * (j == 1 ? PLEURA_RP * PLEURA_RP * chi * chi * tD * tD / max(td, 1e-6) * gn : td * G * gn);',
      'if (under && slidingAmplitude(r - D) * tD * coupling > PLEURA_SERIES_FLOOR) air += slidingField(pD, r - D, 0.0) * tD;',
    ])
      expect(FRAG_RAWFIELD, line).toContain(line);
    // y las funciones compartidas son las del gemelo
    for (const line of [
      'float pleuraCapMm(float D, float step) { return (max(ceil(D / step - 0.5) - 1.0, 0.0) + 0.5) * step; }',
      'return vec3(n, (n + 2.0) * D - s, s - (n + 1.0) * D);',
      'float aLineOrder(float s, float D) { return max(1.0, floor(s / D + 0.5)); }',
      'float seriesPow(float g, float n) { return n < 0.5 ? 1.0 : pow(max(g, 1e-30), n); }',
    ])
      expect(PLEURA_GLSL, line).toContain(line);
    // los gemelos TS de esas funciones
    expect(pleuraSeriesDepths(70, 27)).toEqual({ n: 1, mirror: 3 * 27 - 70, forward: 70 - 2 * 27 });
    expect(aLineOrder(40, 27)).toBe(1);
    expect(aLineOrder(41, 27)).toBe(2);
    expect(mirrorGain(0.3, 0.6, 0.5, 0.1, 2)).toBeCloseTo(((PLEURA_RP * 0.5) ** 2 * 0.09) / 0.6 / 100, 12);
  });
});

describe('banco de la cortina (fidelity.ts): líneas, hígado puro, borde y deslizamiento', () => {
  // el sano en apnea inspiratoria (la cortina 30 mm abajo) en la ventana intercostal, sin GPU
  const patient = { ...clonePatient(NORMAL_ADULT), respiratoryPattern: 'apnea-inspiratory' as const };
  const scene = new AnatomyScene(patient);
  const anatomy = new AnatomyQuery(scene);
  const engine = new PhysiologyEngine(patient, scene.vesselAreas(), { historySeconds: 4 });
  for (let i = 0; i < Math.round(1 / engine.clock.dt); i++) engine.step();
  const sp = START_POINTS.find((p) => p.id === 'intercostal')!;
  const pose = { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: 0, tilt: 0 };
  const frame = probeFrame(pose, scene.torso, CONVEX_C35);
  const sim = {
    transducer: CONVEX_C35,
    profile: CONVEX_C35_PROFILE,
    bmode: { depthMm: 180, focusMm: 90, dynamicRangeDb: 70 },
    anatomy,
    frame,
    pose,
    sample: engine.sample,
  } as unknown as Simulator;

  it('la pleura de cada línea es la de A0 y su fracción de aire la de la pasada B; hay líneas enteras, de borde y en sombra', () => {
    expect(engine.sample.resp.diaphragmCaudalMm).toBeCloseTo(30, 6);
    const lines = curtainLines(sim, CONVEX_C35.lines);
    const cal = anatomy.caliberFor(engine.sample);
    const q = sceneQuery(scene, cal);
    let full = 0;
    let edge = 0;
    let shadowed = 0;
    for (let u = 0; u < CONVEX_C35.lines; u++) {
      const th = -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * (u + 0.5)) / CONVEX_C35.lines;
      const origin = pointOnLine(frame, CONVEX_C35, th, 0);
      const dir = lineDirection(frame, th);
      const a0 = transmissionHitsLine(q, origin, dir, 180, 160, (t, step) => segmentDb(t, step, 2.5));
      const c = lines[u];
      expect(c === null, `línea ${u}`).toBe(a0.pleura === null);
      if (!c) continue;
      // el banco pasa el punto al marco material (la pared apenas se mueve con la respiración: ≤ 10⁻⁵ mm)
      expect(c.D).toBeCloseTo(a0.pleura!.D, 4);
      expect(c.dz).toBeCloseTo(a0.pleura!.dz, 4);
      const lat = normalize(cross(frame.elevation, dir));
      const sg = curtainEdgeSigmaMm(
        elevSigmaMm(c.D, CONVEX_C35.elevationFocusMm) * Math.SQRT1_2,
        lateralSigmaMm(c.D, 90, CONVEX_BEAM),
        frame.elevation[2],
        lat[2],
      );
      expect(c.fAir).toBeCloseTo(curtainAirFraction(c.dz, sg), 9);
      if (c.fAir >= CURTAIN_FULL_AIR) full++;
      else if (c.fAir >= CURTAIN_MIN_AIR) edge++;
      if (c.shadowed) shadowed++;
    }
    expect(full).toBeGreaterThan(60);
    expect(edge).toBeGreaterThan(5);
    // en esta ventana los arcos costales son cartílago (cartilageFromPhi): sin sombra de hueso sobre la pleura
    expect(shadowed).toBe(0);
  });

  it('el hígado «puro» del banco y de la guarda de Rayleigh no entra bajo la pleura de la cortina ni en su borde', () => {
    const lines = curtainLines(sim, CONVEX_C35.lines);
    const clear = clearLiverGrid(sim, CONVEX_C35.lines, 3);
    let covered = 0;
    for (const c of lines) {
      // donde la cortina ya toca el nivel o la textura del hígado (la réplica de orden 2 a ≥ −12 dB de él)
      if (!c || c.fAir < CURTAIN_LIVER_MAX_AIR) continue;
      covered++;
      for (let r = c.D; r < 180; r += 0.5) expect(clear.at(c.u, r), `línea ${c.u} a ${r} mm`).toBe(false);
    }
    expect(covered).toBeGreaterThan(60);
    // y sigue habiendo hígado despejado fuera de ella
    let ok = 0;
    for (let u = 0; u < CONVEX_C35.lines; u++) for (let r = 30; r < 150; r += 2) if (clear.at(u, r)) ok++;
    expect(ok).toBeGreaterThan(200);
  });

  it('el ajuste del borde recupera centro y anchura de un borde gaussiano con moteado', () => {
    const rnd = rng(615);
    const synth: CurtainLine[] = [];
    for (let u = 0; u < 160; u++) {
      const z = -40 + u * 0.5;
      synth.push({
        u,
        D: 28,
        dz: z - 3,
        fAir: normalCdf((z - 3) / 4.2),
        sigmaMm: 4.2,
        incidenceDeg: 5,
        z,
        point: [0, 0, z],
        shadowed: false,
      });
    }
    // nivel: hígado 0 dB, pulmón −20 dB, con el borde en z = 3 (σ 4,2 mm) y ±1,5 dB de moteado por línea
    const level = (u: number) => -20 * normalCdf((synth[u].z - 3) / 4.2) + 3 * (rnd() - 0.5);
    const lv = synth.map((_, u) => level(u));
    const fit = curtainEdgeFit(synth, (u) => lv[u], 180, 180 / 1024)!;
    expect(fit.centerZMm).toBeCloseTo(3, 0);
    expect(fit.width1090Mm / edgeWidth1090Mm(4.2)).toBeGreaterThan(0.85);
    expect(fit.width1090Mm / edgeWidth1090Mm(4.2)).toBeLessThan(1.15);
    // a lo largo de la pleura, los cruces están a 0,5 mm: la misma anchura en la imagen
    expect(fit.width1090ImageMm).toBeCloseTo(fit.width1090Mm, 1);
    expect(fit.liverSideDb).toBeCloseTo(0, 0);
    expect(fit.lungSideDb).toBeCloseTo(-20, 0);
  });

  it('deslizamiento: la misma banda da 1; otra neblina bajo la pleura, ~0, con la pared quieta', () => {
    const rnd = rng(616);
    const lines = 32;
    const samples = 1024;
    const dr = 180 / samples;
    const cl: CurtainLine[] = Array.from({ length: lines }, (_, u) => ({
      u,
      D: 30,
      dz: 40,
      fAir: 1,
      sigmaMm: 4,
      incidenceDeg: 5,
      z: u,
      point: [0, 0, u] as Vec3,
      shadowed: false,
    }));
    const a = new Float32Array(lines * samples).map(() => rnd());
    const b = Float32Array.from(a, (x, i) => {
      const r = (Math.floor(i / lines) + 0.5) * dr;
      return r >= 32 && r <= 36 ? rnd() : x;
    });
    const f = (d: Float32Array) => ({ lines, samples, data: d });
    const same = slidingCorrelation(f(a), f(a), cl, cl, 180);
    expect(same.subPleural).toBeCloseTo(1, 9);
    expect(same.wall).toBeCloseTo(1, 9);
    const moved = slidingCorrelation(f(a), f(b), cl, cl, 180);
    expect(Math.abs(moved.subPleural)).toBeLessThan(0.1);
    expect(moved.wall).toBeCloseTo(1, 9);
    expect(moved.lines).toBe(lines);
  });
});
