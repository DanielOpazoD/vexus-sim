import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { setThoracicAtlas } from '../anatomy/thoracicAtlas';
import { setAbdominalBody } from '../anatomy/referenceBody';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import type { TubeGrid } from '../anatomy/gpu/tubeGrid';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import type { Vec3 } from '../core/vec3';

function loadAtlas(): void {
  for (const [name, set] of [
    ['abdominal', setAbdominalAtlas],
    ['thoracic', setThoracicAtlas],
  ] as const) {
    const b = gunzipSync(readFileSync(`src/anatomy/${name}-atlas.gzip.bin`));
    set(new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2));
  }
  const b = readFileSync('src/anatomy/abdominal-body.bin');
  setAbdominalBody(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4));
}
afterEach(() => {
  setAbdominalAtlas();
  setThoracicAtlas();
  setAbdominalBody();
});

describe('CPU conservative vascular index', () => {
  for (const patient of [NORMAL_ADULT, SEVERE_CONGESTION])
    it(`preserves complete classifications and tube-face ownership at dynamic calibers (${patient.id})`, () => {
      loadAtlas();
      const scene = new AnatomyScene(patient);
      const grid = Reflect.get(scene, 'cpuTubeGrid') as TubeGrid | null;
      expect(grid).not.toBeNull();
      const points: Vec3[] = [
        [-1000, 0, 0],
        [0, 0, 1000],
      ];
      // Tube centers, walls and exterior controls include branches sharing a vessel id and ducts.
      for (const tube of [...scene.vessels, ...scene.ducts]) {
        const n = tube.tube.nodes[Math.floor(tube.tube.nodes.length / 2)];
        for (const delta of [0, n.r * 0.8, n.r * 1.6]) points.push([n.p[0] + delta, n.p[1], n.p[2]]);
      }
      // Every side of grid cell boundaries, and broad interior/exterior material positions.
      for (let i = 0; i < 240; i++) points.push([-180 + ((i * 37) % 360), -140 + ((i * 53) % 280), -400 + ((i * 71) % 520)]);
      for (let k = 0; k < 3; k++)
        for (const delta of [-1e-9, 0, 1e-9]) {
          const p: Vec3 = [...grid!.origin];
          p[k] += 32 + delta;
          points.push(p);
        }
      for (const scale of [0.7, 1, 1.5]) {
        const caliber = { ...BASELINE_CALIBER, radiusScale: () => scale, ivcApScale: 0.55 + scale / 5 };
        Reflect.set(scene, 'cpuTubeGrid', grid);
        const indexed = points.map((p) => ({ classification: scene.classify(p, caliber), face: scene.faceTube(p, caliber) }));
        Reflect.set(scene, 'cpuTubeGrid', null);
        const full = points.map((p) => ({ classification: scene.classify(p, caliber), face: scene.faceTube(p, caliber) }));
        expect(indexed).toEqual(full);
      }
    });
  it('leaves the historical anatomy on its original full traversal', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    expect(Reflect.get(scene, 'cpuTubeGrid')).toBeNull();
  });
});
