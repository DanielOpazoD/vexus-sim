import { describe, expect, it } from 'vitest';
import { CONVEX_BEAM, apertureAngleSigmaRad, lateralFwhmMm, lateralSigmaMm } from '../ultrasound/beamModel';

/**
 * Modelo del haz (PSF lateral de dos vías con número F y dispersión angular de la
 * apertura). Valores cerrados: la misma función alimenta el shader (pasada D),
 * la puerta del PW y el ensanchamiento espectral, así que estas cifras fijan el
 * comportamiento visible (campo cercano nítido, campo lejano grueso).
 */
describe('Modelo del haz (decisión 38)', () => {
  it('FWHM ≈ 1,4 mm hasta el foco y ≈ 3,5 mm a 16 cm; crece monótonamente tras el foco', () => {
    expect(lateralFwhmMm(30, 90)).toBeCloseTo(1.43, 1);
    expect(lateralFwhmMm(90, 90)).toBeCloseTo(1.4, 1);
    expect(lateralFwhmMm(160, 90)).toBeCloseTo(3.5, 1);
    let prev = lateralFwhmMm(90, 90);
    for (let r = 95; r <= 240; r += 5) {
      const w = lateralFwhmMm(r, 90);
      expect(w).toBeGreaterThan(prev);
      prev = w;
    }
  });

  it('el enfoque dinámico en recepción mantiene el campo cercano casi constante (F# mínimo)', () => {
    // entre 20 y 60 mm la apertura de recepción crece con r/F#: FWHM_rx = k·λ·F# constante
    const w20 = lateralFwhmMm(20, 90);
    const w60 = lateralFwhmMm(60, 90);
    expect(Math.abs(w20 - w60)).toBeLessThan(0.05);
    expect(w20).toBeCloseTo(CONVEX_BEAM.k * CONVEX_BEAM.lambdaMm * CONVEX_BEAM.fNumberRxMin, 0);
  });

  it('σ = FWHM / 2,355 y la dispersión angular decrece con la profundidad una vez abierta la apertura', () => {
    expect(lateralSigmaMm(120, 90) * 2.3548).toBeCloseTo(lateralFwhmMm(120, 90), 9);
    // apertura limitada por F# (D = r/F#): σθ = 1/(4·F#) constante
    expect(apertureAngleSigmaRad(30)).toBeCloseTo(1 / (4 * CONVEX_BEAM.fNumberRxMin), 9);
    expect(apertureAngleSigmaRad(60)).toBeCloseTo(apertureAngleSigmaRad(30), 9);
    // apertura máxima alcanzada: σθ = D_max / 4r decrece
    expect(apertureAngleSigmaRad(160)).toBeLessThan(apertureAngleSigmaRad(90));
    expect(apertureAngleSigmaRad(160)).toBeCloseTo(CONVEX_BEAM.apertureRxMaxMm / (4 * 160), 9);
  });

  it('no diverge en r → 0 ni con focos absurdos', () => {
    expect(Number.isFinite(lateralFwhmMm(0, 0))).toBe(true);
    expect(lateralFwhmMm(0, 0)).toBeGreaterThan(0);
    expect(Number.isFinite(apertureAngleSigmaRad(0))).toBe(true);
  });
});

describe('Perfil de transductor (Fase 1)', () => {
  it('el haz y la geometría del perfil son coherentes: λ = c / f0 y frecuencias efectivas ≤ nominal', async () => {
    const { CONVEX_C35_PROFILE } = await import('../ultrasound/transducerProfile');
    const p = CONVEX_C35_PROFILE;
    expect(p.beam.lambdaMm).toBeCloseTo(1540 / (p.geometry.f0B / 1e3), 9);
    expect(p.bEffectiveMHz * 1e6).toBeLessThanOrEqual(p.geometry.f0B);
    expect(p.dopplerEffectiveMHz * 1e6).toBeLessThanOrEqual(p.geometry.f0B);
    expect(p.beam.apertureTxMm).toBeLessThanOrEqual(p.geometry.footprintMm);
    expect(p.colorLineSpacingRad).toBeGreaterThan(0);
  });
});
