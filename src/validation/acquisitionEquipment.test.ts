import { describe, expect, it, vi } from 'vitest';
import { dopplerScaleCommand } from '../app/dopplerScale';
import { AcquisitionEquipment } from '../app/acquisitionEquipment';
import { EquipmentController, reduceEquipment, type EquipmentCommand } from '../app/equipment';
import { Simulator, defaultEquipment, type EquipmentSettings } from '../app/simulator';
import type { DopplerAudio } from '../audio/dopplerAudio';
import { NORMAL_ADULT } from '../cases';
import { C_RECONSTRUCTION_MM_S, nyquistVelocityCms } from '../core/units';
import { clonePatient } from '../physiology/patientState';
import { CONVEX_C35_PROFILE } from '../ultrasound/transducerProfile';
import type { FrameInputs, UltrasoundRenderer } from '../ultrasound/renderer';

const profile = CONVEX_C35_PROFILE;
const ctx = { halfSectorRad: profile.geometry.halfSector, cMmS: C_RECONSTRUCTION_MM_S };
const read = (cache: AcquisitionEquipment, e: EquipmentSettings) =>
  cache.get(e, profile.geometry.lines, profile.colorLineSpacingRad, ctx.cMmS);
const triplex = () =>
  reduceEquipment(reduceEquipment(defaultEquipment(), { type: 'mode', mode: 'triplex' }, ctx), { type: 'pw', patch: { prfHz: 4000 } }, ctx);

function rig() {
  const audio = { reset: vi.fn(), pushIQ: vi.fn() };
  const frames: FrameInputs[] = [];
  const renderer = {
    displayedFrame: null as Pick<FrameInputs, 'bmode' | 'color'> | null,
    setScene() {},
    render(inputs: FrameInputs) {
      frames.push(inputs);
      this.displayedFrame = { bmode: inputs.bmode, color: inputs.color };
    },
  };
  const sim = new Simulator(
    clonePatient(NORMAL_ADULT),
    {} as HTMLCanvasElement,
    audio as unknown as DopplerAudio,
    renderer as unknown as UltrasoundRenderer,
  );
  const equipment = new EquipmentController(triplex(), ctx);
  sim.equipment = equipment.state;
  audio.reset.mockClear();
  equipment.subscribe((next) => {
    sim.equipment = next;
  });
  return { sim, equipment, frames, audio, dispatch: (cmd: EquipmentCommand) => equipment.dispatch(cmd) };
}

