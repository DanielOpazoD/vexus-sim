/** A1 .w: entero float32 exacto; mantiene los cuatro tipos de gas junto al tejido. */
export const SEGMENT_TAG_STRIDE = 4;
export const segmentTag = (tissue: number, gasKind: number): number => tissue * SEGMENT_TAG_STRIDE + gasKind;
export const segmentGasKind = (tag: number): number => tag % SEGMENT_TAG_STRIDE;
export const segmentTissue = (tag: number): number => Math.floor(tag / SEGMENT_TAG_STRIDE);
