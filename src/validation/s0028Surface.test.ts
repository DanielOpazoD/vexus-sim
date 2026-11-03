import { expect, it } from 'vitest';
import { sourceSurface } from '../anatomy/sourceSurface';
it('extrae el cero nativo sin perder la costura de bloques ni truncar triángulos', async () => {
  const data = new Uint16Array(35 * 2 * 2 * 2);
  for (let z = 0; z < 2; z++)
    for (let y = 0; y < 2; y++) for (let x = 0; x < 35; x++) data[2 * (x + 35 * (y + 2 * z))] = y ? 0x3800 : 0xb800;
  const mesh = await sourceSurface(
    data,
    { name: 'test', asset: 'abdominal', originMm: [-3, 4, 5], dimensions: [35, 2, 2], offset: [0, 0, 0], pitchMm: 1.5 },
    [35, 2, 2],
  );
  expect(mesh.positions.length).toBe(68 * 9);
  let area = 0;
  for (let i = 0; i < mesh.positions.length; i += 9) {
    const p = mesh.positions;
    for (let j = 0; j < 3; j++) expect(p[i + 3 * j + 1]).toBe(4.75);
    area += Math.abs((p[i + 3] - p[i]) * (p[i + 8] - p[i + 2]) - (p[i + 6] - p[i]) * (p[i + 5] - p[i + 2])) / 2;
  }
  expect(area).toBe(51 * 1.5);
});
