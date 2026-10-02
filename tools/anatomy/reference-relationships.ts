import { readFileSync } from 'node:fs';
import { setReferenceBody } from '../../src/anatomy/referenceBody';
import { referenceCartilage } from '../../src/anatomy/referenceCartilage';
import { CARTILAGE_ROWS, CARTILAGE_X0, CARTILAGE_X1 } from '../../src/anatomy/referenceCartilageData';
import { AnatomyScene, BASELINE_CALIBER } from '../../src/anatomy/scene';
import { NORMAL_ADULT } from '../../src/cases';
import { ribCentre, ribShape, sdRib, torsoDepth } from '../../src/anatomy/primitives';
import { Tissue } from '../../src/anatomy/tissues';
import type { Vec3 } from '../../src/core/vec3';

const bytes = readFileSync('src/anatomy/reference-body.bin');
setReferenceBody(new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
const scene = new AnatomyScene(NORMAL_ADULT);
const ribs = scene.ribs.splice(0); // Query existing soft tissues independently of skeletal precedence.
const report: Record<
  string,
  { points: number; skinCrossings: number; skinMinDepthMm: number; softTissues: Record<string, number>; examples: Vec3[] }
> = {};
function tally(name: string, p: Vec3): void {
  const row = (report[name] ??= { points: 0, skinCrossings: 0, skinMinDepthMm: Infinity, softTissues: {}, examples: [] });
  const depth = -torsoDepth(p, scene.torso);
  row.points++;
  row.skinMinDepthMm = Math.min(row.skinMinDepthMm, depth);
  if (depth < 0) row.skinCrossings++;
  const tissue = scene.classify(p, BASELINE_CALIBER).tissue;
  row.softTissues[Tissue[tissue]] = (row.softTissues[Tissue[tissue]] ?? 0) + 1;
  if ([Tissue.Liver, Tissue.RenalCortex, Tissue.RenalMedulla, Tissue.Blood].includes(tissue) && row.examples.length < 4)
    row.examples.push(p);
}
ribs.forEach((rib, i) => {
  const [, , y0] = ribShape(rib, scene.torso);
  for (let j = 0; j < 360; j++) {
    const phi = Math.PI / 2 + (Math.PI * j) / 360;
    const [x, y, z] = ribCentre(phi, rib, scene.torso);
    const radius = Math.hypot(x, y - y0);
    for (let k = 0; k < 12; k++) {
      const angle = (2 * Math.PI * k) / 12;
      const scale = 1 + (rib.halfThickness * Math.cos(angle)) / radius;
      const p: Vec3 = [x * scale, y0 + (y - y0) * scale, z + rib.halfWidth * Math.sin(angle)];
      if (sdRib(p, { ...rib, sourceCartilage: false }, scene.torso, scene.spine).d > 0.01) continue;
      tally(`bone${i + 5}`, p);
      tally(`bone${i + 5}`, [-p[0], p[1], p[2]]);
    }
  }
});
for (let i = 1; i < 240; i++) {
  const u = (i / 240) * (CARTILAGE_ROWS.length - 1),
    k = Math.min(CARTILAGE_ROWS.length - 2, Math.floor(u));
  const a = CARTILAGE_ROWS[k],
    b = CARTILAGE_ROWS[k + 1];
  const q = a.map((v, j) => v + (b[j] - v) * (u - k));
  const x = CARTILAGE_X0 + ((CARTILAGE_X1 - CARTILAGE_X0) * i) / 240;
  for (let j = 0; j < 24; j++) {
    const angle = (2 * Math.PI * j) / 24;
    const p: Vec3 = [x, q[0] + q[2] * Math.cos(angle), q[1] + q[3] * Math.sin(angle)];
    if (Math.abs(referenceCartilage(p).d) > 0.01) throw new Error('Cartilage sample is not on the shared field');
    tally('cartilage7', p);
    tally('cartilage7', [-p[0], p[1], p[2]]);
  }
}
const costochondral = {
  samples: 0,
  minimumBoneSdfMm: Infinity,
  point: [0, 0, 0] as Vec3,
  method:
    'Dense samples of fitted seventh-cartilage volume against shared seventh-bone SDF; positive samples indicate unresolved separation, not exact global Euclidean distance',
};
for (let j = 0; j < 180; j++) {
  const u = (j / 179) * (CARTILAGE_ROWS.length - 1),
    k = Math.min(CARTILAGE_ROWS.length - 2, Math.floor(u)),
    f = u - k;
  const row = CARTILAGE_ROWS[k].map((v, a) => v + (CARTILAGE_ROWS[k + 1][a] - v) * f);
  const x = CARTILAGE_X0 + ((CARTILAGE_X1 - CARTILAGE_X0) * j) / 179;
  for (let t = 0; t < 36; t++)
    for (let h = 0; h <= 10; h++) {
      const phi = (2 * Math.PI * t) / 36,
        radius = h / 10;
      const p: Vec3 = [x, row[0] + row[2] * radius * Math.cos(phi), row[1] + row[3] * radius * Math.sin(phi)];
      const d = sdRib(p, { ...ribs[2], sourceCartilage: false }, scene.torso, scene.spine).d;
      costochondral.samples++;
      if (d < costochondral.minimumBoneSdfMm) {
        costochondral.minimumBoneSdfMm = d;
        costochondral.point = p;
      }
    }
}
console.log(
  JSON.stringify(
    {
      method:
        'Dense surfaces of the shared uncompressed skeletal field vs original soft-tissue classifier, ribs disabled only for this diagnostic; not signed separation or clinical validation',
      report,
      costochondral,
      protectedLandmarks: scene.vessels
        .filter((v) => ['ivcSupra', 'ivcInfra', 'aorta'].includes(v.id))
        .map((v) => ({ id: v.id, nodes: v.tube.nodes })),
    },
    null,
    2,
  ),
);
