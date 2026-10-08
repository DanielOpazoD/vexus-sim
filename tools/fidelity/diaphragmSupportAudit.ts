/** Trace visible material protrusions to shared diaphragm fields. No anatomy change. */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { AnatomyScene, BASELINE_CALIBER } from '../../src/anatomy/scene';
import { setAbdominalAtlas, abdominalAtlasSdf, hepaticDomeValue } from '../../src/anatomy/abdominalAtlas';
import { setThoracicAtlas } from '../../src/anatomy/thoracicAtlas';
import { setAbdominalBody } from '../../src/anatomy/referenceBody';
import { diaphragmHeight, diaphragmSurfaceZ, sdDiaphragmSlope } from '../../src/anatomy/primitives';
import { Tissue } from '../../src/anatomy/tissues';
import { NORMAL_ADULT } from '../../src/cases';
import type { Vec3 } from '../../src/core/vec3';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('INPUT.json OUTPUT.json');
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const sources: Record<string, string> = {};
for (const [name, setter] of [
  ['abdominal-atlas.gzip.bin', setAbdominalAtlas],
  ['thoracic-atlas.gzip.bin', setThoracicAtlas],
] as const) {
  const packed = readFileSync('src/anatomy/' + name),
    raw = gunzipSync(packed);
  sources[name] = hash(packed);
  setter(new Uint16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
}
const body = readFileSync('src/anatomy/abdominal-body.bin');
setAbdominalBody(new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)));
const scene = new AnatomyScene(NORMAL_ADULT),
  withoutContact = { ...scene.diaphragm, hepaticContact: false };
const data = readFileSync(input),
  bank = JSON.parse(data.toString()) as { records: Array<{ plane: string; pointMm: Vec3 }> };
const witnesses = bank.records.map((r) => {
  const p = r.pointMm,
    [contactHeight, support] = hepaticDomeValue(p[0], p[1]),
    height = diaphragmHeight(p[0], p[1], scene.diaphragm, scene.torso),
    oldHeight = diaphragmHeight(p[0], p[1], withoutContact, scene.torso),
    [distance, slope] = sdDiaphragmSlope(p, scene.diaphragm, scene.torso);
  return {
    ...r,
    tissue: Tissue[scene.classify(p, BASELINE_CALIBER, false).tissue],
    contactHeightMm: contactHeight,
    support,
    currentHeightMm: height,
    withoutContactHeightMm: oldHeight,
    diaphragmDistanceBoundMm: distance,
    slope,
    liverSdfMm: abdominalAtlasSdf(p, 4),
  };
});
const profiles = [];
for (const [id, axis, fixed, min, max] of [
  ['coronal', 0, -45, -130, 130],
  ['sagittal-right', 1, -52.5, -145, 100],
  ['sagittal-left', 1, 51, -145, 100],
] as const) {
  const values = [];
  for (let u = min; u <= max; u += 1) {
    const x = axis === 0 ? u : fixed,
      y = axis === 0 ? fixed : u;
    const [contactHeight, support] = hepaticDomeValue(x, y);
    const h = diaphragmHeight(x, y, scene.diaphragm, scene.torso);
    let zero: number | null = null,
      error: string | null = null;
    try {
      zero = diaphragmSurfaceZ(x, y, scene.diaphragm, scene.torso);
    } catch (e) {
      error = String(e);
    }
    let roof: number | null = null;
    for (let z = 75; z >= -90; z -= 1.5) {
      if (abdominalAtlasSdf([x, y, z], 4) >= 0) continue;
      let lo = z,
        hi = z + 1.5;
      for (let j = 0; j < 20; j++) {
        const mid = (lo + hi) / 2;
        if (abdominalAtlasSdf([x, y, mid], 4) < 0) lo = mid;
        else hi = mid;
      }
      roof = (lo + hi) / 2;
      break;
    }
    values.push({
      u,
      x,
      y,
      contactHeightMm: contactHeight,
      support,
      heightMm: h,
      withoutContactHeightMm: diaphragmHeight(x, y, withoutContact, scene.torso),
      surfaceZeroMm: zero,
      surfaceError: error,
      liverRoofMm: roof,
    });
  }
  profiles.push({ id, axis, fixed, values });
}
writeFileSync(
  output,
  JSON.stringify(
    {
      sources,
      inputSha256: hash(data),
      instrumentSha256: hash(readFileSync('tools/fidelity/diaphragmSupportAudit.ts')),
      witnesses,
      profiles,
      runtimeChanged: true,
      clinicalValidation: false,
      meaning:
        'Shared material classifier and registered contact-table trace. Legacy/contact fields are estimated; profiles do not prove anatomical diaphragm shape.',
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({
    witnesses: witnesses.length,
    tissues: [...new Set(witnesses.map((r) => r.tissue))],
    profiles: profiles.length,
    zeroErrors: profiles.reduce((n, p) => n + p.values.filter((v) => v.surfaceError).length, 0),
  }),
);
