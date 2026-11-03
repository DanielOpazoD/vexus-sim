import type { SourceVolume } from './sourceVolume';
export interface PersonField extends SourceVolume {
  readonly name: string;
  readonly asset: 'abdominal' | 'thoracic';
}
export interface PersonDescriptors {
  readonly fields: readonly PersonField[];
  readonly depth: SourceVolume;
}
function freeze<T extends object>(value: T): T {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  return Object.freeze(value);
}
export const S0028_BUNDLE = freeze({
  person: 's0028',
  frameId: 's0028-audit-las-v1',
  revision: 's0028-p0e-P0c-direct-v1',
  ctSha256: 'd11b8acbf137277d157930f7d0cb3a5f259364a5e5af18dafcd3cac0ecf4168c',
  fields: [
    {
      name: 'liver',
      asset: 'abdominal',
      originMm: [-133.98527431275116, -81.71478450019774, -142.48879268882285],
      dimensions: [173, 117, 112],
      offset: [0, 105, 477],
      pitchMm: 1.5,
    },
    {
      name: 'spleen',
      asset: 'abdominal',
      originMm: [62.51472568724884, -71.21478450019774, -104.98879268882285],
      dimensions: [55, 61, 58],
      offset: [82, 118, 354],
      pitchMm: 1.5,
    },
    {
      name: 'pancreas',
      asset: 'abdominal',
      originMm: [-39.48527431275116, -15.714784500197737, -157.48879268882285],
      dimensions: [99, 47, 69],
      offset: [54, 200, 249],
      pitchMm: 1.5,
    },
    {
      name: 'kidneyRight',
      asset: 'abdominal',
      originMm: [-87.48527431275116, -68.21478450019774, -181.48879268882285],
      dimensions: [53, 53, 68],
      offset: [54, 200, 319],
      pitchMm: 1.5,
    },
    {
      name: 'kidneyLeft',
      asset: 'abdominal',
      originMm: [29.51472568724884, -62.21478450019774, -173.98879268882285],
      dimensions: [53, 46, 77],
      offset: [0, 193, 249],
      pitchMm: 1.5,
    },
    {
      name: 'gallbladder',
      asset: 'abdominal',
      originMm: [-87.48527431275116, 15.785215499802263, -101.98879268882285],
      dimensions: [32, 30, 27],
      offset: [49, 155, 249],
      pitchMm: 1.5,
    },
    {
      name: 'bladder',
      asset: 'abdominal',
      originMm: [-28.98527431275116, -32.21478450019774, -374.98879268882285],
      dimensions: [55, 53, 34],
      offset: [108, 200, 319],
      pitchMm: 1.5,
    },
    {
      name: 'digestiveTract',
      asset: 'abdominal',
      originMm: [-115.98527431275116, -105.71478450019774, -371.98879268882285],
      dimensions: [168, 136, 248],
      offset: [0, 118, 0],
      pitchMm: 1.5,
    },
    {
      name: 'posteriorMuscle',
      asset: 'abdominal',
      originMm: [-105.48527431275116, -114.71478450019774, -392.98879268882285],
      dimensions: [157, 117, 398],
      offset: [0, 0, 0],
      pitchMm: 1.5,
    },
    {
      name: 'lumbarSacralBone',
      asset: 'abdominal',
      originMm: [-132.48527431275116, -98.21478450019774, -404.98879268882285],
      dimensions: [189, 104, 220],
      offset: [0, 0, 399],
      pitchMm: 1.5,
    },
    {
      name: 'aorta',
      asset: 'abdominal',
      originMm: [-27.48527431275116, -56.21478450019774, -205.48879268882285],
      dimensions: [48, 74, 227],
      offset: [0, 118, 249],
      pitchMm: 1.5,
    },
    {
      name: 'inferior_vena_cava',
      asset: 'abdominal',
      originMm: [-33.48527431275116, -27.714784500197737, -211.48879268882285],
      dimensions: [32, 36, 163],
      offset: [49, 118, 249],
      pitchMm: 1.5,
    },
    {
      name: 'portal_vein_and_splenic_vein',
      asset: 'abdominal',
      originMm: [-73.98527431275116, -27.714784500197737, -109.48879268882285],
      dimensions: [127, 61, 51],
      offset: [49, 180, 388],
      pitchMm: 1.5,
    },
    {
      name: 'renalCysts',
      asset: 'abdominal',
      originMm: [74.51472568724884, -57.71478450019774, -125.98879268882285],
      dimensions: [16, 17, 17],
      offset: [158, 0, 0],
      pitchMm: 1.5,
    },
    {
      name: 'sacrum',
      asset: 'abdominal',
      originMm: [-43.98527431275116, -125.21478450019774, -362.98879268882285],
      dimensions: [82, 81, 104],
      offset: [82, 118, 249],
      pitchMm: 1.5,
    },
    {
      name: 'thoracicBone',
      asset: 'thoracic',
      originMm: [-139.98527431275116, -107.21478450019774, -137.98879268882285],
      dimensions: [193, 139, 218],
      offset: [0, 0, 0],
      pitchMm: 1.5,
    },
    {
      name: 'cartilage',
      asset: 'thoracic',
      originMm: [-106.98527431275116, 29.285215499802263, -94.48879268882285],
      dimensions: [152, 51, 163],
      offset: [0, 0, 389],
      pitchMm: 1.5,
    },
    {
      name: 'lung',
      asset: 'thoracic',
      originMm: [-133.98527431275116, -95.21478450019774, -77.98879268882285],
      dimensions: [184, 124, 169],
      offset: [0, 0, 219],
      pitchMm: 1.5,
    },
    {
      name: 'heart',
      asset: 'thoracic',
      originMm: [-52.98527431275116, -38.21478450019774, -22.488792688822855],
      dimensions: [96, 79, 89],
      offset: [0, 52, 389],
      pitchMm: 1.5,
    },
  ],
  depth: {
    originMm: [-225.48527431275116, -134.21478450019774, -218.98879268882285],
    dimensions: [147, 93, 96],
    pitchMm: 3.0,
    offset: [0, 104, 589],
  },
  abdominal: {
    textureDimensions: [189, 256, 685],
    rawBytes: 132572160,
    gzipBytes: 8567375,
    sha256Gzip: 'd73486d8ed95547375a623647f12d058e2cdb9f59eff4418de3929fa39f39bcd',
    sha256Raw: 'cb91610c5ad9421d4ceb4f42bd301b7ee7588ae066048e010d665165a4be9a08',
  },
  thoracic: {
    textureDimensions: [193, 139, 552],
    rawBytes: 59234016,
    gzipBytes: 5252011,
    sha256Gzip: '01ac3e1c81fff7eba99a610026999b9b9e37d8261918590dd0b78b53d3eb9c0d',
    sha256Raw: '0aef3f322af70ec5dc3f00221ac4710756abc42f31e055d61c05044ccbc92f0e',
  },
  capacity: {
    rawBytes: 5671296,
    gzipBytes: 6999,
    sha256Gzip: 'a8bd8cb1c243fc0b98f2fddfb3ff3c4933ddc8c3d8e6dad8527a8d4cfeaa9836',
    sha256Raw: '1ac0b2b73598ae6f43327ff3a1a8c8c2cd5c5d2b6c21fc6e3be900a62a4920a8',
  },
  skin: {
    rawBytes: 2813952,
    gzipBytes: 947509,
    sha256Gzip: '12fb2f290b66349b54bc4aaa9e6285c237c3a09aaabfc7792b60dc02955fe69e',
    sha256Raw: '04cb11ada156128218499798e92cdf74c7234cb400574c151b4cf8c3f61b1456',
  },
  manifest: {
    bytes: 34521,
    sha256: 'c5624a1300f4ed7df15ab4857d796f03372583613e05111076bfda6dffe8cabd',
  },
} as const);
export const CURRENT_BUNDLE = Object.freeze({ person: 'current', frameId: 'registered-las-v1', revision: 'current' } as const);
export const LEGACY_BUNDLE = Object.freeze({ person: 'legacy', frameId: 'procedural-las-v1', revision: 'current' } as const);
export type AnatomyBundle = typeof S0028_BUNDLE | typeof CURRENT_BUNDLE | typeof LEGACY_BUNDLE;
export type AnatomyIdentity = Pick<AnatomyBundle, 'person' | 'frameId' | 'revision'>;
export let anatomyBundle: AnatomyBundle = CURRENT_BUNDLE;
let selected = false;
export function installAnatomyBundle(bundle: AnatomyBundle): void {
  if (selected && bundle !== anatomyBundle) throw new Error('Cambiar persona exige recargar');
  anatomyBundle = bundle;
  selected = true;
}
export function selectAnatomy(params: URLSearchParams): AnatomyBundle {
  const abdomen = params.get('abdomen');
  if (abdomen === 's0028') {
    if (params.get('reference') === '1') throw new Error('reference=1 incompatible con s0028');
    return S0028_BUNDLE;
  }
  if (abdomen && !['legacy', 'atlas'].includes(abdomen)) throw new Error('Persona desconocida');
  return abdomen === 'legacy' ? LEGACY_BUNDLE : CURRENT_BUNDLE;
}
