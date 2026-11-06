import type { MutantManifest } from '../manifest';

/** Política de clasificación de s0028 en la escena CPU (P3): conflicto, riñón U, quiste y retirada de lo analítico. */
export const scene: MutantManifest = {
  module: 'src/anatomy/scene.ts',
  mutants: [
    {
      name: 'conflicto-elige-organo',
      origin: 'P3 r2 (decisión 321)',
      breaks: 'Un conflicto de dueños sale como hígado en vez de tejido sin segmentar sin material elegido.',
      from: '        return { final: true, cls: { ...NONE, tissue: Tissue.UnsegmentedSoftTissue, boundaryDistance: 0, solids } };',
      to: '        return { final: true, cls: { ...NONE, tissue: Tissue.Liver, boundaryDistance: 0, solids } };',
      tests: ['src/validation/s0028SolidsClassify.test.ts'],
    },
    {
      name: 'U-renal-como-corteza',
      origin: 'P3 r2 (decisión 321)',
      breaks: 'El interior renal U se clasifica como corteza: una arquitectura renal que la fuente no demuestra.',
      from: "        tissue: owner === 'kidney_cyst_left' ? Tissue.Fluid : Tissue.UnsegmentedSoftTissue,",
      to: "        tissue: owner === 'kidney_cyst_left' ? Tissue.Fluid : Tissue.RenalCortex,",
      tests: ['src/validation/s0028SolidsClassify.test.ts'],
    },
    {
      name: 'rinon-analitico-de-otra-persona',
      origin: 'P3 r2 (decisión 321); reanclado tras la cara renal de r3',
      breaks: 's0028 recupera los riñones analíticos de la otra persona (arquitectura, estiramiento W 0,8 y grasa perirrenal).',
      from: "    if (renal)\n      return renalFace(\n        {\n          ...NONE,\n          tissue: owner === 'kidney_cyst_left' ? Tissue.Fluid : Tissue.UnsegmentedSoftTissue,\n          boundaryDistance: -solids!.owners[0].d,\n        },\n        solids!,\n      );\n    const kidney = isS0028 ? NO_KIDNEY : this.classifyKidneys(m);",
      to: '    const kidney = this.classifyKidneys(m);',
      tests: ['src/validation/s0028SolidsClassify.test.ts'],
    },
    {
      name: 'vasos-procedurales-en-rinon-U',
      origin: 'P3 r2 (decisión 321)',
      breaks: 'Los vasos procedurales de la otra persona entran en el riñón U de s0028.',
      from: '    const tube = renal ? null : this.classifyTubes(m, caliber);',
      to: '    const tube = this.classifyTubes(m, caliber);',
      tests: ['src/validation/s0028SolidsClassify.test.ts'],
    },
    {
      name: 'U-pared-como-musculo',
      origin: 'P3 r2 (decisión 321); reanclado tras la cara renal de r3',
      breaks: 'La pared U, sin cara interna demostrada, se clasifica como músculo.',
      from: "      return renalFace({ ...NONE, tissue: Tissue.UnsegmentedSoftTissue, boundaryDistance: 0, wall: 'U' }, solids!);",
      to: "      return renalFace({ ...NONE, tissue: Tissue.Muscle, boundaryDistance: 0, wall: 'U' }, solids!);",
      tests: ['src/validation/s0028SolidsClassify.test.ts', 'src/validation/s0028WallRuntime.test.ts'],
    },
    {
      name: 'ligamento-venoso-analitico',
      origin: 'P3 r2 (decisión 321)',
      breaks: 's0028 recupera dentro del hígado el ligamento venoso analítico de la otra persona.',
      from: "    const dLv = this.identity.person === 's0028' ? 1e3 : this.ligamentumVenosumSdf(m);",
      to: '    const dLv = this.ligamentumVenosumSdf(m);',
      tests: ['src/validation/s0028SolidsClassify.test.ts'],
    },
    {
      name: 'quiste-como-dueno-cualquiera',
      origin: 'revisión adversarial de #331, r2c (decisión 321)',
      breaks: 'El quiste renal izquierdo deja de ser líquido E y se trata como cualquier dueño renal (U).',
      from: "        tissue: owner === 'kidney_cyst_left' ? Tissue.Fluid : Tissue.UnsegmentedSoftTissue,",
      to: '        tissue: Tissue.UnsegmentedSoftTissue,',
      tests: ['src/validation/s0028SolidsClassify.test.ts'],
    },
  ],
};
