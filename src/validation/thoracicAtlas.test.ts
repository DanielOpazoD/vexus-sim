import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { THORACIC_ATLAS } from '../anatomy/thoracicAtlasData';
import { THORACIC_SURFACE } from '../anatomy/thoracicSurfaceData';
import { thoracicSdf, thoracicFrame, thoracicMaterial, thoracicValue, setThoracicAtlas } from '../anatomy/thoracicAtlas';
import witnesses from '../../docs/anatomy/costal-heldout-witnesses.json';
import type { Vec3 } from '../core/vec3';

const compressed = readFileSync('src/anatomy/thoracic-atlas.gzip.bin'),
  raw = gunzipSync(compressed);
beforeEach(() => setThoracicAtlas(new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2)));
afterEach(() => setThoracicAtlas());
describe('registered healthy costal cage: independent source witnesses', () => {
  it('pins the acoustic source and the 48 MiB allocation bound', () => {
    expect(createHash('sha256').update(raw).digest('hex')).toBe(THORACIC_ATLAS.sha256Raw);
    expect(createHash('sha256').update(compressed).digest('hex')).toBe(THORACIC_ATLAS.sha256Gzip);
    expect(raw.byteLength).toBeLessThanOrEqual(48 * 1024 * 1024);
    expect(compressed.byteLength).toBeLessThanOrEqual(6 * 1024 * 1024);
    expect(() => setThoracicAtlas(new Uint16Array(10))).toThrow();
  });
  it('contains four independent original-mesh interior witnesses for each of the 24 ribs', () => {
    expect(new Set(witnesses.boneInterior.map((w) => w.id)).size).toBe(24);
    expect(witnesses.boneInterior.length).toBe(96);
    for (const w of witnesses.boneInterior) {
      expect(w.sourceSurfaceDistanceMm).toBeGreaterThan(1.4);
      // 1.5 mm source pitch cannot lose a point >1.4 mm inside a rib.
      expect(thoracicSdf(w.p as Vec3), w.name).toBeLessThan(0);
      expect(['bone', 'vertebra'], w.name).toContain(thoracicMaterial(thoracicValue(w.p as Vec3).label));
      const f = thoracicFrame(w.p as Vec3);
      expect(f.axis.every(Number.isFinite), w.name).toBe(true);
      expect(Number.isFinite(f.curvature), w.name).toBe(true);
    }
  });
  it('preserves independently verified empty intercostal spaces, without bridges', () => {
    expect(witnesses.intercostalSpaces.length).toBeGreaterThan(30);
    for (const w of witnesses.intercostalSpaces) {
      expect(w.sourceSurfaceDistanceMm).toBeGreaterThan(3);
      expect(thoracicSdf(w.p as Vec3), w.ribs.join('/')).toBeGreaterThan(1.5);
    }
  });
  it('does not bury original joint surfaces deep inside a rasterized union', () => {
    // Original sternum surface vertex, rib-12 triangle centroid and cartilage-3
    // triangle centroid from the independent source audit. These regression
    // witnesses exposed 3.47–5.52 mm errors; the predeclared bound is one cell.
    const points: Vec3[] = [
      [-17.6837655, 77.68965, 43.4565],
      [-19.04049883, -60.51548333, -82.1835],
      [-12.93563217, 62.20498333, 89.91316667],
    ];
    for (const p of points) expect(Math.abs(thoracicSdf(p))).toBeLessThanOrEqual(THORACIC_ATLAS.pitchMm);
  });
  it('keeps every displayed skeletal part on the same acoustic zero surface', () => {
    const packed = readFileSync('src/anatomy/thoracic-surface.gzip.bin'),
      surfaceRaw = gunzipSync(packed),
      vertices = new Float32Array(surfaceRaw.buffer, surfaceRaw.byteOffset, surfaceRaw.byteLength / 4);
    expect(THORACIC_SURFACE.sourceFieldSha256).toBe(THORACIC_ATLAS.sha256Raw);
    expect(createHash('sha256').update(surfaceRaw).digest('hex')).toBe(THORACIC_SURFACE.sha256Raw);
    expect(createHash('sha256').update(packed).digest('hex')).toBe(THORACIC_SURFACE.sha256Gzip);
    expect(THORACIC_SURFACE.fields.length).toBe(53);
    for (const [offset, count] of THORACIC_SURFACE.fields) {
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i += Math.max(1, Math.floor(count / 100))) {
        const p = Array.from(vertices.subarray(offset + i * 3, offset + i * 3 + 3)) as Vec3;
        // Numeric extraction precision, not an anatomical tolerance.
        expect(Math.abs(thoracicSdf(p))).toBeLessThan(0.001);
      }
    }
  });
});
