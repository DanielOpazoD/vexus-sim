import { readFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { DIAPHRAGM_AXIS_CORE, diaphragmEdgeZ, diaphragmInteriorEdgeZ, diaphragmHeight, torsoPhi } from '../anatomy/primitives';
import { setReferenceBody } from '../anatomy/referenceBody';
import { NORMAL_ADULT } from '../cases';
const bytes = readFileSync('src/anatomy/reference-body.bin');
const profile = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
afterEach(() => setReferenceBody());
for (const reference of [false, true])
  it(`la altura tiene un límite único al acercarse al eje corporal (${reference ? 'referencia' : 'legacy'})`, () => {
    setReferenceBody(reference ? profile : undefined);
    const s = new AnatomyScene(NORMAL_ADULT);
    const ranges = [0.1, 0.01, 0.001].map((radius) => {
      const heights = Array.from({ length: 72 }, (_, i) => {
        const phi = (i * Math.PI) / 36;
        return diaphragmHeight(radius * Math.cos(phi), (s.torso.y0 ?? 0) + radius * Math.sin(phi), s.diaphragm, s.torso);
      });
      expect(heights.every(Number.isFinite)).toBe(true);
      return Math.max(...heights) - Math.min(...heights);
    });
    expect(ranges[2], `radios decrecientes: ${ranges.join(', ')}`).toBeLessThan(0.002);
    expect(ranges[1]).toBeLessThan(ranges[0] * 0.2);
    expect(ranges[2]).toBeLessThan(ranges[1] * 0.2);
  });

for (const reference of [false, true])
  it(`la regularización conserva borde, ápices y campo fuera del núcleo (${reference ? 'referencia' : 'legacy'})`, () => {
    setReferenceBody(reference ? profile : undefined);
    const s = new AnatomyScene(NORMAL_ADULT),
      t = s.torso,
      d = s.diaphragm;
    let checked = 0;
    for (const rho of [DIAPHRAGM_AXIS_CORE, 0.2, 0.5, 1, 1.5])
      for (let i = 0; i < 72; i++) {
        const phi = (i * Math.PI) / 36;
        const x = rho * t.a * Math.cos(phi),
          y = (t.y0 ?? 0) + rho * t.b * Math.sin(phi);
        expect(diaphragmInteriorEdgeZ(x, y, d, t)).toBeCloseTo(diaphragmEdgeZ(torsoPhi(x, y, t), d), 10);
        checked++;
      }
    expect(checked).toBe(360);
    expect(diaphragmInteriorEdgeZ(0, t.y0 ?? 0, d, t)).toBe(d.edgeZ);
    for (const dome of [d.right, d.left]) expect(diaphragmHeight(dome.x0, dome.y0, d, t)).toBeCloseTo(dome.apex, 12);
    for (let x = -t.a; x <= t.a; x += 2)
      for (let y = (t.y0 ?? 0) - t.b; y <= (t.y0 ?? 0) + t.b; y += 2) {
        const edge = diaphragmInteriorEdgeZ(x, y, d, t);
        expect(Number.isFinite(edge)).toBe(true);
        expect(edge).toBeGreaterThanOrEqual(d.edgeZ - 1e-12);
        expect(edge).toBeLessThanOrEqual(diaphragmEdgeZ(torsoPhi(x, y, t), d) + 1e-10);
      }
  });
