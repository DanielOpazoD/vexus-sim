import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { THORACIC_ATLAS } from '../anatomy/thoracicAtlasData';
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
});
