import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { triTable } from 'three/examples/jsm/objects/MarchingCubes.js';
import { compactMarchingTable } from '../../tools/build/marchingTable';

it('preserva cada índice y centinela de los 256 casos y rechaza cambios de formato o dominio', () => {
  const source = readFileSync('node_modules/three/examples/jsm/objects/MarchingCubes.js', 'utf8');
  const compact = compactMarchingTable(source);
  const fragment = compact.slice(compact.indexOf('const triangleBytes'), compact.indexOf('export { MarchingCubes'));
  const actual = runInNewContext(`${fragment};triTable;`, { atob, Int32Array }) as Int32Array;
  expect(actual).toEqual(triTable);
  expect(compact.length).toBeLessThan(source.length - 5000);
  expect(() => compactMarchingTable(source.replace('const triTable', 'const renamed'))).toThrow('layout changed');
  expect(() => compactMarchingTable(source.replace('const triTable = new Int32Array( [', 'const triTable = new Int32Array( [12,'))).toThrow(
    'domain changed',
  );
});
