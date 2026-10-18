import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { abdominalAtlasSdf, setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { setThoracicAtlas, thoracicValue } from '../anatomy/thoracicAtlas';
import { bodySection, setAbdominalBody } from '../anatomy/referenceBody';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import type { Vec3 } from '../core/vec3';

beforeAll(() => {
  for (const [setter, file] of [
    [setAbdominalAtlas, 'abdominal'],
    [setThoracicAtlas, 'thoracic'],
  ] as const) {
    const b = gunzipSync(readFileSync(`src/anatomy/${file}-atlas.gzip.bin`));
    setter(new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  }
  const b = readFileSync('src/anatomy/abdominal-body.bin');
  setAbdominalBody(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
});
afterAll(() => {
  setAbdominalAtlas();
  setThoracicAtlas();
  setAbdominalBody();
});

for (const patient of [NORMAL_ADULT, SEVERE_CONGESTION])
  it(`${patient.id}: el contacto parietal continúa bajo el borde hepático sin una cuña de relleno (222)`, () => {
    const s = new AnatomyScene(patient);
    const gaps: number[] = [];
    for (const phi of [2.91, 3.04, 3.16])
      for (const z of [-177.5, -162.5, -147.5, -132.5]) {
        const [skinRadius, , , cy] = bodySection(phi, z, s.torso.profile!);
        const point = (r: number): Vec3 => [r * Math.cos(phi), cy + r * Math.sin(phi), z];
        const occupied = (r: number) => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].some((f) => abdominalAtlasSdf(point(r), f) < 0);
        let lo = 0,
          bone = -1;
        for (let r = 0; r < 180; r += 0.5) {
          if (occupied(r)) lo = r;
          if (thoracicValue(point(r)).d < 0) bone = r;
        }
        expect(lo).toBeGreaterThan(80);
        let hi = lo + 0.5;
        for (let i = 0; i < 24; i++) {
          const mid = (lo + hi) / 2;
          if (occupied(mid)) lo = mid;
          else hi = mid;
        }
        const outer = (lo + hi) / 2;
        // Puntos independientes de los nodos. La costilla que cruza el último
        // punto posterior debe conservar al menos piel superficial.
        if (bone >= 0) expect(skinRadius - bone).toBeGreaterThan(s.torso.skinMm);
        const gap = skinRadius - s.wallThickness() - outer;
        gaps.push(gap);
        // 2 mm de protección fuente + 1,5 mm de celda + 0,5 mm del ajuste radial.
        // Es una cota geométrica del modelo, no un espesor normal humano.
        expect(gap, `phi=${phi}, z=${z}`).toBeLessThan(4);
        expect(gap, 'sin recortar el interior visceral a más de una celda').toBeGreaterThan(-1.5);
      }
    console.log({ caseId: patient.id, minGap: Math.min(...gaps), maxGap: Math.max(...gaps) });
    expect(gaps).toHaveLength(12);
  });
