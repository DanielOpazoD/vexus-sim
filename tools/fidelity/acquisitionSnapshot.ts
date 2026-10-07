import type { StartPoint } from '../../src/app/startPoints';

/** Callback serializable: inspect the frame that was actually presented, not a worker result. */
export function acquisitionSnapshot(view: StartPoint['id']) {
  const hooks = window.__vexusTest!;
  const sim = hooks.sim();
  // Freezing the live image seals it without selecting a replay index.
  const shown = sim.renderer.cineShownFrame ?? (sim.renderer.cineCount ? sim.renderer.cineFrame(sim.renderer.cineCount - 1) : null);
  const anatomy = sim.renderer.displayedAnatomy;
  if (!sim.frozen || !shown || !anatomy) throw new Error('Acquisition must be frozen with a presented frame');
  return structuredClone({
    schemaVersion: 1,
    view,
    caseId: sim.patient.id,
    seed: sim.patient.seed,
    patient: sim.patient,
    sample: anatomy.sample,
    anatomyMode: sim.scene.hasAbdominalAtlas ? 'atlas' : 'legacy',
    pose: sim.pose,
    presentedFrame: shown.n,
    loopFrames: hooks.framesRendered(),
    acquiredTimeSeconds: shown.t,
    presentedSampleTimeSeconds: anatomy.sample.t,
    clock: { step: sim.physiology.clock.step, dtSeconds: sim.physiology.clock.dt, timeSeconds: sim.sample.t },
    frame: anatomy.frame,
    currentFrame: sim.frame,
    compression: anatomy.compression,
    respiration: { pattern: sim.patient.respiratoryPattern, ...anatomy.sample.resp },
    transducer: sim.transducer,
    bmode: sim.displayed.bmode,
    color: sim.displayed.color,
    pw: sim.pw,
    compound: sim.renderer.compoundState(),
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    errors: hooks.loggedErrors(),
  });
}

export type AcquisitionSnapshot = ReturnType<typeof acquisitionSnapshot>;

/** Identity checks protect the instrument; they do not certify anatomy or clinical fidelity. */
export function validateAcquisition(
  snapshot: Pick<
    AcquisitionSnapshot,
    | 'anatomyMode'
    | 'caseId'
    | 'color'
    | 'presentedFrame'
    | 'acquiredTimeSeconds'
    | 'presentedSampleTimeSeconds'
    | 'errors'
    | 'frame'
    | 'currentFrame'
  >,
  expected: { anatomy: string; caseId: string; time?: number },
): void {
  if (snapshot.anatomyMode !== expected.anatomy || snapshot.caseId !== expected.caseId) throw new Error('Unexpected acquisition domain');
  if (snapshot.color.enabled) throw new Error('B-mode audit requires color disabled');
  if (!Number.isSafeInteger(snapshot.presentedFrame) || snapshot.presentedFrame < 1) throw new Error('Invalid presented frame');
  if (!Number.isFinite(snapshot.acquiredTimeSeconds) || Math.abs(snapshot.acquiredTimeSeconds - snapshot.presentedSampleTimeSeconds) > 1e-9)
    throw new Error('Presented anatomy and signal times differ');
  if (expected.time !== undefined && Math.abs(snapshot.acquiredTimeSeconds - expected.time) > 1e-9)
    throw new Error('Static acquisition did not reach its requested time');
  if (snapshot.errors.length) throw new Error('Acquisition contains renderer errors');
  // A cine frame selected before a pose change must not be attributed to the current probe.
  for (const key of ['face', 'axial', 'lateral', 'elevation', 'curvatureCenter'] as const) {
    const a = snapshot.frame[key],
      b = snapshot.currentFrame[key];
    if (a.some((v, i) => !Number.isFinite(v) || !Number.isFinite(b[i]) || Math.abs(v - b[i]) > 1e-8))
      throw new Error('Presented geometry differs from the recorded probe');
  }
}
