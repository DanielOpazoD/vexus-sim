import { expect, it } from 'vitest';
import { matchedBands, type MatchedSample } from '../../tools/fidelity/hepatorenalMeasurements';
const patch = (tissue: MatchedSample['tissue'], depthMm: number, gray: number, n = 40): MatchedSample[] =>
  Array.from({ length: n }, () => ({ tissue, depthMm, gray }));
it('compara solo profundidades coincidentes, sin sesgo por tamaño del hígado', () => {
  const r = matchedBands([
    ...patch('liver', 51, 100, 400),
    ...patch('cortex', 54, 100),
    ...patch('liver', 101, 200),
    ...patch('cortex', 104, 200),
    ...patch('liver', 151, 250, 1000),
  ]);
  expect(r.ratio).toBe(1);
  expect(r.bands).toHaveLength(2);
  expect(r.matchedPixels).toBe(80);
});
it('no inventa índice sin corteza suficiente o con denominador nulo', () => {
  expect(matchedBands(patch('liver', 50, 100)).ratio).toBeNull();
  expect(matchedBands([...patch('liver', 50, 100), ...patch('cortex', 50, 0)]).ratio).toBeNull();
  expect(matchedBands([...patch('liver', 50, 100), ...patch('cortex', 50, 80, 29)]).ratio).toBeNull();
});
it('informa saturación en vez de esconder los píxeles brillantes', () => {
  const r = matchedBands([...patch('liver', 50, 255), ...patch('cortex', 50, 100)]);
  expect(r.bands[0].liver.saturated).toBe(1);
  expect(r.ratio).toBe(2.55);
});
