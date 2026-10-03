import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';
import { DIAPHRAGM_JOIN_MM, diaphragmInteriorEdgeZ, diaphragmHeight, type Dome } from '../anatomy/primitives';
import { setReferenceBody } from '../anatomy/referenceBody';
const bytes = readFileSync('src/anatomy/reference-body.bin');
const profile = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
afterEach(() => setReferenceBody());

/** Independent two-dome construction identifies the original switching curve, not a tuned pixel. */
function originalHeights(s: AnatomyScene, x: number, y: number): [number, number] {
  const edge = diaphragmInteriorEdgeZ(x, y, s.diaphragm, s.torso);
  const dome = (d: Dome) => {
    const r2 = ((x - d.x0) / d.rx) ** 2 + ((y - d.y0) / d.ry) ** 2;
    return edge + Math.max(0, d.apex - edge) * Math.sqrt(Math.max(0, 1 - r2 * r2));
  };
  return [dome(s.diaphragm.right), dome(s.diaphragm.left)];
}

describe('continuidad de la unión interhemidiafragmática', () => {
  for (const reference of [false, true])
    it(`la normal converge al refinar el cruce (${reference ? 'referencia' : 'legacy'})`, () => {
      setReferenceBody(reference ? profile : undefined);
      const s = new AnatomyScene(NORMAL_ADULT);
      const height = (x: number, y: number) => diaphragmHeight(x, y, s.diaphragm, s.torso);
      const normal = (x: number, y: number, h: number) => {
        const g = [(height(x + h, y) - height(x - h, y)) / (2 * h), (height(x, y + h) - height(x, y - h)) / (2 * h), -1];
        const length = Math.hypot(...g);
        return g.map((v) => v / length);
      };
      for (const y of [-40, -20, 0, 20, 40]) {
        let lo = 0,
          hi = 30;
        for (let i = 0; i < 50; i++) {
          const x = (lo + hi) / 2;
          const [r, l] = originalHeights(s, x, y);
          if (r > l) lo = x;
          else hi = x;
        }
        const x = (lo + hi) / 2;
        const [r, l] = originalHeights(s, x, y);
        expect(Math.abs(r - l)).toBeLessThan(1e-8);
        const turns = [0.1, 0.025, 0.005].map((step) => {
          const a = normal(x - step, y, step / 10),
            b = normal(x + step, y, step / 10);
          return (
            (Math.acos(
              Math.max(
                -1,
                Math.min(
                  1,
                  a.reduce((v, n, i) => v + n * b[i], 0),
                ),
              ),
            ) *
              180) /
            Math.PI
          );
        });
        expect(turns[2], `x=${x}, y=${y}, turns=${turns.join(',')}`).toBeLessThan(1);
        expect(turns[2]).toBeLessThan(turns[0] * 0.2);
      }
    });
  it.each([false, true])('el cambio queda acotado a la unión y conserva ápices e inserción (referencia %s)', (reference) => {
    setReferenceBody(reference ? profile : undefined);
    const s = new AnatomyScene(NORMAL_ADULT);
    let changed = 0,
      unchanged = 0,
      exterior = 0;
    for (let x = -160; x <= 160; x += 4)
      for (let y = -120; y <= 120; y += 4) {
        const [r, l] = originalHeights(s, x, y),
          before = Math.max(r, l);
        const after = diaphragmHeight(x, y, s.diaphragm, s.torso),
          delta = after - before;
        expect(delta).toBeGreaterThanOrEqual(-1e-12);
        expect(delta).toBeLessThanOrEqual(DIAPHRAGM_JOIN_MM / 4 + 1e-12);
        if (Math.abs(r - l) >= DIAPHRAGM_JOIN_MM) {
          expect(after).toBe(before);
          unchanged++;
        }
        if (delta > 1e-8) changed++;
        const edge = diaphragmInteriorEdgeZ(x, y, s.diaphragm, s.torso);
        if (r === edge && l === edge) {
          expect(after).toBe(edge);
          exterior++;
        }
      }
    expect(changed).toBeGreaterThan(10);
    expect(unchanged).toBeGreaterThan(1000);
    expect(exterior).toBeGreaterThan(1000);
    for (const d of [s.diaphragm.right, s.diaphragm.left])
      expect(diaphragmHeight(d.x0, d.y0, s.diaphragm, s.torso)).toBeCloseTo(d.apex, 12);
  });
});
