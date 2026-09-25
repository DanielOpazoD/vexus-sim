import { describe, expect, it } from 'vitest';
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
import { AXIAL_SIGMA_MM, CONVEX_BEAM, lateralSigmaMm } from '../ultrasound/beamModel';
import {
  IFACE_BETA,
  IFACE_K_DB,
  IFACE_K_RANGE_DB,
  IFACE_REACH_MM,
  IFACE_SHIFT_MM,
  IFACE_SIGMA_H_MM,
  IFACE_SLOPE_REF,
  INTERFACE_ECHO_GLSL,
  curvatureCoherence,
  faceProfile,
  facetLobe,
  interfaceAmplitude,
  interfaceEchoField,
  interfaceUniforms,
  reflectionCosine,
  roughnessCoherence,
} from '../ultrasound/interfaceEcho';
import { FRAG_AXIAL, FRAG_LATERAL, FRAG_RAWFIELD, LATERAL_PSF_GLSL } from '../ultrasound/shaders/passes.glsl';
import { scattererField } from '../ultrasound/speckleField';

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
    expect(interfaceReflectivity(Interface.PortalLumen)).toBe(0.05);
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
    // pasada C: gaussiana de σ = max(0,6; AXIAL_SIGMA_MM/dr) muestras, truncada a ±12 y de energía unidad
    const kernel = (dr: number) => {
      const s = Math.max(0.6, AXIAL_SIGMA_MM / dr);
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
      // anchura del eco: 2,355·√(σ_pulso² + σh²) = 0,695 mm
      if (depth === 180) expect(Math.abs(widths.reduce((a, b) => a + b) / widths.length / 0.695 - 1)).toBeLessThan(0.05);
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
    // la muestra del medio (decisión 61: `mediumField`, en un bucle con la pared que copia la serie de la pleura)
    expect(FRAG_RAWFIELD).toContain('return field + vec2(interfaceEcho(c, m, dir, rEcho, se), 0.0);');
    expect(FRAG_RAWFIELD).not.toMatch(/uSpecGain|pow\(cosI, 4\.0\)/);
    // β se midió con estas pasadas C y D: si cambian, hay que re-derivarlo (interfaceTwin.test.ts)
    expect(FRAG_AXIAL).toContain('k <= 12');
    expect(FRAG_LATERAL).toContain('max(0.35,');
    expect(FRAG_LATERAL).toContain('k <= 14');
  });
});
