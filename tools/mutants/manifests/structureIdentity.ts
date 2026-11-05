import type { MutantManifest } from '../manifest';

/** Rótulos del corte para los dueños s0028 (P3). */
export const structureIdentity: MutantManifest = {
  module: 'src/anatomy/structureIdentity.ts',
  mutants: [
    {
      name: 'conflicto-sin-rotulo-17',
      origin: 'revisión adversarial de #331, r2c (decisión 321)',
      breaks: 'Un conflicto deja de rotularse 17 («Conflicto sin resolver · dos dueños») en el corte.',
      from: "  if (solids?.state === 'conflict') return 17;",
      to: "  if (solids?.state === 'conflict') return 0;",
      tests: ['src/validation/s0028SolidsClassify.test.ts'],
    },
  ],
};
