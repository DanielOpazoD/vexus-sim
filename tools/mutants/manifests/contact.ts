import type { MutantManifest } from '../manifest';

/** Contacto de la sonda sobre la pared s0028 (P2). */
export const contact: MutantManifest = {
  module: 'src/probe/contact.ts',
  mutants: [
    {
      name: 'U-sin-acoplar',
      origin: 'P2 r2b-U (decisión 320); reanclado al perfil «sólo piel» final de #330',
      breaks: 'Sin nodo conocido a ≤12 mm la sonda deja de acoplar por la piel: sin traslado, sin gel y sin paralelismo.',
      from: '      nodes.push([skin, skin, SKIN_ONLY_DEPTH_MM]);\n      hover.push(1 - smoothstep(CONTACT.gelMm, CONTACT.gelMm + CONTACT.gelRampMm, Math.max(g.rs, g.gapElevation)));\n      parallel.push(1);',
      to: '      nodes.push([0, 0, 0]);\n      hover.push(0);\n      parallel.push(0);',
      tests: ['src/validation/s0028UContact.test.ts'],
    },
  ],
};