describe('estado solicitado y relojes efectivos', () => {
  it('preserva solicitudes y reutiliza relojes durante lecturas y cambios de ganancia', () => {
    const e = triplex(),
      original = structuredClone(e),
      cache = new AcquisitionEquipment();
    const first = read(cache, e);
    expect(first.pw.prfHz).toBeLessThan(e.pw.prfHz);
    expect(first.color.prfHz).toBeLessThan(e.color.prfHz);
    for (let i = 0; i < 1000; i++) expect(read(cache, e)).toBe(first);
    const gained = read(cache, reduceEquipment(e, { type: 'pw', patch: { gainDb: 3 } }, ctx));
    expect(gained.schedule).toBe(first.schedule);
    expect(gained.pw.gainDb).toBe(3);
    expect(e).toEqual(original);
    expect(read(cache, e).schedule).toBe(first.schedule);
  });

  it('el control avanza en ambos sentidos por escalas alcanzables sin reutilizar una petición oculta', () => {
    const cache = new AcquisitionEquipment();
    let e = triplex();
    const scale = (state: EquipmentSettings) => Math.round(nyquistVelocityCms(read(cache, state).color.prfHz, profile.geometry.f0Doppler));
    const before = scale(e),
      pw = e.pw.prfHz;
    const up = reduceEquipment(e, dopplerScaleCommand(e, profile, 'color', before + 1), ctx);
    expect(scale(up)).toBeGreaterThan(before);
    expect(up.pw.prfHz).toBe(pw);
    const down = reduceEquipment(up, dopplerScaleCommand(up, profile, 'color', scale(up) - 1), ctx);
    expect(scale(down)).toBeLessThan(scale(up));
    expect(e.color.prfHz).toBe(2000);
    for (let i = 0; i < 30; i++) e = reduceEquipment(e, dopplerScaleCommand(e, profile, 'color', scale(e) + 1), ctx);
    expect(read(cache, e).color.prfHz).toBeLessThanOrEqual(e.color.prfHz);
    const atCeiling = read(cache, e).color.prfHz;
    e = reduceEquipment(e, dopplerScaleCommand(e, profile, 'color', scale(e) + 1), ctx);
    expect(read(cache, e).color.prfHz).toBe(atCeiling);
  });

  it.each([
    ['color', 31, 2013],
    ['pw', 40, 2597],
  ] as const)('aplica el valor explícito %s aunque coincida con su rótulo redondeado', (mode, value, prf) => {
    const e = reduceEquipment(defaultEquipment(), { type: 'mode', mode }, ctx),
      original = structuredClone(e),
      cache = new AcquisitionEquipment();
    expect(Math.round(nyquistVelocityCms(read(cache, e)[mode].prfHz, profile.geometry.f0Doppler))).toBe(value);
    expect(e[mode].prfHz).not.toBe(prf);
    const next = reduceEquipment(e, dopplerScaleCommand(e, profile, mode, value), ctx);
    expect(next[mode].prfHz).toBe(prf);
    expect(next[mode === 'pw' ? 'color' : 'pw']).toEqual(e[mode === 'pw' ? 'color' : 'pw']);
    expect(e).toEqual(original);
    expect(read(cache, next)[mode].prfHz).toBeLessThanOrEqual(prf);
  });

  it('invalida por cada parámetro físico y conserva una traslación angular de igual anchura', () => {
    const e = triplex();
    const variants: EquipmentSettings[] = [
      { ...e, bmode: { ...e.bmode, depthMm: 200 } },
      { ...e, bmode: { ...e.bmode, harmonic: true } },
      { ...e, color: { ...e.color, enabled: false } },
      { ...e, color: { ...e.color, theta1: e.color.theta1 + 0.1 } },
      { ...e, color: { ...e.color, r1: e.color.r1 - 10 } },
      { ...e, color: { ...e.color, ensemble: e.color.ensemble + 2 } },
      { ...e, color: { ...e.color, prfHz: 500 } },
      { ...e, pw: { ...e.pw, enabled: false } },
      { ...e, pw: { ...e.pw, prfHz: 500 } },
      { ...e, pw: { ...e.pw, depthMm: e.pw.depthMm + 10 } },
      { ...e, pw: { ...e.pw, gateMm: 8 } },
    ];
    for (const v of variants) {
      const cache = new AcquisitionEquipment(),
        before = read(cache, e);
      expect(read(cache, v).schedule).not.toBe(before.schedule);
    }
    for (const [lines, spacing, speed] of [
      [256, profile.colorLineSpacingRad, ctx.cMmS],
      [profile.geometry.lines, 0.02, ctx.cMmS],
      [profile.geometry.lines, profile.colorLineSpacingRad, 1500000],
    ]) {
      const cache = new AcquisitionEquipment(),
        before = read(cache, e);
      expect(cache.get(e, lines, spacing, speed).schedule).not.toBe(before.schedule);
    }
    const cache = new AcquisitionEquipment(),
      before = read(cache, e);
    const moved = read(cache, { ...e, color: { ...e.color, theta0: e.color.theta0 + 0.125, theta1: e.color.theta1 + 0.125 } });
    expect(moved.schedule).toBe(before.schedule);
    expect(moved.color.theta0).toBe(e.color.theta0 + 0.125);
  });

  it('reserva dos disparos B por línea armónica y limita el filtro con la frecuencia efectiva', () => {
    const e = triplex(),
      cache = new AcquisitionEquipment();
    const b = read(cache, e);
    const h = read(cache, { ...e, bmode: { ...e.bmode, harmonic: true } });
    expect(h.timing.bFrameS).toBe(2 * b.timing.bFrameS);
    expect(h.schedule.frameS).toBeGreaterThanOrEqual(b.schedule.frameS);
    const slow = read(cache, {
      ...e,
      color: { ...e.color, prfHz: 250, wallFilterHz: 400 },
      pw: { ...e.pw, prfHz: 500, wallFilterHz: 300 },
    });
    expect(slow.color.wallFilterHz).toBe(slow.color.prfHz * 0.45);
    expect(slow.pw.wallFilterHz).toBe(slow.pw.prfHz * 0.45);
    expect(e.color.wallFilterHz).toBe(60);
  });

  it('conecta IQ, filtro, FFT, audio y Nyquist al mismo reloj y no mezcla FFT al cambiarlo', () => {
    const { sim, audio, dispatch } = rig();
    const signal = vi.spyOn(sim.sampleVolume, 'setEquipment');
    const filter = vi.spyOn(sim.pwChain.wallFilter, 'design');
    const before = sim.pw.prfHz;
    sim.advance(0.12);
    // El equipo se adopta al asignarlo, antes de advance; un lote equivalente no vuelve a configurarlo.
    expect(signal).not.toHaveBeenCalled();
    expect(filter).not.toHaveBeenCalled();
    expect(sim.pwChain.readCapture()).toMatchObject({
      kind: 'ready',
      acquiredEquipment: { prfHz: before, wallFilterHz: sim.pw.wallFilterHz },
    });
    expect(sim.pwChain.wallFilter.cutoffHz).toBe(sim.pw.wallFilterHz);
    expect(audio.pushIQ.mock.calls.at(-1)![3]).toBe(before);
    expect(sim.spectral.columns.length).toBeGreaterThan(0);
    expect(sim.spectral.columns.every((c) => c.prfHz === before)).toBe(true);
    expect(sim.pwNyquistCms()).toBe(nyquistVelocityCms(before, sim.transducer.f0Doppler, sim.pw.angleCorrection));
    dispatch({ type: 'bmode', patch: { depthMm: 240 } });
    const after = sim.pw.prfHz;
    expect(after).not.toBe(before);
    sim.advance(0.004);
    expect(audio.reset).toHaveBeenCalledTimes(1);
    expect(sim.spectral.columns).toHaveLength(0); // Se descarta el tramo incompatible, aún falta una ventana nueva.
    sim.advance(0.12);
    expect(sim.spectral.columns.length).toBeGreaterThan(0);
    expect(sim.spectral.columns.every((c) => c.prfHz === after)).toBe(true);
    expect(audio.pushIQ.mock.calls.at(-1)![3]).toBe(after);
    expect(signal).toHaveBeenLastCalledWith(expect.objectContaining({ prfHz: after }));
  });

  it('invalida PW al asignar filtro/ganancia congelado, conservando reloj y población', () => {
    const { sim, dispatch } = rig();
    sim.advance(0.12);
    const t = sim.sample.t,
      particles = sim.sampleVolume.particleCount;
    expect(sim.spectral.columns.length).toBeGreaterThan(0);
    sim.frozen = true;
    dispatch({ type: 'pw', patch: { gainDb: 12 } });
    expect(sim.spectral.columns).toEqual([]);
    expect(sim.pwChain.readCapture()).toMatchObject({ kind: 'waiting', reason: 'samples' });
    expect(sim.sample.t).toBe(t);
    expect(sim.sampleVolume.particleCount).toBe(particles);
    const valid = sim.equipment;
    expect(() => {
      sim.equipment = { ...valid, pw: { ...valid.pw, gainDb: NaN } };
    }).toThrow(RangeError);
    expect(sim.equipment).toBe(valid);
    expect(sim.pw.gainDb).toBe(12);
  });

  it('los cuatro mandos de presentación no reacquieren ni alteran señal/audio', () => {
    const { sim, audio, dispatch } = rig();
    sim.advance(0.12);
    const columns = structuredClone(sim.spectral.columns),
      revision = sim.pwChain.revision;
    sim.frozen = true;
    audio.reset.mockClear();
    dispatch({ type: 'pw', patch: { baselineShift: 0.2, invert: true, angleCorrection: 0.3, sweepMmS: 100 } });
    expect(sim.spectral.columns).toEqual(columns);
    expect(sim.pwChain.revision).toBe(revision);
    expect(audio.reset).not.toHaveBeenCalled();
  });

  it('conserva el cuadro adquirido al mover puerta/caja o congelar y entrega el nuevo reloj en la siguiente adquisición', () => {
    const { sim, frames, dispatch } = rig();
    expect(sim.displayed.color.prfHz).toBe(sim.color.prfHz);
    expect(sim.displayed.color.prfHz).not.toBe(sim.equipment.color.prfHz);
    sim.render();
    const acquired = sim.displayed;
    dispatch({ type: 'placeGate', theta: 0.1, r: 130, withColorBox: true });
    expect(sim.displayed).toBe(acquired);
    sim.frozen = true;
    sim.render();
    sim.advance(0.3);
    expect(sim.displayed).toBe(acquired);
    expect(frames).toHaveLength(1);
    sim.frozen = false;
    for (let remaining = 1 / sim.colorTiming.frameHz + 0.02; remaining > 0; remaining -= 0.25) sim.advance(Math.min(0.25, remaining));
    sim.render();
    expect(frames).toHaveLength(2);
    expect(sim.displayed.color).toBe(sim.color);
    expect(acquired.color.prfHz).not.toBe(sim.displayed.color.prfHz);
    expect(acquired.color.r1).not.toBe(sim.displayed.color.r1);
  });

  it('adquiere el primer cuadro aunque el periodo Color sea mayor que un segundo', () => {
    const { sim, dispatch, frames } = rig();
    dispatch({ type: 'mode', mode: 'color' });
    dispatch({ type: 'color', patch: { theta0: -0.5, theta1: 0.5, prfHz: 250, ensemble: 16 } });
    expect(1 / sim.colorTiming.frameHz).toBeGreaterThan(1);
    sim.render();
    sim.render();
    expect(frames).toHaveLength(1);
    expect(frames[0].color.prfHz).toBe(sim.color.prfHz);
  });

  it('limita también B+PW sin reducir líneas y recupera B puro al apagar Doppler', () => {
    const { sim, dispatch, frames } = rig();
    dispatch({ type: 'mode', mode: 'pw' });
    sim.render();
    sim.render();
    expect(frames).toHaveLength(1);
    sim.advance(1 / sim.colorTiming.frameHz + 0.02);
    sim.render();
    expect(frames).toHaveLength(2);
    expect(sim.transducer.lines).toBe(profile.geometry.lines);
    dispatch({ type: 'mode', mode: 'B' });
    sim.render();
    sim.render();
    expect(frames).toHaveLength(4);
    expect(sim.pw.prfHz).toBe(sim.equipment.pw.prfHz);
  });
});
