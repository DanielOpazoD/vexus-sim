import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildMeshField, queryMeshField } from '../../tools/anatomy/meshField';
const vertices = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
const faces = [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3];
const tetra = buildMeshField(vertices, faces);

describe('contrato experimental de campo de malla cerrado', () => {
  it('distingue interior, exterior, cara, arista y vértice de un tetraedro', () => {
    expect(queryMeshField(tetra, [0.1, 0.1, 0.1]).distance).toBeCloseTo(-0.1, 10);
    expect(queryMeshField(tetra, [-1, 0, 0]).distance).toBeCloseTo(1, 10);
    expect(queryMeshField(tetra, [0.25, 0.25, -1]).distance).toBeCloseTo(1, 10);
    expect(queryMeshField(tetra, [0.5, -1, -1]).distance).toBeCloseTo(Math.SQRT2, 10);
    expect(queryMeshField(tetra, [0, 0, 0]).distance).toBe(0);
  });
  it('rechaza malla abierta, winding invertido, caras degeneradas y valores no finitos', () => {
    expect(() => buildMeshField(vertices, faces.slice(3))).toThrow();
    const reverse = faces.slice();
    for (let i = 0; i < reverse.length; i += 3) [reverse[i + 1], reverse[i + 2]] = [reverse[i + 2], reverse[i + 1]];
    expect(() => buildMeshField(vertices, reverse)).toThrow();
    expect(() => buildMeshField(vertices, [0, 0, 1, ...faces.slice(3)])).toThrow();
    expect(() => buildMeshField([NaN, ...vertices.slice(1)], faces)).toThrow();
    expect(() => queryMeshField(tetra, [0, NaN, 0])).toThrow();
  });
  it('rechaza índices fuera del dominio, duplicados sin soldar y componentes separados', () => {
    expect(() => buildMeshField(vertices, [30, ...faces.slice(1)])).toThrow();
    expect(() => buildMeshField([...vertices, 0, 0, 0], faces)).toThrow();
    const other = vertices.map((x) => x + 3);
    expect(() => buildMeshField([...vertices, ...other], [...faces, ...faces.map((i) => i + 4)])).toThrow();
  });
  it('rechaza bordes no-manifold y enlaces de vértice pinzados', () => {
    expect(() => buildMeshField(vertices, [...faces, ...faces])).toThrow();
    const v = [...vertices, -1, 0, 0, 0, -1, 0, 0, 0, -1],
      other = [0, 5, 4, 0, 4, 6, 0, 6, 5, 4, 5, 6];
    expect(() => buildMeshField(v, [...faces, ...other])).toThrow();
  });
  it('mantiene cotas conservadoras en el BVH', () => {
    expect(tetra.maxDepth).toBeLessThan(31);
    expect(tetra.nodes[0]).toBeLessThan(0);
    expect(tetra.nodes[4]).toBeGreaterThan(1);
    expect(queryMeshField(tetra, [2, 2, 2]).visited).toBeLessThanOrEqual(tetra.nodes.length / 8);
  });
  it('coincide con los oráculos CGAL independientes en toda la fuente fijada', () => {
    const compressed = readFileSync('tools/anatomy/fixtures/diaphragm-field.json.gz');
    expect(createHash('sha256').update(compressed).digest('hex')).toBe('6b3d7fa6f679b72f32bef219f3bf8a506ce3bdef1846ad01b57f8308eba73298');
    const data = JSON.parse(gunzipSync(compressed).toString()) as {
      positions: number[];
      triangles: number[];
      points: number[];
      signedDistanceMm: number[];
      oracleNormals: number[][];
      pointCount: number;
      vertexCount: number;
      faceCount: number;
      runtimeIntegration: boolean;
      float32SelfIntersectionPairs: number;
    };
    expect(data.runtimeIntegration).toBe(false);
    expect(data.float32SelfIntersectionPairs).toBe(0);
    expect(data.pointCount).toBe(8768);
    expect(data.vertexCount).toBe(34241);
    expect(data.faceCount).toBe(68490);
    const field = buildMeshField(data.positions, data.triangles);
    expect(field.maxDepth).toBeLessThan(31);
    let error = 0,
      minDot = 1;
    for (let i = 0; i < data.pointCount; i++) {
      const q = queryMeshField(field, data.points.slice(i * 3, i * 3 + 3) as [number, number, number]);
      error = Math.max(error, Math.abs(q.distance - data.signedDistanceMm[i]));
      if (Math.abs(data.signedDistanceMm[i]) > 0.01)
        minDot = Math.min(
          minDot,
          q.normal.reduce((s, x, a) => s + x * data.oracleNormals[i][a], 0),
        );
    }
    expect(error).toBeLessThan(1e-6);
    expect(minDot).toBeGreaterThan(0.999999);
  });
});
