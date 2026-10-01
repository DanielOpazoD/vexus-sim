import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  bodyDepth,
  bodyGradient,
  bodySection,
  setReferenceBody,
  validateReferenceBody,
  loadReferenceBody,
  referenceBody,
} from '../anatomy/referenceBody';
import { torsoDepth, torsoSkinPoint, torsoNormal, sdRib, type Torso } from '../anatomy/primitives';
import { NORMAL_ADULT } from '../cases';
import { AnatomyScene } from '../anatomy/scene';
import { costalGeometry } from '../ui/navigator3d/body';

const bytes = readFileSync('src/anatomy/reference-body.bin');
const profile = validateReferenceBody(new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
const base = new AnatomyScene(NORMAL_ADULT);
const t: Torso = { ...base.torso, profile };
describe('campo cutáneo del adulto de referencia, mismo mm/LAS que los órganos', () => {
  it('refleja los ángulos LPS a LAS al materializar, conservando los radios observados', () => {
    const source = JSON.parse(readFileSync('docs/anatomy/reference-skin-source.json', 'utf8')) as {
      rows: { radiiMm: (number | null)[] }[];
    };
    for (let row = 0; row < source.rows.length; row++)
      for (let angle = 0; angle < 64; angle++) {
        const radius = source.rows[row].radiiMm[angle];
        if (radius !== null) expect(profile[row * 65 + 1 + ((64 - angle) % 64)]).toBeCloseTo(radius, 4);
      }
  });
  it('el campo costal de referencia coincide con las mallas y normales reflejadas de ambos lados', () => {
    setReferenceBody(profile);
    try {
      const scene = new AnatomyScene(NORMAL_ADULT);
      for (const rib of scene.ribs) {
        const right = costalGeometry(scene, rib, -1),
          left = costalGeometry(scene, rib, 1);
        try {
          const rp = right.getAttribute('position'),
            lp = left.getAttribute('position');
          const rn = right.getAttribute('normal'),
            ln = left.getAttribute('normal');
          expect(rp.count).toBeGreaterThan(300);
          expect(lp.count).toBe(rp.count);
          for (let i = 13; i < rp.count - 13; i++) {
            const p: [number, number, number] = [rp.getX(i) * 10, rp.getY(i) * 10, rp.getZ(i) * 10];
            expect(Math.abs(sdRib(p, rib, scene.torso, scene.spine).d)).toBeLessThan(0.001);
            expect(lp.getX(i)).toBeCloseTo(-rp.getX(i), 6);
            expect(lp.getY(i)).toBeCloseTo(rp.getY(i), 6);
            expect(lp.getZ(i)).toBeCloseTo(rp.getZ(i), 6);
            expect(ln.getX(i)).toBeCloseTo(-rn.getX(i), 5);
            expect(ln.getY(i)).toBeCloseTo(rn.getY(i), 5);
            expect(ln.getZ(i)).toBeCloseTo(rn.getZ(i), 5);
          }
        } finally {
          right.dispose();
          left.dispose();
        }
      }
    } finally {
      setReferenceBody();
    }
  });
  it('la carga es transaccional: error HTTP o payload inválido no sustituye el campo anterior', async () => {
    setReferenceBody(profile);
    try {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('missing', { status: 404 })));
      await expect(loadReferenceBody()).rejects.toThrow('HTTP 404');
      expect(referenceBody).toBe(profile);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ArrayBuffer(40))));
      await expect(loadReferenceBody()).rejects.toThrow('inválida');
      expect(referenceBody).toBe(profile);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))),
      );
      await loadReferenceBody();
      expect(referenceBody).toEqual(profile);
      expect(referenceBody).not.toBe(profile);
    } finally {
      setReferenceBody();
      vi.unstubAllGlobals();
    }
  });
  it('rechaza tamaño, datos no finitos y radios inválidos sin fallback silencioso', () => {
    expect(() => validateReferenceBody(new Float32Array(10))).toThrow();
    for (const v of [NaN, 0, 400]) {
      const bad = profile.slice();
      bad[1] = v;
      expect(() => validateReferenceBody(bad)).toThrow();
    }
  });
  it('la piel 3D y la piel de adquisición son el mismo campo a múltiples alturas y ángulos', () => {
    for (const z of [-180, -157, -82, -38, 3, 43, 117, 160])
      for (const phi of [-3.14, -1.03, 0.05, 1.1, 2.7, 6.8]) {
        const p = torsoSkinPoint(phi, z, t);
        expect(Math.abs(torsoDepth(p, t))).toBeLessThan(1e-8);
        const n = torsoNormal(p, t);
        expect(Math.hypot(...n)).toBeCloseTo(1, 12);
        expect(bodyDepth([p[0] + n[0], p[1] + n[1], p[2] + n[2]], profile)).toBeGreaterThan(0);
      }
  });
  it('incluye pendiente craneocaudal y deriva el gradiente de su distancia, sin doble registro', () => {
    for (const p of [
      [110, 50, -77],
      [-115, 40, 6],
      [60, 82, 51],
    ] as [number, number, number][]) {
      const g = bodyGradient(p, profile);
      for (let k = 0; k < 3; k++) {
        const a = [...p] as typeof p,
          b = [...p] as typeof p;
        a[k] += 0.001;
        b[k] -= 0.001;
        expect(g[k]).toBeCloseTo((bodyDepth(a, profile) - bodyDepth(b, profile)) / 0.002, 5);
      }
    }
    expect(bodySection(0.71, -200, profile)[2]).toBe(0);
    expect(bodySection(0.71, 200, profile)[4]).toBe(0);
    expect(bodySection(0.71 + 2 * Math.PI, 1, profile)).toEqual(bodySection(0.71, 1, profile));
  });
  it('conserva dentro del tronco los landmarks vasculares protegidos, sin mover los vasos para rellenar el atlas', () => {
    for (const p of [
      [-18.1, -3.2, 53],
      [-16.9, -0.6, 64],
    ] as [number, number, number][])
      expect(bodyDepth(p, profile)).toBeLessThan(-20);
    const vessels = base.vessels.filter((v) => v.id === 'ivcSupra' || v.id === 'ivcInfra' || v.id === 'aorta');
    expect(vessels.length).toBe(3);
    for (const vessel of vessels)
      for (const node of vessel.tube.nodes)
        if (node.p[2] >= -160 && node.p[2] <= 120) expect(bodyDepth(node.p, profile) + node.r).toBeLessThan(-20);
  });
});
