/**
 * Limitaciones conocidas del modelo, con identificador. Cada id debe aparecer
 * entre acentos graves en docs/LIMITATIONS.md (docs.test.ts lo exige), de modo
 * que «lo sabíamos» sea comprobable por máquina. Cuando una limitación se
 * resuelve, se borra de aquí y del documento en el mismo cambio.
 */
export const KNOWN_LIMITATIONS: ReadonlySet<string> = new Set([
  'color-emulated-estimator',
  'no-sidelobes',
  'no-harmonics',
  'no-cardiac-tissue-motion',
  'prescribed-ra-contour',
  'uniform-vessel-velocity',
  'procedural-liver-shape',
  'no-left-interlobar-vessels',
  'axis-aligned-gallbladder',
  'ivc-single-compartment',
  'gate-lost-with-quiet-breathing',
  'speckle-statistics-uncalibrated',
  'left-handed-anatomy-frame',
]);
