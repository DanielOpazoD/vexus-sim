import { ABDOMINAL_FIELDS } from './abdominalAtlasData';

/** Los mismos descriptores del lector TS; tres texels RGBA32F por campo. */
export const ABDOMINAL_FIELD_TEXELS = 3 * ABDOMINAL_FIELDS.length;
const descriptors = Float32Array.from(ABDOMINAL_FIELDS.flatMap((f) => [...f.originMm, f.pitchMm, ...f.dimensions, 0, ...f.offset, 0]));

export function writeAbdominalFieldDescriptors(sceneData: Float32Array, baseTexel: number): void {
  sceneData.set(descriptors, baseTexel * 4);
}
