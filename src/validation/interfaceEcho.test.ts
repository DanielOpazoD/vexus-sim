import { describe, expect, it } from 'vitest';
import { CLUTTER } from '../ultrasound/clutter';
import {
  INTERFACES,
  INTERFACE_COUNT,
  INTERFACE_GLSL_NAME,
  Interface,
  LAST_TUBE_INTERFACE,
  interfaceOfVessel,
  interfaceReflectivity,
} from '../anatomy/interfaces';
import { AnatomyScene } from '../anatomy/scene';
import { Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT } from '../cases';
import { VESSEL_IDS, VESSEL_META } from '../physiology/vessels';
import { CONVEX_C35 } from '../probe/probe';
import { CONVEX_BEAM, axialSigmaMm, lateralSigmaMm } from '../ultrasound/beamModel';
import { bmodeBeam, CONVEX_C35_PROFILE } from '../ultrasound/transducerProfile';
import { RETRO_FAT, quadratusSdf, retroFatSdf } from '../anatomy/organs/retroperitoneum';
import { sdDiaphragm } from '../anatomy/primitives';
import { DIAPHRAGM_THICKNESS_MM, TISSUES } from '../anatomy/tissues';
import {
  BONE_CRITICAL_SIN,
  BONE_IMPEDANCE_RATIO,
  FACET,
  IFACE_BETA,
  IFACE_K_DB,
  IFACE_K_RANGE_DB,
  IFACE_REACH_MM,
  IFACE_SHIFT_MM,
  IFACE_SIGMA_H_MM,
  IFACE_SLOPE_REF,
  INTERFACE_ECHO_GLSL,
  IFACE_DIFFUSE_PER_A,
  RETRO_PERITONEUM_GAIN,
  VALUE_NOISE_SD,
  WALL_ACROSS_MM,
  addInterfaceEcho,
  boneDiffuseWindow,
  curvatureCoherence,
  diffuseEchoField,
  faceProfile,
  faceSiteGain,
  fatAcrossWall,
  facetCosine,
  facetEchoField,
  facetLobe,
  facetSlope,
  facetTilt,
  facetTiltRms,
  interfaceAmplitude,
  interfaceEchoField,
  interfaceUniforms,
  reflectionCosine,
  roughnessCoherence,
} from '../ultrasound/interfaceEcho';
import { PLEURA_GLSL } from '../ultrasound/pleura';
import { FRAG_AXIAL, FRAG_LATERAL, FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED, LATERAL_PSF_GLSL } from '../ultrasound/shaders/passes.glsl';
import { scattererField, valueNoise } from '../ultrasound/speckleField';

/**
 * Eco de interfaz (decisión 57): la tabla de caras, cada factor del modelo contra su valor analítico y
 * una línea 1D con el moteado del repositorio y el pulso de la pasada C. El gemelo B→C→D completo, con
 * las escenas y las métricas del banco, está en `interfaceTwin.test.ts` (lento).
 */
const K0 = (2 * Math.PI) / CONVEX_BEAM.lambdaMm;
const db = (x: number) => 20 * Math.log10(x);
const cosDeg = (a: number) => Math.cos((a * Math.PI) / 180);
/** σ elevacional de una vía de la pasada B (`elevSigma`): 1,6 mm en el foco de la lente, z_R 45 mm. */
const elevSigma = (r: number) => 1.6 * Math.sqrt(1 + ((r - CONVEX_C35.elevationFocusMm) / 45) ** 2);

describe('Tabla de caras de interfaz', () => {
  it('Fresnel donde la tabla resuelve la cara y el suelo de colágeno en el resto', () => {
    expect(interfaceReflectivity(Interface.DuctLumen)).toBeCloseTo(0.0748, 4);
    expect(interfaceReflectivity(Interface.GallbladderLumen)).toBeCloseTo(0.0748, 4);
    expect(interfaceReflectivity(Interface.RenalCapsule)).toBeCloseTo(0.1377, 4);
    expect(interfaceReflectivity(Interface.PerirenalFat)).toBeCloseTo(0.1239, 4);
    expect(interfaceReflectivity(Interface.Pleura)).toBeCloseTo(0.9995, 4);
    // el salto de impedancia de pared/sangre (0,016) y cápsula/músculo (0,006) queda bajo el suelo
    expect(interfaceReflectivity(Interface.VeinLumen)).toBe(0.025);
    expect(interfaceReflectivity(Interface.IvcLumen)).toBe(0.025);
    expect(interfaceReflectivity(Interface.PortalLumen)).toBe(0.15);
    expect(interfaceReflectivity(Interface.ArteryLumen)).toBe(0.04);
    expect(interfaceReflectivity(Interface.LiverCapsule)).toBe(0.03);
    expect(interfaceReflectivity(Interface.DiaphragmLiver)).toBe(0.02);
    expect(interfaceReflectivity(Interface.None)).toBe(0);
  });

  it('una entrada y un nombre GLSL por cara; las de tubo primero; pendientes < 0,5', () => {
    const ids = Object.values(Interface).filter((v): v is Interface => typeof v === 'number');
    expect(ids).toHaveLength(INTERFACE_COUNT);
    expect(Object.keys(INTERFACES)).toHaveLength(INTERFACE_COUNT);
    expect(new Set(Object.values(INTERFACE_GLSL_NAME)).size).toBe(INTERFACE_COUNT);
    const tubes = [Interface.VeinLumen, Interface.IvcLumen, Interface.PortalLumen, Interface.ArteryLumen, Interface.DuctLumen];
    for (const i of ids) if (i !== Interface.None) expect(i <= LAST_TUBE_INTERFACE, Interface[i]).toBe(tubes.includes(i));
    for (const i of ids) if (i !== Interface.None) expect(INTERFACES[i].slopeRms, Interface[i]).toBeLessThan(0.5);
  });

  it('la cara de la luz de cada vaso: VCI, porta (por su pared), arteria y el resto vena', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    const seen = new Set<string>();
    for (const v of scene.vessels) {
      const system = VESSEL_META[v.id].system;
      const want =
        system === 'ivc'
          ? Interface.IvcLumen
          : v.wallTissue === Tissue.VesselWallPortal
            ? Interface.PortalLumen
            : VESSEL_META[v.id].kind === 'artery'
              ? Interface.ArteryLumen
              : Interface.VeinLumen;
      expect(interfaceOfVessel(v.id, v.wallTissue), v.id).toBe(want);
      if (system === 'portal') expect(v.wallTissue, v.id).toBe(Tissue.VesselWallPortal);
      seen.add(v.id);
    }
    // todos los vasos del modelo tienen tubo en la escena (y por tanto cara)
    for (const id of VESSEL_IDS) expect(seen.has(id), id).toBe(true);
    expect(interfaceOfVessel('ivcSupra', Tissue.VesselWallThin)).toBe(Interface.IvcLumen);
    expect(interfaceOfVessel('aorta', Tissue.ArteryWall)).toBe(Interface.ArteryLumen);
  });
});

