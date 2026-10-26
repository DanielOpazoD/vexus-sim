import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { describe, expect, it, vi } from 'vitest';
import { setAbdominalBody, setReferenceBody } from '../anatomy/referenceBody';
import { Simulator } from '../app/simulator';
import { NORMAL_ADULT } from '../cases';
import { clonePatient } from '../physiology/patientState';
import { probeContact } from '../probe/contact';
import type { ProbePose } from '../probe/probe';
import type { FrameInputs, UltrasoundRenderer } from '../ultrasound/renderer';

const bytes = readFileSync('src/anatomy/reference-body.bin');
const profile = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const atlasBytes = gunzipSync(readFileSync('src/anatomy/abdominal-atlas.gzip.bin'));
const atlas = new Uint16Array(atlasBytes.buffer.slice(atlasBytes.byteOffset, atlasBytes.byteOffset + atlasBytes.byteLength));
const bodyBytes = readFileSync('src/anatomy/abdominal-body.bin');
const body = new Float32Array(bodyBytes.buffer.slice(bodyBytes.byteOffset, bodyBytes.byteOffset + bodyBytes.byteLength));

function rig() {
  const frames: FrameInputs[] = [];
  const renderer = {
    displayedFrame: null as Pick<FrameInputs, 'bmode' | 'color'> | null,
    setScene() {},
    render(inputs: FrameInputs) {
      frames.push(inputs);
      this.displayedFrame = { bmode: inputs.bmode, color: inputs.color };
    },
  };
  const sim = new Simulator(clonePatient(NORMAL_ADULT), {} as HTMLCanvasElement, undefined, renderer as unknown as UltrasoundRenderer);
  return { sim, frames };
}

