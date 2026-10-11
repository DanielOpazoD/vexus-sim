import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { setReferenceBody } from '../anatomy/referenceBody';
import { Simulator } from '../app/simulator';
import { NORMAL_ADULT } from '../cases';
import { clonePatient } from '../physiology/patientState';
import { probeContact } from '../probe/contact';
import type { ProbePose } from '../probe/probe';
import type { FrameInputs, UltrasoundRenderer } from '../ultrasound/renderer';

const bytes = readFileSync('src/anatomy/reference-body.bin');
const profile = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

function rig() {
  const frames: FrameInputs[] = [];
  const renderer = {
    setScene() {},
    render(inputs: FrameInputs) {
      frames.push(inputs);
    },
  };
  const sim = new Simulator(clonePatient(NORMAL_ADULT), {} as HTMLCanvasElement, undefined, renderer as unknown as UltrasoundRenderer);
  return { sim, frames };
}

describe('pose, contacto y adquisición pertenecen al mismo cuadro', () => {
  for (const reference of [false, true]) {
    it(`un movimiento entre pasos físicos actualiza el haz sin avanzar el reloj (${reference})`, () => {
      setReferenceBody(reference ? profile : undefined);
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
