import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import {
  KIDNEY_GLSL,
  KIDNEY_SINUS,
  PYRAMIDS,
  SINUS_FINGER,
  SINUS_FINGERS,
  kidneyOuterSdf,
  kidneyQuery,
  kidneyWorld,
  type Kidney,
} from '../anatomy/organs/kidney';
import { sdEllipsoidLocal } from '../anatomy/primitives';
import { setAbdominalBody } from '../anatomy/referenceBody';
import { ANATOMY_GLSL } from '../anatomy/gpu/anatomy.glsl';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { Tissue } from '../anatomy/tissues';
import { setThoracicAtlas } from '../anatomy/thoracicAtlas';
import { startPointsFor } from '../app/startPoints';
import { CASES } from '../cases';
import type { Vec3 } from '../core/vec3';
import { CONVEX_C35, probeFrame } from '../probe/probe';

const PATIENT = { ...CASES.find((c) => c.id === 'normal-adult')!, respiratoryPattern: 'apnea-expiratory' as const };

function loadAtlas(): void {
  const load = (name: string) => {
    const b = gunzipSync(readFileSync(`src/anatomy/${name}-atlas.gzip.bin`));
    return new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  };
  setAbdominalAtlas(load('abdominal'));
  setThoracicAtlas(load('thoracic'));
  const b = readFileSync('src/anatomy/abdominal-body.bin');
  setAbdominalBody(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
}
afterAll(() => {
  setAbdominalAtlas();
  setThoracicAtlas();
  setAbdominalBody();
});

/** Área del casco convexo de puntos en el plano (cadena monótona). */
function hullArea(points: readonly (readonly [number, number])[]): number {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: readonly number[], a: readonly number[], b: readonly number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: typeof p) => {
    const h: (readonly [number, number])[] = [];
    for (const q of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop();
      h.push(q);
    }
    return h.slice(0, -1);
  };
  const h = [...half(p), ...half([...p].reverse())];
  let twice = 0;
  for (let i = 0; i < h.length; i++) twice += h[i][0] * h[(i + 1) % h.length][1] - h[(i + 1) % h.length][0] * h[i][1];
  return Math.abs(twice) / 2;
}

/** Solidez del corte del seno en el plano de la sonda: área / área de su casco convexo. Un óvalo liso da ≈ 1. */
function sinusSolidity(k: Kidney, view: 'renal' | 'hepatorenal', scene: AnatomyScene): number {
  const sp = startPointsFor(scene.torso).find((s) => s.id === view)!;
  const f = probeFrame({ phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 }, scene.torso, CONVEX_C35);
  const points: [number, number][] = [];
  const STEP = 0.5;
  for (let a = 0; a < 180; a += STEP)
    for (let b = -90; b <= 90; b += STEP) {
      const p: Vec3 = [0, 1, 2].map((i) => f.face[i] + f.axial[i] * a + f.lateral[i] * b) as Vec3;
      if (kidneyQuery(p, k).region === 'sinus') points.push([a, b]);
    }
  expect(points.length).toBeGreaterThan(400);
  return (points.length * STEP * STEP) / hullArea(points);
}

