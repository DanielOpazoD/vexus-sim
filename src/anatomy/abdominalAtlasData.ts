/** Generated registered atlas descriptors; full provenance in docs/anatomy. */
export const ABDOMINAL_ATLAS = {
  textureDimensions: [338, 217, 280],
  rawBytes: 82147520,
  gzipBytes: 5035715,
  sha256Gzip: 'ef56a03cd8446d67aa9c88039d6e7f8d71d1d6563f3262dd4d0e0e62703f8b72',
  sha256Raw: '1a963ba64c23ffec44da2cdf1cf1ded62e35aca8602ba5d9a5c14070e0796958',
} as const;
export const ABDOMINAL_FIELDS = [
  { name: 'pancreas', originMm: [-57.0, -34.5, -169.5], dimensions: [94, 48, 63], offset: [244, 97, 119], pitchMm: 1.5 },
  { name: 'digestiveTract', originMm: [-136.5, -118.5, -417.0], dimensions: [177, 137, 280], offset: [0, 0, 0], pitchMm: 1.5 },
  { name: 'bladder', originMm: [-43.5, -73.5, -384.0], dimensions: [58, 62, 40], offset: [178, 97, 208], pitchMm: 1.5 },
  { name: 'spleen', originMm: [55.0, -93.0, -130.5], dimensions: [65, 65, 88], offset: [178, 97, 119], pitchMm: 1.5 },
  { name: 'liver', originMm: [-124.5, -87.0, -147.0], dimensions: [154, 120, 118], offset: [178, 97, 0], pitchMm: 1.5 },
  { name: 'kidneyRight', originMm: [-97.5, -66.0, -207.0], dimensions: [52, 46, 83], offset: [178, 163, 119], pitchMm: 1.5 },
  { name: 'kidneyLeft', originMm: [24.0, -70.5, -190.5], dimensions: [52, 41, 85], offset: [231, 163, 119], pitchMm: 1.5 },
  { name: 'gallbladder', originMm: [-72.0, 0.0, -123.0], dimensions: [38, 46, 41], offset: [237, 97, 208], pitchMm: 1.5 },
  { name: 'lumbarSacralBone', originMm: [-69.0, -138.0, -391.5], dimensions: [93, 96, 245], offset: [178, 0, 0], pitchMm: 1.5 },
  { name: 'psoas', originMm: [-123.0, -78.0, -439.5], dimensions: [166, 59, 257], offset: [0, 138, 0], pitchMm: 1.5 },
  { name: 'lumbarDiscs', originMm: [-34.5, -76.5, -279.0], dimensions: [47, 55, 156], offset: [272, 0, 0], pitchMm: 1.5 },
] as const;
export const ABDOMINAL_BODY = { bytes: 3640, sha256: '47efbad03d2e4d226c7b541372db81d66f11e281fbf9419546c40496bbde0323' } as const;

/** Estimated normal contact, not a segmented diaphragm. RG = height mm / support. */
export const HEPATIC_DOME = { originMm: [-124.5, -87], dimensions: [154, 120], offset: [178, 97, 258], pitchMm: 1.5 } as const;
