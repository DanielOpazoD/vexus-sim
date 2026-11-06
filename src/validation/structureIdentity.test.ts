import { expect, it } from 'vitest';
import { Interface } from '../anatomy/interfaces';
import { structureIdentity } from '../anatomy/structureIdentity';
import { Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT } from '../cases';
import { AnatomyScene } from './support/legacyPerson/scene';

it('identifica tejidos renales por centros del modelo y distingue líquido biliar de otros líquidos', () => {
  const scene = new AnatomyScene(NORMAL_ADULT);
  for (const tissue of [Tissue.RenalCortex, Tissue.RenalMedulla, Tissue.RenalSinus, Tissue.RenalCapsule, Tissue.RenalPelvis]) {
    expect(structureIdentity(scene.kidneyRight.center, tissue, Interface.None, scene)).toBe(2);
    expect(structureIdentity(scene.kidneyLeft.center, tissue, Interface.None, scene)).toBe(3);
  }
  expect(structureIdentity([0, 0, 0], Tissue.Fluid, Interface.None, scene)).toBe(0);
  expect(structureIdentity([0, 0, 0], Tissue.Fluid, Interface.GallbladderLumen, scene)).toBe(4);
});