describe('Factores del eco de interfaz', () => {
  it('lóbulo de Kirchhoff con conservación de energía: F(0; s_ref) = 1, F(0; s) = s_ref/s y monótono', () => {
    expect(facetLobe(1, IFACE_SLOPE_REF)).toBeCloseTo(1, 12);
    for (const i of [Interface.IvcLumen, Interface.PortalLumen, Interface.LiverCapsule, Interface.PerirenalFat]) {
      const s = INTERFACES[i].slopeRms;
      expect(facetLobe(1, s)).toBeCloseTo(IFACE_SLOPE_REF / s, 12);
    }
    for (let i = 1; i < INTERFACE_COUNT; i++) {
      const id: Interface = i;
      const s = INTERFACES[id].slopeRms;
      let prev = Infinity;
      for (let a = 0; a <= 85; a += 0.5) {
        const f = facetLobe(cosDeg(a), s);
        expect(f, `${Interface[id]} a ${a}°`).toBeLessThanOrEqual(prev);
        prev = f;
      }
    }
    // la VSH: brillante solo dentro de ±12°
    expect(db(facetLobe(cosDeg(10), 0.14))).toBeCloseTo(-3.2, 0);
    expect(Math.abs(db(facetLobe(cosDeg(10), 0.14)) + 3.2)).toBeLessThan(0.3);
    expect(Math.abs(db(facetLobe(cosDeg(20), 0.14)) + 13.6)).toBeLessThan(0.5);
  });

  it('rugosidad fina: la pleura conserva −28,7 dB de parte coherente a 0°', () => {
    const chi = roughnessCoherence(1, INTERFACES[Interface.Pleura].roughnessMm, K0);
    expect(Math.abs(db(chi) + 28.7)).toBeLessThan(0.2);
    expect(roughnessCoherence(1, 0, K0)).toBe(1);
  });

  it('coherencia de curvatura: 1 en un plano, VSH r 5 a 80 mm y la integral de fase estacionaria', () => {
    expect(curvatureCoherence(0.7, 1.1, 0, 0, K0)).toBe(1);
    const sl = lateralSigmaMm(80, 90);
    const se = elevSigma(80) / Math.SQRT2;
    // longitudinal: la curvatura va por la elevación; transversal: por el lateral
    expect(Math.abs(db(curvatureCoherence(sl, se, 0, 1 / 5, K0)) + 8.7)).toBeLessThan(0.2);
    expect(Math.abs(db(curvatureCoherence(sl, se, 1 / 5, 0, K0)) + 4.4)).toBeLessThan(0.2);
    // |∫e^{−x²/2σ²}·e^{i·k0·κx²}dx| / ∫e^{−x²/2σ²}dx, numérica, por cada eje (C es su producto)
    const numeric = (sigma: number, kappa: number) => {
      let re = 0;
      let im = 0;
      let n = 0;
      for (let x = -8 * sigma; x <= 8 * sigma; x += sigma / 400) {
        const g = Math.exp((-x * x) / (2 * sigma * sigma));
        re += g * Math.cos(K0 * kappa * x * x);
        im += g * Math.sin(K0 * kappa * x * x);
        n += g;
      }
      return Math.hypot(re, im) / n;
    };
    for (const [sigma, kappa] of [
      [sl, 1 / 5],
      [se, 1 / 5],
      [se, 1 / 1.5],
      [sl, 1 / 30],
    ]) {
      const want = db(numeric(sigma, kappa));
      expect(Math.abs(db(curvatureCoherence(sigma, 1, kappa, 0, K0)) - want)).toBeLessThan(0.05);
    }
  });

  it('perfil de integral unidad a cualquier profundidad y posición, de dos lados y de uno', () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const ones: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const depth = 60 + 180 * rnd();
      const dr = depth / 1024;
      const x0 = rnd() * dr;
      let two = 0;
      let one = 0;
      for (let k = -40; k <= 40; k++) {
        const x = k * dr - x0;
        two += faceProfile(x, true) * dr;
        // una cara: solo el dueño (x ≥ 0) la conoce y el perfil entra 2,5σh en él
        if (x >= 0) one += faceProfile(x, false) * dr;
      }
      expect(Math.abs(two - 1), `dos lados, ${depth.toFixed(0)} mm`).toBeLessThan(0.01);
      ones.push(one);
    }
    // de un lado el perfil se corta a −2,5σh (0,6 % de cola) y el escalón del corte (4 % del pico) hace
    // que la suma dependa de la posición de la cara entre muestras: hasta ±2,7 % con dr de 0,23 mm. En
    // media conserva la unidad; tras el pulso ese rizado es de 0,35–0,71 dB, el mismo que con dos lados
    // (interfaceTwin.test.ts)
    const mean = ones.reduce((a, b) => a + b) / ones.length;
    expect(Math.abs(mean - 1)).toBeLessThan(0.01);
    for (const one of ones) expect(Math.abs(one - 1)).toBeLessThan(0.03);
    expect(faceProfile(IFACE_REACH_MM + 1e-6, true)).toBe(0);
    expect(faceProfile(IFACE_SHIFT_MM, false)).toBeCloseTo(1 / (IFACE_SIGMA_H_MM * Math.sqrt(2 * Math.PI)), 12);
  });

  it('una línea con el moteado del repositorio y el pulso de C: el cociente eco/moteado no depende de dr', () => {
    // pasada C: gaussiana de σ = max(0,6; σ_pulso/dr) muestras, truncada a ±12 y de energía unidad, con el pulso del
    // fundamental a la profundidad de la cara (80 mm: el de la cara estirado por la bajada, decisión 84)
    const sigmaPulse = axialSigmaMm(80, bmodeBeam(CONVEX_C35_PROFILE, { harmonic: false }));
    const kernel = (dr: number) => {
      const s = Math.max(0.6, sigmaPulse / dr);
      const R = Math.min(12, Math.ceil(2.5 * s));
      const w = Array.from({ length: 2 * R + 1 }, (_, k) => Math.exp(-0.5 * ((k - R) / s) ** 2));
      const n = Math.hypot(...w);
      return { R, w: w.map((x) => x / n) };
    };
    const ratios: number[] = [];
    for (const depth of [100, 180, 240]) {
      const dr = depth / 1024;
      const { R, w } = kernel(dr);
      let s2 = 0;
      let n = 0;
      for (let line = 0; line < 120; line++) {
        const f = Array.from({ length: 200 }, (_, v) => scattererField([3.7 * line + 0.31, 40 + (v + 0.5) * dr, 1.3 * line], 0.42, 5.5));
        for (let v = R; v < 200 - R; v++) {
          let re = 0;
          let im = 0;
          for (let k = -R; k <= R; k++) {
            re += w[k + R] * f[v + k][0];
            im += w[k + R] * f[v + k][1];
          }
          s2 += re * re + im * im;
          n++;
        }
      }
      const peaks: number[] = [];
      const widths: number[] = [];
      for (let j = 0; j < 20; j++) {
        const rFace = 80 + (j / 20) * dr;
        const v0 = Math.floor(rFace / dr) - 30;
        const e = Array.from({ length: 60 }, (_, v) => faceProfile((v0 + v + 0.5) * dr - rFace, true));
        const out = Array.from({ length: 60 - 2 * R }, (_, i) => Math.abs(w.reduce((a, wk, k) => a + wk * e[i + k], 0)));
        const pk = Math.max(...out);
        const i = out.indexOf(pk);
        let lo = i;
        while (out[lo] > pk / 2) lo--;
        let hi = i;
        while (out[hi] > pk / 2) hi++;
        const xl = lo + (pk / 2 - out[lo]) / (out[lo + 1] - out[lo]);
        const xh = hi - 1 + (out[hi - 1] - pk / 2) / (out[hi - 1] - out[hi]);
        peaks.push(pk);
        widths.push((xh - xl) * dr);
      }
      ratios.push(db(peaks.reduce((a, b) => a + b) / peaks.length / Math.sqrt(s2 / n)));
      // anchura del eco: 2,355·√(σ_pulso² + σh²) = 0,77 mm
      const width = 2.3548 * Math.hypot(sigmaPulse, IFACE_SIGMA_H_MM);
      expect(width).toBeCloseTo(0.773, 2);
      if (depth === 180) expect(Math.abs(widths.reduce((a, b) => a + b) / widths.length / width - 1)).toBeLessThan(0.05);
    }
    for (const r of ratios) expect(Math.abs(r - ratios[1]), ratios.map((x) => x.toFixed(2)).join(' / ')).toBeLessThan(0.5);
  });
});

