import { describe, expect, it } from 'vitest';
import { TISSUES, Tissue } from '../anatomy/tissues';
import type { Vec3 } from '../core/vec3';
import {
  ElevationAnchor,
  TISSUE_SALT_STEP,
  anchoredClumpGain,
  heterogeneityDb,
  speckleSliceField,
  type SpeckleAnchorState,
} from '../ultrasound/speckleField';

/**
 * Moteado por tejido (decisión 56) con el gemelo TS de la pasada B. Antes un solo campo servía a
 * todos los tejidos (solo cambiaba la amplitud): el patrón continuaba a través de las paredes y el
 * seno renal era «hígado más brillante»; y la heterogeneidad del parénquima eran cubos de 6,25 mm
 * con saltos de hasta 4 dB en sus caras.
 */
const H = 0.42;
const SEED = (1234 % 1000) / 7;
const anchor: SpeckleAnchorState = new ElevationAnchor().update([0, 0, 0], [0, 0, 1]);
const field = (m: Vec3, tissue: Tissue) => speckleSliceField(m, H, 2, SEED + tissue * TISSUE_SALT_STEP, anchor);

/** Puntos separados 1,5 mm (> célula de grumo y de retícula): muestras casi independientes. */
function grid(n: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push([-60 + 1.5 * i, 20 + 1.5 * j, -40 + 0.37 * i]);
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

const snr = (amp: number[]) => {
  const mean = amp.reduce((s, v) => s + v, 0) / amp.length;
  const sd = Math.sqrt(amp.reduce((s, v) => s + (v - mean) ** 2, 0) / amp.length);
  return mean / sd;
};

describe('moteado por tejido (decisión 56)', () => {
  it('cada tejido es otra población: el moteado no continúa a través de un borde', () => {
    // la independencia se mide en el campo complejo (parte real): la magnitud de un campo
    // interpolado en retícula comparte entre realizaciones la modulación de varianza por posición
    const pts = grid(40);
    const liver = pts.map((m) => field(m, Tissue.Liver)[0]);
    const wall = pts.map((m) => field(m, Tissue.VesselWallPortal)[0]);
    const sinus = pts.map((m) => field(m, Tissue.RenalSinus)[0]);
    expect(Math.abs(corr(liver, wall))).toBeLessThan(0.08);
    expect(Math.abs(corr(liver, sinus))).toBeLessThan(0.08);
    // el mismo tejido en el mismo punto, idéntico (el medio está fijo)
    expect(pts.map((m) => field(m, Tissue.Liver)[0])).toEqual(liver);
  });

  it('la heterogeneidad del parénquima es continua y conserva su desviación (1,15 dB)', () => {
    let maxJump = 0;
    const vals: number[] = [];
    for (let i = 0; i < 4000; i++) {
      const m: Vec3 = [-150 + 0.077 * i, 30 + 0.051 * i, -90 + 0.033 * i];
      const v = heterogeneityDb(m, SEED);
      vals.push(v);
      maxJump = Math.max(maxJump, Math.abs(heterogeneityDb([m[0] + 0.1, m[1], m[2]], SEED) - v));
    }
    // antes, en las caras de los cubos: saltos de hasta 4 dB en cualquier distancia
    expect(maxJump).toBeLessThan(0.2);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
    expect(sd).toBeGreaterThan(0.9);
    expect(sd).toBeLessThan(1.4);
  });

  // Como la pasada B: amplitud ¼ ½ ¼ de los tres planos de elevación y UN grumo por píxel, del
  // plano central, sobre la coordenada anclada. Con un grumo por plano la grasa salía 0,5 dB más
  // oscura (se promediaban tres células) y el grano del seno parpadeaba al inclinar.
  const passB = (m: Vec3, tissue: Tissue, st: SpeckleAnchorState, e: Vec3, se = 2): number => {
    const at = (k: number) =>
      Math.hypot(
        ...speckleSliceField(
          [m[0] + e[0] * se * k, m[1] + e[1] * se * k, m[2] + e[2] * se * k],
          H,
          se,
          SEED + tissue * TISSUE_SALT_STEP,
          st,
        ),
      );
    const amp = 0.5 * at(0) + 0.25 * (at(1) + at(-1));
    return amp * anchoredClumpGain(m, se, TISSUES[tissue].speckleClump ?? 0, SEED, tissue * TISSUE_SALT_STEP, st);
  };

  it('los grumos del seno renal dan estadística K con la misma potencia media; el hígado sigue Rayleigh', () => {
    expect(TISSUES[Tissue.Liver].speckleClump ?? 0).toBe(0);
    expect(TISSUES[Tissue.RenalSinus].speckleClump ?? 0).toBeGreaterThan(0);
    const pts = grid(70);
    const e: Vec3 = [0, 0, 1];
    const sinus = pts.map((m) => passB(m, Tissue.RenalSinus, anchor, e));
    const noClump = pts.map((m) => {
      const at = (k: number) =>
        Math.hypot(...speckleSliceField([m[0], m[1], m[2] + 2 * k], H, 2, SEED + Tissue.RenalSinus * TISSUE_SALT_STEP, anchor));
      return 0.5 * at(0) + 0.25 * (at(1) + at(-1));
    });
    const power = (a: number[]) => a.reduce((s, v) => s + v * v, 0) / a.length;
    // potencia media: la misma (±6 %) tras los tres planos, así que la ecogenicidad no cambia
    expect(power(sinus) / power(noClump)).toBeGreaterThan(0.94);
    expect(power(sinus) / power(noClump)).toBeLessThan(1.06);
    // amplitud claramente más contrastada que sin grumos (estadística K)
    expect(snr(sinus)).toBeLessThan(snr(noClump) - 0.3);
  });

  it('los grumos del seno siguen al medio anclado: inclinar medio grado no los hace parpadear', () => {
    // plano a 100 mm de la sonda, inclinado 0,5° alrededor de un eje del plano: los puntos se mueven
    // en elevación 0,87 mm a esa profundidad, menos que el grosor de corte
    const st = new ElevationAnchor().update([0, 0, 0], [0, 0, 1]);
    const tilt = (0.5 * Math.PI) / 180;
    const base: Vec3[] = [];
    for (let i = 0; i < 60; i++) for (let j = 0; j < 60; j++) base.push([-30 + i, 100, -30 + j]);
    const moved = base.map((p): Vec3 => [p[0], p[1] * Math.cos(tilt), p[2] + p[1] * Math.sin(tilt)]);
    const g0 = base.map((m) => anchoredClumpGain(m, 2.2, 1, SEED, 0, st));
    const g1 = moved.map((m) => anchoredClumpGain(m, 2.2, 1, SEED, 0, st));
    expect(corr(g0, g1)).toBeGreaterThan(0.7);
  });
});
