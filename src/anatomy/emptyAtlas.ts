import type { AnatomyPerson } from './person';

/** Consultas sin atlas para las primitivas procedurales; ningún estado instalable. */
export const EMPTY_ATLAS = Object.freeze<AnatomyPerson['atlas']>({
  abdominalAtlasValue: () => ({ d: 16, label: 0 }),
  abdominalAtlasSdf: () => 16,
  abdominalAtlasGradient: () => [0, 0, 0],
  registeredDomeHeight: () => undefined,
  registeredDomeValue: () => [0, 0],
  registeredDomeSample: () => [0, 0, 0, 0],
  hepaticDomeValue: () => [0, 0],
  thoracicValue: () => ({ d: 16, label: 0 }),
  thoracicSdf: () => 16,
  thoracicMaterial: () => undefined,
  thoracicGradient: () => [0, 0, 0],
  thoracicFrame: () => ({ axis: [0, 0, 1], curvature: 0 }),
});