describe('Pleura desde el espejo', () => {
  it('el coseno de la reflexión de A0 es |d·n| y la pleura queda centrada en el cruce, sin curvatura', () => {
    let seed = 99;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 100; i++) {
      const unit = (v: number[]) => v.map((x) => x / Math.hypot(...v));
      const d0 = unit([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]);
      const n = unit([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]);
      const dn = d0[0] * n[0] + d0[1] * n[1] + d0[2] * n[2];
      const dR = d0.map((x, j) => x - 2 * dn * n[j]);
      expect(reflectionCosine(d0, dR)).toBeCloseTo(Math.abs(dn), 9);
    }
    // de dos lados: su pico está en el cruce, con la parte coherente de su rugosidad (−28,7 dB)
    const p = INTERFACES[Interface.Pleura];
    expect(p.twoSided).toBe(true);
    const at = (delta: number) => interfaceEchoField(Interface.Pleura, 1, 1, delta, K0);
    expect(at(0)).toBeGreaterThan(at(0.05));
    expect(at(0.05)).toBeCloseTo(at(-0.05), 9);
    // (los uniforms van en float32: acuerdo relativo 1e-6)
    const want = interfaceAmplitude(Interface.Pleura) * roughnessCoherence(1, p.roughnessMm, K0) * faceProfile(0, true);
    expect(at(0) / want).toBeCloseTo(1, 6);
    expect(INTERFACE_ECHO_GLSL).toContain('float pleuraEcho(float delta, vec3 d0, vec3 dR)');
    expect(INTERFACE_ECHO_GLSL).toContain('interfaceProfileEcho(IF_PLEURA, sqrt(max(0.0, 0.5 * (1.0 - dot(d0, dR)))), 1.0, delta)');
  });
});

