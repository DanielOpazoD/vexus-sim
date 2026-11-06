import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, expect, it } from 'vitest';
import { startPointsFor } from '../app/startPoints';
import { NORMAL_ADULT } from '../cases';
import { CONVEX_C35, pointOnLine, probeFrame } from '../probe/probe';
import { beamToPixel, sectorLayout } from '../ultrasound/sectorGeometry';
import { setAbdominalAtlas } from './support/legacyPerson/abdominalAtlas';
import { setAbdominalBody } from './support/legacyPerson/referenceBody';
import { AnatomyScene } from './support/legacyPerson/scene';

afterEach(() => {
  setAbdominalAtlas();
  setAbdominalBody();
});
it('uses cranial longitudinal, posterior intercostal and right-patient transverse markers; preserves mirrored-plane geometry', () => {
  const raw = gunzipSync(readFileSync('src/anatomy/abdominal-atlas.gzip.bin')),
    body = readFileSync('src/anatomy/abdominal-body.bin');
  setAbdominalAtlas(new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2));
  setAbdominalBody(new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)));
  const torso = new AnatomyScene(NORMAL_ADULT).torso,
    points = startPointsFor(torso, { person: 'current' });
  for (const p of points) {
    const fr = probeFrame({ ...p, lift: 0, rock: p.rock ?? 0, tilt: p.tilt ?? 0 }, torso, CONVEX_C35);
    if (p.id === 'epigastric') expect(fr.lateral[0]).toBeLessThan(-0.9);
    else if (p.id === 'intercostal' || p.id === 'portal')
      expect(fr.lateral[1], 'oblique intercostal marker toward the posterior axilla (ACEP)').toBeLessThan(-0.5);
    else expect(fr.lateral[2], p.id).toBeGreaterThan(0.5);
  }
  // Preserve the previous 20-ray mirrored-plane regression independently of the new default acquisition.
  const p = {
    ...points.find((p) => p.id === 'portal')!,
    phi: 3.25,
    z: -65,
    yaw: -0.3083879194167607,
    rock: -0.2122189996791038,
    tilt: 0.0937442490667998,
  };
  const selected = points.find((p) => p.id === 'portal')!;
  expect(selected.phi).toBe((173 * Math.PI) / 180);
  expect(selected.z).toBe(-40);
  expect(selected.yaw).toBe((-72 * Math.PI) / 180);
  expect(selected.tilt).toBe((-2 * Math.PI) / 180);
  expect(selected.rock).toBe((-6 * Math.PI) / 180);
  const now = probeFrame({ ...p, lift: 0, rock: p.rock, tilt: p.tilt }, torso, CONVEX_C35),
    old = probeFrame({ ...p, lift: 0, yaw: 2.8332047341730324, rock: 0.2122189996791038, tilt: -0.0937442490667998 }, torso, CONVEX_C35);
  for (const theta of [-0.55, -0.3, 0, 0.3, 0.55])
    for (const r of [0, 50, 100, 130]) {
      const a = pointOnLine(old, CONVEX_C35, theta, r),
        b = pointOnLine(now, CONVEX_C35, -theta, r);
      expect(Math.hypot(...a.map((v, i) => v - b[i]))).toBeLessThan(1e-9);
    }
  const layout = sectorLayout(800, 600, CONVEX_C35, 130, 10);
  expect(beamToPixel(layout, CONVEX_C35, 0.3, 100).x).toBeLessThan(beamToPixel(layout, CONVEX_C35, -0.3, 100).x);
});
