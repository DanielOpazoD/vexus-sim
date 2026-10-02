import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { START_POINTS } from '../app/startPoints';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import { CONVEX_C35, pointOnLine, probeFrame, type ProbePose } from '../probe/probe';
import { CONVEX_BEAM } from '../ultrasound/beamModel';
import { COMPOUND, lookTheta } from '../ultrasound/compound';
import {
  ANCHOR_SALT_STEP,
  CROSSFADE_SECONDS,
  ElevationAnchor,
  REANCHOR_DEG,
  SPECKLE_LOOK_GLSL,
  latticeValuePh,
  speckleSliceField,
  speckleSliceFieldPh,
  type LookPhase,
  type SpeckleAnchorState,
} from '../ultrasound/speckleField';
import { lookPhase, lookPhaseGrad, lookWavenumber } from '../ultrasound/steering';
import { lookPatchEnvelopes } from './support/compoundTwin';
import { rng } from './syntheticSpeckle';

/**
 * Medio de dispersores anclado (decisión 55), con el gemelo TS de la pasada B: campo en tres planos
 * de elevación (¼ ½ ¼ en amplitud) sobre un parche de 24 líneas × 60 profundidades (40–100 mm) de la
 * ventana intercostal. La correlación es la de la amplitud en los mismos píxeles antes y después de
 * mover la sonda, como la ve el alumno.
 */
const H = 0.42;
const FADE_STEPS = Math.round(CROSSFADE_SECONDS * 60);
const SALT = (1234 % 1000) / 7;
const elevSigma = (r: number): number => 1.6 * Math.sqrt(1 + ((r - CONVEX_C35.elevationFocusMm) / 45) ** 2);
const torso = new AnatomyScene(NORMAL_ADULT).torso;
/**
 * La intercostal de antes de la decisión 62 (casi craneocaudal), con la que la 55 calibró sus cotas: el medio
 * es una red de valores alineada con los ejes del mundo y comprimida a lo largo de la elevación del ancla, y su
 * estadística depende algo de la orientación. Con la de partida de la 62 (a lo largo del 8.º espacio, yaw
 * −1,15) la SNR justo antes de reanclar inclinando sube un 12 % (un 7 % más que una realización alineada en esa
 * pose; aquí, un 2 %): `speckle-anchor-orientation` en LIMITATIONS.md.
 */
const BASE: ProbePose = { phi: Math.PI * 0.88, z: 8, lift: 0, yaw: 0.35, rock: 0, tilt: 0 };
const deg = (d: number): number => (d * Math.PI) / 180;

function image(pose: ProbePose, anchor: ElevationAnchor, shift: Vec3 = [0, 0, 0]): number[] {
  const fr = probeFrame(pose, torso, CONVEX_C35);
  const st = anchor.update(fr.face, fr.elevation, 0);
  return patch(fr, st, shift);
}

function patch(fr: ReturnType<typeof probeFrame>, st: SpeckleAnchorState, shift: Vec3 = [0, 0, 0]): number[] {
  const e = fr.elevation;
  const out: number[] = [];
  for (let i = 0; i < 24; i++) {
    const th = -0.12 + (0.24 * i) / 23;
    for (let j = 0; j < 60; j++) {
      const r = 40 + j;
      const p = pointOnLine(fr, CONVEX_C35, th, r);
      const m: Vec3 = [p[0] + shift[0], p[1] + shift[1], p[2] + shift[2]];
      const se = elevSigma(r);
      const at = (k: number) =>
        Math.hypot(...speckleSliceField([m[0] + e[0] * se * k, m[1] + e[1] * se * k, m[2] + e[2] * se * k], H, se, SALT, st));
      out.push(0.5 * at(0) + 0.25 * (at(1) + at(-1)));
    }
  }
  return out;
}

function corr(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb);
}

