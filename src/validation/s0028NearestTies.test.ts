import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { HALF } from '../anatomy/halfFloat';
import { sourceLabel } from '../anatomy/sourceVolume';
import type { Vec3 } from '../core/vec3';
import admission from './fixtures/s0028-boundary-admission.json';
import ties from './fixtures/s0028-nearest-ties.json';
import { S0028_BUNDLE as B } from './support/legacyPerson/anatomyBundle';

it('explica los siete empates del lector real y lung crudo sin omitir ninguna etiqueta', () => {
  expect(ties).toHaveLength(8);
  expect(ties.filter((t) => t.name !== 'lung')).toHaveLength(7);
  for (const asset of ['abdominal', 'thoracic'] as const) {
    const bytes = new Uint8Array(gunzipSync(readFileSync(`src/anatomy/s0028/${asset}-direct.gzip.bin`)));
    const atlas = new Uint16Array(bytes.buffer);
    const [w, h] = B[asset].textureDimensions;
    for (const tie of ties) {
      const f = B.fields.find((f) => f.name === tie.name);
      if (!f) throw new Error('Campo del testigo ausente');
      if (f.asset !== asset) continue;
      const p: Vec3 = [tie.point[0], tie.point[1], tie.point[2]];
      const label = (point: Vec3) => sourceLabel(atlas, point, f, B[asset].textureDimensions) % 128;
      expect(label(p)).toBe(tie.cpuLabel);
      const q = p.map((x, axis) => (x - f.originMm[axis]) / f.pitchMm);
      const gpuQ = p.map((x, axis) => Math.fround(Math.fround(x - Math.fround(f.originMm[axis])) / f.pitchMm));
      expect(q).toEqual(tie.cpuQ);
      expect(gpuQ).toEqual(tie.gpuQ);
      const at = gpuQ.map(Math.round);
      expect(at).toEqual(tie.gpuIndex);
      expect(HALF[atlas[2 * (at[0] + f.offset[0] + w * (at[1] + f.offset[1] + h * (at[2] + f.offset[2]))) + 1]] % 128).toBe(tie.gpuLabel);
      // A strict equality gate fails at these retained witnesses. Each changed
      // coordinate is within 6e-6 voxels of a nearest-cell boundary, not a seam loss.
      expect(tie.cpuLabel).not.toBe(tie.gpuLabel);
      q.forEach((v, axis) => {
        if (tie.cpuIndex[axis] !== tie.gpuIndex[axis]) expect(Math.abs(v - (Math.floor(v) + 0.5))).toBeLessThan(0.000006);
      });
      for (const probe of tie.diagonalProbes) {
        const moved: Vec3 = [Math.fround(p[0] + probe.delta), Math.fround(p[1] + probe.delta), Math.fround(p[2] + probe.delta)];
        expect(label(moved)).toBe(probe.cpu[1]);
        expect(probe.cpu).toEqual(probe.gpu.slice(0, 3));
      }
    }
  }
});

it('explica la admisión distinta en la cara inferior del bloque hepático, siempre fuera del órgano', () => {
  // Medido en SwiftShader real (revisión de #328): 18 testigos con distancia 16 en CPU y GPU y
  // etiqueta 0/1. El origen del bloque no es representable en Float32: la CPU queda a ~1e-6 vóxel
  // fuera y rechaza; la GPU redondea q a 0 y admite el nodo de borde, que está en el recorte +16.
  expect(admission).toHaveLength(18);
  const bytes = new Uint8Array(gunzipSync(readFileSync('src/anatomy/s0028/abdominal-direct.gzip.bin')));
  const atlas = new Uint16Array(bytes.buffer);
  const [w, h] = B.abdominal.textureDimensions;
  for (const witness of admission) {
    const f = B.fields.find((f) => f.name === witness.name);
    if (f?.asset !== 'abdominal') throw new Error('Campo del testigo ausente');
    const p: Vec3 = [witness.point[0], witness.point[1], witness.point[2]];
    const q = p.map((x, axis) => (x - f.originMm[axis]) / f.pitchMm);
    const gpuQ = p.map((x, axis) => Math.fround(Math.fround(x - Math.fround(f.originMm[axis])) / f.pitchMm));
    expect(q.some((v) => v < 0 && v > -0.00001)).toBe(true);
    expect(gpuQ.every((v) => v >= 0)).toBe(true);
    expect(sourceLabel(atlas, p, f, B.abdominal.textureDimensions) % 128).toBe(witness.cpu.label);
    const at = gpuQ.map(Math.round);
    const texel = 2 * (at[0] + f.offset[0] + w * (at[1] + f.offset[1] + h * (at[2] + f.offset[2])));
    expect(HALF[atlas[texel + 1]] % 128).toBe(witness.gpu.label);
    expect(HALF[atlas[texel]]).toBe(16);
    expect([witness.cpu.d, witness.gpu.d]).toEqual([16, 16]);
  }
});
