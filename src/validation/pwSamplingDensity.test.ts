import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { AnatomyQuery } from '../anatomy/query';
import { NORMAL_ADULT } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { Tissue } from '../anatomy/tissues';
import { SampleVolumeIQ, particleAmplitudeScale, type GateGeometry } from '../doppler/sampleVolume';

function phantom(radius: number, sigma = 1) {
  const scene = new AnatomyScene(NORMAL_ADULT),
    anatomy = new AnatomyQuery(scene);
  const base = new PhysiologyEngine(NORMAL_ADULT, scene.vesselAreas()).sample;
  // Same vessel identity and patient in every test; only numerical geometry changes.
  for (const n of scene.vesselById.get('hvRight')!.tube.nodes) n.r = radius;
  const template = anatomy.classifyWorld([0, 0, 0], base);
  anatomy.classifyWorld = (p) => ({
    ...template,
    tissue: Tissue.Blood,
    vessel: 'hvRight',
    material: p,
    bloodVelocity: [0, 0, 10],
    flowBasis: [0, 0, 1],
    tissueVelocity: [0, 0, 0],
  });
  const iq = new SampleVolumeIQ(anatomy, 19);
  const gate: GateGeometry = {
    center: [0, 0, 0],
    beamDir: [0, 0, -1],
    lateral: [1, 0, 0],
    elevation: [0, 1, 0],
    lengthMm: 4,
    lateralSigmaMm: sigma,
    elevationSigmaMm: 1,
    pulseSigmaMm: 0.3,
    transmission: 1,
  };
  iq.setGate(gate, base);
  return { iq, scene, gate, base };
}

describe('refinamiento numérico PW por geometría, no por diagnóstico', () => {
  it('conserva 320 partículas en un lumen grande respecto al haz', () => {
    expect(phantom(5).iq.particleCount).toBe(320);
  });
  it('refina a 1280 un lumen pequeño con la misma identidad suprahepática', () => {
    expect(phantom(0.7).iq.particleCount).toBe(1280);
  });
  it('compara el calibre con el haz: una puerta más estrecha puede necesitar menos refinamiento', () => {
    expect(phantom(0.7, 0.2).iq.particleCount).toBe(320);
  });
  it('mantiene la población entre pulsos y la reevalúa al recolocar la puerta', () => {
    const { iq, scene, gate, base } = phantom(0.7);
    for (const n of scene.vesselById.get('hvRight')!.tube.nodes) n.r = 5;
    iq.setGate(gate, base);
    expect(iq.particleCount).toBe(1280);
    iq.setGate({ ...gate, center: [10, 0, 0] }, base);
    expect(iq.particleCount).toBe(320);
  });
});

it('conserva la potencia incoherente esperada al refinar, sin multiplicar el ruido del receptor', () => {
  for (const n of [320, 640, 960, 1280, 2560]) expect(n * particleAmplitudeScale(n) ** 2).toBeCloseTo(320, 10);
  expect(particleAmplitudeScale(320)).toBe(1);
  expect(particleAmplitudeScale(1280)).toBe(0.5);
  expect(() => particleAmplitudeScale(0)).toThrow(RangeError);
});