describe('medio de dispersores anclado (decisión 55)', () => {
  it('inclinar la sonda conserva el moteado un grosor de corte y lo decorrela después', () => {
    const anchor = new ElevationAnchor();
    const ref = image(BASE, anchor);
    const after = (d: number) => corr(ref, image({ ...BASE, tilt: BASE.tilt + deg(d) }, anchor));
    // antes (eje = normal actual, pivote = origen del mundo): 0,39 / −0,01 / 0,02 con 0,25° / 0,5° / 1°
    expect(after(0.25)).toBeGreaterThan(0.95);
    expect(after(0.5)).toBeGreaterThan(0.9);
    expect(after(1)).toBeGreaterThan(0.75);
    // el ancla no cambió: volver a la pose da la misma imagen
    expect(image(BASE, anchor)).toEqual(ref);
    // a 4° el plano está a 3–7 mm del original en el parche, más que el grosor de corte
    expect(after(4)).toBeLessThan(0.3);
    // a 8° además se renueva el ancla (REANCHOR_DEG): sigue decorrelado
    expect(after(8)).toBeLessThan(0.3);
  });

  it('girar la sonda sobre su eje axial conserva el moteado del centro del plano', () => {
    const anchor = new ElevationAnchor();
    const ref = image(BASE, anchor);
    // antes: 0,16 con 0,5° y 0,03 con 1°
    expect(corr(ref, image({ ...BASE, yaw: BASE.yaw + deg(0.5) }, anchor))).toBeGreaterThan(0.95);
    expect(corr(ref, image({ ...BASE, yaw: BASE.yaw + deg(2) }, anchor))).toBeGreaterThan(0.9);
  });

  it('trasladar el medio en elevación lo decorrela a la escala del grosor de corte, no de la célula', () => {
    const anchor = new ElevationAnchor();
    const fr = probeFrame(BASE, torso, CONVEX_C35);
    const st = anchor.update(fr.face, fr.elevation, 0);
    const ref = patch(fr, st);
    const shifted = (mm: number) => corr(ref, patch(fr, st, [fr.elevation[0] * mm, fr.elevation[1] * mm, fr.elevation[2] * mm]));
    // la célula mide 0,42 mm: sin la compresión, 0,5 mm ya decorrelaría
    expect(shifted(0.5)).toBeGreaterThan(0.85);
    expect(shifted(4)).toBeLessThan(0.3);
  });

  // La célula elevacional se adelgaza con el ancla desviada: el umbral de reanclaje se elige para que,
  // justo antes de renovarse, el grano se conserve y la textura no cambie de carácter (a 20° la
  // persistencia caía a 0,3–0,65 y la SNR subía un 11–17 %).
  it('justo antes de reanclar, el moteado aún persiste y la textura no cambia', () => {
    const snrOf = (a: number[]) => {
      const m = a.reduce((s, v) => s + v, 0) / a.length;
      return m / Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
    };
    const aligned = new ElevationAnchor();
    const snr0 = snrOf(image(BASE, aligned));
    for (const kind of ['tilt', 'yaw'] as const) {
      const anchor = new ElevationAnchor();
      image(BASE, anchor);
      // a 1° del umbral, para que la inclinación de 0,5° no lo cruce
      const alpha = REANCHOR_DEG - 1;
      for (let d = 1; d < alpha; d++) image({ ...BASE, [kind]: BASE[kind] + deg(d) }, anchor);
      const drifted = { ...BASE, [kind]: BASE[kind] + deg(alpha) };
      const a = image(drifted, anchor);
      const b = image({ ...drifted, tilt: drifted.tilt + deg(0.5) }, anchor);
      expect(corr(a, b), kind).toBeGreaterThan(0.9);
      expect(snrOf(a) / snr0, kind).toBeLessThan(1.12);
    }
  });

  it('el ancla sigue fija con giros pequeños, se renueva con un fundido pasado REANCHOR_DEG y se reinicia con un salto', () => {
    const anchor = new ElevationAnchor();
    let time = 0;
    const st = (pose: ProbePose) => {
      const fr = probeFrame(pose, torso, CONVEX_C35);
      return anchor.update(fr.face, fr.elevation, (time += 1 / 60));
    };
    const s0 = st(BASE);
    expect(s0.w).toBe(1);
    expect(s0.a.parity).toBe(0);
    // giro lento de 1° por cuadro: el ancla no cambia hasta superar REANCHOR_DEG
    for (let d = 1; d < REANCHOR_DEG; d++) {
      const si = st({ ...BASE, yaw: BASE.yaw + deg(d) });
      expect(si.a).toBe(s0.a);
      expect(si.w).toBe(1);
    }
    const k = REANCHOR_DEG + 1;
    // al pasar el umbral: ancla nueva con la otra semilla y un fundido monótono durante CROSSFADE_SECONDS segundos
    const weights: number[] = [];
    const s = st({ ...BASE, yaw: BASE.yaw + deg(k) });
    expect(s.a.parity).toBe(1);
    expect(s.b).toBe(s0.a);
    weights.push(s.w);
    for (let i = 1; i < FADE_STEPS + 2; i++) {
      const si = st({ ...BASE, yaw: BASE.yaw + deg(k) });
      // mientras dure el fundido, los dos medios son distintos (si no, √w + √(1−w) > 1: destello)
      if (si.w < 1) expect(si.b.parity).not.toBe(si.a.parity);
      weights.push(si.w);
    }
    expect(weights.filter((w) => w < 1)).toHaveLength(FADE_STEPS);
    for (let i = 1; i < weights.length; i++) expect(weights[i]).toBeGreaterThan(weights[i - 1] - 1e-12);
    expect(weights.at(-1)).toBe(1);
    // girar deprisa durante el fundido no lo interrumpe: el peso sigue subiendo hasta 1
    const fast = new ElevationAnchor();
    const stFast = (d: number) => {
      const fr = probeFrame({ ...BASE, yaw: BASE.yaw + deg(d) }, torso, CONVEX_C35);
      return fast.update(fr.face, fr.elevation, d / 60);
    };
    stFast(0);
    const fastW: number[] = [];
    for (let d = 1; d <= REANCHOR_DEG + FADE_STEPS + 2; d++) fastW.push(stFast(d).w);
    const firstFade = fastW.findIndex((w) => w < 1);
    const run = fastW.slice(firstFade, firstFade + FADE_STEPS);
    for (let i = 1; i < run.length; i++) expect(run[i]).toBeGreaterThan(run[i - 1]);
    const settled = st({ ...BASE, yaw: BASE.yaw + deg(k) });
    expect(settled.b).toBe(settled.a);
    // salto de pose (otro punto de partida): ancla nueva sin fundido y con la semilla base
    const other = START_POINTS.find((p) => p.id === 'subxiphoid')!;
    const jump = st({ phi: other.phi, z: other.z, lift: 0, yaw: other.yaw, rock: other.rock ?? 0, tilt: other.tilt ?? 0 });
    expect(jump.w).toBe(1);
    expect(jump.a.parity).toBe(0);
    expect(jump.b).toBe(jump.a);
  });

  // La e2e del fundido (`smoke.spec.ts`, «el fundido del ancla…») deduce de los pesos que publica el renderer lo
  // que el fundido le cuesta a la correlación entre dos cuadros: si w baja empieza un fundido y la nueva del
  // cuadro anterior es la vieja de este, ρ = √(w₀(1 − w)); si no, ρ = √(w₀w) + √((1 − w₀)(1 − w)).
  it('la correlación del medio entre cuadros que deduce la e2e de los pesos es la de las anclas, y nunca baja de 8/9', () => {
    const anchor = new ElevationAnchor();
    const media = (st: SpeckleAnchorState): Map<object, number> =>
      st.a === st.b
        ? new Map([[st.a, 1]])
        : new Map<object, number>([
            [st.a, Math.sqrt(st.w)],
            [st.b, Math.sqrt(1 - st.w)],
          ]);
    let prev = anchor.update(probeFrame(BASE, torso, CONVEX_C35).face, probeFrame(BASE, torso, CONVEX_C35).elevation, 0);
    let starts = 0;
    let links = 0;
    for (let d = 1; d <= 40; d++) {
      const fr = probeFrame({ ...BASE, yaw: BASE.yaw + deg(d) }, torso, CONVEX_C35);
      const st = anchor.update(fr.face, fr.elevation, d / 60);
      const m0 = media(prev);
      let exact = 0;
      for (const [k, amp] of media(st)) exact += amp * (m0.get(k) ?? 0);
      const w0 = prev.w;
      const fromWeights = st.w < w0 ? Math.sqrt(w0 * (1 - st.w)) : Math.sqrt(w0 * st.w) + Math.sqrt((1 - w0) * (1 - st.w));
      expect(fromWeights, `giro ${d}°`).toBeCloseTo(exact, 12);
      expect(exact * exact, `giro ${d}°`).toBeGreaterThan((8 / 9) ** 2 - 1e-12);
      if (st.w < w0) {
        starts++;
        if (w0 < 1) links++;
      }
      prev = st;
    }
    // A 60 Hz cada fundido llega a w=1 antes de comenzar el siguiente.
    expect(starts).toBeGreaterThanOrEqual(3);
    expect(links).toBe(0);
  });

  it('durante el fundido el moteado sigue siendo de Rayleigh con la misma potencia media', () => {
    const anchor = new ElevationAnchor();
    const fr = probeFrame(BASE, torso, CONVEX_C35);
    const a = anchor.update(fr.face, fr.elevation, 0).a;
    const tilted = probeFrame({ ...BASE, yaw: BASE.yaw + deg(30) }, torso, CONVEX_C35);
    const mid: SpeckleAnchorState = { a: { e: tilted.elevation, p: tilted.face, parity: 1 }, b: a, w: 0.5 };
    const still: SpeckleAnchorState = { a, b: a, w: 1 };
    const stats = (st: SpeckleAnchorState) => {
      const amp: number[] = [];
      // puntos separados 1,3 mm (≈ 3 células): muestras casi independientes del plano actual
      for (let i = 0; i < 60; i++)
        for (let j = 0; j < 60; j++) {
          const p = pointOnLine(tilted, CONVEX_C35, -0.3 + 0.01 * i, 40 + 1.3 * j);
          amp.push(Math.hypot(...speckleSliceField(p, H, 2, SALT, st)));
        }
      const mean = amp.reduce((s, v) => s + v, 0) / amp.length;
      const sd = Math.sqrt(amp.reduce((s, v) => s + (v - mean) ** 2, 0) / amp.length);
      return { snr: mean / sd, power: amp.reduce((s, v) => s + v * v, 0) / amp.length };
    };
    const s = stats(still);
    const m = stats(mid);
    expect(Math.abs(m.snr - s.snr)).toBeLessThan(0.1);
    expect(m.power / s.power).toBeGreaterThan(0.9);
    expect(m.power / s.power).toBeLessThan(1.1);
  });
});

