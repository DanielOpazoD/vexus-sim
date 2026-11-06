import type { MutantManifest } from '../manifest';

/** Worker del corte: instala los mismos bloques s0028 que la CPU (P3). */
export const cutMapWorker: MutantManifest = {
  module: 'src/ui/cutMapWorker.ts',
  mutants: [
    {
      name: 'Worker-sin-bloque-P3',
      origin: 'P3 r2 (decisión 321)',
      breaks: 'El Worker del corte no instala el bloque P3: su corte deja de coincidir con la CPU.',
      from: "if (msg.identity.person === 's0028') return (await import('../anatomy/people/s0028/cpu')).installS0028Cpu(msg.buffers);",
      to: "if (msg.identity.person === 's0028') {\n    const {S0028_BUNDLE: bundle} = await import('../anatomy/people/s0028/descriptor');\n    const capacity = msg.buffers.capacity!.slice(0);\n    new Uint8Array(capacity, 4096 + bundle.solids.offsetBytes, bundle.solids.encodedBytes).fill(0);\n    return (await import('../anatomy/people/s0028/cpu')).installS0028Cpu({...msg.buffers, capacity});\n  }",
      tests: ['src/validation/s0028SolidsClassify.test.ts'],
    },
  ],
};
