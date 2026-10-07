import type { StartPoint } from '../../src/app/startPoints';

/** Self-contained callback for page.evaluate: no module-scoped runtime dependencies. */
export function comparisonState(args: {
  phase: 'prepare' | 'capture';
  targetSeconds: number;
  view?: StartPoint['id'];
  frames?: number;
  historyStartFrame?: number;
}) {
  const hooks = window.__vexusTest!;
  const sim = hooks.sim();
  const button = document.querySelector<HTMLButtonElement>('#freeze');
  const frames = args.frames ?? 6;
  if (!button || !['prepare', 'capture'].includes(args.phase)) throw new Error('Comparison controls unavailable');
  if (args.phase === 'capture' && (!args.view || !Number.isInteger(frames) || frames < 1)) throw new Error('Invalid capture protocol');
  if (!sim.frozen) {
    if (args.phase === 'capture') throw new Error('Comparison must remain frozen between preparation and capture');
    button.click();
  }
  if (!sim.frozen) throw new Error('Could not freeze comparison');
  const start = args.historyStartFrame;
  if (start !== undefined && (args.phase !== 'capture' || !Number.isSafeInteger(start) || start < 2 || start + frames > 4096))
    throw new RangeError('Comparison receiver phase is outside the reproducible frame domain');
  let frameMs: number | null = null;
  let paddingFrames = 0;
  try {
    if (args.phase === 'capture') {
      button.click();
      hooks.goToStartPoint(args.view!);
      // A second ordinary advance at the same pose clears the velocity from moving the probe.
      sim.advance(sim.physiology.clock.dt);
      if (sim.probeVelocity.some((value) => value !== 0)) throw new Error('Comparison probe did not settle');
    }
    const clock = sim.physiology.clock;
    const targetStep = Math.round(args.targetSeconds / clock.dt);
    const remaining = targetStep - clock.step;
    if (
      !Number.isFinite(args.targetSeconds) ||
      Math.abs(targetStep * clock.dt - args.targetSeconds) > 1e-9 ||
      !Number.isSafeInteger(remaining) ||
      remaining < 0 ||
      remaining > 100_000
    )
      throw new RangeError('Comparison time is outside the reproducible step domain');
    for (let i = 0; i < remaining; i++) sim.physiology.step();
    if (clock.step !== targetStep || Math.abs(sim.sample.t - args.targetSeconds) > 1e-9)
      throw new Error('Comparison clock did not reach target');
    if (args.phase === 'capture') {
      if (start !== undefined) {
        if (sim.color.enabled || sim.mmode.enabled) throw new Error('Receiver phase registration requires B-mode without color');
        // Ordinary rendering exposes the current serial through public cine metadata.
        sim.render();
        sim.renderer.cineSeal();
        const current = sim.renderer.cineFrame(sim.renderer.cineCount - 1).n;
        paddingFrames = start - 1 - current;
        if (!Number.isSafeInteger(current) || current < 1 || paddingFrames < 0)
          throw new RangeError(`Comparison receiver phase was already passed or is invalid: current=${current}, requested=${start}`);
        for (let i = 0; i < paddingFrames; i++) sim.render();
      }
      // Reset compound/persistence/cine history without recompiling programs or changing anatomy.
      sim.renderer.setScene(sim.scene);
      frameMs = hooks.frameCostMs(frames);
      if (!Number.isFinite(frameMs) || frameMs <= 0) throw new Error('Invalid frame timing');
    }
  } finally {
    if (!sim.frozen) button.click();
  }
  if (!sim.frozen) throw new Error('Comparison did not stay frozen');
  if (Math.abs(sim.sample.t - args.targetSeconds) > 1e-9) throw new Error('Rendering changed comparison time');
  if (args.phase === 'capture') sim.renderer.cineSeal();
  const frame = args.phase === 'capture' && sim.renderer.cineCount ? sim.renderer.cineFrame(sim.renderer.cineCount - 1) : null;
  if (args.phase === 'capture' && (!frame || frame.t !== sim.sample.t)) throw new Error('Captured image is not at the comparison time');
  if (start !== undefined && frame?.n !== start + frames) throw new Error('Captured image is not at the registered receiver phase');
  return {
    frameMs,
    pose: { ...sim.pose },
    probeVelocityMmS: [...sim.probeVelocity],
    bmode: structuredClone(sim.bmode),
    respiration: sim.patient.respiratoryPattern,
    displacementMm: sim.sample.resp.diaphragmCaudalMm,
    reference: !!sim.scene.torso.profile,
    caseId: sim.patient.id,
    seed: sim.patient.seed,
    time: sim.physiology.clock.t,
    step: sim.physiology.clock.step,
    frozen: sim.frozen,
    renderedFrame: frame?.n ?? null,
    sample: structuredClone(sim.sample),
    protocol: {
      phase: args.phase,
      targetSeconds: args.targetSeconds,
      frames: args.phase === 'capture' ? frames + 1 : 0,
      receiverPhaseReset: false,
      receiverPhaseRegistered: start !== undefined,
      historyStartFrame: start ?? null,
      historyEndFrame: start === undefined ? null : start + frames,
      paddingFrames,
    },
  };
}
