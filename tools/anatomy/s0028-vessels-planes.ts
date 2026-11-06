/** Planos del menú s0028 y luces procedurales vigentes; comparador offline, sin instalar geometría nueva. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { installDefaultCpu } from '../../src/anatomy/people/default/cpu';
import { installS0028Cpu } from '../../src/anatomy/people/s0028/cpu';
import { S0028_BUNDLE } from '../../src/anatomy/people/s0028/descriptor';
import { AnatomyScene } from '../../src/anatomy/scene';
import { tubeQuery } from '../../src/anatomy/primitives';
import { kidneyLocal, kidneyOuterSdf } from '../../src/anatomy/organs/kidney';
import { startPointsFor } from '../../src/app/startPoints';
import { NORMAL_ADULT } from '../../src/cases';
import { CONVEX_C35, probeFrame } from '../../src/probe/probe';
import { VESSEL_META } from '../../src/physiology/vessels';
import type { Vec3 } from '../../src/core/vec3';

const out = resolve(process.argv[2] ?? '');
if (!process.argv[2] || out === resolve('.') || out.startsWith(resolve('.') + '/'))
  throw new Error('Indicar carpeta de evidencia fuera del repositorio');
mkdirSync(out, { recursive: true });
const current = process.argv.includes('--current');
const raw = (name: string) => new Uint8Array(gunzipSync(readFileSync(`src/anatomy/s0028/${name}.gzip.bin`))).buffer;
const body = new Float32Array(new Uint8Array(readFileSync('src/anatomy/abdominal-body.bin')).buffer);
const oldRaw = (name: string) => new Uint8Array(gunzipSync(readFileSync(`src/anatomy/${name}-atlas.gzip.bin`))).buffer;
const person = current
  ? installDefaultCpu({ abdominal: new Uint16Array(oldRaw('abdominal')), thoracic: new Uint16Array(oldRaw('thoracic')), body })
  : installS0028Cpu({
      abdominal: new Uint16Array(raw('abdominal-direct')),
      thoracic: new Uint16Array(raw('thoracic-direct')),
      capacity: raw('annotation-capacity'),
      skin: raw('skin-polar'),
      body,
    });
const scene = new AnatomyScene(NORMAL_ADULT, undefined, person);
const planes = startPointsFor(scene.torso, scene.identity).map((sp) => ({
  id: sp.id,
  label: sp.label,
  pose: { ...sp, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0, lift: 0 },
  frame: probeFrame({ ...sp, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0, lift: 0 }, scene.torso, CONVEX_C35),
  width: 301,
  height: 301,
  u0: -112.5,
  r0: -25,
  pitchMm: 0.75,
}));
const bits = { ivc: 1, aorta: 2, portal: 4, hepaticVein: 8, renalVein: 16, renalArtery: 32, other: 64 };
const hashes: Record<string, string> = {};
for (const plane of planes) {
  const data = new Uint16Array(plane.width * plane.height);
  const context = new Uint8Array(data.length);
  for (let j = 0; j < plane.height; j++)
    for (let i = 0; i < plane.width; i++) {
      const u = plane.u0 + i * plane.pitchMm,
        r = plane.r0 + j * plane.pitchMm;
      const p = plane.frame.face.map((v, k) => v + u * plane.frame.lateral[k] + r * plane.frame.axial[k]) as Vec3;
      let code = 0;
      for (let k = 0; k < scene.vessels.length; k++) {
        const bounds = scene.tubeBounds[k];
        if ((p[0] - bounds.center[0]) ** 2 + (p[1] - bounds.center[1]) ** 2 + (p[2] - bounds.center[2]) ** 2 > bounds.r ** 2) continue;
        const vessel = scene.vessels[k];
        if (tubeQuery(p, vessel.tube, 1).d < 0) {
          const system = VESSEL_META[vessel.id].system;
          code |= system in bits ? bits[system as keyof typeof bits] : bits.other;
        }
      }
      data[j * plane.width + i] = code;
      if (current) {
        context[j * plane.width + i] =
          (scene.liverSdf(p) < 0 ? 1 : 0) |
          (kidneyOuterSdf(kidneyLocal(p, scene.kidneyRight), scene.kidneyRight) < 0 ? 2 : 0) |
          (kidneyOuterSdf(kidneyLocal(p, scene.kidneyLeft), scene.kidneyLeft) < 0 ? 4 : 0);
      }
    }
  // Escribir endianness explícito; el contrato no depende del host del exportador.
  const buffer = Buffer.alloc(data.length * 2);
  data.forEach((v, i) => buffer.writeUInt16LE(v, i * 2));
  const filename = `procedural-${plane.id}.u16`;
  writeFileSync(resolve(out, filename), buffer);
  hashes[filename] = createHash('sha256').update(buffer).digest('hex');
  if (current) {
    const contextFile = `context-${plane.id}.u8`;
    writeFileSync(resolve(out, contextFile), context);
    hashes[contextFile] = createHash('sha256').update(context).digest('hex');
  }
  console.log(`${plane.id}: ${data.filter((v) => v !== 0).length} píxeles con luz procedural`);
}
const provenance = Object.fromEntries(
  [
    'src/app/startPoints.ts',
    'src/anatomy/vesselTree.ts',
    'src/anatomy/primitives.ts',
    'src/anatomy/abdominalVessels.ts',
    'src/probe/probe.ts',
  ].map((path) => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]),
);
writeFileSync(
  resolve(out, 'planes.json'),
  JSON.stringify(
    {
      head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      frameId: scene.identity.frameId,
      person: scene.identity.person,
      ctSha256: current ? null : S0028_BUNDLE.ctSha256,
      planes,
      bits,
      hashes,
      sourceHashes: provenance,
      comparator: 'scene.vessels/tubeQuery de main, radios de referencia escala 1; plano material sin respiración ni compresión',
      acquisition: `Poses intactas de startPointsFor(${scene.identity.person}); rectángulo del plano, no sector ni imagen ecográfica`,
      vessels: scene.vessels,
    },
    null,
    2,
  ) + '\n',
);
