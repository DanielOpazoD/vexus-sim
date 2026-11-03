/** Auditoría P0 offline, adaptada de posteriorFeasibility.ts@aa6e492.
 * Exporta el modelo real sin cambiar sus activos. El candidato sólo vive fuera de Git. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { AnatomyQuery } from '../../src/anatomy/query';
import { PhysiologyEngine } from '../../src/physiology/engine';
import { AnatomyScene } from '../../src/anatomy/scene';
import { setAbdominalAtlas } from '../../src/anatomy/abdominalAtlas';
import { setThoracicAtlas } from '../../src/anatomy/thoracicAtlas';
import { setAbdominalBody } from '../../src/anatomy/referenceBody';
import { ABDOMINAL_ATLAS, ABDOMINAL_FIELDS } from '../../src/anatomy/abdominalAtlasData';
import { Tissue } from '../../src/anatomy/tissues';
import { NORMAL_ADULT } from '../../src/cases';
import { startPointsFor } from '../../src/app/startPoints';
import { CONVEX_C35, probeFrame } from '../../src/probe/probe';
import type { Vec3 } from '../../src/core/vec3';

const save = (out: string, file: string, value: unknown) => writeFileSync(resolve(out, file), JSON.stringify(value, null, 2) + '\n');
function floats(file: string): Float32Array {
  const b = readFileSync(file);
  if (b.byteLength % 4) throw new Error('Float32 truncado');
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
function sceneWithAssets(): AnatomyScene {
  for (const [file, setter] of [
    ['abdominal-atlas.gzip.bin', setAbdominalAtlas],
    ['thoracic-atlas.gzip.bin', setThoracicAtlas],
  ] as const) {
    const raw = gunzipSync(readFileSync(`src/anatomy/${file}`));
    setter(new Uint16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
  }
  setAbdominalBody(floats('src/anatomy/abdominal-body.bin'));
  return new AnatomyScene({ ...NORMAL_ADULT, respiratoryPattern: 'apnea-expiratory' });
}
export function exportModel(out: string): void {
  mkdirSync(out, { recursive: true });
  const scene = sceneWithAssets();
  save(out, 'model.json', {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    atlas: ABDOMINAL_ATLAS,
    fields: ABDOMINAL_FIELDS,
    tubes: scene.vessels.length + scene.ducts.length,
    nodes: [...scene.vessels, ...scene.ducts].reduce((sum, v) => sum + v.tube.nodes.length, 0),
    person: 'current atlas, comparator only; no donor geometry copied into s0028',
  });
  const query = new AnatomyQuery(scene);
  const engine = new PhysiologyEngine({ ...NORMAL_ADULT, respiratoryPattern: 'apnea-expiratory' }, scene.vesselAreas());
  for (let i = 0; i < Math.round(2 / engine.clock.dt); i++) engine.step();
  const caliber = query.caliberFor(engine.sample);
  const planes = startPointsFor(scene.torso).map((sp) => {
    const frame = probeFrame({ ...sp, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0, lift: 0 }, scene.torso, CONVEX_C35);
    return { id: sp.id, phi: sp.phi, z: sp.z, ...frame, width: 181, height: 221, u0: -135, r0: -60, pitchMm: 1.5 };
  });
  const orthogonals: Array<{
    id: string;
    face: Vec3;
    lateral: Vec3;
    axial: Vec3;
    width: number;
    height: number;
    u0: number;
    r0: number;
    pitchMm: number;
  }> = [
    {
      id: 'common-axial',
      face: [0, 0, -100],
      lateral: [1, 0, 0],
      axial: [0, 1, 0],
      width: 281,
      height: 221,
      u0: -210,
      r0: -165,
      pitchMm: 1.5,
    },
    {
      id: 'common-coronal',
      face: [0, 0, 0],
      lateral: [1, 0, 0],
      axial: [0, 0, 1],
      width: 281,
      height: 348,
      u0: -210,
      r0: -400,
      pitchMm: 1.5,
    },
    {
      id: 'common-sagittal',
      face: [-50, 0, 0],
      lateral: [0, 1, 0],
      axial: [0, 0, 1],
      width: 221,
      height: 348,
      u0: -165,
      r0: -400,
      pitchMm: 1.5,
    },
  ];
  for (const plane of [...planes.map((p) => ({ ...p, face: p.face, lateral: p.lateral, axial: p.axial })), ...orthogonals]) {
    const data = new Uint8Array(plane.width * plane.height);
    for (let j = 0; j < plane.height; j++)
      for (let i = 0; i < plane.width; i++) {
        const u = plane.u0 + i * 1.5,
          r = plane.r0 + j * 1.5;
        const p: Vec3 = [0, 0, 0];
        for (let d = 0; d < 3; d++) p[d] = plane.face[d] + u * plane.lateral[d] + r * plane.axial[d];
        data[j * plane.width + i] = scene.classify(p, caliber).tissue;
      }
    writeFileSync(resolve(out, `plane-${plane.id}.u8`), data);
  }
  save(out, 'planes.json', {
    planes: [...planes, ...orthogonals],
    tissueNames: Object.fromEntries(Object.entries(Tissue).filter(([k]) => /^\d+$/.test(k))),
    fixedOldPoses: true,
    meaning: 'Common physical planes; no reacquisition or s0028 acceptance',
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) throw new Error('Indicar salida externa para planos y huellas');
  exportModel(resolve(out));
}
