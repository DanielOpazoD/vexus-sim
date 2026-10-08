import { expect, it } from 'vitest';
import { firstCrossing } from '../probe/contact';

// Independent analytic roots: terminal fractions of the search interval must
// still contain a wall. They must not become a false "no contact" result.
it('finds wall roots in the last fractional interval, including intervals shorter than the coarse step', () => {
  for (const start of [-14.000963687896729, 0, 17.125]) {
    for (const span of [0.2, 1.1, 2, 2.25, 25.2, 84.7]) {
      const end = start + span;
      for (const fraction of [0.25, 0.9, 1]) {
        const expected = end - Math.min(span, 0.2) * (1 - fraction);
        const wallLevel = 28;
        const depthAt = (r: number) => wallLevel + 0.7 * (r - expected);
        const actual = firstCrossing(depthAt, wallLevel, start, end);
        expect(actual, `start${start}, span${span}, fraction${fraction}`).not.toBeNull();
        expect(Math.abs(actual! - expected)).toBeLessThan(0.000004);
      }
    }
  }
});

it('preserves absent walls, contact at the start and the first of multiple crossings', () => {
  expect(firstCrossing(() => 27, 28, -14, 11.2)).toBeNull();
  expect(firstCrossing((r) => 28 + r, 28, 0, 25.2)).toBe(0);
  expect(firstCrossing((r) => r, 28, 0, 27.9)).toBeNull();
  const twoEntries = (r: number) => 28 + (r - 1.2) * (r - 4) * (r - 6);
  expect(firstCrossing(twoEntries, 28, 0, 9.1)).toBeCloseTo(1.2, 5);
});
