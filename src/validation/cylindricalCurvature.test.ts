import { describe, expect, it } from 'vitest';
import { curvatureCoherence, cylindricalCurvatureCoherence, interfaceEchoGlsl } from '../ultrasound/interfaceEcho';
import fixture from './fixtures/cylindricalCurvature.json';

const cylinders = fixture.cases.filter((row) => row.model === 'rank-one-cylinder');
const amplitude = (row: (typeof fixture.cases)[number]) => Math.hypot(...row.quadratureComplex);
const coherence = (row: (typeof fixture.cases)[number], unit = 1) =>
  cylindricalCurvatureCoherence(
    row.sigmaLatMm * unit,
    row.sigmaElevMm * unit,
    row.circLat,
    row.circElev,
    row.kappaPerMm / unit,
    row.kRadPerMm / unit,
  );
// Fixed before quadrature: numerical tolerance for the synthetic integral, not anatomy or image gain.
const tolerance = fixture.tolerance;
const oblique = cylinders.find((row) => row.id === 'isotropic/kappa=1/angle=45')!;

describe('coherencia cilíndrica con Hessiana mixta (267)', () => {
  it('reproduce las 19 integrales cilíndricas 2D conservadas, sin convertir amplitud en intensidad', () => {
    expect(cylinders).toHaveLength(19);
    for (const row of cylinders) expect(Math.abs(coherence(row) - amplitude(row)), row.id).toBeLessThanOrEqual(tolerance);
  });

  it('conserva la fórmula genérica para el control diagonal de rango dos', () => {
    const row = fixture.cases.find((value) => value.model === 'diagonal')!;
    expect(
      Math.abs(
        curvatureCoherence(row.sigmaLatMm, row.sigmaElevMm, row.diagonalPerMm[0], row.diagonalPerMm[1], row.kRadPerMm) - amplitude(row),
      ),
    ).toBeLessThanOrEqual(tolerance);
  });

  it('es invariante al girar el eje dentro del plano tangente cuando la PSF es isotrópica', () => {
    for (const row of cylinders.filter((value) => value.sigmaLatMm === value.sigmaElevMm)) {
      const principal = cylindricalCurvatureCoherence(row.sigmaLatMm, row.sigmaElevMm, 1, 0, row.kappaPerMm, row.kRadPerMm);
      expect(Math.abs(coherence(row) - principal), row.id).toBeLessThanOrEqual(tolerance);
    }
  });

  it('conserva cero, signo de curvatura, ejes principales y unidades mm→µm', () => {
    expect(cylindricalCurvatureCoherence(0.7, 1.1, 0.6, 0.8, 0, 2)).toBe(1);
    for (const row of cylinders) {
      expect(Math.abs(coherence(row, 1000) - amplitude(row)), row.id).toBeLessThanOrEqual(tolerance);
      expect(
        cylindricalCurvatureCoherence(row.sigmaLatMm, row.sigmaElevMm, row.circLat, row.circElev, -row.kappaPerMm, row.kRadPerMm),
      ).toBe(coherence(row));
      if (row.id.endsWith('/angle=0') || row.id.endsWith('/angle=90')) {
        const legacy = curvatureCoherence(row.sigmaLatMm, row.sigmaElevMm, row.diagonalPerMm[0], row.diagonalPerMm[1], row.kRadPerMm);
        expect(Math.abs(legacy - amplitude(row)), row.id).toBeLessThanOrEqual(tolerance);
      }
    }
  });

  it('rechaza el producto histórico proyectado y el uso de intensidad con el mismo oráculo', () => {
    // Calls the preserved historical function: this is a controlled counterfactual, not a failed import.
    const legacy = curvatureCoherence(
      oblique.sigmaLatMm,
      oblique.sigmaElevMm,
      oblique.diagonalPerMm[0],
      oblique.diagonalPerMm[1],
      oblique.kRadPerMm,
    );
    expect(Math.abs(legacy - amplitude(oblique))).toBeGreaterThan(tolerance);
    expect(Math.abs(coherence(oblique) ** 2 - amplitude(oblique))).toBeGreaterThan(tolerance);
  });

  it('conecta la suma cilíndrica en ambas variantes GLSL; la lectura de fuente no acredita ejecución GPU', () => {
    for (const cached of [false, true]) {
      const source = interfaceEchoGlsl(cached);
      const body = source.slice(source.indexOf('float tubeCurvature('), source.indexOf('// Eco de la cara'));
      expect(body).toContain('if (cl < 1e-4) return 1.0;');
      expect(body).toContain('float a = 2.0 * k * c.kc * (sl * sl * vl * vl + sE * sE * ve * ve);');
      expect(body).toContain('return inversesqrt(sqrt(1.0 + a * a));');
    }
  });
});
