/** Métricas de imagen para QA, no índice diagnóstico: ROIs virtuales a profundidad emparejada. */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { AnatomyScene } from '../../src/anatomy/scene';
import { AnatomyQuery } from '../../src/anatomy/query';
import { setReferenceBody } from '../../src/anatomy/referenceBody';
import { NORMAL_ADULT } from '../../src/cases';
import { clonePatient } from '../../src/physiology/patientState';
import { PhysiologyEngine } from '../../src/physiology/engine';
import { Tissue } from '../../src/anatomy/tissues';
import { probeContact, contactCoupling } from '../../src/probe/contact';
import { CONVEX_C35, pointOnLine, type ProbePose } from '../../src/probe/probe';
import { pixelToBeam, sectorLayout } from '../../src/ultrasound/sectorGeometry';

export interface MatchedSample {
  tissue: 'liver' | 'cortex';
  depthMm: number;
  gray: number;
}
export function matchedBands(samples: readonly MatchedSample[], minimum = 30) {
  const bins = new Map<number, { liver: number[]; cortex: number[] }>();
  for (const s of samples) {
    if (!Number.isFinite(s.gray) || s.gray < 0 || s.gray > 255 || !Number.isFinite(s.depthMm) || s.depthMm < 0) continue;
    const key = Math.floor(s.depthMm / 5);
    let bin = bins.get(key);
    if (!bin) {
      bin = { liver: [], cortex: [] };
      bins.set(key, bin);
    }
    bin[s.tissue].push(s.gray);
  }
  const stats = (a: number[]) => {
    const n = a.length,
      mean = a.reduce((s, x) => s + x, 0) / n;
    return { n, mean, sd: Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / n), saturated: a.filter((x) => x >= 250).length / n };
  };
  const bands = [...bins]
    .sort(([a], [b]) => a - b)
    .filter(([, b]) => b.liver.length >= minimum && b.cortex.length >= minimum)
    .map(([i, b]) => {
      const liver = stats(b.liver),
        cortex = stats(b.cortex);
      return { fromMm: i * 5, toMm: (i + 1) * 5, liver, cortex, ratio: cortex.mean > 0 ? liver.mean / cortex.mean : null };
    });
  const valid = bands.filter((b) => b.ratio !== null),
    weight = valid.reduce((s, b) => s + Math.min(b.liver.n, b.cortex.n), 0);
  return {
    bands,
    matchedPixels: weight,
    ratio: weight ? valid.reduce((s, b) => s + b.ratio! * Math.min(b.liver.n, b.cortex.n), 0) / weight : null,
  };
}

/** PNG original del canvas, DPR1; máscara anatómica independiente del brillo. */
export function measureHepatorenal(png: string, pose: ProbePose, reference: boolean) {
  const { PNG } = createRequire(import.meta.url)('playwright-core/lib/utilsBundle') as {
    PNG: { sync: { read: (b: Buffer) => { width: number; height: number; data: Buffer } } };
  };
  const img = PNG.sync.read(readFileSync(png));
  if (reference) {
    const b = readFileSync('src/anatomy/reference-body.bin');
    setReferenceBody(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  } else setReferenceBody();
  const patient = { ...clonePatient(NORMAL_ADULT), respiratoryPattern: 'apnea-expiratory' as const };
  const scene = new AnatomyScene(patient),
    anatomy = new AnatomyQuery(scene),
    engine = new PhysiologyEngine(patient, scene.vesselAreas(), { historySeconds: 4 });
  setReferenceBody();
  for (let i = 0; i < 240; i++) engine.step();
  const sample = engine.sample,
    k = probeContact(pose, CONVEX_C35, scene.torso);
  anatomy.setProbeCompression(k);
  const depth = 180,
    layout = sectorLayout(img.width, img.height, CONVEX_C35, depth, 8),
    shadows = new Float32Array(128).fill(depth);
  for (let j = 0; j < shadows.length; j++)
    for (let r = 2; r < depth; r += 2) {
      const theta = ((j / (shadows.length - 1)) * 2 - 1) * CONVEX_C35.halfSector;
      const t = anatomy.classifyWorld(pointOnLine(k.frame, CONVEX_C35, theta, r), sample).tissue;
      if ([Tissue.Bone, Tissue.Vertebra, Tissue.Lung, Tissue.BowelGas].includes(t)) {
        shadows[j] = r;
        break;
      }
    }
  const samples: MatchedSample[] = [];
  let rejectedShadow = 0;
  for (let y = 0; y < img.height; y += 2)
    for (let x = 0; x < img.width; x += 2) {
      const b = pixelToBeam(layout, CONVEX_C35, depth, x + 0.5, y + 0.5);
      if (!b || b.r < 30 || b.r > 160 || contactCoupling(k, b.theta) < 0.95) continue;
      const j = Math.round((b.theta / CONVEX_C35.halfSector + 1) * 0.5 * (shadows.length - 1));
      if (b.r >= Math.min(shadows[Math.max(0, j - 1)], shadows[j], shadows[Math.min(shadows.length - 1, j + 1)])) {
        rejectedShadow++;
        continue;
      }
      const c = anatomy.classifyWorld(pointOnLine(k.frame, CONVEX_C35, b.theta, b.r), sample);
      if (c.boundaryDistance < 2 || c.interfaceDistance < 2 || (c.tissue !== Tissue.Liver && c.tissue !== Tissue.RenalCortex)) continue;
      const offset = (y * img.width + x) * 4;
      const gray = (img.data[offset] + img.data[offset + 1] + img.data[offset + 2]) / 3;
      samples.push({ tissue: c.tissue === Tissue.Liver ? 'liver' : 'cortex', depthMm: b.r, gray });
    }
  return {
    ...matchedBands(samples),
    eligible: samples.length,
    rejectedShadow,
    width: img.width,
    height: img.height,
    protocol:
      'Bins de5mm, mínimo30píxeles por tejido, interior≥2mm, acoplamiento≥0,95, sin seno/pirámides/vasos/sombras. Comparación de imagen, no umbral clínico de esteatosis.',
  };
}
