import { describe, expect, it } from 'vitest';
import {
  IDENTITY_WARP,
  PROBE_COMPRESSION,
  compressionReachMm,
  uncompress,
  warpAt,
  warpNormal,
  type ProbeCompression,
  type Warp,
} from '../anatomy/compression';
import { Interface } from '../anatomy/interfaces';
import type { Vec3 } from '../core/vec3';
import { facetCosine, facetTilt } from '../ultrasound/interfaceEcho';

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v);
  return v.map((x) => x / l) as Vec3;
};
const dot = (a: Vec3, b: Vec3) => a.reduce((s, x, i) => s + x * b[i], 0);
const nodes = Array.from({ length: PROBE_COMPRESSION.nodes }, (_, i) => [0.2 * i, -8 + 0.1 * i, 25] as const);
const compression: ProbeCompression = {
  center: [0, 0, 0],
  radiusMm: 60,
  axial: [0, 1, 0],
  lateral: [1, 0, 0],
  halfAngle: 0.5,
  halfElevationMm: 5,
  plateMm: 25,
  nodes,
  reachMm: compressionReachMm(nodes),
  contact: nodes.map(() => 1),
};
const normals: Vec3[] = [[0, 1, 0], unit([1, 2, 3]), unit([-2, 1, 0.5])];
const points: Vec3[] = [
  [12, 78, 3],
  [-10, 93, 4],
  [8, 113, 0],
];
const dir = unit([0.2, 1, -0.3]);
const call = (n: Vec3, tilt: Vec3, w: Warp) => facetCosine(n, dir, tilt, w);

describe('orientación material de las facetas bajo compresión', () => {
  it('transporta la faceta completa, como el gradiente independiente de un plano material', () => {
    let count = 0;
    for (const p of points)
      for (const n of normals)
        for (const face of [Interface.VeinLumen, Interface.PortalLumen, Interface.IvcLumen]) {
          const m = uncompress(p, compression),
            tilt = facetTilt(m, face);
          const nf = n.map((x, j) => x + tilt[j] - dot(n, tilt) * n[j]) as Vec3;
          const phi = (q: Vec3) => dot(nf, uncompress(q, compression));
          const h = 1e-4;
          const gradient = [0, 1, 2].map((j) => {
            const a = [...p] as Vec3,
              b = [...p] as Vec3;
            a[j] += h;
            b[j] -= h;
            return (phi(a) - phi(b)) / (2 * h);
          }) as Vec3;
          const expected = Math.abs(dot(unit(gradient), dir));
          expect(call(n, tilt, warpAt(p, compression))).toBeCloseTo(expected, 7);
          count++;
        }
    expect(count).toBe(27);
  });
  it('sin compresión conserva exactamente la incidencia anterior', () => {
    for (const n of normals) {
      const tilt = facetTilt([13, 21, 17], Interface.PortalLumen);
      expect(call(n, tilt, IDENTITY_WARP)).toBe(facetCosine(n, dir, tilt));
    }
  });
  it('la regla anterior de inclinar después de transformar la normal cambia la incidencia', () => {
    const w: Warp = { shift: 0, rhat: [0, 1, 0], rho: 100, elevation: [0, 0, 1], grad: [0.4, 0.6, 0] };
    const n: Vec3 = [0, 1, 0],
      tilt: Vec3 = [0.2, 0, 0.1];
    const old = facetCosine(unit(warpNormal(w, n)), dir, tilt);
    const want = Math.abs(dot(unit([0.6, 1.6, 0.1]), dir));
    expect(Math.abs(old - want)).toBeGreaterThan(0.01);
    expect(call(n, tilt, w)).toBeCloseTo(want, 12);
  });
});
