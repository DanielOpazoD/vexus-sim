import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { AnatomyScene } from '../../src/anatomy/scene';
import { NORMAL_ADULT } from '../../src/cases';
import { ribCentre, ribShape, sdRib } from '../../src/anatomy/primitives';
import { STERNUM, sternumHalfWidth, sternumSd } from '../../src/anatomy/organs/sternum';
import { setReferenceBody } from '../../src/anatomy/referenceBody';
import type { Vec3 } from '../../src/core/vec3';
import { signedContactSamples } from './signed-contact';
import { organSignedFields } from './organ-fields';

const destination = process.argv[2];
if (!destination || existsSync(destination)) throw new Error('Indique una salida nueva; no se sobrescribe evidencia');
const bytes = readFileSync('src/anatomy/reference-body.bin');
const profile = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const reports = [];
for (const reference of [false, true]) {
  setReferenceBody(reference ? profile : undefined);
  const scene = new AnatomyScene(NORMAL_ADULT);
  const groups: Record<string, Vec3[]> = { sternum: [], ribs: [] };
  let ribResidualMm = 0;
  for (const rib of scene.ribs) {
    const [ax, by, cy] = ribShape(rib, scene.torso);
    const start = rib.frontPhi ?? Math.PI / 2;
    for (let i = 1; i < 72; i++) {
      const phi = start + ((4.35 - start) * i) / 72;
      const centre = ribCentre(phi, rib, scene.torso);
      if (sdRib(centre, rib, scene.torso, scene.spine).cartilage) continue;
      const radial = Math.hypot(ax * Math.cos(phi), by * Math.sin(phi));
      for (let j = 0; j < 16; j++) {
        const theta = (2 * Math.PI * j) / 16;
        const f = 1 + (rib.halfThickness * Math.cos(theta)) / radial;
        for (const side of [-1, 1]) {
          const p: Vec3 = [side * centre[0] * f, cy + (centre[1] - cy) * f, centre[2] + rib.halfWidth * Math.sin(theta)];
          const residual = Math.abs(sdRib(p, rib, scene.torso, scene.spine).d);
          if (residual > 0.01) continue;
          ribResidualMm = Math.max(ribResidualMm, residual);
          groups.ribs.push(p);
        }
      }
    }
  }
  // Superficie lateral esternal: resolver torsoDepth mediante la raíz del mismo campo.
  let sternumResidualMm = 0;
  for (let z = STERNUM.zTipMm + 0.5; z < STERNUM.zTopMm; z += 2) {
    const x = sternumHalfWidth(z);
    for (let j = 0; j < 9; j++) {
      const radialOffset = STERNUM.thicknessMm * (j / 8 - 0.5);
      // En la cara lateral el campo vale |profundidad-centro|-semiespesor: el mínimo
      // plano es cero. Buscar la raíz anterior de la coordenada radial por separado.
      let lo = scene.torso.y0 ?? 0;
      let hi = (scene.torso.y0 ?? 0) + 300;
      const depth = (1 - STERNUM.ribScale) * scene.torso.b + radialOffset;
      for (let k = 0; k < 40; k++) {
        const y = (lo + hi) / 2;
        // El campo de profundidad se consulta independientemente de su clasificación.
        const inside = scene.insideWallMm([x, y, z]) + scene.wallThickness();
        if (inside > depth) lo = y;
        else hi = y;
      }
      for (const side of [-1, 1]) {
        const p: Vec3 = [side * x, (lo + hi) / 2, z];
        const residual = Math.abs(sternumSd(p, scene.torso));
        if (residual > 0.01) continue;
        sternumResidualMm = Math.max(sternumResidualMm, residual);
        groups.sternum.push(p);
      }
    }
  }
  const fields = organSignedFields(scene);
  reports.push({
    profile: reference ? 'reference' : 'procedural',
    materialFrame: 'mm; +x left, +y anterior, +z cranial; expiration, no probe compression',
    ownSurfaceResidualMm: { ribs: ribResidualMm, sternum: sternumResidualMm },
    contacts: Object.fromEntries(
      Object.entries(groups).map(([name, points]) => [
        name,
        Object.fromEntries(Object.entries(fields).map(([id, field]) => [id, signedContactSamples(points, field)])),
      ]),
    ),
  });
}
setReferenceBody(undefined);
const report = {
  baseSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceDigests: Object.fromEntries(
    [
      'src/anatomy/organs/sternum.ts',
      'src/anatomy/scene.ts',
      'tools/anatomy/local-contacts.ts',
      'tools/anatomy/organ-fields.ts',
      'tools/anatomy/signed-contact.ts',
    ].map((path) => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]),
  ),
  method:
    'Sampled bone/sterna surfaces against individual soft-tissue signed fields, prior to classification priority. Field residuals are not certified Euclidean distances. Source constraints and raw field overlaps remain distinguishable.',
  clinicalValidation: false,
  reports,
};
writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ destination, reports }, null, 2));
