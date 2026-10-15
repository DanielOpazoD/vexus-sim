import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { setAbdominalBody } from '../anatomy/referenceBody';
import { setThoracicAtlas } from '../anatomy/thoracicAtlas';
import { AnatomyScene } from '../anatomy/scene';
import { AnatomyQuery } from '../anatomy/query';
import { Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import type { Vec3 } from '../core/vec3';
import { PhysiologyEngine } from '../physiology/engine';
import { startPointsFor } from '../app/startPoints';
import { probeContact, contactCoupling } from '../probe/contact';
import { CONVEX_C35, pointOnLine } from '../probe/probe';

beforeAll(() => {
  for (const [file, set] of [
    ['abdominal-atlas.gzip.bin', setAbdominalAtlas],
    ['thoracic-atlas.gzip.bin', setThoracicAtlas],
  ] as const) {
    const b = gunzipSync(readFileSync('src/anatomy/' + file));
    set(new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  }
  const b = readFileSync('src/anatomy/abdominal-body.bin');
  setAbdominalBody(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
});
afterAll(() => {
  setAbdominalAtlas();
  setAbdominalBody();
  setThoracicAtlas();
});
const dot = (a: Vec3, b: Vec3) => a.reduce((s, v, i) => s + v * b[i], 0);
const sub = (a: Vec3, b: Vec3) => a.map((v, i) => v - b[i]) as Vec3;

for (const base of [NORMAL_ADULT, SEVERE_CONGESTION])
  it(`${base.id}: acquires posterior aorta and cava through liver, retaining vertebral shadow`, () => {
    const patient = { ...base, respiratoryPattern: 'apnea-expiratory' as const };
    const scene = new AnatomyScene(patient),
      query = new AnatomyQuery(scene),
      engine = new PhysiologyEngine(patient, scene.vesselAreas());
    const sample = engine.sample,
      sp = startPointsFor(scene.torso).find((p) => p.id === 'epigastric')!;
    const contact = probeContact({ ...sp, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0, lift: 0 }, CONVEX_C35, scene.torso),
      frame = contact.frame;
    query.setProbeCompression(contact);
    const targets = ['aorta', 'ivcInfra'].map((id) => {
      const nodes = scene.vesselById.get(id as 'aorta' | 'ivcInfra')!.tube.nodes.map((n) => query.deformation.toWorld(n.p, sample.resp));
      const crossings: { p: Vec3; r: number; theta: number }[] = [];
      for (let i = 1; i < nodes.length; i++) {
        const a = nodes[i - 1],
          b = nodes[i],
          da = dot(sub(a, frame.face), frame.elevation),
          db = dot(sub(b, frame.face), frame.elevation);
        if (da * db > 0 || Math.abs(da - db) < 1e-8) continue;
        const p = a.map((v, j) => v + (da / (da - db)) * (b[j] - v)) as Vec3,
          v = sub(p, frame.curvatureCenter);
        const r = Math.hypot(...v) - CONVEX_C35.curvatureRadius,
          theta = Math.atan2(dot(v, frame.lateral), dot(v, frame.axial));
        if (r > 20 && r < 175 && Math.abs(theta) < CONVEX_C35.halfSector) crossings.push({ p, r, theta });
      }
      expect(crossings, id).toHaveLength(1);
      const target = crossings[0];
      expect(query.classifyWorld(pointOnLine(frame, CONVEX_C35, target.theta, target.r), sample).vessel, id).toBe(id);
      const ray = Array.from(
        { length: Math.floor(target.r) },
        (_, i) => query.classifyWorld(pointOnLine(frame, CONVEX_C35, target.theta, i + 0.5), sample).tissue,
      );
      expect(ray, `${id}: barrier before the acquired lumen`).not.toContain(Tissue.BowelGas);
      for (const barrier of [Tissue.Bone, Tissue.Vertebra, Tissue.Cartilage, Tissue.Lung]) expect(ray, id).not.toContain(barrier);
      // Instrumental safeguard: excludes the original ray with no hepatic window; see contract.
      expect(ray.filter((t) => t === Tissue.Liver).length, id).toBeGreaterThan(20);
      expect(contactCoupling(contact, target.theta), id).toBeGreaterThan(0.95);
      return target;
    });
    expect(frame.lateral[0]).toBeLessThan(-0.95); // marker to the patient's right
    expect(targets[0].p[1]).toBeLessThan(targets[1].p[1]); // aorta posterior to cava
    const behindAorta = Array.from(
      { length: 55 },
      (_, i) => query.classifyWorld(pointOnLine(frame, CONVEX_C35, targets[0].theta, targets[0].r + 10 + i), sample).tissue,
    );
    expect(behindAorta.some((t) => t === Tissue.Bone || t === Tissue.Vertebra)).toBe(true);
  });
