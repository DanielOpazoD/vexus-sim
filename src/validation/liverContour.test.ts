// @tier slow
import { beforeAll, describe, expect, it } from 'vitest';
import type { Vec3 } from '../core/vec3';
import {
  CONTOUR_STEP_MM,
  DOME_OWNER_MM,
  analyzeContour,
  contourView,
  liverTerms,
  straightRuns,
  type ContourCase,
  type ContourReport,
  type ContourView,
} from './support/liverContour';

/**
 * Contorno del hígado en el plano de imagen (PR 0 de las decisiones 60 y 63; `support/liverContour.ts`,
 * portado del diseño «geometry-first»): la superficie `liverSurface` de producción cortada por el plano de
 * las cuatro vistas de las capturas (sano: subxifoidea, intercostal y flanco; congestión grave:
 * subxifoidea), en apnea espiratoria.
 *
 * Hoy el hígado es min(−hígado, cúpula, pared) con min duro: donde cambia el término que manda la normal
 * gira de golpe (arista del SDF) y el eco de la cápsula, que depende de la incidencia, salta de +9 a −55 dB
 * en 0,5 mm: la cápsula subxifoidea «acaba a mitad del hígado» y la del flanco se corta a ambos lados (la
 * crítica visual, síntomas a y c). La decisión 60 (contacto suave con radios por par y peso continuo de
 * dueño) debe quitar esas aristas; sus pruebas quedan escritas con `it.fails` y los umbrales del plan.
 */
type ViewSpec = readonly [ContourCase, 'subxiphoid' | 'intercostal' | 'flank' | 'renal'];
const CAPTURES: readonly ViewSpec[] = [
  ['normal', 'subxiphoid'],
  ['normal', 'intercostal'],
  ['normal', 'flank'],
  ['severe', 'subxiphoid'],
];
const q = (a: readonly number[], f: number): number => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))];
/** La fórmula de hoy (min duro), la referencia de las guardas de la decisión 60. */
const todayInner =
  (v: ContourView) =>
  (m: Vec3): number =>
    liverTerms(v.scene, m).inner;
const productionInner = (v: ContourView, m: Vec3): number => -v.scene.faceSdf(m, v.caliber, 'liverSurface')!;