/**
 * Fase de mirada por nodo (decisión 58, T2): la mirada dirigida ve los mismos dispersores con la fase
 * Δ_k(x_n) de cada nodo, que la pasada B reparte en su forma lineal Δ_k(P) + g⊥·(x_n − P). Con θ = 0 el
 * campo es el de hoy bit a bit; la forma lineal se aparta de la exacta ≤ 1e-2 rad; y cada mirada, sola,
 * es un moteado de Rayleigh con la misma media que la mirada 0.
 */
describe('fase de mirada por nodo (decisión 58)', () => {
  const K2 = lookWavenumber(CONVEX_BEAM);
  const fr = probeFrame(BASE, torso, CONVEX_C35);
  const anchor = new ElevationAnchor();
  const st = anchor.update(fr.face, fr.elevation, 0);
  const c = fr.curvatureCenter;
  const R = CONVEX_C35.curvatureRadius;
  /** Δ_k y su gradiente en el mundo en un punto del plano (x lateral, z axial desde el centro de curvatura). */
  const phaseAt = (w: Vec3, th: number): LookPhase => {
    const d: Vec3 = [w[0] - c[0], w[1] - c[1], w[2] - c[2]];
    const x = d[0] * fr.lateral[0] + d[1] * fr.lateral[1] + d[2] * fr.lateral[2];
    const z = d[0] * fr.axial[0] + d[1] * fr.axial[1] + d[2] * fr.axial[2];
    const rho = Math.hypot(x, z);
    const alpha = Math.atan2(x, z);
    const [gx, gz] = lookPhaseGrad(rho, alpha, th, R, K2);
    return {
      ph0: lookPhase(rho, alpha, th, R, K2),
      g: [gx * fr.lateral[0] + gz * fr.axial[0], gx * fr.lateral[1] + gz * fr.axial[1], gx * fr.lateral[2] + gz * fr.axial[2]],
    };
  };

  it('θ = 0 (sin fase, o fase y gradiente nulos) da el campo de hoy bit a bit, también en el fundido', () => {
    const tilted = probeFrame({ ...BASE, yaw: BASE.yaw + deg(8) }, torso, CONVEX_C35);
    const fade: SpeckleAnchorState = { a: { e: tilted.elevation, p: tilted.face, parity: 1 }, b: st.a, w: 0.4 };
    for (const state of [st, fade])
      for (let i = 0; i < 400; i++) {
        const p = pointOnLine(fr, CONVEX_C35, -0.5 + 0.0025 * i, 10 + 0.43 * i);
        const ref = speckleSliceField(p, H, 1.9, SALT, state);
        expect(speckleSliceFieldPh(p, H, 1.9, SALT, state, null)).toEqual(ref);
        expect(speckleSliceFieldPh(p, H, 1.9, SALT, state, { ph0: 0, g: [0, 0, 0] })).toEqual(ref);
      }
  });

  it('la forma lineal de la GPU se aparta de la fase exacta del nodo ≤ 1e-2 rad, y el campo con ella', () => {
    const rnd = rng(5801);
    let worstPhase = 0;
    let worstField = 0;
    let power = 0;
    const e = st.a.e;
    const sliceHalf = 1.9;
    const shrinkK = 1 - H / Math.max(H, 2 * sliceHalf);
    for (const r of [20, 45, 90, 150, 180])
      for (const th of [lookTheta(1), lookTheta(2), 8 * (Math.PI / 180)]) {
        for (let t = 0; t < 300; t++) {
          const p = pointOnLine(fr, CONVEX_C35, (rnd() - 0.5) * 1.1, r + rnd());
          const lp = phaseAt(p, th);
          // el campo de la GPU (forma lineal) frente a uno con la fase exacta de cada nodo
          const gpu = speckleSliceFieldPh(p, H, sliceHalf, SALT, st, lp);
          const across = (p[0] - st.a.p[0]) * e[0] + (p[1] - st.a.p[1]) * e[1] + (p[2] - st.a.p[2]) * e[2];
          const q: Vec3 = [p[0] - e[0] * across * shrinkK, p[1] - e[1] * across * shrinkK, p[2] - e[2] * across * shrinkK];
          const cell: Vec3 = [Math.floor(q[0] / H), Math.floor(q[1] / H), Math.floor(q[2] / H)];
          const f = [0, 1, 2].map((i) => q[i] / H - cell[i]);
          const sm = f.map((v) => v * v * (3 - 2 * v));
          let re = 0;
          let im = 0;
          for (let dx = 0; dx < 2; dx++)
            for (let dy = 0; dy < 2; dy++)
              for (let dz = 0; dz < 2; dz++) {
                const off: Vec3 = [(cell[0] + dx) * H - q[0], (cell[1] + dy) * H - q[1], (cell[2] + dz) * H - q[2]];
                const oe = off[0] * e[0] + off[1] * e[1] + off[2] * e[2];
                const inPlane: Vec3 = [off[0] - e[0] * oe, off[1] - e[1] * oe, off[2] - e[2] * oe];
                const exact = phaseAt([p[0] + inPlane[0], p[1] + inPlane[1], p[2] + inPlane[2]], th).ph0;
                const linear = lp.ph0 + lp.g[0] * inPlane[0] + lp.g[1] * inPlane[1] + lp.g[2] * inPlane[2];
                worstPhase = Math.max(worstPhase, Math.abs(exact - linear));
                const v = latticeValuePh([cell[0] + dx, cell[1] + dy, cell[2] + dz], SALT + st.a.parity * ANCHOR_SALT_STEP, exact);
                const w = (dx ? sm[0] : 1 - sm[0]) * (dy ? sm[1] : 1 - sm[1]) * (dz ? sm[2] : 1 - sm[2]);
                re += w * v[0];
                im += w * v[1];
              }
          worstField = Math.max(worstField, Math.hypot(gpu[0] - re, gpu[1] - im));
          power += re * re + im * im;
        }
      }
    // el juez midió 5,5e-3 rad a 20 mm (el peor caso: la curvatura del frente es mayor cerca de la cara)
    expect(worstPhase).toBeLessThanOrEqual(1e-2);
    expect(worstPhase).toBeGreaterThan(1e-4); // la prueba mide algo: la forma lineal no es exacta
    // el campo se aparta como mucho lo que la fase: ≤ 1e-2 de la amplitud eficaz
    expect(worstField / Math.sqrt(power / (5 * 3 * 300))).toBeLessThanOrEqual(1e-2);
  });

  it('cada mirada, sola, es un moteado de Rayleigh con la media de la mirada 0 (B → C → D)', () => {
    const th = lookTheta(1, COMPOUND);
    const frame = { center: c, axial: fr.axial, lateral: fr.lateral, elevation: fr.elevation, face: fr.face };
    const dr = 180 / 1024;
    for (const r of [45, 150]) {
      const i0 = Math.round(r / dr - 72);
      const patch = { j0: 96, j1: 127, i0, i1: i0 + 143 };
      const stat = { snr: [0, 0, 0], mean: [0, 0, 0] };
      const SEEDS = 3;
      for (let sd = 0; sd < SEEDS; sd++) {
        const envs = lookPatchEnvelopes(frame, st, [0, th, -th], patch, SALT + sd / (7 * 0.1031), K2);
        envs.forEach((env, k) => {
          const m = env.reduce((a, v) => a + v, 0) / env.length;
          const sd2 = Math.sqrt(env.reduce((a, v) => a + (v - m) ** 2, 0) / env.length);
          stat.snr[k] += m / sd2 / SEEDS;
          stat.mean[k] += m / SEEDS;
        });
      }
      for (const k of [1, 2]) {
        expect(stat.snr[k], `SNR de la mirada ${k} a ${r} mm`).toBeGreaterThanOrEqual(1.85);
        expect(stat.snr[k], `SNR de la mirada ${k} a ${r} mm`).toBeLessThanOrEqual(2.1);
        expect(Math.abs(stat.mean[k] / stat.mean[0] - 1), `media de la mirada ${k} a ${r} mm`).toBeLessThanOrEqual(0.03);
      }
    }
  });

  it('el GLSL de la mirada lleva la misma fórmula que el gemelo', () => {
    expect(SPECKLE_LOOK_GLSL).toContain('float base = ph0 - dot(gh, fr);');
    expect(SPECKLE_LOOK_GLSL).toContain('vec2 v111 = latticeValuePh(c0 + vec3(1, 1, 1), salt, base + gh.x + gh.y + gh.z, s);');
    expect(SPECKLE_LOOK_GLSL).toContain('return scattererFieldPh(q, h, salt, ph0, g - e * dot(g, e), s);');
    expect(SPECKLE_LOOK_GLSL).toContain('uSeed + salt + uAnchorSalt.y, uAnchorE1, uAnchorP1, ph0, g, s');
    // los nodos fuertes de la mirada son los de la mirada 0 (decisión 89): la misma elección y el mismo reparto de la fase
    expect(SPECKLE_LOOK_GLSL).toContain('bool strong = b >= 1.0 - s.x;');
    expect(SPECKLE_LOOK_GLSL).toContain('float p = 6.2831853 * (strong ? (b - (1.0 - s.x)) / s.x : b / (1.0 - s.x)) + ph;');
  });
});
