import { expect, it } from 'vitest';
import { installAnatomyBundle, S0028_BUNDLE } from './support/legacyPerson/anatomyBundle';
import { thoracicMaterial } from './support/legacyPerson/thoracicAtlas';
it('las etiquetas vertebrales del paquete no heredan el cartílago del donante anterior', () => {
  installAnatomyBundle(S0028_BUNDLE);
  expect(thoracicMaterial(27)).toBe('vertebra');
  expect(thoracicMaterial(13)).toBe('bone');
});
