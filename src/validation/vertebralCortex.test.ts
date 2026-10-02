import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { Interface, INTERFACES, hasCurvatureCoherence, interfaceReflectivity } from '../anatomy/interfaces';
import { sdSpine } from '../anatomy/primitives';
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
      for (const z of [-140, -110, -80])
        for (const angle of [-0.5, 0, 0.5])
          for (const delta of [0.08, 0.3, 0.7]) {
            const p: Vec3 = [s.x0 + (s.r + delta) * Math.sin(angle), s.y0 + (s.r + delta) * Math.cos(angle), z];
            const c = scene.classify(p, BASELINE_CALIBER);
            if (c.interface !== face) continue; // otro órgano puede poseer una cara más cercana
            count++;
            expect(c.tissue).not.toBe(Tissue.Vertebra);
            expect(c.interfaceDistance).toBeCloseTo(sdSpine(p, s), 10);
            const g = scene.faceGradient(p, BASELINE_CALIBER)!;
            expect(g.normal[0]).toBeCloseTo(Math.sin(angle), 5);
            expect(g.normal[1]).toBeCloseTo(Math.cos(angle), 5);
            expect(g.normal[2]).toBe(0);
            expect(g.norm).toBeCloseTo(1, 5);
            expect(g.curvature).toBe(1 / s.r);
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
        const c = scene.classify([s.x0, s.y0 + s.r - depth, -110], BASELINE_CALIBER);
        expect(c.tissue).toBe(Tissue.Vertebra);
        expect(c.interface).toBe(Interface.None);
      }
      expect(TISSUES[Tissue.Vertebra].backscatter).toBe(0);
    });
    it('la cortical lateral del arco tiene normal exterior plana', () => {
      const s = scene.spine;
      for (const side of [-1, 1]) {
        const p: Vec3 = [s.x0 + side * (s.archHalfWidth + 0.3), (s.archY0 + s.archY1) / 2, -110];
        expect(scene.classify(p, BASELINE_CALIBER).interface).toBe(face);
        const g = scene.faceGradient(p, BASELINE_CALIBER)!;
        expect(g.normal).toEqual([side, 0, 0]);
        expect(g.curvature).toBe(0);
      }
    });
  });
describe('respuesta acústica de cortical vertebral', () => {
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
