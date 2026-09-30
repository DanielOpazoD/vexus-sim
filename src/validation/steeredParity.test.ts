// @tier slow
import { describe, expect, it } from 'vitest';
import { TISSUES, Tissue, attenuationDbPerCm } from '../anatomy/tissues';
import { Simulator } from '../app/simulator';
import { START_POINTS, type StartPoint } from '../app/startPoints';
import { STEERED_TIE_LINES, TIE_APERTURE_DB, compareSteeredTransmission, steeredTransmissionTwin } from '../app/steeredParity';
import { NORMAL_ADULT } from '../cases';
import { clonePatient } from '../physiology/patientState';
import { pointOnLine } from '../probe/probe';
import { refractionBeam, type ApertureGeometry } from '../ultrasound/aperture';
import { bmodeBeam, bmodeTxApertureMm } from '../ultrasound/transducerProfile';
import { COMPOUND_STEER_RANGE_DEG, lookTheta } from '../ultrasound/compound';
import { GAS_DB_PER_CM, lumenExcessPerMm, type SegmentGrid } from '../ultrasound/transmission';
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
 * Error de float32 del argumento del redondeo dirigido, emulando el GLSL operación a operación
 * (`STEERED_PREFIX_GLSL`: línea del camino en cada fila) frente a float64 (los gemelos). Uniforms en float32; asin y
 * sqrt correctamente redondeados. El cono de la penumbra (`STEERED_APERTURE_GLSL`) ya no redondea: es la integral exacta
 * de su ventana sobre las líneas (decisión 91).
 */
function float32RoundingError(theta: number): { path: number } {
  const R = G.curvatureRadius;
  const H = G.halfSector;
  const L = G.lines;
  const step64 = G.depthMm / G.rows;
  const dPhi64 = (2 * H) / L;
  const a64 = R * Math.sin(theta);
  const step = f(f(G.depthMm) / f(G.rows));
  const dPhi = f(f(2 * f(H)) / f(L));
  const a = f(a64);
  const R32 = f(R);
  const asin32 = (x: number) => f(Math.asin(x));
  let path = 0;
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
  }
  return { path };
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
      // el camino de más de las luces (decisión 86), como A1
      grid.excess[i] = lumenExcessPerMm(t) * grid.stepMm;
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
    refraction: refractionBeam(bmodeBeam(sim.profile, sim.bmode), sim.bmode.focusMm),
  };
  return { grid, ap };
}

/** Lo que leería la GPU si calculara como el gemelo con los redondeos desplazados `bias` líneas. */
function gpuLike(grid: SegmentGrid, ap: ApertureGeometry, theta: number, bias: number) {
  const t = steeredTransmissionTwin(grid, ap, theta, bias);
  const n = grid.lines * grid.rows;
  const prefixDb = new Float64Array(n);
  const aperture = new Float64Array(n);
  const specular = new Float64Array(n);
  for (let l = 0; l < grid.lines; l += 8)
    for (let k = 0; k < grid.rows; k++) {
      prefixDb[k * grid.lines + l] = t.db(l, k);
      aperture[k * grid.lines + l] = t.aperture(l, k);
      specular[k * grid.lines + l] = t.specular(l, k);
    }
  return { lines: grid.lines, samples: grid.rows, prefixDb, aperture, specular };
}

const VIEWS: Array<StartPoint['id']> = ['subxiphoid', 'intercostal', 'flank', 'renal'];

describe('paridad de la mirada dirigida: empates de redondeo (G8, decisión 58)', () => {
  it('el margen cubre dos veces el error de float32 del redondeo de A2 en todo el rango de θ', () => {
    for (const deg of [COMPOUND_STEER_RANGE_DEG[0], 7, COMPOUND_STEER_RANGE_DEG[1]])
      for (const sign of [1, -1]) {
        const e = float32RoundingError((sign * deg * Math.PI) / 180);
        const tag = `θ ${sign * deg}°: línea del camino ${e.path.toExponential(2)} líneas`;
        expect(e.path, tag).toBeLessThanOrEqual(STEERED_TIE_LINES / 2);
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

  it('un redondeo desplazado dentro del margen solo cambia muestras marcadas como empate (la apertura, menos que su umbral)', () => {
    for (const view of ['subxiphoid', 'flank'] as const) {
      const { grid, ap } = gridOf(view);
      for (const look of [1, 2])
        for (const bias of [STEERED_TIE_LINES / 4, -STEERED_TIE_LINES / 4]) {
          const th = lookTheta(look);
          const p = compareSteeredTransmission(grid, ap, th, gpuLike(grid, ap, th, bias), 8);
          const tag = `${view}, mirada ${look}, redondeo ${bias}: ${JSON.stringify(p)}`;
          expect(p.samples, tag).toBeGreaterThan(2000);
          expect(p.apertureSamples, tag).toBeGreaterThan(2000);
          expect(p.specularSamples, tag).toBeGreaterThan(2000);
          expect(p.maxDiffDb, tag).toBe(0);
          // la transmisión con apertura integra todas las líneas de su cono (decisión 91): un empate de una vecina la mueve
          // lo que esa línea pesa, y solo se marca desde la mitad de la tolerancia de la e2e
          expect(p.apertureMaxDiffDb, tag).toBeLessThanOrEqual(TIE_APERTURE_DB);
          // y la de los especulares (A o2.w, decisión 91), con el mismo umbral
          expect(p.specularMaxDiffDb, tag).toBeLessThanOrEqual(TIE_APERTURE_DB);
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
        expect(p.specularMaxDiffDb, tag).toBe(0);
        // 0,04–0,31 % hasta la decisión 62; la vista intercostal por el 8.º espacio ve la vértebra al fondo
        // (14–16 cm), con fronteras hueso/tejido donde el redondeo decide: 0,40 y 0,64 % (13 de sus 22 empates
        // de la mirada 2 están a 154–169 mm)
        expect(p.ambiguous, tag).toBeLessThanOrEqual(0.0075 * p.samples);
      }
    }
  });

  it('compara la penumbra y los especulares bajo el borde de los huesos, donde el prefijo de la línea ya pasa de −60 dB', () => {
    // Revisión de la decisión 91: la paridad saltaba las muestras con los dos prefijos bajo −60 dB, justo donde viven la
    // penumbra y los pares de la apertura (luz de las líneas vecinas al borde de una costilla). Una GPU que los apagara
    // ahí pasaba con 0 dB de desacuerdo. Cada canal se compara ahora donde él mismo pasa de −60 dB.
    const { grid, ap } = gridOf('flank');
    const th = lookTheta(1);
    const twin = steeredTransmissionTwin(grid, ap, th, 0);
    for (const channel of ['aperture', 'specular'] as const) {
      const g = gpuLike(grid, ap, th, 0);
      let hidden = 0;
      for (let l = 0; l < grid.lines; l += 8)
        for (let k = 0; k < grid.rows; k++)
          if (twin.db(l, k) > 60 && -20 * Math.log10(twin[channel](l, k)) < 40) {
            g[channel][k * grid.lines + l] = 1e-12;
            hidden++;
          }
      const p = compareSteeredTransmission(grid, ap, th, g, 8);
      const tag = `${channel}: ${hidden} muestras apagadas bajo el hueso; ${JSON.stringify(p)}`;
      expect(hidden, tag).toBeGreaterThan(20);
      expect(p.maxDiffDb, tag).toBe(0);
      expect(channel === 'aperture' ? p.apertureMaxDiffDb : p.specularMaxDiffDb, tag).toBeGreaterThan(100);
    }
  });
});
