import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { START_POINTS } from '../app/startPoints';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import { CONVEX_C35, pointOnLine, probeFrame, type ProbePose } from '../probe/probe';
import { CROSSFADE_FRAMES, ElevationAnchor, REANCHOR_DEG, speckleSliceField, type SpeckleAnchorState } from '../ultrasound/speckleField';

/**
 * Medio de dispersores anclado (decisión 55), con el gemelo TS de la pasada B: campo en tres planos
 * de elevación (¼ ½ ¼ en amplitud) sobre un parche de 24 líneas × 60 profundidades (40–100 mm) de la
 * ventana intercostal. La correlación es la de la amplitud en los mismos píxeles antes y después de
 * mover la sonda, como la ve el alumno.
 */
const H = 0.42;
const SALT = (1234 % 1000) / 7;
const elevSigma = (r: number): number => 1.6 * Math.sqrt(1 + ((r - CONVEX_C35.elevationFocusMm) / 45) ** 2);
const torso = new AnatomyScene(NORMAL_ADULT).torso;
const sp = START_POINTS.find((s) => s.id === 'intercostal')!;
const BASE: ProbePose = { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 };
const deg = (d: number): number => (d * Math.PI) / 180;

function image(pose: ProbePose, anchor: ElevationAnchor, shift: Vec3 = [0, 0, 0]): number[] {
  const fr = probeFrame(pose, torso, CONVEX_C35);
  const st = anchor.update(fr.face, fr.elevation);
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
    const st = anchor.update(fr.face, fr.elevation);
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
    const st = (pose: ProbePose) => {
      const fr = probeFrame(pose, torso, CONVEX_C35);
      return anchor.update(fr.face, fr.elevation);
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
    // al pasar el umbral: ancla nueva con la otra semilla y un fundido monótono de CROSSFADE_FRAMES cuadros
    const weights: number[] = [];
    const s = st({ ...BASE, yaw: BASE.yaw + deg(k) });
    expect(s.a.parity).toBe(1);
    expect(s.b).toBe(s0.a);
    weights.push(s.w);
    for (let i = 1; i < CROSSFADE_FRAMES + 2; i++) weights.push(st({ ...BASE, yaw: BASE.yaw + deg(k) }).w);
    expect(weights.filter((w) => w < 1)).toHaveLength(CROSSFADE_FRAMES);
    for (let i = 1; i < weights.length; i++) expect(weights[i]).toBeGreaterThan(weights[i - 1] - 1e-12);
    expect(weights.at(-1)).toBe(1);
    const settled = st({ ...BASE, yaw: BASE.yaw + deg(k) });
    expect(settled.b).toBe(settled.a);
    // salto de pose (otro punto de partida): ancla nueva sin fundido y con la semilla base
    const other = START_POINTS.find((p) => p.id === 'subxiphoid')!;
    const jump = st({ phi: other.phi, z: other.z, lift: 0, yaw: other.yaw, rock: other.rock ?? 0, tilt: other.tilt ?? 0 });
    expect(jump.w).toBe(1);
    expect(jump.a.parity).toBe(0);
    expect(jump.b).toBe(jump.a);
  });

  it('durante el fundido el moteado sigue siendo de Rayleigh con la misma potencia media', () => {
    const anchor = new ElevationAnchor();
    const fr = probeFrame(BASE, torso, CONVEX_C35);
    const a = anchor.update(fr.face, fr.elevation).a;
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
