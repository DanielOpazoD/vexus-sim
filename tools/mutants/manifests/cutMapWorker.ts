import type { MutantManifest } from '../manifest';

/** Worker del corte: instala los mismos bloques s0028 que la CPU (P3). */
export const cutMapWorker: MutantManifest = {
  module: 'src/ui/cutMapWorker.ts',
  mutants: [
    {
      name: 'Worker-sin-bloque-P3',
      origin: 'P3 r2 (decisión 321)',
      breaks: 'El Worker del corte no instala el bloque P3: su corte deja de coincidir con la CPU.',
      from: '        setS0028Solids(msg.wall);\n',
      to: '',
      tests: ['src/validation/s0028SolidsClassify.test.ts'],
    },
  ],
};
