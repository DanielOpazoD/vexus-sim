import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { Interface, INTERFACES, hasCurvatureCoherence, interfaceReflectivity } from '../anatomy/interfaces';
import { sdSpine, sdSpineDisc, SPINE_SHAPE } from '../anatomy/primitives';
import { setReferenceBody, validateReferenceBody } from '../anatomy/referenceBody';
import { NORMAL_ADULT } from '../cases';
import { Tissue, TISSUES } from '../anatomy/tissues';
import { boneDiffuseWindow, faceLitFromProbe, interfaceEchoField, faceProfile } from '../ultrasound/interfaceEcho';
import { rayAttenuationDb } from '../ultrasound/transmission';
import type { Vec3 } from '../core/vec3';

const bytes = readFileSync('src/anatomy/reference-body.bin');
const profile = validateReferenceBody(new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
const face = Interface.VertebralCortex;
for (const reference of [false, true])
  describe(`cortical vertebral ${reference ? 'referencia' : 'legacy'}`, () => {
    const scene = (() => {
      setReferenceBody(reference ? profile : undefined);
      try {
        return new AnatomyScene(NORMAL_ADULT);
      } finally {
        setReferenceBody(undefined);
      }
    })();
    it('la cara anterior vive fuera del hueso y la distancia proviene de la geometría', () => {
      const s = scene.spine;
      let count = 0;
      for (const z of [-4, -3, -2].map((level) => SPINE_SHAPE.z0Mm + level * SPINE_SHAPE.levelMm))
        for (const angle of [-0.5, 0, 0.5])
          for (const delta of [0.08, 0.3, 0.7]) {
            const a = s.r * SPINE_SHAPE.aspect,
              b = s.r / SPINE_SHAPE.aspect;
            const x = (a + delta) * Math.sin(angle),
              y = (b + delta) * Math.cos(angle);
            const p: Vec3 = [s.x0 + x, s.y0 + y, z];
            const c = scene.classify(p, BASELINE_CALIBER);
            if (c.interface !== face) continue; // otro órgano puede poseer una cara más cercana
            count++;
            expect(c.tissue).not.toBe(Tissue.Vertebra);
            expect(c.interfaceDistance).toBeCloseTo(sdSpine(p, s), 10);
            const g = scene.faceGradient(p, BASELINE_CALIBER)!;
            // Derivada analítica de la distancia aproximada de la elipse, independiente del gradiente numérico usado al renderizar.
            const k1 = Math.hypot(x / a, y / b),
              k2 = Math.hypot(x / (a * a), y / (b * b));
            const nx = ((2 * k1 - 1) * x) / (a * a * k1 * k2) - (k1 * (k1 - 1) * x) / (a ** 4 * k2 ** 3);
            const ny = ((2 * k1 - 1) * y) / (b * b * k1 * k2) - (k1 * (k1 - 1) * y) / (b ** 4 * k2 ** 3);
            const norm = Math.hypot(nx, ny);
            expect(g.normal[0]).toBeCloseTo(nx / norm, 5);
            expect(g.normal[1]).toBeCloseTo(ny / norm, 5);
            expect(g.normal[2]).toBe(0);
            expect(g.norm).toBeCloseTo(norm, 5);
            const param = Math.atan2(y / b, x / a);
            expect(g.curvature).toBeCloseTo((a * b) / Math.hypot(a * Math.sin(param), b * Math.cos(param)) ** 3, 12);
            expect(g.axis).toEqual([0, 0, 1]);
            expect(faceLitFromProbe(face, g.normal, [0, -1, 0])).toBe(true);
            expect(faceLitFromProbe(face, g.normal, [0, 1, 0])).toBe(false);
          }
      expect(count).toBeGreaterThanOrEqual(20);
    });
    it('fuera de la banda no asigna una cortical a órganos remotos', () => {
      const s = scene.spine;
      for (const x of [-90, -60, 60, 90])
        for (const y of [-10, 20, 50]) {
          const p: Vec3 = [x, y, -70];
          expect(sdSpine(p, s)).toBeGreaterThan(5);
          expect(scene.classify(p, BASELINE_CALIBER).interface).not.toBe(face);
        }
    });
    it('el interior no dibuja otra cortical ni moteado óseo', () => {
      const s = scene.spine;
      for (const depth of [0.1, 1, 5, 12]) {
        const c = scene.classify([s.x0, s.y0 + s.r / SPINE_SHAPE.aspect - depth, -110], BASELINE_CALIBER);
        expect(c.tissue).toBe(Tissue.Vertebra);
        expect(c.interface).toBe(Interface.None);
      }
      expect(TISSUES[Tissue.Vertebra].backscatter).toBe(0);
    });
    it('el arco rectangular provisional no inventa barras corticales', () => {
      const s = scene.spine;
      for (const side of [-1, 1]) {
        const p: Vec3 = [s.x0 + side * (s.archHalfWidth + 0.3), (s.archY0 + s.archY1) / 2, -110];
        expect(scene.classify(p, BASELINE_CALIBER).interface).not.toBe(face);
        const anterior: Vec3 = [s.x0 + side * 24, s.archY1 + 0.3, -110];
        expect(scene.classify(anterior, BASELINE_CALIBER).interface).not.toBe(face);
      }
    });
  });
describe('respuesta acústica de cortical vertebral', () => {
  it('no toma la normal de cápsulas o vasos ni añade ecos a caras suprimidas', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    const p: Vec3 = [-14.1, -30.3, 46.9]; // fallo real de la E2E subxifoidea
    expect(sdSpine(p, scene.spine)).toBeLessThan(5);
    const c = scene.classify(p, BASELINE_CALIBER);
    expect(c.tissue).toBe(Tissue.LiverCapsule);
    expect(c.interface).toBe(Interface.None);
    let seen = 0;
    for (let x = -35; x <= 35; x += 3)
      for (let y = -65; y <= -15; y += 3)
        for (let z = -140; z <= 80; z += 11) {
          const q = scene.classify([x, y, z], BASELINE_CALIBER);
          if (q.interface === face) {
            seen++;
            if (q.tissue === Tissue.Cartilage) expect(sdSpineDisc([x, y, z], scene.spine)).toBeLessThan(0);
            else expect([Tissue.RetroperitonealFat, Tissue.Psoas, Tissue.QuadratusLumborum, Tissue.Mediastinum]).toContain(q.tissue);
          }
        }
    expect(seen).toBeGreaterThan(100);
  });
  it('Fresnel sin brillo artificial, perfil normalizado y dependencia angular', () => {
    expect(INTERFACES[face].floor).toBe(0);
    expect(interfaceReflectivity(face)).toBeGreaterThan(0.5);
    expect(hasCurvatureCoherence(face)).toBe(true);
    let area = 0;
    for (let d = -1; d <= 1; d += 0.001) area += faceProfile(d, false) * 0.001;
    expect(area).toBeCloseTo(1, 2);
    const k0 = (2 * Math.PI * 2.5) / 1.54;
    expect(interfaceEchoField(face, 1, 1, 0.35, k0)).toBeGreaterThan(interfaceEchoField(face, 0.5, 1, 0.35, k0));
    expect(boneDiffuseWindow(face, 1)).toBeCloseTo(1, 12);
    expect(boneDiffuseWindow(face, 0.5)).toBe(0);
  });
  it('sombra de transmisión ya existente, sin máscara de pantalla', () => {
    const path = Array.from({ length: 100 }, (_, i) => (i < 30 || i >= 70 ? Tissue.Muscle : Tissue.Vertebra));
    const soft = path.map(() => Tissue.Muscle);
    for (const f of [2, 2.5, 3.5]) expect(rayAttenuationDb(path, 0.1, f) - rayAttenuationDb(soft, 0.1, f)).toBeGreaterThan(100);
  });
});
