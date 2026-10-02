import { readFileSync } from 'node:fs';
import { AnatomyScene } from '../../src/anatomy/scene';
import { AnatomyQuery } from '../../src/anatomy/query';
import { setReferenceBody } from '../../src/anatomy/referenceBody';
import { sdRib } from '../../src/anatomy/primitives';
import { Tissue } from '../../src/anatomy/tissues';
import { NORMAL_ADULT } from '../../src/cases';
import { START_POINTS } from '../../src/app/startPoints';
import { dot, length, sub } from '../../src/core/vec3';
import { PhysiologyEngine } from '../../src/physiology/engine';
import { probeContact, contactCoupling } from '../../src/probe/contact';
import { CONVEX_C35, pointOnLine } from '../../src/probe/probe';
const bytes = readFileSync('src/anatomy/reference-body.bin');
const rows = [];
for (const reference of [false, true]) {
  setReferenceBody(reference ? new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) : undefined);
  const scene = new AnatomyScene(NORMAL_ADULT),
    anatomy = new AnatomyQuery(scene);
  const engine = new PhysiologyEngine({ ...NORMAL_ADULT, respiratoryPattern: 'apnea-expiratory' }, scene.vesselAreas());
  for (let i = 0; i < Math.round(2 / engine.clock.dt); i++) engine.step();
  const sample = engine.sample;
  for (const id of ['subxiphoid', 'flank', 'renal']) {
    const sp = START_POINTS.find((p) => p.id === id)!;
    const pose = { phi: sp.phi, z: sp.z, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0, lift: 0 };
    const k = probeContact(pose, CONVEX_C35, scene.torso);
    anatomy.setProbeCompression(k);
    const vessels = scene.vessels.filter((v) => (id === 'renal' ? v.id.startsWith('interlobarVein') : v.id.startsWith('ivc')));
    const targets = vessels.flatMap((v) =>
      v.tube.nodes
        .filter((n) => n.p[2] > -120)
        .map((n) => {
          const d = sub(n.p, k.frame.curvatureCenter),
            theta = Math.atan2(dot(d, k.frame.lateral), dot(d, k.frame.axial)),
            r = length(d) - CONVEX_C35.curvatureRadius;
          const blocked = [];
          for (let rr = 1; rr < r; rr += 1) {
            const p = pointOnLine(k.frame, CONVEX_C35, theta, rr),
              q = anatomy.classifyWorld(p, sample);
            if (q.tissue === Tissue.Bone || q.tissue === Tissue.Vertebra || q.tissue === Tissue.Lung) {
              const m = anatomy.deformation.toMaterial(p, sample.resp);
              const distances = scene.ribs.map((rib) => sdRib(m, rib, scene.torso, scene.spine).d);
              blocked.push({
                r: rr,
                tissue: Tissue[q.tissue],
                rib: q.tissue === Tissue.Bone ? distances.indexOf(Math.min(...distances)) + 5 : null,
              });
            }
          }
          return { vessel: v.id, p: n.p, planeOffsetMm: dot(d, k.frame.elevation), r, theta, coupling: contactCoupling(k, theta), blocked };
        }),
    );
    rows.push({ reference, id, pose, frame: k.frame, targets });
  }
}
console.log(
  JSON.stringify(
    {
      method:
        'fixed UI poses, actual contact frames, atlas field toggle only; centerline projection and 1mm ray steps, same expiratory physiology',
      rows,
    },
    null,
    2,
  ),
);
