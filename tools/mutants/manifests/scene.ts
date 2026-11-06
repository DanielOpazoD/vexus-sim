import type { MutantManifest } from '../manifest';

/** Política de clasificación de s0028 en la escena CPU (P3): conflicto, riñón U, quiste y retirada de lo analítico. */
export const scene: MutantManifest = {
  module: 'src/anatomy/scene.ts',
  mutants: [
    {
      name: 'ligamento-venoso-analitico',
      origin: 'P3 r2 (decisión 321)',
      breaks: 's0028 recupera dentro del hígado el ligamento venoso analítico de la otra persona.',
      from: "    const dLv = this.identity.person === 's0028' ? 1e3 : this.ligamentumVenosumSdf(m);",
      to: '    const dLv = this.ligamentumVenosumSdf(m);',
      tests: ['src/validation/s0028SolidsClassify.test.ts'],
    },
  ],
};
