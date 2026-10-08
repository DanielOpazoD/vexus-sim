import { describe, expect, it } from 'vitest';
import { validateAcquisition } from '../../tools/fidelity/acquisitionSnapshot';
import { probeFrame, CONVEX_C35 } from '../probe/probe';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';
import { DEFAULT_COLOR } from '../ultrasound/renderer';

function acquisition() {
  const pose = { phi: 2, z: -80, yaw: 0.2, rock: 0, tilt: 0, lift: 0 };
  const frame = probeFrame(pose, new AnatomyScene(NORMAL_ADULT).torso, CONVEX_C35);
  return {
    schemaVersion: 2,
    pose,
    livePose: { ...pose },
    anatomyMode: 'atlas',
    caseId: 'normal-adult',
    color: { ...DEFAULT_COLOR, enabled: false },
    presentedFrame: 31,
    acquiredTimeSeconds: 2,
    presentedSampleTimeSeconds: 2,
    errors: [] as string[],
    frame,
    currentFrame: structuredClone(frame),
  };
}
const expected = { anatomy: 'atlas', caseId: 'normal-adult', time: 2 };
describe('integridad de la evidencia de adquisición', () => {
  it('acepta geometría presentada y tiempo coincidentes sin exigir igualdad de contador RAF', () => {
    expect(() => validateAcquisition(acquisition(), expected)).not.toThrow();
  });
  it('rechaza un cuadro de cine anterior atribuido a una sonda desplazada', () => {
    const shot = acquisition();
    shot.currentFrame.face[0] += 2;
    expect(() => validateAcquisition(shot, expected)).toThrow('geometry');
  });
  it('rechaza controles movidos antes de actualizar el marco y metadatos históricos ambiguos', () => {
    const shot = acquisition();
    shot.livePose.z += 1;
    expect(shot.currentFrame).toEqual(shot.frame);
    expect(() => validateAcquisition(shot, expected)).toThrow('pose differs');
    expect(() => validateAcquisition({ ...acquisition(), schemaVersion: 1 }, expected)).toThrow('provenance');
  });
  it('rechaza anatomía de otro instante y tiempos estáticos incorrectos', () => {
    const shot = acquisition();
    shot.presentedSampleTimeSeconds = 1.96;
    expect(() => validateAcquisition(shot, expected)).toThrow('times differ');
    shot.presentedSampleTimeSeconds = 2;
    expect(() => validateAcquisition(shot, { ...expected, time: 3 })).toThrow('requested time');
    shot.acquiredTimeSeconds = NaN;
    expect(() => validateAcquisition(shot, expected)).toThrow('times differ');
  });
  it('rechaza legacy o un paciente distinto en una comparación declarada atlas normal', () => {
    expect(() => validateAcquisition({ ...acquisition(), anatomyMode: 'legacy' }, expected)).toThrow('domain');
    expect(() => validateAcquisition({ ...acquisition(), caseId: 'severe-congestion' }, expected)).toThrow('domain');
  });
  it('rechaza color, errores de render y geometría no finita', () => {
    const shot = acquisition();
    expect(() => validateAcquisition({ ...shot, color: { ...shot.color, enabled: true } }, expected)).toThrow('color');
    expect(() => validateAcquisition({ ...shot, errors: ['context lost'] }, expected)).toThrow('errors');
    shot.frame.axial[0] = NaN;
    expect(() => validateAcquisition(shot, expected)).toThrow('geometry');
  });
});
