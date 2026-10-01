import { readFileSync } from 'node:fs';
import { AnatomyScene, BASELINE_CALIBER } from '../../src/anatomy/scene';
import { bodyDepth, validateReferenceBody } from '../../src/anatomy/referenceBody';
import { Tissue } from '../../src/anatomy/tissues';
import { NORMAL_ADULT } from '../../src/cases';
const bytes = readFileSync('src/anatomy/reference-body.bin');
const profile = validateReferenceBody(new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
const scene = new AnatomyScene(NORMAL_ADULT);
const organs = new Set([Tissue.Liver, Tissue.RenalCortex, Tissue.RenalMedulla, Tissue.RenalSinus, Tissue.Blood, Tissue.Fluid]);
const report: Record<string, { points: number; outside: number; worstMm: number; worstPoint?: number[] }> = {};
for (let z = -160; z <= 120; z += 8)
  for (let y = -128; y <= 112; y += 8)
    for (let x = -160; x <= 160; x += 8) {
      const p: [number, number, number] = [x, y, z];
      const tissue = scene.classify(p, BASELINE_CALIBER).tissue;
      if (!organs.has(tissue)) continue;
      const row = (report[Tissue[tissue]] ??= { points: 0, outside: 0, worstMm: -Infinity });
      const depth = bodyDepth(p, profile);
      row.points++;
      if (depth > 0) row.outside++;
      if (depth > row.worstMm) {
        row.worstMm = depth;
        row.worstPoint = p;
      }
    }
console.log(
  JSON.stringify(
    {
      method:
        '8mm deterministic grid of baseline visible organ tissue vs new uncompressed skin; screening, not surface-distance or clinical validation',
      report,
    },
    null,
    2,
  ),
);