describe('Uniforms y GLSL del eco de interfaz', () => {
  it('uIface empaqueta (β·10^(K/20)·R_ef·s_ref/s, 2k0σz, 1/(4s²), dos lados) y el gemelo lo lee igual', () => {
    const u = interfaceUniforms(K0);
    expect(u).toHaveLength(4 * INTERFACE_COUNT);
    expect([...u.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
    for (let i = 1; i < INTERFACE_COUNT; i++) {
      const id: Interface = i;
      const p = INTERFACES[id];
      const a = IFACE_BETA * 10 ** (IFACE_K_DB / 20) * interfaceReflectivity(i) * (IFACE_SLOPE_REF / p.slopeRms);
      expect(u[4 * i]).toBeCloseTo(Math.fround(a), 6);
      expect(interfaceAmplitude(i)).toBeCloseTo(a, 12);
      expect(u[4 * i + 1]).toBeCloseTo(2 * K0 * p.roughnessMm, 5);
      expect(u[4 * i + 2]).toBeCloseTo(1 / (4 * p.slopeRms ** 2), 4);
      expect(u[4 * i + 3]).toBe(p.twoSided ? 1 : 0);
    }
    // el gemelo es el producto de los factores con la amplitud de la tabla
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let n = 0; n < 200; n++) {
      const id: Interface = 1 + Math.floor(rnd() * (INTERFACE_COUNT - 1));
      const cosI = 0.1 + 0.9 * rnd();
      const delta = (rnd() - 0.2) * 1.2;
      const curv = 0.3 + 0.7 * rnd();
      const p = INTERFACES[id];
      const want =
        interfaceAmplitude(id) *
        (facetLobe(cosI, p.slopeRms) / (IFACE_SLOPE_REF / p.slopeRms)) *
        roughnessCoherence(cosI, p.roughnessMm, K0) *
        curv *
        faceProfile(delta, p.twoSided);
      expect(interfaceEchoField(id, cosI, curv, delta, K0)).toBeCloseTo(want, 4);
    }
    // K se calibra en la GPU dentro de su rango; fuera es un error de modelo
    expect(IFACE_K_DB).toBeGreaterThanOrEqual(IFACE_K_RANGE_DB[0]);
    expect(IFACE_K_DB).toBeLessThanOrEqual(IFACE_K_RANGE_DB[1]);
    expect(interfaceUniforms(K0, 57)[4 * Interface.VeinLumen] / u[4 * Interface.VeinLumen]).toBeCloseTo(10 ** (2 / 20), 5);
  });

  it('las constantes entran interpoladas y la pasada B dibuja el eco (sin el término especular de antes)', () => {
    expect(INTERFACE_ECHO_GLSL).toContain(`uniform vec4 uIface[${INTERFACE_COUNT}];`);
    expect(INTERFACE_ECHO_GLSL).toContain(`#define IFACE_SIGMA_H ${IFACE_SIGMA_H_MM.toFixed(4)}`);
    expect(INTERFACE_ECHO_GLSL).toContain(`#define IFACE_SHIFT ${IFACE_SHIFT_MM.toFixed(4)}`);
    expect(INTERFACE_ECHO_GLSL).toContain(`#define IFACE_REACH ${IFACE_REACH_MM.toFixed(4)}`);
    // ningún identificador TS suelto en la GLSL
    expect(INTERFACE_ECHO_GLSL.replace(/\/\/.*$/gm, '')).not.toMatch(/\bINTERFACE_COUNT\b|\bIFACE_[A-Z_]+_MM\b/);
    expect(FRAG_RAWFIELD).toContain(INTERFACE_ECHO_GLSL);
    expect(FRAG_RAWFIELD).toContain(LATERAL_PSF_GLSL);
    expect(FRAG_LATERAL).toContain(LATERAL_PSF_GLSL);
    // la muestra de la imagen (decisión 61: `mediumField`, una vez y fuera de bucles)
    expect(FRAG_RAWFIELD).toContain('vec2 e = interfaceEcho(c, m, dir, r, se, w, withCurtain);');
    // la especular va aparte (decisión 88): la pasada B la multiplica por la de sus pares en la apertura (decisión 91)
    expect(FRAG_RAWFIELD).toContain('spec = e.x;');
    expect(FRAG_RAWFIELD).toContain('return field * (1.0 + e.y / max(length(field), 1e-6));');
    expect(FRAG_RAWFIELD).not.toMatch(/uSpecGain|pow\(cosI, 4\.0\)/);
    // β se midió con estas pasadas C y D: si cambian, hay que re-derivarlo (interfaceTwin.test.ts). El pedestal de
    // lóbulos laterales de la decisión 76 lleva una fase antisimétrica: sobre un reflector continuo sus pares ±k se
    // cancelan y β no cambia (≤ 0,5 %, `clutter.test.ts`; la ganancia coherente del gemelo, `lateralCoherentGain`, lo incluye)
    expect(FRAG_AXIAL).toContain('k <= 12');
    expect(FRAG_LATERAL).toContain('max(0.35,');
    expect(FRAG_LATERAL).toContain(`k <= ${CLUTTER.lateralMaxLines}`);
  });
});

/**
 * Decisión 65: la especular de la faceta (normal inclinada por un campo anclado, lóbulo propio s_f y χ(0)) y la
 * componente difusa. Todas estas pruebas fallan con el eco de la decisión 57 (no hay facetas, ni difusa, y χ es
 * la de la incidencia media).
 */
describe('Facetas y componente difusa de las caras (decisión 65)', () => {
  let seed = 4242;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const randomPoint = (): [number, number, number] => [400 * rnd() - 200, 400 * rnd() - 200, 400 * rnd() - 200];
  const unit = (v: number[]) => v.map((x) => x / Math.hypot(...v));
  /** Rayo a θ grados de la normal n = +y, en el plano xy. */
  const rayAt = (deg: number) => [Math.sin((deg * Math.PI) / 180), -Math.cos((deg * Math.PI) / 180), 0];

  it('VALUE_NOISE_SD es la desviación del ruido de valor en un punto al azar (normaliza σ_t)', () => {
    let s1 = 0;
    let s2 = 0;
    const n = 60_000;
    for (let i = 0; i < n; i++) {
      const v = valueNoise(randomPoint(), 57.3) - 0.5;
      s1 += v;
      s2 += v * v;
    }
    const sd = Math.sqrt(s2 / n - (s1 / n) ** 2);
    expect(Math.abs(sd / VALUE_NOISE_SD - 1)).toBeLessThan(0.03);
  });

  it('la inclinación: media nula, σ_t de la cara por componente, componentes y caras independientes, anclada y correlada 1,5–3 mm', () => {
    const n = 20_000;
    const acc = [0, 0, 0];
    const acc2 = [0, 0, 0];
    let xy = 0;
    let faces = 0;
    for (let i = 0; i < n; i++) {
      const m = randomPoint();
      const t = facetTilt(m, Interface.RenalCapsule);
      for (let k = 0; k < 3; k++) {
        acc[k] += t[k];
        acc2[k] += t[k] * t[k];
      }
      xy += t[0] * t[1];
      faces += t[0] * facetTilt(m, Interface.LiverCapsule)[0];
      // anclada: la misma en el mismo punto material
      if (i < 50) expect(facetTilt(m, Interface.RenalCapsule)).toEqual(t);
    }
    const st = facetTiltRms(INTERFACES[Interface.RenalCapsule].slopeRms);
    const rms2 = st ** 2;
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(acc[k] / n)).toBeLessThan(0.05 * st);
      expect(Math.abs(Math.sqrt(acc2[k] / n) / st - 1)).toBeLessThan(0.06);
    }
    expect(Math.abs(xy / n / rms2)).toBeLessThan(0.05);
    expect(Math.abs(faces / n / (st * facetTiltRms(INTERFACES[Interface.LiverCapsule].slopeRms)))).toBeLessThan(0.05);
    // correlación a media célula (1,5 mm) y a una célula (3 mm): unos milímetros, del orden del haz lateral
    const corr = (lag: number) => {
      let c = 0;
      for (let i = 0; i < 5000; i++) {
        const m = randomPoint();
        c += facetTilt(m, Interface.IvcLumen)[2] * facetTilt([m[0] + lag, m[1], m[2]], Interface.IvcLumen)[2];
      }
      return c / 5000 / facetTiltRms(INTERFACES[Interface.IvcLumen].slopeRms) ** 2;
    };
    expect(corr(FACET.cellMm / 2)).toBeGreaterThan(0.5);
    expect(corr(FACET.cellMm / 2)).toBeLessThan(0.85);
    expect(corr(FACET.cellMm)).toBeLessThan(0.3);
    // unos grados en las caras lisas (3–6°) y la misma fracción de su pendiente en las anchas (≤ 14°): la faceta
    // conserva 0,87 de la pendiente (0,78 la VSH, la más lisa), así que la media sobre las inclinaciones es el lóbulo del
    // conjunto. La GLSL no acota s_f² = s² − σ_t²: una cara con s ≤ tan 5° daría NaN, y esta prueba la para (s_f ≥ 0,6·s)
    const deg = (x: number) => (Math.atan(x) * 180) / Math.PI;
    expect(deg(FACET.tiltMin)).toBeGreaterThanOrEqual(3);
    expect(deg(FACET.tiltMin)).toBeLessThanOrEqual(6);
    for (const id of [Interface.VeinLumen, Interface.IvcLumen, Interface.LiverCapsule, Interface.RibCortex])
      expect(deg(facetTiltRms(INTERFACES[id].slopeRms)), Interface[id]).toBeLessThanOrEqual(6.5);
    for (let i = 1; i < INTERFACE_COUNT; i++) {
      const id: Interface = i;
      const sl = INTERFACES[id].slopeRms;
      expect(deg(facetTiltRms(sl)), Interface[id]).toBeLessThanOrEqual(14);
      expect(sl, Interface[id]).toBeGreaterThan(1.25 * FACET.tiltMin);
      expect(facetSlope(sl) / sl, Interface[id]).toBeGreaterThanOrEqual(0.6);
    }
  });

  it('facetCosine usa solo la parte tangente de la inclinación y es |d·n| sin inclinación', () => {
    const n = unit([0.3, 1, -0.2]);
    const d = unit([0.5, -1, 0.1]);
    const dn = Math.abs(n[0] * d[0] + n[1] * d[1] + n[2] * d[2]);
    expect(facetCosine(n, d, [0, 0, 0])).toBeCloseTo(dn, 12);
    // una inclinación paralela a la normal no cambia nada
    expect(
      facetCosine(
        n,
        d,
        n.map((x) => 0.3 * x),
      ),
    ).toBeCloseTo(dn, 12);
  });

  it('en media sobre las facetas la potencia es la del lóbulo del conjunto con χ(0): K y R_ef no cambian en media', () => {
    const points = Array.from({ length: 6000 }, randomPoint);
    for (const id of [Interface.VeinLumen, Interface.IvcLumen, Interface.LiverCapsule, Interface.PortalLumen, Interface.DeepFascia]) {
      const p = INTERFACES[id];
      expect(facetSlope(p.slopeRms), Interface[id]).toBeGreaterThan(0.1);
      for (const deg of [0, 5, 10, 15, 20]) {
        const d = rayAt(deg);
        let e2 = 0;
        for (const m of points) {
          const e = facetEchoField(id, facetCosine([0, 1, 0], d, facetTilt(m, id)), 1, 0, K0);
          e2 += e * e;
        }
        const c = cosDeg(deg);
        const ensemble =
          interfaceAmplitude(id) *
          (facetLobe(c, p.slopeRms) / (IFACE_SLOPE_REF / p.slopeRms)) *
          roughnessCoherence(1, p.roughnessMm, K0) *
          faceProfile(0, p.twoSided);
        const err = 10 * Math.log10(e2 / points.length) - db(ensemble);
        expect(Math.abs(err), `${Interface[id]} a ${deg}°: ${err.toFixed(2)} dB`).toBeLessThan(1);
      }
    }
  });

  it('la línea se fragmenta más cuanto más oblicua: el CV de la especular sobre las facetas crece con la incidencia', () => {
    const points = Array.from({ length: 4000 }, randomPoint);
    const cv = (id: Interface, deg: number) => {
      const v = points.map((m) => facetEchoField(id, facetCosine([0, 1, 0], rayAt(deg), facetTilt(m, id)), 1, 0, K0));
      const mu = v.reduce((a, b) => a + b, 0) / v.length;
      return Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / v.length) / mu;
    };
    for (const id of [Interface.VeinLumen, Interface.LiverCapsule, Interface.RenalCapsule]) {
      const c = [0, 10, 20, 30].map((deg) => cv(id, deg));
      // de frente, casi continua (≤ 0,35); lejos de la normal, fragmentada (≥ 0,6 a 20–30°)
      expect(c[0], Interface[id]).toBeLessThan(0.35);
      expect(c[1], Interface[id]).toBeGreaterThan(c[0]);
      expect(c[2], Interface[id]).toBeGreaterThan(c[1]);
      expect(Math.max(c[2], c[3]), Interface[id]).toBeGreaterThan(0.6);
    }
  });

  it('χ(0): una cara rugosa ya no gana brillo oblicua (con χ(θ), la fascia perdía solo 1 dB de 0° a 30°)', () => {
    const id = Interface.DeepFascia;
    const p = INTERFACES[id];
    const mean = (deg: number) => facetLobe(cosDeg(deg), p.slopeRms) * roughnessCoherence(1, p.roughnessMm, K0);
    const old = (deg: number) => facetLobe(cosDeg(deg), p.slopeRms) * roughnessCoherence(cosDeg(deg), p.roughnessMm, K0);
    // el modelo de la 57 a 30°: el lóbulo baja y χ(θ) sube casi lo mismo
    expect(db(old(30) / old(0))).toBeGreaterThan(-1.5);
    // el de la 65 (la media sobre las facetas): el lóbulo solo
    expect(db(mean(30) / mean(0))).toBeLessThan(-5);
    // y la especular de la faceta no lee cosθ en su χ
    expect(INTERFACE_ECHO_GLSL).toContain('faceEcho(c.iface, cosF, min(1.0 - 4.0 * FACET_TILT2 * P.z, 1.0 - FACET_RHO2), 1.0, curv, g)');
  });

  it('la difusa: κ_d·R_ef·√(1 − χ(0)²)·cosθ con el perfil de la cara de pico 1, incoherente y más débil que la especular de frente', () => {
    for (const id of [Interface.IvcLumen, Interface.LiverCapsule, Interface.RenalCapsule, Interface.DeepFascia, Interface.Peritoneum]) {
      const p = INTERFACES[id];
      const x = Math.fround(2 * K0 * p.roughnessMm);
      const want = FACET.diffuse * interfaceReflectivity(id) * Math.sqrt(1 - Math.exp(-x * x));
      const shift = p.twoSided ? 0 : IFACE_SHIFT_MM;
      expect(diffuseEchoField(id, 1, shift, K0)).toBeCloseTo(want, 9);
      // Lambert en amplitud
      expect(diffuseEchoField(id, 0.5, shift, K0)).toBeCloseTo(0.5 * want, 9);
      // el perfil de la cara: fuera de su alcance, nada
      expect(diffuseEchoField(id, 1, shift + IFACE_REACH_MM + 1e-6, K0)).toBe(0);
    }
    expect(diffuseEchoField(Interface.None, 1, 0, K0)).toBe(0);
    // de frente, en el pico de su perfil, la difusa por muestra queda 21–32 dB bajo la especular en las caras lisas
    // (vasos, cápsula hepática: su nivel en la imagen, en el gemelo, interfaceTwin.test.ts), 11 dB en la cápsula renal
    // (σz 0,06) y es comparable en las fascias y el peritoneo, cuya rugosidad deja ~1 % de energía coherente. La
    // rugosidad fina la reparte, así que una fascia (σz 0,075) tiene 2–3 veces más difusa que la cápsula por unidad de R_ef
    const peak = (id: Interface) => (INTERFACES[id].twoSided ? 0 : IFACE_SHIFT_MM);
    const margin = (id: Interface) => db(facetEchoField(id, 1, 1, peak(id), K0) / diffuseEchoField(id, 1, peak(id), K0));
    for (const id of [Interface.VeinLumen, Interface.IvcLumen, Interface.LiverCapsule])
      expect(margin(id), Interface[id]).toBeGreaterThan(20);
    expect(margin(Interface.RenalCapsule)).toBeGreaterThan(10);
    for (const id of [Interface.DeepFascia, Interface.Transversalis, Interface.Peritoneum])
      expect(Math.abs(margin(id)), Interface[id]).toBeLessThan(8);
    // escala con K como la especular (la GLSL la saca del uniform A)
    expect(diffuseEchoField(Interface.DeepFascia, 1, peak(Interface.DeepFascia), K0, IFACE_K_DB + 6)).toBeCloseTo(
      diffuseEchoField(Interface.DeepFascia, 1, peak(Interface.DeepFascia), K0) * 10 ** (6 / 20),
      9,
    );
    const perR = (id: Interface) => diffuseEchoField(id, 1, peak(id), K0) / interfaceReflectivity(id);
    expect(perR(Interface.DeepFascia) / perR(Interface.LiverCapsule)).toBeGreaterThan(1.3);
    expect(perR(Interface.DeepFascia) / perR(Interface.IvcLumen)).toBeGreaterThan(1.8);
    // la suma de la muestra: la especular real y la difusa sobre el fasor unidad del moteado
    const f: [number, number] = [0.3, -0.4];
    const [re, im] = addInterfaceEcho(f, 2, 1.5);
    expect(re).toBeCloseTo(0.3 * (1 + 1.5 / 0.5) + 2, 12);
    expect(im).toBeCloseTo(-0.4 * (1 + 1.5 / 0.5), 12);
    expect(addInterfaceEcho([0, 0], 2, 1.5)).toEqual([2, 0]);
  });

  it('decisión 88: la difusa de la cortical costal cae con la transmisión de la onda longitudinal y se apaga en el ángulo crítico', () => {
    // el ángulo crítico músculo → hueso de TISSUES: 26,9°
    expect((Math.asin(BONE_CRITICAL_SIN) * 180) / Math.PI).toBeCloseTo(26.9, 1);
    const cos = (deg: number) => Math.cos((deg * Math.PI) / 180);
    const shift = IFACE_SHIFT_MM;
    const rib = (deg: number) => diffuseEchoField(Interface.RibCortex, cos(deg), shift, K0);
    // la transmisión de energía de dos fluidos con las impedancias de TISSUES, T_E(θ)/T_E(0), sobre Lambert: de frente,
    // 1; a 20°, −2 dB; a 26°, −8,6 dB; desde el ángulo crítico, nada
    const tE = (deg: number): number => {
      const z1 = TISSUES[Tissue.Muscle].c * TISSUES[Tissue.Muscle].rho;
      const z2 = TISSUES[Tissue.Bone].c * TISSUES[Tissue.Bone].rho;
      const st = Math.sin((deg * Math.PI) / 180) / BONE_CRITICAL_SIN;
      if (st >= 1) return 0;
      const ct = Math.sqrt(1 - st * st);
      return (4 * z1 * z2 * cos(deg) * ct) / (z2 * cos(deg) + z1 * ct) ** 2;
    };
    expect(boneDiffuseWindow(Interface.RibCortex, 1)).toBe(1);
    for (const deg of [10, 20, 25, 26, 26.8])
      expect(boneDiffuseWindow(Interface.RibCortex, cos(deg)), `${deg}°`).toBeCloseTo(tE(deg) / tE(0), 9);
    expect(db(rib(20) / (cos(20) * rib(0)))).toBeCloseTo(-2.04, 1);
    expect(db(rib(26) / (cos(26) * rib(0)))).toBeLessThan(-8);
    for (const deg of [27, 40, 60, 80]) expect(rib(deg), `${deg}°`).toBe(0);
    // con Lambert solo seguía a más de la mitad de su valor de frente a 60°: dibujaba el contorno de la costilla
    expect(cos(60) * rib(0)).toBeGreaterThan(0.45 * rib(0));
    // el resto de caras no cambia, tampoco el pericondrio (el cartílago transmite)
    for (const id of [Interface.DeepFascia, Interface.Perichondrium, Interface.LiverCapsule])
      expect(diffuseEchoField(id, cos(60), INTERFACES[id].twoSided ? 0 : shift, K0), Interface[id]).toBeCloseTo(
        0.5 * diffuseEchoField(id, 1, INTERFACES[id].twoSided ? 0 : shift, K0),
        9,
      );
  });

  it('la cara interna de la pared con grasa detrás (grasa con grasa) baja a una fascia; contra un órgano o fuera, no', () => {
    // la pared posterolateral de la ventana renal: dentro del compartimento, lejos de la cúpula y del cuadrado lumbar
    const scene = new AnatomyScene(NORMAL_ADULT);
    const inside: [number, number, number] = [-(RETRO_FAT.xLateral - 20), RETRO_FAT.yLateral - 5, -85];
    const outside: [number, number, number] = [-40, 60, -20];
    expect(retroFatSdf(inside)).toBeLessThan(0);
    expect(retroFatSdf(outside)).toBeGreaterThan(0);
    expect(sdDiaphragm(inside, scene.diaphragm, scene.torso)).toBeGreaterThan(DIAPHRAGM_THICKNESS_MM + WALL_ACROSS_MM);
    expect(quadratusSdf(inside, 0, 1e3)).toBeGreaterThan(0);
    // lo que toca la pared: la grasa (el hígado lejos) o el hígado a menos del margen (su área desnuda)
    const fat = { liverSdf: () => 10, diaphragm: scene.diaphragm, torso: scene.torso };
    const liver = { ...fat, liverSdf: () => WALL_ACROSS_MM - 0.1 };
    expect(fatAcrossWall(inside, fat)).toBe(true);
    expect(faceSiteGain(Interface.Peritoneum, inside, fat)).toBe(RETRO_PERITONEUM_GAIN);
    expect(RETRO_PERITONEUM_GAIN * interfaceReflectivity(Interface.Peritoneum)).toBeCloseTo(0.03, 9);
    expect(faceSiteGain(Interface.Peritoneum, inside, liver)).toBe(1);
    expect(faceSiteGain(Interface.Peritoneum, outside, fat)).toBe(1);
    for (const id of [Interface.Transversalis, Interface.LiverCapsule, Interface.RenalCapsule])
      expect(faceSiteGain(id, inside, fat)).toBe(1);
    // la cúpula (diafragma o pulmón) y el cuadrado lumbar contra la pared también la dejan como está
    const dome: [number, number, number] = [inside[0], inside[1], inside[2]];
    for (let z = inside[2]; z < 200 && sdDiaphragm(dome, scene.diaphragm, scene.torso) > DIAPHRAGM_THICKNESS_MM; z += 1) dome[2] = z;
    if (retroFatSdf(dome) < 0) expect(fatAcrossWall(dome, fat)).toBe(false);
  });

  it('GLSL: las constantes interpoladas, la faceta, la difusa y su suma en los dos programas de B', () => {
    const echo = INTERFACE_ECHO_GLSL.replace(/\s+/g, ' ');
    expect(echo).toContain(`#define FACET_CELL ${FACET.cellMm.toFixed(4)}`);
    expect(echo).toContain(`#define FACET_GAIN ${(1 / VALUE_NOISE_SD).toFixed(6)}`);
    expect(echo).toContain(`#define FACET_TILT2 ${(FACET.tiltMin * FACET.tiltMin).toFixed(8)}`);
    expect(echo).toContain(`#define FACET_RHO2 ${(FACET.tiltRatio * FACET.tiltRatio).toFixed(8)}`);
    expect(echo).toContain(`#define IFACE_DIFFUSE ${IFACE_DIFFUSE_PER_A.toPrecision(6)}`);
    expect(echo).toContain(`#define IFACE_RETRO_PERITONEUM ${RETRO_PERITONEUM_GAIN.toFixed(6)}`);
    expect(echo).toContain(`#define IFACE_ACROSS ${WALL_ACROSS_MM.toFixed(4)}`);
    // la difusa de la GLSL sale del uniform (P.x·2s, sin tabla): κ_d·R_ef en todas las caras, en float32
    const u = interfaceUniforms(K0);
    for (let i = 1; i < INTERFACE_COUNT; i++) {
      const id: Interface = i;
      const glsl = Math.fround(IFACE_DIFFUSE_PER_A) * u[4 * i] * (1 / Math.sqrt(u[4 * i + 2]));
      expect(glsl / (FACET.diffuse * interfaceReflectivity(id)), Interface[id]).toBeCloseTo(1, 5);
    }
    // la faceta: las mismas sales y la misma normalización que el gemelo
    expect(echo).toContain('float s = FACET_SALT + float(face) * FACET_SALT_F;');
    expect(echo).toContain(
      'return (vec3(valueNoise(q, s), valueNoise(q, s + FACET_SALT_C), valueNoise(q, s + 2.0 * FACET_SALT_C)) - 0.5) * (FACET_GAIN * st);',
    );
    expect(echo).toContain('vec3 f = warpNormal(w, n + t - dot(t, n) * n);');
    expect(echo).toContain('vec3 nm = fg.xyz;');
    expect(echo.indexOf('vec3 nm = fg.xyz;')).toBeLessThan(echo.indexOf('fg = vec4(gw /'));
    expect(echo).toContain('float cosF = facetCosine(nm, dir, t, w);');
    // σ_t = max(tan 5°, ρ·s) con s² = 1/(4·P.z): la inclinación y el lóbulo propio de la faceta
    expect(echo).toContain('vec3 t = facetTilt(m, c.iface, sqrt(max(FACET_TILT2, 0.25 * FACET_RHO2 / P.z)));');
    expect(echo).toContain(
      'return vec2(faceEcho(c.iface, cosF, min(1.0 - 4.0 * FACET_TILT2 * P.z, 1.0 - FACET_RHO2), 1.0, curv, g), IFACE_DIFFUSE * P.x * inversesqrt(P.z) * sqrt(max(0.0, 1.0 - exp(-P.y * P.y))) * cosI * wd * g);',
    );
    // la ventana del ángulo crítico de la cortical costal (decisión 88): la de `boneDiffuseWindow`
    expect(echo).toContain(`#define BONE_CRITICAL_SIN2 ${(BONE_CRITICAL_SIN * BONE_CRITICAL_SIN).toFixed(8)}`);
    expect(echo).toContain(`#define BONE_Z_RATIO ${BONE_IMPEDANCE_RATIO.toFixed(8)}`);
    expect(echo).toContain('float ctw = sqrt(max(0.0, 1.0 - (1.0 - cosI * cosI) / BONE_CRITICAL_SIN2));');
    expect(echo).toContain(
      'float wd = (c.iface == IF_RIB || c.iface == IF_VERTEBRAL_CORTEX) ? cosI * ctw * (1.0 + BONE_Z_RATIO) * (1.0 + BONE_Z_RATIO) / (zw * zw) : 1.0;',
    );
    expect(echo).toContain(
      'return cosL < IFACE_MIN_COS ? 0.0 : P.x * inversesqrt(kf) * exp(-(1.0 - c2) / c2 * P.z / kf) / c2 * exp(-0.5 * x * x) * curv * g * (0.39894228 / IFACE_SIGMA_H);',
    );
    expect(echo).toContain('float g = faceShape(c.iface, c.ifd / (fg.w * cosI)) * gain;');
    // el eco de la 57 (pleuras y copias de la pared, en su bucle): el mismo cálculo con kf 1, χ(θ) y sin la difusa
    expect(echo).toContain('return faceEcho(id, cosI, 1.0, cosI, curv, faceShape(id, delta));');
    // la cara interna de la pared con grasa detrás (fatAcrossWall): las mismas condiciones que el gemelo
    expect(echo).toContain(
      'if (c.iface == IF_PERITONEUM && retroFatSdf(m) < 0.0 && liverSdf(m, dB) > IFACE_ACROSS && domeSd(m) > DIAPHRAGM_MM + IFACE_ACROSS && quadratusSdf(m, 0.0, 1e3) > 0.0) gain *= IFACE_RETRO_PERITONEUM;',
    );
    // la mirada 0 (mediumField) y las dirigidas (mediumFieldPh) suman igual, con la especular aparte (decisión 88); las
    // pleuras y las copias de la pared, no
    for (const src of [PLEURA_GLSL, FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED]) {
      expect(src).toContain('spec = e.x;');
      expect(src).toContain('return field * (1.0 + e.y / max(length(field), 1e-6));');
    }
    // el programa dirigido lleva las dos (mediumField del preludio y mediumFieldPh de su rama), la mirada 0 una
    expect(FRAG_RAWFIELD_STEERED.split('vec2 e = interfaceEcho(c, m, dir, r, se, w, withCurtain);').length - 1).toBe(2);
    expect(FRAG_RAWFIELD.split('vec2 e = interfaceEcho(c, m, dir, r, se, w, withCurtain);').length - 1).toBe(1);
    expect(echo).toContain('return interfaceProfileEcho(IF_PLEURA, sqrt(max(0.0, 0.5 * (1.0 - dot(d0, dR)))), 1.0, delta);');
  });
});
