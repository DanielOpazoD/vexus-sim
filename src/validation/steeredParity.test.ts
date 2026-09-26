// @tier slow
import { describe, expect, it } from 'vitest';
import { TISSUES, Tissue, attenuationDbPerCm } from '../anatomy/tissues';
import { Simulator } from '../app/simulator';
import { START_POINTS, type StartPoint } from '../app/startPoints';
import { STEERED_TIE_LINES, compareSteeredTransmission, steeredTransmissionTwin } from '../app/steeredParity';
import { NORMAL_ADULT } from '../cases';
import { clonePatient } from '../physiology/patientState';
import { pointOnLine } from '../probe/probe';
import { type ApertureGeometry } from '../ultrasound/aperture';
import { CONVEX_BEAM } from '../ultrasound/beamModel';
import { bmodeTxApertureMm } from '../ultrasound/transducerProfile';
import { COMPOUND_STEER_RANGE_DEG, lookTheta } from '../ultrasound/compound';
import { GAS_DB_PER_CM, type SegmentGrid } from '../ultrasound/transmission';
import { GRID_GEOMETRY as G, emptyGrid } from './support/segmentGrid';
import { recordingGl } from './support/recordingGl';

/**
 * Paridad de la mirada dirigida (G8, decisión 58) sin GPU: el detector de empates de redondeo de
 * `compareSteeredTransmission`. Un margen demasiado ancho marca muestras limpias (antes, θ·(1 ± 2·10⁻⁴):
 * 0,35–1,35 % de las muestras en las cuatro vistas, cerca del 1 % que admite la e2e); uno demasiado
 * estrecho deja pasar como desacuerdo un redondeo que la GPU hace en float32.
 */

const f = Math.fround;

/**
 * Error de float32 de los argumentos de los redondeos dirigidos, emulando el GLSL operación a operación
 * (`STEERED_PREFIX_GLSL`: línea del camino en cada fila; `STEERED_APERTURE_GLSL`: tomas del cono) frente a
 * float64 (los gemelos). Uniforms en float32; asin y sqrt correctamente redondeados.
 */
function float32RoundingError(theta: number): { path: number; cone: number } {
  const R = G.curvatureRadius;
  const H = G.halfSector;
  const L = G.lines;
  const { apertureTxMm: D, apertureRxMaxMm: Drx, fNumberRxMin: F } = CONVEX_BEAM;
  const step64 = G.depthMm / G.rows;
  const dPhi64 = (2 * H) / L;
  const a64 = R * Math.sin(theta);
  const rc64 = R * Math.cos(theta);
  const step = f(f(G.depthMm) / f(G.rows));
  const dPhi = f(f(2 * f(H)) / f(L));
  const a = f(a64);
  const rc = f(rc64);
  const R32 = f(R);
  const asin32 = (x: number) => f(Math.asin(x));
  const along32 = (rho: number) => f(f(Math.sqrt(Math.max(f(f(rho * rho) - f(a * a)), 0))) - rc);
  const along64 = (rho: number) => Math.sqrt(rho * rho - a64 * a64) - rc64;
  let path = 0;
  let cone = 0;
  for (let k = 0; k < G.rows; k++) {
    // l = floor(float(line) + (betaK − asin(a/ρ))/dPhi + 0,5)
    const betaK = asin32(f(a / f(R32 + f(f(k + 0.5) * step))));
    const betaK64 = Math.asin(a64 / (R + (k + 0.5) * step64));
    for (const line of [0, 64, 127, 191])
      for (let s = 0; s <= k; s++) {
        const x = f(f(betaK - asin32(f(a / f(R32 + f(f(s + 0.5) * step))))) / dPhi);
        const arg64 = line + (betaK64 - Math.asin(a64 / (R + (s + 0.5) * step64))) / dPhi64 + 0.5;
        path = Math.max(path, Math.abs(f(f(line + x) + 0.5) - arg64));
      }
    // tomas: floor(halfLines·(2j/8 − 1) + 0,5), con el obstáculo en cualquier fila anterior
    const s32 = along32(f(R32 + f(f(k + 0.5) * step)));
    const s64 = along64(R + (k + 0.5) * step64);
    for (let o = 0; o < k; o++) {
      const so32 = along32(f(R32 + f(f(o + 0.5) * step)));
      const so64 = along64(R + (o + 0.5) * step64);
      const sp32 = f(f(rc + so32) * dPhi);
      const sh32 = f(1 - f(so32 / s32));
      const sp64 = (rc64 + so64) * dPhi64;
      const sh64 = 1 - so64 / s64;
      const halves: Array<[number, number]> = [
        [f(f(f(0.5 * D) * sh32) / sp32), (0.5 * D * sh64) / sp64],
        [f(f(f(0.5 * f(Math.min(Drx, f(s32 / F)))) * sh32) / sp32), (0.5 * Math.min(Drx, s64 / F) * sh64) / sp64],
      ];
      for (let j = 0; j < 9; j++) {
        const t = (2 * j) / 8 - 1;
        for (const [h32, h64] of halves) cone = Math.max(cone, Math.abs(f(f(h32 * t) + 0.5) - (h64 * t + 0.5)));
      }
    }
  }
  return { path, cone };
}

