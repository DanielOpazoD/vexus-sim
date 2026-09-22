import { describe, expect, it } from 'vitest';
import { CONVEX_C35 } from '../probe/probe';
import { beamToPixel, pixelToBeam, sectorLayout } from '../ultrasound/sectorGeometry';

/** Geometría de presentación del sector: encaje en el lienzo e inversas píxel ↔ haz. */
describe('sectorGeometry', () => {
  const tr = CONVEX_C35;
  const depth = 160;
  const l = sectorLayout(600, 500, tr, depth, 8);

  it('encaja el abanico en el lienzo respetando el margen y centra el vértice', () => {
    expect(l.apexX).toBe(300);
    // el borde inferior del abanico (r = profundidad, θ = 0) queda a ≤ H − margen
    const bottom = beamToPixel(l, tr, 0, depth);
    expect(bottom.y).toBeLessThanOrEqual(500 - 8 + 1e-9);
    // y el borde lateral (θ = ±semisector, r = profundidad) dentro del ancho
    const side = beamToPixel(l, tr, tr.halfSector, depth);
    expect(side.x).toBeGreaterThanOrEqual(8 - 1e-9);
    expect(side.x).toBeLessThanOrEqual(300);
    // la cara de la sonda (r = 0, θ = 0) está en el margen superior
    expect(beamToPixel(l, tr, 0, 0).y).toBeCloseTo(8 + l.scale * tr.curvatureRadius * (1 - Math.cos(tr.halfSector)), 9);
  });

  it('pixelToBeam es la inversa de beamToPixel y devuelve null fuera del sector', () => {
    for (const theta of [-0.5, -0.2, 0, 0.3, 0.55]) {
      for (const r of [0.5, 40, 100, 159]) {
        const p = beamToPixel(l, tr, theta, r);
        const b = pixelToBeam(l, tr, depth, p.x, p.y);
        expect(b).not.toBeNull();
        expect(b!.theta).toBeCloseTo(theta, 9);
        expect(b!.r).toBeCloseTo(r, 9);
      }
    }
    // θ positivo = izquierda de pantalla
    expect(beamToPixel(l, tr, 0.3, 50).x).toBeLessThan(l.apexX);
    expect(pixelToBeam(l, tr, depth, l.apexX, l.apexY + 1)).toBeNull(); // dentro del radio de curvatura
    const tooDeep = beamToPixel(l, tr, 0, depth + 1);
    expect(pixelToBeam(l, tr, depth, tooDeep.x, tooDeep.y)).toBeNull();
    const outside = beamToPixel(l, tr, tr.halfSector + 0.05, 50);
    expect(pixelToBeam(l, tr, depth, outside.x, outside.y)).toBeNull();
  });

  it('el mismo módulo con márgenes distintos da la misma correspondencia píxel ↔ haz salvo la escala', () => {
    const a = sectorLayout(300, 400, tr, depth, 6);
    const b = sectorLayout(300, 400, tr, depth, 8);
    const pa = beamToPixel(a, tr, 0.2, 80);
    const pb = beamToPixel(b, tr, 0.2, 80);
    expect(pixelToBeam(a, tr, depth, pa.x, pa.y)!.r).toBeCloseTo(pixelToBeam(b, tr, depth, pb.x, pb.y)!.r, 9);
    expect(a.scale).toBeGreaterThan(b.scale);
  });
});