describe('Contorno del hígado en las vistas de las capturas (PR 0 de las decisiones 60 y 63)', () => {
  let views: ContourView[] = [];
  let reports: ContourReport[] = [];
  beforeAll(() => {
    views = CAPTURES.map(([c, sp]) => contourView(c, sp));
    reports = views.map((v) => analyzeContour(v));
  }, 300_000);

  it('la atribución término a término reproduce faceSdf de producción y las normales son las de faceGradient', () => {
    for (const [k, rep] of reports.entries()) {
      const v = views[k];
      expect(rep.lengthMm, rep.view).toBeGreaterThan(150);
      expect(rep.vertices.length, rep.view).toBeGreaterThan(300);
      for (const x of rep.vertices) {
        expect(
          Math.abs(liverTerms(v.scene, x.p).inner - productionInner(v, x.p)),
          `${rep.view} (${x.X.toFixed(1)}, ${x.Y.toFixed(1)})`,
        ).toBeLessThan(1e-9);
        // en la isolínea 0 (interpolada en una rejilla de 0,25 mm)
        expect(Math.abs(productionInner(v, x.p)), rep.view).toBeLessThan(0.1);
        expect(Math.hypot(...x.n)).toBeCloseTo(1, 9);
      }
      // los vértices van cada 0,5 mm de arco
      for (const ch of rep.chains)
        for (let i = 1; i < ch.length; i++)
          expect(Math.hypot(ch[i].X - ch[i - 1].X, ch[i].Y - ch[i - 1].Y)).toBeLessThanOrEqual(CONTOUR_STEP_MM + 1e-6);
    }
  });

  it('hoy, cada arista es una arista del min duro: uno de sus lados es la pared o la cúpula (atribución de la crítica, c)', () => {
    const creases = reports.flatMap((r) => r.creases.filter((c) => !c.fissure));
    expect(creases.length).toBeGreaterThan(0);
    for (const c of creases) expect(/(^|\|)(wall|dome)(\||$)/.test(c.labels), c.labels).toBe(true);
    // la subxifoidea del sano: la cápsula bajo la pared pasa a la unión de los lóbulos con un salto > 30 dB
    expect(reports[0].creases.some((c) => c.labels.includes('wall') && c.labels.includes('lobeBlend') && c.dbJump > 30)).toBe(true);
  });

  it('tramos rectos (solo informados): con flecha de 0,5 mm nunca menos que con 0,25 mm, todos ≥ 20 mm', () => {
    for (const r of reports) {
      const a = straightRuns(r, 0.25);
      const b = straightRuns(r, 0.5);
      for (const x of [...a, ...b]) expect(x.lenMm).toBeGreaterThanOrEqual(20);
      expect(
        b.reduce((s, x) => s + x.lenMm, 0),
        r.view,
      ).toBeGreaterThanOrEqual(a.reduce((s, x) => s + x.lenMm, 0));
    }
  });

  it('guarda de la decisión 60: la cúpula sigue tocando el hígado donde hoy es la dueña de la cara (≤ 110 vértices perdidos)', () => {
    let owned = 0;
    let lost = 0;
    for (const v of views)
      for (const x of analyzeContour(v, todayInner(v)).vertices) {
        if (x.hidden || x.owner !== 'dome') continue;
        owned++;
        if (liverTerms(v.scene, x.p).dDiaphragm - productionInner(v, x.p) > DOME_OWNER_MM) lost++;
      }
    expect(owned).toBeGreaterThan(300);
    expect(lost).toBeLessThanOrEqual(110);
  });

  it('guarda de la decisión 60: el hígado sigue tocando la grasa perirrenal en Morison (p95 ≤ 0,2 mm)', () => {
    const gap: number[] = [];
    for (const c of ['normal', 'severe'] as const)
      for (const sp of ['intercostal', 'renal'] as const) {
        const v = contourView(c, sp);
        for (const x of analyzeContour(v, todayInner(v)).vertices)
          if (x.owner === 'morison' && !x.hidden) gap.push(Math.abs(productionInner(v, x.p)));
      }
    expect(gap.length).toBeGreaterThan(50);
    expect(q(gap, 0.95)).toBeLessThanOrEqual(0.2);
  });

  // ——— Lo que debe hacer la decisión 60 (hoy falla; umbrales del plan) ———

  it.fails('60: ninguna arista 3D fuera de la fisura en las cuatro vistas (hoy 4, 1, 3 y 3)', () => {
    for (const r of reports)
      expect(
        r.creases.filter((c) => !c.fissure).map((c) => c.labels),
        r.view,
      ).toEqual([]);
  });

  it.fails('60: ningún extremo brusco de la cápsula, contando los cambios de dueño (hoy 3 de 9 y 5 cambios)', () => {
    for (const r of reports) expect(r.capsule.abruptEnds + r.capsule.ownerSwitches, r.view).toBe(0);
  });

  it.fails('60: el eco de la cápsula se funde de 15 a 6 dB en ≥ 3 mm de arco en todos sus extremos (hoy, mínimo 0)', () => {
    const fades = reports.flatMap((r) => r.capsule.fadeMm);
    expect(fades.length).toBeGreaterThan(0);
    expect(Math.min(...fades)).toBeGreaterThanOrEqual(3);
  });

  it.fails(
    '60: ≤ 15 aristas fuera de la fisura en 56 poses (2 casos × 4 vistas × 7 desvíos de ±6° y ±0,05 rad; hoy 102)',
    () => {
      const d = (6 * Math.PI) / 180;
      const offsets: [number, number, number][] = [
        [0, 0, 0],
        [0, d, 0],
        [0, -d, 0],
        [0, 0, d],
        [0, 0, -d],
        [0.05, 0, 0],
        [-0.05, 0, 0],
      ];
      let creases = 0;
      for (const c of ['normal', 'severe'] as const)
        for (const sp of ['subxiphoid', 'intercostal', 'flank', 'renal'] as const)
          for (const [dPhi, dRock, dTilt] of offsets)
            creases += analyzeContour(contourView(c, sp, dPhi, dRock, dTilt)).creases.filter((x) => !x.fissure).length;
      expect(creases).toBeLessThanOrEqual(15);
    },
    600_000,
  );
});
