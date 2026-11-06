import type { MutantManifest } from '../manifest';

export const s0028Classifier: MutantManifest = {
  module: 'src/anatomy/people/s0028/classifier.ts',
  mutants: [
    {
      name: 'conflicto-elige-organo',
      origin: 'P3 r2 (decisión 321)',
      breaks: 'Un conflicto de dueños sale como hígado en vez de tejido sin segmentar sin material elegido.',
      from: 'return { final: true, cls: { ...NONE, tissue: Tissue.UnsegmentedSoftTissue, boundaryDistance: 0, solids } };',
      to: 'return { final: true, cls: { ...NONE, tissue: Tissue.Liver, boundaryDistance: 0, solids } };',
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
      from: 'export function classifyInside(',
      to: "import { classifyKidneys } from '../default/classifier';\nexport function classifyInside(...args: Parameters<typeof originalInside>): Classification {\n  return classifyKidneys(args[0], args[1]).cls ?? originalInside(...args);\n}\nfunction originalInside(",
      tests: ['src/validation/s0028SolidsClassify.test.ts'],
    },
    {
      name: 'vasos-procedurales-en-rinon-U',
      origin: 'P3 r2 (decisión 321)',
      breaks: 'Los vasos procedurales de la otra persona entran en el riñón U de s0028.',
      from: 'const tube = renal ? null : scene.classifyTubes(m, caliber);',
      to: 'const tube = scene.classifyTubes(m, caliber);',
      tests: ['src/validation/s0028SolidsClassify.test.ts'],
    },
    {
      name: 'U-pared-como-musculo',
      origin: 'P3 r2 (decisión 321); reanclado tras la cara renal de r3',
      breaks: 'La pared U, sin cara interna demostrada, se clasifica como músculo.',
      from: "return renalFace({ ...NONE, tissue: Tissue.UnsegmentedSoftTissue, boundaryDistance: 0, wall: 'U' }, solids!);",
      to: "return renalFace({ ...NONE, tissue: Tissue.Muscle, boundaryDistance: 0, wall: 'U' }, solids!);",
      tests: ['src/validation/s0028SolidsClassify.test.ts', 'src/validation/s0028WallRuntime.test.ts'],
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
