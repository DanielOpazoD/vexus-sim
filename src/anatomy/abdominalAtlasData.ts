/** Generated registered atlas descriptors; full provenance in docs/anatomy. */
export const ABDOMINAL_ATLAS = {
  textureDimensions: [338, 217, 280],
  rawBytes: 82147520,
  gzipBytes: 6055924,
  sha256Gzip: 'b8957a7115923c055f055f7283a2cf51f6813ffa15c0848f0360270d80bcd61b',
  sha256Raw: 'a6c8166310cbc6423467479f73ca78262a67169899f71e6700161c0137433875',
} as const;
export const ABDOMINAL_FIELDS = (
  [
    ['pancreas', [-57.0, -34.5, -169.5], [94, 48, 63], [244, 97, 119], 1.5],
    ['digestiveTract', [-136.5, -118.5, -417.0], [177, 137, 280], [0, 0, 0], 1.5],
    ['bladder', [-43.5, -73.5, -384.0], [58, 62, 40], [178, 97, 208], 1.5],
    ['spleen', [55.0, -93.0, -130.5], [65, 65, 88], [178, 97, 119], 1.5],
    ['liver', [-124.5, -87.0, -147.0], [154, 120, 118], [178, 97, 0], 1.5],
    ['kidneyRight', [-105.0, -93.0, -196.5], [55, 60, 77], [283, 145, 119], 1.5],
    ['kidneyLeft', [24.0, -70.5, -190.5], [52, 41, 85], [231, 163, 119], 1.5],
    ['gallbladder', [-72.0, 0.0, -123.0], [38, 46, 41], [237, 97, 208], 1.5],
    ['lumbarSacralBone', [-69.0, -138.0, -391.5], [93, 96, 245], [178, 0, 0], 1.5],
    ['psoas', [-123.0, -78.0, -439.5], [166, 59, 257], [0, 138, 0], 1.5],
    ['lumbarDiscs', [-34.5, -76.5, -279.0], [47, 55, 156], [272, 0, 0], 1.5],
  ] as const
).map(([name, originMm, dimensions, offset, pitchMm]) => ({ name, originMm, dimensions, offset, pitchMm }));
export const ABDOMINAL_BODY = { bytes: 3640, sha256: '47efbad03d2e4d226c7b541372db81d66f11e281fbf9419546c40496bbde0323' } as const;

/** Estimated normal contact, not a segmented diaphragm. RG = height mm / support. */
export const HEPATIC_DOME = { originMm: [-124.5, -87], dimensions: [154, 120], offset: [178, 97, 258], pitchMm: 1.5 } as const;

/** Experimental upper-source graph; missing projection extended, hiatos/crura unvalidated. XY transposed in texture. */
export const REGISTERED_DOME = { originMm: [-162, -127.5], dimensions: [217, 143], offset: [178, 0, 259], pitchMm: 1.5 } as const;
export const REGISTERED_DOME_GRADIENT = { offset: [178, 0, 260] } as const;
