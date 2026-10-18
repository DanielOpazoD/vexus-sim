import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyGradient, bodySection, BODY_STRIDE } from '../anatomy/referenceBody';
import type { Vec3 } from '../core/vec3';

const profiles = ['reference', 'abdominal'].map((name) => {
  const b = readFileSync(`src/anatomy/${name}-body.bin`);
  return { name, data: new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) };
});
const unit = (p: Vec3, data: Float32Array) => {
  const g = bodyGradient(p, data);
  const n = Math.hypot(...g);
  return g.map((v) => v / n);
};

describe.each(profiles)('continuidad del perfil $name (plan 216)', ({ data }) => {
  const rows = data.length / BODY_STRIDE;
  const minZ = rows === 8 ? -160 : -400;
  const step = (120 - minZ) / (rows - 1);

  // Contrato geométrico, no tolerancia clínica: dos puntos separados 0,00002 mm
  // o rad no pueden adquirir normales distintas por cruzar un nodo de la tabla.
  it.fails('no cambia de normal de golpe al cruzar los 64 sectores angulares', () => {
    let worst = 0;
    for (const z of [-119, -81, -43, 1])
      for (let k = 0; k < 64; k++) {
        const phi = (k * 2 * Math.PI) / 64;
        const [r, , , cy] = bodySection(phi, z, data);
        const p = (a: number): Vec3 => [(r - 15) * Math.cos(a), cy + (r - 15) * Math.sin(a), z];
        const a = unit(p(phi - 1e-5), data),
          b = unit(p(phi + 1e-5), data);
        worst = Math.max(worst, Math.hypot(...a.map((v, i) => v - b[i])));
      }
    expect(worst).toBeLessThan(0.001);
  });

  it.fails('no cambia de normal de golpe al cruzar las filas craneocaudales', () => {
    let worst = 0;
    for (let row = 1; row < rows - 1; row++)
      for (const phi of [0.27, 1.67, 2.99, 4.13, 5.51]) {
        const z = minZ + row * step;
        const [r, , , cy] = bodySection(phi, z, data);
        const p = (zz: number): Vec3 => [(r - 15) * Math.cos(phi), cy + (r - 15) * Math.sin(phi), zz];
        const a = unit(p(z - 1e-5), data),
          b = unit(p(z + 1e-5), data);
        worst = Math.max(worst, Math.hypot(...a.map((v, i) => v - b[i])));
      }
    expect(worst).toBeLessThan(0.001);
  });

  it('conserva cada radio y centro observado, sin escalar ni desplazar el atlas', () => {
    for (let row = 0; row < rows; row++)
      for (let k = 0; k < 64; k++) {
        const [r, , , cy] = bodySection((k * 2 * Math.PI) / 64, minZ + row * step, data);
        expect(r).toBeCloseTo(data[row * BODY_STRIDE + 1 + k], 9);
        expect(cy).toBeCloseTo(data[row * BODY_STRIDE], 9);
      }
  });
});