/** A1 de la vista en CPU (sin espejo): el tejido del centro de cada segmento con las reglas de la pasada A. */
function viewGrid(view: StartPoint['id']): { grid: SegmentGrid; ap: ApertureGeometry } {
  const rec = recordingGl({ width: 320, height: 240 });
  const sim = new Simulator(clonePatient(NORMAL_ADULT), rec.canvas);
  const sp = START_POINTS.find((p) => p.id === view)!;
  sim.setPose({ phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 });
  sim.advance(0.05);
  const tr = sim.transducer;
  const grid = emptyGrid({
    ...G,
    lines: tr.lines,
    depthMm: sim.bmode.depthMm,
    curvatureRadius: tr.curvatureRadius,
    halfSector: tr.halfSector,
  });
  const fMHz = sim.profile.bEffectiveMHz;
  for (let l = 0; l < grid.lines; l++) {
    const alpha = -tr.halfSector + ((l + 0.5) * 2 * tr.halfSector) / grid.lines;
    for (let s = 0; s < grid.rows; s++) {
      const t = sim.anatomy.classifyWorld(pointOnLine(sim.frame, tr, alpha, (s + 0.5) * grid.stepMm), sim.sample).tissue;
      const p = TISSUES[t];
      const i = l * grid.rows + s;
      grid.db[i] = p.gas ? GAS_DB_PER_CM * (grid.stepMm / 10) : 2 * attenuationDbPerCm(t, fMHz) * (grid.stepMm / 10);
      grid.air[i] = t === Tissue.Air ? 1 : 0;
      grid.bone[i] = p.bone ? 1 : 0;
      grid.gas[i] = t === Tissue.Lung ? 1 : p.gas ? 2 : 0;
    }
  }
  const b = sim.profile.beam;
  const ap = {
    lines: grid.lines,
    halfSector: tr.halfSector,
    curvatureRadius: tr.curvatureRadius,
    // la emisión de la imagen B a su foco (decisión 84), la de la pasada A
    apertureTxMm: bmodeTxApertureMm(sim.profile, sim.bmode),
    apertureRxMaxMm: b.apertureRxMaxMm,
    fNumberRxMin: b.fNumberRxMin,
  };
  return { grid, ap };
}

/** Lo que leería la GPU si calculara como el gemelo con los redondeos desplazados `bias` líneas. */
function gpuLike(grid: SegmentGrid, ap: ApertureGeometry, theta: number, bias: number) {
  const t = steeredTransmissionTwin(grid, ap, theta, bias);
  const n = grid.lines * grid.rows;
  const prefixDb = new Float64Array(n);
  const aperture = new Float64Array(n);
  for (let l = 0; l < grid.lines; l += 8)
    for (let k = 0; k < grid.rows; k++) {
      prefixDb[k * grid.lines + l] = t.db(l, k);
      aperture[k * grid.lines + l] = t.aperture(l, k);
    }
  return { lines: grid.lines, samples: grid.rows, prefixDb, aperture };
}

const VIEWS: Array<StartPoint['id']> = ['subxiphoid', 'intercostal', 'flank', 'renal'];

describe('paridad de la mirada dirigida: empates de redondeo (G8, decisión 58)', () => {
  it('el margen cubre dos veces el error de float32 de los redondeos de A2 y A en todo el rango de θ', () => {
    for (const deg of [COMPOUND_STEER_RANGE_DEG[0], 7, COMPOUND_STEER_RANGE_DEG[1]])
      for (const sign of [1, -1]) {
        const e = float32RoundingError((sign * deg * Math.PI) / 180);
        const tag = `θ ${sign * deg}°: línea del camino ${e.path.toExponential(2)}, tomas ${e.cone.toExponential(2)} líneas`;
        expect(e.path, tag).toBeLessThanOrEqual(STEERED_TIE_LINES / 2);
        expect(e.cone, tag).toBeLessThanOrEqual(STEERED_TIE_LINES / 2);
      }
  });

  const grids = new Map<StartPoint['id'], ReturnType<typeof viewGrid>>();
  const gridOf = (v: StartPoint['id']) => {
    let g = grids.get(v);
    if (!g) {
      g = viewGrid(v);
      grids.set(v, g);
    }
    return g;
  };

  it('un redondeo desplazado dentro del margen solo cambia muestras marcadas como empate', () => {
    for (const view of ['subxiphoid', 'flank'] as const) {
      const { grid, ap } = gridOf(view);
      for (const look of [1, 2])
        for (const bias of [STEERED_TIE_LINES / 4, -STEERED_TIE_LINES / 4]) {
          const th = lookTheta(look);
          const p = compareSteeredTransmission(grid, ap, th, gpuLike(grid, ap, th, bias), 8);
          const tag = `${view}, mirada ${look}, redondeo ${bias}: ${JSON.stringify(p)}`;
          expect(p.samples, tag).toBeGreaterThan(2000);
          expect(p.maxDiffDb, tag).toBe(0);
          expect(p.apertureMaxDiffDb, tag).toBe(0);
        }
    }
  });

  it('en las cuatro vistas, ≤ 0,75 % de las muestras son empates (la e2e admite 1 %)', () => {
    for (const view of VIEWS) {
      const { grid, ap } = gridOf(view);
      for (const look of [1, 2]) {
        const th = lookTheta(look);
        const p = compareSteeredTransmission(grid, ap, th, gpuLike(grid, ap, th, 0), 8);
        const tag = `${view}, mirada ${look}: ${p.ambiguous} empates en ${p.samples + p.ambiguous} muestras`;
        expect(p.maxDiffDb, tag).toBe(0);
        // 0,04–0,31 % hasta la decisión 62; la vista intercostal por el 8.º espacio ve la vértebra al fondo
        // (14–16 cm), con fronteras hueso/tejido donde el redondeo decide: 0,40 y 0,64 % (13 de sus 22 empates
        // de la mirada 2 están a 154–169 mm)
        expect(p.ambiguous, tag).toBeLessThanOrEqual(0.0075 * p.samples);
      }
    }
  });
});
