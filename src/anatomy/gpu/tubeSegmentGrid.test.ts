import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../core/vec3';
import { tubeQuery, tubeShapeTexel, type Tube } from '../primitives';
import { buildTubeGrid, tubeGridReach, tubeGridRegions, type TubeGrid } from './tubeGrid';

function candidates(grid: TubeGrid, point: Vec3): number[] {
  const q = point.map((v, k) => Math.floor(Math.fround(Math.fround(Math.fround(v) - grid.origin[k]) / grid.pitch)));
  if (q.some((v, k) => v < 0 || v >= grid.size[k])) return [];
  const cell = q[0] + grid.size[0] * (q[1] + grid.size[1] * q[2]);
  const first = grid.data[2 * cell],
    count = grid.data[2 * cell + 1];
  return Array.from({ length: count }, (_, i) => grid.data[2 * (first + i)]);
}

function header(tube: Tube, scale: number, wall: number): Float32Array {
  const data = new Float32Array(20);
  data.set([0, tube.nodes.length, tube.apScale, scale, wall]);
  data.set(tubeShapeTexel(tube, scale), 16);
  return data;
}

describe('segment envelopes of the uploaded vascular geometry', () => {
  it('keeps every lumen/wall point selected by the original query across bends, caliber, anisotropy and radius noise', () => {
    const nodes: Tube['nodes'] = [
      { p: [-72, 8, -50], r: 2 },
      { p: [-32, 12, 30], r: 12 },
      { p: [40, -8, 80], r: 5 },
      { p: [92, 48, 110], r: 1 },
    ];
    const packed = Float32Array.from(nodes.flatMap((n) => [...n.p, n.r]));
    let checked = 0;
    for (const apScale of [0.25, 1, 1.8])
      for (const shaped of [false, true])
        for (const scale of [0.2, 0.7, 1, 1.5, 3]) {
          const tube: Tube = {
            kind: 'tube',
            nodes,
            apScale,
            ...(shaped ? { shape: { seed: 73, w: [0.6, 0, 0.8] as Vec3, kappa: 0.9, amp: 0.06 } } : { smoothRadius: true }),
          };
          const reach = tubeGridReach(header(tube, scale, 0.4), 12);
          const regions = tubeGridRegions(packed, 0, nodes.length, reach);
          const grid = buildTubeGrid([[0, 0, 0, 280]], [regions], 16)!;
          expect(grid).not.toBeNull();
          for (let segment = 0; segment < nodes.length - 1; segment++)
            for (const fraction of [-0.1, 0, 0.25, 0.5, 0.75, 1, 1.1]) {
              const a = nodes[segment],
                b = nodes[segment + 1];
              for (let direction = 0; direction < 24; direction++)
                for (const radius of [0, 0.5, 1, 1.1, 1.5, 2, 3]) {
                  const angle = (direction * Math.PI) / 12;
                  const delta = radius * scale * Math.max(a.r, b.r);
                  const point = a.p.map(
                    (v, k) => v + fraction * (b.p[k] - v) + delta * [Math.cos(angle), Math.sin(angle), Math.sin(3 * angle)][k],
                  ) as Vec3;
                  // An independent physical query decides positives, not the envelope formula.
                  if (tubeQuery(point, tube, scale).d < 1.4) {
                    expect(candidates(grid, point)).toContain(0);
                    checked++;
                  }
                }
            }
        }
    expect(checked).toBeGreaterThan(20_000);
  });

  it('deduplicates overlapping segment cells, preserves tube order and removes empty corners of a whole-tube sphere', () => {
    const nodes = new Float32Array([-96, 0, 0, 2, 0, 0, 0, 2, 96, 0, 0, 2]);
    const regions = tubeGridRegions(nodes, 0, 3, 4);
    const spheres = [
      [0, 0, 0, 120],
      [0, 0, 0, 120],
    ] as const;
    const full = buildTubeGrid(spheres)!;
    for (const pitch of [8, 16, 32]) {
      const grid = buildTubeGrid(spheres, [regions, regions], pitch)!;
      for (const x of [-96, -32, -1e-7, 0, 1e-7, 32, 96]) expect(candidates(grid, [x, 0, 0])).toEqual([0, 1]);
      expect(candidates(grid, [0, 80, 0])).toEqual([]);
      expect(candidates(full, [0, 80, 0])).toEqual([0, 1]);
    }
  });

  it('changes the cache reach when dilation crosses its conservative bucket and reads compact-header offsets', () => {
    const tube: Tube = {
      kind: 'tube',
      nodes: [
        { p: [0, 0, 0], r: 10 },
        { p: [0, 0, 10], r: 10 },
      ],
      apScale: 1,
    };
    const low = header(tube, 0.5, 0.4),
      nearby = header(tube, 0.65, 0.4),
      expanded = header(tube, 0.67, 0.4);
    expect(tubeGridReach(low, 10)).toBe(tubeGridReach(nearby, 10));
    expect(tubeGridReach(expanded, 10)).toBeGreaterThan(tubeGridReach(low, 10));
    const packed = new Float32Array(60);
    packed.set(expanded, 40);
    expect(tubeGridReach(packed, 10, 40)).toBe(tubeGridReach(expanded, 10));
  });

  it('rejects malformed envelopes and pitches so the renderer can retain the original traversal', () => {
    const sphere = [[0, 0, 0, 2]] as const;
    for (const pitch of [0, -1, NaN, Infinity, 1e-9]) expect(buildTubeGrid(sphere, undefined, pitch)).toBeNull();
    for (const regions of [[], [[]], [[{ min: [0, 0, 0], max: [-1, 1, 1] }]], [[{ min: [NaN, 0, 0], max: [1, 1, 1] }]]])
      expect(buildTubeGrid(sphere, regions)).toBeNull();
    const nodes = new Float32Array(8);
    for (const [start, count, reach] of [
      [0, Infinity, 4],
      [-1, 2, 4],
      [0, 3, 4],
      [0, 2, NaN],
      [0, 2, -1],
    ])
      expect(tubeGridRegions(nodes, start, count, reach)).toEqual([]);
    const h = new Float32Array(20);
    h[2] = 1;
    h[3] = 1;
    h[4] = 0.4;
    expect(Number.isNaN(tubeGridReach(h, -1))).toBe(true);
    h[2] = 0;
    expect(Number.isNaN(tubeGridReach(h, 1))).toBe(true);
  });
});
