/** Offline preset calibration against the model's fixed anatomical landmarks.
 * No runtime acquisition/measurement uses hidden truth. No organ/rib is displaced.
 * Candidate rays are rejected when the real compressed anatomy contains bone or lung.
 */
import { readFileSync } from 'node:fs';
import { AnatomyScene } from '../../src/anatomy/scene';
import { AnatomyQuery } from '../../src/anatomy/query';
import { setReferenceBody } from '../../src/anatomy/referenceBody';
import { Tissue } from '../../src/anatomy/tissues';
import { NORMAL_ADULT } from '../../src/cases';
import { dot, sub, normalize, scale, length, type Vec3 } from '../../src/core/vec3';
import { probeFrame, CONVEX_C35, pointOnLine, type ProbePose } from '../../src/probe/probe';
import { probeContact, contactCoupling } from '../../src/probe/contact';
import { PhysiologyEngine } from '../../src/physiology/engine';
import { bestGateOnVessel } from '../../src/app/gatePlacement';
import { acousticWindowWeight, gateTransmission } from '../../src/app/gateTransmission';
import { CONVEX_C35_PROFILE } from '../../src/ultrasound/transducerProfile';
import type { VesselId } from '../../src/physiology/vessels';
const bytes = readFileSync('src/anatomy/reference-body.bin');
setReferenceBody(new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
const scene = new AnatomyScene(NORMAL_ADULT),
  anatomy = new AnatomyQuery(scene);
const engine = new PhysiologyEngine({ ...NORMAL_ADULT, respiratoryPattern: 'apnea-expiratory' }, scene.vesselAreas());
for (let i = 0; i < Math.round(2 / engine.clock.dt); i++) engine.step();
const sample = engine.sample;
function aimed(phi: number, z: number, pivot: Vec3, long: Vec3): ProbePose | null {
  const pose = { phi, z, lift: 0, yaw: 0, rock: 0, tilt: 0 };
  const f = probeFrame(pose, scene.torso, CONVEX_C35);
  const a = normalize(sub(pivot, f.face));
  const l = normalize(sub(long, scale(a, dot(a, long))));
  const rock = Math.asin(Math.max(-1, Math.min(1, -dot(l, f.axial))));
  const yaw = Math.atan2(-dot(l, f.elevation), dot(l, f.lateral));
  const afterRock = probeFrame({ ...pose, yaw, rock }, scene.torso, CONVEX_C35);
  const tilt = Math.atan2(-dot(a, afterRock.elevation), dot(a, afterRock.axial));
  if (Math.abs(rock) > 0.7 || Math.abs(tilt) > 0.7) return null;
  return { ...pose, yaw, rock, tilt };
}
interface Window {
  id: string;
  phi: [number, number];
  z: [number, number];
  pivot: Vec3;
  long: Vec3;
  points: Vec3[];
  vessels: VesselId[];
}
const windows: Window[] = [
  {
    id: 'subxiphoid',
    phi: [1.55, 1.9],
    z: [-65, -15],
    pivot: [-20, -8, 35],
    long: [0, 0, 1],
    points: [
      [-22.8, -16.5, -40],
      [-21.5, -14.9, -14],
      [-21, -11, 15],
      [-20, -8, 35],
      [-18.1, -3.2, 53],
      [-16.9, -0.6, 64],
    ],
    vessels: ['ivcSupra', 'ivcInfra'],
  },
  {
    id: 'epigastric',
    phi: [1.55, 1.65],
    z: [-35, -15],
    pivot: [-5, -18, -20],
    long: [-1, 0, 0],
    points: [
      [-22, -16, -20],
      [12, -24, -20],
    ],
    vessels: ['ivcInfra', 'aorta'],
  },
  {
    id: 'intercostal',
    phi: [2.65, 3.2],
    z: [-50, 25],
    pivot: [-60, -16, 15],
    long: [0.72, 0.1, 0.68],
    points: [
      [-105, -4, -28],
      [-68, -18, 10],
      [-38, -11, 32],
    ],
    vessels: ['hvRight'],
  },
  {
    id: 'subcostal',
    phi: [1.65, 2.05],
    z: [-85, -40],
    pivot: [-33.8, 17.1, -5.8],
    long: [0.1, -0.55, 0.83],
    points: [
      [-40, 24, -25],
      [-33.8, 17.1, -5.8],
      [-30, 5, 12],
      [-25, 5, 34],
    ],
    vessels: ['hvMiddle'],
  },
  {
    id: 'flank',
    phi: [2.9, 3.4],
    z: [-70, -15],
    pivot: [-21, -11, 15],
    long: [0, 0, 1],
    points: [
      [-22, -17, -64],
      [-21, -11, 15],
      [-18.1, -3.2, 53],
    ],
    vessels: ['ivcSupra', 'ivcInfra'],
  },
  {
    id: 'portal',
    phi: [3.2, 3.7],
    z: [-105, -45],
    pivot: [-19.25, 3, -69],
    long: [-31, -6, 55],
    points: [
      [-3, 6, -100],
      [-14, 4, -75],
      [-26, 2, -56],
      [-34, 0, -45],
    ],
    vessels: ['pvTrunk'],
  },
  {
    id: 'renal',
    phi: [3.2, 3.75],
    z: [-120, -60],
    pivot: scene.kidneyRight.center,
    long: scene.kidneyRight.u,
    points: [
      [-85, -35, -105],
      [-72, -38, -78],
      [-60, -40, -50],
    ],
    vessels: ['interlobarVein1', 'interlobarVein2', 'interlobarVein3'],
  },
];
const all = [];
for (const w of windows.filter((w) => !process.argv[2] || w.id === process.argv[2])) {
  const candidates = [];
  for (let phi = w.phi[0]; phi <= w.phi[1] + 1e-6; phi += 0.05)
    for (let z = w.z[0]; z <= w.z[1]; z += 5) {
      const pose = aimed(phi, z, w.pivot, w.long);
      if (!pose) continue;
      const contact = probeContact(pose, CONVEX_C35, scene.torso);
      anatomy.setProbeCompression(contact);
      let visible = 0,
        total = 0,
        score = 0;
      for (const p of w.points) {
        const d = sub(p, contact.frame.curvatureCenter),
          r = length(d) - CONVEX_C35.curvatureRadius;
        const theta = Math.atan2(dot(d, contact.frame.lateral), dot(d, contact.frame.axial));
        if (r < 20 || r > 180 || Math.abs(theta) > CONVEX_C35.halfSector || Math.abs(dot(d, contact.frame.elevation)) > 10) continue;
        total++;
        let blocked = false;
        for (let rr = 1; rr < r; rr += 2) {
          const tissue = anatomy.classifyWorld(pointOnLine(contact.frame, CONVEX_C35, theta, rr), sample).tissue;
          if (tissue === Tissue.Bone || tissue === Tissue.Vertebra || tissue === Tissue.Lung) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          visible++;
          score += contactCoupling(contact, theta) * Math.abs(dot(normalize(d), normalize(w.long)));
        }
      }
      if (visible) candidates.push({ pose, visible, total, score });
    }
  candidates.sort((a, b) => b.visible - a.visible || b.score - a.score);
  const evaluated = [];
  for (const c of candidates.slice(0, 6)) {
    const contact = probeContact(c.pose, CONVEX_C35, scene.torso);
    anatomy.setProbeCompression(contact);
    const gate = bestGateOnVessel(
      anatomy,
      contact.frame,
      CONVEX_C35,
      sample,
      w.vessels,
      175,
      1.2,
      acousticWindowWeight(anatomy, contact.frame, CONVEX_C35, contact, sample, 175, CONVEX_C35_PROFILE.dopplerEffectiveMHz),
    );
    const transmission = gate
      ? gateTransmission(anatomy, contact.frame, CONVEX_C35, contact, gate.theta, gate.r, sample, CONVEX_C35_PROFILE.dopplerEffectiveMHz)
      : 0;
    const angleDeg = gate ? (Math.acos(gate.cosAngle) * 180) / Math.PI : null;
    evaluated.push({ ...c, gate, transmission, angleDeg });
  }
  evaluated.sort((a, b) => b.transmission * (b.gate?.cosAngle ?? 0) - a.transmission * (a.gate?.cosAngle ?? 0));
  const row = { id: w.id, candidates: candidates.length, targets: w.points, best: evaluated.slice(0, 3) };
  all.push(row);
  console.error(w.id, JSON.stringify(row.best[0] ?? null));
}
console.log(
  JSON.stringify(
    {
      method:
        'offline landmark-guided search; bone/lung occlusion, real contact and acoustic gate; model geometry, not independent anatomical calibration',
      windows: all,
    },
    null,
    2,
  ),
);
