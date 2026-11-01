import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { abdominalAtlasSdf, setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { setAbdominalBody } from '../anatomy/referenceBody';
import { ABDOMINAL_SURFACE } from '../anatomy/abdominalSurfaceData';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';
import {
  ATLAS_KIDNEY_CLEARANCE_MM,
  RENAL_FASCIA_MM,
  atlasKidneyOuter,
  kidneyLocal,
  kidneyOuterSdf,
  kidneyWorld,
  perirenalOuterSdf,
} from '../anatomy/organs/kidney';
import { Interface } from '../anatomy/interfaces';
import { Tissue } from '../anatomy/tissues';
import type { Vec3 } from '../core/vec3';
const raw = gunzipSync(readFileSync('src/anatomy/abdominal-atlas.gzip.bin'));
const body = readFileSync('src/anatomy/abdominal-body.bin');
const surface = gunzipSync(readFileSync('src/anatomy/abdominal-surface.gzip.bin'));
const vertices = new Float32Array(surface.buffer, surface.byteOffset, surface.byteLength / 4);
beforeAll(() => {
  setAbdominalAtlas(new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2));
  setAbdominalBody(new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)));
});
afterAll(() => {
  setAbdominalAtlas();
  setAbdominalBody();
});
describe('volumetric renal bed', () => {
  it('separates both renal surfaces from psoas without relying on classifier priority', () => {
    for (const [field, other] of [
      [5, [9]],
      [6, [9]],
      [9, [5, 6]],
    ] as const) {
      const f = ABDOMINAL_SURFACE.fields[field];
      let worst = Infinity;
      for (let i = 0; i < f.count; i++) {
        const p = Array.from(vertices.subarray(f.offset + 3 * i, f.offset + 3 * i + 3)) as Vec3;
        worst = Math.min(worst, ...other.map((k) => abdominalAtlasSdf(p, k)));
      }
      // 2 mm de holgura con el psoas (`ATLAS_KIDNEY_CLEARANCE_MM`), menos la resolución de la malla del riñón, extraída a 1,5 mm
      expect(worst, f.name).toBeGreaterThan(1.7);
    }
  });
  it('crosses capsule, adipose volume, fascia and muscle at both former contact sites', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    const rays: Array<{ p: Vec3; n: Vec3 }> = [
      { p: [-54, -30, -197.25], n: [0, -0.3333016832, -0.942820231] },
      { p: [58.5, -36, -179.25], n: [-0.3162007423, -0.3162007423, -0.8944462986] },
    ];
    for (const { p, n } of rays) {
      const sequence: Tissue[] = [];
      let fatLength = 0,
        fasciaLength = 0;
      // Include the bounded sub-voxel contour shift from lattice regularization.
      for (let step = -40; step <= 120; step++) {
        const t = step * 0.05;
        const c = scene.classify(p.map((v, i) => v + t * n[i]) as Vec3, BASELINE_CALIBER);
        if (sequence.at(-1) !== c.tissue) sequence.push(c.tissue);
        if (c.tissue === Tissue.PerirenalFat) fatLength += 0.05;
        if (c.tissue === Tissue.SoftCapsule) fasciaLength += 0.05;
        expect(c.vessel).toBeNull();
      }
      const capsule = sequence.indexOf(Tissue.RenalCapsule);
      expect(capsule).toBeGreaterThanOrEqual(0);
      expect(sequence.slice(capsule)).toEqual([Tissue.RenalCapsule, Tissue.PerirenalFat, Tissue.SoftCapsule, Tissue.Psoas]);
      expect(fatLength).toBeGreaterThan(1.4);
      expect(fasciaLength).toBeGreaterThan(0.2);
      expect(fasciaLength).toBeLessThan(0.4);
    }
  });
  // Revisión de la decisión 309: la unión tenía ramas que saltaban 0,28–4 mm y falseaban la frontera, también entre CPU y GPU
  it('el contorno renal no salta: la frontera declarada se respeta en el testigo de la cápsula', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    const k = scene.kidneyRight;
    const p: Vec3 = [-49.18684034677224, -15.294180849477517, -151.98905660070056];
    const n: Vec3 = [-0.566688753045735, 0.7854287900638963, -0.24892865023985086];
    const at = (t: number) => p.map((v, i) => v + t * n[i]) as Vec3;
    expect(Math.abs(atlasKidneyOuter(at(2e-5), k) - atlasKidneyOuter(p, k))).toBeLessThan(1e-3);
    const c = scene.classify(p, BASELINE_CALIBER);
    expect(scene.classify(at(0.95 * c.boundaryDistance), BASELINE_CALIBER).tissue).toBe(c.tissue);
  });
  it('el contorno renal no salta junto a los dos riñones', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    const step = 0.01;
    for (const k of [scene.kidneyRight, scene.kidneyLeft]) {
      let worst = 0;
      for (let u = -70; u <= 70; u += 2.3)
        for (let v = -46; v <= 46; v += 2.3)
          for (let w = -38; w <= 38; w += 2.3) {
            const q: Vec3 = [u + 0.137, v + 0.079, w + 0.191];
            const d = kidneyOuterSdf(q, k);
            for (let a = 0; a < 3; a++) {
              const r: Vec3 = [q[0], q[1], q[2]];
              r[a] += step;
              const e = kidneyOuterSdf(r, k);
              // A partir de 8 mm mandan los bordes de las cajas del atlas, donde la distancia se corta en 16, como antes de este riñón
              if (Math.min(Math.abs(d), Math.abs(e)) < 8) worst = Math.max(worst, Math.abs(e - d));
            }
          }
      expect(worst / step).toBeLessThan(2);
    }
    // El salto de 4 mm de la guarda exterior del primer intento, junto a la luz del colon, a 3 mm del riñón
    const q: Vec3 = [-8.863, -11.922, 22.191];
    expect(Math.abs(kidneyOuterSdf([q[0], q[1] + 0.001, q[2]], scene.kidneyRight) - kidneyOuterSdf(q, scene.kidneyRight))).toBeLessThan(
      0.01,
    );
  });
  it('ningún punto del riñón original queda fuera del nuevo', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    for (const [field, k] of [
      [5, scene.kidneyRight],
      [6, scene.kidneyLeft],
    ] as const) {
      let lost = 0;
      for (let u = -64; u <= 64; u += 1)
        for (let v = -40; v <= 40; v += 1)
          for (let w = -32; w <= 32; w += 1) {
            const p = kidneyWorld([u + 0.137, v + 0.079, w + 0.191], k);
            if (abdominalAtlasSdf(p, field) < 0 && atlasKidneyOuter(p, k) >= 0) lost++;
          }
      expect(lost).toBe(0);
    }
  });
  // Revisión de la decisión 309: fuera de las cajas del campo original ambos valían 16, y el empate daba siempre el riñón izquierdo
  it('la cara de la fascia usa el gradiente de su propio riñón, también fuera de la caja del campo original', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    const p: Vec3 = [-63.55707550048828, -68.85719299316406, -135.8177947998047];
    expect(abdominalAtlasSdf(p, 5)).toBe(16);
    expect(scene.classify(p, BASELINE_CALIBER).interface).toBe(Interface.RenalFascia);
    const g = scene.faceGradient(p, BASELINE_CALIBER)!;
    expect(g.norm).toBeGreaterThan(0.5);
    const h = 0.05;
    const face = (q: Vec3) => perirenalOuterSdf(kidneyLocal(q, scene.kidneyRight), scene.kidneyRight);
    const n = [0, 1, 2].map((a) => {
      const q: Vec3 = [p[0], p[1], p[2]];
      const r: Vec3 = [p[0], p[1], p[2]];
      q[a] += h;
      r[a] -= h;
      return face(q) - face(r);
    });
    const l = Math.hypot(n[0], n[1], n[2]);
    expect((g.normal[0] * n[0] + g.normal[1] * n[1] + g.normal[2] * n[2]) / l).toBeGreaterThan(0.98);
  });
  it('extracts both 3D envelopes from the same acoustic field, within meshing resolution', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    expect(ABDOMINAL_SURFACE.envelopes.length).toBe(4);
    for (const f of ABDOMINAL_SURFACE.envelopes) {
      const kidney = f.side ? scene.kidneyLeft : scene.kidneyRight;
      let worst = 0;
      for (let i = 0; i < f.count; i += 37) {
        const p = Array.from(vertices.subarray(f.offset + i * 3, f.offset + i * 3 + 3)) as Vec3;
        worst = Math.max(worst, Math.abs(perirenalOuterSdf(kidneyLocal(p, kidney), kidney) + (f.fascia ? 0 : RENAL_FASCIA_MM)));
      }
      expect(worst, f.name).toBeLessThan(0.02);
    }
  });
  it('extracts both kidneys from the stretched, clipped contour the classifier uses, with no fascia inside the cortex', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    for (const [field, kidney] of [
      [5, scene.kidneyRight],
      [6, scene.kidneyLeft],
    ] as const) {
      const f = ABDOMINAL_SURFACE.fields[field];
      let worst = 0;
      for (let i = 0; i < f.count; i += 7) {
        const p = Array.from(vertices.subarray(f.offset + i * 3, f.offset + i * 3 + 3)) as Vec3;
        worst = Math.max(worst, Math.abs(kidneyOuterSdf(kidneyLocal(p, kidney), kidney)));
      }
      expect(worst, f.name).toBeLessThan(0.002);
    }
    for (const f of ABDOMINAL_SURFACE.envelopes) {
      const kidney = f.side ? scene.kidneyLeft : scene.kidneyRight;
      let deepest = Infinity;
      for (let i = 0; i < f.count; i += 7) {
        const p = Array.from(vertices.subarray(f.offset + i * 3, f.offset + i * 3 + 3)) as Vec3;
        const d = kidneyOuterSdf(kidneyLocal(p, kidney), kidney);
        deepest = Math.min(deepest, d);
        // La envoltura solo entra en el riñón donde el propio atlas lo solapa con un vecino: ahí la grasa sigue la cara del vecino, a la fascia de distancia
        if (d < -0.02)
          expect(Math.min(...[0, 1, 2, 3, 4, 7, 8, 9, 10].map((field) => abdominalAtlasSdf(p, field)))).toBeLessThan(
            RENAL_FASCIA_MM + 0.02,
          );
      }
      expect(deepest, f.name).toBeGreaterThan(-0.8);
    }
  });
  it('the stretched kidney yields to bowel and psoas: it never occupies them', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    for (const k of [scene.kidneyRight, scene.kidneyLeft])
      for (let u = -64; u <= 64; u += 2)
        for (let v = -40; v <= 40; v += 2)
          for (let w = -32; w <= 32; w += 2) {
            const p = kidneyWorld([u, v, w], k);
            if (kidneyOuterSdf([u, v, w], k) >= 0) continue;
            // Los dos riñones del atlas ya tenían, antes de estirarlos, puntos a menos de esta holgura: esos se conservan
            if (abdominalAtlasSdf(p, k.center[0] < 0 ? 5 : 6) < 0) continue;
            expect(abdominalAtlasSdf(p, 1), `${u},${v},${w}`).toBeGreaterThan(ATLAS_KIDNEY_CLEARANCE_MM - 0.01);
            expect(abdominalAtlasSdf(p, 9), `${u},${v},${w}`).toBeGreaterThan(ATLAS_KIDNEY_CLEARANCE_MM - 0.01);
          }
  });
});