describe('pose, contacto y adquisición pertenecen al mismo cuadro', () => {
  it('conserva los ajustes de la imagen adquirida mientras los nuevos controles esperan otra adquisición', () => {
    const { sim, frames } = rig();
    expect(sim.displayed).toBe(sim.equipment);
    sim.render();
    const acquired = sim.displayed;
    sim.equipment = {
      ...sim.equipment,
      bmode: { ...sim.bmode, depthMm: sim.bmode.depthMm + 20, focusMm: sim.bmode.focusMm + 10 },
      color: { ...sim.color, invert: !sim.color.invert },
    };
    expect(sim.displayed).toBe(acquired);
    expect(sim.displayed.bmode.depthMm).not.toBe(sim.bmode.depthMm);
    expect(sim.displayed.color.invert).not.toBe(sim.color.invert);
    expect(frames).toHaveLength(1);
    expect(sim.physiology.clock.t).toBe(0);
    sim.render();
    expect(sim.displayed.bmode).toBe(sim.bmode);
    expect(sim.displayed.color).toBe(sim.color);
  });

  for (const domain of ['legacy', 'reference', 'atlas'] as const) {
    it(`un movimiento entre pasos físicos actualiza el haz sin avanzar el reloj (${domain})`, () => {
      setReferenceBody(domain === 'reference' ? profile : undefined);
      setAbdominalBody(domain === 'atlas' ? body : undefined);
      setAbdominalAtlas(domain === 'atlas' ? atlas : undefined);
      try {
        const { sim, frames } = rig();
        const sample = sim.sample;
        const changes: Partial<ProbePose>[] = [
          { phi: sim.pose.phi - 0.2 },
          { z: -25 },
          { yaw: 0.12 },
          { rock: 0.12 },
          { tilt: 0.12 },
          { lift: -1 },
        ];
        for (const change of changes) {
          sim.setPose({ ...sim.pose, ...change });
          sim.advance(0);
          sim.render();
          const expected = probeContact(sim.pose, sim.transducer, sim.scene.torso);
          // El oráculo vuelve a calcular el contacto sobre la piel real, incluida la presión;
          // no se limita a comparar dos copias del metadato de pose.
          expect(frames.at(-1)!.frame).toEqual(expected.frame);
          expect(frames.at(-1)!.compression).toEqual(expected);
          expect(sim.frame).toEqual(expected.frame);
          expect(frames.at(-1)!.pose).toEqual(sim.pose);
          expect(sim.sample).toBe(sample);
          expect(sim.physiology.clock.t).toBe(0);
          expect(sim.gateTrack).toEqual([]);
        }
      } finally {
        setReferenceBody();
        setAbdominalBody();
        setAbdominalAtlas();
      }
    });
  }

  it('dibujar entre pasos no borra la velocidad del movimiento que recibirá el Doppler', () => {
    const a = rig().sim,
      b = rig().sim;
    for (const sim of [a, b]) sim.advance(1 / 60);
    const pose = { ...a.pose, phi: a.pose.phi - 0.12, lift: -1 };
    a.setPose(pose);
    b.setPose(pose);
    a.render();
    a.render();
    expect(a.sample).toEqual(b.sample);
    for (const sim of [a, b]) sim.advance(1 / 60);
    expect(a.probeVelocity).toEqual(b.probeVelocity);
    expect(Math.hypot(...a.probeVelocity)).toBeGreaterThan(0);
    expect(a.sample).toEqual(b.sample);
  });

  it('conservar el contacto de una pose idéntica evita recalcularlo por cada dibujo', () => {
    const { sim } = rig();
    const contact = sim.contact;
    sim.setPose({ ...sim.pose });
    sim.render();
    sim.advance(sim.physiology.clock.dt);
    expect(sim.contact).toBe(contact);
    expect(sim.frame).toBe(contact.frame);
  });

  it.each([
    [0.016, 0.016, 0.016],
    [0.008, 0.032, 0.012],
  ])('la integral de velocidad recupera el desplazamiento con intervalos %j', (...intervals) => {
    const { sim, frames } = rig();
    sim.advance(0.02);
    sim.equipment = { ...sim.equipment, pw: { ...sim.equipment.pw, enabled: true } };
    const pwStep = vi.spyOn(sim.pwChain, 'step');
    const origin = [...sim.frame.face];
    const integrated = [0, 0, 0];
    for (const [index, dt] of intervals.entries()) {
      const before = [...sim.frame.face];
      const t = sim.sample.t;
      pwStep.mockClear();
      sim.setPose({ ...sim.pose, z: sim.pose.z + (index % 2 ? -1 : 1) * 10 * dt });
      sim.advance(dt);
      sim.render();
      const elapsed = sim.sample.t - t;
      for (let axis = 0; axis < 3; axis++) {
        // Oráculo cinemático: desplazamiento medido / tiempo integrado, sin
        // reutilizar probeVelocity ni la estimación temporal del simulador.
        expect(sim.probeVelocity[axis]).toBeCloseTo((sim.frame.face[axis] - before[axis]) / elapsed, 9);
        integrated[axis] += sim.probeVelocity[axis] * elapsed;
      }
      // La cadencia Color puede omitir este cuadro. Forzar únicamente su
      // adquisición permite observar la entrada al renderer, no alterar IQ.
      sim.equipment = { ...sim.equipment, color: { ...sim.equipment.color, enabled: true } };
      sim.render({ forceColor: true });
      expect(frames.at(-1)!.probeVelocity).toEqual(sim.probeVelocity);
      expect(pwStep).toHaveBeenCalled();
      for (const call of pwStep.mock.calls) expect(call[1]).toEqual(sim.probeVelocity);
    }
    for (let axis = 0; axis < 3; axis++) expect(integrated[axis]).toBeCloseTo(sim.frame.face[axis] - origin[axis], 10);
    sim.advance(0.02);
    expect(sim.probeVelocity).toEqual([0, 0, 0]);
  });

  it('mover la sonda congelada conserva la imagen adquirida y el tiempo', () => {
    const { sim, frames } = rig();
    sim.render();
    const acquired = frames[0];
    const sample = sim.sample;
    sim.frozen = true;
    sim.setPose({ ...sim.pose, phi: sim.pose.phi - 0.2, lift: 12 });
    sim.advance(1 / 60);
    sim.render();
    expect(frames).toEqual([acquired]);
    expect(acquired.pose).not.toEqual(sim.pose);
    expect(sim.sample).toBe(sample);
    expect(sim.physiology.clock.t).toBe(0);
  });
});
