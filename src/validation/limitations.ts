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
  'ivc-single-compartment',
  'no-thoracic-waterfall',
  'gate-lost-with-quiet-breathing',
  'thin-vessel-sample-volume-lag',
  'severe-aliasing-not-detected',
  'weak-signal-not-flagged',
  'respiratory-clutter-masks-slow-flow',
  'gate-placement-ignores-shadows',
  'speckle-statistics-uncalibrated',
  'left-handed-anatomy-frame',
  'renal-pause-resolution-prf',
  'no-spleen-no-left-ribs',
  'peep-no-hemodynamic-effect',
  'fixed-arterial-resistive-index',
  'side-plane-skips-tubes',
  'interface-echo-scope',
  'interface-echo-coherent-only',
  'interface-curvature-tubes-only',
  'speckle-line-aliasing',
  'compound-off-in-color',
  'pleura-series-same-line',
  'no-lung-comet-tails',
  'curtain-edge-central-ray',
  'curtain-doppler-through-lung',
  'curtain-footprint-seam',
  'compound-off-under-curtain',
  'wall-generic-layers',
  'speckle-anchor-orientation',
]);
