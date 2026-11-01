import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { kidneyLocal, kidneyOuterSdf } from '../anatomy/organs/kidney';
import { uncompress } from '../anatomy/compression';
import { setAbdominalBody } from '../anatomy/referenceBody';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { Tissue, TISSUES } from '../anatomy/tissues';
import { setThoracicAtlas } from '../anatomy/thoracicAtlas';
import { renalPreset } from '../app/renalPreset';
import { startPointsFor } from '../app/startPoints';
import { CASES } from '../cases';
import { contactCoupling, probeContact } from '../probe/contact';
import { CONVEX_C35, pointOnLine } from '../probe/probe';

beforeAll(() => {
  const load = (name: string) => {
    const b = gunzipSync(readFileSync(`src/anatomy/${name}-atlas.gzip.bin`));
    return new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  };
  setAbdominalAtlas(load('abdominal'));
  setThoracicAtlas(load('thoracic'));
  const b = readFileSync('src/anatomy/abdominal-body.bin');
  setAbdominalBody(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
});
afterAll(() => {
  setAbdominalAtlas();
  setThoracicAtlas();
  setAbdominalBody();
});

const TOTAL_RENAL = new Set<Tissue>([Tissue.RenalCortex, Tissue.RenalMedulla, Tissue.RenalSinus, Tissue.RenalCapsule]);

/** Corte de la ventana renal en una rejilla polar: líneas en contacto, riñón visible y contorno cortado por el sector, el fondo o una sombra. */
function renalCut(scene: AnatomyScene, depthMm: number) {
  const sp = startPointsFor(scene.torso).find((p) => p.id === 'renal')!;
  const k = probeContact({ phi: sp.phi, z: sp.z, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0, lift: 0 }, CONVEX_C35, scene.torso);
  const lines = 129;
  const dr = 0.75;
  const hs = CONVEX_C35.halfSector;
  const grid: number[][] = [];
  const counts = { cortex: 0, medulla: 0, sinus: 0 };
  let coupled = 0;
  let kidney = 0;
  let blockedKidney = 0;
  let uMin = Infinity;
  let uMax = -Infinity;
  let thetaSum = 0;
  let rMin = Infinity;
  let rMax = -Infinity;
  for (let l = 0; l < lines; l++) {
    const theta = -hs + (2 * hs * l) / (lines - 1);
    const coupling = contactCoupling(k, theta);
    if (coupling >= 0.9) coupled++;
    let blocked = coupling < 0.9;
    let entered = false;
    const row: number[] = [];
    for (let r = 1; r < depthMm; r += dr) {
      const m = uncompress(pointOnLine(k.frame, CONVEX_C35, theta, r), k);
      const c = scene.classify(m, BASELINE_CALIBER);
      if (c.tissue !== Tissue.Air) entered = true;
      if (entered && (TISSUES[c.tissue].bone || TISSUES[c.tissue].gas)) blocked = true;
      const isKidney = TOTAL_RENAL.has(c.tissue);
      row.push(isKidney ? (blocked ? 2 : 1) : blocked ? 3 : 0);
      if (!isKidney) continue;
      kidney++;
      if (blocked) {
        blockedKidney++;
        continue;
      }
      if (c.tissue === Tissue.RenalMedulla) counts.medulla++;
      else if (c.tissue === Tissue.RenalSinus) counts.sinus++;
      else counts.cortex++;
      const u = kidneyLocal(m, scene.kidneyRight)[0];
      uMin = Math.min(uMin, u);
      uMax = Math.max(uMax, u);
      thetaSum += theta;
      rMin = Math.min(rMin, r);
      rMax = Math.max(rMax, r);
    }
    grid.push(row);
  }
  let edge = 0;
  let cut = 0;
  for (let i = 0; i < grid.length; i++)
    for (let j = 0; j < grid[i].length; j++) {
      if (grid[i][j] !== 1) continue;
      let isEdge = false;
      let isCut = false;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const row = grid[i + di];
        if (!row || j + dj >= row.length) {
          isEdge = isCut = true;
          continue;
        }
        if (j + dj < 0) continue;
        const g = row[j + dj];
        if (g === 0) isEdge = true;
        else if (g !== 1) isEdge = isCut = true;
      }
      if (isEdge) edge++;
      if (isCut) cut++;
    }
  return {
    coupled: coupled / lines,
    blocked: blockedKidney / kidney,
    length: uMax - uMin,
    cut: cut / edge,
    centre: thetaSum / (kidney - blockedKidney),
    rMin,
    rMax,
    medullaShare: counts.medulla / (counts.medulla + counts.cortex),
    sinusShare: counts.sinus / (counts.medulla + counts.cortex + counts.sinus),
  };
}

it('renal del atlas: el riñón entero en el sector, sin hueso delante y centrado (decisión 309)', () => {
  const scene = new AnatomyScene({ ...CASES.find((c) => c.id === 'normal-adult')!, respiratoryPattern: 'apnea-expiratory' });
  const preset = renalPreset(CONVEX_C35.f0Doppler, true).find((c) => c.type === 'bmode')!;
  const depthMm = (preset.patch as { depthMm: number }).depthMm;
  expect(depthMm).toBe(140);
  const cut = renalCut(scene, depthMm);
  const tag = JSON.stringify(cut);
  // Antes (decisión 303): 72 mm de los 105, y el 18 % del riñón tras una costilla
  expect(cut.length, tag).toBeGreaterThan(97);
  expect(cut.cut, tag).toBeLessThan(0.01);
  expect(cut.blocked, tag).toBeLessThan(0.01);
  expect(cut.coupled, tag).toBeGreaterThan(0.95);
  // centrado en el sector y dentro de la caja de Color del preajuste
  expect(Math.abs(cut.centre), tag).toBeLessThan(0.12);
  expect(cut.rMin, tag).toBeGreaterThan(60);
  expect(cut.rMax, tag).toBeLessThan(125);
  // la médula se ve en el corte (4–6 % del parénquima antes en este plano) y el seno es un tercio escaso del riñón, no la mitad
  expect(cut.medullaShare, tag).toBeGreaterThan(0.11);
  expect(cut.sinusShare, tag).toBeLessThan(0.3);
});

it('el riñón del atlas tiene el volumen de un adulto: 125 cm³ el derecho, frente a 134 de mediana (Emamian 1993) y 107 antes', () => {
  const scene = new AnatomyScene({ ...CASES.find((c) => c.id === 'normal-adult')!, respiratoryPattern: 'apnea-expiratory' });
  const STEP = 2;
  for (const [k, lo, hi] of [
    [scene.kidneyRight, 120, 140],
    [scene.kidneyLeft, 120, 140],
  ] as const) {
    let n = 0;
    let wMin = Infinity;
    let wMax = -Infinity;
    for (let u = -64; u <= 64; u += STEP)
      for (let v = -40; v <= 40; v += STEP)
        for (let w = -32; w <= 32; w += STEP) {
          if (kidneyOuterSdf([u, v, w], k) >= 0) continue;
          n++;
          wMin = Math.min(wMin, w);
          wMax = Math.max(wMax, w);
        }
    const cm3 = (n * STEP ** 3) / 1000;
    expect(cm3).toBeGreaterThan(lo);
    expect(cm3).toBeLessThan(hi);
    expect(wMax - wMin).toBeGreaterThan(40);
    expect(wMax - wMin).toBeLessThan(48);
  }
});
