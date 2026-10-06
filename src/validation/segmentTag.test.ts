import { describe, expect, it } from 'vitest';
import { TISSUE_COUNT } from '../anatomy/tissues';
import { segmentTag, segmentGasKind, segmentTissue } from '../ultrasound/segmentTag';

describe('etiqueta de tejido y gas de A1', () => {
  it('preserva cada tejido y los cuatro tipos de gas exactamente en float32', () => {
    for (let tissue = 0; tissue < TISSUE_COUNT; tissue++)
      for (let gas = 0; gas < 4; gas++) {
        const packed = new Float32Array([segmentTag(tissue, gas)])[0];
        expect(segmentGasKind(packed)).toBe(gas);
        expect(segmentTissue(packed)).toBe(tissue);
        expect(packed).toBe(tissue * 4 + gas);
      }
  });
});
