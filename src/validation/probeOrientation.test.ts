import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, expect, it } from 'vitest';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { setAbdominalBody } from '../anatomy/referenceBody';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';
import { startPointsFor } from '../app/startPoints';
import { CONVEX_C35, probeFrame, pointOnLine } from '../probe/probe';
import { beamToPixel, sectorLayout } from '../ultrasound/sectorGeometry';

afterEach(() => {
  setAbdominalAtlas();
  setAbdominalBody();
});
it('uses cranial longitudinal/right-patient transverse markers with the same portal acoustic plane', () => {
  const raw = gunzipSync(readFileSync('src/anatomy/abdominal-atlas.gzip.bin')),
    body = readFileSync('src/anatomy/abdominal-body.bin');
  setAbdominalAtlas(new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2));
  setAbdominalBody(new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)));
  const torso = new AnatomyScene(NORMAL_ADULT).torso,
    points = startPointsFor(torso);
  for (const p of points) {
    const fr = probeFrame({ ...p, lift: 0, rock: p.rock ?? 0, tilt: p.tilt ?? 0 }, torso, CONVEX_C35);
    if (p.id === 'epigastric') expect(fr.lateral[0]).toBeLessThan(-0.9);
    else if (p.id === 'intercostal') expect(fr.lateral[2], 'oblique intercostal marker toward the axilla').toBeGreaterThan(0);
    else expect(fr.lateral[2], p.id).toBeGreaterThan(0.5);
  }
  const p = points.find((p) => p.id === 'portal')!;
  const now = probeFrame({ ...p, lift: 0, rock: p.rock!, tilt: p.tilt! }, torso, CONVEX_C35),
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
