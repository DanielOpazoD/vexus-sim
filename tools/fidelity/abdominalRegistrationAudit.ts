/** Spatial audit in mm/LAS; sampled clearances are not certified global minima. */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { AnatomyScene } from '../../src/anatomy/scene';
import { setReferenceBody } from '../../src/anatomy/referenceBody';
import { kidneyWorld, kidneyOuterSdf, perirenalOuterSdf } from '../../src/anatomy/organs/kidney';
import { retroFrontY, psoasSdf } from '../../src/anatomy/organs/retroperitoneum';
import { torsoDepth } from '../../src/anatomy/primitives';
import { NORMAL_ADULT } from '../../src/cases';
import type { Vec3 } from '../../src/core/vec3';

export function abdominalRegistrationAudit(scene: AnatomyScene) {
  const offset = scene.spine.y0 + 46;
  return {
    frame: 'mm/LAS: left, anterior, superior',
    spine: scene.spine,
    kidneys: [scene.kidneyRight, scene.kidneyLeft].map((k) => {
      let wall = Infinity,
        front = Infinity,
        posterior = Infinity,
        periOutside = 0,
        psoas = Infinity;
      const samples: Vec3[] = [];
      for (let i = 0; i < 20; i++)
        for (let j = 0; j < 40; j++) {
          const th = Math.acos(1 - (2 * (i + 0.5)) / 20),
            ph = (2 * Math.PI * j) / 40;
          const dir: Vec3 = [Math.cos(th), Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph)];
          let lo = 0,
            hi = 90;
          for (let n = 0; n < 32; n++) {
            const mid = (lo + hi) / 2,
              q = dir.map((v) => v * mid) as Vec3;
            if (kidneyOuterSdf(q, k) < 0) lo = mid;
            else hi = mid;
          }
          const p = kidneyWorld(dir.map((v) => v * hi) as Vec3, k);
          samples.push(p);
          wall = Math.min(wall, -torsoDepth(p, scene.torso) - scene.wallThickness());
          if (p[1] > retroFrontY(Math.abs(p[0]), p[2]) + offset) periOutside++;
          psoas = Math.min(psoas, psoasSdf([p[0], p[1] - offset, p[2]]));
        }
      for (let y = -250; y <= 250; y += 0.25) {
        if (torsoDepth([k.center[0], y, k.center[2]], scene.torso) > 0) continue;
        posterior = Math.min(posterior, y);
        front = Math.min(front, -y);
      }
      const extents = [0, 1, 2].map((axis) => [Math.min(...samples.map((p) => p[axis])), Math.max(...samples.map((p) => p[axis]))]);
      return {
        center: k.center,
        capsuleBoundsMm: extents,
        sampledWallClearanceMm: wall,
        anteriorSkinGapMm: -front - extents[1][1],
        posteriorSkinGapMm: extents[1][0] - posterior,
        renalCenterAnteriorToSpineMm: k.center[1] - scene.spine.y0,
        capsuleSamplesAheadOfPosteriorPeritoneum: periOutside,
        sampledPsoasClearanceMm: psoas,
        perirenalSdfAtCenter: perirenalOuterSdf([0, 0, 0], k),
        samples: samples.length,
      };
    }),
    organs: {
      liver: {
        right: scene.liver,
        left: scene.liverLeft,
        clippedBy: 'diaphragm, abdominal wall, vertebral envelope, renal impression, gallbladder fossa',
      },
      gallbladder: scene.gallbladder,
      vessels: scene.vessels
        .filter((v) => ['aorta', 'ivcInfra', 'renalArteryRight', 'renalVeinRight', 'renalArteryLeft', 'renalVeinLeft'].includes(v.id))
        .map((v) => ({ id: v.id, nodes: v.tube.nodes })),
      missingSeparateGeometry: ['spleen', 'pancreas', 'stomach', 'adrenals', 'duodenum', 'colon'],
    },
    limitations:
      'Adult estimated geometry; axis extents and 800 capsule samples per kidney, not clinical validation or certified clearance.',
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const bytes = readFileSync('src/anatomy/reference-body.bin');
  const profile = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const results = [false, true].map((reference) => {
    setReferenceBody(reference ? profile : undefined);
    return { reference, ...abdominalRegistrationAudit(new AnatomyScene(NORMAL_ADULT)) };
  });
  setReferenceBody();
  if (!process.argv[2]) throw new Error('Supply an output JSON path');
  writeFileSync(process.argv[2], JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.map(({ reference, kidneys }) => ({ reference, kidneys }))));
}
