import { beforeAll, describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { startPointsFor } from '../app/startPoints';
import { NORMAL_ADULT } from '../cases';
import { probeContact } from '../probe/contact';
import { CONVEX_C35, pointOnLine, type ProbePose } from '../probe/probe';
import {
  CROSSFADE_SECONDS,
  ElevationAnchor,
  JUMP_DEG,
  JUMP_MM,
  speckleSliceField,
  type SpeckleAnchorState,
} from '../ultrasound/speckleField';

// Medio homogéneo estático: mismos puntos materiales, semilla y pose al regresar.
// No es una PSF independiente, una imagen GPU ni una calibración clínica.
const torso = new AnatomyScene(NORMAL_ADULT).torso;
const start = startPointsFor(torso).find((p) => p.id === 'intercostal')!;
const base: ProbePose = { phi: start.phi, z: start.z, lift: 0, yaw: start.yaw, rock: start.rock ?? 0, tilt: start.tilt ?? 0 };
const frameAt = (pose: ProbePose) => probeContact(pose, CONVEX_C35, torso).frame;
const initialFrame = frameAt(base);

function field(state: SpeckleAnchorState): number[] {
  const out: number[] = [];
  for (let i = 0; i < 16; i++)
    for (let j = 0; j < 16; j++) {
      const r = 86 + j * 0.5;
      const m = pointOnLine(initialFrame, CONVEX_C35, -0.08 + i * 0.01, r);
      const se = 1.6 * Math.sqrt(1 + ((r - CONVEX_C35.elevationFocusMm) / 45) ** 2);
      out.push(...speckleSliceField(m, 0.42, se, (1234 % 1000) / 7, state));
    }
  return out;
}

function closedLoop(fps: number, radiusDeg: number) {
  const anchor = new ElevationAnchor();
  const initial = anchor.update(initialFrame.face, initialFrame.elevation, 0);
  let state = initial;
  let previous = initialFrame;
  let maxStepMm = 0;
  let maxStepDeg = 0;
  let time = 0;
  const update = (pose: ProbePose) => {
    const next = frameAt(pose);
    maxStepMm = Math.max(maxStepMm, Math.hypot(...next.face.map((x, j) => x - previous.face[j])));
    const dot = next.elevation.reduce((sum, x, j) => sum + x * previous.elevation[j], 0);
    maxStepDeg = Math.max(maxStepDeg, (Math.acos(Math.min(1, Math.abs(dot))) * 180) / Math.PI);
    state = anchor.update(next.face, next.elevation, (time += 1 / fps));
    previous = next;
  };
  // Círculo en yaw/tilt: yaw ±radio, tilt 0…2·radio, duración 4/3 s en ambas cadencias.
  const steps = Math.round((4 / 3) * fps);
  for (let i = 1; i <= steps; i++) {
    const angle = (2 * Math.PI * i) / steps;
    update({
      ...base,
      yaw: base.yaw + (radiusDeg * Math.PI * Math.sin(angle)) / 180,
      tilt: base.tilt + (radiusDeg * Math.PI * (1 - Math.cos(angle))) / 180,
    });
  }
  // Esperar el fundido y volver exactamente evita medir una transición inconclusa o sin(2π).
  for (let i = 0; i < Math.ceil((CROSSFADE_SECONDS + 0.1) * fps); i++) update(base);
  return { fps, radiusDeg, initial: field(initial), returned: field(state), maxStepMm, maxStepDeg, finalFrame: previous, weight: state.w };
}

function relativeRms(a: number[], b: number[]): number {
  return Math.sqrt(b.reduce((sum, x, i) => sum + (x - a[i]) ** 2, 0) / a.reduce((sum, x) => sum + x * x, 0));
}

describe('retorno del campo material tras un recorrido cerrado (limitación speckle-path-dependent)', () => {
  let small: ReturnType<typeof closedLoop>[];
  let wide: ReturnType<typeof closedLoop>[];
  // Los errores de preparación no quedan absorbidos como fallos físicos esperados.
  beforeAll(() => {
    small = [30, 60].map((fps) => closedLoop(fps, 2));
    wide = [30, 60].map((fps) => closedLoop(fps, 8));
  });

  it('recorridos válidos: sin teletransporte, mismo marco, campo finito y fundido terminado', () => {
    for (const row of [...small, ...wide]) {
      expect(row.maxStepMm).toBeLessThan(JUMP_MM);
      expect(row.maxStepDeg).toBeLessThan(JUMP_DEG);
      expect(row.finalFrame).toEqual(initialFrame);
      expect(row.weight).toBe(1);
      expect(row.initial).toHaveLength(512);
      expect(row.returned).toHaveLength(512);
      expect([...row.initial, ...row.returned].every(Number.isFinite)).toBe(true);
      expect(row.initial.reduce((sum, x) => sum + x * x, 0)).toBeGreaterThan(0);
    }
  });

  it.each([
    { index: 0, fps: 30 },
    { index: 1, fps: 60 },
  ])('un recorrido pequeño conserva el mismo campo ($fps Hz)', ({ index }) => {
    const row = small[index];
    expect(row.returned).toEqual(row.initial);
  });

  // Contrato pendiente: con medio estático, el recorrido no puede inventar otros dispersores.
  // 1e-6 es tolerancia numérica relativa float32, no un umbral perceptual ni una nueva calibración.
  it.fails.each([
    { index: 0, fps: 30 },
    { index: 1, fps: 60 },
  ])('un recorrido amplio conserva el mismo campo ($fps Hz)', ({ index }) => {
    const row = wide[index];
    expect(relativeRms(row.initial, row.returned)).toBeLessThan(1e-6);
  });

  it.fails('el campo final no depende de dibujar el mismo recorrido a 30 o 60 Hz', () => {
    expect(relativeRms(wide[0].returned, wide[1].returned)).toBeLessThan(1e-6);
  });
});
