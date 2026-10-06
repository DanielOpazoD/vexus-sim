import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { ABDOMINAL_ATLAS, ABDOMINAL_FIELDS } from '../anatomy/abdominalAtlasData';
import { setAbdominalAtlas, abdominalAtlasSdf, abdominalAtlasValue } from '../anatomy/abdominalAtlas';
import { setAbdominalBody } from '../anatomy/referenceBody';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';
import { Tissue } from '../anatomy/tissues';
import { VESSEL_IDS } from '../physiology/vessels';
import { AnatomyQuery } from '../anatomy/query';
import { PhysiologyEngine } from '../physiology/engine';
import { VenousSpectralAcquisition } from '../app/venousSpectral';
import { DEFAULT_BMODE } from '../ultrasound/renderer';
import { loadPinnedGzip } from '../anatomy/loadAbdominalAtlas';

const compressed = readFileSync('src/anatomy/abdominal-atlas.gzip.bin');
const raw = gunzipSync(compressed);
const profile = readFileSync('src/anatomy/abdominal-body.bin');
const digest = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
beforeEach(() => {
  setAbdominalAtlas(new Uint16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
  setAbdominalBody(new Float32Array(profile.buffer.slice(profile.byteOffset, profile.byteOffset + profile.byteLength)));
});
afterEach(() => {
  setAbdominalAtlas();
  setAbdominalBody();
  vi.unstubAllGlobals();
});

describe('registered abdomen: actual shipped acoustic data', () => {
  it('pins both representations, stays within the portable memory bound and contains every field', () => {
    expect(digest(compressed)).toBe(ABDOMINAL_ATLAS.sha256Gzip);
    expect(digest(raw)).toBe(ABDOMINAL_ATLAS.sha256Raw);
    expect(raw.byteLength).toBeLessThanOrEqual(96 * 1024 * 1024);
    expect(ABDOMINAL_FIELDS.map((f) => f.name)).toEqual([
      'pancreas',
      'digestiveTract',
      'bladder',
      'spleen',
      'liver',
      'kidneyRight',
      'kidneyLeft',
      'gallbladder',
      'lumbarSacralBone',
      'psoas',
      'lumbarDiscs',
    ]);
    for (let k = 0; k < ABDOMINAL_FIELDS.length; k++) {
      const f = ABDOMINAL_FIELDS[k];
      let interior = 0;
      for (let x = 0; x < f.dimensions[0]; x += 5)
        for (let y = 0; y < f.dimensions[1]; y += 5)
          for (let z = 0; z < f.dimensions[2]; z += 5) {
            const p = f.originMm.map((v, i) => v + [x, y, z][i] * f.pitchMm) as [number, number, number];
            if (abdominalAtlasSdf(p, k) < -1.5) interior++;
          }
      expect(interior, f.name).toBeGreaterThan(20);
    }
  });
  it('places both kidneys posteriorly, left above right, and keeps posterior supports outside their parenchyma', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    expect(scene.kidneyRight.center[1]).toBeLessThan(-25);
    expect(scene.kidneyLeft.center[1]).toBeLessThan(-25);
    expect(scene.kidneyLeft.center[2] - scene.kidneyRight.center[2]).toBeGreaterThan(10);
    for (const [field, kidney] of [
      [5, scene.kidneyRight],
      [6, scene.kidneyLeft],
    ] as const) {
      const f = ABDOMINAL_FIELDS[field];
      let count = 0;
      for (let x = 0; x < f.dimensions[0]; x += 3)
        for (let y = 0; y < f.dimensions[1]; y += 3)
          for (let z = 0; z < f.dimensions[2]; z += 3) {
            const p = f.originMm.map((v, i) => v + [x, y, z][i] * 1.5) as [number, number, number];
            if (abdominalAtlasSdf(p, field) > -1.5) continue;
            count++;
            expect(abdominalAtlasSdf(p, 8)).toBeGreaterThanOrEqual(-1.5);
            expect(abdominalAtlasSdf(p, 9)).toBeGreaterThanOrEqual(-1.5);
          }
      expect(count).toBeGreaterThan(500);
      expect(kidney.u[2]).toBeGreaterThan(0.9);
    }
  });
  it('renders bladder lumen as fluid and gives all named vessels real geometry', () => {
    const scene = new AnatomyScene(NORMAL_ADULT),
      f = ABDOMINAL_FIELDS[2];
    let fluid = 0,
      wall = 0,
      bone = 0;
    for (let x = 0; x < f.dimensions[0]; x += 3)
      for (let y = 0; y < f.dimensions[1]; y += 3)
        for (let z = 0; z < f.dimensions[2]; z += 3) {
          const p = f.originMm.map((v, i) => v + [x, y, z][i] * 1.5) as [number, number, number];
          if (abdominalAtlasSdf(p, 2) > -1.5) continue;
          const t = scene.classify(p, BASELINE_CALIBER).tissue;
          fluid += Number(t === Tissue.Fluid);
          wall += Number(t === Tissue.BladderWall);
          bone += Number(t === Tissue.Vertebra || t === Tissue.Bone);
        }
    expect(fluid).toBeGreaterThan(500);
    expect(wall).toBeGreaterThan(20);
    expect(bone).toBe(0);
    const ids = new Set(scene.vessels.map((v) => v.id));
    for (const id of VESSEL_IDS) expect(ids.has(id), id).toBe(true);
    expect(scene.vessels.length + scene.ducts.length).toBeLessThanOrEqual(128);
  });
  it('keeps all digestive regions, the pancreas behind the stomach and the bladder in the midline pelvis', () => {
    const centres = new Map<number, { sum: number[]; count: number }>();
    const f = ABDOMINAL_FIELDS[1];
    for (let x = 0; x < f.dimensions[0]; x += 3)
      for (let y = 0; y < f.dimensions[1]; y += 3)
        for (let z = 0; z < f.dimensions[2]; z += 3) {
          const p = f.originMm.map((v, i) => v + [x, y, z][i] * 1.5) as [number, number, number];
          const q = abdominalAtlasValue(p, 1);
          if (q.d >= -1.5) continue;
          const c = centres.get(q.label) ?? { sum: [0, 0, 0], count: 0 };
          c.count++;
          p.forEach((v, i) => (c.sum[i] += v));
          centres.set(q.label, c);
        }
    for (let label = 1; label <= 9; label++) expect(centres.get(label)?.count ?? 0, `digestive region ${label}`).toBeGreaterThan(20);
    const stomach = centres.get(1)!;
    // Independent anatomical relations, not an assertion that this surface atlas is a complete clinical segmentation.
    expect(stomach.sum[0] / stomach.count).toBeGreaterThan(0);
    expect(stomach.sum[1] / stomach.count).toBeGreaterThan(6.4);
    expect(abdominalAtlasSdf([-33, 1.5, -118.5], 0)).toBeLessThan(-5);
    expect(abdominalAtlasSdf([-10.5, -40.5, -354], 2)).toBeLessThan(-10);
    expect(abdominalAtlasSdf([109, -39, -82.5], 3)).toBeLessThan(-10);
  });
  it('keeps arterial and venous centre lines out of the digestive lumen', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    for (const v of scene.vessels)
      for (let i = 0; i + 1 < v.tube.nodes.length; i++) {
        const a = v.tube.nodes[i].p,
          b = v.tube.nodes[i + 1].p;
        const steps = Math.ceil(Math.hypot(...b.map((x, k) => x - a[k])) / 2);
        for (let j = 0; j < steps; j++) {
          const p = a.map((x, k) => x + ((b[k] - x) * j) / steps) as [number, number, number];
          expect(abdominalAtlasSdf(p, 1), v.id).toBeGreaterThanOrEqual(-4);
        }
      }
  });
  it('rejects a changed physical body profile during venous acquisition', () => {
    const scene = new AnatomyScene(NORMAL_ADULT),
      anatomy = new AnatomyQuery(scene);
    const engine = new PhysiologyEngine(NORMAL_ADULT, scene.vesselAreas());
    const changed = new Float32Array(profile.buffer.slice(profile.byteOffset, profile.byteOffset + profile.byteLength));
    changed[1] += 0.5;
    setAbdominalBody(changed);
    expect(() => new VenousSpectralAcquisition(anatomy, engine.sample, 47, NORMAL_ADULT, DEFAULT_BMODE)).toThrow('reference body changed');
  });
  it('rejects damaged compressed data and oversized decompression before using it', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(new Uint8Array([1, 2, 3]))));
    await expect(loadPinnedGzip(new URL('http://localhost/field'), ABDOMINAL_ATLAS)).rejects.toThrow('alterado');
    await expect(loadPinnedGzip(new URL('http://localhost/field'), { ...ABDOMINAL_ATLAS, rawBytes: 97 * 1024 * 1024 })).rejects.toThrow(
      'límite',
    );
  });
});