describe('seno digitado y médula del riñón (decisión 305)', () => {
  it('crecer las pirámides deja ≥ 2 mm de columna entre vecinas; solo se funden las compuestas de los polos', () => {
    const lateralPoles = new Set(['0-13', '3-12']);
    for (let i = 0; i < PYRAMIDS.length; i++)
      for (let j = i + 1; j < PYRAMIDS.length; j++) {
        if (lateralPoles.has(`${i}-${j}`)) continue;
        const [a, b] = [PYRAMIDS[i], PYRAMIDS[j]];
        const gap = Math.hypot(a.base[0] - b.base[0], a.base[1] - b.base[1], a.base[2] - b.base[2]) - a.baseR - b.baseR;
        expect(gap, `${i}-${j}`).toBeGreaterThanOrEqual(1.95);
      }
  });

  it('los dedos nacen pegados al seno, no cruzan la cápsula en ningún tramo y sus puntas quedan a ≥ 5 mm, sin atlas y con él', () => {
    const check = () => {
      const scene = new AnatomyScene(PATIENT);
      for (const k of [scene.kidneyRight, scene.kidneyLeft])
        for (const f of SINUS_FINGERS) {
          expect(-kidneyOuterSdf(f.b, k) - SINUS_FINGER.radiusMm).toBeGreaterThanOrEqual(5);
          expect(sdEllipsoidLocal([f.a[0], f.a[1] - KIDNEY_SINUS.offsetV, f.a[2]], KIDNEY_SINUS.radii)).toBeLessThan(SINUS_FINGER.radiusMm);
          for (let t = 0; t <= 1; t += 0.05) {
            const q: Vec3 = [0, 1, 2].map((i) => f.a[i] + (f.b[i] - f.a[i]) * t) as Vec3;
            expect(-kidneyOuterSdf(q, k) - SINUS_FINGER.radiusMm).toBeGreaterThan(0);
          }
        }
    };
    setAbdominalAtlas();
    check();
    loadAtlas();
    check();
  });

  it('con el atlas, la médula es ≥ 4 % del parénquima en los dos riñones (2,6 y 3,2 % antes; 35 % en RM, no alcanzable en este contorno)', () => {
    loadAtlas();
    const scene = new AnatomyScene(PATIENT);
    for (const k of [scene.kidneyRight, scene.kidneyLeft]) {
      let medulla = 0;
      let parenchyma = 0;
      const STEP = 2;
      for (let u = -64; u <= 64; u += STEP)
        for (let v = -40; v <= 40; v += STEP)
          for (let w = -32; w <= 32; w += STEP) {
            const h = kidneyQuery(kidneyWorld([u, v, w], k), k);
            if (h.dOuter >= 0 || h.region === 'sinus' || h.region === 'pelvis') continue;
            parenchyma++;
            if (h.region === 'medulla') medulla++;
          }
      expect(medulla / parenchyma).toBeGreaterThanOrEqual(0.04);
    }
  });

  it('la frontera de la clasificación no se cruza: moverse 0,95 × boundaryDistance no cambia de tejido renal', () => {
    const RENAL = new Set<Tissue>([Tissue.RenalCortex, Tissue.RenalMedulla, Tissue.RenalSinus, Tissue.RenalPelvis, Tissue.RenalCapsule]);
    // los tubos no descuentan esa frontera (limitación `kidney-boundary-ignores-tubes`)
    const VESSEL = new Set<Tissue>([Tissue.Blood, Tissue.VesselWallThin, Tissue.ArteryWall]);
    const scan = (scene: AnatomyScene, k: Kidney, witnesses: readonly (readonly [Vec3, Tissue, number])[]) => {
      const at = (q: Vec3) => {
        const p = kidneyWorld(q, k);
        return { p, c: scene.classify(p, BASELINE_CALIBER) };
      };
      // contraejemplos de las revisiones: (punto, tejido, salida real por bisección, mm)
      for (const [q, tissue, exit] of witnesses) {
        const { c } = at(q);
        expect(c.tissue).toBe(tissue);
        expect(c.boundaryDistance).toBeLessThan(exit);
      }
      let state = 20261031;
      const rnd = () => (state = (state * 16807) % 2147483647) / 2147483647;
      const dirs: Vec3[] = Array.from({ length: 32 }, (_, i) => {
        const z = 1 - (2 * (i + 0.5)) / 32;
        const r = Math.sqrt(1 - z * z);
        const ph = i * 2.399963229728653;
        return [r * Math.cos(ph), r * Math.sin(ph), z];
      });
      let crossings = 0;
      let regionCrossings = 0;
      let trials = 0;
      for (let i = 0; i < 1500; i++) {
        const q: Vec3 = [-54 + 108 * rnd(), -28 + 56 * rnd(), -24 + 48 * rnd()];
        const { p, c } = at(q);
        if (!RENAL.has(c.tissue) || c.boundaryDistance < 0.05) continue;
        const s = 0.95 * c.boundaryDistance;
        const h = kidneyQuery(p, k);
        const sq = 0.95 * h.inner * 0.75;
        for (const d of dirs) {
          trials++;
          const after = scene.classify([p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s], BASELINE_CALIBER).tissue;
          if (after !== c.tissue && !VESSEL.has(after)) crossings++;
          // los arcuatos son del riñón: su pared arterial no se distingue de la de un tubo en el clasificador, sí aquí
          const hq = kidneyQuery(kidneyWorld([q[0] + d[0] * sq, q[1] + d[1] * sq, q[2] + d[2] * sq], k), k);
          if (hq.dOuter >= 0 || hq.region !== h.region) regionCrossings++;
        }
      }
      expect(trials).toBeGreaterThan(5000);
      expect(crossings).toBe(0);
      expect(regionCrossings).toBe(0);
    };
    setAbdominalAtlas();
    setThoracicAtlas();
    setAbdominalBody();
    const legacy = new AnatomyScene(PATIENT);
    scan(legacy, legacy.kidneyRight, [[[0.5, 7, 0], Tissue.RenalPelvis, 1.197]]);
    scan(legacy, legacy.kidneyLeft, []);
    loadAtlas();
    const atlas = new AnatomyScene(PATIENT);
    scan(atlas, atlas.kidneyRight, [
      [[23.5, 4, 2], Tissue.RenalSinus, 2.973],
      [[-20, 5, 0], Tissue.RenalSinus, 5.925],
    ]);
    scan(atlas, atlas.kidneyLeft, [[[20, 4, 0], Tissue.RenalSinus, 5.963]]);
  });

  it('la GLSL aplica las mismas fronteras que TS', () => {
    expect(KIDNEY_GLSL).toContain('float lp = (length(vec3(q.x, q.y - uKidSinus[k].w - PELVIS.w, q.z) / PELVIS.xyz) - 1.0) * PELVIS.z;');
    expect(KIDNEY_GLSL).toContain('inner = min(min(-dSinus, -dOuter), lp); return 2;');
    expect(ANATOMY_GLSL).toMatch(/int region = kidneyQuery\(m, k, inner, dOuter\);\s+inner \*= 0\.75;/);
  });

  // 0,61–0,87 sale de tres imágenes reales con la misma medida (decisión 305): objetivo exploratorio, no un intervalo normal
  it('el seno de las dos ventanas renales deja de ser un óvalo: solidez 0,61–0,87, el rango de tres riñones reales', () => {
    loadAtlas();
    const scene = new AnatomyScene(PATIENT);
    for (const view of ['renal', 'hepatorenal'] as const) {
      const s = sinusSolidity(scene.kidneyRight, view, scene);
      expect(s, view).toBeGreaterThanOrEqual(0.61);
      expect(s, view).toBeLessThanOrEqual(0.87);
    }
  });
});
